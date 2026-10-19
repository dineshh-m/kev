#!/usr/bin/env bash
#
# kev installer — https://github.com/dineshh-m/kev
#
# Usage:
#   curl -fsSL https://github.com/dineshh-m/kev/releases/latest/download/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- 0.2.0     # pin a version
#
# Environment overrides:
#   KEV_VERSION           version to install, with or without a leading v
#                         (same as the positional arg)
#   KEV_INSTALL_DIR       install directory (default: ~/.local/bin)
#   KEV_INSTALL_BASE_URL  release download base URL, for mirrors/testing
#                         (default: https://github.com/dineshh-m/kev/releases/download)
set -euo pipefail

REPO="dineshh-m/kev"
INSTALL_DIR="${KEV_INSTALL_DIR:-$HOME/.local/bin}"
BASE_URL="${KEV_INSTALL_BASE_URL:-https://github.com/${REPO}/releases/download}"

say() { printf 'kev-install: %s\n' "$*"; }
die() { printf 'kev-install: error: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"

# --- version -----------------------------------------------------------
# positional arg > KEV_VERSION > latest release from the GitHub API
VERSION="${1:-${KEV_VERSION:-}}"
if [ -z "$VERSION" ]; then
  say "resolving latest release..."
  VERSION="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" |
    sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$VERSION" ] || die "could not resolve the latest release from the GitHub API"
fi
VERSION="${VERSION#v}"

# --- platform ------------------------------------------------------------
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  MINGW* | MSYS* | CYGWIN*)
    die "Windows is not supported by this script; download kev-v${VERSION}-windows-x64.zip from https://github.com/${REPO}/releases/tag/v${VERSION}" ;;
  *) die "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac

if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then
  say "warning: musl detected (Alpine); the release binaries are glibc builds and may not run"
fi

ASSET="kev-v${VERSION}-${os}-${arch}.tar.gz"

# --- download & verify ----------------------------------------------------
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "downloading ${ASSET} from ${BASE_URL}/v${VERSION}/"
curl -fsSL -o "${tmp}/${ASSET}" "${BASE_URL}/v${VERSION}/${ASSET}" ||
  die "download failed: ${BASE_URL}/v${VERSION}/${ASSET}"
curl -fsSL -o "${tmp}/SHA256SUMS" "${BASE_URL}/v${VERSION}/SHA256SUMS" ||
  die "could not download SHA256SUMS"

grep " ${ASSET}\$" "${tmp}/SHA256SUMS" > "${tmp}/SHA256SUMS.asset" ||
  die "${ASSET} is not listed in SHA256SUMS"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && sha256sum -c SHA256SUMS.asset >/dev/null) || die "checksum verification failed"
elif command -v shasum >/dev/null 2>&1; then
  (cd "$tmp" && shasum -a 256 -c SHA256SUMS.asset >/dev/null) || die "checksum verification failed"
elif command -v openssl >/dev/null 2>&1; then
  expected="$(awk '{print $1}' "${tmp}/SHA256SUMS.asset")"
  actual="$(openssl dgst -sha256 "${tmp}/${ASSET}" | awk '{print $NF}')"
  [ "$expected" = "$actual" ] || die "checksum verification failed"
else
  say "warning: no sha256 tool found (sha256sum/shasum/openssl); skipping verification"
fi

# --- install -----------------------------------------------------------------
tar -xzf "${tmp}/${ASSET}" -C "$tmp" kev
mkdir -p "$INSTALL_DIR"
install -m 755 "${tmp}/kev" "${INSTALL_DIR}/kev"

say "installed kev $("${INSTALL_DIR}/kev" --version) to ${INSTALL_DIR}/kev"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    say "note: ${INSTALL_DIR} is not on your PATH; add it with:"
    printf '          export PATH="%s:$PATH"\n' "$INSTALL_DIR"
    ;;
esac

say "configure a provider in ~/.kev/config.json and set your API key (e.g. GROQ_API_KEY);"
say "see https://github.com/${REPO}#provider-configuration"
