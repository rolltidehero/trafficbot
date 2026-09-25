import { mkdir, rmdir } from 'fs/promises';
import { resolve, join } from 'path';

// Atomic filesystem lock also protects shared volumes across processes. Never steal stale locks.
export async function acquireProfile(root: string, key: string): Promise<{ path: string; release: () => Promise<void> }> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(key)) throw new Error('Invalid profile key');
  await mkdir(root, { recursive: true });
  const path = resolve(root, key);
  const lock = join(root, `.${key}.lock`);
  try { await mkdir(lock); } catch { throw new Error('Persistent profile is busy or has a stale lock; inspect before removing the lock'); }
  return { path, release: () => rmdir(lock) };
}
