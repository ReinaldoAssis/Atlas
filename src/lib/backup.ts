import type { BackupAttachment, BackupData } from './storage';
import { m } from './paraglide/messages.js';

/** Resumo do que vem num backup, usado na confirmação do import. */
export interface BackupSummary {
	habits: number;
	trackers: number;
	transactions: number;
	timeBlocks: number;
	notes: number;
	folders: number;
	attachments: number;
}

export function summarizeBackup(data: BackupData, attachments: BackupAttachment[] = []): BackupSummary {
	return {
		habits: data.snapshot.habits.filter((habit) => habit.active).length,
		trackers: (data.snapshot.trackers ?? []).filter((tracker) => tracker.active).length,
		transactions: data.snapshot.transactions.length,
		timeBlocks: data.snapshot.timeBlocks.length,
		notes: data.notes.length,
		folders: data.folders.length,
		attachments: attachments.length
	};
}

function count(value: number, one: string, many: (count: number) => string): string {
	return value === 1 ? one : many(value);
}

/** Lista curta no idioma atual: "2 hábitos, 3 notas e 1 anexo". */
export function describeBackup(summary: BackupSummary): string {
	const parts = [
		summary.habits ? count(summary.habits, m.backup_habits_one(), (count) => m.backup_habits_many({ count })) : '',
		summary.trackers ? count(summary.trackers, m.backup_trackers_one(), (count) => m.backup_trackers_many({ count })) : '',
		summary.transactions ? count(summary.transactions, m.backup_transactions_one(), (count) => m.backup_transactions_many({ count })) : '',
		summary.timeBlocks ? count(summary.timeBlocks, m.backup_blocks_one(), (count) => m.backup_blocks_many({ count })) : '',
		summary.notes ? count(summary.notes, m.backup_notes_one(), (count) => m.backup_notes_many({ count })) : '',
		summary.attachments ? count(summary.attachments, m.backup_attachments_one(), (count) => m.backup_attachments_many({ count })) : ''
	].filter(Boolean);
	if (!parts.length) return m.backup_summary_none();
	if (parts.length === 1) return parts[0];
	return m.backup_summary_join({
		head: parts.slice(0, -1).join(', '),
		last: parts[parts.length - 1]
	});
}
