<script lang="ts">
	import { ShieldCheck } from '@lucide/svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * Antes do primeiro sync: mostra o que vai se juntar e onde ficou o backup
	 * automático (`backups/`). Só aparece uma vez, quando nenhum par sincronizou.
	 */
	let {
		summary,
		backupPath,
		busy = false,
		onconfirm,
		oncancel
	}: {
		summary: string;
		backupPath: string | null;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<Sheet title={m.sync_intro_title()} closeLabel={m.settings_close()} onclose={oncancel}>
	<div class="intro">
		<span class="lead"><ShieldCheck size={22} /></span>
		<p class="counts">{m.sync_intro_counts({ summary })}</p>
		{#if backupPath}
			<p class="backup">{m.sync_intro_backup({ path: backupPath })}</p>
		{/if}
		<div class="actions">
			<button type="button" class="ghost" disabled={busy} onclick={oncancel}>
				{m.sync_cancel()}
			</button>
			<button type="button" class="primary" disabled={busy} onclick={onconfirm}>
				{m.sync_intro_action()}
			</button>
		</div>
	</div>
</Sheet>

<style>
	.intro {
		display: grid;
		gap: 12px;
		padding: 4px 0 14px;
		text-align: center;
	}
	.lead {
		display: grid;
		place-items: center;
		color: var(--acc);
	}
	p {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
	}
	.counts {
		color: var(--tx);
	}
	.backup {
		color: var(--mu);
		word-break: break-all;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		padding-top: 6px;
	}
	button {
		min-height: 46px;
		border: 0;
		border-radius: 12px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.ghost {
		background: var(--s2);
		color: var(--mu);
	}
	.primary {
		background: var(--acc);
		color: var(--on-acc);
	}
</style>
