import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
    const notifyMail = async (summary) => (sent.push(summary), 'mail sent');
    const config = tomlWithMail();
    const a = await run([server.url, '--config', config], { notifyMail });
    assert.equal(a.code, 0);
    assert.equal(a.out, '');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].broken.length, 2);

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
