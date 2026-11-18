import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { main } from '../src/cli.js';
import { startServer } from './helpers/server.js';

let hasLychee = true;
try {
  execFileSync('lychee', ['--version'], { stdio: 'ignore' });
} catch {
  hasLychee = false;
}

function sink() {
  let text = '';
  return { write: (chunk) => ((text += chunk), true), isTTY: false, get text() { return text; } };
}

async function run(args, deps = {}, envExtra = {}) {
  const home = mkdtempSync(join(tmpdir(), 'linkrot-home-'));
  const stdout = sink();
  const stderr = sink();
  const code = await main(args, { HOME: home, ...envExtra }, { stdout, stderr, ...deps });
  return { code, out: stdout.text, err: stderr.text };
}

async function brokenSite() {
  let base = '';
  const routes = {};
  const server = await startServer(routes);
  base = server.url;
  routes['/sitemap.xml'] = {
    type: 'application/xml',
    body: `<urlset><url><loc>${base}/</loc></url><url><loc>${base}/about</loc></url></urlset>`,
  };
  routes['/'] = {
    body: `<html><head><link rel="canonical" href="https://other.example/"></head><body>
      <a href="/about">About</a> <a href="/gone">Gone</a>
      <img src="/missing.png">
      <a href="https://outlook.live.com/calendar/0/deeplink/compose?x=1">Agenda</a></body></html>`,
  };
  routes['/about'] = { body: '<html><body><a href="/">Home</a></body></html>' };
  return server;
}

function tomlWithMail() {
  const dir = mkdtempSync(join(tmpdir(), 'linkrot-conf-'));
  const path = join(dir, '.linkrot.toml');
  writeFileSync(path, '[report]\nchannel = "mail"\n[report.mail]\nto = ["a@example.org"]\n');
  return path;
}

test('--help exits 0 and prints usage', async () => {
  const { code, out } = await run(['--help']);
  assert.equal(code, 0);
  assert.match(out, /Usage: linkrot/);
});

test('--version prints the version', async () => {
  const { code, out } = await run(['--version']);
  assert.equal(code, 0);
  assert.match(out, /^linkrot \S+/);
});

test('broken links give exit 1 and exactly the two broken URLs on stdout', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const { code, out } = await run([server.url]);
    assert.equal(code, 1);
    assert.ok(out.includes(`${server.url}/gone`), out);
    assert.ok(out.includes(`${server.url}/missing.png`), out);
    assert.ok(!out.includes('outlook.live.com'), out);
    assert.ok(!out.includes('other.example'), out);
  } finally {
    await server.close();
  }
});

test('--format json parses', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const { code, out } = await run([server.url, '--format', 'json']);
    assert.equal(code, 1);
    const summary = JSON.parse(out);
    assert.deepEqual(summary.broken.map((b) => b.url).sort(), [`${server.url}/gone`, `${server.url}/missing.png`].sort());
    assert.equal(summary.pageCount, 2);
  } finally {
    await server.close();
  }
});

test('a report channel keeps stdout empty and exits 0; --fail-on-broken exits 1', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const sent = [];
    const notifyMail = async (summary, report, opts) => (sent.push({ summary, report, opts }), 'mail sent');
    const config = tomlWithMail();
    const a = await run([server.url, '--config', config], { notifyMail });
    assert.equal(a.code, 0);
    assert.equal(a.out, '');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].summary.broken.length, 2);
    assert.equal(sent[0].report.channel, 'mail');
    assert.deepEqual(sent[0].report.to, ['a@example.org']);
    assert.match(sent[0].opts.stateDir, /linkrot/);
    assert.equal(typeof sent[0].opts.env.HOME, 'string');
    assert.match(a.err, /mail sent/);

    const b = await run([server.url, '--config', config, '--fail-on-broken'], { notifyMail });
    assert.equal(b.code, 1);
  } finally {
    await server.close();
  }
});

test('an unreachable start URL exits 2 with a message', { skip: !hasLychee }, async () => {
  const server = await startServer({});
  const url = server.url;
  await server.close();
  const { code, err } = await run([url]);
  assert.equal(code, 2);
  assert.match(err, /cannot reach/);
});

test('--auth sends a Basic header on page fetches', { skip: !hasLychee }, async () => {
  const auths = [];
  const server = createServer((req, res) => {
    auths.push(req.headers.authorization);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>hi</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { code } = await run([`http://127.0.0.1:${server.address().port}`, '--auth', 'u:p']);
    assert.equal(code, 0);
    assert.ok(auths.length > 0);
    assert.ok(auths.every((a) => a === `Basic ${Buffer.from('u:p').toString('base64')}`), auths.join());
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('large piped JSON output is not truncated', { skip: !hasLychee }, async () => {
  const routes = {};
  const server = await startServer(routes);
  const links = Array.from({ length: 2500 }, (_, i) => `<a href="/missing-page-with-a-long-name-${i}">x</a>`).join('\n');
  routes['/'] = { body: `<html><body>${links}</body></html>` };
  try {
    const home = mkdtempSync(join(tmpdir(), 'linkrot-home-'));
    const cli = new URL('../src/cli.js', import.meta.url).pathname;
    const { code, stdout } = await new Promise((resolve) => {
      execFile(process.execPath, [cli, server.url, '--format', 'json'], { env: { ...process.env, HOME: home }, maxBuffer: 64 * 1024 * 1024 },
        (error, out) => resolve({ code: error?.code ?? 0, stdout: out }));
    });
    assert.equal(code, 1);
    assert.ok(stdout.length > 200 * 1024, `only ${stdout.length} bytes`);
    assert.equal(JSON.parse(stdout).broken.length, 2500);
  } finally {
    await server.close();
  }
});

test('--quiet suppresses the notifier note on stderr; without it the note is shown', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const notifyMail = async () => 'mail sent to a@example.org';
    const config = tomlWithMail();
    const quiet = await run([server.url, '--config', config, '--quiet'], { notifyMail });
    assert.equal(quiet.code, 0);
    assert.equal(quiet.out, '');
    assert.equal(quiet.err, '');
    const loud = await run([server.url, '--config', config], { notifyMail });
    assert.equal(loud.code, 0);
    assert.match(loud.err, /mail sent to a@example\.org/);
  } finally {
    await server.close();
  }
});

test('--crawl --exclude keeps an excluded 404 page out of the report', { skip: !hasLychee }, async () => {
  const server = await startServer({ '/': { body: '<html><body><a href="/gone">Gone</a></body></html>' } });
  try {
    const { code, out } = await run([server.url, '--crawl', '--exclude', '/gone', '--format', 'json']);
    assert.equal(code, 0, out);
    assert.deepEqual(JSON.parse(out).broken, []);
    assert.ok(!server.hits.includes('/gone'), server.hits.join());
  } finally {
    await server.close();
  }
});

test('an invalid --exclude regex exits 2', async () => {
  const { code, err } = await run(['https://example.com', '--exclude', '(']);
  assert.equal(code, 2);
  assert.match(err, /exclude/i);
});

test('a start page answering HTTP 5xx exits 2: site unreachable', { skip: !hasLychee }, async () => {
  const server = await startServer({ '/': { status: 503, body: 'down' } });
  try {
    const { code, out, err } = await run([server.url]);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /site unreachable: .*503/);
  } finally {
    await server.close();
  }
});

test('-h prints usage with short options and exits 0', async () => {
  const { code, out } = await run(['-h']);
  assert.equal(code, 0);
  assert.match(out, /Usage: linkrot/);
  assert.match(out, /-v, --verbose/);
  assert.match(out, /-h, --help/);
});

test('-V prints the version', async () => {
  const { code, out } = await run(['-V']);
  assert.equal(code, 0);
  assert.match(out, /^linkrot \S+/);
});

test('no url prints usage on stderr and exits 2', async () => {
  const { code, out, err } = await run([]);
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.match(err, /No url given/);
  assert.match(err, /Usage: linkrot/);
});

test('--verbose logs every step to stderr and leaves stdout unchanged', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const plain = await run([server.url]);
    const verbose = await run([server.url, '-v']);
    assert.equal(verbose.code, 1);
    assert.equal(verbose.out.replace(/· [\d.]+s/, ''), plain.out.replace(/· [\d.]+s/, ''));
    assert.match(verbose.err, /^robots {3}404 {3}\S+\/robots\.txt {2}0 sitemaps$/m);
    assert.match(verbose.err, /^sitemap {2}200 {3}\S+\/sitemap\.xml {2}2 pages$/m);
    assert.match(verbose.err, /^page {5}200 {3}\S+\/about {2}sitemap$/m);
    assert.match(verbose.err, /^link {5}404 {3}\S+\/gone {2}broken {2}on 1 page$/m);
    assert.match(verbose.err, /^link {5}404 {3}\S+\/missing\.png {2}broken/m);
    assert.match(verbose.err, /^skip {5}skip {2}https:\/\/outlook\.live\.com\S* {2}excluded$/m);
    assert.match(verbose.err, /^done .* pages · /m);
    assert.ok(!verbose.err.includes('\x1b'), 'no ANSI');
    assert.ok(!verbose.err.includes('\r'), 'no carriage return');
  } finally {
    await server.close();
  }
});

test('--quiet does not silence --verbose', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const { err } = await run([server.url, '-q', '-v']);
    assert.match(err, /^page /m);
  } finally {
    await server.close();
  }
});

test('--verbose with --crawl logs followed pages with referrer and depth skips', { skip: !hasLychee }, async () => {
  const server = await brokenSite();
  try {
    const { err } = await run([server.url, '--crawl', '--max-depth', '1', '-v']);
    assert.match(err, /^page {5}404 {3}\S+\/gone {2}from \/$/m);
    assert.match(err, /^link {5}404 {3}\S+\/gone {2}broken/m);
  } finally {
    await server.close();
  }
});

test('stripRuntimeArgs drops BUN_OPTIONS flags that a compiled binary leaks into argv', async () => {
  const { stripRuntimeArgs } = await import('../src/cli.js');
  assert.deepEqual(stripRuntimeArgs(['--smol', 'https://example.com', '-v'], '--smol'), ['https://example.com', '-v']);
  assert.deepEqual(stripRuntimeArgs(['https://example.com'], '--smol'), ['https://example.com']);
  assert.deepEqual(stripRuntimeArgs(['--crawl', 'https://example.com'], ''), ['--crawl', 'https://example.com']);
  assert.deepEqual(stripRuntimeArgs(['--smol', '--crawl', 'x'], '--smol --inspect'), ['--crawl', 'x']);
});
