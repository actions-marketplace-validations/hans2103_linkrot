const MAX_DEPTH = 3;
const TIMEOUT_MS = 20_000;

function hostKey(url) {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// Same host ignoring a leading "www." and the scheme. Ports must match.
export function sameSite(urlA, urlB) {
  const a = hostKey(urlA);
  return a !== null && a === hostKey(urlB);
}

// Swap scheme and host for those of `origin`; null when the URL is another site.
export function rewriteToOrigin(url, origin) {
  if (!sameSite(url, origin)) return null;
  const u = new URL(url);
  const o = new URL(origin);
  u.protocol = o.protocol;
  u.host = o.host;
  return u.href;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function locs(xml) {
  const out = [];
  for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/loc>/gi)) {
    out.push(decodeEntities((m[1] ?? m[2]).trim()));
  }
  return out;
}

// {status, text}: text is null unless the answer was 2xx; status is the HTTP code, 'timeout' or an error code.
async function fetchText(fetchFn, url, userAgent) {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { status: res.status, text: null };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return { status: res.status, text: await new Response(stream).text() };
    }
    return { status: res.status, text: new TextDecoder().decode(bytes) };
  } catch (err) {
    const status = err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : (err?.cause?.code ?? err?.code ?? 'error');
    return { status, text: null };
  }
}

export async function discoverSitemapPages(origin, { fetch: fetchFn = fetch, userAgent, log = () => {} } = {}) {
  const base = new URL(origin).origin;
  const pages = new Set();
  const seen = new Set();

  async function visit(url, depth) {
    if (depth >= MAX_DEPTH || seen.has(url)) return;
    seen.add(url);
    const { status, text } = await fetchText(fetchFn, url, userAgent);
    if (text === null) {
      log('sitemap', status, url);
      return;
    }
    const found = locs(text).map((l) => rewriteToOrigin(l, base)).filter(Boolean);
    const isIndex = /<sitemapindex[\s>]/i.test(text);
    log('sitemap', status, url, isIndex ? 'index' : `${found.length} pages`);
    if (isIndex) {
      for (const child of found) await visit(child, depth + 1);
    } else {
      for (const page of found) pages.add(page);
    }
  }

  const robotsUrl = `${base}/robots.txt`;
  const { status: robotsStatus, text: robots } = await fetchText(fetchFn, robotsUrl, userAgent);
  const listed = robots
    ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => rewriteToOrigin(m[1], base)).filter(Boolean)
    : [];
  log('robots', robotsStatus, robotsUrl, `${listed.length} sitemaps`);
  for (const url of listed.length ? listed : [`${base}/sitemap.xml`]) await visit(url, 0);
  return [...pages];
}
