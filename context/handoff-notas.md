# Handoff — Atlas · Módulo de **Notas**

Workspace: `C:\Users\randr\Documents\Programação\Atlas` (Windows).
Doc de trabalho; não versionar segredos/PII. Nada sensível aqui.

## Estado atual
- **Somente planejamento.** Nenhuma linha do módulo de Notas foi escrita.
- As decisões abaixo saíram de rodadas de "grilling" com o usuário. **Não reabrir sem ele pedir.**
- Base de pesquisa: **Carta** — editor/visualizador Markdown para Svelte.
  - Docs: https://beartocode.github.io/carta/ · Repo: https://github.com/BearToCode/carta · npm: `carta-md`
  - Svelte 5 (`$state`/`bind:value`), SSR-compatible, baseado em unified/remark/rehype.
  - É **textarea com highlight (Shiki)**, toolbar e atalhos — **não é WYSIWYG**.
  - Plugins oficiais: `@cartamd/plugin-{math,code,emoji,slash,tikz,attachment,anchor,component}`. Community: video, imsize, subscript, ins-del.
  - **Não sanitiza por padrão.** Requer CSS global `.carta-font-code`.
- Firecrawl estava fora do ar/sem login nesta sessão; fatos foram obtidos via fetch nativo e leitura do repo.

## Decisões travadas

### Escopo
- Fase 1 = editor + CRUD + pastas/tags + busca + anexos + backup. **Sem** import de `.md` externos.
- Fase 2+ = TikZ, vídeo, imsize; backlinks grafo↔nota; refs a módulos; import `.md`; check de segurança por IA.
- Notas **standalone** na Fase 1; o modelo já nasce preparado para links grafo↔nota depois.

### Editor
- **Carta.** Plugins Fase 1: GFM (remark-gfm), math (KaTeX), code (Shiki), emoji, slash, anchor, component.
- Fase 2: tikz, video, imsize.
- Tema `carta-md/default.css` sobrescrito para o dark do Atlas; fonte global `.carta-font-code` obrigatória.
- Bundle: `define: { __ENABLE_CARTA_SSR_HIGHLIGHTER__: false }` no `vite.config.ts` (Atlas é SPA estática; highlighter só no cliente).
- Preview: cache do HTML renderizado **em memória** (LRU), invalidado ao salvar.

### Dados e persistência
- **Tabela própria**, fora do `saveSnapshot` (que hoje faz `DELETE` de tudo e reinsere o snapshot inteiro a cada commit).
  - `notes(id PK, folder_id, title, created_at, updated_at, pinned, payload)` — payload JSON (padrão do repo) com `tags[]`.
  - `folders(id PK, parent_id, name, position, payload)` — árvore **hierárquica**, profundidade livre.
  - FTS5 (título+corpo+tags) para busca. **Smoke test** no init (`CREATE VIRTUAL TABLE ... USING fts5`); fallback = LIKE.
- Commit: **store próprio das notas** (upsert por nota) + autosave com debounce ~800ms e save ao sair.
- Excluir pasta = **cascata** (notas + subpastas), com confirmação.
- Tags: livres, com autocomplete. Pin/favoritos.

### Anexos
- Arquivos em `appDataDir/attachments/{noteId}/{arquivo}`; markdown guarda caminho relativo.
- Apagar a nota apaga a pasta dela. Anexos **não** entram como base64 no DB.

### Sanitização e HTML
- Corpo markdown (HTML bruto normal) sanitizado com `isomorphic-dompurify`, allowlist **ampla** mas com piso: sem `script`, `on*`, `<object>`, `<embed>`, `<form>`, `javascript:`.
- Embeds remotos (Fase 2) = **click-to-play** (sem rede automática), alinhado ao local-first.

### Artifacts executáveis
- Fence dedicada **```artifact** → roda num **iframe sandbox** isolado: `sandbox="allow-scripts"` **sem** `allow-same-origin`, **sem** acesso ao Tauri/IPC.
- Não sanitizado **por design**; a fronteira de segurança é o sandbox.
- Servir o HTML por **protocolo próprio** (custom URI scheme `atlas-artifact://`) com CSP própria — `srcdoc` herda a CSP do pai, então não dá pra simplesmente usar `srcdoc`.
- Conteúdo executável vindo de fora (backup/import/colar com `<script>`/`javascript:`/`on*`/iframe): **alerta com origem + confirmação**; nada executa sem opt-in. Check por IA entra depois.

### UI
- Sidebar item **"Notas"** com ícone `NotebookPen`; `NavigationKey` ganha `'notes'`.
- Desktop: **duas colunas** (árvore de pastas + tags à esquerda; editor/preview à direita), toggle **Escrever / Visualizar** + split opcional. Mobile: **uma coluna**.

### Life Force
- 1ª **criação** de nota do dia = +1 LF, **uma vez/dia**, respeitando pausa. Edição não pontua.
- Implementação: commit do snapshot marcando `lifeForce.lastNoteDate` (campo novo).

### Backup
- Formato **`atlas-backup-v2`** = **.zip** contendo o JSON (`snapshot` + `notes` + `folders`) + a pasta de anexos. Cripto opcional mantida. Import do `-v1` continua válido.

## Arquitetura provável (onde mexer)
- `src/lib/notes.ts` — tipos (`Note`, `NoteFolder`), normalização, helpers (title, extract tags, tree ops).
- `src/lib/notes-store.ts` — commit próprio das notas (upsert por nota, folders, FTS), autosave.
- `src/lib/carta.ts` — instância `Carta` com plugins + `sanitizer` (dompurify) + extensão do fence ```artifact.
- `src/lib/components/notes/` — `NotesView.svelte` (orquestrador), `NoteList.svelte`, `FolderTree.svelte`, `NoteEditor.svelte` (Carta), `ArtifactFrame.svelte` (iframe sandbox), `NoteSearch.svelte`.
- `src/routes/+page.svelte` — item `{ id:'notes', label:'Notas', icon: NotebookPen }` e branch `{:else if activeTab === 'notes'}`.
- `src/lib/storage.ts` — tabelas `notes`/`folders`/`notes_fts`, leitura/escrita, backup v2 (.zip), import.
- `src/lib/atlas.ts` — `NavigationKey += 'notes'`; `LifeForceState += lastNoteDate`.
- `src/app.css` — seção "Notas" (classe `.nt-*`), tema dark do Carta.
- `src-tauri/` — `capabilities/default.json` (escopo `fs` para `appDataDir/attachments`), custom protocol `atlas-artifact://` + CSP em `tauri.conf.json`.

## Pendências / a verificar
1. **FTS5** disponível no SQLite bundled do `tauri-plugin-sql` (smoke test; fallback LIKE).
2. **Protocolo `atlas-artifact://`** + CSP: garantir que o artefato não alcança o Tauri e que a CSP do host não é afrouxada.
3. **Escopo `fs`** no `capabilities` (leitura/escrita só em `appDataDir/attachments`).
4. **Sanitizer** sempre presente no core do Carta (risco XSS/RCE).
5. Peso do **Shiki** no bundle do cliente; medir.
6. Backup `.zip`: como criptografar (hoje a cripto é sobre o JSON) — definir envelope.
7. Sem testes automatizados no repo; avaliar testes para `notes.ts`/store.
8. Atualizar `docs/MVP.md` (feito nesta sessão: Notas saiu do "Fora do MVP").

## Sugestões de skills para o próximo agente
- `caveman` — preferência do usuário por respostas curtas/tersas.
- `grilling` — se ele quiser debater design antes de codar.
- `handoff` — para gerar um novo handoff ao terminar a próxima etapa.
- `opencode` — dúvidas sobre SvelteKit/Tauri/CSP.

## Comandos úteis
- `npm run dev` — prévia web (localStorage).
- `npm run tauri:dev` — app nativo.
- `npm run check` / `npm run build` — validação.
