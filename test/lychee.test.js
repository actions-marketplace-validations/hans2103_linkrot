import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLychee, checkLinks, parseLycheeJson } from '../src/lychee.js';
import { LinkrotError } from '../src/errors.js';
import { startServer } from './helpers/server.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/lychee-output.json', import.meta.url), 'utf8'));

let hasLychee = true;
try {
  execFileSync('lychee', ['--version'], { stdio: 'ignore' });
} catch {
  hasLychee = false;
}

test('parseLycheeJson maps errors, timeouts, successes and drops excluded', () => {
  const urls = [
    'https://ok.example.org/',
    'https://x.example.org/bestaat-niet',
    'http://10.255.255.1/slow',
    'https://outlook.live.com/calendar/x',
  ];
  const map = parseLycheeJson(fixture, urls);
  assert.deepEqual([...map.keys()], urls.slice(0, 3));
  assert.deepEqual(map.get(urls[0]), { ok: true, code: null, text: '', timeout: false });
  assert.deepEqual(map.get(urls[1]), {
    ok: false,
    code: 404,
    text: 'Rejected status code: 404 Not Found',
    timeout: false,
  });
  assert.deepEqual(map.get(urls[2]), { ok: false, code: null, text: 'Timeout', timeout: true });
  assert.equal(map.has(urls[3]), false);
});

function fakeLychee(output) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-lychee-'));
  const path = join(dir, 'lychee');
  writeFileSync(path, `#!/bin/sh\necho "${output}"\n`);
  chmodSync(path, 0o755);
  return path;
}

async function withEnv(value, fn) {
  const old = process.env.LINKROT_LYCHEE;
  process.env.LINKROT_LYCHEE = value;
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.LINKROT_LYCHEE;
    else process.env.LINKROT_LYCHEE = old;
  }
}

test('findLychee rejects a version older than 0.24.0', async () => {
  await withEnv(fakeLychee('lychee 0.23.0'), async () => {
    await assert.rejects(findLychee(), (err) => err instanceof LinkrotError && /0\.24/.test(err.message));
  });
});

test('findLychee accepts a fake 0.24.1', async () => {
  const path = fakeLychee('lychee 0.24.1');
  await withEnv(path, async () => {
    assert.deepEqual(await findLychee(), { path, version: '0.24.1' });
  });
});

test('findLychee throws an install hint when the binary is missing', async () => {
  await withEnv('/nonexistent/lychee', async () => {
    await assert.rejects(findLychee(), (err) => err instanceof LinkrotError && /brew install lychee/.test(err.message));
  });
});

test('checkLinks runs real lychee against a local server', { skip: !hasLychee }, async () => {
  const server = await startServer({ '/ok': { body: 'ok' } });
  try {
    const { path } = await findLychee();
    const cacheDir = mkdtempSync(join(tmpdir(), 'linkrot-cache-'));
    const good = `${server.url}/ok`;
    const bad = `${server.url}/missing`;
    const map = await checkLinks([good, bad], {
      lychee: path,
      cacheDir,
      userAgent: 'linkrot-test',
      excludes: [],
    });
    assert.equal(map.get(good).ok, true);
    assert.equal(map.get(bad).ok, false);
    assert.equal(map.get(bad).code, 404);
  } finally {
    await server.close();
  }
});
