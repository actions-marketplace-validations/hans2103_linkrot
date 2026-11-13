import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import nodemailer from 'nodemailer';
import { renderMarkdown } from '../report.js';
import { loadState, saveState, fingerprint } from '../state.js';
import { LinkrotError } from '../errors.js';

const SMTP_KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS'];

async function readCredentials(home) {
  if (!home) return {};
  let text;
  try {
    text = await readFile(join(home, '.smtp-credentials'), 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && SMTP_KEYS.includes(m[1])) out[m[1]] = m[2];
  }
  return out;
}

/** Nodemailer transport options from env (winning) or ~/.smtp-credentials; sendmail when neither sets a host. */
export async function transportOptions(env) {
  const file = await readCredentials(env.HOME ?? homedir());
  const get = (key) => env[key] || file[key];
  const host = get('SMTP_HOST');
  if (!host) return { sendmail: true, path: '/usr/sbin/sendmail', newline: 'unix' };

  const secure = (get('SMTP_SECURE') || 'tls').toLowerCase();
  if (!['tls', 'ssl', 'none'].includes(secure)) {
    throw new LinkrotError(`SMTP_SECURE must be tls, ssl or none, got "${secure}"`);
  }
  const options = { host, port: Number(get('SMTP_PORT')) || (secure === 'ssl' ? 465 : 587) };
  if (secure === 'ssl') options.secure = true;
  else if (secure === 'tls') Object.assign(options, { secure: false, requireTLS: true });
  else Object.assign(options, { secure: false, ignoreTLS: true });
  if (get('SMTP_USER')) options.auth = { user: get('SMTP_USER'), pass: get('SMTP_PASS') ?? '' };
  return options;
}

function body(summary) {
  return renderMarkdown(summary).replace(/^<!-- linkrot:.*? -->\n/, '');
}

export async function notifyMail(summary, report, { stateDir, env = process.env, transport } = {}) {
  const state = await loadState(stateDir);
  const current = fingerprint(summary.broken);
  const broken = summary.broken.length > 0;

  let message = null;
  let result = 'skipped';
  if (broken && (current !== state.fingerprint || report.always)) {
    message = {
      subject: `linkrot: ${summary.broken.length} broken links on ${summary.site}`,
      text: body(summary),
    };
    result = 'sent';
  } else if (!broken && state.brokenCount > 0) {
    message = {
      subject: `linkrot: ${summary.site} – all links OK again`,
      text: body(summary),
    };
    result = 'recovered';
  }

  if (message) {
    const mailer = transport ?? nodemailer.createTransport(await transportOptions(env));
    await mailer.sendMail({ from: report.from, to: report.to, ...message });
  }
  await saveState(stateDir, { fingerprint: current, brokenCount: summary.broken.length });
  return result;
}
