# Atlas — guia de design

Guia para agentes que implementam a UI. Consolida os protótipos feitos até aqui (shell, dashboard, hábitos, finanças, tempo, notas, grafo, mascotes). Em caso de conflito, este documento vence.

**Em uma frase:** escuro e plano (grafite + lime), tiles que se encaixam, quase nenhum texto, e cada ação responde com movimento, som e vibração proporcionais.

---

## 1. Princípios

1. **Registrar é o ato central.** Rápido, de um gesto, satisfatório. O usuário deve querer voltar.
2. **Poucas palavras.** Sem slogans, subtítulos ou frases explicativas. Ajuda só sob demanda (hover, foco, ícone, toast).
3. **Plano, não empilhado.** Tiles lado a lado. Nunca card dentro de card.
4. **Feedback proporcional.** Ação pequena, efeito pequeno. Conclusões grandes ganham efeito grande. Nunca animação excessiva.
5. **Desfazer em vez de confirmar.** Ações destrutivas ou de mover/aplicar mostram toast com "Desfazer".
6. **Tom calmo, sem culpa.** Avisos são neutros (âmbar), nunca vermelho alarmista. Retorno importa mais que perfeição.
7. **A IA propõe, o usuário decide.** Toda sugestão mostra evidência e pede aprovação.
8. **Funciona sem IA e sem som.** Som e vibração nunca são o único feedback.

---

## 2. Cores

Tema escuro único. Tokens (CSS custom properties):

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#121412` | fundo da página |
| `--s` | `#1b1e1b` | superfície (tile, sheet) |
| `--s2` | `#272b27` | superfície elevada, controles, trilhas |
| `--ln` | `#2e332e` | divisores de 1 px |
| `--tx` | `#ecefe6` | texto principal |
| `--mu` | `#8d968a` | texto secundário, ícones inativos |
| `--acc` | `#d4f25a` (base) | acento lime |
| `--accd` | `--acc` a 14% | fundos suaves de destaque |

Cores auxiliares: **âmbar** `#ffb347` (sequência, avisos, estouro de limite), **dourado** `#ffd45a` (receitas, meta de economia), **perigo** `#ff8a80` (só texto de ação destrutiva).
Texto sobre lime: `#141a0a`.

**Paleta de categorias** (pastas, tags, tempo, finanças): `#d4f25a #9cc8ff #ffb347 #c6a8ff #f1a5c5 #7fe3c4` (+ `#ff8a80 #e6e06a` no Tempo).
**Domínios do grafo:** Saúde `#f1a5c5`, Finanças `#ffd45a`, Relações `#9cc8ff`, Carreira `#c6a8ff`.

### Cor viva (Life Force)
O acento acompanha a Life Force `f` (0–1): `hsl(72, (12+68f)%, (34+32f)%)`. Cheia = lime vivo; vazia = verde-acinzentado. Existe opção para desligar (fixa em lime). Todo uso de acento deve ler `--acc`, nunca o hex.

---

## 3. Tipografia

- **Família:** Bricolage Grotesque (400, 600, 800) via Google Fonts, fallback `system-ui, -apple-system, "Segoe UI", sans-serif`. Monoespaçada (`ui-monospace, "SF Mono", Menlo`) só no editor de markdown.
- **Base:** 15 px / 1.4.
- **Títulos:** 800, `letter-spacing: -.03em`, 20–28 px.
- **Números grandes** (saldo, %, valor de slider): 800, `letter-spacing: -.04 a -.05em`, `line-height ≈ 1`, 30–64 px, geralmente em `--acc`.
- **Rótulos de tile:** 13 px, peso 600, `--mu`. **Legendas:** 11–12 px, `--mu`.
- **Nunca** caixa-alta em rótulos, nem eyebrows.

---

## 4. Tiles e superfícies

| Elemento | Especificação |
|---|---|
| Grid | 2 colunas, `gap: 6px`; `.w2` ocupa as duas. Desktop: 4 colunas |
| Tile | fundo `--s`, `border-radius: 10px`, `padding: 14px`, **sem borda e sem sombra** |
| Tile de progresso | preenchimento por baixo via gradiente (`--p` 0–1) na cor da categoria (~26%) |
| Tile concluído | fundo `--acc`, texto/ícones `#141a0a`, selo de check escuro |
| Tile "adicionar" | borda `2px dashed --ln`, fundo transparente, texto `--mu` |
| Lista | linhas separadas por `1px --ln`, dentro de um tile; barra de cor de 3 px à esquerda quando há categoria |
| Chip | pílula (`radius 20px`), `--s` ou `--s2`; selecionado = cor da categoria com texto escuro |
| Botão de ícone | 36–38 px, `radius 8px`, fundo `--s` |
| Botão primário | `--acc`, texto `#141a0a`, 800, `radius 12px`, altura 44–48 px |
| Bottom sheet / drawer | `--s`, raio superior 16–18 px, grip de 40×4 px, animação de baixo para cima |
| Toast | topo central, fundo `--tx`, texto escuro, 700, `radius 12px`; entra com mola; ação "Desfazer" inline |
| Slider | trilha 16 px (preenchimento lime), polegar 36 px branco com borda lime de 5 px |
| Seletor segmentado | pílula deslizante animada sob o rótulo ativo |
| Interruptor | 48×28 px, bolinha com mola, ligado = lime |
| Larguras | mobile 480–520 px centrado; desktop até ~1000 px |

Gráficos são SVG próprio (sem biblioteca): linha com área em gradiente, barras empilhadas, donut, mapa de calor. Cores da paleta de categorias, animados ao entrar.

---

## 5. Navegação (shell)

**Mobile (< 860 px)**
- Topo fixo compacto: título do módulo, 🔥 sequência, nível + barra de XP. Sem títulos repetidos dentro das páginas.
- Barra inferior **flutuante** (altura 66 px, raio 24 px) com 4 botões e o **+ central "cravado"** num recorte circular (máscara radial).
  - Botões: **Home, Hábitos, Tempo, Mais**.
  - O indicador de aba ativa é uma barra lime **abaixo do rótulo**, que desliza com mola. Ícone ativo em lime, sobe e cresce levemente.
  - **+**: círculo lime de 64 px. Ao ativar, a cruz encolhe e gira e um **anel (círculo)** cresce no lugar. Abre em leque 3 opções (Hábito, Lançamento, Nota) bem acima da barra, em cascata, sobre fundo escurecido e com blur.
  - **Mais**: menu de contexto ancorado (Finanças, Notas, Grafo, Feedback, IA, Configurações), itens entram em cascata.

**Desktop (≥ 860 px)**
- **Sidebar colapsável** 252 px ↔ 76 px (tecla `[`). Colapsada: só ícones centralizados, dicas ao passar o mouse, anel de nível centralizado.
- Conteúdo: logo, cartão de perfil (anel de XP, barra, sequência), botão "+ Novo" (mesmo menu rápido), módulos com indicador lateral deslizante, rodapé com IA e Configurações.

**Transição entre telas:** conteúdo desliza ±26 px com fade (380 ms), direção conforme a posição do módulo.

---

## 6. Movimento

| Curva | Uso |
|---|---|
| `cubic-bezier(.3,1.5,.5,1)` (mola) | pop, indicadores, interruptores, entrada de toast |
| `cubic-bezier(.2,.9,.2,1)` (suave) | drawers, barras de progresso, anéis |

- **Pressionar:** `scale(.94–.98)`.
- **Pop:** `scale .92 → 1.05 → 1` (≈400 ms). **Shake:** ±2 px (≈190 ms).
- **Progresso:** barras e anéis animam em 600–800 ms. Gráficos "se desenham" ao entrar.
- **Cascata:** entrada de itens com atraso de 35–60 ms cada.
- Sempre respeitar `prefers-reduced-motion` e a opção "Reduzir animações".

---

## 7. Háptica

Usar `navigator.vibrate` com padrões curtos. **iOS Safari não suporta:** o feedback visual e sonoro precisa bastar sozinho. Respeitar o interruptor "Vibração".

| Situação | Padrão (ms) |
|---|---|
| Tique (slider, teclado, digitar, passo de arraste) | `3–5` |
| Toque em navegação / seleção | `6–8` |
| Selecionar, abrir sheet, escolher categoria | `10–12` |
| Confirmar / criar / aplicar | `[10,30,10]` |
| Concluir hábito / meta pequena | `[14,40,14]` |
| Pegar item para arrastar (long-press) | `12–16` |
| Excluir / remover | `10–14` |
| Erro leve (campo vazio) | `20` + shake |
| Celebração (meta do dia, nível, transição concluída) | `[20,40,20,40,60–70]` |

---

## 8. Som

Síntese com Web Audio, **sem arquivos**. `AudioContext` criado sob demanda após o primeiro gesto. Botão de silenciar sempre acessível.

- Ondas `sine`/`triangle`; `square` só para tique de digitação em volume ~`.01`.
- Volume `.025–.08`; duração `.04–.3 s`; envelope exponencial até `.0001`.
- **Tom sobe com o progresso:** pintar blocos usa pentatônica `[392,440,523,587,659,784,880,1047]`; hábitos concluídos no dia sobem de nota.
- **Positivo:** intervalos ascendentes (quinta), ex. `523 → 784`. **Celebração:** arpejo `523, 659, 784, 1047 (, 1319)`.
- **Negativo/remover:** grave curto `190–220 Hz`.
- Receita: "clink" `1175 → 1568`. Despesa: grave suave `200`.

---

## 9. Efeitos visuais

- **Partículas:** 6 px, radiais, 560–700 ms, na cor da ação; sempre removidas ao fim. 3–6 para ação pequena, 14–24 para conclusão.
- **Texto flutuante** ("+10 XP", "+1h30"): sobe ~56 px e some em 1 s.
- **Confete (canvas):** 70–170 partículas, só em conquistas (meta do dia, nível, meta de economia, transição do grafo concluída).
- **Pulso/anel** no elemento que acabou de mudar; brilho (`drop-shadow`) em itens concluídos.
- **Arrastar:** item "fantasma" flutuando com leve rotação; alvo realça (fundo `--accd`, contorno lime, `scale 1.04`).

---

## 10. Gamificação

- **Life Force:** enche com interações do dia (bloco alocado +1, hábito +6 no mock); 3 dias sem uso → 30%; abaixo de 30% cai 5%/dia. Reflete na cor do app.
- **Sequência (🔥):** hábitos e registro financeiro. **Não** usar no módulo Tempo.
- **XP/nível:** +10 por registro; nível a cada 100 XP. Subir de nível = confete + arpejo + toast.
- **Metas:** celebrar ao bater (hábitos, economia, categoria de tempo, transição do grafo).
- Gamificação **sem extrapolar**: sem ranking, sem pressão social. Registrar também o "não feito" deve contar.

---

## 11. Padrões de UX

- **Hábito sim/não:** um toque. **Duração/contagem alta:** abrir sheet com slider grande + chips de atalho (nunca tocar repetido). **Contagem pequena:** pips tocáveis que definem o valor direto.
- **Dinheiro:** teclado numérico grande estilo caixa eletrônico (digita centavos), alternar despesa/receita, chips de categoria.
- **Criar algo** (categoria, pasta, nó): bottom sheet com campo em foco, cores por swatch, edição **ao vivo** quando possível. Nome vazio = shake + vibração de erro.
- **Arrastar:** mouse arrasta direto; **toque exige segurar ~200–330 ms**, assim rolar/deslizar continua funcionando. Bloquear a rolagem (`touchmove` não passivo) só depois de iniciar o arraste.
- **Busca:** filtra enquanto digita, destaca o trecho, aceita tags, global entre pastas.
- **Estados vazios:** uma linha curta (“Nada encontrado”, “Pasta vazia”).
- **Limites/avisos:** âmbar, neutro, com desfazer.
- **Hover** em desktop deve revelar (ex.: pasta abrindo, dica da sidebar colapsada); no toque, o equivalente é `:active`.

### Cartão de sugestão da IA (drawer)
`Observação → Evidência → Hipótese → Experimento → Ações` (cada ação com toggle) → **Aplicar / Outra / Rejeitar**.
Ações em módulos sensíveis (notas, finanças) aparecem **bloqueadas** ("A IA só lê este módulo"). Tudo aplicado é reversível.

---

## 12. Mascote da IA

Selecionável nas configurações. Sempre dentro de um tile discreto "Invocar" e no drawer.

- **Atlas (padrão):** ainda sem arte; por enquanto aparece só o nome "Atlas".
- **Gato:** corpo grafite, olhos na cor de `--acc`. Estados: dormindo (respira, "z"), acordado (pisca, orelhas mexem), pensando (três pontos), feliz (olhos em arco). Os olhos seguem o ponteiro. Miado sintetizado ao invocar.
- **Ghost:** casca angular grafite com pontas e olho em lime. **Estado normal: placas encaixadas** (esfera quase toda coberta, só frestas escuras e o olho). Animações: varredura (radar), vista explodida, flutuar, pensar, celebrar, dormir.
- Trocar o mascote exige **Atlas Pro** no mobile; o padrão Atlas é livre. No desktop o plano é sempre Pro.
- Reações ligadas a eventos: aplicar sugestão = feliz + confete; erro/espera = pensando.

---

## 13. Responsivo e acessibilidade

- Mobile-first; ponto de virada único em **860 px**.
- `viewport-fit=cover`; respeitar `env(safe-area-inset-*)` em topo e barra inferior; usar `100dvh`.
- Alvos de toque ≥ 44 px nos primários (mínimo 36 px em botões de ícone).
- `aria-label` em todo botão só de ícone; foco visível `2px solid --acc` com offset 2 px.
- Contraste: texto sobre lime sempre escuro; nunca depender só de cor (acompanhar com ícone/rótulo).

---

## 14. Não fazer

- Card dentro de card, sombras pesadas, bordas decorativas, gradientes decorativos (gradiente só como preenchimento de progresso/área de gráfico).
- Textos longos, slogans, títulos repetidos que o shell já mostra.
- Vermelho alarmista para estouro de orçamento ou meta não batida.
- Pedir confirmação antes de ações reversíveis (usar desfazer).
- Som/vibração sem visual correspondente.
- Animar sem respeitar redução de movimento.
- Dependências pesadas para gráficos/ícones: usar SVG inline.

---

## 15. Protótipos de referência

| Arquivo | Mostra |
|---|---|
| `atlas_shell.html` | navbar mobile com + central, sidebar, XP, configurações |
| `atlas_dashboard.html` | gráficos, tile da IA (gato), adição rápida |
| `atlas_habitos.html` | sim/não, slider, pips, sequência, celebração |
| `atlas_financas.html` | teclado, categorias com orçamento, meta de economia |
| `atlas_tempo.html` | semana em blocos, arrastar para pintar, categorias com meta |
| `atlas_notas.html` | busca, pastas, tags, markdown, arrastar para mover |
| `atlas_grafo.html` | nós, conexões por arraste, progresso por módulos |
| `atlas_ghost.html` | mascote ghost e suas animações |
