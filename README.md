# linkrot

[![Test](https://github.com/hans2103/linkrot/actions/workflows/test.yml/badge.svg)](https://github.com/hans2103/linkrot/actions/workflows/test.yml)
[![Release](https://img.shields.io/github/v/release/hans2103/linkrot)](https://github.com/hans2103/linkrot/releases/latest)

Find dead links on a website from the command line, after a launch and on a schedule.

linkrot collects every page of a site (from the sitemap, or by crawling), checks every link,
image, script and stylesheet, and lists each broken link **once**, with the pages it appears on.
Periodic runs report through a GitHub issue or by mail, and stay quiet when nothing is broken.

```
$ linkrot https://example.com
✖ 404  https://example.com/contact-us
    on /
    on /about
    on /blog/
    … and 1 more page
✖ 404  https://example.com/img/old-photo.jpg
    on /blog/first-post
✖ 404  https://example.com/team.pdf
    on /about

4 pages · 8 links · 3 broken · 0 doubtful · 0.4s
```

The checking itself is done by [lychee](https://github.com/lycheeverse/lychee). linkrot adds what
lychee leaves out: it finds the pages, groups the results per broken link, filters known false
alarms, and reports without repeating itself.

## Install

```sh
# macOS or Linux, with Homebrew (installs lychee too)
brew install hans2103/tap/linkrot

# servers: no root, no Node; puts linkrot and lychee in ~/.local/bin
curl -fsSL https://raw.githubusercontent.com/hans2103/linkrot/main/install.sh | sh
```

`install.sh` verifies checksums and tells you if `~/.local/bin` is not on your `PATH` (change the
directory with `LINKROT_BIN`). On macOS it leaves lychee to Homebrew. For GitHub Actions, see
[Run on a schedule](#run-on-a-schedule).

## Quick start

```sh
linkrot https://example.com                                  # check the whole site
linkrot https://example.com --crawl                          # follow links too, not only the sitemap
linkrot https://staging.example.com --auth user:secret       # site behind basic auth (or LINKROT_AUTH)
linkrot https://example.com --exclude '^https://shop\.'      # skip URLs matching a regex (repeatable)
linkrot https://example.com --format json | jq '.broken[].url'   # machine-readable, e.g. for CI
linkrot https://example.com --format markdown > links.md     # a report to share
linkrot https://example.com -v                               # log every page and link (stderr)
```

Exit code `0` means nothing is broken, `1` means broken links were found, `2` means linkrot itself
could not do its job. See [Exit codes](#exit-codes).

A link that works in your browser but shows up as broken usually blocks bots. Exclude it with
`--exclude`; well-known cases are already handled (see [What linkrot skips](#what-linkrot-skips)).

## Run on a schedule

linkrot reports only when something is broken, updates that report instead of sending a new one,
and says once when everything is fine again.

### GitHub Action: one issue per site

In the site's repository, `.github/workflows/links.yml`:

```yaml
name: Links
on:
  schedule:
    - cron: '0 6 * * 1' # Mondays at 06:00 UTC
  workflow_dispatch:

permissions:
  issues: write

jobs:
  linkrot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # so .linkrot.toml is available
      - uses: hans2103/linkrot@v0
        with:
          url: https://example.com
```

Broken links open one issue (label `linkrot`) and keep it up to date; when everything is fine
again, the issue is closed with a note. The run itself stays green. The Action runs on Ubuntu
runners and picks up `.linkrot.toml` from the repository root.

| Input | Default | |
|---|---|---|
| `url` | required | Site to check |
| `report` | `github` | `github` or `mail`; empty prints the report to the log |
| `args` | | Extra arguments, e.g. `--crawl --max-pages 2000` |

`@v0` follows the latest 0.x release.

### Cron with mail

On a server, after `install.sh`:

```cron
0 6 * * 1 ~/.local/bin/linkrot https://example.com --report mail --quiet --config ~/linkrot/example.com.linkrot.toml
```

with `~/linkrot/example.com.linkrot.toml`:

```toml
[report.mail]
to = ["me@example.com"]
```

- Mail goes out when the set of broken links changes, plus one "all links OK again" mail.
  Nothing changed means no mail.
- With a report channel linkrot prints nothing and exits `0`; `--quiet` also drops its one-line
  note, so cron itself sends no mail.
- Cron runs from `$HOME`, so pass the site's file with `--config`.

SMTP settings come from the environment, or from `KEY=value` lines in `~/.smtp-credentials`.
Without them linkrot uses `/usr/sbin/sendmail`.

| Variable | Example | |
|---|---|---|
| `SMTP_HOST` | `smtp.example.com` | |
| `SMTP_PORT` | `587` | default 587, or 465 with `ssl` |
| `SMTP_SECURE` | `tls` | `tls` (STARTTLS), `ssl` or `none` |
| `SMTP_USER` | `linkrot@example.com` | |
| `SMTP_PASS` | `…` | |

### Cron with a GitHub issue

Same as above with `--report github` and `[report.github] repo = "owner/name"` in the config.
Set `GITHUB_TOKEN` to a fine-grained token with **Issues: Read and write** on that repository.

## Options

```
linkrot <url> [options]

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
  -q, --quiet             No progress output and no report note
  -v, --verbose           Log every page, sitemap and link checked (stderr)
  -V, --version           Print the version
  -h, --help              Print this help
```

## Configuration: `.linkrot.toml`

linkrot reads `.linkrot.toml` from the current directory, or the file given with `--config`.
Command-line options win over the file. Every key is optional; a value of the wrong type stops
linkrot with exit `2` instead of being ignored.

```toml
url = "https://example.com"        # used when no URL is given on the command line
crawl = false                      # follow links even when a sitemap exists
max_pages = 5000                   # stop after this many pages and say so
max_depth = 10
exclude = ["^https://example\\.org/private/"]   # regexes, added to the built-in ones
seeds = ["https://example.com/hidden-start/"]   # extra start pages
fail_on_broken = false             # exit 1 on broken links even with a report channel

[report]
channel = "mail"                   # "github" or "mail"; leave out to print

[report.mail]
to = ["me@example.com"]            # string or list; required for mail
from = "linkrot@example.com"       # default: linkrot@<site host, without www.>
always = false                     # mail on every run, not only when the broken set changed

[report.github]
repo = "owner/name"                # default: $GITHUB_REPOSITORY
label = "linkrot"                  # default: linkrot
```

GitHub reports need `GITHUB_TOKEN` (set automatically in the Action), or a logged-in `gh`.
Credentials never go in this file: use `--auth` / `LINKROT_AUTH` and the SMTP variables.

## What linkrot skips

Built in, so you don't get false alarms:

- **Never checked:**
  - `mailto:`, `tel:`, `webcal:`, `javascript:` and `data:` links;
  - resource hints: `<link rel>` with `preconnect`, `dns-prefetch`, `prefetch`, `prerender` or
    `pingback` (`https://fonts.gstatic.com/` answers 404 at its root);
  - "add to calendar" links on `outlook.live.com/calendar/` and `outlook.office.com/calendar/`
    (they refuse bots);
  - anything matching `--exclude` / `exclude`, both external links and the site's own pages.
- **Never reported:** `<link rel="canonical">`, `<link rel="alternate" hreflang>` and `og:url`, so
  a test site that points to production raises no alarms.
- **Doubt, not broken:** status 403, 429 or 999 from `linkedin.com`, `facebook.com`,
  `instagram.com`, `x.com` and `twitter.com` (and subdomains), any 429, and any timeout. Doubt is
  listed separately and never changes the exit code.
- **Links that redirect off-site** count as external: linkrot checks them, but does not read the
  other site's pages.

How it works:

- **Pages:** sitemap first (`robots.txt`, then `/sitemap.xml`, following indexes); without a
  sitemap, or with `--crawl`, linkrot follows the site's own links from the start URL, up to
  `max_pages` and `max_depth`.
- **Checking:** lychee with a 10 s timeout, one retry and 16 requests at a time. Good results are
  cached for a day; failures are always checked again, so a fix shows up on the next run.
  User agent: `Mozilla/5.0 (compatible; linkrot/<version>; +https://github.com/hans2103/linkrot)`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Nothing broken (doubt never counts) |
| `1` | Broken links found |
| `2` | linkrot could not do its job: site unreachable or answering 5xx, lychee missing or older than 0.24, invalid config |

With a report channel (`--report` or `[report] channel`), broken links give exit `0` and nothing
on stdout, unless `--fail-on-broken` is set. Failures of linkrot itself always exit `2` with a
message on stderr.

## Seeing what it does: `-v`

`-v` / `--verbose` writes one plain line per step to stderr; stdout and the exit code stay the
same. Lines look like `<kind>  <status>  <url>  <detail>`, with kinds `robots`, `sitemap`, `page`,
`skip`, `link` and `done`. `page` and `sitemap` lines appear while pages are fetched; `link` lines
appear once all links have been checked.

```
robots   200   https://example.com/robots.txt  1 sitemaps
sitemap  200   https://example.com/sitemap.xml  4 pages
page     200   https://example.com/  start
link     404   https://example.com/team.pdf  broken  on 1 page
done     —     4 pages · 8 links · 3 broken · 0 doubtful · 0.4s
```

The log is long, so filter it. `2>&1 >/dev/null` sends the log into the pipe and drops the report:

```sh
# only problems: broken or doubtful
linkrot https://example.com -v 2>&1 >/dev/null | grep -E '  (broken|doubt)( |$)'

# everything except what went fine or was skipped on purpose
linkrot https://example.com -v 2>&1 >/dev/null | grep -vE '^(skip|page +200|link +ok)'

# count per kind and status
linkrot https://example.com -v 2>&1 >/dev/null | awk '{print $1, $2}' | sort | uniq -c

# which external domains the site links to
linkrot https://example.com -v 2>&1 >/dev/null | awk '$1=="link"{print $3}' | awk -F/ '{print $3}' | sort | uniq -c | sort -rn
```

`--quiet` does not silence `--verbose`.

## Troubleshooting

| You see | What it means |
|---|---|
| `lychee not found` or `too old` | Install or upgrade lychee: `brew install lychee`, or re-run `install.sh`. linkrot also looks in `~/.local/bin`, so cron's short `PATH` is fine. |
| `site unreachable` (exit 2) | The start URL gave a network error or a 5xx. Check the URL, or try again when the site is back. |
| A link works in the browser but is reported | The server blocks bots. Add it to `exclude`. |
| No mail arrives | Mail is only sent when the broken set changes. Use `always = true` to test, check the SMTP variables, and look at the note on stderr (run without `--quiet`). |
| No issue is opened | The workflow needs `permissions: issues: write`; outside Actions, `GITHUB_TOKEN` needs Issues: Read and write. |
| Fewer pages than expected | The sitemap is incomplete: add `--crawl`. Or `max_pages` was reached: the summary says so. |

## Development

```sh
npm ci
npm test        # needs lychee 0.24 or newer on PATH
node src/cli.js https://example.com
```

Releases: see [RELEASING.md](RELEASING.md). Design notes (Dutch):
[docs/superpowers/specs/2026-11-13-linkrot-design.md](docs/superpowers/specs/2026-11-13-linkrot-design.md).

## License

MIT
