import { Parser } from 'htmlparser2';

const MEDIA_TAGS = new Set(['video', 'audio', 'source']);

/**
 * Extract every http(s) link from an HTML document.
 * URLs are absolute, fragment-free and deduplicated (first kind wins).
 */
export function extractLinks(html, pageUrl) {
  const found = new Map();
  let base = pageUrl;

  const add = (raw, kind) => {
    if (!raw || raw.trim().startsWith('#')) return;
    let url;
    try {
      url = new URL(raw.trim(), base);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    const href = url.href;
    if (!found.has(href)) found.set(href, kind);
  };

  const parser = new Parser({
    onopentag(name, attrs) {
      switch (name) {
        case 'base':
          if (attrs.href) {
            try {
              base = new URL(attrs.href.trim(), pageUrl).href;
            } catch {
              // invalid base: keep the page URL
            }
          }
          break;
        case 'a':
        case 'area':
          add(attrs.href, 'a');
          break;
        case 'img':
          add(attrs.src, 'img');
          addSrcset(attrs.srcset);
          break;
        case 'script':
          add(attrs.src, 'script');
          break;
        case 'iframe':
          add(attrs.src, 'iframe');
          break;
        case 'link':
          add(attrs.href, linkKind(attrs));
          break;
        case 'meta':
          if (attrs.property === 'og:url') add(attrs.content, 'og');
          break;
        default:
          if (MEDIA_TAGS.has(name)) {
            add(attrs.src, 'media');
            if (name === 'source') addSrcset(attrs.srcset);
          }
      }
    },
  });

  function addSrcset(srcset) {
    if (!srcset) return;
    for (const candidate of srcset.trim().split(/,\s+/)) {
      add(candidate.trim().split(/\s+/)[0], 'srcset');
    }
  }

  parser.write(html);
  parser.end();
  return [...found].map(([url, kind]) => ({ url, kind }));
}

function linkKind(attrs) {
  const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/);
  if (rels.includes('stylesheet')) return 'stylesheet';
  if (rels.includes('canonical')) return 'canonical';
  if (rels.includes('alternate') && attrs.hreflang) return 'alternate';
  return 'other';
}
