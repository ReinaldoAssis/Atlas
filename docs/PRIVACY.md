# Política de privacidade — Atlas

> Texto para publicar em `https://atlas.reinaldoassis.com/privacy`.
> Última atualização: 21/10/2026.

O Atlas é um app **local-first**. Seus dados ficam no seu aparelho; não existe
conta, servidor do Atlas, telemetria ou rastreamento.

## O que o app guarda

- Registros que você cria: finanças, hábitos, trackers, blocos de tempo, notas,
  anexos e o grafo da vida.
- Preferências do app (idioma, som, háptica, moeda, primeiro dia da semana).
- Estado da assinatura (se você assinou o Atlas Pro).

No Android esses dados ficam num banco SQLite e em arquivos dentro da área
privada do app. No PC, na pasta de dados do aplicativo. O Atlas não envia esses
dados para nenhum servidor.

## Sincronização entre aparelhos

A sincronização é opcional, direta entre aparelhos pareados na **mesma rede
local**, com um código de 6 dígitos para confirmar o pareamento. Não há relay
nem nuvem: os dados vão de um aparelho ao outro pela sua rede. Desligar a
sincronização interrompe qualquer troca.

## Compras (Atlas Pro)

No Android a assinatura é processada pelo **Google Play**. O Atlas recebe da
Play apenas a confirmação de que a assinatura está ativa; não recebe nem
armazena dados do seu meio de pagamento. O tratamento dos dados de pagamento
segue a política do Google Play. Você pode restaurar a compra em
**Configurações → Atlas Pro → Restaurar compra**.

## Permissões

- **Notificações**: lembretes locais de hábitos e blocos de tempo, agendados no
  próprio aparelho.
- **Rede local / Wi-Fi**: descoberta e sincronização entre aparelhos pareados.
- **Armazenamento/arquivos**: exportar e importar backups `.zip` que você
  escolhe.

O app não acessa contatos, localização, câmera, microfone nem histórico de
navegação.

## Backup e exclusão

Backups são manuais e ficam onde você salvar (inclusive criptografados). Para
apagar tudo, use **Sair do modo de teste** (se ativo), desinstale o app ou limpe
os dados do aplicativo nas configurações do sistema. Não há cópia em servidor
para apagar.

## Crianças

O Atlas não é direcionado a crianças e não coleta dados pessoais.

## Código-fonte e contato

O Atlas é software livre sob **GPL-3.0**: `https://github.com/ReinaldoAssis/Atlas`.
Dúvidas sobre privacidade: `privacidade@reinaldoassis.com`.
