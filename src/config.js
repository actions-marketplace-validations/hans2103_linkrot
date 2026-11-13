import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'smol-toml';
import { LinkrotError } from './errors.js';
import { BUILTIN_EXCLUDES } from './defaults.js';

const FORMATS = ['terminal', 'json', 'markdown'];
const CHANNELS = ['github', 'mail'];

async function ghAuthToken() {
  try {
    const { stdout } = await promisify(execFile)('gh', ['auth', 'token']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function readToml(cwd, configPath) {
  const path = configPath ?? join(cwd, '.linkrot.toml');
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && !configPath) return {};
    throw new LinkrotError(`Cannot read config file ${path}: ${err.message}`);
  }
  try {
    return parse(text);
  } catch (err) {
    throw new LinkrotError(`Invalid TOML in ${path}: ${err.message}`);
  }
}

const pick = (...values) => values.find((v) => v !== undefined);

// TOML type checks: a wrong type must fail loudly, never quietly change what is checked.
function check(value, ok, key, expected) {
  if (value !== undefined && !ok(value)) {
    throw new LinkrotError(`Invalid ${key} in .linkrot.toml: expected ${expected}, got ${JSON.stringify(value)}`);
  }
  return value;
}
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const isBoolean = (v) => typeof v === 'boolean';
const isAddress = (v) => typeof v === 'string' && v.trim() !== '';

async function buildReport(channel, toml, env, host, ghToken) {
  if (channel === undefined) return null;
  if (!CHANNELS.includes(channel)) {
    throw new LinkrotError(`Unknown report channel "${channel}" (expected ${CHANNELS.join(' or ')})`);
  }
  if (channel === 'mail') {
    const mail = toml.report?.mail ?? {};
    const to = [mail.to ?? []].flat();
    if (to.length === 0) throw new LinkrotError('Mail report needs "to" in [report.mail]');
    check(to, (list) => list.every(isAddress), '[report.mail] to', 'a non-empty address or a list of them');
    check(mail.always, isBoolean, '[report.mail] always', 'true or false');
    return { channel, to, from: mail.from ?? `linkrot@${host.replace(/^www\./, '')}`, always: mail.always ?? false };
  }
  const gh = toml.report?.github ?? {};
  const repo = gh.repo ?? env.GITHUB_REPOSITORY;
  if (!repo) throw new LinkrotError('GitHub report needs a repo: set [report.github] repo or GITHUB_REPOSITORY');
  const token = env.GITHUB_TOKEN || (await ghToken());
  if (!token) throw new LinkrotError('GitHub report needs a token: set GITHUB_TOKEN or run `gh auth login`');
  return { channel, repo, token, label: gh.label ?? 'linkrot' };
}

export async function loadConfig({ cliArgs = {}, cwd, configPath, env = process.env, ghToken = ghAuthToken }) {
  const toml = await readToml(cwd, configPath);

  const url = pick(cliArgs.url, toml.url);
  if (!url) throw new LinkrotError('No url given: pass a URL or set `url` in .linkrot.toml');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new LinkrotError(`Invalid url "${url}": must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new LinkrotError(`Invalid url "${url}": must be an absolute http(s) URL`);
  }

  const format = pick(cliArgs.format, 'terminal');
  if (!FORMATS.includes(format)) {
    throw new LinkrotError(`Unknown format "${format}" (expected ${FORMATS.join(', ')})`);
  }

  check(toml.crawl, isBoolean, 'crawl', 'true or false');
  check(toml.fail_on_broken, isBoolean, 'fail_on_broken', 'true or false');
  check(toml.max_pages, isPositiveInt, 'max_pages', 'a positive integer');
  check(toml.max_depth, isPositiveInt, 'max_depth', 'a positive integer');
  check(toml.exclude, isStringArray, 'exclude', 'a list of regex strings');
  check(toml.seeds, isStringArray, 'seeds', 'a list of URLs');

  return {
    url,
    crawl: pick(cliArgs.crawl, toml.crawl, false),
    maxPages: pick(cliArgs.maxPages, toml.max_pages, 5000),
    maxDepth: pick(cliArgs.maxDepth, toml.max_depth, 10),
    concurrency: pick(cliArgs.concurrency, 8),
    exclude: [...BUILTIN_EXCLUDES, ...(toml.exclude ?? []), ...(cliArgs.exclude ?? [])],
    seeds: toml.seeds ?? [],
    format,
    failOnBroken: pick(cliArgs.failOnBroken, toml.fail_on_broken, false),
    report: await buildReport(pick(cliArgs.report, toml.report?.channel), toml, env, parsed.hostname, ghToken),
    auth: pick(cliArgs.auth, env.LINKROT_AUTH) ?? null,
    stateDir: join(env.HOME ?? homedir(), '.cache', 'linkrot', parsed.host),
  };
}
