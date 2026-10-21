# Atlas — Ciclo S15: rodada de correções e polimento

> **Estado:** alinhado em 18/10/2026 · **E0–E6 implementados; E7 parcial (F2 e
> F3 implementadas em 20/10); E8 pendente**.
> Este documento é a fonte das decisões do ciclo. Se conflitar com
> `ROADMAP.md`, vale este arquivo para o escopo do S15.
>
> **Formato de entrega:** um ciclo único com todas as frentes. A implementação
> continua em **PRs pequenos por frente**, cada um com `npm run check`,
> `npm test` e `npm run build` verdes (ver `AGENTS.md`).

---

## 1. Escopo

25 itens levantados no teste do app, agrupados em seis frentes:

| Frente | Itens |
|---|---|
| **A — Tempo/planejador** | pintura mobile, long press, bolha de notas, preview |
| **B — Notas** | nota "sumida", último modo, menu de contexto, atalho `tempo` |
| **C — Finanças** | limpar lançamentos, excluir categoria, título, meta, budget |
| **D — Hábitos/Trackers** | direção, semanal, chama, tiles, primeiro dia da semana |
| **E — Planejamento/grafo** | drag, trackers como fonte, unidade de streak |
| **F — Sistema/dados** | lixeira global, pausa, notificações iOS, export, updater |

**Fora do escopo:** auto layout do grafo (o pedido era sobre tiles de
hábitos/trackers), ícone novo, PDF nativo, i18n em inglês, assinatura Apple.

---

## 2. Decisões travadas

### A — Tempo/planejador

| ID | Problema | Decisão |
|---|---|---|
| A1 | Pintura por arrasto instável; long press de 400 ms longo demais | Toque curto **sem arrasto** cria, substitui ou desfaz a célula. **Qualquer arrasto navega.** **250 ms** de hold em célula **vazia** cria o bloco e entra em modo pintar (navegação desligada). |
| A2 | Long press em célula vazia abre categoria | Célula sem bloco **não abre nada**. Pintar continua sendo o gesto dela. |
| A2b | Long press em bloco sem nota abria o sheet da categoria | Agora **entra em modo destruição**: apaga o bloco segurado e os blocos que o dedo cruzar, inclusive com nota, com undo. Editar a categoria passou a ser **hold de 250 ms no chip do topo**; tap só seleciona. |
| A3 | Soltar o dedo depois de abrir a bolha remove o bloco | A abertura da bolha consome o gesto: `pointerup`/`touchend` não executa remoção. Remover bloco só pelo editor/menu. |
| A8 | Editar categoria de tempo | **Tap** no chip seleciona; **hold de 250 ms** em qualquer chip abre o sheet de edição (inclusive a já selecionada). O hold abre ao soltar, sem o clique sintetizado fechar o sheet. |
| A9 | Destruição no desktop | Só no toque; desktop mantém clique/arrasto/borracha. O bloco inicial apaga na hora; soltar sem arrastar já conta como destruição. |
| A10 | Faixa de dias duplicada | Remover a faixa externa `.tp-wkb` (barras de carga + clique para pular dia). O cabeçalho de dias dentro da grade fica; perde-se o clique e as barras. |
| A4/A7 | Drawer de notas puxado para cima quebra e faz fade estranho | **Drawer removido.** A bolha lista as notas do bloco, **não fecha ao soltar o dedo** e só fecha com clique fora. Tocar numa nota faz um **morph da bolha para o editor**. |
| A5 | Preview mostra a tag `tempo …` | O preview remove a referência `tempo`/`time` do texto; o chip continua existindo. |
| A6 | Preview ignora quebras de linha | Preservar parágrafos e quebras simples no resumo da bolha e no preview. |

**Fluxo do Tempo (mobile):** toque curto cria/substitui/desfaz →
qualquer arrasto navega → **250 ms de hold em célula vazia** cria o bloco e
entra em modo pintar → **250 ms de hold em bloco sem nota** entra em destruição
→ **650 ms em bloco com nota** abre a bolha → bolha fica aberta → tocar na nota
abre o **editor em overlay sobre o Tempo** → fechar volta ao planejador.
**Hold de 250 ms no chip de categoria** abre a edição; tap só seleciona.

**Bolha:** lista todas as notas do bloco, com rolagem se necessário, ancorada
no bloco. Não é mais um preview de uma nota só.

### B — Notas

| ID | Problema | Decisão |
|---|---|---|
| B1 | Editar, voltar para a lista e a nota "não estar lá"; sair e voltar a Notas faz aparecer | Não é perda de dados: a nota está em **outra pasta** (ex.: aberta pela bolha do Tempo). Ao abrir uma nota, a lista navega para a pasta dela; fechar o editor mantém essa pasta. |
| B2 | Abrir sempre no mesmo modo | Campo `lastMode` **por nota** (`write`/`preview`/`split`). Nota nova abre em `write`; default `preview`. |
| B3 | Menu de contexto pobre | Menu com **Renomear, Duplicar, Exportar .md e Copiar link** (`[[Título]]`). Sheet no mobile, menu flutuante no desktop, entrada com mola. |
| B4 | Criar `tempo ` manualmente | Slash command **`/tempo` ou `/time`** com lista de blocos + botão de relógio na toolbar. Inserir `tempo DD/MM HH:MM–HH:MM`. |

### C — Finanças

| ID | Problema/decisão |
|---|---|
| C1 | "Limpar lançamentos" só aparece no **modo teste**. |
| C2 | Sheet de editar categoria ganha **lixeira**. Se houver lançamentos, o botão só arma depois de **5 s** com outline animado; categoria + lançamentos vão para a lixeira global e restaurar devolve os dois. |
| C3 | Nome de categoria: **40 caracteres**; card com 2 linhas + reticências; nome completo no sheet e em `title`. |
| C4 | Categorias com `limitMode: 'limit' \| 'goal'`. `limit`: passar é ruim. `goal`: atingir é positivo, passar **não pune** e comemora. Barra satura em 100% + badge `+X% além da meta`. |
| C5 | Budget = soma de `limitMinor` de **todas as categorias de saída com limite > 0** (limite + meta). Barra **fora de card**, no topo de Finanças, no estilo da barra de XP de Hábitos: alocado, gasto e restante do mês. |

### D — Hábitos/Trackers

| ID | Problema/decisão |
|---|---|
| D1 | `targetDirection` existe no tracker, não no hábito. Hábito de contagem/duração ganha **Mais é melhor / Menos é melhor**. `didMeetTarget` passa a respeitar: `up` = `valor >= meta`; `down` = `valor <= meta`. Streak e accent usam a mesma regra. |
| D2 | Hábito semanal só contava quando a meta da semana fechava. Agora **conta na meta do dia se foi incrementado naquele dia**, e o tile ganha accent enquanto for hoje. O valor da semana continua acumulando. |
| D3 | Atualizar a meta e concluir no mesmo dia não gera chama | Investigar o cálculo de streak: a meta nova precisa valer para o log do dia imediatamente. |
| D4 | Tiles fora do dia | Mesma grade, **opacidade menor**; tile sim/não fora do dia mostra **`–`** em vez de "Hoje". Semanal ganha chip "semana". |
| D5 | Primeiro dia da semana | Configuração **Segunda/Domingo**, padrão **segunda**. Afeta semana de hábito semanal, trackers, janela semanal do grafo e calendários. Ao trocar, o log da semana atual é remapeado para a nova chave (sem perder valor). |
| D6 | Aresta `habitStreak` de hábito semanal usava "dias" | Hábito semanal mede **semanas consecutivas com meta batida**; unidade `semanas`. Hábito diário continua em dias. |
| D7 | Ordem dos tiles mudava até reabrir | Ordem de **criação**, estável. Corrigir a reatividade da lista (lista derivada + `{#each}` com chave); sem drag. |
| D8 | Chama na barra da semana | Dia com meta batida ganha **chama laranja** no lugar do check. |
| D9 | Lançar em dia passado | Tap num dia do strip seleciona a data (só passado/hoje); hold de 500 ms abre um **calendário no Sheet** com qualquer data passada e atalho "Hoje". A barra mostra a semana da data escolhida; fora de hoje, o chip fica laranja e o cabeçalho mostra a data. O card "Meta do dia" segue a data e fica **read-only** no passado. Ao sair de Hábitos, volta para hoje. |
| D10 | XP e chama em dia passado | Lançar no passado **não dá XP nem celebração**; recalcula a chama atual. Hábito semanal incrementa a semana e registra a data selecionada em `incrementDates`. Trackers não usam a data selecionada. |
| D11 | Chama da app bar em zero | Era efeito da pausa: a barra zera a meta do dia pausado e a sequência pula o dia, mas a celebração ainda disparava. A **F2** bloqueia o progresso e a chama fica azul/congelada no valor pré-pausa. |

### E — Planejamento/grafo

| ID | Problema/decisão |
|---|---|
| E1 | Ao soltar o nó, ele salta para outra posição e volta | Corrigir o commit otimista: a posição solta é a fonte da verdade até o snapshot confirmar; não reaplicar coordenadas antigas no meio do gesto. |
| E2 | Planejamento não lê Trackers | Novas fontes: **valor (último registro do período)**, **valor (média da janela)** e **meta** do tracker. Picker lista trackers ativos; unidade herdada. |
| E3 | Auto layout | Era sobre os **tiles de hábitos/trackers**, não o grafo. Coberto por D7. |

### F — Sistema/dados

| ID | Problema/decisão |
|---|---|
| F1 | Lixeira global | Tabela `trash_events` + tela **Mais → Lixeira**, filtros por módulo, agrupamento por dia, dias restantes, restaurar e excluir de vez. Retenção de **7 dias**, limpeza no boot, undo por toast. Notas mantêm a lixeira própria, também com 7 dias. |
| F2 | Pausa não bloqueia nada | Pausa = **somente leitura no que afeta progresso**: não registra hábito/tracker/tempo/finança, não edita categorias/metas, inclusive em datas passadas. Notas, leitura, configurações e encerrar a pausa continuam liberados. Faixa fina "Atlas em pausa até DD/MM" com ação que abre o modal, chama **azul** (congelada no valor pré-pausa), tentativa bloqueada mostra toast, controles de escrita esmaecidos. O modal ativo oferece **"Encerrar pausa"** e estender a data; encerrar cedo grava o período vivido. |
| F3 | Notificações iOS nunca funcionaram | Diagnóstico no device + agenda **rolante** com `Schedule.at` para as próximas 4 semanas (não depender do repeat semanal), ressincronizando ao abrir, ao mudar preferências e ao sair da pausa. Fallback em-app com o app aberto. |
| F4 | Export `.md` no iOS não faz nada; **backup `.zip` também falha** | O problema é o caminho de salvar do iOS, não o Markdown. Revisar `saveBytes`/`dialog.save` + escopo do `fs`; tratar erro e dar feedback. Se o picker não cooperar, usar o share sheet nativo. |
| F5 | "Buscar atualização" ausente no macOS/Windows | No Windows o updater in-app continua. No macOS, mostrar **Buscar atualização** que consulta a release e abre a página de download; updater real no macOS só com app assinado/notarizado. Documentar que o updater automático segue Windows-only. |

---

## 3. Mudanças de modelo e storage

| Onde | Mudança | Observação |
|---|---|---|
| `preferences` | `firstDayOfWeek: 'mon' \| 'sun'` | default `mon`; entra no snapshot compartilhado (LWW). |
| `Category` | `limitMode?: 'limit' \| 'goal'` | default `limit`; payload JSON, sem coluna nova. |
| `Habit` | `targetDirection?: 'up' \| 'down'` | default `up`; espelha `Tracker`. |
| `HabitLog` | `lastIncrementDate?: string` | só relevante para `metric: 'weekly'`; usado para contar na meta do dia e no accent. |
| `Note` | `lastMode?: 'write' \| 'preview' \| 'split'` | default `preview`; nota nova abre `write`. |
| `GraphSourceKind` | `trackerLast`, `trackerAverage`, `trackerGoal` | `sourceRefOptions`/`sourceUnit` passam a listar trackers ativos. |
| Migração **v7** | tabela `trash_events` | `id`, `module`, `kind`, `entity_id`, `label`, `payload`, `deleted_at`, `device_id`. |

### Lixeira global — desenho

- `trash_events` é **cache/UI local**, não entra no sync. A fonte de verdade
  continua sendo os **tombstones** (`deleted_at`) das tabelas.
- Excluir grava os tombstones normalmente **e** um evento com o snapshot das
  linhas afetadas (para restaurar em grupo).
- Restaurar faz upsert das linhas do payload e limpa os tombstones; excluir de
  vez remove as linhas e o evento.
- Limpeza no boot: eventos com mais de **7 dias** somem. Os tombstones seguem a
  política de sync existente (30 dias), mas não aparecem mais na UI.
- Notas: `TRASH_RETENTION_DAYS` passa de 30 para **7**; a lixeira de notas
  continua separada.
- Exclusões com vínculo (categoria com lançamentos, hábito com histórico,
  pasta com notas) usam o botão armado em 5 s; as demais mantêm undo normal.

---

## 4. Etapas de implementação

Ordem de dependência. Cada etapa é um PR verde; não é uma ordem de prioridade
(o ciclo entrega tudo).

### E0 — Fundação de dados ✅

- Migração v7 + `trash_events` e serviço de lixeira (criar/listar/restaurar/purgar).
- Campos novos nos tipos e normalizadores (`firstDayOfWeek`, `limitMode`,
  `targetDirection`, `lastIncrementDate`, `lastMode`).
- Funções puras: `weekStartDate` com primeiro dia configurável,
  `didMeetTarget` com direção, streak semanal, streak de hábito semanal.
- Testes unitários da fundação e da migração.

**Como ficou:** `src/lib/trash.ts` (modelo puro + statements de restore),
`src/lib/trash-store.ts` (SQLite/`db_batch`), migração v7, normalizadores em
`storage.ts`/`notes.ts` e retenção de notas em 7 dias. A lixeira lista por
`deleted_at`, guarda o snapshot das tabelas afetadas e restaura por upsert
(limpando o tombstone). `trash_events` é local; os tombstones continuam sendo
a fonte de verdade do sync.

**Depende de:** nada. **Bloqueia:** C2/C5, D1/D2/D5/D6, F1, F2.

### E1 — Lixeira global ✅

- Tela Mais → Lixeira, filtros, contagem de dias, restaurar/excluir de vez,
  undo por toast, limpeza de 7 dias no boot.
- Integrar notas (retenção 7) e exclusões de finanças/hábitos/tempo/grafo.
- Exclusão em grupo: categoria + lançamentos, hábito + logs; pasta + notas fica
  na lixeira de notas.

**Como ficou:** `TrashSheet.svelte` (bottom sheet no mobile, central no
desktop), acesso em **Mais → Lixeira** e no atalho da sidebar; filtros por
módulo, agrupamento por dia, dias restantes, restaurar e excluir de vez com
confirmação em dois toques. O restore usa `db_batch` (upsert + HLC) e recarrega
o snapshot. Já entram na lixeira: lançamentos e limpeza de lançamentos,
hábitos + logs, trackers + registros, categoria de tempo + blocos, nós/arestas
do grafo. Categoria financeira + lançamentos já tem helper pronto
(`financeCategoryTables`) e é ligada na E5.

**Notas:** continuam na lixeira própria (7 dias); a global não duplica notas
individuais. Exclusão de pasta ainda é local (E3 decide se migra para a lixeira
de notas).

**Depende de:** E0. **Bloqueia:** E2 (restore de nota), E5 (categoria), E7
(undo durante pausa).

### E2 — Tempo: gestos e preview ✅

- Timings 250/650, fim do `dialogTimer` de 1 s, célula vazia sem ação,
  bloco sem nota → destruição, bloco com nota → bolha, bolha consome o gesto (A3).
- Editar categoria por hold de 250 ms no chip; remover a faixa externa de dias.
- Bolha lista notas, permanece aberta, fecha só fora; sem drawer.
- Editor em overlay global sobre o Tempo + morph da bolha para o editor.
- Preview sem a tag `tempo` e com quebras de linha.
- Testes de gesto (unidade onde possível) + verificação manual no device.

**Como ficou:** toque curto sem arrasto alterna a célula (cria, substitui ou
desfaz — só ele apaga). **Qualquer arrasto navega.** Hold de 250 ms em célula
**vazia** cria o bloco e entra em modo pintar, desligando a navegação; hold de
250 ms em **bloco sem nota** entra em destruição e apaga o bloco segurado e os
arrastados; hold de 650 ms em **bloco com nota** abre a bolha. Soltar depois do
hold não pinta nem apaga. O chip de categoria agora abre a edição com hold de
250 ms (tap só seleciona) e a faixa externa de dias foi removida. A bolha fixa
(`TimeBubble` com `sticky`) não fecha no `pointerup` e só some com clique fora
ou Esc; o toque que a fecha é consumido e não cria/apaga a célula. Bloco com
nota ganha outline escuro de 2 px e um ponto no início. O editor é o
`NoteEditor` montado por cima do Tempo, com morph por `clip-path` a partir da
linha clicada; fechar volta ao planejador. O preview da bolha usa `notePreview`
(remove `tempo`/`time`, mantém até 3 linhas).

**Depende de:** E0 (para `lastMode` na nota). **Verificação pendente:** toque
real no iPhone (timings, bolha e morph).

### E3 — Notas ✅

- Navegar para a pasta da nota ao abrir (B1).
- Persistir/restaurar `lastMode`; nota nova em `write`.
- Context menu: Renomear, Duplicar, Exportar, Copiar link; sheet/menu + mola.
- Slash command `/tempo`/`/time` + botão de relógio.
- Export iOS: corrigir `saveBytes`/`dialog.save`; teste manual de `.md` e `.zip`.

**Como ficou:** `openNote` troca para a pasta da nota quando ela vem de
deep-link/backlink, então fechar o editor mantém a nota visível. O `lastMode`
é salvo por nota (sem mexer no `updatedAt`) e o editor abre nele. O menu de
contexto virou sheet no mobile e menu flutuante no desktop com Renomear
(sheet), Duplicar, Exportar `.md`, Copiar `[[link]]` e Excluir. O editor ganhou
`/tempo`/`/time` com lista de blocos e botão de relógio na toolbar. A
exportação usa `saveNoteMarkdown` e o iOS ganhou permissão de `$DOCUMENT` no
capability; erros agora viram toast em vez de silêncio.

**Depende de:** E0. **Verificação pendente:** export `.md` e `.zip` no iPhone
físico (a permissão de Document é o conserto provável).

### E4 — Hábitos/Trackers ✅

- Direção em contagem/duração (UI + `didMeetTarget` + streak + accent).
- Semanal: `lastIncrementDate`, conta no dia, accent; streak em semanas.
- Corrigir chama ao atualizar meta e concluir.
- Tiles: opacidade fora do dia, `–` no sim/não, chip "semana".
- Primeiro dia da semana + remapeamento do log da semana atual.
- Ordem de criação estável e reatividade dos tiles.
- Testes de streak, direção, semana e migração de chave.
- Chama no dia da semana + lançamento em data passada com seletor no Sheet.
- F2: pausa bloqueia progresso, chama azul congelada e faixa no topo.

**Como ficou:** hábito de contagem/duração ganhou "Mais/Menos é melhor"
(`didMeetTarget`, streak, barra e accent). O semanal guarda `incrementDates`
(histórico) + `lastIncrementDate`, conta na meta do dia em que foi incrementado,
ganha contorno de accent e mantém o streak em semanas. Tiles fora do dia ficam
esmaecidos; sim/não mostra `–` e o semanal tem chip "semana". A semana começa
em segunda por padrão e pode ser trocada em Configurações, remapeando o log da
semana atual sem perder valor. A lista de hábitos ganhou chave por id
(ordem de criação estável). A atualização de meta que fecha a meta do dia
também dispara a celebração da chama.

O dia com meta batida mostra uma **chama laranja** no strip. Tap num dia
passado seleciona a data (só passado/hoje); hold de 500 ms abre o calendário
`HabitDateSheet` com qualquer data passada e "Hoje". A barra segue a semana da
data, fica com cor laranja fora de hoje e o card "Meta do dia" segue a data
(read-only no passado). O lançamento passado não dá XP nem celebração, recalcula
a chama e o semanal registra `incrementDates` na data escolhida. Ao sair de
Hábitos, a seleção volta para hoje.

**Depende de:** E0. **Verificação pendente:** toque nos tiles, hold do dia e
virada de semana no device.

### E5 — Finanças ✅

- "Limpar lançamentos" condicionado ao modo teste.
- Lixeira no sheet de categoria + armamento de 5 s + exclusão em grupo.
- Título de 40 caracteres + reticências.
- `limitMode`, UI de meta, saturação em 100% + badge.
- Barra de budget fora de card no topo.
- Testes de budget, meta e exclusão/restauração.

**Como ficou:** as regras puras saíram para `src/lib/finance.ts`
(`transactionsInMonth`, `amountForCategory`, `budgetOverview`,
`categoryLimitStatus`), com testes em `finance.test.ts`. "Limpar lançamentos"
só aparece no modo teste. O sheet de categoria ganhou o seletor
Limite/Meta, nome de 40 caracteres (card com 2 linhas e `title`), e o botão de
excluir — com lançamentos ele arma por 5 s com outline animado e o segundo
toque leva categoria + lançamentos para a lixeira global (undo pelo toast).
Categoria meta satura a barra em 100%, mostra `+X% além da meta` e celebra a
primeira vez que a meta é atingida, sem punir o excedente. O budget do mês
(soma dos limites das categorias de saída, incluindo metas) virou uma barra
fora de card no topo, no estilo da barra de XP. `financeCategoryTables` entrou
em uso e ganhou teste de grupo.

**Depende de:** E0, E1.

### Ajustes de 20/10 (pós-E5)

- **Tempo**: remoção da faixa externa de dias; edição de categoria por hold de
  250 ms no chip; destruição por hold de 250 ms em bloco sem nota (apaga o
  inicial e os arrastados, inclusive com nota, com undo); o sheet de categoria
  abre ao soltar e ignora o clique sintetizado.
- **Hábitos**: chama laranja no dia com meta batida; seleção de data passada por
  tap, calendário no Sheet por hold, strip seguindo a semana da data, laranja
  fora de hoje, card da meta read-only no passado, sem XP/celebração no passado,
  semanal registrando `incrementDates` na data.
- **Pausa (F2)**: faixa fina, chama azul no valor pré-pausa, bloqueio de
  progresso (hábitos/trackers/tempo/finanças, hoje e passado), toast e modal
  ativo com "Encerrar pausa" + estender.
- **Drawers**: entrada e saída no `NoteEditor` (slide; morph mantido na entrada
  pela bolha), saída no `Sheet` compartilhado, transições nos sheets legados de
  Finanças/Tempo/Hábitos, `ValueSheet` e `GraphSheet`; menus de nota também
  animam. Tudo respeita `prefers-reduced-motion`.

### Ajustes de 20/10 (rodada 2)

- **Semanal (D12)**: `weeklyLogFor` lê o log da semana tolerando a chave antiga
  (dia do incremento) e o tile/streak não zeram ao reabrir; ao salvar, o log
  existente mantém a própria chave em vez de duplicar. Coberto em `atlas.test.ts`.
- **Referência de tempo**: a inserção embrulha em crases quando o cursor está
  fora de código e insere só o texto quando já está dentro (`insideCodeAt`); o
  preview decora a referência dentro de código inline, mantendo o chip. A lista
  do `/tempo` mostra a duração do bloco.
- **Auto-sync**: "Sincronizar automaticamente" fica desabilitado (com dica)
  enquanto "Sincronizar aparelhos" estiver desligado; a preferência é preservada.
- **Arestas do grafo**: retas, com desvio perpendicular para arestas paralelas
  entre o mesmo par.
- **Notificações**: agenda de 2 semanas no iOS com trigger de calendário
  (`Schedule.interval` em componentes locais, para não herdar o bug de fuso do
  `Schedule.at`); o macOS passa a entregar pelo `osascript`
  (`native_notification`), já que o plugin usa `NSUserNotificationCenter` e o
  banner é descartado em builds ad-hoc. O diagnóstico mostra permissão, fila,
  entregues e a próxima, com dica de Foco/Resumo Agendado.
- **Planejamento no telefone**: o `h1` "Planejamento" do `GraphView` fica oculto
  no mobile; sobra só o título do app shell, como nos outros módulos.

### E6 — Planejamento/grafo ✅

- Fontes de tracker (último, média da janela, meta) + unidade herdada.
- `habitStreak` semanal em semanas.
- Corrigir glitch do drag ao soltar.
- Testes de `sourceValue`/`sourceUnit` para trackers e semanal.

**Como ficou:** `GraphSourceKind` ganhou `trackerLast`, `trackerAverage` e
`trackerGoal` em `GRAPH_SOURCES`, com picker de trackers ativos e unidade
herdada. `trackerGoal` usa a meta do tracker como alvo padrão (a aresta ainda
pode sobrescrever) e respeita "menos é melhor". A aresta `habitStreak` de hábito
semanal mostra `semanas`; a de hábito diário segue em dias. O commit do drag
virou otimista: a posição solta entra no snapshot antes do save e só é revertida
se o save falhar. As arestas do grafo passaram a ser retas, com desvio
perpendicular quando há mais de uma entre o mesmo par. Testes novos em
`graph-sources.test.ts`.

**Depende de:** E0, E4 (para unidade semanal).

### E7 — Sistema (F2 concluída; F3–F5 pendentes)

- ~~Pausa: bloqueio de progresso, faixa, chama azul, toast, copy de sair.~~
  **F2 implementada em 20/10**: faixa, chama azul pré-pausa, bloqueio de
  hábitos/trackers/tempo/finanças (inclusive passado), modal com **Encerrar
  pausa** + estender.
- Notificações iOS: agenda rolante + ressync + logs de diagnóstico.
  **F3 implementada em 20/10**: agenda de 2 semanas com `Schedule.at` (corte de
  60 pendentes), ressync ao abrir/voltar ao app, ao salvar hábito, ao mudar
  preferências e ao sair da pausa; seção **Diagnóstico de notificações** no modo
  de teste (permissão, agendadas, próxima, erro e "Testar agora"). A lógica pura
  está em `src/lib/notifications.ts`, com testes.
- Updater macOS: checagem + link para a release; updater real segue Windows.
- Atualizar `docs/RELEASES.md` se o comportamento de busca mudar.

**Depende de:** E1 (undo durante pausa), E4 (streak congelada).

### E8 — Verificação e fechamento

- `npm run check`, `npm test`, `npm run build`, `cargo test`.
- `npm run csp:check`.
- Checklist manual por plataforma (abaixo).
- Atualizar `docs/ANIM-NOTE-BUBBLE.md` (sem drawer; bolha persistente; morph),
  `docs/DESIGN.md` (budget, pausa, lixeira) e `docs/ROADMAP.md` (S15 entregue).
- Release só por tag, depois da verificação no device.

---

## 5. Arquivos prováveis

| Área | Arquivos |
|---|---|
| Tempo | `src/routes/+page.svelte` (gestos/bolha), `src/lib/bubble.ts`, `src/lib/components/time/*`, `src/app.css` |
| Notas | `src/lib/components/notes/*`, `src/lib/notes-store.ts`, `src/lib/notes.ts`, `src/lib/tempo-ref.ts` |
| Dados/lixeira | `src/lib/storage.ts`, `src/lib/db/migrations.ts`, `src/lib/db/persist.ts` |
| Regras | `src/lib/atlas.ts`, `src/lib/history-*.ts` |
| Grafo | `src/lib/graph.ts`, `src/lib/graph-sources.ts`, `src/lib/components/graph/*` |
| Notificações | `src/lib/notifications.ts`, `src/routes/+page.svelte`, `src/lib/components/settings/SettingsSheet.svelte` |
| Hábitos/Trackers | `src/routes/+page.svelte`, `src/lib/components/habits/TrackersView.svelte` |
| Finanças | `src/routes/+page.svelte` (sheets e cards) |
| Plataforma | `src/lib/backup-io.ts`, `src/lib/updater.ts`, `src/lib/components/settings/SettingsSheet.svelte` |
| iOS | `src-tauri/capabilities/*`, `src-tauri/gen/apple/` (só se o save/share exigir) |

---

## 6. Aceite do ciclo

### Tempo
- Toque curto pinta; 250 ms + arrasto pinta em sequência; 650 ms abre bolha só
  com nota; soltar não remove bloco; célula vazia não abre nada.
- Bolha lista notas, não fecha ao soltar, fecha só fora; tocar na nota faz morph
  para o editor sobre o Tempo; fechar volta ao Tempo.
- Preview não mostra `tempo …` e respeita quebras de linha.

### Notas
- Editar e voltar mostra a nota na pasta correta; abrir pela bolha leva à pasta
  dela.
- Cada nota reabre no último modo; nota nova em Editar.
- Menu com as 4 ações, animação de mola; copiar link gera `[[Título]]`.
- `/tempo` e `/time` inserem a referência; botão de relógio também.
- Export `.md` e backup `.zip` funcionam no iOS.

### Hábitos/Trackers
- "Menos é melhor" muda meta, streak e accent.
- Semanal conta no dia em que foi incrementado, com accent; streak em semanas.
- Atualizar meta e concluir no mesmo dia gera chama.
- Tiles fora do dia esmaecidos; sim/não mostra `–`; ordem de criação estável.
- Primeiro dia da semana muda ciclos sem perder o log da semana atual.

### Finanças
- "Limpar lançamentos" só no modo teste.
- Excluir categoria com lançamentos exige 5 s, vai para a lixeira com os
  lançamentos e restaura tudo.
- Título de 40 caracteres com reticências.
- Categoria meta comemora e satura em 100% + badge.
- Budget fora de card mostra alocado/gasto/restante.

### Planejamento
- Trackers aparecem como fonte (último, média da janela, meta) com unidade.
- Aresta de hábito semanal mostra semanas.
- Soltar o nó não salta.
- Arestas retas, com desvio quando há paralelas entre o mesmo par.

### Sistema
- Lixeira global lista, restaura e expira em 7 dias.
- Pausa bloqueia progresso, mostra faixa, chama azul e copy de sair.
- Notificações iOS disparam com o app fechado; ressync ao abrir; diagnóstico no
  modo de teste. No macOS o banner sai pelo `osascript` enquanto o app está
  aberto (lembretes com o app fechado seguem fora do escopo).
- Auto-sync só disponível com "Sincronizar aparelhos" ligado.
- macOS mostra "Buscar atualização" com link; Windows mantém o updater.

---

## 7. Pendências de verificação manual

| Item | Onde | Por quê |
|---|---|---|
| F3 notificações | iPhone físico + SideStore | Nunca funcionou; precisa de log do device e teste com app fechado. |
| F3 macOS | macOS empacotado | Confirmar o banner do `osascript` e o botão "Testar agora". |
| F4 export `.md`/backup | iPhone físico | Backup também falha; confirmar se é `dialog.save`, escopo do `fs` ou share sheet. |
| A1–A3 e morph | iPhone físico | Gestos e animação só se validam no toque real. |
| B1 pasta da nota | iOS + macOS | Confirmar a hipótese de pasta antes de fechar. |
| D3 chama após meta | iOS + macOS | Reproduzir e cobrir com teste. |
| D12 reset do semanal | iOS + macOS | Confirmar que o log da semana sobrevive à reabertura no dia seguinte (chave antiga e nova). |
| E1 glitch do drag | Desktop (mouse) + touch | Reproduzir e medir o commit otimista. |
| D7 ordem dos tiles | iOS + macOS | Reproduzir a ordem errada e confirmar a reatividade. |
| F5 updater macOS | macOS empacotado | Verificar link/checagem e documentar Windows-only. |
| Instalador Windows | Windows | Sem mudança prevista, mas o ciclo fecha com build/manual. |

> A máquina atual é macOS: iOS exige device; Windows exige CI + máquina
> Windows. Nada disso bloqueia o desenvolvimento, só o "pronto" final.

---

## 8. Riscos e cuidados

- **Editor global sobre o Tempo:** o `NoteEditor` hoje vive dentro do
  `NotesView`. Extrair um overlay reutilizável sem duplicar autosave/anexos é a
  parte mais delicada do ciclo. Manter uma única instância e um único flush.
- **Semana configurável:** `weekStartDate` é usada em hábitos, trackers, grafo e
  calendário. Trocar o primeiro dia sem remapear o log da semana atual perde
  dado. Cobrir com teste antes de ligar a UI.
- **Lixeira local × sync:** `trash_events` não sincroniza; tombstones sim. Um
  restore em outro aparelho pode deixar evento órfão até os 7 dias. Aceitável,
  mas documentar.
- **Pausa:** não bloquear a própria lixeira/undo nem a saída da pausa; teste de
  UI para isso.
- **Notificações:** o repeat semanal do plugin pode ser o problema; a agenda
  rolante evita depender dele, mas só o device confirma.
- **Budget com metas:** metas de investimento entram como alocação; se o usuário
  tratar investimento como categoria de saída, o gasto do mês inclui o aporte.
  Validar na UI antes de fechar.
- **Export iOS:** se `dialog.save` não funcionar no WKWebView, adicionar share
  sheet é escopo real; não mascarar com toast de sucesso.

---

## 9. Relação com o roadmap

- O S15 **não** substitui as fases de sync/plataforma; ele entra depois do ciclo
  pós-sync (v0.3.3).
- O updater automático continua **Windows-only**; o macOS ganha só a checagem
  com link.
- A lixeira global e a semana configurável são pré-requisitos de qualquer
  melhoria futura em histórico/estatísticas por semana.
