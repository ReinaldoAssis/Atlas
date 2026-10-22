/**
 * Resolução do idioma do app, sem tocar em DOM — testável em node.
 *
 * Ordem: escolha explícita do usuário (`pt-BR`/`en`) > idioma do sistema.
 * Sistema em qualquer língua que não seja português cai em **en**.
 */

export const APP_LOCALES = ['pt-BR', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export type LocaleChoice = AppLocale | 'system';

export const LOCALE_MODE_KEY = 'atlas.locale.mode';

export function isAppLocale(value: unknown): value is AppLocale {
	return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}

/** Primeira língua do sistema: `pt*` → pt-BR; todo o resto → en. */
export function localeFromLanguages(languages: readonly string[] | undefined): AppLocale {
	const preferred = languages?.find((language) => language.trim().length > 0) ?? '';
	return preferred.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

/** Escolha salva no aparelho; qualquer valor inválido volta para `system`. */
export function parseLocaleChoice(raw: string | null): LocaleChoice {
	if (!raw) return 'system';
	if (raw === 'system') return 'system';
	if (isAppLocale(raw)) return raw;
	return 'system';
}

export function resolveLocale(choice: LocaleChoice, languages: readonly string[] | undefined): AppLocale {
	return choice === 'system' ? localeFromLanguages(languages) : choice;
}
