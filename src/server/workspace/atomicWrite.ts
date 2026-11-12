import { randomUUID } from 'node:crypto';
import { rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Atomic write of a full file, preserving its mode. */
export async function replaceFile(absolute: string, content: string): Promise<void> {
  const mode = (await stat(absolute)).mode & 0o777;
  const temporary = join(dirname(absolute), `.basedcode-${randomUUID()}`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode });
    await rename(temporary, absolute);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
