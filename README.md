# Atlas

Atlas é um espaço pessoal local-first para acompanhar finanças, hábitos e tempo. O dashboard organiza os registros e suas tendências; notas, grafo de planejamento e IA ficam para etapas posteriores.

## Stack

- SvelteKit, Svelte 5 e TypeScript em build estático
- Tauri 2 para iOS, macOS e Windows
- SQLite no aplicativo instalado; armazenamento local do navegador apenas na prévia web
- Sem conta, sincronização ou serviços remotos no MVP

## Rodar a prévia web

```sh
npm install
npm run dev
```

A prévia usa o armazenamento local do navegador e não representa uma instalação nativa.

## Rodar o aplicativo Tauri

```sh
npm run tauri:dev
```

O ambiente precisa do toolchain Rust e das dependências nativas indicadas pela documentação do Tauri para cada plataforma. Para iOS, o desenvolvimento e a distribuição também dependem de macOS e Xcode.

## Escopo acordado

O escopo funcional, as regras de streak e Life Force, lembretes, privacidade e backup estão descritos em [docs/MVP.md](docs/MVP.md).

## Testes e verificações

```sh
npm run check    # svelte-check (+ sync e i18n)
npm test         # Vitest: projetos `unit` (node) e `components` (jsdom)
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run build && npm run csp:check   # CSP do app empacotado, num Chromium real
```

## Distribuição

- **Windows**: instalador NSIS per-user, sem code signing — [docs/WINDOWS-INSTALLER.md](docs/WINDOWS-INSTALLER.md).
- **iOS**: sideload com SideStore, `.ipa` sem assinatura — [docs/IOS-SIDELOAD.md](docs/IOS-SIDELOAD.md).
- **Versões novas**: tag semver dispara o release assinado e o updater do app — [docs/RELEASES.md](docs/RELEASES.md).
