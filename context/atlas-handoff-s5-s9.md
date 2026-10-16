# Handoff — Atlas · sessão S5–S9 (UI, mobile, backup, iOS, Windows)

> Para o próximo agente. **Não duplique specs/planos/PRs**: referencie por caminho e número.
> Repo: `/Users/reinaldoassis/Developer/Atlas` (macOS). Branch `main` @ `c015df2`, árvore limpa.
> Próxima fatia: **S8** (plano detalhado abaixo).
> Escopo do produto: `docs/MVP.md` · UI: `docs/DESIGN.md` · plano: `docs/ROADMAP.md` (§7 = ordem das fatias).
> Handoffs anteriores: `context/atlas-handoff-s1-s4.md` (S1–S4, Windows) e `context/atlas-ios-handoff.md` (pré-shell v2) — **histórico**, não o estado atual.

## Estado: o que está pronto

| Fatia | Estado | Onde |
|---|---|---|
| S1–S4 | ✅ mergeadas (PRs #1–#4) | ids versionados, storage incremental, modo de teste, notas+grafo em tabelas |
| S5 | ✅ PR #5 | i18n Paraglide pt-BR + kit `Sheet`/`Toggle`/`Segmented` + Configurações reescritas + tokens do guia |
| ajustes mobile | ✅ PRs #6, #7, #8 | grade do Tempo, pastas de notas, modais no kit (`Field`/`Chip`/`Button`), scroll horizontal corrigido |
| S6 | ✅ PRs #9, #10 | backup export/import reais + anexo no iOS; `PrivacyInfo.xcprivacy`; título "Hoje" só no desktop |
| S9 | ⚠️ parcial (PR #11) | `.ipa` sem assinatura + `docs/IOS-SIDELOAD.md` + chaves de Documentos; **instalação/verificação no iPhone pendente (usuário)** |
| S7 | ⚠️ parcial (PR #12) | instalador NSIS per-user gerado no CI + `docs/WINDOWS-INSTALLER.md`; **verificação manual no Windows pendente (usuário)** |
| S8 | ❌ não começou | updater + release por tag + CSP — **plano abaixo** |
| S10 | ❌ | sync P2P; o combinado é **parar e revisar o spike E0** antes de implementar |

Testes: **71** (`npm test`, projetos `unit` node + `components` jsdom). CI: `frontend` (ubuntu+windows: `check`+`test`), `rust` (ubuntu: `cargo test --locked`), **`windows-installer`** (NSIS → artefato `atlas-windows-nsis`).

## Ambiente (macOS — substitui o do handoff S1–S4)

- Node **24.22.0** (`brew install node@24`, keg-only) + `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` no `~/.zshrc`. Repo exige ≥24.15 (`engine-strict`).
- Rust 1.99 (`~/.cargo/bin`, no PATH do `~/.zshrc`), Xcode **27.0**, `xcodegen`, `ios-deploy`, CocoaPods, `gh` autenticado (`repo`+`workflow` — dá para criar secrets).
- `npm ci` quando `node_modules` vier de outra máquina. `npx tauri ios build/dev` **só de shell interativo**.
- iPhone 16 Pro pareado com esta máquina (`xcrun devicectl list devices`). NSIS **não compila aqui**.

## Ferramentas que esta sessão deixou

- **`tools/probe.mjs`** — mede layout e roda fluxos no app via Chrome DevTools Protocol num viewport de celular, com screenshot (`ATLAS_DOWNLOADS` captura downloads). Foi o que achou a causa raiz da regressão do Tempo. Instruções de uso estão no cabeçalho do arquivo e no handoff antigo.
- **`npm run ipa`** — `.ipa` sem assinatura para o SideStore (`tauri ios build --no-sign --target aarch64`).

## Decisões travadas nesta sessão (além de `docs/ROADMAP.md`)

- **i18n**: Paraglide, `strategy: ['baseLocale']` (sem locale na URL/cookie). Saída em `src/lib/paraglide` (git-ignored); `prepare`/`check`/`pretest` compilam. Migração incremental: **só Configurações** usa `m.*`. O plugin de mensagens vem de CDN → **CI precisa de rede**.
- **Kit** em `src/lib/components/ui/`: `Sheet`, `Toggle`, `Segmented`, `Field`, `Chip`, `Button`. Tokens do DESIGN no `:root`. Tipografia do sheet ainda é DM Sans (trocar só ali seria inconsistente).
- **Backup**: zip `atlas-backup-v2` (snapshot + notas + pastas + anexos), **sem senha**; import substitui tudo com resumo + confirmação e grava cópia em `backups/` antes. Ponte por plataforma em `src/lib/backup-io.ts`.
- **iOS e arquivos**: `<a download>` com blob não funciona no WKWebView. `dialog.save` no iOS **move** um arquivo existente → escrevemos os bytes em `Documents` e deixamos o picker mover. `plugin-opener` **não abre arquivo no iOS** (path sem esquema é ignorado) — anexo também sai pelo picker.
- **Confirmações** (`askConfirm`/`askText`) em `Sheet`, não dialog central.
- **Windows**: NSIS per-user, x64, **sem assinatura**, idioma pt-BR com inglês de reserva, WebView2 `downloadBootstrapper`. O `.exe` sai **só do CI** (`src-tauri/tauri.windows.conf.json`).

## Próximo: S8 (updater + release por tag + CSP)

Referências: `docs/ROADMAP.md` §3.2 (C6), §7 (S8), §"Decisões travadas" (updater via GitHub Releases, **só Windows**, release por tag semver com **versão automática pela tag**).

1. **CSP** — `app.security.csp` hoje é `null` (`src-tauri/tauri.conf.json`). Precisa cobrir: `ipc:`/`http://ipc.localhost` em `connect-src` (Tauri), `asset:`/`blob:`/`data:` conforme o app usa (blob é usado em anexos e no `carta`), estilos inline do Svelte/Carta. Validar **em dev e no build** (`vite dev` + `npm run build`) e no app empacotado; quebrar o markdown das notas é o risco mais provável.
2. **Updater** — `@tauri-apps/plugin-updater` (npm + crate + `lib.rs` + capability) e `bundle.createUpdaterArtifacts: true`; `plugins.updater.pubkey` + `endpoints: ["https://github.com/ReinaldoAssis/Atlas/releases/latest/download/latest.json"]`. Par de chaves com `npx tauri signer generate`; **a chave privada vai como secret do repo** (`gh secret set TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — nunca no repositório. UI: linha em Configurações (verificar/instalar com toast) seguindo `docs/DESIGN.md`.
3. **Release por tag** — novo `.github/workflows/release.yml` em `push: tags: v*`: extrai a versão da tag e passa para o build (`tauri build --config '{"version":"X.Y.Z"}'`), builda o instalador no Windows com `TAURI_SIGNING_PRIVATE_KEY`, gera o `latest.json` do updater e cria o **GitHub Release** com `.exe` + `.sig` + `latest.json`. Decidir se o job aproveita o artefato do `windows-installer` do CI ou faz build próprio (recomendado: build próprio no release, porque o artefato precisa ser assinado).
4. **Manutenção pendente** (não bloqueia S8): actions ainda em `@v4`; `ubuntu-latest` migra para Ubuntu 26 em 19/10/2026 (já passou? conferir avisos do CI).
5. Lembrar: a versão em `tauri.conf.json` (`0.1.0`) e o `productName` entram no nome do artefato (`Atlas_0.1.0_x64-setup.exe`).

## Pendências que dependem do usuário (não do agente)

- **iPhone (S9)**: instalar o SideStore seguindo `docs/IOS-SIDELOAD.md`, instalar o `.ipa` de `npm run ipa` e passar o checklist (safe areas, leque do menu rápido, **export do backup** — ponto mais arriscado, import, abrir anexo).
- **Windows (S7)**: baixar `Atlas_0.1.0_x64-setup.exe` do artefato do CI e passar o checklist de `docs/WINDOWS-INSTALLER.md` (SmartScreen, WebView2 no Win10, `%APPDATA%`, backup, notificações).
- `@grill-me` continua **quebrado** (aponta para a skill `grilling`, que não existe): grelhe pela tool `question`.

## Gotchas que economizam tempo

- **Flex + `margin: 0 auto`**: auto-margins na cross axis **desligam o stretch** do item flex (causa da grade do Tempo larga demais). Use `width: 100%` + `min-width: 0`.
- `npm test` num clone limpo precisa de `svelte-kit sync` (já está no `pretest`); sem `.svelte-kit/tsconfig.json` o oxc do Vite 8 quebra com `Failed to load tsconfig '$app/tsconfig'`.
- `src-tauri/gen/apple/app.xcodeproj/project.pbxproj` é **gerado** por `xcodegen` a partir de `project.yml` (que lista `- path: app_iOS`): arquivo novo em `app_iOS/` exige `xcodegen generate`. As dependências Swift dos plugins entram no build pelo CLI do Tauri, não no `.pbxproj` versionado (verificado: `tauri_plugin_opener12OpenerPlugin` está no binário do `.ipa`).
- `npx vitest run <arquivo>` não herda o projeto certo: use `npm test` ou `npx vitest run --project unit <arquivo>`.
- `db_batch` (Rust) faz bind de params como string (números → `String(n)`); lápides purgam em 30 dias.

## Comandos

```bash
npm run check    # svelte-kit sync + paraglide compile + svelte-check
npm test         # 71 testes
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run build    # SPA estático
npm run ipa      # .ipa sem assinatura (SideStore)
npm run tauri -- ios dev "<device>"   # device físico (shell interativo)
```

## Comunicação

- Usuário em **modo caveman** (pt-BR, curto) até dizer "normal mode".
- Decide pela tool `question` (CLI), não em texto puro.
- Fluxo combinado: branch `feat/…` → PR → **CI verde** → squash-merge automático. Pausar antes do S10.

## Suggested skills

Chamar a tool `Skill` com:

- **`caveman`** — manter o estilo de resposta.
- **`handoff`** — ao fim da próxima sessão.
- **`firecrawl`** — detalhes de updater/GitHub Releases/CSP do Tauri e do iroh (S8/S10).
- **`opencode`** / **`report`** — dúvidas do OpenCode / abrir issue.
