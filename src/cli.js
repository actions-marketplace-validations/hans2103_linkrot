#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { findLychee, checkLinks } from './lychee.js';
import { discoverSitemapPages } from './discover.js';
import { crawl } from './crawl.js';
import { classify } from './classify.js';
import { renderTerminal, renderMarkdown, renderJson } from './report.js';
import { LinkrotError } from './errors.js';
import { VERSION, BUILD_DATE } from './version.js';

const HELP = `Usage: linkrot <url> [options]

Find dead links on a website. Pages come from the sitemap, or from crawling.

Options:
  --auth <user:pass>      Basic auth for the site (or LINKROT_AUTH)
  --crawl                 Follow links even when a sitemap exists
  --max-pages <n>         Stop after n pages (default 5000)
  --max-depth <n>         Maximum crawl depth (default 10)
  --concurrency <n>       Parallel page fetches (default 8)
  --exclude <regex>       Skip URLs matching the regex (repeatable)
  --format <format>       terminal (default), json or markdown
  --report <channel>      Send the result via github or mail instead of stdout
  --fail-on-broken        Exit 1 on broken links even with a report channel
  --config <path>         Config file (default ./.linkrot.toml)
  --quiet                 No progress output
  --version               Print the version
  --help                  Print this help

Exit codes: 0 nothing broken, 1 broken links found, 2 linkrot itself failed.
`;

const OPTIONS = {
  auth: { type: 'string' },
  crawl: { type: 'boolean' },
  'max-pages': { type: 'string' },
  'max-depth': { type: 'string' },
  concurrency: { type: 'string' },
  exclude: { type: 'string', multiple: true },
  format: { type: 'string' },
  report: { type: 'string' },
  'fail-on-broken': { type: 'boolean' },
  config: { type: 'string' },
  quiet: { type: 'boolean' },
  version: { type: 'boolean' },
  help: { type: 'boolean' },
};

const notImplemented = (channel) => async () => {
  throw new LinkrotError(`report channel ${channel} is not implemented yet`);
};

function toInt(name, value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new LinkrotError(`--${name} needs a positive integer, got "${value}"`);
  return n;
}

function parseCli(argv) {
  try {
    return parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    throw new LinkrotError(`${err.message}\nRun linkrot --help for usage.`);
  }
}

function render(summary, format, color) {
  if (format === 'json') return renderJson(summary);
  if (format === 'markdown') return renderMarkdown(summary);
  return renderTerminal(summary, { color });
}

export async function main(argv, env = process.env, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const notifiers = {
    mail: deps.notifyMail ?? notImplemented('mail'),
    github: deps.notifyGithub ?? notImplemented('github'),
  };

  try {
    const { values, positionals } = parseCli(argv);
    if (values.help) {
      stdout.write(HELP);
      return 0;
    }
    if (values.version) {
      stdout.write(`linkrot ${VERSION}${BUILD_DATE ? ` (${BUILD_DATE})` : ''}\n`);
      return 0;
    }
    if (positionals.length > 1) throw new LinkrotError(`Expected one url, got ${positionals.length}`);

    const config = await loadConfig({
      cwd: process.cwd(),
      configPath: values.config,
      env,
      cliArgs: {
        url: positionals[0],
        crawl: values.crawl,
        maxPages: toInt('max-pages', values['max-pages']),
        maxDepth: toInt('max-depth', values['max-depth']),
        concurrency: toInt('concurrency', values.concurrency),
        exclude: values.exclude,
        format: values.format,
        report: values.report,
        failOnBroken: values['fail-on-broken'],
        auth: values.auth,
      },
    });

    const progress = !values.quiet && stderr.isTTY;
    const say = (text) => progress && stderr.write(`\r${text}\x1b[K`);
    const userAgent = `Mozilla/5.0 (compatible; linkrot/${VERSION}; +https://github.com/hans2103/linkrot)`;

    const lychee = await findLychee();
    const headers = config.auth
      ? { authorization: `Basic ${Buffer.from(config.auth).toString('base64')}` }
      : {};

    const startedAt = new Date();
    const t0 = Date.now();

    let sitemapPages = [];
    if (!config.crawl) sitemapPages = await discoverSitemapPages(new URL(config.url).origin, {
        userAgent,
        fetch: (url, options = {}) => fetch(url, { ...options, headers: { ...headers, ...options.headers } }),
      });

    const result = await crawl({
      startUrl: config.url,
      seeds: [...sitemapPages, ...config.seeds],
      follow: config.crawl || sitemapPages.length === 0,
      maxPages: config.maxPages,
      maxDepth: config.maxDepth,
      concurrency: config.concurrency,
      userAgent,
      headers,
      onProgress: (n) => say(`Collecting pages… ${n}`),
    });

    // A failed start fetch is recorded under the start URL with a string status.
    const startStatus = result.pages.get(config.url)?.status;
    if (typeof startStatus === 'string') throw new LinkrotError(`cannot reach ${config.url}: ${startStatus}`);

    const toCheck = [...result.refs.keys()].filter((url) => !result.pages.has(url));
    say(`Checking links… (${toCheck.length})`);
    const checks = await checkLinks(toCheck, {
      lychee: lychee.path,
      cacheDir: config.stateDir,
      userAgent,
      excludes: config.exclude,
      concurrency: 16,
      basicAuth: config.auth ? { origin: result.origin, credentials: config.auth } : undefined,
    });
    if (progress) stderr.write('\r\x1b[K');

    const { broken, doubt, linkCount } = classify(result, checks);
    const summary = {
      site: result.origin,
      startedAt: startedAt.toISOString(),
      durationMs: Date.now() - t0,
      pageCount: result.pages.size,
      linkCount,
      truncated: result.truncated,
      broken,
      doubt,
    };

    if (config.report) {
      const note = await notifiers[config.report.channel](summary, config.report, { stateDir: config.stateDir, env });
      if (note) stderr.write(`${note}\n`);
      return config.failOnBroken && broken.length > 0 ? 1 : 0;
    }

    stdout.write(render(summary, config.format, Boolean(stdout.isTTY)) + '\n');
    return broken.length > 0 ? 1 : 0;
  } catch (err) {
    if (err instanceof LinkrotError) stderr.write(`linkrot: ${err.message}\n`);
    else stderr.write(`${err.stack ?? err}\n`);
    return 2;
  }
}

function isDirectRun() {
  if (import.meta.main === true) return true;
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  // exitCode, not process.exit: piped stdout may still be flushing.
  process.exitCode = await main(process.argv.slice(2), process.env);
}
