/**
 * Modo de teste.
 *
 * Isola completamente os dados de exemplo num **banco separado**
 * (`atlas.test.db`), sem tocar no banco real (`atlas.db`). A flag vive em
 * `localStorage` (e não no banco, porque o banco é trocado). Como o banco é
 * outro arquivo, o `device_id` do modo de teste também é próprio — um sync
 * futuro nunca mistura os dois mundos.
 */

export const PROD_DB = 'sqlite:atlas.db';
export const TEST_DB = 'sqlite:atlas.test.db';

const FLAG_KEY = 'atlas-test-mode';

export function readTestMode(): boolean {
	try {
		return globalThis.localStorage?.getItem(FLAG_KEY) === '1';
	} catch {
		return false;
	}
}

export function writeTestMode(enabled: boolean): void {
	try {
		globalThis.localStorage?.setItem(FLAG_KEY, enabled ? '1' : '0');
	} catch {
		/* localStorage indisponível */
	}
}

/** Nome do banco SQLite ativo. */
export function activeDbName(testMode: boolean = readTestMode()): string {
	return testMode ? TEST_DB : PROD_DB;
}

/** Namespace de chaves de `localStorage` (preview) por modo. */
export function previewKey(base: string, testMode: boolean = readTestMode()): string {
	return testMode ? `${base}-test` : base;
}

/** Raiz dos anexos: separada no modo de teste. */
export function attachmentsRoot(testMode: boolean = readTestMode()): string {
	return testMode ? 'attachments-test' : 'attachments';
}
