import type { BackupAttachment, BackupData } from './storage';

/**
 * Entrada/saída de arquivos do backup, por plataforma.
 *
 * - **Navegador** (preview web): download por `<a download>` e `<input type="file">`.
 * - **Desktop (Tauri)**: `dialog.save` devolve o caminho e o `plugin-fs` escreve.
 * - **iOS (Tauri)**: o picker do iOS só sabe *mover* um arquivo que já existe
 *   (o plugin cria um placeholder vazio quando o nome não existe), então
 *   escrevemos os bytes em `Documents` e deixamos o `save` mover para o
 *   destino escolhido — escrever no caminho devolvido exigiria acesso
 *   security-scoped, que o `plugin-fs` não tem.
 *   `<a download>` com blob não funciona no WKWebView: é o motivo deste módulo.
 */

export type SaveResult = 'saved' | 'cancelled';

/**
 * Mesma detecção do `@tauri-apps/api` (`globalThis.isTauri`), sem importar o
 * pacote: mantém este módulo carregável nos testes de unidade em node.
 */
export function isTauriApp(): boolean {
	return Boolean((globalThis as { isTauri?: boolean }).isTauri);
}

export interface PickedFile {
	name: string;
	bytes: Uint8Array;
}

/** `atlas-backup-2026-10-16.zip` */
export function backupFileName(now: Date = new Date()): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `atlas-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

/** Nome da cópia de segurança gravada antes de um import. */
export function safetyCopyName(now: Date = new Date()): string {
	return `${backupFileName(now).replace(/\.zip$/, '')}-antes-do-import-${now.getTime()}.zip`;
}

/** iOS: WKWebView se identifica como iPhone/iPad/iPod. */
export function isIOSWebView(): boolean {
	if (!isTauriApp()) return false;
	return /iP(hone|ad|od)/.test(navigator.userAgent);
}

export function fileNameFromPath(path: string): string {
	return path.split(/[/\\]/).pop() ?? path;
}

export interface SaveFilter {
	name: string;
	extensions: string[];
}

const BACKUP_FILTERS: SaveFilter[] = [{ name: 'Backup do Atlas', extensions: ['zip', 'json'] }];

/** Salva os bytes num arquivo escolhido pelo usuário. */
export async function saveBytes(
	bytes: Uint8Array,
	fileName: string,
	filters: SaveFilter[] = BACKUP_FILTERS
): Promise<SaveResult> {
	if (!isTauriApp()) {
		downloadInBrowser(bytes, fileName);
		return 'saved';
	}
	const dialog = await import('@tauri-apps/plugin-dialog');
	const fs = await import('@tauri-apps/plugin-fs');

	if (isIOSWebView()) {
		await fs.writeFile(fileName, bytes, { baseDir: fs.BaseDirectory.Document });
		const destination = await dialog.save({ defaultPath: fileName, filters });
		if (!destination) {
			await fs.remove(fileName, { baseDir: fs.BaseDirectory.Document }).catch(() => undefined);
			return 'cancelled';
		}
		return 'saved';
	}

	const destination = await dialog.save({ defaultPath: fileName, filters });
	if (!destination) return 'cancelled';
	await fs.writeFile(destination, bytes);
	return 'saved';
}

/** Abre o seletor de arquivos e devolve o que o usuário escolheu. */
export async function pickFile(extensions: string[], label = 'Backup do Atlas'): Promise<PickedFile | null> {
	if (!isTauriApp()) return pickInBrowser(extensions);
	const dialog = await import('@tauri-apps/plugin-dialog');
	const fs = await import('@tauri-apps/plugin-fs');
	const picked = await dialog.open({ multiple: false, directory: false, filters: [{ name: label, extensions }] });
	if (!picked || typeof picked !== 'string') return null;
	const bytes = await fs.readFile(picked);
	return { name: fileNameFromPath(picked), bytes };
}

/**
 * Grava uma cópia no diretório de dados do app (`backups/`). Rede de
 * segurança antes de sobrescrever tudo num import. No navegador não existe
 * diretório de dados: devolve `null`.
 */
export async function writeSafetyCopy(bytes: Uint8Array, fileName: string): Promise<string | null> {
	if (!isTauriApp()) return null;
	const fs = await import('@tauri-apps/plugin-fs');
	const folder = 'backups';
	await fs.mkdir(folder, { baseDir: fs.BaseDirectory.AppData, recursive: true });
	const relative = `${folder}/${fileName}`;
	await fs.writeFile(relative, bytes, { baseDir: fs.BaseDirectory.AppData });
	return relative;
}

function downloadInBrowser(bytes: Uint8Array, fileName: string): void {
	const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	anchor.rel = 'noopener';
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickInBrowser(extensions: string[]): Promise<PickedFile | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = extensions.map((extension) => `.${extension}`).join(',');
		input.dataset.atlasFileInput = 'backup';
		input.style.display = 'none';
		document.body.appendChild(input);
		const finish = (value: PickedFile | null) => {
			input.remove();
			resolve(value);
		};
		input.addEventListener('cancel', () => finish(null));
		input.addEventListener('change', async () => {
			const file = input.files?.[0];
			if (!file) return finish(null);
			finish({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
		});
		input.click();
	});
}
