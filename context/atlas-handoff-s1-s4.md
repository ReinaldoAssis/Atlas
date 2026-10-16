# Handoff — Atlas · sessão S1–S4 (fundação)

> Documento para o próximo agente. Não duplica specs/planos/commits: referencia por caminho.

Repo: `C:\Users\randr\Documents\Programação\Atlas` (Windows) · remoto `github.com/ReinaldoAssis/Atlas` (**público**, GPL-3.0).
Branch de trabalho: `main` @ `4b8f2b9`. Árvore limpa; nada pendente de commit.

## O que foi feito nesta sessão

Rodadas de perguntas (grilling) para travar decisões e depois 4 fatias implementadas, cada uma em branch + PR com CI verde e **squash-merge**:

| Fatia | Conteúdo | PR (mergeado) |
|---|---|---|
| S1 | Vitest (37 testes hoje) + `cargo test` + CI (ubuntu + Windows + Rust) | #1 |
| S2 | Migrações versionadas, `saveSnapshot` incremental (upsert + lápides 30d + `device_id`), boot vazio, limpeza dos `demo-*`, fixtures extraídas | #2 |
| S3 | Modo de teste em banco separado (`atlas.test.db`), fixtures de todos os módulos, banner âmbar | #3 |
| S4 | Notas com tombstone, grafo em tabelas `graph_domains/nodes/edges` (blob migrado) | #4 |

Decisões travadas e ordem restante: **`docs/ROADMAP.md`** (seções "Decisões travadas" e "7. Sequenciamento aprovado"). Ler primeiro. `docs/DESIGN.md` é o guia de UI.

## Arquivos-chave criados/alterados

- `src/lib/db/migrations.ts` — migrações versionadas por `PRAGMA user_version` (atual: **4**). Exporta `ensureColumn` p/ reuso.
- `src/lib/db/persist.ts` — builders puros (`upsertSql`, `tombstoneIds`, `tombstoneStatements`, `settingStatements`, `SETTING_KEYS`).
- `src/lib/test-mode.ts` — flag em `localStorage`, `activeDbName()`, `previewKey()`, `attachmentsRoot()`.
- `src/lib/fixtures.ts` — `demoSnapshot()`, `demoNotes()` e os antigos construtores demo.
- `src/lib/storage.ts` — `getReadyDatabase`, `saveSnapshot` incremental (via `buildSnapshotStatements`), `seedTestData`, `purgeTombstones`, `resetStorageCache`, `getDeviceId`.
- `src/lib/notes-store.ts` — tombstone em notas/pastas, schema por banco, upserts via `upsertSql`.
- `src/routes/+page.svelte` — toggle "Modo de teste" em Configurações + banner (`toggleTestMode`). `src/app.css` tem `.test-mode-banner`.
- `.github/workflows/ci.yml` — jobs `frontend` (matriz ubuntu+windows: `check` + `test`) e `rust` (ubuntu: `cargo test`).
- `LICENSE` (GPL-3.0), `docs/ROADMAP.md`, `docs/DESIGN.md` (commitados).

## Ambiente (fatos)

- Node **24.20.0** (atualizado nesta sessão via winget; o repo exige ≥24.15 por `engine-strict=true` no `.npmrc`).
- Rust 1.99 · `tauri-cli` 2.12.2 · WebView2 instalado · `gh` autenticado com escopo `repo`+`workflow`.
- **Não há Xcode/`xcrun` no Windows.** O Mac do handoff está disponível para o S9 (iOS/SideStore).
- `src-tauri/gen/apple/` já é versionado.

## Fluxo de trabalho combinado com o usuário

- Fatia = branch `feat/…` → PR → CI verde → **squash-merge automático** (até o S9). **Pausar antes do S10 (sync P2P)** para revisar o spike.
- O usuário responde perguntas pela **tool `question` (CLI)**, não em texto puro. Estilo de resposta: **modo caveman** (pt-BR, curto).

## Próximo passo: S5

Do `docs/ROADMAP.md` §7: **i18n com Paraglide (só pt-BR, migração incremental)** + **kit de UI mínimo (`Sheet`, `Toggle`, `Segmented`)** + **reescrever Configurações** seguindo `docs/DESIGN.md` (sem eyebrow, bottom sheet com grip, tiles, toggles 48×28). Escopo reduzido por decisão: os overlays de lançamento/hábito **não** entram agora.

Depois: S6 (pendências do handoff: backup com `plugin-dialog`/`plugin-fs` + `openAttachment`, `PrivacyInfo.xcprivacy`, remover cabeçalho "Hoje" duplicado, verificar shell no device) → S7 (Windows NSIS per-user x64 + job de build) → S8 (updater GitHub Releases por tag + CSP) → S9 (iOS/SideStore, no Mac) → **parar**.

## Gotchas desta sessão (economizam tempo)

- PowerShell mostra "Exited with code 1" com `git`/`gh` quando o programa escreve em **stderr** (ex.: `remote:`); não é falha de verdade. Conferir `$LASTEXITCODE` quando importa.
- `npm install` corrompeu `node_modules` (tar incompleto: `jszip`/`dompurify` sem `.d.ts`). Fix: apagar `node_modules` e rodar **`npm ci`**.
- `db_batch` (Rust) faz bind de `params` como **string**; por isso números viram `String(n)` e nulos são literais SQL.
- Lápides: `deleted_at` é lido como `IS NULL`/`< cutoff`; as lápides purgam em 30 dias.
- O `knownActiveIds` (memória) é a base do diff de deleção; só é atualizado **após** o `db_batch` ter sucesso.
- Manutenção pendente (não bloqueia): actions no CI ainda em `@v4` (Node 20 deprecado) e `ubuntu-latest` migra p/ Ubuntu 26 em 19/10/2026.

## Comandos

```powershell
npm run check   # svelte-check
npm test        # vitest (37 testes)
cargo test --manifest-path src-tauri/Cargo.toml
gh pr checks    # status do PR atual
```

## Suggested skills

- **`caveman`** — o usuário trabalha nesse modo; manter até ele dizer "normal mode".
- **`grilling`** — se surgirem novas decisões (S10/sync certamente terá); usar a tool `question` para a rodada.
- **`report`** — para abrir issue de bug do OpenCode.
- **`opencode`** — dúvidas sobre agentes/CLI/config do próprio OpenCode.
- **`firecrawl`** — pesquisa web (ex.: detalhes do iroh/SideStore antes do S9/S10).

Não há skill de Tauri/SvelteKit/iOS instalada; o trabalho é no repo normal.
