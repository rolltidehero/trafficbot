import { createServer } from 'http';
import { TrafficOrchestrator } from './application/traffic/TrafficOrchestrator';
import { PuppeteerStealthEngine } from './infrastructure/browser/PuppeteerStealthEngine';
import { Config } from './infrastructure/config/config';
import { logger } from './infrastructure/logging/logger';
import { MetricsService } from './infrastructure/monitoring/MetricsService';
import { QueueService } from './infrastructure/queue/QueueService';
import { TrafficJobData } from './domain/entities/SessionContract';
import { makeJob } from './infrastructure/config/session';
import { deadline } from './infrastructure/lifecycle/deadline';

const engines = new Set<PuppeteerStealthEngine>();
let stopping = false;
let started = false;
let distributed = false;
let monitor: NodeJS.Timeout | undefined;
let shutdownPromise: Promise<void> | undefined;
const health = createServer((_request, response) => {
  const ready = started && !stopping && (!distributed || QueueService.isDistributedEnabled());
  response.writeHead(ready ? 200 : 503).end(ready ? `ready:${Config.BOT_ROLE}` : 'not ready');
});

function shutdown(code = 0): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  stopping = true;
  process.exitCode = code;
  if (monitor) clearInterval(monitor);
  health.close();
  shutdownPromise = (async () => {
    const forced = setTimeout(() => {
      logger.error('Shutdown deadline exceeded; unfinished jobs will be recovered by Redis');
      process.exit(1);
    }, Config.SHUTDOWN_TIMEOUT_MS);
    let complete = false;
    try {
      // First stop accepting work and drain. On expiry cancel browser waits and navigations.
      await QueueService.close(Math.floor(Config.SHUTDOWN_TIMEOUT_MS / 2), () => Promise.allSettled([...engines].map(engine => engine.close())));
      await deadline(Promise.allSettled([...engines].map(engine => engine.close())), Math.floor(Config.SHUTDOWN_TIMEOUT_MS / 3), 'Browser shutdown');
      complete = true;
    } catch { process.exitCode = 1; }
    finally { if (complete) clearTimeout(forced); }
  })();
  return shutdownPromise;
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });

async function execute(id: string, data: TrafficJobData): Promise<void> {
  if (stopping) throw new Error('Shutdown in progress');
  const engine = new PuppeteerStealthEngine();
  engines.add(engine);
  try { await new TrafficOrchestrator(engine).runFromJob(id, data); }
  finally { engines.delete(engine); }
}
async function bootstrap(): Promise<void> {
  health.on('error', () => { logger.error('Health server failed'); void shutdown(1); });
  await new Promise<void>((resolve, reject) => {
    health.once('error', reject);
    health.listen(Config.HEALTH_PORT, '127.0.0.1', resolve);
  });
  if (Config.BOT_ROLE !== 'local') {
    try {
      await QueueService.initialize(Config.REDIS_URL, Config.REDIS_READY_TIMEOUT_MS);
      distributed = true;
    } catch (error) {
      if (Config.BOT_ROLE !== 'both' || !Config.LOCAL_FALLBACK) throw error;
      logger.warn('Explicit startup fallback selected: running a finite local batch');
    }
  }
  if (stopping) { await QueueService.close(1000); return; }
  monitor = setInterval(() => MetricsService.getInstance().printSummary(), 10000);
  if (distributed && Config.BOT_ROLE !== 'producer') {
    await QueueService.createWorker(job => execute(job.id!, job.data), Config.MAX_SESSIONS);
  }
  started = true;
  if (Config.BOT_ROLE !== 'worker') {
    for (let index = 0; index < Config.MAX_SESSIONS && !stopping; index++) {
      const data = makeJob(Config, index);
      if (distributed) await QueueService.addSession(data);
      else await execute(`local-${index}`, data);
    }
  }
  if (!distributed || Config.BOT_ROLE === 'producer') await shutdown();
}
if (require.main === module) {
  void bootstrap().catch(() => {
    logger.error('Execution failed: check configuration, Redis readiness, or session failure logs');
    void shutdown(1);
  });
}
