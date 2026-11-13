import { renderMarkdown } from '../report.js';
import { LinkrotError } from '../errors.js';

const MAX_BODY = 65536;
const CUT_BELOW = 65000;
const TRUNCATION_NOTE = '\n\n… report truncated; run linkrot locally for the full list.';

function fit(markdown) {
  if (markdown.length <= MAX_BODY) return markdown;
  const cut = markdown.lastIndexOf('\n', CUT_BELOW - 1);
  return markdown.slice(0, cut === -1 ? CUT_BELOW : cut) + TRUNCATION_NOTE;
}

/**
 * Keeps one GitHub issue per site up to date: open issue with the report label whose body
 * carries the `<!-- linkrot:<site> -->` marker. Resolves to `{status, url}` where status is
 * 'created', 'updated', 'closed' or 'noop'.
 */
export async function notifyGithub(summary, report, { fetch: doFetch = globalThis.fetch, apiUrl = 'https://api.github.com' } = {}) {
  const label = report.label || 'linkrot';
  const base = `${apiUrl.replace(/\/+$/, '')}/repos/${report.repo}`;
  const headers = {
    Authorization: `Bearer ${report.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'linkrot',
    'Content-Type': 'application/json',
  };

  async function call(method, path, payload) {
    const res = await doFetch(`${base}${path}`, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
    if (res.ok) return { status: res.status, data: await res.json().catch(() => ({})) };
    let message = res.statusText;
    try {
      message = (await res.json()).message || message;
    } catch {}
    return { status: res.status, error: new LinkrotError(`GitHub ${method} ${path} failed: ${res.status} ${message}`) };
  }
  async function ok(method, path, payload) {
    const r = await call(method, path, payload);
    if (r.error) throw r.error;
    return r.data;
  }

  const marker = renderMarkdown(summary).split('\n', 1)[0];
  const markdown = renderMarkdown(summary);
  const body = fit(markdown);

  const list = await ok('GET', `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
  // The issues endpoint also lists pull requests; those never count.
  const existing = list.find((i) => !i.pull_request && typeof i.body === 'string' && i.body.includes(marker));

  if (summary.broken.length > 0) {
    if (!existing) {
      const payload = { title: `Broken links on ${summary.site}`, body, labels: [label] };
      let r = await call('POST', '/issues', payload);
      if (r.error && (r.status === 404 || r.status === 422)) {
        // Most likely the label does not exist yet: create it and try once more.
        await ok('POST', '/labels', { name: label, color: 'b60205' });
        r = await call('POST', '/issues', payload);
      }
      if (r.error) throw r.error;
      return { status: 'created', url: r.data.html_url };
    }
    if (existing.body === body) return { status: 'noop', url: existing.html_url };
    await ok('PATCH', `/issues/${existing.number}`, { body });
    return { status: 'updated', url: existing.html_url };
  }

  if (!existing) return { status: 'noop', url: undefined };
  await ok('POST', `/issues/${existing.number}/comments`, { body: `All links OK again (${summary.startedAt.slice(0, 10)}).` });
  await ok('PATCH', `/issues/${existing.number}`, { state: 'closed', state_reason: 'completed' });
  return { status: 'closed', url: existing.html_url };
}
