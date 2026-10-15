# Handoff — Atlas · "Grafo da Vida" (aba **Vida**)

Workspace: `C:\Users\randr\Documents\Programação\Atlas` (Windows).
Doc salvo no temp do SO (`%TEMP%\opencode`), fora do workspace — não versionar.
Nenhum segredo/chave/PII neste doc.

## Estado atual
- Fase 1 (estrutura do grafo) e Fase 2 (fontes de módulo) **implementadas e commitadas**.
- `npm run check` e `npm run build` **verdes**.
- Branch `main`. Commits (mais novos por último):
  - `b73aa40` feat(graph): add life graph model, defaults and module data sources
  - `481a802` feat(graph): persist graph snapshot and reconcile edge sources on load
  - `fcaba27` feat(graph): add 'Vida' tab with graph canvas, editors and module sources
- `design-playground/` (HTML protótipo, anexado pelo usuário) permanece **untracked** — decidir se entra no repo.
- **Não houve teste em navegador** nesta sessão (só `svelte-check` + `build`). Validar em runtime.

## Design acordado (decisões travadas)
Tomadas em rodadas de "grilling" com o usuário. Não reabrir sem ele pedir.
- Grafo = **plano acionável**, progresso **read-only** (nunca escreve nos módulos).
- **Um único** grafo; aba nova na sidebar chamada **"Vida"** (ícone `Route`), `NavigationKey` ganha `'graph'`.
- Nós: **tipo único** + campo `horizon`; "Estado atual" = **origem** (flag, 1 por grafo, não excluível, não recebe arestas).
- Horizontes fixos: `Hoje · Semana · 1 mês · 3 meses · 1 ano · 5 anos`.
  - **Objetivo** = até 3 meses (círculo). **Marco** = 1 ano/5 anos (**triângulo**). Derivado do horizonte, não é campo.
- **Domínio** = área da vida (Saúde, Finanças, Relações, Carreira, Aprendizado, Lazer), paleta própria, **desacoplado** dos módulos. Definido como editável (ver pendência).
- Topologia: N pais por nó, **sem ciclos**, origem única; nós soltos ("sementes") permitidos com toggle manual de alcançado.
- Nó alcançado = **todas** as arestas de entrada concluídas (origem sempre; semente = toggle).
- Aresta: **1 fonte** por aresta; `manual` é fallback. **Janela configurável** (`week|month|total|fixed`; padrão mês).
- Fontes v1: `habitValue`, `habitStreak`, `timeHours` (h/semana), `financeSavings` (saldo líquido na janela), `financeLimit` (gasto no mês).
  - **`financeLimit`: sucesso = gasto ≤ limite** (`done = spent <= target`); a barra/razão mostra **orçamento disponível** (`(target-spent)/target`). Ajustado a pedido do usuário.
- Fonte órfã (hábito/categoria apagados) → vira `manual` congelada no último valor + toast.
- **Sem XP / Life Force** por progresso do grafo.
- Layout: **movimento livre** (sem auto-layout por anéis). Arestas acompanham o nó durante o arrasto.
- Seleção do nó = **círculo tracejado** animado (sem focus-ring quadrado).
- Editor: **bolha** ancorada ao nó no desktop (fundo transparente, o nó fica visível, seta indicando); **sheet inferior** no mobile.
- Progresso é **cacheado** em `edge.manualProgress` pela reconciliação (o `edgeRatio()` lê o cache).
- Interações portadas do protótipo: long-press cria, FAB cria perto do centro, arrastar bolinha conecta, toque abre editor, pinça/roda zoom, arrastar fundo = pan, `◎` centraliza. A11y: Tab/Enter/setas/Delete/Esc + view "lista".
- Fase 1 = estrutura + progresso manual; Fase 2 = fontes de módulo (feito).

## Arquitetura / onde mexer
- `src/lib/graph.ts` — tipos (`GraphState/Node/Edge/Domain/Horizon/SourceKind/Window`), `HORIZONS`, `GRAPH_SOURCES`, `GRAPH_WINDOWS`, seed demo (`createGraphFromDemo`), `normalizeGraph`, `edgeRatio`/`edgeDone`, `nodeReached`, `wouldCreateCycle`, `isMilestone`/`nodeRoleLabel`, `graphId`.
- `src/lib/graph-sources.ts` — `sourceProgress(edge, snapshot)`, `reconcileGraph(graph, snapshot)`, e helpers do editor (`sourceRefOptions`, `sourceUnit`, `sourceNeedsRef`, `sourceWindowable`, `isMoneySource`). Evita ciclo de imports (não importa em `graph.ts`).
- `src/lib/components/graph/` — componentes Svelte:
  - `GraphView.svelte` — orquestrador (estado, bubble ancorada, header, legend, FAB, composição dos sheets).
  - `GraphCanvas.svelte` — `<svg>` + interações + câmera (`bind:view`, `export function fit()` via `bind:this`).
  - `GraphSheet.svelte` — shell reusável (overlay + caret + grip + snippet `children`).
  - `GraphNodeSheet.svelte` / `GraphEdgeSheet.svelte` — editores.
  - `GraphList.svelte` — visão em lista acessível.
- `src/app.css` — seção **"Grafo da vida"** com as classes `.gv-*` e `.graph-view` (global, padrão do repo; não há `<style>` nos componentes do grafo).
- `src/lib/atlas.ts` — `AtlasSnapshot.graph`, `NavigationKey` inclui `'graph'`, seed no `createEmptySnapshot`.
- `src/lib/storage.ts` — grafo como blob `app_settings['graph']`; `reconcileGraph` em `readPreview`/`loadSnapshot`/`importBackup`; grafo entra no backup automaticamente.
- `src/routes/+page.svelte` — item `{ id:'graph', label:'Vida', icon: Route }`, branch `{:else if activeTab === 'graph'}` renderizando `<GraphView snapshot={snapshot} oncommit={commitGraph} ontoast={graphToast} />`, e `commit()` agora chama `reconcileGraph` + toast de fonte órfã. `onClickFeedback` ignora cliques dentro de `.graph-view`/`.gv-sheet`.

## Pendências / a verificar
1. **Teste em navegador** (`npm run dev` → aba "Vida"): drag de nó com arestas seguindo, bolha no desktop, cada uma das 5 fontes, órfã→manual.
2. **UI de domínios ausente**: design diz "domínio editável (criar/editar cor)", mas só há seleção dos 6 domínios padrão; não existe tela para criar/editar domínio. Implementar.
3. **Seed demo** continua 100% `manual` (as arestas do protótipo não apontam para hábitos/categorias). Avaliar se convém semear 1–2 arestas com fonte para ensinar a Fase 2.
4. Confirmar UX do `financeLimit` (rótulo `% disponível`) e do `%` fixo no rótulo de arestas com fonte.
5. Sem celebração (confetti) quando uma aresta de fonte completa — hoje só o slider manual celebra (evita celebrar estouro de limite).
6. `design-playground/` untracked — decidir incluir/trackear ou ignorar.
7. Sem testes automatizados. Se quiser, criar testes de unidade para `graph-sources.ts` (progresso/janela/órfã) e para `wouldCreateCycle`.

## Sugestões de skills para o próximo agente
- `caveman` — preferência do usuário por respostas curtas/tersas (ele já usa; manter enquanto ele não pedir "stop caveman").
- `grilling` — se ele quiser debater design antes de mexer (o design desta feature saiu daí).
- `handoff` — para gerar um novo handoff quando terminar a próxima etapa.
- `opencode` — dúvidas sobre o próprio OpenCode/Tauri/SvelteKit, se aparecerem.

## Comandos úteis
- `npm run dev` — prévia web (localStorage).
- `npm run tauri:dev` — app nativo.
- `npm run check` / `npm run build` — validação.
