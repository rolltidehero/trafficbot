import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { PuppeteerStealthEngine } from './PuppeteerStealthEngine';
import { auditBrowser } from './profile/ProfileAudit';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireProfile } from './ProfileLease';
import puppeteer from 'puppeteer';
import { ProxyLocationProvider } from './profile/ProxyLocationProvider';
import { createRuntimeProfile, applyRuntimeProfile } from './profile/RuntimeProfile';

const browserTests = process.env.RUN_BROWSER_TESTS === '1' ? describe : describe.skip;
browserTests('Real sandboxed browser against controlled local HTTP server', () => {
  let server: Server;
  let origin: string;
  let engine: PuppeteerStealthEngine;
  let escapedRequests = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/headers') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.headers)); return; }
      if (req.url === '/slow') return;
      if (req.url === '/error') { res.writeHead(500).end('failure'); return; }
      if (req.url === '/redirect') { res.writeHead(302, { Location: '/ok' }).end(); return; }
      if (req.url === '/escape') { res.writeHead(302, { Location: origin.replace('127.0.0.1', 'localhost') + '/escaped' }).end(); return; }
      if (req.url === '/escaped') escapedRequests++;
      res.end('<html><body>Controlled test</body></html>');
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  beforeEach(async () => {
    engine = new PuppeteerStealthEngine();
    await engine.init({ headless: true, allowedOrigin: origin, navigationTimeoutMs: 750 });
  }, 30000);
  afterEach(async () => { await engine?.close(); });
  test('success response and evaluation', async () => {
    await engine.navigate(origin + '/ok');
    expect(engine.navigationResult()).toEqual({ status: 200, finalUrl: origin + '/ok' });
    expect(await engine.evaluate(() => 1 + 1)).toBe(2);
  });
  test('native profile matches JS, rendering and outgoing identity headers', async () => {
    await engine.navigate(origin + '/ok');
    const audit = await auditBrowser(engine);
    expect(audit.checks).toEqual(Object.fromEntries(Object.keys(audit.checks).map(key => [key, true])));
    await engine.setExtraHeaders({ Referer: origin + '/ok' });
    await engine.navigate(origin + '/headers');
    const headers = await engine.evaluate(() => JSON.parse(document.body.innerText) as Record<string, string>);
    expect(headers['user-agent']).toBe(audit.expected.userAgent);
    expect(headers['accept-language']).toBe(audit.expected.acceptLanguage);
    expect(headers['sec-ch-ua-platform']).toBe(audit.expected.clientHints!.secChUaPlatform);
    expect(headers['sec-ch-ua-mobile']).toBe(audit.expected.clientHints!.secChUaMobile);
    expect(headers['sec-ch-ua']).toBe(audit.expected.clientHints!.secChUa);
    await expect(engine.setExtraHeaders({ 'User-Agent': 'unrelated' })).rejects.toThrow('BrowserProfile');
  });
  test('persistent sessions keep identity, cookies and localStorage across launches', async () => {
    await engine.close();
    const root = await mkdtemp(join(tmpdir(), 'trafficbot-real-profile-'));
    let lease = await acquireProfile(root, 'one');
    try {
      await engine.init({ userDataDir: lease.path, headless: true, allowedOrigin: origin });
      await engine.navigate(origin + '/ok');
      const first = engine.getProfile();
      await engine.evaluate(() => { localStorage.setItem('profile-test', 'retained'); document.cookie = 'profile_test=retained; Max-Age=3600; Path=/'; });
      await engine.close(); await lease.release();
      lease = await acquireProfile(root, 'one');
      await engine.init({ userDataDir: lease.path, headless: true, allowedOrigin: origin });
      await engine.navigate(origin + '/ok');
      expect(engine.getProfile()).toEqual(first);
      expect(await engine.evaluate(() => localStorage.getItem('profile-test'))).toBe('retained');
      expect(await engine.evaluate(() => document.cookie)).toContain('profile_test=retained');
    } finally { await engine.close(); await lease.release(); await rm(root, { recursive: true, force: true }); }
  }, 30000);
  test('HTTP failure', async () => { await expect(engine.navigate(origin + '/error')).rejects.toThrow('HTTP failure: 500'); });
  test('location lookup travels through browser proxy and applies Brazilian locale/timezone', async () => {
    await engine.close();
    let proxyRequests = 0;
    const proxy = createServer((req, res) => {
      if (req.url === origin + '/location') {
        proxyRequests++;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ country: 'BR', timezone: 'America/Sao_Paulo' }));
      } else res.writeHead(502).end();
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const browser = await puppeteer.launch({ headless: true, args: [
      `--proxy-server=http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
      '--proxy-bypass-list=<-loopback>', // Test-only: Chrome normally bypasses loopback proxies.
    ] });
    try {
      const page = await browser.newPage();
      const location = await ProxyLocationProvider.resolve(page, origin + '/location');
      expect(proxyRequests).toBe(1);
      const profile = await createRuntimeProfile(browser, 'native', undefined, location);
      await applyRuntimeProfile(page, profile);
      expect(await page.evaluate(() => ({ language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })))
        .toEqual({ language: 'pt-BR', timezone: 'America/Sao_Paulo' });
      expect(profile.acceptLanguage).toBe('pt-BR,pt;q=0.9');
      expect(await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state)).toBe('prompt');
    } finally { await browser.close(); proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); }
  }, 30000);
  test('same-origin redirect', async () => {
    await engine.navigate(origin + '/redirect');
    expect(engine.navigationResult().finalUrl).toBe(origin + '/ok');
  });
  test('cross-origin redirect aborted before destination request', async () => {
    await expect(engine.navigate(origin + '/escape')).rejects.toThrow();
    expect(escapedRequests).toBe(0);
    expect(() => engine.navigationResult()).toThrow('outside');
  });
  test('navigation timeout', async () => { await expect(engine.navigate(origin + '/slow')).rejects.toThrow(/timeout/i); });
  test('close cancels session wait', async () => {
    const wait = engine.wait(60000);
    const result = expect(wait).rejects.toThrow('cancelled');
    await engine.close();
    await result;
  });
});
