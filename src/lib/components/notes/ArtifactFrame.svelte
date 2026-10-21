<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * Renderiza uma fence ```artifact num iframe sandbox isolado.
	 * Nada executa até o usuário optar por executar (click-to-play).
	 * `sandbox="allow-scripts"` sem `allow-same-origin`: origem opaca,
	 * sem acesso ao Tauri/IPC nem ao documento pai.
	 */
	let { code }: { code: string } = $props();

	let running = $state(false);
	let nonce = $state(0);
	let frame = $state<HTMLIFrameElement | null>(null);

	const ARTIFACT_CSP = [
		"default-src 'none'",
		"script-src 'unsafe-inline' 'unsafe-eval' blob:",
		"style-src 'unsafe-inline'",
		'img-src data: blob:',
		'font-src data:',
		"connect-src 'none'",
		'media-src none',
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'"
	].join('; ');

	let srcdoc = $derived.by(() => {
		const csp = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`;
		if (/<head[\s>]/i.test(code)) return code.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
		if (/<html[\s>]/i.test(code)) return code.replace(/<html([^>]*)>/i, `<html$1><head>${csp}</head>`);
		return `<!doctype html><html><head><meta charset="utf-8">${csp}<style>html,body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0e120e;color:#ecefe6}</style></head><body>${code}</body></html>`;
	});

	function run() {
		running = true;
		nonce += 1;
	}

	function stop() {
		running = false;
		if (frame) frame.srcdoc = '';
	}
</script>

<div class="nt-artifact">
	<div class="nt-artifact-bar">
		<span class="nt-artifact-tag">{m.artifact_tag()}</span>
		<span class="nt-artifact-hint">{m.artifact_hint()}</span>
		{#if running}
			<button type="button" class="nt-artifact-action" onclick={() => (nonce += 1)}>{m.artifact_reload()}</button>
			<button type="button" class="nt-artifact-action danger" onclick={stop}>{m.artifact_stop()}</button>
		{:else}
			<button type="button" class="nt-artifact-action" onclick={run}>{m.artifact_run()}</button>
		{/if}
	</div>
	{#if running}
		{#key nonce}
			<iframe
				bind:this={frame}
				class="nt-artifact-frame"
				title={m.artifact_frame_title()}
				sandbox="allow-scripts"
				referrerpolicy="no-referrer"
				srcdoc={srcdoc}
			></iframe>
		{/key}
	{:else}
		<pre class="nt-artifact-source">{code}</pre>
	{/if}
</div>
