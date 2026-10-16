<script lang="ts">
	import { X } from '@lucide/svelte';
	import { onMount, type Snippet } from 'svelte';

	/**
	 * Kit Atlas — bottom sheet (`docs/DESIGN.md` §4).
	 *
	 * Mobile: entra de baixo, grip 40×4, raio superior 16–18 px.
	 * Desktop (≥ 860 px): centralizado, largura ≤ 520 px, sem "card dentro
	 * de card". Fecha por backdrop, Esc ou botão; prende o foco enquanto
	 * está aberto e devolve o foco ao elemento anterior ao fechar.
	 */
	let {
		title,
		closeLabel,
		onclose,
		children
	}: {
		title: string;
		closeLabel: string;
		onclose: () => void;
		children?: Snippet;
	} = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;

	let panel = $state<HTMLElement | null>(null);

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function focusables(): HTMLElement[] {
		return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
	}

	function onBackdrop(event: MouseEvent) {
		if (event.target === event.currentTarget) onclose();
	}

	onMount(() => {
		const previous = document.activeElement as HTMLElement | null;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		(focusables()[0] ?? panel)?.focus();

		function onKeydown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.stopPropagation();
				onclose();
				return;
			}
			if (event.key !== 'Tab' || !panel) return;
			const items = focusables();
			if (!items.length) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = items[0];
			const last = items[items.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || active === panel)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && active === last) {
				event.preventDefault();
				first.focus();
			}
		}

		window.addEventListener('keydown', onKeydown, true);
		return () => {
			window.removeEventListener('keydown', onKeydown, true);
			document.body.style.overflow = previousOverflow;
			previous?.focus?.();
		};
	});
</script>

<div class="backdrop" role="presentation" onclick={onBackdrop}>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} bind:this={panel} tabindex="-1">
		<div class="grip" aria-hidden="true"></div>
		<header class="head">
			<h2 id={titleId}>{title}</h2>
			<button type="button" class="close" aria-label={closeLabel} onclick={onclose}>
				<X size={19} />
			</button>
		</header>
		<div class="body">
			{@render children?.()}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		z-index: 60;
		inset: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		background: #000a;
		animation: sheet-fade 0.2s var(--ease-smooth);
	}
	.sheet {
		display: flex;
		flex-direction: column;
		width: min(520px, 100%);
		max-height: 92dvh;
		padding: 8px 18px calc(18px + env(safe-area-inset-bottom, 0px));
		border-radius: 18px 18px 0 0;
		background: var(--s);
		color: var(--tx);
		animation: sheet-in 0.32s var(--ease-smooth);
	}
	.sheet:focus {
		outline: none;
	}
	.grip {
		width: 40px;
		height: 4px;
		margin: 4px auto 12px;
		border-radius: 2px;
		background: var(--ln);
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding-bottom: 12px;
	}
	.head h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 800;
		letter-spacing: -0.03em;
	}
	.close {
		flex: none;
		width: 36px;
		height: 36px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: var(--s2);
		color: var(--mu);
		cursor: pointer;
	}
	.close:hover {
		color: var(--tx);
	}
	.body {
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	@keyframes sheet-in {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
	@keyframes sheet-fade {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (min-width: 860px) {
		.backdrop {
			align-items: center;
			padding: 24px;
		}
		.sheet {
			max-height: min(88dvh, 760px);
			padding: 10px 22px 22px;
			border-radius: 18px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop,
		.sheet {
			animation: none;
		}
	}
</style>
