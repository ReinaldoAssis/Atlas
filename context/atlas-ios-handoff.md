# Handoff — Atlas (Tauri + SvelteKit) · iOS

> Documento para o próximo agente. Não duplica diffs/specs: referencie os arquivos.
> Repo: `/Users/reinaldoassis/Developer/Atlas` (branch `main`).
> Escopo do produto: `docs/MVP.md`. Referência visual do shell: `design-playground/Atlas · Shell.html`.

## Objetivo da sessão

1. Fazer o primeiro build iOS e validar persistência/permissoes mobile.
2. Deploy num iPhone físico.
3. Rework do app shell conforme o playground (layout, animações, safe areas).

Status: os três estão feitos e rodando; sobraram ajustes listados em **Pendências**.

## Estado atual

- App **instala e abre no iPhone físico** via `npm run tauri -- ios dev "<nome do device>"`.
  (nome do device: pegue em `xcrun devicectl list devices`; é um iPhone 16 Pro pareado)
- Persistência funciona (load/save/seed no SQLite do app).
- Shell v2 aplicado (mobile top bar, bottom nav com notch + FAB radial, sidebar desktop colapsável, transições).

## Ambiente (específico da máquina — necessário para continuar)

- macOS **27.0.1**, Xcode **27.0** em `/Applications/Xcode.app` (ativo), SDK **iOS 27**.
- Rust 1.99 (rustup). Targets iOS instalados: `aarch64-apple-ios`, `aarch64-apple-ios-sim`, `x86_64-apple-ios`.
- **`cargo` não está no PATH por padrão.** Foi adicionado em `~/.zshrc`:
  `export PATH="$HOME/.cargo/bin:$PATH"`.
  ⚠️ O *script phase* "Build Rust Code" do Xcode herda o PATH do processo que lança o `tauri` →
  **sempre rodar `tauri` a partir de um shell interativo** (iTerm/Terminal), nunca do Xcode GUI.
- `ios-deploy 1.12.2` via Homebrew — **obrigatório** para device físico (o `cargo-mobile2`,
  que o CLI usa, executa `ios-deploy --debug --id <udid>`).
- `xcodegen`, `pod` (CocoaPods) instalados pelo `tauri ios init`.
- Disco: ~31–35 GiB livres. Já removidos: runtime iOS 17.4, `~/Library/Arduino15`,
  `~/Library/Developer/Xcode/iOS DeviceSupport`, caches.
  **Não** removidos: dados do usuário (Autodesk/Fusion 360 é usado — manter; jogos; projetos).

### Gotcha de medição de disco
`du` **mente no APFS** (clones/Copy-on-Write contam blocos compartilhados várias vezes).
Ex.: `du -sh /System` = 532 GB num disco de 245 GB. Use sempre `df -h` / `diskutil apfs list`.

## Mudanças de código (ver `git --no-pager diff`)

Arquivos tocados (não duplicar aqui):

- `src-tauri/src/lib.rs` — comando **`db_batch`**: roda uma lista de statements numa **única transação
  numa única conexão** (acessa o pool do plugin via `state::<DbInstances>()` + `sqlx`).
- `src-tauri/Cargo.toml` — `libc = "=0.2.189"` (pin) e `sqlx` (features `sqlite`, `runtime-tokio`).
- `src-tauri/tauri.conf.json` — `identifier` (novo, único — o anterior já existia na Apple),
  `bundle.iOS.developmentTeam`, `bundle.iOS.minimumSystemVersion: "15.4"`,
  `beforeDevCommand` simplificado para `npm run dev`.
- `vite.config.ts` — usa `TAURI_DEV_HOST` (host + hmr) para dev em device.
- `src/lib/storage.ts` — fila global de escrita `runSerialized()`, `getReadyDatabase()` (schema 1x/sessão),
  `saveSnapshot()` chamando `db_batch`.
- `src/lib/notes-store.ts` — usa a mesma fila; variantes `*Raw` para evitar aninhamento.
- `src/lib/atlas.ts` — `id()` protegido quando `crypto.randomUUID` não existe.
- `src/routes/+page.svelte` — shell v2 (estado/handlers: `goTab`, `toggleQuickMenu`, `toggleMoreMenu`,
  `quickAction`, `toggleSidebar`, `closeShellMenus`); diálogos próprios (`askConfirm`/`askText`) no lugar de
  `window.confirm/prompt`; backup **desativado** com tag "Em breve"; FAB do dashboard removido.
- `src/app.css` — CSS do shell v2, safe areas, reset de botões do shell.
- `src/lib/components/notes/NotesView.svelte` — prop `createToken` (token module-scoped) p/ "Nova nota" do shell.
- `src/lib/components/notes/NoteEditor.svelte` — flush do rascunho em `visibilitychange`/`pagehide`.
- `package.json` — `@types/node`, versões de plugins alinhadas ao Rust.

## Gotchas descobertos (crítico para o próximo agente)

1. **`tauri-plugin-sql` usa um pool do sqlx.** Mandar `BEGIN`/`COMMIT` como comandos separados **não**
   garante a mesma conexão → `cannot rollback - no transaction is active`. Agravante: `loadSnapshot`
   dispara 6 `SELECT` em `Promise.all`, abrindo várias conexões. **Sempre usar `db_batch`.**
2. **`window.confirm/prompt/alert` não funcionam no WKWebView (iOS)** — o wry não implementa os painéis JS:
   `confirm` → `false`, `prompt` → `null`, `alert` → no-op. Use UI própria (feito) ou `plugin-dialog`.
3. **`<a download>` com blob não baixa no WKWebView.** Backup export precisa de `plugin-dialog` + `plugin-fs`.
   `openAttachment` em `NoteEditor.svelte` ainda usa blob → **quebrado no iOS**.
4. **Contexto inseguro**: dev em `http://192.168.x.x:1420` → `crypto.randomUUID`/`crypto.subtle` são `undefined`.
   `id()` já tem fallback; backups (`subtle`) quebrariam — outro motivo para reimplementar.
5. **Bundle IDs são globalmente únicos** na Apple → o original colidiu.
6. **Após trocar de Xcode, `cargo clean`** — o `target/` antigo guarda o *resource dir* do clang velho
   (`clang/16`) e o link falha com `ld: library 'clang_rt.ios' not found`.
7. **Limite iOS**: no máx. **64** notificações locais agendadas (hábitos×dias + blocos pode estourar).
8. **Conta Apple gratuita (Personal Team)** → perfil de provisionamento expira em **7 dias**.
9. `simctl runtime delete <uuid>` libera espaço; remover um runtime também remove os devices dele.

## Pendências / próximos passos

- **Verificar o shell no device**: safe areas (notch + home bar), leque do menu rápido, indicadores
  deslizantes, transições de aba, sidebar no desktop (largura ≥860px).
- **Duplicação**: o dashboard ainda tem o cabeçalho "Hoje" próprio, repetindo o top bar mobile. Decidir remover.
- **Backup**: reimplementar com `plugin-dialog` (`save`/`open`/`message`) + `plugin-fs`. Corrigir também
  `openAttachment` no `NoteEditor`.
- **`PrivacyInfo.xcprivacy`** em `src-tauri/gen/apple/app_iOS/` (exigência da App Store; o fs usa file timestamp).
- **Ícone**: regenerar de uma fonte 1024×1024 **sem alpha** (`npx tauri icon <fonte>`); o atual é upscale de 512 RGBA.
- **Commitar**: `src-tauri/gen/apple/` e `src-tauri/Cargo.lock` (o `.gitignore` de `gen/apple` só ignora
  `xcuserdata/`, `build/`, `Externals/`).
- Opcional: CSP (`app.security.csp` está `null`); `@tauri-apps/cli` 2.12.2 → 2.12.3; decidir dados demo do 1º boot.

## Comandos

```sh
cd ~/Developer/Atlas
npm run check          # svelte-check
npm run build          # build estático (adapter-static → build/)
npm run tauri -- ios dev "<device>"          # dev no iPhone físico
npm run tauri -- ios build --debug --target aarch64      # build assinado para device
npm run tauri -- ios build --debug --target aarch64-sim   # simulador
npm run tauri -- info  # checa env + versões de plugins
```

Na 1ª execução no device: aceitar o prompt de **rede local** no iPhone.

## Comunicação

O usuário usa o modo **caveman** (respostas curtas em pt-BR, sem enrolação). Manter.

## Suggested skills

Chamar a tool `Skill` com:

- **`caveman`** — o usuário trabalha nesse modo; manter o estilo até ele dizer "normal mode".
- **`opencode`** — se a sessão migrar para dúvidas sobre o próprio OpenCode (agentes, plugins, CLI, TUI).
- **`report`** — se precisar abrir issue de bug do OpenCode.
- **`find-skills`** — se surgir uma tarefa nova sem skill óbvia (ex.: design/UI, iOS signing).
- **`grill-me`** — na sessão anterior foi invocado mas a skill `grilling` não existe/não carregou;
  não insistir.

Não há skill específica de Tauri/SvelteKit/iOS instalada — o trabalho é no repo normal.
