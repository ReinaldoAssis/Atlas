# Handoff — Atlas · sync P2P (P1 + P2)

> Para o próximo agente. **Não duplique specs/planos/PRs**: referencie por caminho.
> Escopo: `docs/MVP.md` · UI: `docs/DESIGN.md` · plano: `docs/ROADMAP.md` (§7 = ordem das fatias) ·
> **sync (decisões + protocolo): `docs/SYNC.md`** · ideias fora do ciclo: `docs/IDEAS.md`.
> Handoffs anteriores (histórico): `context/atlas-handoff-s11-s14.md` e os citados nele.

## Estado

| Fatia | O que é | Estado |
|---|---|---|
| **P1** | Metadados de sync (migração **v6** + HLC + gravação só da linha alterada + purga por par) | ✅ |
| **P2a** | PoC E0a: identidade Ed25519, endpoint iroh LAN, DNS-SD, hello | ✅ (macOS + CI) |
| **P2b** | Protocolo por cursor + merge LWW + testes de convergência | ✅ |
| **P2c** | Commands (`start/stop/now/status`) + evento `atlas://sync-applied` + allowlist | ✅ |
| P3–P5 | Pareamento SAS, descoberta iOS (Bonjour), UI de Sincronização | — (ver `docs/SYNC.md` §4) |

Testes: **121** (`npm test`); Rust: **37** (`cargo test`, era 2 no começo do P2).
CI: `frontend` (ubuntu+windows), `rust`, `windows-installer`, `release`.

## P2a — o que entrou (`src-tauri/src/sync/`)

- `identity.rs`: chave em `<appdata>/atlas-identity.key` (32 bytes, 0600, arquivo
  temporário + rename). Arquivo inválido **não** é sobrescrito.
- `engine.rs`: `Endpoint::builder(presets::Minimal)` = sem relay, sem DNS da n0;
  ALPN `atlas/sync/1`; `dial`/`accept` trocam `hello` (proto + schema + device_id
  + cursores) e recusam incompatibilidade com `Refuse` explícito.
- `discovery.rs`: `_atlas-sync._udp.local.`, instância `Atlas <short>`, TXT
  `id=<EndpointID>`/`v=1`, endereços por `addr_auto`; `parse_resolved` ignora
  anúncio sem TXT `id`.
- `protocol.rs`: frame `u32` BE + JSON, teto 4 MiB.
- `examples/sync_poc.rs`: PoC de dois terminais; ID menor disca; dedupe de
  anúncios repetidos do mDNS.
- Cargo: `iroh 1.3`/`mdns-sd 0.21`/`tokio` só desktop (`cfg(not(ios/android))`);
  `rust-version` 1.90 → **1.91** (MSRV do iroh).
- **P2c** (`commands.rs`): `sync_start`/`sync_stop`/`sync_now`/`sync_status`/
  `sync_cursors`; opt-in em `app_settings.sync_enabled`; allowlist de
  `sync_peers` checada antes do hello; evento `atlas://sync-applied`; banco de
  teste recusado. Front: `nextWriteStamp` relê `hlc_last` a cada gravação.
- **P2b** (`store.rs`/`session.rs`): delta por origem × cursor, merge LWW
  payload-agnóstico com schema lido de `PRAGMA table_info`, cursores +
  `last_sync_at` só no fim, `hlc_last` sobe com o maior carimbo recebido.
  `updated_at >= cursor` de propósito (um salvamento carimba várias linhas com
  o mesmo stamp; `>` pularia as que sobraram).

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

- Em iroh, `send.finish()` seguido de `conn.close()` descarta o frame que ainda
  não saiu (o outro lado lê `connection lost`). No acceptor, espere
  `conn.closed()` (com timeout) antes de fechar — inclui o caminho de `Refuse`.
- `Endpoint::bound_sockets()` devolve `0.0.0.0:<porta>` (bind padrão): para
  anunciar, use `ServiceInfo::enable_addr_auto()`; para dialar em teste, troque
  o IP não especificado por `127.0.0.1`.
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

- **P3 (próximo)**: pareamento SAS de 6 dígitos + allowlist/store de pares com
  UI mínima da lista de descobertos; depois **P4** (Bonjour no iOS) e **P5**
  (UI de Sincronização + reload no evento + cópia de nota em conflito).
- **Windows (P2c em diante)**: aceitar o prompt do Firewall (UDP de entrada) e
  rodar o `sync_poc` em duas máquinas Windows quando houver par disponível.
- iPhone (S9) e Windows (S7/S8b): checklists em `docs/IOS-SIDELOAD.md` e
  `docs/WINDOWS-INSTALLER.md`.

## Comunicação

- Usuário em **modo caveman** (pt-BR, curto) até dizer "normal mode".
- Decide pela tool `question` (CLI), não em texto puro. Decisões de produto/design são dele.
- Fluxo combinado: branch → PR → **CI verde** → squash-merge automático.
