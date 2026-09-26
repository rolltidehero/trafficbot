import { BrowserProfile, hintPlatforms } from './BrowserProfile';
import { BrowserRelease } from './UserAgentProvider';

export class ClientHintsProvider {
  static create(release: BrowserRelease, os: BrowserProfile['operatingSystem'], platformVersion: string, mobile: boolean, model = ''): BrowserProfile['clientHints'] {
    if (release.browser === 'firefox' || release.browser === 'safari') return null;
    const brand = release.browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
    const brands = [{ brand: 'Chromium', version: (release.engineVersion || release.version).split('.')[0] }, { brand, version: release.version.split('.')[0] }];
    const fullVersionList = [{ brand: 'Chromium', version: release.engineVersion || release.version }, { brand, version: release.version }];
    return {
      secChUa: brands.map(item => `${JSON.stringify(item.brand)};v=${JSON.stringify(item.version)}`).join(', '),
      secChUaMobile: mobile ? '?1' : '?0', secChUaPlatform: JSON.stringify(hintPlatforms[os]),
      brands, fullVersionList, platformVersion, architecture: mobile || os === 'macos' ? 'arm' : 'x86', bitness: '64', model,
    };
  }
  static metadata(profile: BrowserProfile) {
    if (!profile.clientHints) throw new Error('This profile has no Chromium client hints');
    const hints = profile.clientHints;
    return { brands: hints.brands, fullVersionList: hints.fullVersionList, fullVersion: profile.browserVersion,
      platform: hintPlatforms[profile.operatingSystem], platformVersion: hints.platformVersion,
      architecture: hints.architecture, bitness: hints.bitness, model: hints.model, mobile: profile.mobile, wow64: false };
  }
}
