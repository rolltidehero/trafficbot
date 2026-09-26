import { z } from 'zod';
import { BrowserFamily } from './BrowserProfile';
import { BrowserRelease } from './UserAgentProvider';

const version = z.string().regex(/^\d+(?:\.\d+){1,3}$/);
/** Explicit refresh only. Live sessions always derive versions from the executable, never the network. */
export class StableVersionProvider {
  private cache = new Map<BrowserFamily, { expires: number; release: BrowserRelease }>();
  constructor(private fetcher: typeof fetch = fetch, private now = Date.now) {}
  async get(browser: BrowserFamily, safariInstalledVersion?: string): Promise<BrowserRelease> {
    if (browser === 'safari') {
      if (!safariInstalledVersion) throw new Error('Safari requires a version reported by the installed Safari browser; no guessed version');
      return { browser, version: version.parse(safariInstalledVersion) };
    }
    const cached = this.cache.get(browser);
    if (cached && cached.expires > this.now()) return cached.release;
    const endpoints = {
      chrome: 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json',
      edge: 'https://edgeupdates.microsoft.com/api/products?view=enterprise',
      firefox: 'https://product-details.mozilla.org/1.0/firefox_versions.json',
    };
    const response = await this.fetcher(endpoints[browser], { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Stable browser release provider unavailable');
    const payload: unknown = await response.json();
    let resolved: string;
    if (browser === 'chrome') resolved = z.object({ channels: z.object({ Stable: z.object({ version }) }) }).parse(payload).channels.Stable.version;
    else if (browser === 'firefox') resolved = z.object({ LATEST_FIREFOX_VERSION: version }).parse(payload).LATEST_FIREFOX_VERSION;
    else {
      const products = z.array(z.object({ Product: z.string(), Releases: z.array(z.object({ Platform: z.string(), Architecture: z.string(), ProductVersion: version })) })).parse(payload);
      const release = products.find(item => item.Product === 'Stable')?.Releases.find(item => item.Platform === 'Windows' && item.Architecture === 'x64');
      if (!release) throw new Error('Edge stable Windows x64 release missing');
      resolved = release.ProductVersion;
    }
    const release = { browser, version: resolved };
    this.cache.set(browser, { expires: this.now() + 86400000, release });
    return release;
  }
}
