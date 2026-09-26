import { Page } from 'puppeteer';
import { z } from 'zod';
import { LocaleProvider } from './LocaleProvider';
import { ProfileLocation } from './BrowserProfileGenerator';
import { TimezoneProvider } from './TimezoneProvider';

const locationSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/), timezone: z.string(),
  latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional(),
}).refine(value => (value.latitude === undefined) === (value.longitude === undefined), 'Coordinates must be paired');
export class ProxyLocationProvider {
  static parse(value: unknown): ProfileLocation {
    const data = locationSchema.parse(value);
    return { ...data, timezone: TimezoneProvider.validate(data.timezone, data.country), locale: LocaleProvider.forCountry(data.country) };
  }
  static async resolve(page: Page, endpoint: string): Promise<ProfileLocation> {
    const url = new URL(endpoint);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))))
      throw new Error('Proxy location endpoint requires HTTPS without credentials (loopback HTTP allowed for tests)');
    // This page belongs to the launched browser and therefore uses its proxy and authentication.
    // No host-network fetch and no cache shared between proxy sessions (rotating exits can differ).
    await page.setRequestInterception(true);
    const handler = (request: import('puppeteer').HTTPRequest) => {
      if (new URL(request.url()).origin !== url.origin) void request.abort().catch(() => undefined);
      else void request.continue().catch(() => undefined);
    };
    page.on('request', handler);
    try {
      const response = await page.goto(endpoint, { waitUntil: 'domcontentloaded', timeout: 5000 });
      if (!response?.ok() || new URL(response.url()).origin !== url.origin) throw new Error('Proxy location request failed');
      const body = await response.text();
      if (body.length > 16384) throw new Error('Proxy location response too large');
      return this.parse(JSON.parse(body));
    } catch { throw new Error('Could not obtain a validated proxy country/timezone; session will not navigate to target'); }
    finally { page.off('request', handler); await page.setRequestInterception(false); }
  }
}
