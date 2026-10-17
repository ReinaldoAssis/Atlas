# Publicar uma versão do Atlas (release por tag)

Como sai uma versão nova: **uma tag semver** dispara o workflow `Release`
(`.github/workflows/release.yml`), que builda o instalador do Windows **assinado
para o updater**, gera o `latest.json` e publica tudo num GitHub Release. Quem
tem o app instalado recebe a atualização em Configurações → **Atualizações**.

Decisões de produto: `docs/ROADMAP.md` (§ "Decisões travadas" → plataformas).
O updater é **só do Windows** (o iOS renova pelo SideStore, `docs/IOS-SIDELOAD.md`).

## Versão única

- **`VERSION`** na raiz é a fonte única (`0.3.2`).
- `npm run version:set -- 0.3.2` grava `VERSION`, `package.json`,
  `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` e
  `Cargo.lock` de uma vez.
- `npm run version:check` confere todos (roda no CI e no release).
- O rodapé de Configurações mostra `Atlas <VERSION> · <commit>`.
- O build macOS lê `VERSION`; o build iOS/Windows usa o `tauri.conf.json`
  sincronizado (o release Windows ainda sobrepõe com a versão da tag).
- **A tag precisa bater com `VERSION`**: o workflow `Release` falha se
  `v0.3.2` não for `0.3.2`.

## O que o workflow faz

1. valida a tag (`^v\d+\.\d+\.\d+$`), confere se ela bate com `VERSION`
   (`node tools/version.mjs check <versão>`) e extrai a versão dela;
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

# 2. versão única (grava VERSION, package.json e tauri.conf.json)
npm run version:set -- 0.3.2
git add VERSION package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release v0.3.2"
git push

# 3. tag semver (precisa bater com VERSION)
git tag v0.3.2
git push origin v0.3.2
```

Acompanhe em **Actions › Release**. Ao terminar, o release está em
`Releases` e o app passa a ver a versão nova.

## macOS (build local)

O updater e o workflow de release são **só do Windows**: não existe job macOS no
CI. O `.dmg` do macOS sai da máquina Apple Silicon, com a versão de `VERSION`:

```bash
# depois de o workflow `Release` da tag terminar:
tools/build-macos.sh
# pergunta: Fazer upload do .dmg para v0.3.2? [y/N]
# .app: src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Atlas.app
# .dmg: src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Atlas_0.3.2_aarch64.dmg
```

Opções: `--no-upload` (build local), `--yes` (sobe sem perguntar) e
`--version 0.3.2` (atualiza a fonte única antes do build). O script **não**
roda no CI e é manual: rode quando quiser publicar/atualizar o `.dmg` do Mac.
Se o release ainda não existir, ele avisa e deixa o build local — não cria
release incompleto.

- O script builda só o `.app` (`--bundles app`) e cria o `.dmg` com `hdiutil`
  (volume "Atlas" + atalho para `/Applications`). O `bundle_dmg.sh` do Tauri
  depende de Finder/AppleScript e falha de forma intermitente em build local.
- Volumes `dmg.*` de tentativas anteriores são ejetados no início do script.
- **arm64 só** (Apple Silicon). Universal exigiria `rustup target add x86_64-apple-darwin`
  e `--target universal-apple-darwin`.
- Build **sem assinatura**: em outra máquina o Gatekeeper bloqueia; libere com
  `xattr -dr com.apple.quarantine /Applications/Atlas.app`.
- O macOS **não** entra no `latest.json` (updater é Windows-only); atualizar no
  Mac é baixar o `.dmg` novo e arrastar por cima.
- O script usa `npm run build` (via `tauri build`) e a versão de `VERSION`
  (também já gravada em `tauri.conf.json`) para nomear o bundle e o `.dmg`.

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
