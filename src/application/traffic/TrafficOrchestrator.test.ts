import { TrafficOrchestrator } from './TrafficOrchestrator';
import { BrowserEngine } from '../../domain/interfaces/BrowserEngine';
import { Session } from '../../domain/entities/Session';
import { MetricsService } from '../../infrastructure/monitoring/MetricsService';
import { Config } from '../../infrastructure/config/config';

function mockEngine() {
  return {
    init: jest.fn().mockResolvedValue(undefined), navigate: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined), wait: jest.fn().mockResolvedValue(undefined),
    evaluate: jest.fn().mockResolvedValue(null), setExtraHeaders: jest.fn(),
    navigationResult: jest.fn().mockReturnValue({ status: 200, finalUrl: 'http://localhost/' }),
  } as unknown as jest.Mocked<BrowserEngine>;
}
const session = new Session({ id: 'test', url: 'http://localhost/', durationMs: 0.01, userAgent: 'test', viewport: { width: 100, height: 100 } });
beforeEach(() => { Config.HUMAN_BEHAVIOR = false; Config.ORGANIC_SEARCH = false; Config.EXTERNAL_IP_CHECK = false; });
test('preserves original failure even when cleanup fails and counts only once', async () => {
  const engine = mockEngine();
  const original = new Error('HTTP failure: 503');
  engine.navigate.mockRejectedValue(original);
  engine.close.mockRejectedValue(new Error('cleanup'));
  const before = MetricsService.getInstance().getMetrics();
  await expect(new TrafficOrchestrator(engine).run(session)).rejects.toBe(original);
  expect(engine.close).toHaveBeenCalledTimes(1);
  const after = MetricsService.getInstance().getMetrics();
  expect(after.failedSessions - before.failedSessions).toBe(1);
  expect(after.successfulSessions).toBe(before.successfulSessions);
  expect(after.activeSessions).toBe(before.activeSessions);
  expect(after.lastFailureKind).toBe('http');
});
test('cleanup failure is a single failed session', async () => {
  const engine = mockEngine();
  engine.close.mockRejectedValue(new Error('cleanup'));
  const before = MetricsService.getInstance().getMetrics();
  await expect(new TrafficOrchestrator(engine).run(session)).rejects.toThrow('cleanup');
  const after = MetricsService.getInstance().getMetrics();
  expect(after.successfulSessions).toBe(before.successfulSessions);
  expect(after.failedSessions - before.failedSessions).toBe(1);
});
test('successful navigation records status and destination', async () => {
  await new TrafficOrchestrator(mockEngine()).run(session);
  expect(MetricsService.getInstance().getMetrics().lastNavigation).toEqual({ status: 200, finalUrl: 'http://localhost/' });
});
test('invalid queue payload never launches a browser', async () => {
  const engine = mockEngine();
  await expect(new TrafficOrchestrator(engine).runFromJob('id', { durationMinutes: -1 })).rejects.toThrow();
  expect(engine.init).not.toHaveBeenCalled();
});
