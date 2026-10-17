# Atlas — roadmap planejado

Plano para as seis frentes pedidas, com pesquisa já feita e decisões recomendadas.
Escopo do produto: `docs/MVP.md`. UI: `docs/DESIGN.md`. Estado do iOS: `context/atlas-ios-handoff.md`.

> Esforço em **dias-dev** (1 dev, foco parcial). Ranges são estimativas, não compromisso.
> IDs de tarefa (`A1`, `B3`, …) para rastrear em issues/commits.

---

## Decisões travadas (aprovadas — prevalecem sobre as recomendações abaixo)

**Produto / repo**
- App **pessoal** + **open source**; licença **GPL-3.0**; repo **público** em `github.com/ReinaldoAssis/Atlas`.
- **Sem custo**: nenhuma assinatura Apple/Windows paga.
- Ritmo **5–10 h/semana**; **feature branch + PR**, CI obrigatório; fatias sempre verdes.

**Plataformas**
- Ciclo atual: **iOS + Windows** (macOS depois). Máquina de trabalho atual: **macOS** (Xcode 27) — o Mac faz iOS; Windows só via CI/parceiro.
- Windows: **NSIS, per-user, x64**, instalador **sem code signing** (SmartScreen aparece). **O build do instalador roda no job Windows do CI**, não na máquina local (macOS não gera NSIS). A verificação manual do instalador continua exigindo uma máquina Windows.
- **Updater** via **GitHub Releases**, **só Windows**; release por **tag semver**, versão **automática pela tag**.
  - O instalador do release sai **assinado** (minisign) e o `latest.json` é publicado no mesmo release; a chave privada só existe nos secrets do repositório (`docs/RELEASES.md`).
  - `createUpdaterArtifacts` entra por `--config` **só no workflow de release** (build de PR/local não precisa de chave).
  - UI: linha em Configurações só quando é app Tauri **no Windows**; `process:allow-restart` para reabrir depois de instalar. Plugins ficam sob `cfg(desktop)` no Cargo (`tauri ios build` não os compila).
- CI: job **ubuntu** (check + vitest + cargo test) **+ job Windows** (check + test; build do instalador na fatia S7).

**iOS**
- **SideStore** (grátis), **Apple ID separado**. Device **iOS 26.5+**. `minimumSystemVersion` **fica 15.4**.
- AltStore PAL / notarização / assinatura paga: **descartados**.
- Ícone novo **fora** do ciclo; `PrivacyInfo.xcprivacy` **entra**.

**Storage / dados**
- Migrações **versionadas (`PRAGMA user_version`)**; fim do `DELETE`-all → **upsert por linha**; **tombstones 30 dias**; **device_id + epoch ms**.
- **Notas** ganham tombstone (anexos seguem no disco); **grafo em tabelas** `nodes/edges/domains`.
- **Boot vazio**: só categorias padrão, grafo só com origem, XP/streak/Life Force nos valores base; **limpeza automática** dos `demo-*` na migração (a instalação atual só tem dados demo).
- **Modo de teste**: banco separado `atlas.test.db`, flag em `localStorage`, **device_id próprio**, fixtures de **todos os módulos**, banner; desligar volta ao `atlas.db`.

**UI / i18n / hardening**
- i18n com **Paraglide**, **só pt-BR** por ora, migração **incremental**.
- Kit mínimo: **Sheet + Toggle + Segmented**; **reescrever Configurações**; demais overlays ficam p/ depois.
- Pendências do handoff no ciclo: **backup + openAttachment**, **PrivacyInfo**, **remover cabeçalho duplicado**, **verificar shell no device**.
- **CSP fechada** (S8) em `src-tauri/tauri.conf.json`; validada por `npm run csp:check`:
  - `script-src` precisa de **`'wasm-unsafe-eval'`** — o markdown (Shiki/Oniguruma) compila WASM; sem isso o Carta falha inteiro e a nota cai no aviso de erro;
  - `style-src` precisa de **`'unsafe-inline'`** — os `style={...}` do Svelte e o `style="display: contents"` do HTML do SvelteKit;
  - sem `asset:`/remoto: o app não carrega imagem/fonte/script de fora (fontes e KaTeX saem no bundle);
  - vale **só no app empacotado**: em `dev` o HTML vem do Vite (`devUrl`), e o Tauri só aplica a CSP nas respostas do protocolo `tauri://localhost`.

**Testes** — unit (Vitest) + Rust (`cargo test`) primeiro; componente/browser/e2e depois.

---

## 0. Fatos do repositório que condicionam tudo

Levantamento do código atual (relevante para as features abaixo):

| # | Achado | Onde | Impacto |
|---|---|---|---|
| 0.1 | Há **seed automático de dados de exemplo** no 1º boot: `defaultHabits()` (ids `demo-*`), `demoTransactions()`, `demoTimeBlocks()`, `demoFinanceState()`, `createGraphFromDemo()`. | `src/lib/atlas.ts`, `src/lib/storage.ts` (`initializeDatabase`, linhas 135–168) | Feature "sem exemplos" precisa remover isso + limpar instalações já semeadas. |
| 0.2 | **`saveSnapshot` apaga tudo e reinsere** (`DELETE FROM …` para 6 tabelas + `INSERT` de tudo) dentro de `db_batch`. | `src/lib/storage.ts`, linhas 280–327 | **Incompatível com sync incremental.** Sync exige upsert por linha + tombstones de delete. Pré-requisito duro. |
| 0.3 | Persistência por tabela com colunas mínimas (`id`, `occurred_on`/`starts_at`, `payload` JSON) e **sem `updated_at`/`deleted_at`/`device_id`**. | `src/lib/storage.ts` | Sem carimbo de tempo/lápide não dá para resolver conflito num merge P2P. |
| 0.4 | `createEmptySnapshot()` **não é vazio** — embute os demos e `lifeForce.value = 50`. | `src/lib/atlas.ts`, 180–208 | "Empty" hoje é "demo". Precisa virar vazio de verdade. |
| 0.5 | Modais em `.modal-card` com `eyebrow` "ATLAS · SEU ESPAÇO" (viola `DESIGN.md`: sem eyebrows, poucas palavras), além de sheets legados (`.fin-sheet`, `.tp-sheet`, `.habit-prototype-sheet`). | `src/routes/+page.svelte`, 2219–2263 | Existe **padrão de sheet** no protótipo, mas sem componente reutilizável. |
| 0.6 | **Sem testes, sem CI, sem Vitest.** `package.json` só tem `check`. | repo | Infra de testes parte do zero. |
| 0.7 | Máquina de trabalho atual é **Windows**; iOS exige o **Mac** do handoff. | env | Windows build é nativo aqui; iOS continua no Mac. |
| 0.8 | `src-tauri/gen/apple/app_iOS/` tem `Info.plist` e `app_iOS.entitlements`. `PrivacyInfo.xcprivacy` **não existe** (pendência do handoff). | `src-tauri/gen/apple/` | P2P local + distribuição Apple exigem editar esses arquivos. |

**Conclusão estrutural:** a ordem correta não é a ordem da pergunta. Limpar o seed (feature 5) e refatorar o storage para upsert incremental (pré-requisito da feature 2) vêm **antes** de sync. Componentizar sheet (feature 6) vem antes de polir telas. Testes (feature 4) entram cedo, junto da fundação.

---

## 1. iOS — build com validade longa, de graça (e o que "de graça" não cobre)

### 1.1 Pesquisa: o que é possível hoje (2026)

| Caminho | Validade | Custo | Requer PC | Limites | Veredito |
|---|---|---|---|---|---|
| **Apple ID grátis (Personal Team)** | **7 dias** por perfil | R$ 0 | Sim, p/ re-assinar | 3 apps, ~10 App IDs/semana | Base de tudo "grátis". Curto por design. |
| **AltStore Classic** (AltServer no PC) | 7 dias, renovável | R$ 0 | Sim, na mesma Wi‑Fi a cada 7 dias | 3 apps | Grátis, mas exige PC vivo semanalmente. |
| **SideStore** (auto-refresh) | 7 dias, **renovado automaticamente** | R$ 0 | Só no setup (depois não) | 3 apps (+LiveContainer) | **Melhor opção grátis.** Reassina via VPN local + Automation do Atalhos. |
| **AltStore PAL (Brasil)** | **Nunca expira** (app notarizado) | Requer **Apple Developer Program (US$ 99/ano)** + notarização | Não | Notarização Apple | Liberado no Brasil em **18/06/2026** (CADE). Exige **iOS 26.5+** e conta BR. Publicar o próprio app **não é grátis**. |
| **Apple Developer Program (US$ 99/ano)** | Perfil Dev/Ad Hoc ~**1 ano**; TestFlight 90 dias | US$ 99/ano | Não (após setup) | Ad Hoc ≤100 devices | Caminho "longo e estável". |
| **Ad Hoc** | ~**1 ano** | US$ 99/ano | Não | Exige UDIDs | Bom p/ poucos devices fixos. |
| **TrollStore / certificados enterprise "revoltados"** | "para sempre" / errático | R$ 0 | Não | TrollStore só iOS antigo; enterprise revogado = inseguro/ilegal | **Não recomendado.** Não serve p/ iOS 26. |

Fatos-chave da pesquisa:
- Conta grátis: perfil expira em **7 dias**, **3 apps**, ~10 App IDs/semana. **Não existe** forma oficial de esticar isso.
- **AltStore PAL chegou ao Brasil** (18/06/2026), após decisão do CADE; requer **iOS 26.5+**, conta brasileira e Safari.
- Publicar no PAL é "grátis" como plataforma, mas **exige Apple Developer Program pago + notarização** no App Store Connect. Em troca: instala sem PC e **o app nunca expira**.
- **SideStore** reassina sozinho (StosVPN/LocalDevVPN + atalho de Automation no iOS). O relógio de 7 dias continua, mas o refresh é automático — na prática, uso contínuo.
- **TestFlight**: 90 dias por build (incluso no plano pago). Útil p/ betas, não p/ uso pessoal longo.

### 1.2 Recomendação

1. **Uso pessoal contínuo com custo zero → SideStore com auto-refresh.** É a única resposta honesta para "grátis e longo prazo": não existe validade longa grátis, mas o refresh automático dá continuidade. Documentar setup passo a passo.
2. **Uso sério / parar de se preocupar → Apple Developer Program (US$ 99/ano).** Dá perfil de ~1 ano e, opcionalmente, distribuição via AltStore PAL no Brasil com app **que nunca expira**.
3. **Descartar** TrollStore (iOS antigo) e certificados enterprise de terceiros (risco de revogação/segurança).

### 1.3 Tarefas

| ID | Tarefa | Entregável | Est. |
|---|---|---|---|
| D1 | Spike de assinatura: gerar `.ipa` instalável com o Personal Team atual (`developmentTeam` já em `tauri.conf.json`) | `.ipa` + nota de comandos | 0.5 |
| D2 | Produzir `.ipa` "release" a partir do archive do Xcode (não só `--debug`) | script/doc de build | 1 |
| D3 | Instalar via **SideStore**, gerar par de pairing, configurar LocalDevVPN + Automation do Atalhos | `docs/IOS-SIDELOAD.md` em pt-BR | 1 |
| D4 | Adicionar `PrivacyInfo.xcprivacy` (fs usa file timestamp) | arquivo no bundle | 0.5 |
| D5 | Regenerar ícone de fonte 1024×1024 **sem alpha** (`npx tauri icon`) | `src-tauri/icons/*` + `Assets.xcassets` | 0.5 |
| D6 | *(Opcional, se assinar US$99)* Fluxo Ad Hoc/AltStore PAL: notarização, source JSON, host do ADP | doc + source | 2–3 |
| D7 | Registrar decisão usada/limites/renovação em `context/` | nota curta | 0.5 |

### 1.4 Aceite
- App abre no iPhone e **sobrevive à janela de 7 dias** sem intervenção manual (SideStore), **ou** há `ipa` notarizado que não expira (pago).
- `PrivacyInfo.xcprivacy` presente; ícone sem alpha; passos reproduzíveis por outra pessoa.

### 1.5 Riscos
- SideStore: pairing/VPN quebram com update do iOS; refresh precisa do Atalho configurado e Wi‑Fi. Mitigar com doc + aviso no app.
- PAL exige **iOS 26.5+**; se o device estiver abaixo, o caminho notarizado não instala.

---

## 2. Sync P2P na mesma rede (auto-descoberta + auto-conexão)

### 2.1 Pesquisa

- **iroh** (Rust, crate `iroh`) é a aposta mais direta: conexões QUIC P2P, endpoint identificado por chave pública, com **`MdnsDiscovery`** para descobrir pares na LAN e relay como fallback. **Suporta iOS, macOS, Windows** (confirmado na matriz de plataformas).
- Sync de estado: o próprio iroh tem **`iroh-docs`** (KV com reconciliação por range) e há exemplo oficial de **Automerge sobre iroh**. Alternativas CRDT em Rust: **Loro**, **Yjs/yrs**.
- **Gotcha iOS (bloqueador confirmado):** o mDNS cru do iroh (`swarm-discovery`/`iroh-mdns-*`) sai por socket BSD multicast, que no iPhone físico exige o entitlement restrito `com.apple.developer.networking.multicast` — e a Apple **nega** o pedido quando o objetivo é mDNS direto. Só passa pelo mDNSResponder do sistema (`NWBrowser`/`NSNetService`), que precisa apenas de permissão de **Rede Local** (`NSLocalNetworkUsageDescription`) + `NSBonjourServices`. Consequência: iOS por Bonjour nativo e Windows por **DNS-SD padrão** (`mdns-sd`; o `swarm-discovery` não emite PTR e é invisível ao iOS). Detalhe em `docs/SYNC.md` §2.
- Tauri já embute `Info.plist` por merge: `bundle.iOS.infoPlist` (ou `Info.plist`/`Info.ios.plist` na raiz do Tauri).
- **Bloqueador de schema:** hoje `saveSnapshot` faz `DELETE`-all + `INSERT`-all (0.2) e não há `updated_at`/`deleted_at`/`device_id` (0.3). Sem isso não existe merge possível. Isso deve ser resolvido **antes** de qualquer protocolo.

### 2.2 Decisão (fechada — detalhe em `docs/SYNC.md`)

Sessão de alinhamento (out/2026) travou 29 decisões; o resumo:

- **Transporte**: iroh 1.0, **só LAN** (sem relay/DNS da n0), ALPN `atlas/sync/1`.
- **Descoberta**: no iOS **não pode** ser o mDNS cru do iroh — exige o entitlement
  restrito `com.apple.developer.networking.multicast`, que a Apple recusa para
  mDNS direto. iOS usa **Bonjour nativo** (mDNSResponder, sem entitlement);
  Windows usa **DNS-SD padrão** (`mdns-sd`, PTR/SRV/TXT). Ver §2.5.
- **Modelo**: replicação **por linha com LWW** (não CRDT sobre o snapshot).
  Carimbo **HLC-lite** (`max(relógio, maior visto + 1)`), empate pelo menor
  `device_id`; cursor por **par × device de origem**; `saveSnapshot` grava só a
  linha alterada; lápides só purgadas abaixo do menor `last_sync_at` dos pares.
- **Contadores**: XP vira **contador por aparelho** (a soma é o total); Life Force
  e finance ficam LWW (decai/satura localmente).
- **Pareamento**: SAS de 6 dígitos + allowlist de EndpointID; chave em
  `<appdata>/atlas-identity.key`; nada mescla sem pareamento.
- **Merge** no Rust, com evento pro front recarregar (preservando rascunho).

### 2.3 Fases

| ID | Tarefa | Est. |
|---|---|---|
| P1 | **Metadados de sync** (migração v6): `notes.updated_at` em ms, `folders.updated_at`, `shared_settings`, `counters`, `sync_peers`/`sync_cursors`, id determinístico de log, HLC e gravação só da linha alterada | 2–3 |
| P2 | **Engine**: PoC E0a (Windows↔Windows) → endpoint iroh LAN, protocolo por cursor, merge LWW, evento pro front | 3–4 |
| P3 | **Pareamento**: SAS de 6 dígitos + allowlist + store de pares | 2 |
| P4 | **Descoberta no iOS**: bridge Swift (announce/resolve) + `project.yml`/`InfoPlist.strings`/`NSBonjourServices` | 2–3 |
| P5 | **UI**: seção Sincronização, backup automático/resumo do 1º sync, conflito de nota | 2 |
| P6 | Anexos (blobs) — fora do ciclo | 2 |

### 2.4 Aceite
- Dois devices na mesma Wi‑Fi, já pareados, **conectam e convergem sem ação manual** ao abrir o app.
- Edição no device A aparece no B; delete propaga (tombstone); sem duplicar nem perder dados offline.
- iOS mostra o prompt de Rede Local com texto próprio; nada vaza sem pareamento.

### 2.5 Riscos
- **Descoberta no iOS é o risco central** (resolvido por decisão, não por spike): o mDNS cru do iroh exige o entitlement multicast, que a Apple nega para mDNS direto. O caminho é Bonjour nativo (sem entitlement) + DNS-SD no Windows. Se o `NSNetService` não resolver host/porta como esperado (o `NWBrowser` do iOS não resolve sem abrir conexão), o fallback é publicar o IP:porta no TXT do serviço.
- Migração de schema mexe no coração da persistência → fatia isolada (P1), depois dos testes verdes.
- Restaurar backup num aparelho novo deixa linhas com o `device_id` antigo: a purga de lápides olha para os **pares**, não para a origem, então nada trava.

---

## 3. Build do Windows

### 3.1 Pesquisa

- Tauri empacota no Windows como **NSIS** (`.exe`) ou **WiX** (`.msi`); `.msi` só se compila **no Windows** (é o caso aqui). Comando: `npm run tauri build`, saída em `src-tauri/target/release/bundle/{nsis,msi}`.
- **WebView2**: Win11 já tem; Win10 o instalador Tauri resolve (bootstrapper). Considerar `webviewInstallMode` offline se quiser instalar sem rede.
- **SmartScreen**: desde 2024 **EV não pula mais** o aviso automaticamente — OV e EV constroem reputação do mesmo jeito. Opções: (a) aceitar o aviso (uso pessoal), (b) **Azure Trusted Signing** (caminho moderno e barato), (c) Microsoft Store (a Microsoft re-assina e remove o aviso).
- Stack do app já é multiplataforma (SQLite via plugin, dialog/fs/notification). `plugin-haptics` é no-op no Windows; lembretes ficam "enquanto aberto" (MVP).
- `bundle.targets` está em `"all"` — convém escopar por plataforma.

### 3.2 Tarefas

| ID | Tarefa | Entregável | Est. |
|---|---|---|---|
| C1 | Revisar `tauri.conf.json`: `bundle.windows` (targets `nsis`, `installMode`, idioma pt-BR), `productName`/`identifier` | conf | 0.5 |
| C2 | Ajustar `bundle.targets` para não tentar empacotar tudo em toda plataforma; opcional `tauri.windows.conf.json` | conf | 0.5 |
| C3 | Ícone `.ico` sem alpha (mesma fonte do iOS) | icons | 0.5 |
| C4 | Build do instalador no **job Windows do CI** (artefato `.exe`) + verificação manual em máquina Windows (Win11): WebView2, banco em `%APPDATA%`, notificações, dialog/fs | CI + relatório | 1 |
| C5 | *(Opcional)* Azure Trusted Signing ou skip documentado p/ SmartScreen | doc/CI | 1–2 |
| C6 | *(Opcional)* `tauri-plugin-updater` (exige assinatura + host) | — | 2 |

### 3.3 Aceite
- Gera `.exe` (NSIS) e/ou `.msi`; instala, abre, persiste dados, atualiza sem perder dados ao reinstalar.
- Documentado o comportamento esperado de SmartScreen.

---

## 4. Testes unitários e de integração

### 4.1 Pesquisa

- **Vitest** é o padrão do ecossistema SvelteKit. Camadas:
  - **Node/puro** (`.test.ts`): funções de `atlas.ts`, `notes.ts`, `graph.ts`, merge, backup.
  - **Componente DOM** (jsdom): `@testing-library/svelte` + `svelteTesting()`.
  - **Svelte 5 runes / interação real**: **`vitest-browser-svelte`** (Browser Mode, Chromium real) — melhor p/ runas.
- **E2E**: **Playwright** sobre o build estático (web), que já roda no modo "preview" via `localStorage` (não precisa de Tauri). E2E dentro do Tauri é limitado: `tauri-driver` só Windows/Linux (não macOS/iOS).
- **Rust**: `cargo test` para lógica pura (merge, protocolo iroh, `db_batch`) — sem depender da UI.
- **Fake de Tauri**: mockar `@tauri-apps/api` (`isTauri`, `invoke`) e injetar um adaptador de banco para usar SQLite **em memória** (`sqlx`) nos testes de integração de storage.

### 4.2 Alvos prioritários (do código atual)

- `atlas.ts`: `currentStreak` (pausa, dias programados, metas), `experienceProgress`/`xpNeededForLevel`, `dateOffset`/`weekStartDate`/`localDate`, `didMeetTarget`, `money`.
- `storage.ts`: `runSerialized` (ordem/serialização), roundtrip `exportBackup`/`importBackup` (+ cripto), `normalizeImportedSnapshot`, nova lógica upsert/tombstone.
- `notes-store.ts`/`notes.ts`: CRUD, ordenação, migração de estado.
- `graph.ts`/`graph-sources.ts`: `reconcileGraph`, progresso de arestas.
- **sync** (Fase E): convergência LWW, tombstone, idempotência, reconexão.

### 4.3 Tarefas

| ID | Tarefa | Est. |
|---|---|---|
| F1 | Setup Vitest + `vitest.config` (projetos node/jsdom/browser) + setup file + scripts `test`, `test:watch`, `test:ui` | 1 |
| F2 | Adaptador de storage injetável (permite SQLite em memória + fake de `invoke`) | 1–2 |
| F3 | Unit tests das funções puras (`atlas`, `notes`, `graph`) | 2 |
| F4 | Integração storage: upsert/tombstone, fila serial, migração de schema, backup roundtrip | 2–3 |
| F5 | Rust: `cargo test` p/ `db_batch` e (depois) merge/sync | 1–2 |
| F6 | Component tests (`vitest-browser-svelte`) de Sheet, Toggle, Segmented e do fluxo de configurações | 2 |
| F7 | E2E Playwright no build web (boot vazio, test mode, criar/editar/undo) | 2 |
| F8 | CI (GitHub Actions): `npm run check` + `test` + `cargo test` em PR | 1 |
| F9 | Metas de cobertura nos módulos de lógica; comandos no README | 0.5 |

### 4.4 Aceite
- `npm test` e `cargo test` verdes; CI bloqueia PR quebrado.
- Regressões de streak/XP/backup/sync cobertas por teste.

---

## 5. Polimento — remover exemplos + "modo de teste"

### 5.1 Situação atual

- 1º boot **popula** hábitos/transações/blocos/grafo demo (`initializeDatabase`, `createEmptySnapshot`).
- Não há controle para limpar; o usuário recebe dados que não são dele.

### 5.2 Abordagem recomendada

Isolar dados de teste em **um banco separado** — nunca sobrescrever o real.

1. **Primeiro boot vazio de verdade**: sem `demo-*`. Manter apenas `defaultCategories` (necessário: categorias base do MVP). Hábitos, transações, blocos e grafo vazios (grafo só com o nó de origem).
2. **Modo de teste (Configurações)**: ao ligar, apontar a camada de storage para `sqlite:atlas.test.db` e semear fixtures; ao desligar, **voltar para `atlas.db`** exatamente como estava. A flag `testMode` fica em `localStorage` (o `app_settings` vive dentro do banco trocado — não serve p/ essa flag).
3. **Fixtures compartilhadas**: mover os demos atuais para `src/lib/fixtures/*.ts` — usados pelo modo de teste **e** pelos testes unitários (F3–F4).
4. **Limpeza de instalações antigas**: detectar ids `demo-*` (e `seeded`) no `atlas.db` real e oferecer, em Configurações, "Remover dados de exemplo" (uma vez) — nunca automático.
5. **Aviso visual** do modo de teste conforme `DESIGN.md`: banner âmbar neutro (não vermelho), com saída óbvia ("Desativar modo de teste"). Nada de som/vibração exclusivo.
6. **Modo preview (web)** espelha o mesmo comportamento (chaves `localStorage` separadas por modo).

### 5.3 Tarefas

| ID | Tarefa | Est. |
|---|---|---|
| A1 | `createEmptySnapshot()` vazio; remover seed do `initializeDatabase` | 1 |
| A2 | Módulo `fixtures/` com os dados demo atuais (hábitos, transações, blocos, grafo, finanças) | 0.5 |
| A3 | Roteamento de banco por `testMode` (`atlas.db` ↔ `atlas.test.db`) + semeadura só no test DB | 1–2 |
| A4 | Toggle "Modo de teste" em Configurações + banner + copy pt-BR | 0.5 |
| A5 | Ação pontual "Remover dados de exemplo" p/ instalações antigas + migração | 1 |
| A6 | Testes cobrindo: boot vazio, ligar/desligar test mode preserva dados reais | 1 |

### 5.4 Aceite
- Instalação nova abre **vazia** (sem exemplos).
- Ligar o modo de teste popula; desligar **restaura** os dados do usuário intactos.
- Existe caminho não-destrutivo para limpar exemplos de quem já tem.

### 5.5 Risco
- Trocar o caminho do banco troca "tudo" (config, XP, grafo). É intencional, mas exige que a flag de modo more fora do banco e que o app recarregue estado ao alternar (evitar cache em memória).

---

## 6. Refazer modais no estilo do app (`DESIGN.md`)

### 6.1 Problema atual

- `.modal-card` centralizado com **eyebrow "ATLAS · SEU ESPAÇO"** e título longo (`Preferências`) → viola "poucas palavras", "nunca eyebrows".
- Sheets legados (`.fin-sheet`, `.tp-sheet`, `.habit-prototype-sheet`) com estilos distintos, sem componente reutilizável.
- Configurações é uma tela de linhas dentro de um card (não usa tiles/grip/sheet do guia).

### 6.2 Abordagem

Criar o **kit de overlay** que já está descrito em `DESIGN.md` §4 e reusar em todos os fluxos:

- `Sheet.svelte`: overlay + sheet `--s`, raio superior 16–18 px, **grip 40×4**, entrada de baixo p/ cima, fechar por backdrop/Esc/botão, **focus trap**, `aria-modal`, safe-area, `prefers-reduced-motion`. No desktop: sheet lateral/drawer ou central com largura ≤520 px (sem "card dentro de card").
- `Toggle.svelte` (48×28, mola, ligado = lime), `Segmented.svelte` (pílula deslizante), `Chip.svelte`, `Field.svelte`, `Slider.svelte` (trilha 16, polegar 36), `Dialog.svelte` (substitui o `askConfirm`/`askText` inline).
- **Configurações** viram sheet com seções-title (tiles), sem eyebrow, copy curta; toggles do kit.
- Migrar `transaction`/`habit`/`pause` para o mesmo kit; dinheiro com teclado numérico grande e hábito de duração/contagem com slider grande (§11 do guia) — reaproveitando o que já existe no protótipo/`habit-prototype-sheet`.
- Remover classes legadas quando a última tela migrar.
- Movimento/háptica/som pelos helpers já existentes (`feedback.ts`), respeitando as opções.

### 6.3 Tarefas

| ID | Tarefa | Est. |
|---|---|---|
| G1 | `Sheet.svelte` (+ focus trap/Esc/safe-area/reduced-motion) e tokens | 1–2 |
| G2 | `Toggle`/`Segmented`/`Chip`/`Field`/`Slider` (visual exatamente como `DESIGN.md` §4) | 1–2 |
| G3 | `Dialog.svelte` substituindo `askConfirm`/`askText` inline | 1 |
| G4 | Reestilizar **Configurações** (sem eyebrow, tiles, seções, toggles do kit) | 1–2 |
| G5 | Migrar `transaction` e `habit` p/ Sheet + teclado numérico/slider/chips | 2 |
| G6 | Migrar `pause` e demais sheets (fin/tp/habit) p/ o kit; remover classes legadas | 1–2 |
| G7 | Component tests do kit (F6) | (já em F6) |

### 6.4 Aceite
- Nenhum overlay usa eyebrow nem card centralizado antigo; todos usam o kit.
- Animações na mola, toggles/sliders conforme espec, acessível (foco/aria/Esc), respeita reduzir animações.

---

## 7. Sequenciamento aprovado (fatias sempre verdes)

Ordem confirmada pelo usuário. Cada fatia termina com o CI verde e um PR.

| Fatia | Conteúdo | Ref. | Depende de |
|---|---|---|---|
| **S1** | Testes unit (Vitest) + Rust (`cargo test`) + CI (ubuntu + Windows) | F1, F3, F5, F8 | — |
| **S2** | Migrações versionadas + storage incremental (upsert/tombstones) + boot vazio + limpeza automática dos `demo-*` | F2, F4, A1, A5 | S1 |
| **S3** | Modo de teste (banco separado + device_id próprio + fixtures de todos os módulos + banner) | A2–A4, A6 | S2 |
| **S4** | Notas com tombstone + grafo em tabelas `nodes/edges/domains` | A/D (storage) | S2 |
| **S5** | i18n (Paraglide, pt-BR) + kit Sheet/Toggle/Segmented + Configurações reescritas | G1–G4, i18n | S3 |
| **S6** | Pendências do handoff: backup + `openAttachment`, `PrivacyInfo.xcprivacy`, remover cabeçalho duplicado, verificar shell no device | D4, handoff | S5 |
| **S7** | Windows: conf NSIS per-user x64 + ícone `.ico` + **job de build no CI Windows** (artefato do instalador) + verificação manual do instalador numa máquina Windows | C1–C4 | S2 |
| **S8** | Updater (GitHub Releases, Windows) + workflow de release por tag (versão automática) + CSP | C6, hardening | S7 |
| **S9** | iOS/SideStore: `.ipa`, `docs/IOS-SIDELOAD.md`, verificação no device (Mac) | D1–D3 | S6 |
| **S10** | Sync P2P: **P1–P5** (P1 metadados ✅; P2a PoC ✅; P2b engine ✅; P2c wiring; P3 pareamento; P4 descoberta iOS; P5 UI). Decisões e protocolo: `docs/SYNC.md` | P1–P6 | S4, S7 |

> S8 entregue em dois PRs: **CSP** (#14) e **updater + release por tag** (#15).

### Ciclo S11–S14 — backlog de polimento e features (concluído)

Ordem aprovada numa sessão de alinhamento: polimentos/bugs → Notas → Trackers → referência `tempo`. Também entrou o registro de ideias futuras.

| Fatia | Conteúdo | Estado |
|---|---|---|
| **S11** | Criar hábito persistente (a ação sumia após o 1º hábito) · FAB de Finanças fora do `#pg` (o `transform` da troca de aba virava containing block do `position: fixed`) · rótulo "Pausar Atlas" · **Vida → Planejamento** · Notas com `+ Nota`/`+ Pasta` (FAB `+` removido) | ✅ #17 |
| **S12** | Notas: arrastar nota/pasta para o path (raiz = "Notas") · **export PDF** por nota (diálogo de impressão do SO + `@media print`) | ✅ #18 |
| **S13** | **Trackers** — aba em Hábitos, vários registros/dia, meta opcional com direção, gráfico SVG, arquivar/excluir com desfazer; migração v5 (`trackers`, `tracker_entries`) | ✅ #19 |
| **—** | `docs/IDEAS.md`: split tabs · API de dados p/ artifacts HTML (análise de viabilidade) · TODO de integração de tracker | ✅ #20 |
| **S14** | Referência `tempo`/`time` na nota (fallbacks no `updatedAt`) · chip + bolha do bloco · indicador no planejador + bolha com as notas + abrir a nota | ✅ #21 |

Detalhes de estado e o que ficou pendente de verificação manual: `context/atlas-handoff-s11-s14.md`.

> Segue **S10 (sync P2P)** como próxima fatia, em 5 partes (P1–P5). As decisões,
> o protocolo e o bloqueador do iOS estão em **`docs/SYNC.md`**; o "spike E0"
> virou **P2 (PoC Windows↔Windows)** + verificação no iPhone depois de P4.


**Fora do ciclo** (escolhas do usuário): ícone novo (1024 sem alpha), assinatura Windows (Azure Trusted Signing), AltStore PAL/notarização, kit completo + migração dos overlays de lançamento/hábito, i18n em `en`, macOS.

**Estimativa (1 dev, 5–10 h/sem):** S1–S9 ≈ 30–45 dias-dev; S10 (sync) +15–20 dias-dev.

---

## 8. Decisões adiadas

Resolvidas na sessão de sync (out/2026) — ver **`docs/SYNC.md`**:

1. ~~**Sync**: iroh + LWW por linha vs. CRDT~~ → **iroh + LWW por linha** (CRDT descartado).
2. ~~**Descoberta no iOS**: mDNS do iroh ou plano B~~ → **Bonjour nativo** (mDNS cru é bloqueado por entitlement).
3. ~~**Relay/alcance**~~ → **só LAN**; pareamento por SAS de 6 dígitos + allowlist de EndpointID.
4. **SideStore**: detalhes de pairing/refresh e frequência de re-setup (após o primeiro `.ipa` instalado) — segue aberto, depende do usuário.

Ideias registradas mas **não implementadas** (split tabs, API de dados para artifacts, integrações de tracker): ver **`docs/IDEAS.md`**.

---

## 9. Referências

- `docs/MVP.md`, `docs/DESIGN.md`, `context/atlas-ios-handoff.md`
- AltStore PAL no Brasil (CADE, 18/06/2026) e requisitos de publicação: `9to5mac.com` / `faq.altstore.io/developers/distribute-with-altstore-pal`
- SideStore (refresh automático): `docs.sidestore.io`
- iroh 1.0 (P2P, bindings Swift/Kotlin oficiais em jun/2026; local-first sem relay): `www.iroh.computer/blog/v1`, `docs.iroh.computer/connecting/local-address-lookup`
- Permissão de Rede Local + entitlement `com.apple.developer.networking.multicast` (negado para mDNS direto): Apple TN3179, `developer.apple.com/documentation/bundleresources/entitlements/com_apple_developer_networking_multicast`
- Tauri: Windows Installer, Code Signing, Config (`bundle.iOS.infoPlist`): `v2.tauri.app`
- Vitest + `@testing-library/svelte` + `vitest-browser-svelte`: `testing-library.com`, `svelte.dev/docs/svelte/testing`
- SmartScreen/EV (mudança de 2024): `v2.tauri.app/distribute/sign/windows`
