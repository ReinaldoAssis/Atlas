# Handoff — Atlas · sessão S5–S6 (kit de UI, mobile, backup, iOS)

> Para o próximo agente. Não duplica specs/planos/PRs: referencia por caminho.
> Repo: `/Users/reinaldoassis/Developer/Atlas` (macOS). Branch `main` @ `9a35da9`, árvore limpa.
> Escopo: `docs/MVP.md`. UI: `docs/DESIGN.md`. Plano e ordem: `docs/ROADMAP.md`.
> Handoff anterior (S1–S4, máquina Windows): `context/atlas-handoff-s1-s4.md` — histórico, não mais o estado atual.

## O que foi feito (5 PRs, todos squash-mergeados)

| PR | Fatia | Conteúdo |
|---|---|---|
| #5 | S5 | Paraglide pt-BR (sem locale na URL) + kit `Sheet`/`Toggle`/`Segmented` + Configurações reescritas + tokens do guia |
| #6 | ajustes | grade do Tempo no mobile, pastas de notas no toque, "Reiniciar dia" só no modo de teste |
| #7 | ajustes | modais de lançamento/hábito/pausa e confirmações no kit (`Field`/`Chip`/`Button`); CSS legado removido |
| #8 | ajustes | **correção** do scroll horizontal do Tempo + `tools/probe.mjs` |
| #9 | S6a | backup export/import reais + abrir anexo no iOS (+ `tauri-plugin-opener`) |
| #10 | S6b | `PrivacyInfo.xcprivacy` + fim do título "Hoje" no mobile + varredura do shell |

S6 está **fechado** exceto a verificação no device (item abaixo). Próxima fatia decidida: **S9 (iOS no Mac)**.

## Ambiente (macOS — substitui o do handoff S1–S4)

- Node **24.22.0** via `brew install node@24` (keg-only) + `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"` no `~/.zshrc`. O repo exige ≥24.15 (`engine-strict`).
- Rust 1.99 (`~/.cargo/bin`, já no PATH do `~/.zshrc`). Xcode **27.0**. `xcodegen`, `ios-deploy`, CocoaPods instalados.
- `npm ci` obrigatório quando `node_modules` vier corrompido/de outra máquina.
- `npx tauri ios build/dev` **só funciona de shell interativo** (o script phase "Build Rust Code" herda o PATH).
- `cargo build --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios --lib` compila (validado nesta sessão).

## Ferramenta desta sessão: `tools/probe.mjs`

Mede layout e roda fluxos no app via **Chrome DevTools Protocol** num viewport de celular, com screenshot. Foi o que achou a causa raiz da regressão do Tempo.

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/atlas-chrome about:blank &
npm run dev
node tools/probe.mjs http://localhost:1420/ <script.js> 390 844      # mobile
node tools/probe.mjs http://localhost:1420/ <script.js> 1280 900     # desktop
ATLAS_DOWNLOADS=/tmp/atlas-downloads node tools/probe.mjs ...        # captura downloads
```
O `<script.js>` é uma IIFE que roda na página (clica, mede e devolve JSON). Reescreva scripts prontos conforme o fluxo. Chrome ≠ WKWebView: **não** valida safe area, háptica, molas nem o picker de export.

## Decisões travadas nesta sessão (além do `docs/ROADMAP.md`)

- **i18n**: Paraglide com `strategy: ['baseLocale']` — sem locale na URL e sem cookie (`project.inlang/paraglide.config.ts`). Saída gerada em `src/lib/paraglide` (git-ignored); `prepare`, `check` e `pretest` compilam antes de precisar dela. Migração incremental: só Configurações usa `m.*` hoje. O plugin `@inlang/plugin-message-format` vem de CDN na 1ª compilação → **CI precisa de rede**.
- **Kit de UI** em `src/lib/components/ui/`: `Sheet`, `Toggle`, `Segmented`, `Field`, `Chip`, `Button`. Tokens do DESIGN no `:root` (`--s/--s2/--ln/--tx/--mu/--acc/--accd/--on-acc/--danger`, `--ease-spring`, `--ease-smooth`). Tipografia do sheet segue DM Sans (trocar só ali seria inconsistente com o shell).
- **Backup**: zip `atlas-backup-v2` (snapshot + notas + pastas + anexos) sem senha; import substitui tudo com resumo + confirmação e grava cópia em `backups/` (AppData) antes. O motor v2 já existia em `src/lib/storage.ts`; a novidade é `src/lib/backup-io.ts` (ponte por plataforma).
- **iOS e arquivos**: `<a download>` com blob não funciona no WKWebView. `dialog.save` no iOS **move** um arquivo que já existe (escrevemos os bytes em `Documents` e deixamos o picker mover). `plugin-opener` **não abre arquivo no iOS** (`URL(string:)` + `UIApplication.open` ignoram path sem esquema) — por isso o anexo também usa o picker.
- **Confirmações** (`askConfirm`/`askText`) viraram `Sheet`, não dialog central (escolha do usuário). Contrato de promise inalterado.

## Pendências (ordem sugerida)

1. **S9 — iOS/SideStore** (escolhido como próximo): integrar o Swift do `plugin-opener` (build iOS precisa ser refeito), `.ipa` com o Personal Team, `docs/IOS-SIDELOAD.md`, e **verificar no device**:
   - shell: safe areas (notch/home bar), leque do menu rápido, indicadores, transições;
   - backup export: o picker do iOS realmente move o arquivo preenchido?
   - anexo: exportar/abrir no device.
2. **S7** — Windows: conf NSIS per-user x64 + ícone `.ico` + job de build no CI Windows + verificação manual do instalador. **Nada disso roda no Mac.**
3. **S8** — updater via GitHub Releases (Windows) + release por tag + CSP (hoje `null`).
4. **S10** — sync P2P: **spike E0 primeiro** (iroh no iOS), depois E1–E9.
5. Fora do ciclo: ícone (fonte 1024 sem alpha), AltStore PAL/notarização, `Chip`/`Field`/`Slider` no resto do app, i18n do resto, teclado numérico/slider grande dos módulos.

## Gotchas que economizam tempo

- `npm test` num clone limpo precisa de `svelte-kit sync` (já está no `pretest`): sem o `.svelte-kit/tsconfig.json` o oxc do Vite 8 quebra com `Failed to load tsconfig '$app/tsconfig'`.
- **Flex + `margin: 0 auto`**: auto-margins na cross axis **desligam o stretch** do item flex — foi a causa da grade do Tempo larga demais. Use `width: 100%` + `min-width: 0`.
- `src-tauri/gen/apple/app.xcodeproj/project.pbxproj` é **gerado** por `xcodegen` a partir de `project.yml` (que lista `- path: app_iOS`): arquivo novo em `app_iOS/` precisa de `xcodegen generate`. As dependências Swift dos plugins são adicionadas pelo CLI do Tauri no build, não estão no `.pbxproj` versionado.
- `npx vitest run <arquivo>` não herda o projeto certo; use `npm test` ou `npx vitest run --project unit <arquivo>`.
- PowerShell/stderr: irrelevante agora; estamos em zsh.
- Lápides purgam em 30 dias; `db_batch` faz bind de params como string (números → `String(n)`).

## Comandos

```bash
npm run check    # svelte-kit sync + paraglide compile + svelte-check
npm test         # 71 testes (unit node + components jsdom)
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run build    # SPA estático
npm run tauri -- ios dev "<device>"    # device físico (shell interativo!)
```

## Comunicação

- Usuário em **modo caveman** (pt-BR, curto) — manter até ele dizer "normal mode".
- Ele responde decisões pela tool `question` (CLI), não em texto puro.
- Fluxo combinado: branch `feat/…` → PR → **CI verde** → squash-merge automático. Pausar antes do S10.
- `@grill-me` está **quebrado** (o `SKILL.md` manda chamar a skill `grilling`, que não existe). Grelhe direto pela tool `question`.

## Suggested skills

- **`caveman`** — manter o estilo.
- **`firecrawl`** — para detalhes de SideStore/iroh antes/durante S9/S10.
- **`opencode`** / **`report`** — dúvidas do OpenCode / abrir issue.
