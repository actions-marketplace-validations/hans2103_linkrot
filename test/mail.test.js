import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { notifyMail, transportOptions } from '../src/notify/mail.js';
import { loadState, fingerprint } from '../src/state.js';

const finding = (url) => ({ url, code: 404, text: 'Not Found', pages: ['https://example.com/'] });
const summary = (urls) => ({
  site: 'https://example.com',
  startedAt: '2026-11-13T08:00:00.000Z',
  durationMs: 1000,
  pageCount: 3,
  linkCount: 9,
  truncated: false,
  broken: urls.map(finding),
  doubt: [],
});
const report = (over = {}) => ({ channel: 'mail', to: ['a@example.org', 'b@example.org'], from: 'linkrot@example.org', always: false, ...over });

function setup() {
  const stateDir = join(mkdtempSync(join(tmpdir(), 'linkrot-mail-')), 'nested', 'state');
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent = [];
  const original = transport.sendMail.bind(transport);
  transport.sendMail = async (msg) => (sent.push(msg), original(msg));
  const run = (urls, over) => notifyMail(summary(urls), report(over), { stateDir, env: {}, transport });
  return { stateDir, sent, run };
}

test('fingerprint: sorted, order independent, empty for none', () => {
  assert.equal(fingerprint([]), '');
  assert.equal(fingerprint([finding('https://b/'), finding('https://a/')]), fingerprint([finding('https://a/'), finding('https://b/')]));
  assert.notEqual(fingerprint([finding('https://a/')]), fingerprint([finding('https://b/')]));
});

test('first broken run sends; identical second run is skipped', async () => {
  const { run, sent, stateDir } = setup();
  assert.equal(await run(['https://x/a']), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'linkrot: 1 broken links on https://example.com');
  assert.deepEqual(sent[0].to, ['a@example.org', 'b@example.org']);
  assert.equal(sent[0].from, 'linkrot@example.org');
  assert.ok(!sent[0].text.includes('<!-- linkrot:'));
  assert.match(sent[0].text, /https:\/\/x\/a/);
  assert.deepEqual(await loadState(stateDir), { fingerprint: fingerprint([finding('https://x/a')]), brokenCount: 1 });
  assert.equal(await run(['https://x/a']), 'skipped');
  assert.equal(sent.length, 1);
});

test('changed set sends again', async () => {
  const { run, sent } = setup();
  await run(['https://x/a']);
  assert.equal(await run(['https://x/a', 'https://x/b']), 'sent');
  assert.equal(sent.length, 2);
});

test('always sends even when unchanged', async () => {
  const { run, sent } = setup();
  await run(['https://x/a']);
  assert.equal(await run(['https://x/a'], { always: true }), 'sent');
  assert.equal(sent.length, 2);
});

test('empty after non-empty sends one recovery mail, then skips', async () => {
  const { run, sent } = setup();
  await run(['https://x/a']);
  assert.equal(await run([]), 'recovered');
  assert.equal(sent[1].subject, 'linkrot: https://example.com – all links OK again');
  assert.equal(await run([]), 'skipped');
  assert.equal(sent.length, 2);
});

test('empty after empty (and on a fresh state) is skipped', async () => {
  const { run, sent } = setup();
  assert.equal(await run([]), 'skipped');
  assert.equal(await run([]), 'skipped');
  assert.equal(sent.length, 0);
});

test('state is not saved when sending fails', async () => {
  const { stateDir } = setup();
  const transport = { sendMail: async () => { throw new Error('smtp down'); } };
  await assert.rejects(notifyMail(summary(['https://x/a']), report(), { stateDir, env: {}, transport }), /smtp down/);
  assert.equal((await loadState(stateDir)).fingerprint, null);
});

function home(content) {
  const dir = mkdtempSync(join(tmpdir(), 'linkrot-home-'));
  if (content !== undefined) writeFileSync(join(dir, '.smtp-credentials'), content);
  return dir;
}
const creds = (secure) =>
  `# comment\nSMTP_HOST=mail.example.org\nSMTP_PORT=587\nSMTP_SECURE=${secure}\nSMTP_USER=me\nSMTP_PASS=p=ss\n`;

test('credentials file: tls -> STARTTLS', async () => {
  const o = await transportOptions({ HOME: home(creds('tls')) });
  assert.deepEqual(o, { host: 'mail.example.org', port: 587, secure: false, requireTLS: true, auth: { user: 'me', pass: 'p=ss' } });
});

test('credentials file: ssl -> implicit TLS', async () => {
  const o = await transportOptions({ HOME: home(creds('ssl')) });
  assert.deepEqual(o, { host: 'mail.example.org', port: 587, secure: true, auth: { user: 'me', pass: 'p=ss' } });
});

test('credentials file: none -> plain', async () => {
  const o = await transportOptions({ HOME: home(creds('none')) });
  assert.deepEqual(o, { host: 'mail.example.org', port: 587, secure: false, ignoreTLS: true, auth: { user: 'me', pass: 'p=ss' } });
});

test('env vars win over the credentials file', async () => {
  const o = await transportOptions({ HOME: home(creds('tls')), SMTP_HOST: 'other.example.org', SMTP_SECURE: 'ssl' });
  assert.equal(o.host, 'other.example.org');
  assert.equal(o.secure, true);
  assert.equal(o.port, 587);
});

test('no SMTP config falls back to sendmail', async () => {
  assert.deepEqual(await transportOptions({ HOME: home() }), { sendmail: true, path: '/usr/sbin/sendmail', newline: 'unix' });
});
