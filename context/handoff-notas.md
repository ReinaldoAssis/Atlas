# Handoff — Atlas · Módulo de **Notas**

Doc de trabalho; não versionar segredos/PII. Base de design: `design-playground/Atlas · Notas.html`.

## Estado atual

- **Fase 1 implementada e integrada** na aba **Notas** (sidebar + `+page.svelte`).
- `npm run check` e `npm run build` limpos (0 erros/avisos).
- Sem testes automatizados no repo; lógica pura de `notes.ts` validada manualmente com `node --experimental-strip-types`.

## Escopo entregue (Fase 1)

- Editor + CRUD, pastas hierárquicas, tags, busca (FTS5 com fallback), anexos, backup.
- **Lixeira** com restauração e expurgo automático após **30 dias**.
- **Wiki-links** `[[Título]]` (abre/cria nota) e **backlinks**.
- **Artefatos** (fence ```artifact) em iframe sandbox com click-to-play.
- Sem import de `.md` externos (Fase 2).

## Decisões de design (mantidas do plano)

- **Editor**: Carta para o *render* do Markdown (GFM, math/KaTeX, code/Shiki, emoji, anchor).
  - **Mudança vs plano**: os painéis de escrita/leitura **não** usam mais o `MarkdownEditor` do Carta. Motivo: no WebKit o par textarea-transparente + overlay-de-highlight desalinhava o cursor/texto e a altura do renderer colapsava (preview vazio). Agora:
    - escrita = `<textarea>` nativo (`.nt-bd`);
    - leitura = `carta.render(body)` injetado em `.nt-pv` (debounce 220ms, com `try/catch`);
    - artefatos montados com `mount(ArtifactFrame, …)` no preview.
  - Consequência: perdidos o highlight de sintaxe dentro do textarea e os menus slash/emoji do editor. O render do preview permanece 100% Carta.
- **Sanitização**: `dompurify` (não `isomorphic-dompurify`, para não puxar jsdom no SPA). Allowlist ampla com piso: sem `script`, `on*`, `object`, `embed`, `form`, `iframe`, `javascript:`.
- **Artefatos**: iframe `sandbox="allow-scripts"` (sem `allow-same-origin`) via `srcdoc` + CSP própria injetada. **Protocolo `atlas-artifact://` não implementado** (ver pendências).
- **Tabela própria** (`notes`, `folders`, `notes_fts`), fora do `saveSnapshot`. Commit por upsert + autosave (debounce 800ms) + flush ao sair.
- **Anexos** em `appDataDir/attachments/{noteId}/{arquivo}`; markdown guarda caminho relativo; preview resolve para `blob:`.
- **Backup** `atlas-backup-v2`:
  - sem senha → `.zip` (`atlas-backup.json` + `attachments/**`);
  - com senha → JSON `atlas-backup-encrypted-v2` (snapshot+notas+pastas; **anexos ficam fora**).
  - Import de `-v1` continua válido.
- **Life Force**: 1ª nota criada no dia = +1 (campo `lifeForce.lastNoteDate`), respeita pausa.
- **Busca**: FTS5 (smoke test no init) com fallback em memória.
- **UI**: replica o protótipo — topo, busca, chips de tag coloridos por hash, breadcrumb com drill-down, grid de pastas (ícone animado, contagem como tooltip no hover), lista em card único com barra de cor, FAB, editor em tela cheia.
- **Reuso**: toasts usam o **toast global do app** (`ontoast`) — o mesmo componente/toast de todos os módulos.

## Comportamentos relevantes

- **Modos do editor**: `Editar` (só Markdown) / `Ler` (só preview) / `Split` (lado a lado) — disponíveis em qualquer largura, com transições.
- **Excluir nota**: abre modal de confirmação → move para lixeira (desfazer via toast). Na lixeira: restaurar, excluir em definitivo, esvaziar. Expurgo automático ao abrir (30 dias) remove do SQLite + anexos.
- **Menu de contexto**: long-press (toque) ou botão direito em uma nota → "Excluir nota".
- **Som de digitação** (busca e escrita) atrás da preferência **`preferences.typingSoundEnabled`** (Configurações → "Som de digitação"); também exige o toggle global "Sons da interface".
- **Modais com input**: o campo recebe foco automaticamente ao abrir.

## Arquivos

- `src/lib/notes.ts` — tipos (`Note` com `trashedAt`, `NoteFolder` com `color`), normalização, helpers (título, excerto, tags, árvore, wiki/backlinks, datas, `highlightHtml`), `TRASH_RETENTION_DAYS`, `NOTE_COLORS`/`tagColor`.
- `src/lib/notes-store.ts` — schema, CRUD por upsert, FTS5 (+fallback), anexos (fs), `replaceNotesState`, coleta/restauração de anexos para backup.
- `src/lib/carta.ts` — instância Carta (emoji/math/slash/anchor/code + plugins `artifact` e `wiki`), sanitizer, `decodeArtifact`.
- `src/lib/components/notes/` — `NotesView.svelte`, `NoteEditor.svelte`, `ArtifactFrame.svelte`, `FolderIcon.svelte`.
- `src/lib/storage.ts` — `getDatabase` exportado, `exportBackupV2`/`importBackupV2`, merge de snapshot importado.
- `src/routes/+page.svelte` — nav "Notas", branch, LF da 1ª nota, backup v2, preferência de som de digitação.
- `src/lib/atlas.ts` — `NavigationKey += 'notes'`, `LifeForceState.lastNoteDate`, `AppPreferences.typingSoundEnabled`.
- `src/app.css` — seção `/* Notes reference implementation */` + tema dark do Carta.
- `src-tauri/capabilities/default.json` — permissões `fs` (appdata) para anexos.
- `vite.config.ts` — `__ENABLE_CARTA_SSR_HIGHLIGHTER__: false`.

## Pendências / a verificar

1. **FTS5** disponível no SQLite empacotado? Smoke test em runtime; fallback LIKE/em memória já cobre.
2. **Escopo `fs`**: usei `fs:allow-appdata-write-recursive` + `fs:allow-appdata-meta-recursive` (mais amplo que o plano de restringir a `attachments/`). Validar no `tauri:dev`.
3. **Protocolo `atlas-artifact://` + CSP**: o artefato usa `srcdoc` sandbox. Como o host hoje tem `csp: null`, herda nada; **se ativarem CSP no `tauri.conf.json`, migrar para protocolo próprio**. Verificar que o artefato não alcança o Tauri/IPC.
4. **Peso do Shiki** no bundle do cliente: chunk maior ~1.18 MB (gzip ~348 kB).
5. **Backup criptografado** não inclui anexos (envelope JSON, não `.zip`).
6. **Drag-to-move** é apenas mouse; em toque o long-press abre o menu de contexto (não há drag no toque).
7. Sem testes automatizados; avaliar testes para `notes.ts`/store.
8. Aviso do build: `adapter_fallback_overwrites` (só informativo) e chunk > 500 kB.

## Comandos úteis

- `npm run dev` — prévia web (localStorage).
- `npm run tauri:dev` — app nativo.
- `npm run check` / `npm run build` — validação.
