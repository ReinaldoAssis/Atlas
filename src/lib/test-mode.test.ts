import { describe, expect, it } from 'vitest';
import { PROD_DB, TEST_DB, activeDbName, attachmentsRoot, previewKey } from './test-mode';

describe('activeDbName', () => {
	it('usa o banco de produção fora do modo de teste', () => {
		expect(activeDbName(false)).toBe(PROD_DB);
	});

	it('usa um banco separado no modo de teste', () => {
		expect(activeDbName(true)).toBe(TEST_DB);
		expect(TEST_DB).not.toBe(PROD_DB);
	});
});

describe('previewKey', () => {
	it('namespaceia por modo', () => {
		expect(previewKey('atlas-preview-state-v1', false)).toBe('atlas-preview-state-v1');
		expect(previewKey('atlas-preview-state-v1', true)).toBe('atlas-preview-state-v1-test');
	});
});

describe('attachmentsRoot', () => {
	it('separa a pasta de anexos no modo de teste', () => {
		expect(attachmentsRoot(false)).toBe('attachments');
		expect(attachmentsRoot(true)).toBe('attachments-test');
	});
});
