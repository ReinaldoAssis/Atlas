# Atlas — sync P2P na LAN (S10)

Plano fechado numa sessão de alinhamento (out/2026). Ordem das fatias vive em
`docs/ROADMAP.md` §7; escopo do produto em `docs/MVP.md`; UI em `docs/DESIGN.md`.

> Objetivo: dois aparelhos (iPhone + Windows, nesta ordem de ciclo) na mesma
> Wi‑Fi se acham e convergem **sem ação manual**, sem conta, serviço central ou
> custo. Nada vaza sem pareamento.

---

## 1. O que já está pronto (feito em S2, não repetir)

- Upsert por linha + lápides (`deleted_at`) — o `saveSnapshot` **não** apaga mais tudo.
- `updated_at`/`deleted_at`/`device_id` na maioria das tabelas + índices.
- `device_id` por instalação (em `app_settings`) e `device_id` próprio do modo de teste.
- Tabelas `notes`/`folders` e grafo em tabelas (`nodes/edges/domains`), trackers.

## 2. Bloqueador conhecido (resolvido por decisão)

**mDNS cru não é opção no iOS.** Os crates de descoberta local do iroh
(`iroh-mdns-address-lookup` = `swarm-discovery`; `iroh-mdns-peer-lookup`) enviam
UDP multicast por socket BSD. No iPhone físico isso exige o entitlement restrito
`com.apple.developer.networking.multicast`, e a Apple **recusa o pedido quando o
objetivo é mDNS direto** ("not our policy to enable this entitlement for apps
trying to use mDNS directly"). Também não dá com Personal Team.

Decisão: **iOS descobre via Bonjour nativo** (`NSNetService`/`NWBrowser`, que
usam o mDNSResponder do sistema e só precisam de permissão de Rede Local) e o
**Windows fala DNS-SD padrão** (`mdns-sd`, com PTR/SRV/TXT). `swarm-discovery`
não emite PTR, então não serve nem do lado Windows.

O agente (Windows) não valida iOS: a parte iOS é escrita, revisada e verificada
no device depois (mesmo fluxo de S7/S9).

## 3. Decisões travadas

### Transporte e descoberta

| Tema | Decisão |
|---|---|
| Biblioteca | **iroh 1.0** (bindings Swift oficiais desde jun/2026; roda em iOS/Windows) |
| Alcance | **Só LAN** (config local-first do iroh 1.0: sem relay, sem DNS/Pkarr da n0) |
| Protocolo | ALPN `atlas/sync/1`; handshake troca versão de protocolo + `user_version` do schema e recusa se não bater |
| Descoberta (Windows) | crate `mdns-sd` (DNS-SD padrão) |
| Descoberta (iOS) | `NSNetService`/`NWBrowser` via bridge Swift; serviço `_atlas-sync._udp`, TXT com o EndpointID |
| Execução | opt-in, **só com o app aberto** (sem serviço em background; iOS suspende socket de qualquer forma) |

### Identidade, pareamento e confiança

| Tema | Decisão |
|---|---|
| Identidade do endpoint | chave Ed25519 em `<appdata>/atlas-identity.key` (0600), **fora** do backup e do banco; reinstalar = nova identidade = re-parear |
| `device_id` | continua em `app_settings`, local; **nunca** entra no backup (conferido: `exportBackupV2` manda só snapshot+notas+pastas) |
| Pareamento | lista de descobertos → **SAS de 6 dígitos** iguais nos dois aparelhos → allowlist de EndpointID |
| Revogação | "Desemparelhar" remove o par e libera a purga das lápides que ele segurava |
| Desligar sync | **pausa**: para de anunciar e encerra o endpoint, mas preserva pares, nomes e cursores |

### Modelo de dados

| Tema | Decisão |
|---|---|
| Conflito | **LWW** por linha: maior `updated_at` vence; empate → menor `device_id` |
| Carimbo | **HLC-lite**: `updated_at = max(relógio local, maior visto + 1)` (`src/lib/hlc.ts`); o maior visto vive em `app_settings.hlc_last` |
| Cursor | por **par × device de origem** (`sync_cursors(peer_id, owner, updated_at)`) — cursor global quebra com relógio adiantado |
| Reestampa | `saveSnapshot` só carimba **linha alterada** (`planRows`); a inalterada preserva `updated_at`/`device_id` |
| Purga de lápides | só abaixo do **menor `last_sync_at` dos pares pareados**; sem par, purga tudo; par que nunca sincronizou (`last_sync_at = 0`) segura a purga |
| Escopo v1 | todas as linhas: snapshot (categorias, hábitos, logs, transações, blocos, trackers, registros) + `shared_settings` + `counters` + notas/pastas + grafo |
| Anexos | **v2** (blobs); v1 mostra o anexo que falta como não sincronizado |
| `preferences` | **não sincroniza** (som/háptica/tema são do aparelho) |
| Modo de teste | sync **desligado** (banco e `device_id` próprios; juntar fixture no real seria corrupção) |
| XP | **contador por aparelho** (`counters`); o total exibido é a soma — dois aparelhos ganhando XP não se sobrescrevem |
| Life Force / finance | singleton com **LWW** (`shared_settings`): `value` decai e satura localmente, então "incremento perdido" é ruído de gamificação, não dado |
| `habit_logs` | id **determinístico** `hlog:<habitId>:<date>` (há `UNIQUE(habit_id, occurred_on)`; id aleatório colide no merge) |
| Nota em conflito | LWW na nota + **cópia** marcada com `conflictOf`/`conflictedAt` no payload e rótulo na UI (i18n-safe), na mesma pasta |

### Merge, UI e processo

| Tema | Decisão |
|---|---|
| Onde mescla | no **Rust** (sqlx direto), payload-agnóstico; emite evento e o front recarrega |
| Front com edição aberta | recarrega e **preserva o rascunho**, com aviso "atualizado de outro dispositivo" |
| Primeiro sync | **backup automático** (`exportBackupV2`) + resumo do que vai juntar, antes de conectar |
| UI | seção **Sincronização** nas Configurações (Paraglide `m.*`): toggle, lista de devices com "sincronizado há X", Parear, Desemparelhar; sem indicador no shell |
| iOS | `InfoPlist.strings` em `pt-BR.lproj` + `NSBonjourServices` + `NSLocalNetworkUsageDescription` (não passa pelo Paraglide) |
| Windows | prompt do Firewall (UDP de entrada) aceito e documentado; instalação continua per-user sem admin |
| Testes | Rust: 2 endpoints iroh + 2 SQLite temporários (protocolo, LWW, cursor, lápide, convergência, conflito de nota) no CI |

## 4. Fatias

| Fatia | Conteúdo | Estado |
|---|---|---|
| **P1** | Metadados de sync (migração v6): `notes.updated_at` → epoch ms, `folders.updated_at`, `shared_settings`, `counters`, `sync_peers`/`sync_cursors`, ids determinísticos de log, HLC, gravação só da linha alterada, purga por par | ✅ |
| **P2** | Engine: E0a (PoC Windows↔Windows) → endpoint iroh LAN, protocolo/cursor, LWW, evento pro front | ✅ **P2a–P2c** |
| **P3** | Pareamento SAS + allowlist + store de pares | ✅ |
| **P4** | Descoberta iOS (bridge Swift) + `project.yml`/`InfoPlist.strings` | ✅ (device pendente) |
| **P5** | UI de Sincronização + backup/resumo do primeiro sync + rótulo de conflito | ✅ |
| **P6** | Anexos (blobs) | fora do ciclo |

### Estado do P2 (em andamento)

**P2b (engine) ✅** — `sync/store.rs` + `sync/session.rs`:

- Colunas e chave saem de `PRAGMA table_info` (nada de lista paralela); tabela
  fora de `SYNC_TABLES` ou coluna desconhecida aborta o lote.
- Delta por **origem × cursor** (`updated_at >= cursor`, justificado abaixo);
  linhas do próprio par não voltam.
- Merge LWW por linha (`should_apply`): maior `updated_at`; empate → menor
  `device_id`; linha sem `device_id` conta como `legacy` (perde empate).
- Sessão em dois turnos na mesma conexão; cursores e `last_sync_at` só no fim,
  então sessão cortada reenvia e o merge idempotente resolve.
- `hlc_last` sobe para o maior carimbo recebido; `last_sync_at =
  max(agora, maior recebido)` (corte seguro da purga).
- Detalhe do `>=`: um salvamento carimba várias linhas com o mesmo `updated_at`;
  com `>` o cursor pularia as que ficaram fora do lote. Reenviar o carimbo do
  cursor é barato e o LWW descarta.
- Testes Rust (31 no total): convergência nos dois sentidos, re-sync idempotente,
  LWW, empate, lápide, linha `legacy`, cursor, stats/HLC, recusa de schema.

**P2a (PoC E0a) ✅** — `src-tauri/src/sync/`:

- `identity.rs`: Ed25519 em `atlas-identity.key` (0600, gravação atômica); arquivo
  corrompido é erro, nunca gira a identidade sozinho.
- `engine.rs`: endpoint com `presets::Minimal` (sem relay, sem DNS/Pkarr da n0) e
  ALPNs `atlas/sync/1` **e** `atlas/pair/1` (o acceptor roteia pelo ALPN
  negociado); `dial`/`accept` trocam `hello` e recusam proto/schema.
- `discovery.rs`: anúncio DNS-SD `_atlas-sync._udp.local.` com `id=<EndpointID>`
  no TXT; endereços via `addr_auto` (o endpoint liga em `0.0.0.0`).
- `protocol.rs`: framing `u32` big-endian + JSON, teto de 4 MiB.
- `examples/sync_poc.rs`: dois terminais se acham e trocam hello; ID menor disca.
  Verificado no **macOS** (dois processos); teste de convergência do hello roda
  no CI, sem mDNS (addr direto de loopback).
- Gotcha: `finish()` e `conn.close()` na mesma hora descarta o frame em voo — o
  acceptor espera o outro lado fechar antes de fechar a conexão.

**P4 (descoberta no iOS) ✅** — `sync/discovery_ios.rs` + projeto Xcode:

- O mDNS cru exigiria o entitlement multicast (negado pela Apple); a descoberta
  usa o **DNS-SD C** (`DNSServiceRegister`/`Browse`/`Resolve`, que estão no
  libSystem), sem plugin Swift e sem mudança de protocolo.
- Uma thread por processo faz `poll` nos sockets do DNS-SD e chama
  `DNSServiceProcessResult`; os callbacks atualizam um estado compartilhado.
  TXT `id`/`v`, host resolvido com `getaddrinfo` (mDNSResponder entende
  `.local`), porta do endpoint em ordem de rede.
- O Rust lê o snapshot a cada 1 s e alimenta o mesmo mapa de descobertos do
  desktop; `sync_start`/`sync_stop` ligam/desligam o registro e o browse.
- `sync` e os commands passaram a compilar no iOS; `mdns-sd` ficou
  desktop-only. iroh roda nos dois.
- `project.yml`: `NSBonjourServices` (`_atlas-sync._udp`),
  `NSLocalNetworkUsageDescription`, `InfoPlist.strings` pt-BR e os frameworks
  `Network`/`SystemConfiguration` (iroh/netdev).
- Verificado: `cargo check --target aarch64-apple-ios-sim` e
  `npx tauri ios build --debug --target aarch64-sim` → `Atlas.app`.
- **Device (pendente)**: prompt de Rede Local, descoberta real iPhone↔Windows,
  SAS e edição nos dois sentidos (checklist em `docs/IOS-SIDELOAD.md`).
- **Diagnóstico (rodada mobile)**: os callbacks `DNSService*` e o `getaddrinfo`
  do host `.local` agora gravam a falha no estado da descoberta (código +
  mensagem; `PolicyDenied` vira instrução de Rede Local). `SyncStatus.discovery`
  expõe `state` (`off`/`starting`/`announcing`/`browsing`/`permission`/`error`),
  `found` e `message`; a seção Sincronização mostra a linha **Descoberta**,
  reinicia só ela (`sync_discovery_restart`, sem derrubar o endpoint) e abre
  Ajustes quando a permissão foi negada. Falha de descoberta não impede mais o
  `sync_start`: o pareamento manual por `ip:porta` continua disponível.
- **Correção do pareamento (erro 120)**: `engine::bind` anunciava só
  `atlas/sync/1`; o iroh recusa no handshake TLS qualquer ALPN fora da lista,
  então o acceptor abortava `atlas/pair/1` (`error 120`). O endpoint agora
  anuncia os dois e um teste usa `engine::bind` como acceptor + dial de
  pareamento.
- **Correção da descoberta no iOS**: as assinaturas de `DNSServiceBrowseReply` e
  `DNSServiceResolveReply` omitiam `interfaceIndex` (3º parâmetro), deslocando
  todos os argumentos — o índice era lido como erro e nenhum evento entrava.
  O índice do browse agora vai para o `DNSServiceResolve`, e nomes com escapes
  DNS-SD (`\032`) são decodificados.
- **Loop que não gira em falso**: erro em `DNSServiceProcessResult` desaloca e
  remove o ref; para register/browse a descoberta para com mensagem por *call
  site* (`register`/`browse`/`resolve`) em vez de repetir `BadReference` para
  sempre; `EINTR` do `poll` é ignorado. `tools/dnssd-probe.sh` roda o mesmo
  módulo no macOS (valida ABI + resolve sem instalar no iPhone).

**P5b (UI + boot + evento) ✅** — `src/lib/sync.ts` + Configurações + notas:

- `src/lib/sync.ts`: wrappers dos commands (`sync_status/start/stop/now`,
  `sync_discovery_restart`, `sync_discovered`, `sync_pair_begin/confirm`,
  `sync_unpair`) e dos eventos (`atlas://sync-applied`, `sync-pair-request`,
  `sync-paired`).
- Seção **Sincronização** em Configurações (Paraglide): toggle, estado
  ("Procurando…"/"Desligado"), pares com "sincronizado há X", **Sincronizar
  agora**, **Parear** e **Desemparelhar** (confirmação). Sem indicador no shell.
- Sub-sheet de pareamento: lista de descobertos com polling de 2 s, "Pareado"
  para quem já está na allowlist e **Parear por endereço** (EndpointID +
  `ip:porta`) para o caminho manual.
- Sheet global do SAS (6 dígitos) para pedidos que chegam; o app nunca confirma
  sozinho.
- Primeiro sync: antes de ligar, grava `backups/atlas-antes-do-sync-<ts>.zip`
  (`exportBackupV2`) e mostra o resumo do que vai se juntar. Só quando nenhum
  par tem `last_sync_at > 0`.
- `sync_enabled` ligado → `sync_start` no boot (aceite do S10).
- `atlas://sync-applied`: o shell recarrega o snapshot, pede ao `NotesView` para
  reler as notas (o editor grava o rascunho primeiro — a fila de escritas é
  aguardada) e mostra "Atualizado de outro dispositivo".
- Chip "Conflito" na lista de notas quando o payload tem `conflictOf`.
- Modo de teste: seção escondida e `sync_stop` ao ligar o modo.
- Testes: 127 no Vitest (rótulo relativo, SAS sheet, seção de sync); nada de
  Rust mudou.

**P5a (conflito de nota) ✅** — `store.rs`/`session.rs`:

- Quando a linha que chega **perde** o LWW, as duas versões estão vivas (sem
  lápide) e o carimbo dela é **estritamente maior** que o cursor daquele par
  antes da sessão, uma nota conflitante vira cópia.
- A cópia mantém título/conteúdo perdedores, ganha id `conflict-<hex>`, fica na
  mesma pasta e leva `conflictOf`/`conflictedAt` no payload (o rótulo é da UI).
- Carimbo da cópia = `max(agora, maior carimbo desta origem, hlc_last) + 1`:
  abaixo do que o par já viu, ele nunca puxaria a cópia (cursor por origem).
- Reenvio do mesmo carimbo (`>= cursor`) não duplica; lápide não gera cópia.
- `ApplyStats.conflicts` alimenta o log/evento. Limitação conhecida: um relay
  por terceiro pode gerar uma cópia a mais (preferimos duplicar a perder dado).

**P3 (pareamento) ✅** — `sync/pair.rs` + commands:

- ALPN próprio `atlas/pair/1`: é o único caminho que atende um par fora da
  allowlist, e só até os dois lados confirmarem.
- Fluxo: `PairRequest{proto, device_id, name, nonce}` →
  `PairResponse{device_id, name, nonce}` → cada lado exibe o SAS e envia
  `PairDecision{accept}`. Quem discou lê primeiro e fecha; o acceptor lê a
  decisão, responde, espera o fechamento e fecha (mesmo flush do hello).
- SAS = 6 dígitos de `SHA-256("atlas/sas/1" + ids ordenados + nonce do dialer +
  nonce do acceptor)`; MITM teria nonces diferentes e os códigos não bateriam.
- Nonce novo por pedido, TTL de 2 min, 3 tentativas por par; recusa/erro não
  grava par.
- Commands: `sync_discovered`, `sync_pair_begin(peer, ipPorta?)`,
  `sync_pair_confirm(peer, accept)`, `sync_unpair(peer)`. Pareamento exige o
  sync ligado; sem descoberta, informe `ip:porta` (não há relay).
- Eventos: `atlas://sync-pair-request` `{peer, name, sas}` (prompt do lado que
  recebe) e `atlas://sync-paired` `{peer, name}`.
- O par entra em `sync_peers` com o nome que o outro declarou no anúncio;
  `sync_unpair` apaga par + cursores (purga no próximo boot).
- Testes Rust (41 no total): SAS igual dos dois lados, 6 dígitos, nonces mudam o
  código, recusa de um lado aborta os dois, proto incompatível.

**P2c (wiring) ✅** — `sync/commands.rs` + `lib.rs`:

- Commands: `sync_start`, `sync_stop`, `sync_now`, `sync_status` e
  `sync_cursors` (diagnóstico). Só desktop, como o resto do módulo.
- Opt-in em `app_settings.sync_enabled` (ausente = desligado); `sync_start`
  liga a flag, `sync_stop` desliga preservando pares/cursores. O banco de teste
  (`sqlite:atlas.test.db`) **recusa** `sync_start`/`sync_now`.
- Allowlist = `sync_peers`, checada **antes** de responder o hello (par
  desconhecido recebe `Refuse` e não vê metadado). `sync_now` só disca pares já
  descobertos com EndpointID maior (o menor inicia).
- Evento `atlas://sync-applied` `{peer, applied, skipped, at}` quando algo foi
  aplicado ou ignorado; o front recarrega no P5.
- Loop de descoberta com dedupe e cooldown de 30 s por par; accept e mDNS param
  quando o endpoint fecha (`sync_stop`).
- `nextWriteStamp` no front agora **relê** `hlc_last` a cada gravação: o merge
  no Rust sobe o carimbo por fora do cache do JS.
- Verificação manual (macOS) via console do WebView: `sync_start`,
  `sync_discovered`, `sync_pair_begin` + `sync_pair_confirm` (P3), `sync_status`,
  edição nos dois bancos.
- Windows: prompt do Firewall (UDP de entrada) documentado em
  `docs/WINDOWS-INSTALLER.md`.

## 5. Verificação manual (só o usuário)

- **iPhone**: prompt de Rede Local, descoberta real, SAS, edição nos dois sentidos. Depende do `.ipa` via SideStore (`docs/IOS-SIDELOAD.md`).
- **Windows**: prompt do Firewall na primeira execução; roteiro em `docs/WINDOWS-INSTALLER.md`.
