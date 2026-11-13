#!/bin/sh
# Install linkrot and lychee into ${LINKROT_BIN:-$HOME/.local/bin}. No root needed.
#   curl -fsSL https://raw.githubusercontent.com/hans2103/linkrot/main/install.sh | sh
#
# Overrides (mainly for testing):
#   LINKROT_BIN              install directory
#   LINKROT_BASE_URL         where linkrot assets and checksums.txt are downloaded from
#   LINKROT_LYCHEE_BASE_URL  where lychee release assets are downloaded from
set -eu

LYCHEE_VERSION=0.24.2
BIN_DIR=${LINKROT_BIN:-$HOME/.local/bin}
BASE_URL=${LINKROT_BASE_URL:-https://github.com/hans2103/linkrot/releases/latest/download}
LYCHEE_BASE_URL=${LINKROT_LYCHEE_BASE_URL:-https://github.com/lycheeverse/lychee/releases/download/lychee-v$LYCHEE_VERSION}

die() {
  echo "linkrot install: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) die "unsupported OS: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

asset="linkrot-$os-$arch"
case "$asset" in
  linkrot-darwin-arm64 | linkrot-darwin-x64 | linkrot-linux-x64) ;;
  *) die "no linkrot build for $os $arch" ;;
esac

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

# verify <file> <expected hash> <label>
verify() {
  actual=$(sha256_of "$1")
  [ "$actual" = "$2" ] || die "checksum mismatch for $3 (expected $2, got $actual)"
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

mkdir -p "$BIN_DIR"

echo "Downloading $asset ..."
curl -fsSL "$BASE_URL/$asset" -o "$tmp/$asset"
curl -fsSL "$BASE_URL/checksums.txt" -o "$tmp/checksums.txt"
expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$tmp/checksums.txt")
[ -n "$expected" ] || die "$asset not listed in checksums.txt"
verify "$tmp/$asset" "$expected" "$asset"
chmod +x "$tmp/$asset"
mv "$tmp/$asset" "$BIN_DIR/linkrot"
echo "Installed $BIN_DIR/linkrot"

# lychee: a Linux release binary is downloaded; on macOS brew provides it.
if [ "$os" = linux ]; then
  case "$arch" in
    x64) target=x86_64-unknown-linux-gnu ;;
    arm64) target=aarch64-unknown-linux-gnu ;;
  esac
  lychee_asset="lychee-$target.tar.gz"
  echo "Downloading lychee $LYCHEE_VERSION ..."
  curl -fsSL "$LYCHEE_BASE_URL/$lychee_asset" -o "$tmp/$lychee_asset"
  curl -fsSL "$LYCHEE_BASE_URL/$lychee_asset.sha256" -o "$tmp/$lychee_asset.sha256"
  expected=$(cut -d ' ' -f 1 "$tmp/$lychee_asset.sha256")
  verify "$tmp/$lychee_asset" "$expected" "$lychee_asset"
  mkdir "$tmp/lychee"
  tar -xzf "$tmp/$lychee_asset" -C "$tmp/lychee"
  mv "$tmp/lychee/lychee-$target/lychee" "$BIN_DIR/lychee"
  chmod +x "$BIN_DIR/lychee"
  echo "Installed $BIN_DIR/lychee"
elif ! command -v lychee >/dev/null 2>&1; then
  echo "lychee is not installed. Run: brew install lychee"
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    echo "$BIN_DIR is not on your PATH. Add this line to your shell profile:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac
