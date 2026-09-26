import { BrowserProfile, OperatingSystem, platforms, validateProfile } from './BrowserProfile';
import { getDevice } from './DeviceCatalog';
import { BrowserRelease, UserAgentProvider } from './UserAgentProvider';
import { ClientHintsProvider } from './ClientHintsProvider';
import { LocaleProvider } from './LocaleProvider';
import { TimezoneProvider } from './TimezoneProvider';

export interface ProfileLocation { country: string; timezone: string; locale: string; latitude?: number; longitude?: number; }
export class BrowserProfileGenerator {
  static generate(deviceId: string, release: BrowserRelease, location?: ProfileLocation): BrowserProfile {
    const device = getDevice(deviceId);
    if (release.browser !== device.browser) throw new Error('Device preset and browser release disagree');
    const locale = location?.locale || device.locales[0];
    return validateProfile({
      schemaVersion: 1, id: device.id, deviceId, source: 'catalog', browser: device.browser,
      browserVersion: release.version, operatingSystem: device.operatingSystem, osVersion: device.osVersion,
      engineVersion: release.engineVersion,
      userAgent: UserAgentProvider.create(release, device.operatingSystem, device.osVersion),
      clientHints: ClientHintsProvider.create(release, device.operatingSystem, device.osVersion, device.mobile, device.model),
      viewport: device.viewport, screen: device.screen, devicePixelRatio: device.devicePixelRatio,
      mobile: device.mobile, touch: device.touch, hardware: device.hardware, gpu: device.gpu,
      platform: platforms[device.operatingSystem], ...LocaleProvider.values(locale),
      timezone: TimezoneProvider.validate(location?.timezone || device.timezone, location?.country),
      country: location?.country, rendering: 'native', permissions: 'native',
    });
  }
  /** Select a whole preset using a caller's measured population weights, never independent signal values. */
  static select(weights: Record<string, number>, sample: number): string {
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Sample must be in [0, 1)');
    const entries = Object.entries(weights);
    for (const [id, weight] of entries) { getDevice(id); if (!Number.isFinite(weight) || weight < 0) throw new Error('Invalid distribution weight'); }
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error('Distribution must have positive total weight');
    let remaining = sample * total;
    for (const [id, weight] of entries) { remaining -= weight; if (remaining < 0) return id; }
    throw new Error('Invalid distribution');
  }
  static hostOS(): OperatingSystem {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'macos';
    if (process.platform === 'linux') return 'linux';
    throw new Error('Unsupported browser host OS');
  }
}
