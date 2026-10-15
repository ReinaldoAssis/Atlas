# Atlas — escopo do MVP

## Proposta

Atlas é uma aplicação pessoal local-first que reúne registros de finanças, hábitos e tempo em um dashboard. O MVP prioriza a coleta consistente e a consulta de dados; não simula manualmente um processo de orientação. Um norte poderá surgir do uso dos dados e, em etapas posteriores, de notas, grafo e IA.

## Plataformas e stack

- Interface: SvelteKit, Svelte 5 e TypeScript, com build estático.
- Aplicativo: Tauri 2 para iOS, macOS e Windows no lançamento inicial. Android fica para depois.
- Persistência: SQLite local por instalação, sem conta, serviço central ou sincronização no MVP.
- Backups: exportação e importação manuais, com escolha entre arquivo criptografado por senha ou sem criptografia.
- Idioma inicial: português do Brasil. Moeda base padrão: BRL.
- Entrada de dados: registros criados no próprio Atlas; sem conexão a bancos, calendários ou outros serviços externos.

## Módulos incluídos

### Dashboard

- Tela inicial com resumo fixo dos quatro módulos: dashboard, finanças, hábitos e tempo.
- Indicadores descritivos e tendências, sem recomendações ou pontuação global da vida.
- Períodos: semana, mês e intervalo personalizado.
- Life Force fica identificada como métrica de interação com o app, não como métrica pessoal.

### Finanças

- Cadastro manual de receitas e despesas.
- Categorias iniciais editáveis e categorias criadas pelo usuário.
- Resumos por período e categoria, em uma única moeda base (BRL por padrão).
- Sem sincronização bancária, contas, transferências, orçamento ou metas financeiras no MVP.

### Hábitos

- Hábitos binários, de duração ou de contagem, com unidade e meta definida pelo usuário.
- Dias programados da semana e histórico de registros.
- Streak conta dias programados consecutivos; para duração e contagem, é preciso atingir a meta diária.
- Ao perder um dia programado, o streak atual zera e o histórico/recorde são preservados.
- Pausa definida pelo usuário suspende os streaks até a data de retorno; o app retoma nessa data e os dias pausados não contam nem quebram sequências.
- Notificações opcionais e configuráveis.

### Gestor de tempo

- Planejamento em blocos de 30 minutos, com horários editáveis.
- Registro manual do realizado: marcar o bloco como concluído e ajustar a duração real.
- Categorias iniciais editáveis e categorias criadas pelo usuário.
- Sem timer automático ou sincronização com calendários no MVP.

## Life Force

- Intervalo de 0% a 100%; ganhos e perdas são apenas visuais e não bloqueiam funções.
- Cada novo registro ou marcação significativa em finanças, hábitos ou tempo soma 1 ponto percentual, até 100%.
- Resultado positivo não dá bônus; navegação e correções posteriores não rendem pontos.
- Três dias sem interação significativa: se estiver acima de 30%, cai para 30%. Se já estiver abaixo, nunca sobe por inatividade.
- Após o período de tolerância, cada dia adicional sem atividade reduz 5 pontos percentuais, até 0%.
- A pausa do app congela o decaimento e os streaks até a data de retorno; o app retoma nessa data e os lembretes ficam suspensos durante a pausa.

## Lembretes por plataforma

- iOS: lembretes locais agendados pelo sistema, opt-in.
- macOS e Windows: lembretes do sistema enquanto Atlas estiver aberto; notificações agendadas com o app fechado ficam fora do MVP.

## Pós-MVP

- Grafo da vida — implementado (aba "Vida": nós, arestas e fontes de módulo).
- Notas Markdown — implementado (aba "Notas": CRUD, pastas hierárquicas, tags, busca FTS5 com fallback, wiki-links/backlinks, lixeira com expurgo em 30 dias, anexos locais, artefatos em sandbox e backup `.zip` v2).
- Assistente/loop com IA.

## Fora do MVP

- Importação CSV e integrações externas.
- Conta, serviço central, sincronização entre dispositivos e P2P.
- Android, multi-moeda, orçamento financeiro, contas e transferências.
- Relatórios avançados configuráveis e recomendações automáticas.

## Critério de aceite do produto

Uma pessoa consegue registrar receitas/despesas, hábitos e blocos de tempo no dispositivo, revisar o histórico e as tendências no dashboard, criar/importar um backup e usar o app offline sem conta. O mesmo registro não vira incentivo para entrada duplicada de dados, e nenhum módulo penaliza o usuário por um resultado negativo.
