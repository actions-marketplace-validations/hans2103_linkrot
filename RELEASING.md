# Releasing linkrot

linkrot uses [semantic versioning](https://semver.org). The release date goes in the release
notes and in `linkrot --version` (`linkrot 0.3.1 (2026-11-13)`), not in the number.

## The contract

These are what users build on. Changing them is what makes a release major.

- CLI options and their meaning
- `.linkrot.toml` keys and their meaning
- Exit codes: `0` nothing broken · `1` broken links found · `2` linkrot failed
- JSON output (`--format json`): field names and meaning
- GitHub Action inputs (`action.yml`)
- Things that live on outside linkrot: the issue label and `<!-- linkrot:<site> -->` marker,
  and the state file in the state directory
- What counts as *broken* versus *doubt* by default

Not part of the contract: the wording and layout of the terminal output, the Markdown report
layout, progress messages.

## Deciding the bump

Ask: **would an existing user's config, cron line, workflow or JSON-reading script behave
differently or fail, without them changing anything?**

| Level | When | Examples |
|---|---|---|
| **major** | yes to the question above | removing or renaming an option, config key, JSON field or Action input; changing an exit code's meaning; a new check that is on by default and can make runs exit `1`; changing the issue marker (would open duplicate issues); raising the minimum lychee version when the installer does not handle it |
| **minor** | new, and existing usage is unaffected | new option, config key or JSON field; a new check that is opt-in or only reports *doubt*; extra built-in excludes that remove false alarms; a new install channel |
| **patch** | behaviour back to what is documented, or no behaviour change | bug fixes, performance, docs, terminal wording, dependency updates |

- **While on 0.x**: what would be major bumps the minor (`0.3.0` → `0.4.0`); everything else is a
  patch. `1.0.0` means: stable, sites may depend on it.
- **In doubt** between two levels: take the higher one and say why in the release notes.
- **Several changes**: the highest level wins.

## Steps

1. `git log vX.Y.Z..HEAD --oneline` and classify each change with the table above.
2. Write the release notes: one line per change, grouped as Breaking / Added / Fixed.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The release workflow builds the
   binaries, smoke-tests the Linux binary and uploads them with `checksums.txt`.
   The `homebrew` job then writes `Formula/linkrot.rb` in
   [`hans2103/homebrew-tap`](https://github.com/hans2103/homebrew-tap) from that `checksums.txt`
   (`.github/scripts/homebrew-formula.sh`) and pushes it as `linkrot X.Y.Z`. It needs the secret
   `HOMEBREW_TAP_TOKEN`: a fine-grained token with *Contents: read and write* on
   `hans2103/homebrew-tap` only. When the token expires the job fails and the release itself
   stays; renew the token, then re-run the failed job. By hand:
   `.github/scripts/homebrew-formula.sh X.Y.Z checksums.txt > Formula/linkrot.rb` in the tap,
   `brew audit --strict hans2103/tap/linkrot`, commit and push.
4. Move the major tag for the Action: `git tag -f vX && git push -f origin vX`.
