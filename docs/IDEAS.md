# Atlas — ideias registradas (não implementadas)

Decisões tomadas em conversa, registradas para não se perderem. **Nada aqui está
aprovado para implementar**; cada item vira fatia própria quando/se entrar no ciclo.
Estado atual e ordem das fatias: `docs/ROADMAP.md`.

---

## 1. Split tabs (dois módulos ao mesmo tempo)

Ver dois módulos lado a lado / um sobre o outro, sem perder o atual.

- **Desktop**: segurar e arrastar um módulo e soltar numa zona (direita/esquerda)
  para dividir a tela com o módulo atual.
- **Celular**: segurar um módulo na barra de navegação abre o segundo módulo como
  **drawer**; o módulo atual fica atrás. Arrastar o drawer para baixo fecha.

Pontos de atenção técnicos (levantados no código atual):

- O conteúdo de cada aba vive em `#pg`, que hoje anima com `transform` na troca de
  aba (`src/app.css`, `shell-in-r/l`). O split precisa de um container próprio por
  painel; **não** aninhar `position: fixed` embaixo de um ancestral com `transform`
  (containing block — foi a causa do bug do FAB, corrigido em S11).
- Estado do layout: quais módulos estão abertos, lado/altura, e o que fazer no
  reset (um toque para voltar ao modo único). Persistir a preferência é opcional.
- Acessibilidade: foco por painel, `aria` de região, e atalho de teclado para
  fechar/escolher lado.
- Mobile: um só drawer por vez; sem empilhar três módulos.

## 2. API de dados para artifacts HTML (mini apps)

Hoje um artifact é uma fence ` ```artifact ` que vira um `iframe` `sandbox` em
`srcdoc` (`src/lib/carta.ts` + `src/lib/components/notes/ArtifactFrame.svelte`).

**Pedido**: o artifact quer ler/gravar estado no banco do app — ex.: guardar
`score`/`level` de um mini game e recuperar ao reabrir.

**Viabilidade: sim, com uma ponte explícita.** Caminho recomendado:

1. O iframe fala com o pai por `postMessage` (não há acesso direto ao SQLite; a CSP
   fecha `connect-src` a `ipc:`/`http://ipc.localhost` e o iframe é `sandbox`).
2. O pai (`ArtifactFrame`) valida a mensagem e chama o storage — o artifact nunca
   emite SQL.
3. Namespace por artifact: `artifact:<notaId>:<artifactIndexOuHash>` + chave
   declarada pelo próprio artifact (`atlas.storage.get/set(key)`), com allowlist de
   chaves e limite de tamanho por valor.
4. Identificação estável do artifact: hoje ele é anônimo dentro do markdown. Precisa
   de um id determinístico (nota + posição/hash do código) para o estado sobreviver
   a edições; o que sobrar de órfão é coletado na limpeza.

Riscos / decisões em aberto:

- **Segurança**: um artifact malicioso pode poluir o banco. Mitigar com namespace,
  allowlist, limite e nada de chaves reservadas do app.
- **Modo web (preview)**: o storage é `localStorage`; a ponte deve funcionar igual.
- **Sync futuro**: o estado de artifact seria mais um “blob” por artifact (LWW),
  fora do snapshot principal.
- Vale um “manifesto” mínimo do artifact declarando as chaves que ele usa.

Conclusão: **viável e barato** (a ponte é pouca coisa), mas só depois do sync/estabilidade
e com a política de segurança acima fechada.

## 3. Integrações de trackers (A FAZER)

Trackers entraram em S13 (aba Hábitos → Trackers) **sem** integração:

- [ ] registrar tracker dá XP?
- [ ] trackers entram no **Life Force**?
- [ ] card de tracker na **Visão geral**?
- [ ] tracker como **fonte do grafo** (ex.: “peso abaixo de X”)?

Nada disso foi implementado de propósito. Ver `docs/ROADMAP.md` (S13) e
`src/lib/components/habits/TrackersView.svelte`.
