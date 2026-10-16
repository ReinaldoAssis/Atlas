# Handoff — Atlas · sessão S8 (CSP + updater/release) → próximo: S10

> Para o próximo agente. **Não duplique specs/planos/PRs**: referencie por caminho e número.
> Repo: `/Users/reinaldoassis/Developer/Atlas` (macOS). Branch `main`, árvore limpa.
> Próxima fatia: **S10 (sync P2P)** — o combinado é rodar o **spike E0** e revisar antes de implementar.
> Antes disso, **duas verificações dependem do usuário** (iPhone/Windows, abaixo).
> Escopo: `docs/MVP.md` · UI: `docs/DESIGN.md` · plano: `docs/ROADMAP.md` (§7 = ordem das fatias) ·
> releases: `docs/RELEASES.md`.
> Handoffs anteriores (histórico, não o estado atual): `context/atlas-handoff-s1-s4.md`,
> `context/atlas-ios-handoff.md`, `context/handoff-notas.md`, `context/handoff-grafo.md`.

## Estado: o que está pronto

| Fatia | Estado | Onde |
|---|---|---|
| S1–S4 | ✅ PRs #1–#4 | ids versionados, storage incremental, modo de teste, notas+grafo em tabelas |
| S5 + ajustes mobile | ✅ PRs #5–#8 | i18n Paraglide pt-BR, kit `Sheet`/`Toggle`/`Segmented`/`Field`/`Chip`/`Button`, Configurações, polimentos |
| S6 | ✅ PRs #9, #10 | backup export/import reais + anexo no iOS; `PrivacyInfo.xcprivacy` |
| S9 | ⚠️ parcial (PR #11) | `.ipa` sem assinatura + `docs/IOS-SIDELOAD.md`; **instalação/checklist no iPhone pendente (usuário)** |
| S7 | ⚠️ parcial (PR #12) | instalador NSIS per-user no CI + `docs/WINDOWS-INSTALLER.md`; **verificação manual no Windows pendente (usuário)** |
| S8a | ✅ PR #14 | **CSP fechada** em `src-tauri/tauri.conf.json` + `tools/csp-check.mjs` (`npm run csp:check`, 22/22) |
| S8b | ✅ PR #15 | **updater** (`tauri-plugin-updater`, só desktop) + **release por tag** (`.github/workflows/release.yml`, assinado) + `docs/RELEASES.md` |
| — | ✅ release `v0.2.0` | primeira tag validou o workflow inteiro: `Atlas_0.2.0_x64-setup.exe` (8,4 MB) + `.exe.sig` + `latest.json` (710 B) em `releases/latest/download/latest.json` |
| S10 | ❌ | sync P2P; **parar e revisar o spike E0** antes de implementar |

Testes: **80** (`npm test`, projetos `unit` node + `components` jsdom). Rust: 2 (`cargo test`).
CI: `frontend` (ubuntu+windows: `check`+`test`), `rust` (ubuntu: `cargo test --locked`),
`windows-installer` (NSIS → artefato `atlas-windows-nsis`), `release` (tag `v*` → GitHub Release).
Secrets do repositório: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Ambiente (macOS)

- Node **24.22.0** (`brew install node@24`, keg-only) + `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` no `~/.zshrc`.
  O shell não-interativo do agente **não** carrega o `~/.zshrc` — exporte o PATH à mão.
- Rust 1.99 (`~/.cargo/bin`), Xcode 27, `xcodegen`, `ios-deploy`, CocoaPods, `gh` autenticado (`repo`+`workflow`).
- Targets iOS instalados (`aarch64-apple-ios`, `-sim`, `x86_64-apple-ios`): dá para validar compilação iOS
  com `cargo check --target aarch64-apple-ios` **sem** build completo.
- **Google Chrome** em `/Applications` (usado pelo `csp-check`; `ATLAS_CHROME` sobrescreve).
- Chave de assinatura do updater: `~/.tauri/atlas.key` + `atlas.key.password` (ambos `600`) e
  `atlas.key.pub`; os secrets do repo foram setados com `gh secret set`.
- NSIS **não compila aqui**; iPhone 16 Pro pareado (`xcrun devicectl list devices`).

## Ferramentas que esta sessão deixou

- **`tools/csp-check.mjs`** (`npm run csp:check`) — serve `build/` com a CSP de `tauri.conf.json` como
  cabeçalho, recalcula os hashes dos scripts inline e roda o app no Chromium via CDP: boot, nota rica em
  markdown (negrito, Shiki, KaTeX, tabela GFM, wiki-link, `data:`, fence de artefato), iframe do artefato,
  `blob:`/`worker:`, estilo inline, `srcdoc`, violações de CSP, erros de JS e 404. `--shot` salva
  `/tmp/atlas-csp.png`. `ATLAS_CSP_DUMP=1` grava a página de primitivas.
- **`.github/workflows/release.yml`** — a única forma de publicar versão: tag `vX.Y.Z` (roteiro em
  `docs/RELEASES.md`).
- `tools/probe.mjs` (layout via CDP), `npm run ipa` (`.ipa` sem assinatura) — da sessão anterior.

## Decisões travadas nesta sessão (além de `docs/ROADMAP.md`)

- **CSP** (S8a): `default-src 'self'`; `connect-src ipc: http://ipc.localhost`;
  `script-src 'self' 'wasm-unsafe-eval'` — **`'wasm-unsafe-eval'` é obrigatório**: o Shiki/Oniguruma do
  markdown compila WASM, e sem ele o Carta falha inteiro (a nota cai no "Não foi possível renderizar");
  `style-src 'self' 'unsafe-inline'` (os `style={...}` do Svelte + `style="display: contents"` do HTML do
  SvelteKit); `img-src`/`font-src`/`media-src` com `data:`/`blob:`; `frame-src 'self'` (srcdoc do artefato);
  `worker-src 'self' blob:`; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. Sem `asset:` e
  **sem origem remota** (fontes e KaTeX saem no bundle; imagem remota em nota não carrega).
  Vale **só no app empacotado** (em dev o HTML vem do Vite; o Tauri só aplica CSP nas respostas do
  protocolo `tauri://localhost`).
- **Updater** (S8b): plugins sob `cfg(desktop)` no Cargo **e** no `lib.rs` (o iOS não compila reqwest/zip);
  `plugins.updater` com `pubkey` + `releases/latest/download/latest.json` + `requireSignedVersion: true`;
  `capabilities/desktop.json` (`updater:default`, `process:allow-restart`); UI em Configurações **só quando
  `isTauri` + Windows** (`src/lib/updater.ts`); `createUpdaterArtifacts` entra por `--config` **só** no
  workflow de release (build de PR/local não precisa da chave).
- **Versão do app vem da tag**: `tauri.conf.json` continua `0.1.0`; o release sobrepõe via `--config`.

## Pendências que dependem do usuário (não do agente)

- **Windows (S7 + S8b)** — `docs/WINDOWS-INSTALLER.md`, checklist completo:
  - instalar o `.exe` (SmartScreen → "Executar assim mesmo"), WebView2 no Win10, `%APPDATA%`, backup,
    notificações, anexo, desinstalar;
  - **linha nova**: Configurações → *Atualizações*. Roteiro que exercita o caminho de verdade: instale o
    artefato **0.1.0** do CI (`atlas-windows-nsis`, run do merge do #15 — esse build já tem o updater),
    com o release **`v0.2.0` já publicado** clique em *Verificar*: deve achar 0.2.0, baixar, instalar,
    encerrar e reabrir — com os dados intactos. (`latest.json` e a assinatura já foram conferidos por HTTP;
    falta só o Windows.) Um app 0.2.0 instalado não vê o próprio 0.2.0: para testar de novo, publique `v0.2.1`.
- **iPhone (S9)** — `docs/IOS-SIDELOAD.md`, seções 3–6. Item novo no checklist: nota com markdown **sob
  CSP** (negrito, código com cor, KaTeX, tabela, `#tag`, `data:` e a fence `artifact` renderizando).
  O `csp-check` valida no Chromium; **WKWebView é outro motor**.
- `@grill-me` continua **quebrado** (aponta para a skill `grilling`, que não existe): grelhe pela tool `question`.

## Próximo: S10 (spike E0 primeiro)

Referências: `docs/ROADMAP.md` §2 (§2.2 decisões, §2.3 fases E0–E9, §2.5 riscos), §7 e §8.

1. **E0 é go/no-go**: iroh sobe no iOS/Tauri? O `MdnsDiscovery` acha o par? O prompt de Rede Local aparece?
   Entregável: relatório curto + PoC "hello" entre dois devices. Se o mDNS falhar, plano B é Bonjour nativo
   (`NWBrowser`) ou conexão por endereço salvo + re-pareamento por QR (`ROADMAP` §2.5).
2. Só depois: **E1** (`updated_at`/`deleted_at`/`device_id`/`rev` + backfill), **E2** (upsert-diff + tombstones
   no `saveSnapshot`) — nota: o storage atual **já** faz upsert/tombstone por linha (S2), então E1/E2 são
   menores do que o roadmap estimava; confirme lendo `src/lib/db/persist.ts` e `src/lib/storage.ts`.
3. `Info.plist` do iOS: `NSLocalNetworkUsageDescription` (+ `NSBonjourServices`) — E8.
4. Lembrar: iOS exige permissão de **Rede Local** (Apple TN3179); nada conecta sem pareamento.

## Gotchas que economizam tempo

- **CI verde antes de tudo**: `npm run check` (svelte-kit sync + paraglide + svelte-check), `npm test` (80),
  `cargo test --manifest-path src-tauri/Cargo.toml --locked`; `cargo check --target aarch64-apple-ios` é o
  jeito barato de validar iOS.
- **Mudança de CSP**: sempre `npm run build && npm run csp:check`. `vite dev`/`tauri dev` **não** aplicam CSP.
- `npx tauri add <plugin>` **não** coloca `cfg(desktop)` (nem no Cargo nem no `lib.rs`) e cria/edita
  capabilities: revise o diff (foi o caso do updater/process).
- PowerShell 5.1 escreve BOM; no runner use `pwsh` + `[System.IO.File]::WriteAllText` para JSON que o app lê
  (o updater faz parse estrito).
- `createUpdaterArtifacts: true` **sem** `TAURI_SIGNING_PRIVATE_KEY` quebra o build — por isso ele só entra no
  workflow de release, por `--config`.
- `requireSignedVersion: true` compara a versão anunciada com a **versão assinada** (`tauri build` embute via
  `--app-version`); assinatura manual exige passar `--app-version`.
- A linha "Atualizações" só aparece com `__TAURI_INTERNALS__` **e** UA de Windows: no preview web e no
  harness ela não existe (não adiante tentar vê-la no `csp-check`).
- Harness/CDP: `srcdoc` criado por script **renderiza**, mas o `postMessage` de dentro dele não chega ao pai
  nesse ambiente (não é CSP; está documentado no cabeçalho do `csp-check`). Iframe `srcdoc` declarado no HTML
  entrega normalmente.
- **Flex + `margin: 0 auto`**: auto-margins na cross axis desligam o stretch do item flex (causa da grade do
  Tempo). Use `width: 100%` + `min-width: 0`.
- `src-tauri/gen/apple/app.xcodeproj/project.pbxproj` é **gerado** por `xcodegen` (`project.yml`); arquivo
  novo em `app_iOS/` exige `xcodegen generate`.
- `npx vitest run <arquivo>` não herda o projeto certo: use `npm test` ou `--project unit|components`.
- `db_batch` (Rust) faz bind como string (`String(n)`); lápides purgam em 30 dias.

## Comandos

```bash
npm run check    # svelte-kit sync + paraglide compile + svelte-check
npm test         # 80 testes
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run build && npm run csp:check     # CSP do app empacotado (Chromium real, 22/22)
cargo check --manifest-path src-tauri/Cargo.toml --locked --target aarch64-apple-ios
npm run ipa      # .ipa sem assinatura (SideStore)
gh workflow list  # CI + Release
git tag v0.2.1 && git push origin v0.2.1   # publica versão (docs/RELEASES.md)
```

## Comunicação

- Usuário em **modo caveman** (pt-BR, curto) até dizer "normal mode".
- Decide pela tool `question` (CLI), não em texto puro.
- Fluxo combinado: branch `feat/…` → PR → **CI verde** → squash-merge automático. **Pausar antes do S10**
  (decidido nesta sessão: só retomar depois dos testes de iPhone/Windows).
