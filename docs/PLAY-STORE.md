# Google Play — checklist da beta Android

Passo a passo do que fica **fora do código** para publicar o Atlas no Android.
Decisões de produto e arquitetura: `docs/ANDROID-BETA.md`.

## 1. Conta e canais

- [ ] Conta **pessoal** no Play Console (US$ 25, pagamento único).
- [ ] App criado com o ID **`com.reinaldoassis.atlas`** (definitivo).
- [ ] Track **internal** liberado (até 100 testers; instala em minutos).
- [ ] Track **closed** com 12+ testers opt-in por **14 dias seguidos** — só
      depois disso a Play libera produção em conta pessoal nova.
- [ ] Lembrar: internal **não** conta para o requisito dos 14 dias.

Testers precisam de conta Google real, aparelho Android e ficar opt-in no
link do closed test (desinstalar não conta como opt-out; sair da lista sim).

## 2. Assinatura do app

- [ ] Gerar keystore de **upload** (`keytool -genkeypair`), guardar o `.jks` e a
      senha como secret do GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
      `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
- [ ] Ligar **Play App Signing** (Google guarda a chave de distribuição; a de
      upload pode ser rotacionada).
- [ ] Conta de serviço com acesso à Play Developer API + JSON em
      `PLAY_SERVICE_ACCOUNT_JSON` no CI.
- [ ] O AAB assinado **não** vai para GitHub Releases nem artifact público:
      o CI envia direto para o track `internal`.

## 3. Produtos de assinatura

Criar em **Monetizar → Produtos → Assinaturas** (base plan + offers):

| Produto | Preço | Trial |
|---|---|---|
| `atlas_pro_monthly` | R$ 12,50/mês | 7 dias |
| `atlas_pro_annual` | R$ 97/ano | 7 dias |

- [ ] Ativar os dois no track de teste.
- [ ] Adicionar license testers (as compras deles são gratuitas).
- [ ] Testar: compra, acknowledge, restore e cancelamento na Play.

## 4. Ficha da loja

- [ ] Nome, descrição curta (80) e longa (4000) em **pt-BR e en**.
- [ ] Ícone 512×512 (sem alpha), feature graphic 1024×500.
- [ ] Mínimo 2 screenshots de telefone (recomendado 4+), sem molduras falsas.
- [ ] Categoria: Produtividade. Tags e classificação etária.
- [ ] URL da política de privacidade: `https://atlas.reinaldoassis.com/privacy`.

## 5. Formulários obrigatórios

- [ ] **Segurança de dados**: app guarda os dados localmente, sem telemetria;
      compras processadas pelo Google; sem conta.
- [ ] **Classificação de conteúdo** (questionário).
- [ ] **Público-alvo** e declaração de anúncios (sem anúncios).
- [ ] **Acesso ao app**: sem login, então "todas as funcionalidades disponíveis".
- [ ] Declarar o uso de **Google Play Billing** e linkar o código-fonte (GPL-3.0).

## 6. Requisitos técnicos da Play (2026)

- [ ] `targetSdk` **36** (Android 16) — já configurado no `gen/android`.
- [ ] Play Billing Library **8+** — `tauri-plugin-iap` usa a 9.
- [ ] `versionCode` sempre crescente — derivado da tag (`major*10000+minor*100+patch`).
- [ ] AAB, não APK, para upload na Play.

## 7. Ordem prática

1. Conta + app + ID.
2. Primeiro AAB no **internal** (mesmo sem billing pronto) para validar o boot.
3. Produtos de assinatura + license testers.
4. Ficha, política e formulários.
5. Closed test com os 12 testers (relógio de 14 dias começa aí).
6. Pedido de produção + revisão da Play.
