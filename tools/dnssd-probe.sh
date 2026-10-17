#!/usr/bin/env bash
# Sonda da descoberta DNS-SD do iOS rodando no macOS.
#
# Usa o mesmo `discovery_ios.rs` do app (via `src-tauri/examples/dnssd_probe.rs`),
# então valida a ABI dos callbacks do `dns_sd.h` e o resolve de `*.local` sem
# precisar instalar nada no iPhone.
#
# Uso: tools/dnssd-probe.sh [nome] [segundos]
# Saída esperada com o app macOS aberto: `found=1` e o peer `Atlas …`.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "dnssd-probe: só roda no macOS (dns_sd.h via libSystem)." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
exec cargo run --manifest-path src-tauri/Cargo.toml --example dnssd_probe -- "$@"
