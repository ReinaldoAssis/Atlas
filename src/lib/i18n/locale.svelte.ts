/**
 * Idioma em runtime.
 *
 * `i18n.locale` é um rune: `+page.svelte` envolve o app num `{#key}`, então
 * trocar o idioma remonta a árvore e todas as chamadas `m.*()` são reavaliadas
 * (as funções do Paraglide não são reativas por si).
 *
 * A escolha vive em `atlas.locale.mode` e é espelhada na chave que o Paraglide
 * usa (`PARAGLIDE_LOCALE`), para o primeiro render já sair no idioma certo.
 */
import { setLocale as paraglideSetLocale } from '#lib/paraglide/runtime.js';
import {
	LOCALE_MODE_KEY,
	localeFromLanguages,
	parseLocaleChoice,
	resolveLocale,
	type AppLocale,
	type LocaleChoice
} from './locale';

function readMode(): LocaleChoice {
	if (typeof localStorage === 'undefined') return 'system';
	try {
		return parseLocaleChoice(localStorage.getItem(LOCALE_MODE_KEY));
	} catch {
		return 'system';
	}
}

function systemLanguages(): string[] {
	if (typeof navigator === 'undefined') return [];
	return [...(navigator.languages ?? []), navigator.language].filter(Boolean);
}

export function systemLocale(): AppLocale {
	return localeFromLanguages(systemLanguages());
}

function initialLocale(): AppLocale {
	return resolveLocale(readMode(), systemLanguages());
}

export const i18n = $state<{ locale: AppLocale; mode: LocaleChoice }>({
	locale: initialLocale(),
	mode: readMode()
});

if (typeof window !== 'undefined') {
	paraglideSetLocale(i18n.locale, { reload: false });
}

/** Troca o idioma (ou volta a seguir o sistema) sem reload. */
export function setLocaleChoice(choice: LocaleChoice): void {
	const next = resolveLocale(choice, systemLanguages());
	try {
		localStorage.setItem(LOCALE_MODE_KEY, choice);
	} catch {
		// armazenamento bloqueado: a escolha vale só para esta sessão
	}
	i18n.mode = choice;
	i18n.locale = next;
	paraglideSetLocale(next, { reload: false });
}
