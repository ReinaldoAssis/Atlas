# Handoff — Atlas · sync Mac↔iPhone: pareamento, descoberta e re-pareamento

> Sessão: fixes de pareamento (erro 120), descoberta DNS-SD no iOS e duplicação
> de notas ao re-parear. Specs: `docs/SYNC.md` §P3/P4/P5a, `docs/ROADMAP.md`.
> Repo: `/Users/reinaldoassis/Developer/Atlas`.

## Estado

- `main` em `6c26f4e` (PR #37 mergeado, v0.3.2).
- PR **#38** (`fix/sync-pair-alpn-and-ios-discovery` → `main`) com os três fixes;
  CI deve fechar verde. Merge por squash quando verde.
- Device: o usuário validou **pareamento + sync repetido** no Mac+iPhone antes do
  fix de dedupe. Falta revalidar o ciclo desemparelhar → parear → sync com o
  build novo.

## Causas e fixes

1. **Pareamento `error 120`** — `engine::bind` anunciava só `atlas/sync/1`; o
   iroh recusa ALPN fora da lista no handshake TLS. Agora anuncia
   `[protocol::ALPN, pair::ALPN]` + teste de regressão em `pair.rs` que usa
   `engine::bind` como acceptor (falha com o erro exato antes do fix).
2. **iPhone sem descoberta** — `BrowseReply`/`ResolveReply` não tinham
   `interface_index: u32` (3º parâmetro do `dns_sd.h`), então todos os
   argumentos deslocavam uma casa. O índice do browse vai para o
   `DNSServiceResolve`; nomes com escape `\DDD` são decodificados.
   Prova: `tools/dnssd-probe.sh` dava `found=0`/`erro 1/11`, agora `found=1`.
3. **Loop em falso no iOS** — erro em `DNSServiceProcessResult` agora desaloca e
   remove o ref; register/browse param a descoberta com mensagem por call site
   (`register`/`browse`/`resolve`), sem repetir `BadReference`; `EINTR` do poll
   é ignorado.
4. **Duplicação ao re-parear** — desemparelhar apaga `sync_cursors`, o próximo
   sync reenvia o delta completo; linha que empatava com a local era tratada
   como edição concorrente e virava cópia de conflito. Agora `apply_rows` pula
   a cópia quando carimbo **e** origem são iguais (`same_row`). Teste:
   `repairing_after_losing_cursors_does_not_duplicate_notes`.

## Dados de campo (Mac, 17/10 ~19:49)

- `~/Library/Application Support/com.randroi75.atlas/atlas.db`: 5 notas, sendo
  2 cópias `conflict-…` idênticas às originais ("Nova nota", "Sync") criadas
  pelo bug de re-pareamento. Não foram apagadas (decisão do usuário).
- Observação: o front reescreveu o payload das cópias e perdeu
  `conflictOf`/`conflictedAt`; o id `conflict-<hex>` continua sendo o marcador
  confiável. Se for limpar, usar `id LIKE 'conflict-%'` e conferir conteúdo.

## Pendências

- Revalidar no device: desemparelhar → parear → sync; contagem de notas estável
  e `sync_status` sem `discovery.error`.
- Decidir se as 2 cópias antigas saem (SQL manual ou ferramenta de limpeza).
- Se `getaddrinfo("*.local")` falhar no iPhone em outra rede, trocar por
  `DNSServiceGetAddrInfo` (não precisou nesta rodada).
- Limitação conhecida: relay de terceiro pode gerar uma cópia a mais (ver
  `docs/SYNC.md` §P5a).

## Comandos

```bash
# sonda DNS-SD no Mac (app macOS anunciando)
tools/dnssd-probe.sh "Atlas probe" 8
# checks
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios
npm run check && npm test && npm run build
```
