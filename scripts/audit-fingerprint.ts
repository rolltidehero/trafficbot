import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { PuppeteerStealthEngine } from '../src/infrastructure/browser/PuppeteerStealthEngine';
import { auditBrowser } from '../src/infrastructure/browser/profile/ProfileAudit';
import { acquireProfile } from '../src/infrastructure/browser/ProfileLease';
import { Config } from '../src/infrastructure/config/config';
import { proxyServer } from '../src/domain/entities/SessionContract';

const sites: Record<string, string> = {
  browserleaks: 'https://browserleaks.com/javascript', amiunique: 'https://amiunique.org/fingerprint',
  pixelscan: 'https://pixelscan.net/', fingerprintjs: 'https://demo.fingerprint.com/',
};
async function main() {
  const name = process.argv[2];
  if (!name || name === '--help') {
    console.log('Usage: npm run audit:fingerprint -- <browserleaks|amiunique|pixelscan|fingerprintjs> --external [--persistent] [--headless]');
    console.log('One opt-in external site per run; results saved locally. Use test:browser for offline assertions.');
    return;
  }
  if (!sites[name] || !process.argv.includes('--external')) throw new Error('Select a known site and explicitly pass --external');
  const url = sites[name];
  const lease = process.argv.includes('--persistent') ? await acquireProfile(Config.SESSIONS_DATA_DIR, 'fingerprint-audit') : undefined;
  const engine = new PuppeteerStealthEngine();
  try {
    await engine.init({
      headless: process.argv.includes('--headless'), userDataDir: lease?.path, allowedOrigin: new URL(url).origin,
      deviceProfile: Config.BROWSER_PROFILE,
      proxy: Config.PROXY_URL && Config.PROXY_PORT ? { server: proxyServer({ host: Config.PROXY_URL, port: Config.PROXY_PORT, username: Config.PROXY_USER, password: Config.PROXY_PASS }), username: Config.PROXY_USER, password: Config.PROXY_PASS } : undefined,
      proxyLocationEndpoint: Config.MATCH_GEOLOCATION ? Config.PROXY_LOCATION_URL : undefined,
      grantGeolocation: Config.GRANT_GEOLOCATION,
    });
    await engine.navigate(url);
    await engine.wait(10000);
    const audit = await auditBrowser(engine);
    await mkdir('./logs/fingerprint-audits', { recursive: true });
    const output = resolve('./logs/fingerprint-audits', `${name}-${Date.now()}.json`);
    await writeFile(output, JSON.stringify({ site: name, measuredAt: new Date().toISOString(), ...audit }, null, 2), { mode: 0o600 });
    console.log(`Local signal report: ${output}; internally consistent: ${audit.consistent}`);
    console.log('This is not the external service verdict. Inspect that service in the browser; uniqueness/bot scores are not pass/fail criteria.');
    if (!process.argv.includes('--headless')) await engine.wait(30000);
    if (!audit.consistent) process.exitCode = 1;
  } finally { try { await engine.close(); } finally { await lease?.release(); } }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'Fingerprint audit failed'); process.exitCode = 1; });
