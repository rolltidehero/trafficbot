import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireProfile } from './ProfileLease';

test('profile exclusivity, distinct sessions, reuse and traversal prevention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'trafficbot-profile-test-'));
  try {
    const first = await acquireProfile(root, 'one');
    await expect(acquireProfile(root, 'one')).rejects.toThrow('busy');
    const second = await acquireProfile(root, 'two');
    expect(first.path).not.toBe(second.path);
    await first.release();
    const reused = await acquireProfile(root, 'one');
    await reused.release();
    await second.release();
    await expect(acquireProfile(root, '../escape')).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
