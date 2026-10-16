import { describe, expect, it } from 'vitest';
import { exportBackupV2, importBackupV2, type BackupData } from './storage';
import { demoNotes, demoSnapshot } from './fixtures';

function fileHoler(bytes: Uint8Array, name: string, type = 'application/zip'): File {
	return new File([bytes as BlobPart], name, { type });
}

async function toBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

function backup(): BackupData {
	const notes = demoNotes();
	return { snapshot: demoSnapshot(), notes: notes.notes, folders: notes.folders };
}

describe('backup v2', () => {
	it('exporta um zip com snapshot, notas e anexos', async () => {
		const data = backup();
		const attachments = [
			{ noteId: 'n1', name: 'recibo.pdf', bytes: new Uint8Array([1, 2, 3]) }
		];
		const bytes = await toBytes(await exportBackupV2(data, attachments));

		// Assinatura "PK" do zip.
		expect(bytes[0]).toBe(0x50);
		expect(bytes[1]).toBe(0x4b);

		const imported = await importBackupV2(fileHoler(bytes, 'atlas-backup.zip'));
		expect(imported.data.snapshot.habits.length).toBe(data.snapshot.habits.length);
		expect(imported.data.snapshot.trackers.map((tracker) => tracker.id)).toEqual(
			data.snapshot.trackers.map((tracker) => tracker.id)
		);
		expect(imported.data.snapshot.trackerEntries.length).toBe(data.snapshot.trackerEntries.length);
		expect(imported.data.notes.map((note) => note.id)).toEqual(data.notes.map((note) => note.id));
		expect(imported.data.folders.map((folder) => folder.id)).toEqual(
			data.folders.map((folder) => folder.id)
		);
		expect(imported.attachments).toEqual([
			{ noteId: 'n1', name: 'recibo.pdf', bytes: new Uint8Array([1, 2, 3]) }
		]);
	});

	it('exporta sem anexos quando não há nenhum', async () => {
		const bytes = await toBytes(await exportBackupV2(backup()));
		const imported = await importBackupV2(fileHoler(bytes, 'atlas-backup.zip'));
		expect(imported.attachments).toEqual([]);
		expect(imported.data.snapshot.transactions.length).toBeGreaterThan(0);
	});

	it('recusa arquivo que não é backup', async () => {
		const file = new File(['{"qualquer":"coisa"}'], 'notas.json', { type: 'application/json' });
		await expect(importBackupV2(file)).rejects.toThrow(/não parece ser um backup|incompleto|não foi reconhecido/i);
	});

	it('devolve as categorias padrão quando o backup vem sem nenhuma', async () => {
		const data = backup();
		data.snapshot.categories = [];
		const bytes = await toBytes(await exportBackupV2(data));
		const imported = await importBackupV2(fileHoler(bytes, 'atlas-backup.zip'));
		expect(imported.data.snapshot.categories.length).toBeGreaterThan(0);
	});
});
