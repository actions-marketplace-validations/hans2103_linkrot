# linkrot

Find dead links on a website from the command line, after a launch and on a schedule.

`linkrot https://example.com` collects every page (sitemap, or by crawling), checks every link,
image, script and stylesheet with [lychee](https://github.com/lycheeverse/lychee), and lists each
broken link once with the pages it appears on. Periodic runs report through a GitHub issue or by
mail, and stay quiet when nothing is broken.

> Work in progress. See [the design](docs/superpowers/specs/2026-11-13-linkrot-design.md) (Dutch).

## License

MIT
