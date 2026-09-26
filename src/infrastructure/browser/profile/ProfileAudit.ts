import { BrowserEngine } from '../../../domain/interfaces/BrowserEngine';
import { z } from 'zod';

export async function auditBrowser(engine: BrowserEngine) {
  const expected = engine.getProfile();
  const observed = await engine.evaluate(async () => {
    const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { getHighEntropyValues(keys: string[]): Promise<unknown> } };
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 1, 1);
    const pixels = Array.from(ctx.getImageData(0, 0, 1, 1).data);
    const gl = document.createElement('canvas').getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const audio = new OfflineAudioContext(1, 128, 44100);
    const source = audio.createConstantSource();
    source.offset.value = 0.25;
    source.connect(audio.destination); source.start();
    const rendered = await audio.startRendering();
    const audioSamples = Array.from(rendered.getChannelData(0));
    const worker = await new Promise<{ userAgent: string; language: string; platform: string; timezone: string }>((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([`postMessage({userAgent:navigator.userAgent,language:navigator.language,platform:navigator.platform,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})`], { type: 'text/javascript' }));
      const child = new Worker(url);
      const finish = () => { child.terminate(); URL.revokeObjectURL(url); clearTimeout(timeout); };
      const timeout = setTimeout(() => { finish(); reject(new Error('Worker identity audit timed out')); }, 3000);
      child.onmessage = event => { finish(); resolve(event.data); };
      child.onerror = () => { finish(); reject(new Error('Worker identity audit unavailable')); };
    }).catch(() => null); // Site CSP may forbid blob workers; expose unavailable coverage.
    return {
      userAgent: navigator.userAgent, platform: navigator.platform, locale: navigator.language,
      languages: Array.from(navigator.languages), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
      cores: navigator.hardwareConcurrency, memory: nav.deviceMemory ?? null, dpr: devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
      gpu: debug ? { vendor: String(gl!.getParameter(debug.UNMASKED_VENDOR_WEBGL)), renderer: String(gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL)) } : { vendor: '', renderer: '' },
      clientHints: await nav.userAgentData?.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'model', 'fullVersionList']),
      canvasPixel: pixels, canvasRepeatStable: JSON.stringify(pixels) === JSON.stringify(Array.from(ctx.getImageData(0, 0, 1, 1).data)),
      audio: { sampleRate: rendered.sampleRate, constantSignalIntact: audioSamples.every(value => value === 0.25), repeatStable: JSON.stringify(audioSamples) === JSON.stringify(Array.from(rendered.getChannelData(0))) },
      geolocationPermission: (await navigator.permissions.query({ name: 'geolocation' })).state,
      webdriver: navigator.webdriver,
      worker,
      nativeFontChecks: Object.fromEntries(['Arial', 'Helvetica', 'Segoe UI', 'DejaVu Sans'].map(font => [font, document.fonts.check(`12px "${font}"`)])),
    };
  });
  const hints = z.object({
    platform: z.string(), mobile: z.boolean(), architecture: z.string(), bitness: z.string(), platformVersion: z.string(), model: z.string(),
    brands: z.array(z.object({ brand: z.string(), version: z.string() })),
    fullVersionList: z.array(z.object({ brand: z.string(), version: z.string() })),
  }).safeParse(observed.clientHints);
  const expectedHints = expected.clientHints;
  const checks = {
    userAgent: observed.userAgent === expected.userAgent, platform: observed.platform === expected.platform,
    locale: observed.locale === expected.locale, languages: JSON.stringify(observed.languages) === JSON.stringify(expected.languages),
    intlLocale: observed.intlLocale === expected.locale,
    timezone: observed.timezone === new Intl.DateTimeFormat('en', { timeZone: expected.timezone }).resolvedOptions().timeZone,
    cores: observed.cores === expected.hardware.cores, memory: observed.memory === expected.hardware.memory,
    gpu: JSON.stringify(observed.gpu) === JSON.stringify(expected.gpu), dpr: observed.dpr === expected.devicePixelRatio,
    viewport: JSON.stringify(observed.viewport) === JSON.stringify(expected.viewport),
    screen: JSON.stringify(observed.screen) === JSON.stringify(expected.screen),
    canvas: observed.canvasRepeatStable && observed.canvasPixel.join(',') === '255,0,0,255',
    audio: observed.audio.constantSignalIntact && observed.audio.repeatStable,
    clientHints: !!expectedHints && hints.success && JSON.stringify(hints.data.brands) === JSON.stringify(expectedHints.brands)
      && JSON.stringify(hints.data.fullVersionList) === JSON.stringify(expectedHints.fullVersionList)
      && hints.data.platform === JSON.parse(expectedHints.secChUaPlatform) && hints.data.mobile === expected.mobile
      && ['architecture', 'bitness', 'platformVersion', 'model'].every(key => hints.data[key as 'architecture'] === expectedHints[key as 'architecture']),
  };
  return { expected, observed, checks, consistent: Object.values(checks).every(Boolean) };
}
