import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BrowserProfileGenerator } from './BrowserProfileGenerator';
import { deviceCatalog } from './DeviceCatalog';
import { validateProfile } from './BrowserProfile';
import { ClientHintsProvider } from './ClientHintsProvider';
import { ProfileStore } from './ProfileStore';
import { ProxyLocationProvider } from './ProxyLocationProvider';
import { StableVersionProvider } from './StableVersionProvider';
import { UserAgentProvider } from './UserAgentProvider';
import { reconcileRuntimeProfile } from './RuntimeProfile';

const chrome = { browser: 'chrome' as const, version: '140.0.7339.80' };
const brazil = { country: 'BR', timezone: 'America/Sao_Paulo', locale: 'pt-BR' };
describe('Coherent profile generation', () => {
  test.each(deviceCatalog.map(device => [device.id, device] as const))('%s produces an internally valid whole profile', (id, device) => {
    const version = device.browser === 'safari' ? '18.0' : device.browser === 'firefox' ? '142.0' : chrome.version;
    const release = { browser: device.browser, version, engineVersion: device.browser === 'edge' ? '140.0.7339.80' : undefined };
    const profile = BrowserProfileGenerator.generate(id, release);
    expect(validateProfile(profile)).toEqual(profile);
    expect(BrowserProfileGenerator.generate(id, release)).toEqual(profile);
    expect(profile.rendering).toBe('native');
  });
  test('Chrome Windows identity is derived consistently', () => {
    const profile = BrowserProfileGenerator.generate('windows-chrome-1440', chrome);
    expect(profile.userAgent).toContain('Windows NT 10.0');
    expect(profile.userAgent).toContain('Chrome/140.0.0.0');
    expect(profile.platform).toBe('Win32');
    expect(profile.clientHints?.secChUaPlatform).toBe('"Windows"');
    expect(ClientHintsProvider.metadata(profile).fullVersion).toBe(chrome.version);
  });
  test.each([
    { platform: 'MacIntel' }, { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140.0.0.0' },
    { browserVersion: '139.0.0.0' }, { gpu: { vendor: 'Apple Inc.', renderer: 'Apple M1' } },
    { locale: 'pt-BR' }, { mobile: true }, { viewport: { width: 4000, height: 4000 } },
  ])('rejects contradictory signal overrides', patch => {
    expect(() => validateProfile({ ...BrowserProfileGenerator.generate('windows-chrome-1440', chrome), ...patch })).toThrow();
  });
  test('non-Chromium profiles omit client hints and deviceMemory', () => {
    for (const [id, browser] of [['macos-safari', 'safari'], ['linux-firefox', 'firefox']] as const) {
      const profile = BrowserProfileGenerator.generate(id, { browser, version: '18.0' });
      expect(profile.clientHints).toBeNull();
      expect(profile.hardware.memory).toBeNull();
    }
    expect(() => UserAgentProvider.create({ browser: 'safari', version: '18.0' }, 'windows', '10')).toThrow();
  });
  test('Edge keeps its product version separate from the Chromium engine', () => {
    const release = { browser: 'edge' as const, version: '140.0.3485.54', engineVersion: '140.0.7339.80' };
    const profile = BrowserProfileGenerator.generate('windows-edge-1920', release);
    expect(profile.userAgent).toContain('Edg/140.0.3485.54');
    expect(profile.clientHints?.fullVersionList).toContainEqual({ brand: 'Chromium', version: release.engineVersion });
    expect(() => BrowserProfileGenerator.generate('windows-edge-1920', { browser: 'edge', version: release.version })).toThrow('engine version');
  });
  test('distribution selects full presets and validates population weights', () => {
    const weights = { 'windows-chrome-1440': 8, 'macos-safari': 2 };
    expect(BrowserProfileGenerator.select(weights, 0.5)).toBe('windows-chrome-1440');
    expect(BrowserProfileGenerator.select(weights, 0.9)).toBe('macos-safari');
    expect(() => BrowserProfileGenerator.select({ 'windows-chrome-1440': -1 }, 0)).toThrow();
  });
});
describe('Proxy location policy', () => {
  test('Brazil aligns locale, languages, timezone and client headers', () => {
    const location = ProxyLocationProvider.parse({ country: 'BR', timezone: 'America/Sao_Paulo' });
    expect(location).toEqual(brazil);
    const profile = BrowserProfileGenerator.generate('windows-chrome-1440', chrome, location);
    expect(profile.acceptLanguage).toBe('pt-BR,pt;q=0.9');
    expect(profile.languages).toEqual(['pt-BR', 'pt']);
    expect(profile.timezone).toBe('America/Sao_Paulo');
  });
  test.each([
    { country: 'BR', timezone: 'Europe/Berlin' }, { country: 'US' },
    { country: 'BR', timezone: 'Fake/City' }, { country: 'BR', timezone: 'America/Sao_Paulo', latitude: 20 },
  ])('rejects contradictory or incomplete location', location => expect(() => ProxyLocationProvider.parse(location)).toThrow());
});
test('persistent identity roundtrips and corrupt identity fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trafficbot-profile-store-'));
  try {
    expect(await ProfileStore.read(root)).toBeUndefined();
    const profile = BrowserProfileGenerator.generate('windows-chrome-1440', chrome, brazil);
    await ProfileStore.write(root, profile);
    expect(await ProfileStore.read(root)).toEqual(profile);
    await writeFile(join(root, 'browser-profile.json'), '{invalid');
    await expect(ProfileStore.read(root)).rejects.toThrow('invalid');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('runtime upgrades preserve preferences and reject changed native hardware or proxy geography', () => {
  const stored = validateProfile({ ...BrowserProfileGenerator.generate('windows-chrome-1440', chrome, brazil), source: 'runtime' });
  const current = validateProfile({ ...BrowserProfileGenerator.generate('windows-chrome-1440', { ...chrome, version: '141.0.7390.65' }), source: 'runtime' });
  const updated = reconcileRuntimeProfile(current, stored);
  expect(updated.browserVersion).toBe('141.0.7390.65');
  expect(updated.locale).toBe('pt-BR');
  expect(updated.timezone).toBe(stored.timezone);
  expect(updated.viewport).toEqual(stored.viewport);
  expect(() => reconcileRuntimeProfile({ ...current, hardware: { ...current.hardware, cores: 16 } }, stored)).toThrow('incompatible');
  expect(() => reconcileRuntimeProfile(current, stored, { country: 'US', locale: 'en-US', timezone: 'America/New_York' })).toThrow('Proxy location changed');
});
test('stable provider validates live release data, caches with expiry, and does not invent Safari versions', async () => {
  let now = 0;
  const fetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ channels: { Stable: { version: chrome.version } } }) });
  const provider = new StableVersionProvider(fetcher, () => now);
  expect(await provider.get('chrome')).toEqual(chrome);
  await provider.get('chrome'); expect(fetcher).toHaveBeenCalledTimes(1);
  now = 86400001; await provider.get('chrome'); expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(provider.get('safari')).rejects.toThrow('installed');
  expect(await provider.get('safari', '18.0')).toEqual({ browser: 'safari', version: '18.0' });
  expect(fetcher.mock.calls[0][1].signal).toBeDefined();
});
