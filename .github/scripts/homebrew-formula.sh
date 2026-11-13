#!/bin/sh
# Print the Homebrew formula for a linkrot release.
#   .github/scripts/homebrew-formula.sh 0.2.0 checksums.txt > Formula/linkrot.rb
set -eu

version=${1:?usage: homebrew-formula.sh VERSION CHECKSUMS_FILE}
checksums=${2:?usage: homebrew-formula.sh VERSION CHECKSUMS_FILE}

case "$version" in
  *[!0-9.]* | '' ) echo "homebrew-formula: not a version: $version" >&2; exit 1 ;;
esac

sha() {
  hash=$(awk -v f="linkrot-$1" '$2 == f { print $1 }' "$checksums")
  case "$hash" in
    [0-9a-f]*) [ ${#hash} -eq 64 ] && { echo "$hash"; return; } ;;
  esac
  echo "homebrew-formula: no sha256 for linkrot-$1 in $checksums" >&2
  exit 1
}

darwin_arm64=$(sha darwin-arm64)
darwin_x64=$(sha darwin-x64)
linux_x64=$(sha linux-x64)
base=https://github.com/hans2103/linkrot/releases/download/v$version

cat <<RUBY
class Linkrot < Formula
  desc "Find dead links on a website from the command-line"
  homepage "https://github.com/hans2103/linkrot"
  license "MIT"

  depends_on "lychee"

  on_macos do
    on_arm do
      url "$base/linkrot-darwin-arm64"
      sha256 "$darwin_arm64"
    end
    on_intel do
      url "$base/linkrot-darwin-x64"
      sha256 "$darwin_x64"
    end
  end

  on_linux do
    on_intel do
      url "$base/linkrot-linux-x64"
      sha256 "$linux_x64"
    end
  end

  def install
    bin.install Dir["linkrot-*"].first => "linkrot"
  end

  test do
    assert_match "linkrot #{version}", shell_output("#{bin}/linkrot --version")
  end
end
RUBY
