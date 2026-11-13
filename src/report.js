import { styleText } from 'node:util';

const MAX_PAGES_SHOWN = 3;
const NO_PAGE = '(no page links here; listed in sitemap or start page)';

function siteHost(site) {
  try {
    return new URL(site.includes('://') ? site : `https://${site}`).host;
  } catch {
    return site;
  }
}

function pageLabel(page, host) {
  try {
    const u = new URL(page);
    return u.host === host ? u.pathname + u.search : page;
  } catch {
    return page;
  }
}

function status(f, doubt) {
  if (f.code !== null) return String(f.code);
  return doubt ? 'timeout' : 'ERR';
}

function summaryLine(s) {
  const secs = (s.durationMs / 1000).toFixed(1);
  let line =
    `${s.pageCount} pages · ${s.linkCount} links · ${s.broken.length} broken · ` +
    `${s.doubt.length} doubtful · ${secs}s`;
  if (s.truncated) line += ' · stopped at max pages';
  return line;
}

export function renderTerminal(s, { color = false } = {}) {
  const paint = (format, text) => (color ? styleText(format, text, { validateStream: false }) : text);
  const host = siteHost(s.site);
  const out = [];

  const block = (f, mark, format, isDoubt) => {
    const tail = f.code === null ? ` ${f.text}` : '';
    out.push(`${paint(format, `${mark} ${status(f, isDoubt)}`)}  ${f.url}${tail}`);
    if (f.pages.length === 0) {
      out.push(`    on ${NO_PAGE}`);
      return;
    }
    for (const p of f.pages.slice(0, MAX_PAGES_SHOWN)) out.push(paint('dim', `    on ${pageLabel(p, host)}`));
    const more = f.pages.length - MAX_PAGES_SHOWN;
    if (more > 0) out.push(paint('dim', `    … and ${more} more ${more === 1 ? 'page' : 'pages'}`));
  };

  if (s.broken.length === 0) out.push(paint('green', 'No broken links'));
  for (const f of s.broken) block(f, '✖', 'red', false);

  if (s.doubt.length > 0) {
    out.push('', paint('yellow', 'Doubt'));
    for (const f of s.doubt) block(f, '?', 'yellow', true);
  }

  out.push('', summaryLine(s));
  return out.join('\n');
}

export function renderMarkdown(s) {
  const host = siteHost(s.site);
  const out = [`<!-- linkrot:${s.site} -->`, `# linkrot: ${s.site}`, '', `Checked ${s.startedAt.slice(0, 10)}.`, ''];

  const list = (findings, mark, isDoubt) => {
    for (const f of findings) {
      const tail = f.code === null ? ` (${f.text})` : '';
      out.push(`- ${mark} ${status(f, isDoubt)} ${f.url}${tail}`);
      if (f.pages.length === 0) out.push(`  - on ${NO_PAGE}`);
      for (const p of f.pages) out.push(`  - on ${pageLabel(p, host)}`);
    }
  };

  if (s.broken.length === 0) out.push('No broken links');
  list(s.broken, '✖', false);
  if (s.doubt.length > 0) {
    out.push('', '## Doubt', '');
    list(s.doubt, '?', true);
  }
  out.push('', summaryLine(s), '');
  return out.join('\n');
}

export function renderJson(s) {
  return JSON.stringify(s, null, 2);
}
