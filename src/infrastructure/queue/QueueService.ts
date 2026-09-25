import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../logging/logger';
import { deadline } from '../lifecycle/deadline';
import { sessionJobSchema, TrafficJobData } from '../../domain/entities/SessionContract';
export { TrafficJobData } from '../../domain/entities/SessionContract';

export class QueueService {
  private static redisConnection: IORedis | null = null;
  private static queue: Queue<TrafficJobData> | null = null;
  private static workers: Worker[] = [];
  private static operationTimeout = 15000;

  static async initialize(redisUrl: string, timeoutMs = 15000): Promise<void> {
    this.operationTimeout = timeoutMs;
    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: null, lazyConnect: true, connectTimeout: Math.min(timeoutMs, 2000),
      retryStrategy: attempt => Math.min(100 * attempt, 2000),
    });
    this.redisConnection = connection;
    connection.on('error', () => logger.warn('Redis unavailable; reconnecting, readiness suspended'));
    try {
      const ready = new Promise<void>(resolve => connection.once('ready', resolve));
      // connect() rejects on the first failed attempt even while ioredis keeps retrying.
      void connection.connect().catch(() => undefined);
      await deadline(ready, timeoutMs, 'Redis readiness');
      this.queue = new Queue<TrafficJobData>('traffic-sessions', {
        connection,
        defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false },
      });
      this.queue.on('error', () => logger.warn('Queue connection interrupted'));
      await deadline(this.queue.waitUntilReady(), timeoutMs, 'Queue readiness');
    } catch {
      await this.close(1000);
      throw new Error('Required Redis infrastructure did not become ready');
    }
  }
  static isDistributedEnabled(): boolean {
    return !!this.queue && this.redisConnection?.status === 'ready' && this.workers.every(worker => worker.isRunning());
  }
  static async addSession(data: TrafficJobData): Promise<string> {
    if (!this.queue) throw new Error('Queue not initialized');
    const job = await deadline(this.queue.add('execute-session', sessionJobSchema.parse(data)), this.operationTimeout, 'Queue submission (outcome may be unknown)');
    return job.id!;
  }
  static async createWorker(processor: (job: Job<TrafficJobData>) => Promise<void>, concurrency = 1): Promise<Worker> {
    if (!this.redisConnection || !this.queue) throw new Error('Queue not initialized');
    const worker = new Worker<TrafficJobData>('traffic-sessions', async job => {
      job.data = sessionJobSchema.parse(job.data);
      await processor(job);
    }, { connection: this.redisConnection, concurrency });
    this.workers.push(worker);
    worker.on('error', () => logger.warn('Worker connection interrupted; pending jobs remain in Redis'));
    worker.on('failed', job => logger.warn('Session attempt failed', { jobId: job?.id, attemptsMade: job?.attemptsMade }));
    await deadline(worker.waitUntilReady(), this.operationTimeout, 'Worker readiness');
    return worker;
  }
  static async close(timeoutMs = 30000, cancelActive?: () => Promise<unknown>): Promise<void> {
    const workers = this.workers.splice(0);
    const queue = this.queue;
    const connection = this.redisConnection;
    this.queue = null;
    this.redisConnection = null;
    const drain = Promise.all(workers.map(worker => worker.close()));
    try {
      try { await deadline(drain, timeoutMs, 'Worker drain'); }
      catch {
        if (!cancelActive) throw new Error('Worker drain deadline exceeded');
        // Cancel browsers while Redis is still connected so failures can be recorded.
        await deadline(cancelActive(), timeoutMs, 'Active session cancellation');
        await deadline(drain, timeoutMs, 'Cancelled worker drain');
      }
    } finally {
      await Promise.allSettled(workers.map(worker => worker.disconnect()));
      // Disconnect shared Redis before awaiting queue closure: queued commands must not hang shutdown.
      connection?.disconnect();
      if (queue) await deadline(queue.close(), 1000, 'Queue close').catch(() => undefined);
    }
  }
}
