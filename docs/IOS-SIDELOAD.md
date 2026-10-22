# Atlas no iPhone com SideStore

Guia para instalar o Atlas num iPhone **sem Apple Developer Program pago** e
renovar a assinatura sem computador. O SideStore re-assina o app com o seu Apple
ID gratuito a cada 7 dias usando um pairing + VPN local. Depois do setup, o Mac
só volta a ser necessário para gerar uma versão nova do `.ipa`.

> Estado: validado no device com a **v0.3.3** (out/2026). Baseado na documentação
> oficial do SideStore: <https://docs.sidestore.io>.

## Caminho rápido

1. Instale o **SideStore** no iPhone uma vez, pelo Mac, com o **iloader**.
2. Gere o `.ipa` no Mac: `npm run ipa`.
3. Mande o `.ipa` para o iPhone e instale pelo **SideStore › +**.
4. Abra o Atlas e aceite as permissões de rede local/notificações.
5. Renove o Atlas no SideStore a cada ~5 dias (a assinatura vale 7).

## Por que SideStore

| Caminho | Validade | Custo | Precisa de PC |
|---|---|---|---|
| **SideStore** | 7 dias, renovável | R$ 0 | Só no setup |
| Apple ID grátis + Xcode | 7 dias | R$ 0 | Toda semana |
| Apple Developer Program | ~1 ano (Ad Hoc) | US$ 99/ano | Não |

Limites do Apple ID gratuito: **3 apps** instalados por vez e ~10 App IDs por
semana. O Atlas ocupa 1 app.

## Pré-requisitos

- iPhone com **passcode**, iOS 15+ (o alvo do Atlas é 15.4+; validado em 26.5+).
- **Wi-Fi** — rede móvel não serve para instalar/renovar.
- Um **Apple ID separado** para o sideload. Não use a conta principal: isola a
  assinatura e evita revogar certificados de outros apps.
- **LocalDevVPN** no iPhone (App Store, id `6755608044`). Precisa estar ligada
  sempre que for instalar, atualizar ou renovar.
- Mac apenas para o primeiro setup e para gerar novos `.ipa`:
  - Xcode + Command Line Tools
  - Node 24+, Rust e o toolchain iOS do Tauri
  - **iloader** — <https://iloader.app>
- Cabo USB para o primeiro setup.

## 1. Instalar o SideStore (uma vez, com o Mac)

1. Ligue o iPhone no Mac por USB e toque **Confiar**.
2. Abra o **iloader**, entre com o Apple ID separado (o e-mail diferencia
   maiúsculas de minúsculas) e selecione o iPhone.
3. Escolha **Install SideStore (Stable)**.
4. No iPhone: **Ajustes › Geral › VPN e Gerenciamento de Dispositivo** →
   confie no app do seu Apple ID.
5. **Ajustes › Privacidade e Segurança › Modo de Desenvolvedor** → ligar (o
   iPhone reinicia).
6. Abra o **LocalDevVPN** e conecte. Aceite a configuração de VPN.
7. Abra o **SideStore**, entre com o mesmo Apple ID.
8. Em **My Apps**, toque no contador **7 DAYS** ao lado do próprio SideStore
   para renová-lo e concluir o setup. Se perguntar sobre revogar/criar
   certificado, responda **Yes/Refresh Now**.

## 2. Gerar o `.ipa` do Atlas (no Mac)

```bash
cd ~/Developer/Atlas
npm run ipa
```

O comando roda `tauri ios build --no-sign --target aarch64`.

- `--no-sign` é **necessário**: o SideStore assina com o Apple ID gratuito. O
  build sai sem `_CodeSignature` e sem precisar de time/certificado.
- Artefato: `src-tauri/gen/apple/build/arm64/Atlas.ipa`
  (cópia em `src-tauri/gen/apple/build/Atlas.ipa`).
- O build usa **release** e roda `npm run build` do front antes.
- Se aparecer `cargo: command not found`, rode de um shell interativo: o script
  phase do Xcode herda o `PATH` do processo que lançou o `tauri`.

## 2b. Rodar no iPhone pelo Xcode (build assinado)

O id de **produção** é `com.reinaldoassis.atlas`. A conta pessoal do Xcode usa
outro App ID (`com.randroi75.atlas`, team `QNHMJF4W4N`), então os comandos
abaixo geram um override local (`src-tauri/tauri.ios.test.local.json`, fora do
git) e o passam via `--config`; o Tauri sincroniza o `PRODUCT_BUNDLE_IDENTIFIER`
do projeto Xcode sozinho.

```bash
npm run ios:dev      # padrão de teste: com.randroi75.atlas
npm run ios:build
npm run ios:id       # só grava/mostra o id de teste atual

ATLAS_IOS_BUNDLE_ID=com.outro.atlas npm run ios:dev
npm run ios:dev -- --open          # abre no Xcode
```

Antes do primeiro run: **Xcode → Settings → Accounts**, entre com o Apple ID da
conta e confira o team em *Signing & Capabilities*. Sem conta configurada o
`xcodebuild` falha com `No Accounts` / `No profiles` antes de compilar.

`tauri ios dev` reescreve o id dentro de
`src-tauri/gen/apple/app.xcodeproj/project.pbxproj` a cada run. Para voltar ao
id de produção no working tree:

```bash
git checkout -- src-tauri/gen/apple/app.xcodeproj/project.pbxproj
```

## 3. Instalar o Atlas pelo SideStore

1. Mande o `Atlas.ipa` para o iPhone (AirDrop, Arquivos/iCloud, etc.).
2. Ligue a **LocalDevVPN**.
3. SideStore → **+** (canto superior) → escolha o `Atlas.ipa` → **Install**.
4. Confie no perfil do app em **Ajustes › Geral › VPN e Gerenciamento de
   Dispositivo**, se o iOS pedir.

O app aparece como **Atlas** (`com.reinaldoassis.atlas`).

## 4. Primeira abertura

- Aceite **Rede Local** se for usar o sync P2P.
- Aceite **Notificações** se for usar lembretes.
- O Atlas não pede conta, nuvem ou login. Os dados ficam no SQLite local.
- Para conferir a versão instalada: Configurações → rodapé/Avançado.

## 5. Atualizar o Atlas

1. No Mac, atualize a branch e rode `npm run ipa`.
2. Mande o novo `.ipa` para o iPhone.
3. LocalDevVPN ligada → SideStore → **+** → selecione o `.ipa` → **Install**.
   O SideStore substitui a instalação anterior e mantém os dados locais.
4. Abra o Atlas e confira a versão em Configurações.

> O banco local fica no sandbox do app. Reinstalar por cima **não apaga** os
> dados; apagar o app pelo iOS apaga. Faça um backup antes de remover.

## 6. Renovação (o que “7 dias” significa)

- A assinatura vale **7 dias**. Renove **antes** de vencer: LocalDevVPN ligada →
  SideStore → **My Apps** → toque no contador de dias do Atlas (ou **Refresh
  All**). Faça isso a cada ~5 dias.
- **Automação (Atalhos)**: crie um Atalho “Conectar à VPN” (LocalDevVPN) e uma
  automação diária que roda o atalho. Com a VPN conectada, o SideStore consegue
  renovar em segundo plano.
- Se o app abrir pedindo para reinstalar/renovar, o contador zerou: reabra o
  SideStore e renove.
- **iOS 26.4+**: o refresh teve bug (issue #1174 do SideStore); a correção está
  na versão *nightly*. Se falhar mesmo com VPN, atualize o SideStore.
- Depois de **atualizar o iOS** ou **reiniciar o aparelho**, o Modo de
  Desenvolvedor pode voltar desligado — verifique antes de abrir o app.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| SideStore não conecta / “pairing file” inválido | Refaça o pair de pairing: <https://docs.sidestore.io/docs/advanced/pairing-file> (comum após atualizar o iOS) |
| “Unable to install — certificate revoked” | Renove o SideStore (contador de 7 dias); se persistir, refaça o pairing |
| App abre e fecha na hora | Modo de Desenvolvedor desligado ou assinatura vencida |
| Instalação falha sem mensagem | Confira LocalDevVPN ligada, Wi-Fi e espaço livre |
| Build local falha com `clang_rt.ios not found` | `cargo clean` em `src-tauri` (target antigo guarda resource dir de outro Xcode) |
| Build pede time de desenvolvimento | Use `npm run ipa` (`--no-sign`); confira `bundle.iOS.developmentTeam` no `tauri.conf.json` |
| `No Accounts` / `No profiles for ...` | Xcode → Settings → Accounts: entre com o Apple ID da conta. Para dev assinado use `npm run ios:dev` (id de teste configurável). |
| Sync não encontra o outro aparelho | Aceite **Rede Local**; confira se os dois estão na mesma Wi-Fi e use “Parear por endereço” como plano B |

## Checklist rápido no device

- [ ] abrir e navegar pelas abas (safe areas, menu **+**, transições);
- [ ] nota com Markdown, código, KaTeX, tabela, wiki-link e artefato;
- [ ] exportar nota em `.md` pelo menu **⋯**;
- [ ] backup: exportar `.zip`, importar e conferir os dados;
- [ ] anexo de nota: abrir/exportar pelo picker do iOS;
- [ ] lembretes: permissão e agendamento (limite de 64 no iOS);
- [ ] planejador: pintar blocos, calendário de período e swipe do preview de nota;
- [ ] sync: parear com macOS/Windows por SAS e editar nos dois sentidos;
- [ ] modo de teste: ativar em Configurações → Avançado e sair pelo menu **Mais**.

## Referências

- SideStore — <https://docs.sidestore.io>
- Pairing file — <https://docs.sidestore.io/docs/advanced/pairing-file>
- iloader — <https://iloader.app>
- LocalDevVPN — App Store (`id6755608044`)
- Permissão de rede local no iOS — Apple TN3179
