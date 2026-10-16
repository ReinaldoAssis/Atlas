# Atlas no Windows (instalador NSIS)

Como o instalador é gerado, como instalar e o que ele faz na máquina.
Decisões travadas em `docs/ROADMAP.md` (§ "Decisões travadas" e §3).

## O que é

- **NSIS** (`.exe`), **per-user** (`installMode: currentUser`) — instala sem
  pedir senha de administrador.
- **x64** — o runner `windows-latest` do CI é x64; não geramos ARM64.
- **Sem code signing** — o Windows vai mostrar o aviso do SmartScreen.
- Instalador em **pt-BR** (com inglês de reserva): o idioma do Windows decide,
  e o seletor de idioma fica desligado.
- WebView2 no modo `downloadBootstrapper`: o Win11 já traz o runtime; o Win10
  baixa durante a instalação (precisa de internet na primeira vez).

Configuração: `src-tauri/tauri.windows.conf.json` (só Windows) +
`src-tauri/tauri.conf.json` (comum: nome, publisher, descrição, ícones).

## Onde pegar o instalador

Ele sai do **job `windows-installer`** do CI (`Instalador Windows (NSIS)`):

- **GitHub › Actions › CI › run desejado › Artifacts › `atlas-windows-nsis`**
  (guarda 14 dias);
- para gerar sob demanda: **Actions › CI › Run workflow**
  (`workflow_dispatch`);
- o S8 vai anexar esse mesmo `.exe` num **Release por tag**.

Não existe build local: **NSIS só compila no Windows**. No macOS não há como
gerar esse artefato.

## Instalar

1. Baixe o `.exe` (ex.: `Atlas_0.1.0_x64-setup.exe`).
2. Ao abrir, o **SmartScreen** avisa ("O Windows protegeu o seu PC") porque o
   instalador não é assinado: **Mais informações → Executar assim mesmo**.
3. O instalador é em português e instala **só para o seu usuário**.
4. O app aparece no menu Iniciar e em **Configurações › Aplicativos** para
   desinstalar.

Caminhos esperados (confirmar na primeira instalação):

| O quê | Onde |
|---|---|
| Programa | `%LOCALAPPDATA%\Atlas` |
| Dados do app | `%APPDATA%\com.randroi75.atlas` (`atlas.db`, anexos das notas) |
| Backup do app | `%APPDATA%\com.randroi75.atlas\backups\` (cópia de segurança antes de cada import) |

Os dados ficam em `%APPDATA%`, fora da pasta do programa: **reinstalar por cima
preserva tudo**. Se quiser começar do zero, apague essa pasta depois de
desinstalar.

## Atualizar

Hoje: baixe o instalador novo e rode por cima (mesmo modo per-user) — os dados
continuam. O updater automático (GitHub Releases) é o S8.

## Verificação manual (pendente, precisa de uma máquina Windows)

O CI garante que o `.exe` **compila**; o resto só se vê instalando:

- [ ] instala sem pedir admin e abre no menu Iniciar;
- [ ] abre em Windows 11 (WebView2 já presente) e em Windows 10 sem WebView2
      (baixa o runtime);
- [ ] `atlas.db` aparece em `%APPDATA%\com.randroi75.atlas` e sobrevive a
      reabrir o app e a reinstalar por cima;
- [ ] **Exportar dados** abre o diálogo nativo e salva o `.zip` com conteúdo;
- [ ] **Importar arquivo** lê o `.zip`, mostra o resumo e restaura;
- [ ] abrir anexo de nota abre no app padrão do Windows;
- [ ] notificações locais (lembretes) pedem permissão e aparecem;
- [ ] desinstalar remove o app e deixa os dados em `%APPDATA%` (confirmar).

## SmartScreen — o que esperar

Desde 2024 certificados EV **não** pulam o aviso automaticamente: a reputação é
construída com o tempo. Para uso pessoal, o caminho é conviver com o aviso
(documentado acima). Alternativas fora do ciclo: Azure Trusted Signing (pago,
mais barato que EV) e Microsoft Store (a Microsoft re-assina o app e o aviso
some).
