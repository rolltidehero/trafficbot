import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { PuppeteerStealthEngine } from './PuppeteerStealthEngine';

const browserTests = process.env.RUN_BROWSER_TESTS === '1' ? describe : describe.skip;
browserTests('Real sandboxed browser against controlled local HTTP server', () => {
  let server: Server;
  let origin: string;
  let engine: PuppeteerStealthEngine;
  let escapedRequests = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
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
  test('HTTP failure', async () => { await expect(engine.navigate(origin + '/error')).rejects.toThrow('HTTP failure: 500'); });
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
