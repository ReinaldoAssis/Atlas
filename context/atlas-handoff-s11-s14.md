# Handoff — Atlas · sessão S11–S14 (polimentos + Notas + Trackers + referência `tempo`)

> Para o próximo agente. **Não duplique specs/planos/PRs**: referencie por caminho e número.
> Escopo: `docs/MVP.md` · UI: `docs/DESIGN.md` · plano: `docs/ROADMAP.md` (§7 = ordem das fatias) ·
> ideias fora do ciclo: `docs/IDEAS.md` · releases: `docs/RELEASES.md`.
> Handoffs anteriores (histórico): `context/atlas-handoff-s8-s10.md` e os citados nele.
> Próxima fatia: **S10 (sync P2P)** — spike E0 primeiro (inalterado desde o handoff anterior).

## Ambiente desta sessão (mudou!)

- Máquina do agente: **Windows 11** (`C:\Users\randr\Documents\Programação\Atlas`), **não** o Mac.
  - Node **24.20.0** + npm 11.19.0; `npm install` foi rodado do zero (`node_modules` não existia).
  - **Não** dá para validar iOS/SideStore nem gerar `.ipa` aqui. iPhone/Windows continuam pendendo do usuário.
  - `gh` autenticado (`repo`+`workflow`) — PR/merge feitos por aqui.
- Fluxo usado: branch `feat/…` → PR → **CI verde** (4 checks) → `gh pr merge --squash --delete-branch` → `git checkout main && git pull`.

## O que está pronto (S11–S14 + docs)

| PR | Entrega |
|---|---|
| #17 | **S11 polimentos**: ação persistente de criar hábito; FAB de Finanças movido para fora do `#pg`; rótulo "Pausar Atlas"; **Vida → Planejamento**; Notas com `+ Nota`/`+ Pasta` (FAB `+` removido). |
| #18 | **S12 Notas**: drag de nota/pasta para o path (raiz = "Notas"); export PDF por nota (print do SO + CSS de impressão). |
| #19 | **S13 Trackers**: aba em Hábitos; `+ Tracker`; card; sheet com gráfico SVG (7d/30d/tudo); vários registros/dia; meta opcional com direção; arquivar/excluir com desfazer. Migração **v5**. |
| #20 | **`docs/IDEAS.md`**: split tabs, API de dados para artifacts (viabilidade), TODO de integrações de tracker. |
| #21 | **S14 referência `tempo`/`time`** na nota (fallbacks no `updatedAt`); chip + bolha do bloco; indicador no planejador; bolha com as notas; clique abre a nota (deep-link). |

Testes: **99** (`npm test`). CI: `frontend` (ubuntu+windows), `rust`, `windows-installer`, `release` por tag.

## Decisões desta sessão (detalhe em `docs/ROADMAP.md` §7)

- **Trackers** são acompanhamento **sem** recorrência: sem streak, sem dias programados, sem meta diária.
  Vários registros por dia (nada de UNIQUE por data). Meta é linha de referência no gráfico.
  **Sem** integração com XP/Life Force/Visão geral/grafo — registrado como A FAZER em `docs/IDEAS.md`.
- **Export PDF** por nota usa o **diálogo de impressão do SO** (`.nt-print` + `@media print`). O botão fica
  oculto abaixo de 560px: o **WKWebView (iOS) não abre o diálogo de impressão** — export no iPhone segue pendente.
- **Referência `tempo`**: parse **puro** (não cria bloco). Sem mês/dia → mês/dia do `updatedAt` da nota; sem hora →
  dia inteiro; casa por **interseção**. A marcação no DOM é feita **depois** do Carta (o Carta é singleton e não
  tem contexto da nota) em `src/lib/tempo-ref.ts`.
- **Bug do FAB** (para lembrar): ancestral com `transform` é *containing block* de `position: fixed`. Vale para
  qualquer overlay dentro de `#pg` — é um argumento a mais para o desenho do split tabs (`docs/IDEAS.md`).

## Pendências que dependem do usuário (não do agente)

- **Verificação manual** (interação; o CI não cobre):
  - S11: criar hábito (ação sempre visível), FAB de Finanças sem "teletransporte", ida/volta da aba Planejamento.
  - S12: arrastar nota e pasta até o path; exportar uma nota com negrito, tabela, imagem e link e conferir o PDF no WebView2.
  - S13: criar tracker, vários registros no mesmo dia, gráfico, arquivar/reativar/excluir com desfazer (modo de teste tem `demo-tracker-peso`).
  - S14: chip e bolha na nota; indicador/bolha no planejador; clique abrindo a nota.
  - Para testar S13/S14 com dados: ligar o **modo de teste** (Configurações) — as fixtures já têm trackers.
- **iPhone (S9)** — `docs/IOS-SIDELOAD.md`, seções 3–6 (inclui a nota markdown sob CSP).
- **Windows (S7 + S8b)** — `docs/WINDOWS-INSTALLER.md` e o roteiro do updater.

## Ferramentas

- `tools/csp-check.mjs` (`npm run csp:check`), `tools/probe.mjs`, `npm run ipa` — inalterados.
- `src/lib/tempo-ref.ts` + testes (`tempo-ref.test.ts`, `tempo-ref.dom.test.ts`) — o `dom` usa
  `// @vitest-environment jsdom` dentro do projeto `unit`.

## Gotchas que economizam tempo

- **CI verde antes de tudo**: `npm run check`, `npm test`, `npm run build`.
- `git merge origin/main` só depois de **commitar** o WIP (arquivos em comum: `src/app.css`, `src/routes/+page.svelte`).
- PowerShell: `gh`/`git` escrevem o progresso em **stderr** → o wrapper marca "Exited with code 1" mesmo em sucesso;
  confira o texto, não o exit code.
- `@grill-me` continua **quebrado**: grelhe pela tool `question`.

## Comunicação

- Usuário em **modo caveman** (pt-BR, curto) até dizer "normal mode".
- Decide pela tool `question` (CLI), não em texto puro.
- Fluxo combinado: branch → PR → **CI verde** → squash-merge automático.
