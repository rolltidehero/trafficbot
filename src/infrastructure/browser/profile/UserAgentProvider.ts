import type { BrowserFamily, OperatingSystem } from './BrowserProfile';

export interface BrowserRelease { browser: BrowserFamily; version: string; engineVersion?: string; }
export class UserAgentProvider {
  static create(release: BrowserRelease, os: OperatingSystem, osVersion: string): string {
    if (!/^\d+(?:\.\d+){1,3}$/.test(release.version)) throw new Error('Invalid browser version');
    if (release.browser === 'edge' && (!release.engineVersion || !/^\d+(?:\.\d+){1,3}$/.test(release.engineVersion))) throw new Error('Edge requires its observed Chromium engine version');
    if (release.browser === 'chrome' && release.engineVersion && release.engineVersion !== release.version) throw new Error('Chrome and Chromium versions must agree');
    if (release.browser === 'edge' && os === 'android') throw new Error('Edge Android is not modeled');
    const major = release.version.split('.')[0];
    const tokens = { windows: 'Windows NT 10.0; Win64; x64', macos: 'Macintosh; Intel Mac OS X 10_15_7', linux: 'X11; Linux x86_64', android: 'Linux; Android 10; K', ios: `iPhone; CPU iPhone OS ${osVersion.replace(/\./g, '_')} like Mac OS X` };
    if (release.browser === 'safari') {
      if (!['macos', 'ios'].includes(os)) throw new Error('Safari requires macOS or iOS');
      return `Mozilla/5.0 (${tokens[os]}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${release.version}${os === 'ios' ? ' Mobile/15E148' : ''} Safari/${os === 'ios' ? '604.1' : '605.1.15'}`;
    }
    if (os === 'ios') throw new Error('Chromium/Gecko identities on iOS are not supported');
    if (release.browser === 'firefox') {
      const platform = os === 'android' ? `Android ${osVersion}; Mobile` : tokens[os];
      return `Mozilla/5.0 (${platform}; rv:${major}.0) Gecko/${os === 'android' ? `${major}.0` : '20100101'} Firefox/${release.version}`;
    }
    const engineMajor = (release.engineVersion || release.version).split('.')[0];
    return `Mozilla/5.0 (${tokens[os]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${engineMajor}.0.0.0${os === 'android' ? ' Mobile' : ''} Safari/537.36${release.browser === 'edge' ? ` Edg/${release.version}` : ''}`;
  }
  static fromInstalledVersion(version: string): BrowserRelease {
    const match = /^(?:HeadlessChrome|Chrome|Chromium|Edg|Firefox)\/(\d+(?:\.\d+){1,3})$/.exec(version);
    if (!match) throw new Error('Unsupported installed browser version');
    return { browser: version.startsWith('Edg/') ? 'edge' : version.startsWith('Firefox/') ? 'firefox' : 'chrome', version: match[1] };
  }
}
