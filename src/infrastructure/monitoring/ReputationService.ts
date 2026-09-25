import { z } from 'zod';
import { logger } from '../logging/logger';

const detailsSchema = z.object({ ip: z.string(), country: z.string().optional() });
export type IPDetails = z.infer<typeof detailsSchema>;
export class ReputationService {
  private static cache?: { expires: number; value: IPDetails };
  static async checkIP(enabled = false, proxyServer?: string): Promise<IPDetails | null> {
    // A host fetch cannot measure a browser proxy. No proxy URLs or credentials are logged.
    if (!enabled || proxyServer) return null;
    if (this.cache && this.cache.expires > Date.now()) return this.cache.value;
    try {
      const response = await fetch('https://api.country.is/', { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('Host IP telemetry failed');
      const value = detailsSchema.parse(await response.json());
      this.cache = { expires: Date.now() + 300000, value };
      logger.info('Optional direct host-network IP check completed (not a proxy measurement)');
      return value;
    } catch { logger.debug('Optional host IP telemetry unavailable'); return null; }
  }
}
