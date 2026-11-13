# linkrot

Find dead links on a website from the command line, after a launch and on a schedule.

`linkrot https://example.com` collects every page (from the sitemap, or by crawling), checks every
link, image, script and stylesheet with [lychee](https://github.com/lycheeverse/lychee), and lists
each broken link once, with the pages it appears on. Periodic runs report through a GitHub issue
or by mail, and stay quiet when nothing is broken.

```
$ linkrot https://example.com
```

## Install and run

### Homebrew (macOS)

```sh
brew install hans2103/tap/linkrot
```

This installs lychee as a dependency. (The tap `hans2103/homebrew-tap` is not published yet; use
`install.sh` until it is.)

### install.sh (servers, no root, no Node)

```sh
curl -fsSL https://raw.githubusercontent.com/hans2103/linkrot/main/install.sh | sh
```

This puts the `linkrot` binary and lychee in `~/.local/bin` (override with `LINKROT_BIN`),
verifies their checksums, and tells you if that directory is not on your `PATH`. On macOS it
leaves lychee to Homebrew (`brew install lychee`).

Run it from cron, for example every Monday at 06:00 with the result sent by mail:

```cron
0 6 * * 1 ~/.local/bin/linkrot https://example.com --report mail
```

With a report channel set, linkrot prints nothing and exits 0 when it finds broken links, so cron
sends no extra mail. Mail needs a `[report.mail]` section in `.linkrot.toml` (see below) and SMTP
settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`tls`, `ssl` or `none`), `SMTP_USER` and
`SMTP_PASS`, from the environment or from `KEY=value` lines in `~/.smtp-credentials`. Without
SMTP settings it falls back to `/usr/sbin/sendmail`.

### GitHub Action

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
      - uses: hans2103/linkrot@v0
        with:
          url: https://example.com
```

Broken links open one issue (label `linkrot`) and keep it up to date; when everything is fine
again, the issue is closed with a note. The run itself stays green.

| Input | Default | |
|---|---|---|
| `url` | required | Site to check |
| `report` | `github` | Report channel; empty prints to the log |
| `args` | | Extra arguments, e.g. `--crawl --max-pages 2000` |

`.linkrot.toml` in the repository root is picked up automatically.

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
  --quiet                 No progress output
  --version               Print the version
  --help                  Print this help
```

## Configuration: `.linkrot.toml`

linkrot reads `.linkrot.toml` from the current directory (or the file given with `--config`).
Command-line options win over the file. Every key is optional.

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
from = "linkrot@example.com"       # default: linkrot@<site host>
always = false                     # mail on every run, not only when the broken set changed

[report.github]
repo = "owner/name"                # default: $GITHUB_REPOSITORY
label = "linkrot"                  # default: linkrot
```

GitHub reports need `GITHUB_TOKEN` (set automatically in the Action), or a logged-in `gh`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Nothing broken (doubt never counts) |
| `1` | Broken links found |
| `2` | linkrot itself failed: site unreachable, lychee missing or older than 0.24, invalid config |

With a report channel (`--report` or `[report] channel`), broken links give exit `0` and nothing
on stdout, unless `--fail-on-broken` is set. Tool failures still exit `2` with a message on stderr.

## Built-in defaults

- **Never checked:** `mailto:`, `tel:`, `webcal:`, `javascript:` and `data:` links, and
  `https://outlook.live.com/calendar/` and `https://outlook.office.com/calendar/` (these refuse bots).
- **Doubt, not broken:** status 403, 429 or 999 from `linkedin.com`, `facebook.com`,
  `instagram.com`, `x.com` and `twitter.com` (and their subdomains), any 429, and any timeout.
  Doubt is listed separately and never changes the exit code.
- **Never reported:** `<link rel="canonical">`, `<link rel="alternate" hreflang>` and `og:url`,
  so a test site that points to production does not raise alarms.
- **lychee:** timeout 10 s, one retry, 16 concurrent requests, one-day cache, user agent
  `Mozilla/5.0 (compatible; linkrot/<version>; +https://github.com/hans2103/linkrot)`.
  Minimum version 0.24.0.
- **Crawling:** sitemap first (`robots.txt`, then `/sitemap.xml`, following indexes); otherwise
  linkrot crawls internal links from the start URL, never beyond `max_pages`.

## Releases

See [RELEASING.md](RELEASING.md). Design notes (Dutch) are in
[docs/superpowers/specs/2026-11-13-linkrot-design.md](docs/superpowers/specs/2026-11-13-linkrot-design.md).

## License

MIT
