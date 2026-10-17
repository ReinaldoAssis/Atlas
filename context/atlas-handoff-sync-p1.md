# Handoff — Atlas · P1 do sync P2P (metadados de sync)

> Para o próximo agente. **Não duplique specs/planos/PRs**: referencie por caminho.
> Escopo: `docs/MVP.md` · UI: `docs/DESIGN.md` · plano: `docs/ROADMAP.md` (§7 = ordem das fatias) ·
> **sync (decisões + protocolo): `docs/SYNC.md`** · ideias fora do ciclo: `docs/IDEAS.md`.
> Handoffs anteriores (histórico): `context/atlas-handoff-s11-s14.md` e os citados nele.

## Estado

| Fatia | O que é | Estado |
|---|---|---|
| **P1** | Metadados de sync (migração **v6** + HLC + gravação só da linha alterada + purga por par) | ✅ |
| P2–P5 | Engine iroh, pareamento SAS, descoberta iOS (Bonjour), UI de Sincronização | — (ver `docs/SYNC.md` §4) |

Testes: **121** (`npm test`, era 99). Rust: 2 (`cargo test`) — **nada em Rust mudou** nesta fatia.
CI: `frontend` (ubuntu+windows), `rust`, `windows-installer`, `release`.

## O que P1 mudou (o porquê em `docs/SYNC.md` §3)

- **Migração v6** (`src/lib/db/migrations.ts`):
  - `notes` reconstruída com `updated_at INTEGER` (era TEXT ISO; tipos diferentes não ordenam) —
    o `updatedAt` ISO do payload continua sendo o do app (exibição), o da coluna é o carimbo de sync;
  - `folders.updated_at` (não existia);
  - `shared_settings` (lifeForce/finance saíram de `app_settings`, que não tem carimbo nem lápide);
  - `counters` (XP virou contribuição por aparelho; a soma é o total);
  - `sync_peers` / `sync_cursors` (bookkeeping de P3/P2; a purga já usa `last_sync_at`);
  - `habit_logs` com id determinístico `hlog:<habitId>:<date>` (havia `UNIQUE(habit_id, occurred_on)`
    e id aleatório → colisão no merge);
  - backfill: nenhuma linha fica com `updated_at = 0` (nunca seria enviada, cursor começa em 0).
- **HLC-lite** (`src/lib/hlc.ts`): `nextStamp(now, lastSeen) = max(now, lastSeen + 1)`; o maior visto
  vive em `app_settings.hlc_last` (local). `storage.nextWriteStamp(db)` é o acesso.
- **Gravação só da linha alterada** (`planRows` em `src/lib/db/persist.ts`): antes o `saveSnapshot`
  carimbava todas as linhas com o mesmo `at`/`device_id` — isso reivindicava edição alheia (o aparelho
  que salvava engolia a edição seguinte do outro) e transformava qualquer mudança em full-state. Agora
  a linha inalterada preserva carimbo/origem (e nem vai pro banco). Mesma ideia em `notes-store.ts`,
  que compara com o payload no banco antes de escrever.
- **Lápide de nota/pasta** agora atualiza `updated_at` junto de `deleted_at` (antes o delete perdia a
  ordenação do LWW).
- **Purga de lápides por par** (`purgeTombstones`): só apaga abaixo do menor `last_sync_at` dos pares
  pareados; sem par nenhum, purga tudo; par com `last_sync_at = 0` segura a purga.
- `SYNC_TABLES`/`PURGE_TABLES` agora incluem notas/pastas, `shared_settings` e `counters`.

## Gotchas que economizam tempo

- `db_batch` (Rust) faz bind **como string** (`Vec<String>`): número vira texto e a afinidade `INTEGER`
  da coluna converte sozinha. Parâmetros continuam `string[]` em `BatchStatement` — não "conserte" isso
  sem mexer no Rust.
- `planRows` confia no mapa em memória (`knownRowStamps`), populado no `loadSnapshot`. Quando o engine
  de P2 escrever no banco **por fora** (merge no Rust), o front tem que recarregar antes da próxima
  gravação — senão o JS acha que a linha está como ele deixou.
- `notes.updated_at` (INTEGER, carimbo de sync) ≠ `note.updatedAt` (ISO, campo do app no payload).
- Ordem em `initializeDatabase`: `runMigrations` → `purgeTombstones` → `ensureDeviceId` → seed das
  categorias **com carimbo** (a seed antiga inseria com `updated_at = 0`).
- `notes-store.setupSchema` recria as tabelas com `IF NOT EXISTS`; alinhe o DDL lá quando mexer no
  schema de notas (é o caminho de quem não passou pela migração, ex.: banco recém-criado no teste).
- CI verde antes de tudo: `npm run check`, `npm test`, `npm run build`.
- PowerShell: `gh`/`git` escrevem progresso em **stderr** → o wrapper marca "Exited with code 1" mesmo
  em sucesso; leia o texto.

## Pendências (usuário)

- **P2 (próxima fatia)**: primeiro commit é o PoC **E0a** — dois endpoints iroh no Windows (dois SQLite
  temporários) achando um ao outro com DNS-SD + troca de "hello". Sem UI.
- iPhone (S9) e Windows (S7/S8b): checklists em `docs/IOS-SIDELOAD.md` e `docs/WINDOWS-INSTALLER.md`
  (a verificação do firewall só existe a partir de P2).

## Comunicação

- Usuário em **modo caveman** (pt-BR, curto) até dizer "normal mode".
- Decide pela tool `question` (CLI), não em texto puro. Decisões de produto/design são dele.
- Fluxo combinado: branch → PR → **CI verde** → squash-merge automático.
