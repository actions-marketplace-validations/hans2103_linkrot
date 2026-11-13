import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
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

async function buildReport(channel, toml, env, host, ghToken) {
  if (channel === undefined) return null;
  if (!CHANNELS.includes(channel)) {
    throw new LinkrotError(`Unknown report channel "${channel}" (expected ${CHANNELS.join(' or ')})`);
  }
  if (channel === 'mail') {
    const mail = toml.report?.mail ?? {};
    const to = [mail.to ?? []].flat();
    if (to.length === 0) throw new LinkrotError('Mail report needs "to" in [report.mail]');
    return { channel, to, from: mail.from ?? `linkrot@${host}`, always: mail.always ?? false };
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
    stateDir: join(env.HOME, '.cache', 'linkrot', parsed.host),
  };
}
