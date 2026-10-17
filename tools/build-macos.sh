#!/usr/bin/env bash
# Build local do Atlas para macOS (arm64).
#
# Uso:
#   tools/build-macos.sh                  # build local (versão do tauri.conf.json)
#   tools/build-macos.sh --version 0.3.1  # build + upload do .dmg no release v0.3.1
#   tools/build-macos.sh --version 0.3.1 --no-upload
#
# Saída:
#   src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Atlas.app
#   src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Atlas_<versão>_aarch64.dmg
#
# Build **não assinado**: em outra máquina o Gatekeeper bloqueia. Para abrir:
#   xattr -dr com.apple.quarantine /Applications/Atlas.app
#
# O upload usa o `gh` autenticado e exige que o release da tag já exista
# (espere o workflow `Release` da tag terminar). Rode manualmente.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-macos: só roda no macOS." >&2
  exit 1
fi

# Um DMG que falhou no meio deixa o volume montado e o próximo `hdiutil`
# trava ("resource busy"). Ejeta só volumes que vieram do nosso bundle.
while read -r device; do
  [[ -n "$device" ]] && diskutil eject "$device" >/dev/null 2>&1 || true
done < <(hdiutil info | awk '
  /^image-path/ { image = $0 }
  /^\/dev\/disk/ { device = $1 }
  /^\/Volumes\// { if (image ~ /Atlas_/) print device }
')

VERSION=""
UPLOAD=1
TARGET="aarch64-apple-darwin"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      VERSION="${2:?use --version X.Y.Z}"
      shift 2
      ;;
    --no-upload)
      UPLOAD=0
      shift
      ;;
    --help | -h)
      sed -n '2,17p' "$0"
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
# `--bundles app`: o `bundle_dmg.sh` do Tauri depende de Finder/AppleScript e
# falha de forma intermitente em build local. O DMG é feito abaixo com
# `hdiutil`, sem depender de UI.
if [[ -n "$VERSION" ]]; then
  npx tauri build --target "$TARGET" --bundles app --config "{\"version\":\"$VERSION\"}"
else
  npx tauri build --target "$TARGET" --bundles app
fi

BUNDLE="src-tauri/target/$TARGET/release/bundle"
APP="$(ls -d "$BUNDLE"/macos/*.app 2>/dev/null | head -1 || true)"

if [[ -z "$APP" ]]; then
  echo "build-macos: o build não gerou .app em $BUNDLE/macos" >&2
  exit 1
fi

APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
DMG="$BUNDLE/dmg/Atlas_${APP_VERSION}_aarch64.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$BUNDLE/dmg"
hdiutil create -volname "Atlas" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null

echo
echo "Artefatos:"
ls -ldh "$APP"
ls -lh "$DMG"

TAG="v${APP_VERSION}"
if [[ "$UPLOAD" -eq 1 && -n "$VERSION" ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "build-macos: 'gh' não encontrado; use --no-upload ou instale o GitHub CLI." >&2
    exit 1
  fi
  if ! gh release view "$TAG" >/dev/null 2>&1; then
    echo "build-macos: release $TAG ainda não existe." >&2
    echo "  espere o workflow Release da tag terminar (gh run list --workflow release.yml)." >&2
    exit 1
  fi
  echo
  echo "==> Upload do .dmg para $TAG"
  gh release upload "$TAG" "$DMG" --clobber
  echo "==> $(gh release view "$TAG" --json url -q .url)"
elif [[ "$UPLOAD" -eq 1 ]]; then
  echo
  echo "build-macos: sem --version não há tag para subir; build só local."
fi
