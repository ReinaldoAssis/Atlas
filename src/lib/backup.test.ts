import { describe, expect, it } from 'vitest';
import { backupFileName, fileNameFromPath, safetyCopyName } from './backup-io';
import { describeBackup, summarizeBackup } from './backup';
import type { BackupData } from './storage';

function data(): BackupData {
	return {
		snapshot: {
			habits: [
				{ id: 'a', name: 'A', active: true },
				{ id: 'b', name: 'B', active: false }
			],
			transactions: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
			trackers: [
				{ id: 'k1', name: 'Peso', active: true },
				{ id: 'k2', name: 'Humor', active: false }
			],
			timeBlocks: [{ id: 'b1' }]
		},
		notes: [{ id: 'n1' }, { id: 'n2' }],
		folders: [{ id: 'f1' }]
	} as unknown as BackupData;
}

describe('backup', () => {
	it('conta hábitos ativos, trackers, transações, blocos, notas, pastas e anexos', () => {
		const summary = summarizeBackup(data(), [{ noteId: 'n1', name: 'x.pdf', bytes: new Uint8Array() }]);
		expect(summary).toEqual({ habits: 1, trackers: 1, transactions: 3, timeBlocks: 1, notes: 2, folders: 1, attachments: 1 });
	});

	it('descreve o conteúdo em pt-BR com plural correto', () => {
		expect(describeBackup({ habits: 1, trackers: 0, transactions: 0, timeBlocks: 0, notes: 2, folders: 0, attachments: 1 })).toBe(
			'1 hábito, 2 notas e 1 anexo'
		);
	});

	it('resume backup vazio', () => {
		expect(describeBackup({ habits: 0, trackers: 0, transactions: 0, timeBlocks: 0, notes: 0, folders: 0, attachments: 0 })).toBe(
			'nenhum registro'
		);
	});
});

describe('backup-io', () => {
	it('nomeia o arquivo com a data', () => {
		expect(backupFileName(new Date(2026, 9, 16))).toBe('atlas-backup-2026-10-16.zip');
	});

	it('nomeia a cópia de segurança antes do import', () => {
		const at = new Date(2026, 9, 16, 12, 0, 0);
		expect(safetyCopyName(at)).toBe(`atlas-backup-2026-10-16-antes-do-import-${at.getTime()}.zip`);
	});

	it('extrai o nome do arquivo de um caminho', () => {
		expect(fileNameFromPath('/var/mobile/Containers/atlas-backup.zip')).toBe('atlas-backup.zip');
		expect(fileNameFromPath('C:\\Users\\me\\backup.json')).toBe('backup.json');
	});
});
