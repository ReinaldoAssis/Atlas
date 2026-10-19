# Atlas — bolhas de referência de tempo (briefing de animação)

> Documento para o animador. Descreve o módulo, o que já existe hoje e como
> **imaginamos** a animação. Nada aqui foi implementado: a bolha atual usa um
> fade/deslize simples de propósito, esperando este briefing.
>
> **Atualização S15 (18/10/2026):** o fluxo mudou. O **drawer puxado para cima
> foi descartado**; a bolha do planejador lista as notas do bloco, permanece
> aberta depois que o dedo solta (fecha só com clique fora) e tocar numa nota
> faz um **morph da bolha para o editor em overlay sobre o Tempo**. Long press:
> **250 ms** arma pintura, **650 ms** abre a bolha. Ver `docs/CYCLE-S15.md` §2A.

---

## 1. O módulo, em três linhas

Atlas tem **Notas** (markdown) e **Tempo** (o planejador semanal em blocos de
30 min). Uma nota pode apontar para um horário do planejador escrevendo
`tempo DD/MM HHh-HHh` (alias `time`) — p.ex. `tempo 16/10 17h-20h`.

Esse texto é só uma referência: **não cria** bloco nenhum. O app cruza a
referência com os blocos que existem e mostra os dois lados por uma **bolha
de preview** — a nota mostra o bloco, o planejador mostra as notas que apontam
para ali. É esse par de bolhas que precisa de animação.

## 2. O que existe hoje (estado real, verificado no código)

### 2.1 Na nota — ao passar o ponteiro/tocar

- A referência no texto vira um **chip** (fundo da cor de acento, leve, canto 7 px).
  Sem bloco correspondente, o chip fica apagado (`bg` cinza, texto muted).
- Ao entrar no chip, aparece uma bolha **acima do chip**, ancorada no centro dele:

| Propriedade | Valor hoje |
|---|---|
| Posição | `position: fixed`, `left/top` do centro do chip, `transform: translate(-50%, calc(-100% - 10px))` |
| Largura | `max-width: 300px` |
| Visual | fundo `#272b27`, borda 1 px `#2e332e`, raio 10 px, sombra `0 12px 30px #000a`, sem seta/cauda |
| Conteúdo | 1–3 linhas: **título do bloco** (13 px, 700) + `16/10 · 17:00–20:00` (12 px, muted); sem bloco → "Sem bloco no planejador." |
| Entrada/saída | **nenhuma** (aparece/some instantâneo) |
| `pointer-events` | `none` (é só leitura) |
| Fechamento | sair do chip (pointer), scroll do preview, re-render |

### 2.2 No planejador — ao passar o ponteiro sobre a célula

- O bloco que tem nota ganha um **contorno fino verde** (1,5 px, nas pontas do
  bloco) + um **ponto verde** no início do bloco.
- Ao entrar numa célula **do bloco**, aparece uma bolha **acima da célula**:

| Propriedade | Valor hoje |
|---|---|
| Posição | `position: fixed`, `left` = centro da célula (clampado a 130 px das bordas), `top` = topo da célula, `transform: translate(-50%, calc(-100% - 8px))` |
| Largura | `min(300px, 86vw)` |
| Visual | fundo `#1d211d`, borda 1 px `#2e332e`, raio 12 px, sombra `0 14px 34px #000a`, sem cauda |
| Conteúdo | rótulo "Notas neste horário" (11 px) + N botões: **título da nota** (13 px) e um **trecho** (11 px, 1 linha, ellipsis) |
| Interação | as linhas são **clicáveis** (abrem a nota); a bolha aceita hover |
| Delays | esconder com 180 ms de atraso (para dar tempo de o mouse chegar na bolha); trocar de célula troca o conteúdo sem reentrada |
| Fechamento | sair do grid/da bolha, rolagem do planner |

## 3. O que é fixo e o que é livre

**Fixo (contrato com o código — não mudar sem combinar):**

- Âncora e posicionamento: o `left/top` vem do JS (centro do chip / topo da célula) e
  o `transform` fica com o CSS. A animação deve **compor** com esse transform base.
- Conteúdo e hierarquia (título + linha secundária; lista de N itens no planner).
- Larguras máximas (300 px / `min(300px, 86vw)`) e `z-index: 60`.
- No planner a bolha é **interativa** (hover + clique); na nota é **passiva**.
- Acessibilidade: precisa sobreviver a `prefers-reduced-motion` e continuar
  legível quando aparece/some rápido.

**Livre (queremos a sua mão):**

- Entrada, saída, troca de conteúdo e material (translúcido, blur, contorno).
- Cauda/notch apontando para a âncora (hoje não existe).
- Timing/easing, stagger interno, micro-sons e háptica (o app tem `playTone`/`pulseHaptic`).
- Como o chip da nota reage enquanto a bolha está aberta.

## 4. Como imaginamos a animação (estilo "bubble" da Apple)

A ideia central: **a bolha nasce da âncora** — como uma bolha que se descola do
elemento — e não como um card que aparece por cima.

1. **Origem.** O ponto de nascimento é a âncora (centro do chip / topo da célula).
   A bolha começa pequena (~`scale .9`), **levemente deslocada na direção da
   âncora**, e cresce até 1 **empurrando para cima/para fora** dela.
2. **Mola.** Entrada com spring curto: `cubic-bezier(.2, 1.15, .25, 1)` em
   **~380–420 ms** para escala/posição; **opacidade em ~140 ms** (some a sensação
   de "piscada"); um **blur de 4 px → 0** nos primeiros ~120 ms dá o "material
   condensando" (o Safari faz isso nas *popovers*).
3. **Material.** Fundo translúcido com `backdrop-filter: blur(~18px)` + saturação
   leve, borda de 1 px em luz alta e sombra grande e difusa. Em cima de bloco
   colorido (o planejador), o material deve puxar um pouco da cor por baixo.
4. **Conteúdo com atraso.** O texto entra **depois** do corpo (60–90 ms), com fade
   e 6 px de subida; quando há várias notas, **stagger de ~30 ms por linha**
   (máximo 3–4 visíveis). O corpo pousa primeiro, o conteúdo "assenta".
5. **Cauda.** Uma cauda/quitinização curta apontando para a âncora, que **cresce
   no fim** da entrada (não no começo) — é a assinatura do balão da Apple.
6. **Troca de conteúdo (hover célula → célula no planner).** Não queremos
   reentrada completa: o corpo **desliza** até a nova âncora (spring ~260 ms,
   sem escala) e o conteúdo faz **crossfade de 120 ms** com 4 px de deslocamento
   na direção do movimento. Só há reentrada se a bolha fechar e reabrir.
7. **Saída.** Rápida e discreta: **~160–180 ms**, sem mola, `scale .96` + fade,
   deslocando na direção da âncora. O planner deve fechar mesmo com o atraso de
   180 ms (a intenção é o mouse alcançar a bolha).
8. **Chip/célula ativa.** Enquanto a bolha está aberta, a âncora ganha um pulso
   único (`scale 1 → 1.06 → 1`, ~220 ms) para amarrar visualmente as duas coisas.
9. **Reduzir movimento.** Sem mola e sem blur: só fade de 120 ms, sem stagger.
10. **Toque (mobile).** O toque não tem hover: o mesmo gesto que abre deve poder
    fechar (toggle), e a bolha deve tolerar o dedo cobrindo a âncora — aqui um
    leve "assentar" para baixo (oposto ao desktop) pode ser melhor.

## 5. Onde plugar

- Estilos: `.nt-tp-bubble` (nota) e `.tp-note-bubble` (planejador) em `src/app.css`.
- O `left/top` vem inline do JS; mantenha o `transform: translate(-50%, …)` como
  parte do estado final e anime **em cima** dele (ou troque por um wrapper).
- Estados de conteúdo: `{#if}` já troca de lista para "sem bloco"/lista de notas —
  se quiser crossfade, o conteúdo precisa de um contêiner estável.
- Para medir: `npm run build && npm run csp:check` roda o app empacotado no
  Chromium; `tools/probe.mjs` mede layout via CDP (útil para conferir âncoras).

## 6. Se quiser experimentar sem código do app

Dá para prototipar as duas bolhas isoladas (um chip de âncora + o card) com
Framer Motion / Rive / After Effects e nos mandar o arquivo — a gente adapta o
`@keyframes`/transição para o padrão acima.

---

## 7. Contrato S15 (substitui o drawer)

- **Sem drawer de notas.** O gesto de swipe up que abria a nota individual não
  existe mais.
- A bolha do planejador é acionada por **long press de 650 ms** num bloco que
  tenha nota; 250 ms armam pintura.
- Ela **não fecha quando o dedo solta**: permanece até clique/toque fora, troca
  de contexto ou fechamento explícito.
- Conteúdo: todas as notas do bloco (título + trecho), com rolagem quando
  necessário; a nota tocada abre o editor.
- Transição para a nota: **morph** da linha/bolha para o editor (FLIP,
  ~280–360 ms, mola curta), com o Tempo ao fundo escurecido. Fechar o editor
  reverte para a bolha/planejador. Respeitar `prefers-reduced-motion`.
- A bolha da nota (preview do bloco a partir do chip `tempo`) continua passiva;
  o contrato de âncoras e `z-index` da §3 segue valendo.
