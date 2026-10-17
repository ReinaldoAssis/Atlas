#!/usr/bin/env bash
# Build local do Atlas para macOS (arm64).
#
# Uso:
#   tools/build-macos.sh                  # versão do tauri.conf.json
#   tools/build-macos.sh --version 0.3.0  # versão da tag (nome do .dmg)
#
# Saída:
#   src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Atlas.app
#   src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Atlas_<versão>_aarch64.dmg
#
# Build **não assinado**: em outra máquina o Gatekeeper bloqueia. Para abrir:
#   xattr -dr com.apple.quarantine /Applications/Atlas.app
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-macos: só roda no macOS." >&2
  exit 1
fi

VERSION=""
TARGET="aarch64-apple-darwin"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:?use --version X.Y.Z}"
      shift 2
      ;;
    --help | -h)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      echo "argumento desconhecido: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -n "$VERSION" && ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "build-macos: versão inválida (use X.Y.Z): $VERSION" >&2
  exit 2
fi

echo "==> Atlas para macOS ($TARGET${VERSION:+, versão $VERSION})"
if [[ -n "$VERSION" ]]; then
  npx tauri build --target "$TARGET" --config "{\"version\":\"$VERSION\"}"
else
  npx tauri build --target "$TARGET"
fi

BUNDLE="src-tauri/target/$TARGET/release/bundle"
APP="$(ls -d "$BUNDLE"/macos/*.app 2>/dev/null | head -1 || true)"
DMG="$(ls "$BUNDLE"/dmg/*.dmg 2>/dev/null | head -1 || true)"

if [[ -z "$APP" ]]; then
  echo "build-macos: o build não gerou .app em $BUNDLE/macos" >&2
  exit 1
fi

echo
echo "Artefatos:"
ls -ldh "$APP"
if [[ -n "$DMG" ]]; then
  ls -lh "$DMG"
else
  echo "build-macos: aviso: nenhum .dmg em $BUNDLE/dmg" >&2
fi
