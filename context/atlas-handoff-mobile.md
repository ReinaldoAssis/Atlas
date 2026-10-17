# Handoff — Atlas · pós-S10 (mobile + sync entre dispositivos)

> Sessão anterior: S10 (sync P2P) entregue e **v0.3.1** publicada. Este doc foca
> nos bugs de mobile e na descoberta Mac↔iPhone.
> Specs/planos existentes (não repita): `docs/SYNC.md`, `docs/ROADMAP.md`,
> `docs/DESIGN.md`, `docs/MVP.md`, `docs/RELEASES.md`,
> `context/atlas-handoff-sync-p1.md`.
> Repo: `/Users/reinaldoassis/Developer/Atlas` (branches sempre verdes, PR + CI).

## Estado

- `main` em `cc1ccc5` (v0.3.1). Release **v0.3.1** publicada com Windows
  (`Atlas_0.3.1_x64-setup.exe` + `.sig` + `latest.json`) e macOS
  (`Atlas_0.3.1_aarch64.dmg`, sha256 `a2175a59…a46b`).
- **Branch local `fix/ios-rustls-provider` (commit `a0aa9f0`, NÃO enviada/mergeada)**:
  conserta o crash instantâneo do iOS.
  - Causa: o protocolo `tauri://` no iOS monta um `reqwest` que chama
    `CryptoProvider::get_default().unwrap()` do rustls; o iroh (P4) habilita o
    `ring` mas ninguém chamava `install_default()` → panic em
    `reqwest::...default_rustls_crypto_provider` → SIGABRT.
  - Fix: `rustls::crypto::ring::default_provider().install_default()` no início
    de `run()` (`src-tauri/src/lib.rs`), com `rustls` em `Cargo.toml`
    (`default-features = false`, features `ring` + `std`).
  - Também trocou o panic hook de `NSLog` (C string → segfault; `NSLog` espera
    `NSString`) por escrita em `tmp/atlas-panic.log` + stderr.
  - Verificado no device: app ficou >5 min vivo e **nenhum** crash report novo.
  - **Falta**: push/PR/merge. Não espere CI só por tooling/docs, mas este é
    código do app — vale o CI normal antes do merge.

## Próximas frentes

### 1. Descoberta automática não funciona (Mac ↔ iPhone)

- Sintoma: dois aparelhos na mesma Wi‑Fi não se encontram; só pareamento manual
  por `ip:porta` funciona.
- Código: `src-tauri/src/sync/discovery.rs` (desktop, `mdns-sd`),
  `src-tauri/src/sync/discovery_ios.rs` (iOS, DNS‑SD C via `dns_sd`),
  `src-tauri/src/sync/commands.rs` (`spawn_discovery`/`spawn_discovery_ios`,
  `sync_start`/`sync_discovered`).
- Chamadas úteis:
  - Mac: `dns-sd -B _atlas-sync._udp` (lista anúncios) e
    `dns-sd -L "Atlas xxxxxxxx" _atlas-sync._udp local.` (resolve).
  - iPhone: Ajustes › Apps › Atlas › **Rede Local** precisa estar ligado; o
    prompt só aparece no primeiro uso do DNS‑SD. Sem permissão,
    `DNSServiceRegister`/`Browse` retornam erro (hoje só `log::warn!`, invisível
    no device).
  - Logs: `idevicesyslog -u 00008140-00146D4621C2801C` + `grep -i atlas`; o
    panic hook grava `tmp/atlas-panic.log` no sandbox
    (`xcrun devicectl device copy from --domain-type appDataContainer …`).
- Hipóteses prováveis: permissão de Rede Local negada/ausente; erros do
  `DNSService*` engolidos; `getaddrinfo` de `host.local.` falhando no iOS;
  `sync_start` não chamado (flag `app_settings.sync_enabled`); AP isolation no
  roteador. **Primeiro passo**: surfacear os erros do dns_sd num arquivo
  (mesmo padrão do panic log) e conferir o `dns-sd -B` no Mac.

### 2. Context menu de hábito no mobile

- Sintomas: (a) clicar no canto do card abre o menu (não deveria; no mobile só
  long‑press); (b) menu não fecha ao clicar fora; (c) "Editar" não abre o modal.
- Código: `src/routes/+page.svelte`
  - botão `.hcard-more` (linhas ~2785 e ~2805) — provavelmente só invisível no
    CSS, mas ainda clicável; esconder de verdade no touch (`display:none` ou
    renderizar só com `@media (hover: hover)`), e `aria-hidden`/tabindex.
  - `openHabitMenu` (~1363), `startHabitPress` (~1368), `oncontextmenu` (~2800).
  - menu: `CardMenu` (`src/lib/components/ui/CardMenu.svelte`) — **não tem
    fechar ao clicar fora**; adicionar backdrop/`pointerdown` global (com
    `stopPropagation` no menu) ou reusar o padrão do menu de notas.
  - "Editar": `openHabit(habit)` (~1333) seta `modal = 'habit'`; verificar por
    que o menu aberto/`habitMenu` impede o sheet (talvez o `CardMenu` fique por
    cima e o `openHabit` não limpe `habitMenu`; fechar o menu antes da action).

### 3. Nota no planejador (mobile)

- Sintoma: tocar/clicar no bloco com nota não abre; no desktop o bubble aparece
  em `pointerover` (hover), que não existe no toque; o clique atual parece
  apagar/pintar o bloco.
- Requisito do usuário: se o bloco estiver **perto do centro de foco** e ficar
  parado por **1,5 s**, abrir a nota automaticamente; mover/rolar dispensa.
- Código: `src/routes/+page.svelte` ~1675–1705 (`onOver`, `TimeBubble`,
  `openNoteFromPlanner` ~1659), `beginTimePaint` ~1867 (pointerdown da grade),
  `notesForBlock` em `src/lib/tempo-ref.ts`. O bubble atual é
  `TimeBubble` (`src/lib/bubble.ts`).
- Cuidado: não conflitar com o paint (pointerdown cria/edita bloco). Provável
  solução: timer de 1,5 s no `pointerdown` sobre `[data-tp-block]` com nota,
  cancelado por `pointermove` > ~9 px/scroll, abrindo via
  `openNoteFromPlanner(note.id)`; ignorar se o toque virar paint.

### 4. Swipe Hábitos ↔ Trackers (mobile)

- Hoje só pelo `Segmented` (`habitView`, `src/routes/+page.svelte` ~2731).
- Adicionar swipe horizontal na área (pointer/touch, threshold, respeitar
  `prefers-reduced-motion`) alternando `habitView`. Cuidado com gestos de
  arrastar hábitos/cards e com o scroll vertical.

### 5. Botão "Novo hábito"/"Novo tracker" como tile

- Hoje ocupa a linha inteira: `.habit-prototype-wide` no botão de criar
  (~2770 no +page.svelte) e provavelmente no Trackers
  (`src/lib/components/habits/TrackersView.svelte`).
- Virar um card normal do grid (mesmo tamanho dos cards), mantendo a ação de
  criar; conferir também o texto "Criar primeiro hábito".

### 6. Menu de contexto de nota no mobile

- Sintomas: segurar abre e some logo em seguida; estilo diferente das notas do
  planejador; fundo cinza no botão Excluir.
- Código: `src/lib/components/notes/NotesView.svelte`
  - `rowPointerDown` (~614): no toque arma longPress (480 ms) e abre
    `openMenu`; `onWindowClick` (~220) fecha o menu porque o clique de soltura
    tem alvo na linha, não em `.nt-menu` → some na hora. Usar
    `suppressClick`/timestamp do `pointerup` também no `onWindowClick`, ou
    ignorar cliques nos ~400 ms após abrir.
  - Estilo: `.nt-menu` em `src/app.css` (~648 e ~988) vs `.tbb`/`.tbb-r`
    (~899–951, bubble do planejador) — animação/entrada/posição iguais.
  - "Fundo cinza" no Excluir: `:hover` grudado no toque (`.nt-menu
    button:hover { background:#3a2a26 }`); usar `@media (hover: hover)` e/ou
    `:active` para touch.
- Também garantir que as ações do menu fechem o menu antes de abrir o editor.

### 7. Arrastar nota para mover (mobile)

- Hoje `rowPointerDown` só inicia `drag` para `pointerType === 'mouse'`
  (`NotesView.svelte` ~614); no toque, o longPress abre menu e não há drag.
- Requisito: segurar e arrastar para mover (mesmo destino/pastas do desktop:
  `data-folder`, `moveGhost`, `dropTarget`). Sugestão: no longPress, marcar
  "armado"; se o pointer mover > 8 px antes de soltar, iniciar o drag em vez de
  abrir o menu; ou usar um handle. Testar com o scroll da lista (evitar
  `touchmove` do navegador durante o drag).

## Ambiente / verificação

- Device: iPhone 16 Pro, UDID `00008140-00146D4621C2801C`, iOS 26.6.2. **Precisa
  estar desbloqueado** para `devicectl ... process launch` (senão erro "Locked").
- Build/instalação iOS:
  `npx tauri ios build --debug --target aarch64` →
  `xcrun devicectl device install app --device <UDID> gen/apple/build/arm64/Atlas.ipa`.
- Crash reports: `idevicecrashreport -u <UDID> /tmp/dir`; syslog:
  `idevicesyslog -u <UDID>`.
- macOS local: `tools/build-macos.sh --version X.Y.Z` (build + upload do `.dmg`
  no release; `--no-upload` para local). O script usa `hdiutil` e ejeta volumes
  antigos; release só por tag (`docs/RELEASES.md`).
- Testar: `npm run check`, `npm test` (130), `cargo test` (44).
- CI: 4 checks (frontend ubuntu/windows, rust, instalador Windows). Não bloqueie
  merge de docs/tooling no CI; para mudanças de app, espere.

## Skills sugeridas para a próxima sessão

- `caveman` — usuário em pt-BR, respostas curtas.
- `grilling` — antes de mexer nas interações de toque (dwell 1,5 s, swipe,
  long-press): fechar o comportamento com o usuário antes de implementar.

## Decisões desta sessão (alinhamento com o usuário)

- **Handoff**: este arquivo entra no PR do `fix/ios-rustls-provider`.
- **Entrega**: um **PR único** (`feat/mobile-sync-polish`) depois do rustls,
  empilhado na branch do fix; retarget para `main` quando o rustls mergear.
- **Descoberta**: capturar erros dos callbacks DNS-SD (register/browse/resolve/
  poll) em log; expor estado detalhado no `sync_status` (desligada, anunciando,
  buscando, N encontrados, Rede Local negada, erro) + botão "Reiniciar
  descoberta" e "Abrir Ajustes" no caso de permissão. Mesma linha no desktop.
  Teste desta rodada: **Mac ↔ iPhone** (Windows compila, sem teste de device).
- **Menu de hábito/tracker**: `⋯` só com hover; long-press abre o menu; fecha ao
  tocar fora; clique resultante do long-press é suprimido; "Editar" abre o
  sheet; mesmos consertos nos Trackers.
- **Dwell da nota (planejador)**: 1,5 s, só toque/caneta, só com o **centro do
  bloco** na faixa central de 40–60% da tela; anel de progresso no contorno do
  bloco, na cor da categoria. 1 nota abre direto; 2+ abre a bolha, que fica até
  toque fora/rolar/escolher. Mover >8 px antes de 1,5 s cancela o anel e
  **começa a pintar**; soltar sem mover pinta só a célula.
- **Swipe Hábitos ↔ Trackers**: pager real com as duas views montadas, segue o
  dedo, limiar 48 px / 40% da largura, esquerda = Trackers, direita = Hábitos,
  sem loop, só toque/caneta; animação respeita `prefers-reduced-motion`.
- **Tiles de criar**: card normal (1 célula) na 1ª posição, em todos os
  breakpoints, mantendo o visual vazio; rótulos "+ Hábito" e "+ Tracker".
- **Notas no mobile**: menu só com "Excluir", material de vidro da bolha sem
  cauda, tint da nota, `:hover` só em `hover: hover`; fecha ao tocar fora.
  Long-press (480 ms) + soltar = menu; long-press + mover >8 px = arrasto, com
  háptico/escala ao armar. Pastas também arrastam; soltar pasta parada não faz
  nada. Auto-scroll perto das bordas.
- **Release**: `v0.3.2` só depois do teste no iPhone; build/instalação única no
  fim da implementação.
