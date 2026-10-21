import { describe, expect, it } from 'vitest';
import { localeFromLanguages, parseLocaleChoice, resolveLocale } from './locale';

describe('locale resolution', () => {
	it('maps every portuguese variant to pt-BR', () => {
		expect(localeFromLanguages(['pt-BR'])).toBe('pt-BR');
		expect(localeFromLanguages(['pt-PT'])).toBe('pt-BR');
	});

	it('falls back to english for any other system language', () => {
		expect(localeFromLanguages(['en-US'])).toBe('en');
		expect(localeFromLanguages(['es-ES'])).toBe('en');
		expect(localeFromLanguages(['fr'])).toBe('en');
		expect(localeFromLanguages([])).toBe('en');
		expect(localeFromLanguages(undefined)).toBe('en');
	});

	it('ignores empty entries before picking the first language', () => {
		expect(localeFromLanguages(['', 'pt-BR'])).toBe('pt-BR');
	});

	it('treats missing or invalid stored values as system', () => {
		expect(parseLocaleChoice(null)).toBe('system');
		expect(parseLocaleChoice('system')).toBe('system');
		expect(parseLocaleChoice('en')).toBe('en');
		expect(parseLocaleChoice('pt-BR')).toBe('pt-BR');
		expect(parseLocaleChoice('de')).toBe('system');
	});

	it('lets an explicit choice win over the system language', () => {
		expect(resolveLocale('en', ['pt-BR'])).toBe('en');
		expect(resolveLocale('pt-BR', ['en-US'])).toBe('pt-BR');
		expect(resolveLocale('system', ['es-ES'])).toBe('en');
		expect(resolveLocale('system', ['pt-PT'])).toBe('pt-BR');
	});
});
