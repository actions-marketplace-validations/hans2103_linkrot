import { DOUBT_HOSTS, NEVER_REPORT_KINDS } from './defaults.js';

const DOUBT_CODES = new Set([403, 429, 999]);

function isDoubtHost(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return DOUBT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function isDoubt(url, code, timeout) {
  if (timeout) return true;
  if (code === 429) return true;
  return DOUBT_CODES.has(code) && isDoubtHost(url);
}

/**
 * Split crawl and lychee results into broken and doubtful links.
 * URLs matching a RegExp in `exclude` are neither findings nor counted.
 * Returns {broken, doubt, linkCount}; findings are {url, code, text, pages}.
 */
export function classify(crawl, checks, { exclude = [] } = {}) {
  const excluded = (url) => exclude.some((re) => re.test(url));

  // Reportable referrers per URL.
  const referrers = new Map();
  for (const [url, refs] of crawl.refs) {
    if (excluded(url)) continue;
    const pages = new Set();
    for (const { page, kind } of refs) {
      if (!NEVER_REPORT_KINDS.includes(kind)) pages.add(page);
    }
    if (pages.size > 0) referrers.set(url, [...pages].sort());
  }

  const broken = [];
  const doubt = [];
  const add = (url, code, text, timeout) => {
    if (excluded(url)) return;
    const finding = { url, code, text, pages: referrers.get(url) ?? [] };
    (isDoubt(url, code, timeout) ? doubt : broken).push(finding);
  };

  for (const [url, { status }] of crawl.pages) {
    if (typeof status === 'string') {
      add(url, null, status, status === 'timeout');
    } else if (status >= 400) {
      add(url, status, `HTTP ${status}`, false);
    }
  }

  for (const [url, result] of checks) {
    if (crawl.pages.has(url) || result.ok || !referrers.has(url)) continue;
    add(url, result.code, result.text, result.timeout);
  }

  const order = (a, b) => b.pages.length - a.pages.length || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  broken.sort(order);
  doubt.sort(order);
  return { broken, doubt, linkCount: referrers.size };
}
