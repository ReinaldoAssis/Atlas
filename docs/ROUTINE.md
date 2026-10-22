# Rotina semanal (Tempo)

A rotina é uma **semana padrão sem datas**. Ela gera blocos concretos no
planejador e mantém as próximas semanas preenchidas.

## Modelo

- `RoutineState` (em `AtlasSnapshot.routine`): `{ revision, blocks[] }`.
- `RoutineBlock`: categoria, título, `weekday` (0 = domingo), `startMinutes` e
  `durationMinutes` (múltiplos de 30).
- Blocos gerados carregam `routineId` e `routineRevision`.

## Regras

- Horizonte de **8 semanas** (`ROUTINE_HORIZON_WEEKS`). O boot e o sync
  completam o que faltar.
- **Hoje só entra o que ainda não começou**; passado e blocos em andamento não
  são tocados.
- **Bloco manual vence**: se já existe um bloco ativo no horário, a rotina pula
  aquela data.
- **Edição de bloco gerado vale só para aquela data**. Apagar (status
  `cancelled`) também é exceção: o id determinístico impede recriar.
- **Mudar a rotina** troca a `revision`: `applyRoutine` descarta os blocos
  futuros não apagados da revisão antiga e recria o horizonte. Exceções
  apagadas continuam como lápide.
- Ids gerados: `routine-<routineId>-<YYYY-MM-DD>`, iguais em qualquer aparelho
  (evita duplicar no sync).

## UI

- Botão **Rotina** no módulo Tempo (topo no desktop, linha de categorias no
  mobile) abre `RoutineSheet`.
- O sheet é um mini-planejador da semana padrão: escolhe a categoria e toca nas
  células de 30 min. Tocar de novo (ou usar a borracha) apaga.
- Só as horas da janela configurada aparecem; blocos fora da janela são
  preservados ao salvar.
- Rotina é grátis no mobile (decisão de 22/10/2026).

## Persistência e sync

- `routine` é um singleton em `shared_settings` (LWW por `updated_at`), junto
  com `lifeForce`, `finance` e `dailyGoal`.
- Não entra nos limites do plano free (só os blocos gerados, que também não
  contam).
- Backup `.zip` leva a rotina dentro do snapshot.

## Código

- `src/lib/routine.ts` — materialização/regeneração (`syncRoutine`,
  `applyRoutine`, `routineBlockId`).
- `src/lib/components/time/RoutineSheet.svelte` — editor.
- `src/lib/routine.test.ts`, `RoutineSheet.svelte.test.ts` — regras e
  agrupamento de células.
