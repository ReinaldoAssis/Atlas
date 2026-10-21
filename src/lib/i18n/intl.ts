/**
 * Locale para `Intl.*`.
 *
 * Lê direto do runtime do Paraglide (e não do rune `i18n.locale`) para poder
 * ser chamado de módulos puros testados em node. Como cada formatação roda
 * durante o render, a troca de idioma remonta a árvore e o valor já é o novo.
 */
import { getLocale } from '#lib/paraglide/runtime.js';

export function intlLocale(): string {
	try {
		return getLocale();
	} catch {
		return 'pt-BR';
	}
}
