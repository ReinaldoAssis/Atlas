# Atlas — beta Android na Google Play

Decisões e plano da primeira distribuição do Atlas no Android. Vale para a
série **0.4.x**; o PC (macOS/Windows) continua **100% grátis**.

> Estado: decisões fechadas em 21/10/2026; código entregue no PR #46. Fatias
> marcadas ✅ já entregues.

## Estado em 22/10/2026

**Código** — PR [#46](https://github.com/ReinaldoAssis/Atlas/pull/46), 9 commits,
CI principal 4/4 verde (frontend ubuntu/windows, rust, instalador Windows).
O workflow `Android` (`workflow_dispatch`) valida o build assinado no CI.

**Verificado localmente (Mac)**

| Item | Resultado |
|---|---|
| `npm run check` | 0 erros / 0 warnings |
| `npm test` | 264 testes |
| `npm run build` | ok |
| `npm run csp:check` | 23/23 (inclui boot em `en`) |
| `cargo test` | 50 testes |
| APK debug aarch64 | `com.reinaldoassis.atlas.debug`, versionCode 400, minSdk 29, target 36, `MulticastLockPlugin` e permissão `BILLING` presentes |
| AAB release | gerado e assinado com keystore descartável (valida o signing config do Gradle) |

**Não verificado** — nada disto tem device/Play por trás ainda: boot e sync no
aparelho, limites do free na prática, compra/restore no sandbox, upload real no
track `internal` (sem secrets configurados).

**Ambiente local usado** (reproduzir em outra máquina): JDK 17
(`brew install openjdk@17`), `cmdline-tools` em `~/Library/Android/sdk`,
NDK `27.0.12077973`, targets Rust `aarch64-linux-android`,
`armv7-linux-androideabi`, `x86_64-linux-android`.

## Decisões travadas

| Tema | Decisão |
|---|---|
| Application ID | `com.reinaldoassis.atlas` (todas as plataformas) |
| `minSdk` / `targetSdk` | **29** / **36** (Play exige 36 desde 31/08/2026) |
| `versionCode` | `major*10000 + minor*100 + patch` (0.4.0 → 400) |
| Canais | `internal` (até 100) + `closed` (12 testers) em paralelo |
| Produção | conta **pessoal nova** → closed test com 12 testers opt-in por 14 dias |
| Assinatura | upload key local + secret do CI; **Play App Signing** ligado; AAB nunca vira artifact público |
| Pipeline | tag `v*` → job ubuntu assina e sobe o AAB no track `internal`; promoção pra `closed` manual no Console |
| Billing | `tauri-plugin-iap` (Play Billing 9, MIT), Android agora e iOS depois |
| Produtos | mensal **R$ 12,50**, anual **R$ 97**, trial **7 dias** |
| Entitlement | cache local no SQLite + reconsulta à Play em launch/resume + **grace de 7 dias offline**; checagem em Rust |
| Gating | limites compilados só para mobile (`cfg(android/ios)`); PC sem gating; backstop em Rust no `db_batch` |
| Sync | entra na beta; descoberta via `mdns-sd` + `MulticastLock` (plugin Kotlin) |
| Lembretes | paridade com iOS (`POST_NOTIFICATIONS`, alarme exato no Android 12+) |
| Idiomas | pt-BR (base) + en; seletor Sistema / Português / English; fallback **en** fora de pt/en |
| Política | `atlas.reinaldoassis.com/privacy` — texto pronto em `docs/PRIVACY.md`; publicação no site pendente |
| Assets da ficha | depois do código e do billing |

## Free vs Pro (mobile)

PC não tem limite nem paywall.

| Item | Free | Pro |
|---|---|---|
| Notas ativas | 7 | ilimitado |
| Anexos | 5 | ilimitado |
| Hábitos ativos | 3 | ilimitado |
| Trackers ativos | 2 | ilimitado |
| Histórico (hábitos/trackers) | últimos 7 dias | completo |
| Nós do grafo | 5 (origem não conta) | ilimitado |
| Categorias de finanças | 4 custom | ilimitado |
| Categorias de tempo | 5 custom | ilimitado |
| Sync entre aparelhos | — | ✅ |
| Backup manual | ✅ | ✅ |

O seed de categorias cabe nos limites: finanças = Salário, Moradia,
Alimentação e Lazer; tempo = Foco profundo, Leitura, Saúde, Pessoal e
Descanso. `Transporte` e `Administração` saíram do seed (recriáveis como
categoria custom) para valer também no PC.

## Fatias

1. **Fundação** ✅ — versão 0.4.0, `tauri android init`, JDK 17 + NDK 27,
   build debug no device, identifier/minSdk/targetSdk ajustados.
2. **Sync Android** ✅ — plugin Kotlin com `MulticastLock`, `sync` compilando
   no Android, pareamento a validar em device real.
3. **i18n completo** ✅ — pt-BR + en, seletor nas Configurações, migração de
   toda a copy (markup, atributos, toasts, erros), `Intl` por locale, guard
   sem allowlist. Ver `docs/I18N.md`.
4. **Gating + entitlement** ✅ — `plan.rs` valida os limites dentro da
   transação do `db_batch` (rollback + `plan-limit:<chave>:<limite>`), cache de
   Pro com grace de 7 dias, guard otimista na UI e paywall (sheet no limite +
   linha em Configurações). Histórico do free corta em 7 dias na lista.
5. **Billing** ✅ — `tauri-plugin-iap` (Billing 9) só no mobile, preços da
   loja com fallback, compra/restore/acknowledge e renovação via listener.
   Falta criar os produtos na Play e testar com license tester.
6. **Pipeline de release** ✅ — workflow `Android` em tag, upload key pelos
   secrets, AAB direto pro track `internal`, `versionCode` conferido.
7. **Loja e site** — textos da ficha e política prontos (`docs/STORE-LISTING.md`,
   `docs/PRIVACY.md`); falta publicar no site, produzir assets e preencher os
   formulários da Play.

## Checklist manual (fora do código)

Ordem prática; detalhes em `docs/PLAY-STORE.md` e `docs/RELEASES.md`.

**1. Conta e canais**
- [ ] Conta pessoal no Play Console (US$ 25) e app `com.reinaldoassis.atlas`.
- [ ] Track `internal` liberado.
- [ ] Recrutar **12+ testers** com conta Google e abrir o **closed test**
      (14 dias corridos com todos opt-in; internal não conta).

**2. Assinatura e automação**
- [ ] Gerar a upload key (`keytool -genkeypair …`) e guardar `.jks` + senhas.
- [ ] Ligar **Play App Signing** no Console.
- [ ] Cadastrar os secrets: `ANDROID_KEYSTORE_BASE64`,
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- [ ] Conta de serviço da Play Developer API → `PLAY_SERVICE_ACCOUNT_JSON`.
- [ ] Rodar o workflow `Android` com os secrets e conferir o AAB no track
      `internal` (build local já validado).

**3. Produtos**
- [ ] `atlas_pro_monthly` — R$ 12,50/mês, trial 7 dias.
- [ ] `atlas_pro_annual` — R$ 97/ano, trial 7 dias.
- [ ] License testers + testar compra, acknowledge, restore e cancelamento.

**4. Device**
- [ ] Instalar o APK debug e testar boot, i18n (troca pt/en), limites do free
      e o paywall.
- [ ] Parear Android ↔ desktop e Android ↔ Android na mesma rede (sync).
- [ ] Conferir lembretes locais e o pedido de `POST_NOTIFICATIONS`.

**5. Loja**
- [ ] Publicar a política em `https://atlas.reinaldoassis.com/privacy`
      (texto em `docs/PRIVACY.md`).
- [ ] Ficha pt-BR/en (`docs/STORE-LISTING.md`), segurança de dados,
      classificação etária e declaração de anúncios.
- [ ] Produzir assets: ícone 512, feature graphic 1024×500, screenshots.

## Riscos

- **Assinatura e GPL**: o app é open source; quem compilar por conta própria
  contorna o gating. O objetivo é deter o usuário comum, não impedir fork.
- **Sync no Android**: multicast com `MulticastLock` cai em economia de energia;
  sync continua só com o app aberto, como no desktop.
- **Play Billing**: reembolso/cancelamento só chegam via reconsulta; a grace de
  7 dias é o que evita bloquear usuário legítimo sem rede.
