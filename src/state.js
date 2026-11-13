import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EMPTY = { fingerprint: null, brokenCount: 0 };

export function fingerprint(broken) {
  if (broken.length === 0) return '';
  const urls = broken.map((f) => f.url).sort();
  return createHash('sha256').update(urls.join('\n')).digest('hex');
}

export async function loadState(dir) {
  try {
    const data = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
    return {
      fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : null,
      brokenCount: Number.isInteger(data.brokenCount) ? data.brokenCount : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveState(dir, state) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
}
