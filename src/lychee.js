import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { LinkrotError } from './errors.js';

const MIN_VERSION = [0, 24, 0];
const MAX_BUFFER = 64 * 1024 * 1024;
const INSTALL_HINT =
  'Install lychee 0.24.0 or newer: brew install lychee, cargo install lychee, or see https://lychee.cli.rs/installation/';

function run(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: MAX_BUFFER, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function versionAtLeast(version, min) {
  const parts = version.split('.').map(Number);
  for (let i = 0; i < min.length; i++) {
    if ((parts[i] ?? 0) !== min[i]) return (parts[i] ?? 0) > min[i];
  }
  return true;
}

async function probe(candidate) {
  try {
    const { stdout } = await run(candidate, ['--version']);
    const match = /(\d+\.\d+\.\d+)/.exec(stdout);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function findLychee() {
  const candidates = [];
  if (process.env.LINKROT_LYCHEE) candidates.push(process.env.LINKROT_LYCHEE);
  else candidates.push('lychee', join(homedir(), '.local', 'bin', 'lychee'));

  for (const candidate of candidates) {
    const version = await probe(candidate);
    if (!version) continue;
    if (!versionAtLeast(version, MIN_VERSION)) {
      throw new LinkrotError(`lychee ${version} (${candidate}) is too old; linkrot needs 0.24.0 or newer. ${INSTALL_HINT}`);
    }
    return { path: candidate, version };
  }
  throw new LinkrotError(`lychee not found. ${INSTALL_HINT}`);
}

const emptyIfNull = (value) => value ?? [];

function normalize(url) {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function entriesOf(map) {
  return Object.values(map ?? {}).flatMap(emptyIfNull);
}

export function parseLycheeJson(json, urls) {
  const failed = new Map();
  const dropped = new Set();
  const remember = (target, url, value) => {
    target.set(url, value);
    target.set(normalize(url), value);
  };

  for (const entry of entriesOf(json.error_map)) {
    remember(failed, entry.url, {
      ok: false,
      code: entry.status?.code ?? null,
      text: entry.status?.text ?? '',
      timeout: false,
    });
  }
  for (const entry of entriesOf(json.timeout_map)) {
    remember(failed, entry.url, {
      ok: false,
      code: entry.status?.code ?? null,
      text: entry.status?.text ?? 'Timeout',
      timeout: true,
    });
  }
  for (const entry of entriesOf(json.excluded_map)) {
    dropped.add(entry.url);
    dropped.add(normalize(entry.url));
  }

  const results = new Map();
  for (const url of urls) {
    const hit = failed.get(url) ?? failed.get(normalize(url));
    if (hit) results.set(url, hit);
    else if (dropped.has(url) || dropped.has(normalize(url))) continue;
    else results.set(url, { ok: true, code: null, text: '', timeout: false });
  }
  return results;
}

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One anchor per URL: lychee's plaintext extractor strips trailing . , ) ! * from URLs, its HTML extractor does not.
export function linkListHtml(urls) {
  return urls.map((url) => `<a href="${escapeHtml(url)}"></a>`).join('\n') + '\n';
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// basicAuth: {origin, credentials: 'user:pass'}; lychee scopes it to URLs matching the regex.
export function buildLycheeArgs(listFile, { userAgent, excludes, concurrency = 16, basicAuth }) {
  return [
    '--format', 'json',
    '--no-progress',
    '--scheme', 'https',
    '--scheme', 'http',
    '--timeout', '10',
    '--max-retries', '1',
    '--max-concurrency', String(concurrency),
    '--cache',
    '--max-cache-age', '1d',
    // Only successes are cached: a failure is checked again on the next run.
    '--cache-exclude-status', '400..',
    '--user-agent', userAgent,
    ...excludes.flatMap((pattern) => ['--exclude', pattern]),
    ...(basicAuth ? ['--basic-auth', `^${escapeRegex(basicAuth.origin)}(/|$) ${basicAuth.credentials}`] : []),
    listFile,
  ];
}

export async function checkLinks(urls, { lychee, cacheDir, userAgent, excludes, concurrency = 16, basicAuth }) {
  if (urls.length === 0) return new Map();
  mkdirSync(cacheDir, { recursive: true });
  const workDir = mkdtempSync(join(tmpdir(), 'linkrot-'));
  const listFile = join(workDir, 'urls.html');
  writeFileSync(listFile, linkListHtml(urls));

  const args = buildLycheeArgs(listFile, { userAgent, excludes, concurrency, basicAuth });

  try {
    let stdout;
    try {
      ({ stdout } = await run(lychee, args, { cwd: cacheDir }));
    } catch (err) {
      // Exit code 2 means "link errors found": the JSON report is still on stdout.
      if (err.code !== 2) {
        throw new LinkrotError(`lychee failed (exit ${err.code ?? 'unknown'}): ${(err.stderr || err.message).trim()}`);
      }
      stdout = err.stdout;
    }
    let json;
    try {
      json = JSON.parse(stdout);
    } catch {
      throw new LinkrotError(`lychee produced unreadable output: ${String(stdout).slice(0, 200)}`);
    }
    return parseLycheeJson(json, urls);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
