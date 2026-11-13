import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { LinkrotError } from '../src/errors.js';
import { BUILTIN_EXCLUDES } from '../src/defaults.js';

async function dirWith(toml) {
  const dir = await mkdtemp(join(tmpdir(), 'linkrot-cfg-'));
  if (toml !== undefined) await writeFile(join(dir, '.linkrot.toml'), toml);
  return dir;
}
const env = (extra = {}) => ({ HOME: '/home/u', ...extra });

test('defaults when only a url is given', async () => {
  const cwd = await dirWith();
  const c = await loadConfig({ cliArgs: { url: 'https://example.com/' }, cwd, env: env() });
  assert.deepEqual(c, {
    url: 'https://example.com/', crawl: false, maxPages: 5000, maxDepth: 10, concurrency: 8,
    exclude: BUILTIN_EXCLUDES, seeds: [], format: 'terminal', failOnBroken: false,
    report: null, auth: null, stateDir: '/home/u/.cache/linkrot/example.com',
  });
});

test('TOML overrides defaults, CLI overrides TOML', async () => {
  const cwd = await dirWith(`url = "https://toml.example/"
crawl = true
max_pages = 100
max_depth = 3
seeds = ["https://toml.example/a"]
fail_on_broken = true
exclude = ["^https://skip\\\\."]
`);
  const fromToml = await loadConfig({ cliArgs: {}, cwd, env: env() });
  assert.equal(fromToml.url, 'https://toml.example/');
  assert.equal(fromToml.crawl, true);
  assert.equal(fromToml.maxPages, 100);
  assert.equal(fromToml.maxDepth, 3);
  assert.equal(fromToml.failOnBroken, true);
  assert.deepEqual(fromToml.seeds, ['https://toml.example/a']);

  const cli = await loadConfig({
    cliArgs: { url: 'https://cli.example/', crawl: false, maxPages: 7, maxDepth: 1, concurrency: 2, format: 'json', failOnBroken: false },
    cwd, env: env(),
  });
  assert.equal(cli.url, 'https://cli.example/');
  assert.equal(cli.crawl, false);
  assert.equal(cli.maxPages, 7);
  assert.equal(cli.maxDepth, 1);
  assert.equal(cli.concurrency, 2);
  assert.equal(cli.format, 'json');
  assert.equal(cli.failOnBroken, false);
  assert.equal(cli.stateDir, '/home/u/.cache/linkrot/cli.example');
});

test('exclude: built-ins first, then TOML, then CLI', async () => {
  const cwd = await dirWith('url = "https://a.example/"\nexclude = ["toml"]\n');
  const c = await loadConfig({ cliArgs: { exclude: ['cli1', 'cli2'] }, cwd, env: env() });
  assert.deepEqual(c.exclude, [...BUILTIN_EXCLUDES, 'toml', 'cli1', 'cli2']);
});

test('--config path is used; missing explicit path is an error; missing default is fine', async () => {
  const dir = await dirWith();
  const p = join(dir, 'custom.toml');
  await writeFile(p, 'url = "https://custom.example/"\n');
  const c = await loadConfig({ cliArgs: {}, cwd: dir, configPath: p, env: env() });
  assert.equal(c.url, 'https://custom.example/');
  await assert.rejects(loadConfig({ cliArgs: {}, cwd: dir, configPath: join(dir, 'nope.toml'), env: env() }), LinkrotError);
});

test('invalid TOML, missing url, relative or non-http url are LinkrotErrors', async () => {
  await assert.rejects(loadConfig({ cliArgs: {}, cwd: await dirWith('url = = ='), env: env() }), LinkrotError);
  await assert.rejects(loadConfig({ cliArgs: {}, cwd: await dirWith(), env: env() }), /url/i);
  for (const url of ['example.com', '/x', 'ftp://example.com/']) {
    await assert.rejects(loadConfig({ cliArgs: { url }, cwd: await dirWith(), env: env() }), LinkrotError);
  }
});

test('invalid format is a LinkrotError', async () => {
  await assert.rejects(
    loadConfig({ cliArgs: { url: 'https://a.example/', format: 'xml' }, cwd: await dirWith(), env: env() }),
    LinkrotError);
});

test('unknown report channel is a LinkrotError (CLI and TOML)', async () => {
  await assert.rejects(
    loadConfig({ cliArgs: { url: 'https://a.example/', report: 'slack' }, cwd: await dirWith(), env: env() }),
    /channel/i);
  const cwd = await dirWith('url = "https://a.example/"\n[report]\nchannel = "slack"\n');
  await assert.rejects(loadConfig({ cliArgs: {}, cwd, env: env() }), LinkrotError);
});

test('github report: repo from TOML, token from GITHUB_TOKEN, default label', async () => {
  const cwd = await dirWith('url = "https://a.example/"\n[report]\nchannel = "github"\n[report.github]\nrepo = "o/r"\nlabel = "dead"\n');
  const c = await loadConfig({
    cliArgs: {}, cwd, env: env({ GITHUB_TOKEN: 'tok' }),
    ghToken: async () => { throw new Error('must not be called'); },
  });
  assert.deepEqual(c.report, { channel: 'github', repo: 'o/r', token: 'tok', label: 'dead' });
  const d = await loadConfig({ cliArgs: { url: 'https://a.example/', report: 'github' }, cwd: await dirWith(),
    env: env({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'x/y' }) });
  assert.deepEqual(d.report, { channel: 'github', repo: 'x/y', token: 't', label: 'linkrot' });
});

test('github report: GITHUB_REPOSITORY fallback, TOML repo wins over it', async () => {
  const cwd = await dirWith('url = "https://a.example/"\n[report]\nchannel = "github"\n[report.github]\nrepo = "o/r"\n');
  const c = await loadConfig({ cliArgs: {}, cwd, env: env({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'x/y' }) });
  assert.equal(c.report.repo, 'o/r');
});

test('github report: token falls back to gh, no token or no repo is an error', async () => {
  const cwd = await dirWith();
  const base = { cliArgs: { url: 'https://a.example/', report: 'github' }, cwd };
  const c = await loadConfig({ ...base, env: env({ GITHUB_REPOSITORY: 'x/y' }), ghToken: async () => 'from-gh' });
  assert.equal(c.report.token, 'from-gh');
  await assert.rejects(loadConfig({ ...base, env: env({ GITHUB_REPOSITORY: 'x/y' }), ghToken: async () => null }), /token/i);
  await assert.rejects(loadConfig({ ...base, env: env({ GITHUB_TOKEN: 't' }) }), /repo/i);
});

test('ghToken is not called without a github channel', async () => {
  const c = await loadConfig({ cliArgs: { url: 'https://a.example/' }, cwd: await dirWith(), env: env(),
    ghToken: async () => { throw new Error('must not be called'); } });
  assert.equal(c.report, null);
});

test('mail report: to as string or array, from default, always', async () => {
  const one = await dirWith('url = "https://www.a.example/"\n[report]\nchannel = "mail"\n[report.mail]\nto = "a@b.nl"\n');
  const c = await loadConfig({ cliArgs: {}, cwd: one, env: env() });
  assert.deepEqual(c.report, { channel: 'mail', to: ['a@b.nl'], from: 'linkrot@a.example', always: false });
  const many = await dirWith('url = "https://a.example/"\n[report.mail]\nto = ["a@b.nl", "c@d.nl"]\nfrom = "me@a.example"\nalways = true\n');
  const d = await loadConfig({ cliArgs: { report: 'mail' }, cwd: many, env: env() });
  assert.deepEqual(d.report, { channel: 'mail', to: ['a@b.nl', 'c@d.nl'], from: 'me@a.example', always: true });
});

test('mail report without to is an error; CLI channel overrides TOML channel', async () => {
  await assert.rejects(
    loadConfig({ cliArgs: { url: 'https://a.example/', report: 'mail' }, cwd: await dirWith(), env: env() }), /to/);
  const cwd = await dirWith('url = "https://a.example/"\n[report]\nchannel = "github"\n[report.mail]\nto = "a@b.nl"\n');
  const c = await loadConfig({ cliArgs: { report: 'mail' }, cwd, env: env() });
  assert.equal(c.report.channel, 'mail');
});

test('auth: CLI beats LINKROT_AUTH, default null', async () => {
  const cwd = await dirWith();
  const u = { url: 'https://a.example/' };
  assert.equal((await loadConfig({ cliArgs: { ...u, auth: 'a:b' }, cwd, env: env({ LINKROT_AUTH: 'c:d' }) })).auth, 'a:b');
  assert.equal((await loadConfig({ cliArgs: u, cwd, env: env({ LINKROT_AUTH: 'c:d' }) })).auth, 'c:d');
  assert.equal((await loadConfig({ cliArgs: u, cwd, env: env() })).auth, null);
});

const invalid = async (toml, pattern) => {
  const cwd = await dirWith(`url = "https://a.example/"\n${toml}`);
  await assert.rejects(loadConfig({ cliArgs: {}, cwd, env: env() }), (err) => err instanceof LinkrotError && pattern.test(err.message));
};

test('exclude and seeds must be arrays of strings', async () => {
  await invalid('exclude = "foo"\n', /exclude/);
  await invalid('exclude = ["ok", 3]\n', /exclude/);
  await invalid('seeds = "https://a.example/x"\n', /seeds/);
  await invalid('seeds = [1]\n', /seeds/);
});

test('max_pages and max_depth must be positive integers', async () => {
  await invalid('max_pages = 0\n', /max_pages/);
  await invalid('max_pages = "10"\n', /max_pages/);
  await invalid('max_depth = 1.5\n', /max_depth/);
  await invalid('max_depth = -1\n', /max_depth/);
});

test('crawl, fail_on_broken and [report.mail] always must be booleans', async () => {
  await invalid('crawl = "yes"\n', /crawl/);
  await invalid('fail_on_broken = 1\n', /fail_on_broken/);
  await invalid('[report]\nchannel = "mail"\n[report.mail]\nto = "a@b.nl"\nalways = "true"\n', /always/);
});

test('[report.mail] to entries must be non-empty strings', async () => {
  await invalid('[report]\nchannel = "mail"\n[report.mail]\nto = ""\n', /to/);
  await invalid('[report]\nchannel = "mail"\n[report.mail]\nto = ["a@b.nl", 5]\n', /to/);
  await invalid('[report]\nchannel = "mail"\n[report.mail]\nto = 5\n', /to/);
});

test('valid typed values are accepted', async () => {
  const cwd = await dirWith('url = "https://a.example/"\ncrawl = true\nfail_on_broken = false\nmax_pages = 10\nmax_depth = 2\nexclude = ["x"]\nseeds = ["https://a.example/s"]\n');
  const c = await loadConfig({ cliArgs: {}, cwd, env: env() });
  assert.equal(c.crawl, true);
  assert.equal(c.maxPages, 10);
  assert.equal(c.maxDepth, 2);
  assert.deepEqual(c.seeds, ['https://a.example/s']);
  assert.equal(c.exclude.at(-1), 'x');
});

test('stateDir falls back to the OS home directory when HOME is unset', async () => {
  const c = await loadConfig({ cliArgs: { url: 'https://a.example/' }, cwd: await dirWith(), env: {} });
  assert.equal(c.stateDir, join(homedir(), '.cache', 'linkrot', 'a.example'));
});
