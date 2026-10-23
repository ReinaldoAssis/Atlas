# Atlas

<p align="center">
  <img src="docs/assets/logo.png" width="96" alt="Logo do Atlas">
</p>

<p>
  <a href="https://github.com/ReinaldoAssis/Atlas/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ReinaldoAssis/Atlas/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/ReinaldoAssis/Atlas/releases"><img alt="Release" src="https://img.shields.io/github/v/release/ReinaldoAssis/Atlas" /></a>
  <a href="LICENSE"><img alt="Licença: GPL-3.0" src="https://img.shields.io/badge/license-GPL--3.0-blue" /></a>
  <img alt="Plataformas" src="https://img.shields.io/badge/platforms-iOS%20%7C%20macOS%20%7C%20Windows-8d968a" />
</p>

**Atlas é um espaço pessoal local-first para finanças, hábitos, tempo, notas e as conexões entre eles.** Sem conta, sem nuvem, sem assinatura — os dados ficam no seu aparelho e podem sincronizar direto entre dispositivos pareados na mesma rede.

![Banner do Atlas](docs/assets/banner.png)

<p align="center">
  <em>English? Read the <a href="README.md">English README</a>.</em>
</p>

## Por que Atlas

- **Um lugar para o dia.** Finanças, hábitos, blocos de tempo, notas e o grafo da vida compartilham o mesmo snapshot local.
- **Registro rápido.** Um gesto ou um formulário curto; resposta com movimento, som e vibração.
- **Local-first de verdade.** SQLite no aparelho, backup manual e opção de backup criptografado.
- **Sync privado.** Pareamento direto entre dispositivos na LAN com SAS de 6 dígitos; sem relay.
- **Feito para ser seu.** GPL-3.0, open source e sem telemetria.

## Recursos

- **Visão geral** — saldo, hábitos, tempo alocado, metas, sequências e Life Force.
- **Finanças** — lançamentos, categorias, limites mensais, meta de economia e desfazer.
- **Hábitos** — booleano, contagem, duração e semanal; histórico, sequência e XP.
- **Trackers** — peso, humor, sono e medidas; vários registros por dia.
- **Planejador de tempo** — pintura de blocos, janela móvel de 7 dias, calendário de período (até 14 dias) e notas por bloco.
- **Notas** — editor Markdown (Carta), pastas, tags, wiki-links, backlinks, anexos, lixeira e exportação `.md`.
- **Grafo da vida** — domínios, nós e arestas ligados aos registros reais.
- **Sync** — descoberta na LAN, pareamento por SAS, cursor delta, merge LWW e cópias de conflito.
- **Feedback** — som/vibração configuráveis, redução de movimento e modo de teste com banco separado.

## Capturas

Todas as imagens saem do build de produção em modo de teste:
`npm run shots` (requer o Google Chrome).

<table>
  <tr>
    <td width="33%" align="center"><img src="docs/assets/time-desktop.png" width="100%" alt="Planejador de tempo no desktop"><br><sub>Planejador de tempo</sub></td>
    <td width="33%" align="center"><img src="docs/assets/notes-desktop.png" width="100%" alt="Editor e preview de nota"><br><sub>Notas · editor e preview</sub></td>
    <td width="33%" align="center"><img src="docs/assets/finance-desktop.png" width="100%" alt="Finanças no desktop"><br><sub>Finanças</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="25%" align="center"><img src="docs/assets/dashboard-mobile.png" width="100%" alt="Visão geral no iPhone"><br><sub>Visão geral</sub></td>
    <td width="25%" align="center"><img src="docs/assets/habits-mobile.png" width="100%" alt="Hábitos no iPhone"><br><sub>Hábitos</sub></td>
  </tr>
</table>

## Stack

- **SvelteKit + Svelte 5 + TypeScript**, build estático
- **Tauri 2** para iOS, macOS e Windows
- **SQLite** no app empacotado; armazenamento do navegador só na prévia web
- **Carta** para Markdown, **Paraglide** para a copy em pt-BR
- **Vitest** (unit + componente) e testes em **Rust**

## Começando

### Prévia web

```sh
npm install
npm run dev
```

A prévia usa o armazenamento do navegador e serve para trabalhar na UI; não é
uma instalação empacotada.

### App Tauri

```sh
npm run tauri:dev
```

É preciso ter o toolchain Rust e as dependências nativas de cada plataforma.
Builds de iOS exigem macOS e Xcode.

### Verificações

```sh
npm run check                 # svelte-check + sync + i18n
npm test                      # Vitest: unit em node + componentes em jsdom
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run build && npm run csp:check
```

## Plataformas

| Plataforma | Estado | Distribuição |
|---|---|---|
| **iOS** | Suportado | `.ipa` sem assinatura via SideStore — [guia](docs/IOS-SIDELOAD.md) |
| **macOS** | Suportado | Build local de `.app`/`.dmg` |
| **Windows** | Suportado | Instalador NSIS per-user, sem assinatura — [guia](docs/WINDOWS-INSTALLER.md) |

Releases usam tags semver; o updater do Windows consome os artefatos assinados.
Veja [docs/RELEASES.md](docs/RELEASES.md).

## Dados e privacidade

O app empacotado guarda tudo num banco SQLite local. O backup é manual e pode
ser um `.zip` simples ou JSON criptografado. O sync é opcional, direto entre
dispositivos pareados, e não passa por servidores do Atlas. A prévia web usa o
armazenamento local do navegador.

## Documentação

Comece em [docs/README.md](docs/README.md). O escopo do produto está em
[docs/MVP.md](docs/MVP.md), as regras de UI em [docs/DESIGN.md](docs/DESIGN.md)
e as fatias entregues/próximas em [docs/ROADMAP.md](docs/ROADMAP.md).

## Contribuindo

O repositório é pessoal, mas open source. Crie a branch a partir de `main`,
mantenha `npm run check`, `npm test` e `npm run build` verdes e abra um PR. Leia
o [AGENTS.md](AGENTS.md) para convenções e gotchas do ambiente.

## Licença

[GPL-3.0](LICENSE).
