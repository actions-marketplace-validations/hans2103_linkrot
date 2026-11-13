import { extractLinks } from './extract.js';
import { rewriteToOrigin } from './discover.js';

const TIMEOUT_MS = 20_000;
const FILE_EXT = /\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|pdf|zip|xml|ics|mp3|mp4)$/i;

function looksLikePage(url) {
  const { pathname } = new URL(url);
  return !pathname.includes('/media/') && !FILE_EXT.test(pathname);
}

function failureStatus(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  return err?.cause?.code ?? err?.code ?? 'error';
}

export async function crawl({
  startUrl,
  seeds = [],
  follow,
  maxPages,
  maxDepth,
  concurrency,
  userAgent,
  headers = {},
  onProgress,
}) {
  const pages = new Map();
  const refs = new Map();
  let origin = new URL(startUrl).origin;
  let truncated = false;

  const queue = [];
  const queued = new Set();
  function enqueue(url, depth) {
    if (queued.has(url)) return;
    queued.add(url);
    queue.push({ url, depth });
  }

  function addRef(url, page, kind) {
    const list = refs.get(url) ?? [];
    if (list.some((r) => r.page === page && r.kind === kind)) return;
    list.push({ page, kind });
    refs.set(url, list);
  }

  async function fetchPage(url) {
    return fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...headers, 'user-agent': userAgent, accept: 'text/html' },
    });
  }

  // The start URL first: its redirected origin becomes the site.
  let startResult = null;
  try {
    const res = await fetchPage(startUrl);
    origin = new URL(res.url).origin;
    startResult = { url: res.url, res };
  } catch (err) {
    pages.set(startUrl, { status: failureStatus(err) });
  }

  async function process(url, depth, preFetched) {
    let res;
    try {
      res = preFetched ?? (await fetchPage(url));
    } catch (err) {
      pages.set(url, { status: failureStatus(err) });
      return;
    }
    pages.set(url, { status: res.status });
    const isHtml = (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
    if (res.status < 200 || res.status >= 300 || !isHtml) {
      await res.body?.cancel().catch(() => {});
      return;
    }
    let html;
    try {
      html = await res.text();
    } catch (err) {
      pages.set(url, { status: failureStatus(err) });
      return;
    }
    for (const link of extractLinks(html, res.url)) {
      const internal = rewriteToOrigin(link.url, origin);
      const target = internal ?? link.url;
      addRef(target, url, link.kind);
      if (follow && internal && depth < maxDepth && (link.kind === 'a' || link.kind === 'iframe') && looksLikePage(internal)) {
        enqueue(internal, depth + 1);
      }
    }
  }

  if (startResult) {
    queued.add(startResult.url);
  } else {
    queued.add(startUrl);
  }
  for (const seed of seeds) {
    const url = rewriteToOrigin(seed, origin);
    if (url) enqueue(url, 0);
  }

  // The start page is processed up front, outside the pool, so its links are queued first.
  if (startResult) {
    await process(startResult.url, 0, startResult.res);
    onProgress?.(pages.size);
  }

  let active = 0;
  let wake = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  async function worker() {
    for (;;) {
      if (queue.length === 0) {
        if (active === 0) return;
        await new Promise((resolve) => {
          const prev = wake;
          wake = () => {
            prev?.();
            resolve();
          };
        });
        continue;
      }
      if (pages.size + active >= maxPages) {
        truncated = true;
        queue.length = 0;
        notify();
        continue;
      }
      const { url, depth } = queue.shift();
      active++;
      try {
        await process(url, depth);
      } finally {
        active--;
        onProgress?.(pages.size);
        notify();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { origin, pages, refs, truncated };
}
