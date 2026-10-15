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
