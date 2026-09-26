import { mkdir, readFile, rename, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { BrowserProfile, validateProfile } from './BrowserProfile';

/** The caller must hold ProfileLease for this directory for the entire browser session. */
export class ProfileStore {
  static async read(directory: string): Promise<BrowserProfile | undefined> {
    try { return validateProfile(JSON.parse(await readFile(join(directory, 'browser-profile.json'), 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw new Error('Stored browser profile is invalid; inspect it rather than replacing it silently'); }
  }
  static async write(directory: string, profile: BrowserProfile): Promise<void> {
    const data = validateProfile(profile);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, 'browser-profile.json.tmp');
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temporary, join(directory, 'browser-profile.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
