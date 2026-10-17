# Publicar uma versão do Atlas (release por tag)

Como sai uma versão nova: **uma tag semver** dispara o workflow `Release`
(`.github/workflows/release.yml`), que builda o instalador do Windows **assinado
para o updater**, gera o `latest.json` e publica tudo num GitHub Release. Quem
tem o app instalado recebe a atualização em Configurações → **Atualizações**.

Decisões de produto: `docs/ROADMAP.md` (§ "Decisões travadas" → plataformas).
O updater é **só do Windows** (o iOS renova pelo SideStore, `docs/IOS-SIDELOAD.md`).

## O que o workflow faz

1. valida a tag (`^v\d+\.\d+\.\d+$`) e extrai a versão dela;
2. builda com `--config` (a versão da tag **sobrepõe** `tauri.conf.json`, e
   `bundle.createUpdaterArtifacts: true` é ligado só aqui — build local/CI de PR
   não precisa de chave);
3. o `tauri build` assina os artefatos do updater com
   `TAURI_SIGNING_PRIVATE_KEY` (secret do repositório) → sai o `.exe` + `.exe.sig`;
4. monta o `latest.json` (sem BOM) com `windows-x86_64` → `{ signature, url }`;
5. cria o release com **`Atlas_<versão>_x64-setup.exe`**, o `.sig` e o
   `latest.json` (se o release já existir, faz `gh release upload --clobber`).

O app consulta
`https://github.com/ReinaldoAssis/Atlas/releases/latest/download/latest.json`
(`plugins.updater.endpoints`). O GitHub resolve `latest` para o release mais
recente **que não é pré-release**.

## Publicar

```bash
# 1. main atualizada e CI verde
git checkout main && git pull
npm run check && npm test

# 2. tag semver (a versão do app vem daqui; `tauri.conf.json` pode ficar em 0.1.0)
git tag v0.2.0
git push origin v0.2.0
```

Acompanhe em **Actions › Release**. Ao terminar, o release está em
`Releases` e o app passa a ver a versão nova.

## macOS (build local)

O updater e o workflow de release são **só do Windows**: não existe job macOS no
CI. O `.dmg` do macOS sai da máquina Apple Silicon, com a mesma versão da tag:

```bash
tools/build-macos.sh --version 0.3.0
# .app: src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Atlas.app
# .dmg: src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Atlas_0.3.0_aarch64.dmg
```

Depois de o workflow `Release` criar o release da tag, anexe o `.dmg`:

```bash
gh release upload v0.3.0 \
  src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Atlas_0.3.0_aarch64.dmg
```

- **arm64 só** (Apple Silicon). Universal exigiria `rustup target add x86_64-apple-darwin`
  e `--target universal-apple-darwin`.
- Build **sem assinatura**: em outra máquina o Gatekeeper bloqueia; libere com
  `xattr -dr com.apple.quarantine /Applications/Atlas.app`.
- O macOS **não** entra no `latest.json` (updater é Windows-only); atualizar no
  Mac é baixar o `.dmg` novo e arrastar por cima.
- O script usa `npm run build` (via `tauri build`) e a versão passada em
  `--version` só para nomear/versionar o bundle — `tauri.conf.json` continua em
  `0.1.0`.

## Chaves de assinatura

- **Pública**: `tauri.conf.json` → `plugins.updater.pubkey` (pode ser publicada).
- **Privada**: só nos secrets do repositório
  (`TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) e numa
  cópia local em `~/.tauri/atlas.key` (+ `atlas.key.password`, ambos `600`).
  **Nunca entra no repositório.**
- `requireSignedVersion: true`: o `tauri build` embute a versão no comentário
  assinado (`--app-version`), então um `latest.json` adulterado que anuncie uma
  versão diferente da que foi assinada é **recusado** pelo app.

Gerar outro par (só se a chave for perdida — quem tem o app instalado **não**
consegue mais se atualizar com o par antigo, então publique um `.exe` novo para
reinstalar):

```bash
npx tauri signer generate -w ~/.tauri/atlas.key
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/atlas.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body '<senha>'
# cole o conteúdo de ~/.tauri/atlas.key.pub em plugins.updater.pubkey
```

## Limites conhecidos

- **Windows apenas**: o `latest.json` só tem `windows-x86_64`; em outra
  plataforma o updater não encontra o alvo (e a linha de Configurações nem
  aparece — `src/lib/updater.ts`).
- O instalador **não é code-signado** (SmartScreen aparece na primeira
  instalação, `docs/WINDOWS-INSTALLER.md`); a assinatura do updater é outra
  coisa e é obrigatória para o app aceitar a atualização.
- No Windows o app **encerra** ao instalar a atualização; o Atlas chama
  `relaunch()` em seguida para reabrir.
- Versão publicada **não pode ser restaurada** para um número menor: o updater
  só instala versão maior (`requireSignedVersion` reforça isso).
