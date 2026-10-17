# Atlas no iPhone com SideStore (custo zero)

Como colocar o Atlas num iPhone sem Apple Developer Program pago, com renovação
automática. SideStore re-assina o app com o **seu Apple ID gratuito** a cada 7
dias, usando um par de pairing + VPN local — depois do setup, **não precisa
mais de computador**.

> Baseado na documentação oficial: <https://docs.sidestore.io/docs/installation/prerequisites>
> e <https://docs.sidestore.io/docs/installation/install>.

## Por que assim

| Caminho | Validade | Custo | Precisa de PC |
|---|---|---|---|
| **SideStore** | 7 dias, renovável (refresh automático) | R$ 0 | Só no setup |
| Apple ID grátis + Xcode | 7 dias | R$ 0 | Toda semana |
| Apple Developer Program | ~1 ano (Ad Hoc) | US$ 99/ano | Não |

Limites do Apple ID gratuito: **3 apps** instalados por vez e ~10 App IDs por
semana. O Atlas ocupa 1 app.

## Pré-requisitos

- iPhone com **passcode** e iOS 15+ (o alvo do Atlas é iOS 15.4+, testado em 26.5+).
- **Wi-Fi** — rede móvel não serve para o refresh.
- Um **Apple ID separado** para o sideload (o par travado nas decisões do
  projeto): evita mexer na conta principal e isola a assinatura.
- Mac (só no setup): **Xcode**, `ios-deploy` via Homebrew, Node 24 e Rust.
- No iPhone: **LocalDevVPN** (App Store) — obrigatório ligado sempre que for
  instalar, atualizar ou renovar.
- No Mac: **iloader** — <https://iloader.app> (ou
  `iloader-darwin-universal.dmg` no GitHub).

## 1. Instalar o SideStore (uma vez, com o Mac)

1. Ligue o iPhone no Mac por cabo USB e toque **Confiar**.
2. Abra o **iloader**, entre com o Apple ID separado (o email diferencia
   maiúsculas de minúsculas!) e selecione o iPhone.
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

- `--no-sign` é **necessário**: o SideStore assina com o Apple ID gratuito. O
  build sai sem `_CodeSignature` e sem precisar de time/certificado.
- Artefato fica em `src-tauri/gen/apple/build/arm64/Atlas.ipa` (também há
  cópia em `src-tauri/gen/apple/build/Atlas.ipa`).
- `ios build` usa **release** por padrão e roda `npm run build` do front antes
  (SPA estático em `build/`).
- Se o build reclamar de `cargo` não encontrado, rode de um shell interativo
  (o script phase do Xcode herda o PATH do processo que lançou o `tauri`).

Verificado no Mac (Xcode 27): o `.ipa` sai com **7,4 MB sem `_CodeSignature`**,
com `Payload/Atlas.app/PrivacyInfo.xcprivacy` dentro, `Info.plist` com
`com.randroi75.atlas`/`MinimumOSVersion 15.4`/`UIFileSharingEnabled` e o Swift
do plugin `opener` linkado no binário. O que falta é só o lado do iPhone
(instalar e passar o checklist da seção 6).

## 3. Instalar o Atlas pelo SideStore

1. Mande o `Atlas.ipa` para o iPhone (AirDrop, Arquivos/iCloud, etc.).
2. **LocalDevVPN ligada**.
3. SideStore → **+** (canto superior) → escolha o `Atlas.ipa` → **Install**.

O app aparece na tela inicial com o nome **Atlas** (`com.randroi75.atlas`).
Na primeira abertura, o iOS pede permissão de **rede local** (notificações,
também, quando você ligar os lembretes).

## 4. Renovação (o que "7 dias" significa)

- A assinatura vale **7 dias**. Renove **antes** de vencer: LocalDevVPN ligada →
  SideStore → **My Apps** → toque no contador de dias do Atlas (ou "Refresh
  All"). Faça isso a cada ~5 dias.
- **Automação (Atalhos)** para não esquecer: crie um Atalho com "Conectar à
  VPN" (LocalDevVPN) e uma Automação diária (Hora do dia) que roda o atalho.
  Com a VPN conectada, o SideStore consegue renovar em segundo plano.
- Se o app abrir pedindo para reinstalar/renovar, o contador zerou: reabra o
  SideStore e renove.
- **iOS 26.4+ teve bug de refresh** (issue #1174 do SideStore); a correção está
  na versão *nightly*. Se o refresh falhar mesmo com VPN, atualize o SideStore.
- Depois de **atualizar o iOS** ou **reiniciar o aparelho**, o Modo de
  Desenvolvedor pode voltar desligado — verifique antes de rodar o app.

## 5. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| SideStore diz que não consegue conectar / "pairing file" inválido | refaça o par de pairing: <https://docs.sidestore.io/docs/advanced/pairing-file> (acontece após atualizações do iOS) |
| "Unable to install — certificate revoked" | renove o SideStore (contador de 7 dias); se persistir, refaça o pairing |
| App abre e fecha na hora | Modo de Desenvolvedor desligado, ou assinatura vencida |
| Build local falha com `clang_rt.ios not found` | `cargo clean` no `src-tauri` (target antigo guarda resource dir de outro Xcode) |
| Build falha pedindo um time de desenvolvimento | confirme `bundle.iOS.developmentTeam` no `tauri.conf.json` ou use `--no-sign` |

## 6. Verificação no device (checklist do S6/S9)

O que **não** dá para checar no Chrome headless — precisa do iPhone:

- [ ] shell: safe areas (notch e barra inferior), leque do menu rápido (toque
      longo no **+**), indicador de aba deslizante, transições entre abas;
- [ ] nota com markdown sob CSP (`npm run csp:check` valida no Chromium; o
      WKWebView é outro motor): negrito, `código`, bloco de código com cor
      (Shiki), `$matemática$` (KaTeX), tabela, `[[wiki-link]]`, `#tag`, imagem
      `data:` e, por último, a fence `artifact` renderizando e executando;
- [ ] **backup export**: Configurações → *Exportar dados* → o picker do iOS
      abre, escolha um destino (Arquivos/iCloud) e confirme que o `.zip` chega
      com conteúdo (> 1 KB, não 0 bytes). Este é o ponto mais arriscado: o
      plugin do Tauri cria um arquivo vazio em `Documents`, nós escrevemos os
      bytes nele e o picker **move** o arquivo para o destino escolhido;
- [ ] **backup import**: *Importar arquivo* → escolha o `.zip` → resumo +
      confirmação → os dados do arquivo aparecem no app;
- [ ] **anexo de nota**: abrir um anexo exporta pelo mesmo picker;
- [ ] lembretes: permissão de notificação e agendamento (limite de 64 no iOS);
- [ ] **sync**: Configurações → Sincronização → ligar; o iOS mostra o prompt de
      **Rede Local** (texto próprio, via `InfoPlist.strings`). Aceite; pareie com
      o Windows/macOS pelo SAS de 6 dígitos e edite nos dois sentidos. Sem o
      prompt/pareamento, use "Parear por endereço" com o `ip:porta` do outro
      aparelho;
- [ ] plano B do export: se o picker devolver arquivo vazio, os bytes ficam em
      `Arquivos › No meu iPhone › Atlas` (habilitamos `UIFileSharingEnabled` e
      `LSSupportsOpeningDocumentsInPlace`).

## Referências

- SideStore — <https://docs.sidestore.io>
- iloader — <https://iloader.app>
- LocalDevVPN — App Store (`id6755608044`)
- Permissão de rede local no iOS (uso futuro do sync P2P) — Apple TN3179
