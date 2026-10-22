# Atlas — beta Android na Google Play

Decisões e plano da primeira distribuição do Atlas no Android. Vale para a
série **0.4.x**; o PC (macOS/Windows) continua **100% grátis**.

> Estado: decisões fechadas em 21/10/2026. Fatias marcadas ✅ já entregues.

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
| Gating | feature de build `mobile`; limite compilado fora no PC e verificado no Rust |
| Sync | entra na beta; descoberta via `mdns-sd` + `MulticastLock` (plugin Kotlin) |
| Lembretes | paridade com iOS (`POST_NOTIFICATIONS`, alarme exato no Android 12+) |
| Idiomas | pt-BR (base) + en; seletor Sistema / Português / English; fallback **en** fora de pt/en |
| Política | `atlas.reinaldoassis.com` (site do produto, feito depois desta série) |
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

- [ ] Recrutar 12+ testers com conta Google para o closed test.
- [ ] Criar os produtos de assinatura na Play Console (mensal e anual, trial 7d).
- [ ] Gerar o keystore de upload e registrar no Play App Signing.
- [ ] Conta de serviço da Play Developer API + secret no GitHub.
- [ ] Ficha da loja, formulário de segurança de dados, classificação etária.
- [ ] Publicar política de privacidade antes de submeter o primeiro AAB.

## Riscos

- **Assinatura e GPL**: o app é open source; quem compilar por conta própria
  contorna o gating. O objetivo é deter o usuário comum, não impedir fork.
- **Sync no Android**: multicast com `MulticastLock` cai em economia de energia;
  sync continua só com o app aberto, como no desktop.
- **Play Billing**: reembolso/cancelamento só chegam via reconsulta; a grace de
  7 dias é o que evita bloquear usuário legítimo sem rede.
