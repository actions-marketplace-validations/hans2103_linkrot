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

async function fetchText(fetchFn, url, userAgent) {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return await new Response(stream).text();
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function discoverSitemapPages(origin, { fetch: fetchFn = fetch, userAgent } = {}) {
  const base = new URL(origin).origin;
  const pages = new Set();
  const seen = new Set();

  async function visit(url, depth) {
    if (depth >= MAX_DEPTH || seen.has(url)) return;
    seen.add(url);
    const text = await fetchText(fetchFn, url, userAgent);
    if (text === null) return;
    const found = locs(text).map((l) => rewriteToOrigin(l, base)).filter(Boolean);
    if (/<sitemapindex[\s>]/i.test(text)) {
      for (const child of found) await visit(child, depth + 1);
    } else {
      for (const page of found) pages.add(page);
    }
  }

  const robots = await fetchText(fetchFn, `${base}/robots.txt`, userAgent);
  const listed = robots
    ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => rewriteToOrigin(m[1], base)).filter(Boolean)
    : [];
  for (const url of listed.length ? listed : [`${base}/sitemap.xml`]) await visit(url, 0);
  return [...pages];
}
