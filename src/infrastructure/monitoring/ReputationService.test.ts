import { ReputationService } from './ReputationService';

afterEach(() => jest.restoreAllMocks());
test('external telemetry is off by default and never claims to measure a proxy', async () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  expect(await ReputationService.checkIP()).toBeNull();
  expect(await ReputationService.checkIP(true, 'http://proxy:80')).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
test('host telemetry uses a deadline and expires cached measurements', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ ip: '127.0.0.1', country: 'XX' }) } as Response);
  const now = Date.now();
  const time = jest.spyOn(Date, 'now').mockReturnValue(now);
  await ReputationService.checkIP(true);
  await ReputationService.checkIP(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
  time.mockReturnValue(now + 300001);
  await ReputationService.checkIP(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
