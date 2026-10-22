import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHardcoded, type Finding } from './hardcoded';

/**
 * Guard do i18n: nenhuma tela nova pode nascer com copy solta.
 *
 * `UPDATE_I18N_ALLOWLIST=1 npx vitest run src/lib/i18n/hardcoded.test.ts`
 * regrava a lista (use só ao migrar um arquivo, nunca para "consertar" o CI).
 */

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const ALLOWLIST = join(SRC, 'lib/i18n/hardcoded-allowlist.json');

function walk(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'paraglide' || entry.name === 'node_modules') return [];
			return walk(full);
		}
		if (!entry.name.endsWith('.svelte')) return [];
		if (entry.name.endsWith('.test.ts')) return [];
		return [full];
	});
}

function collect(): Map<string, Finding[]> {
	const byFile = new Map<string, Finding[]>();
	for (const full of walk(SRC)) {
		const file = relative(ROOT, full).split('\\').join('/');
		const findings = findHardcoded(readFileSync(full, 'utf8'), file, 'svelte');
		if (findings.length) byFile.set(file, findings);
	}
	return byFile;
}

describe('i18n guard', () => {
	it('keeps hardcoded copy only in files still on the migration list', () => {
		const found = collect();
		if (process.env.UPDATE_I18N_ALLOWLIST === '1') {
			const files = [...found.keys()].sort();
			writeFileSync(ALLOWLIST, `${JSON.stringify(files, null, '\t')}\n`);
			return;
		}

		const allowlist = new Set<string>(JSON.parse(readFileSync(ALLOWLIST, 'utf8')));
		const offenders = [...found.entries()].filter(([file]) => !allowlist.has(file));
		const report = offenders
			.map(([file, findings]) => {
				const samples = findings
					.slice(0, 5)
					.map((finding) => `  ${finding.line}: ${finding.text}`)
					.join('\n');
				return `${file} (${findings.length})\n${samples}`;
			})
			.join('\n');

		expect(offenders, `copy hardcoded fora da allowlist:\n${report}`).toHaveLength(0);
	});
});
