# AGENTS.md — convenções para agentes no Atlas

Regras e atalhos para quem (agente ou humano) mexe neste repositório.

## Comunicação e decisões

- Com o usuário: **pt-BR**, curto (ele costuma estar em "modo caveman" até dizer
  "normal mode"). Decisões de produto/design são dele: pergunte pela tool
  `question` (CLI), nunca decida silenciosamente.
- **Grilling**: as rodadas de perguntas também vão pela tool `question` (com
  opções e a recomendada primeiro), não como texto solto.
- **Commits, títulos/corpos de PR e nomes de branch em inglês.** Identificadores
  no código em inglês. Copy de UI em **pt-BR**.
- Mensagem de commit: convencional (`feat:`, `fix:`, `docs:`), corpo em bullets
  explicando o porquê — não descreva só o diff.

## Fluxo

1. `branch feat/…|fix/…|docs/…` a partir de `main`.
2. Antes de abrir PR: `npm run check`, `npm test`, `npm run build` (todos verdes).
3. PR → **CI verde (4 checks)** → `gh pr merge --squash --delete-branch` →
   `git checkout main && git pull --ff-only`.
4. Release só por tag (`docs/RELEASES.md`): `git tag vX.Y.Z && git push origin vX.Y.Z`.

## Docs que valem ler

- `docs/README.md` (índice) · `docs/ROADMAP.md` (escopo, fatias e ordem)
- `docs/MVP.md` · `docs/DESIGN.md` · `docs/SYNC.md` · `docs/IDEAS.md`
- `docs/RELEASES.md` (release/updater) · `docs/ANIM-NOTE-BUBBLE.md`
  (briefing das bolhas de tempo)

## Gotchas do ambiente

- A máquina do agente pode ser **Windows**: não dá para validar iOS/SideStore
  (isso exige o Mac + device). Diga o que ficou pendente de verificação manual.
- PowerShell: `git`/`gh` escrevem progresso em **stderr** — o wrapper marca
  "Exited with code 1" mesmo em sucesso; leia o texto, não o exit code.
- Efeitos de UI vivem em `src/app.css` (global) e o kit em
  `src/lib/components/ui/` (`Sheet`, `Field`, `Button`, `Segmented`, `Chip`,
  `Toggle`, `CardMenu`, `ValueSheet`).
- `Sheet` foca o 1º focável; use `data-autofocus` para escolher o campo.
- Ancestral com `transform` vira *containing block* de `position: fixed`
  (foi a causa de um bug de FAB) — cuidado com overlays dentro do `#pg`.
- `npm run csp:check` roda o app empacotado no Chromium (CSP + boot);
  `tools/probe.mjs` mede layout por CDP.
