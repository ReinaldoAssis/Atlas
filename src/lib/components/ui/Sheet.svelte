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
		onpullup,
		children
	}: {
		title: string;
		closeLabel: string;
		onclose: () => void;
		/** Arrastar a alça para cima (mobile) dispara este callback. */
		onpullup?: () => void;
		children?: Snippet;
	} = $props();

	/**
	 * Gesto de arrastar para cima em qualquer ponto do sheet (alça, cabeçalho ou
	 * conteúdo quando o scroll está no topo). Arma após 12 px e abre após 48 px.
	 * Controles interativos e conteúdo já rolado não iniciam o gesto.
	 */
	function pullUp(node: HTMLElement, callback?: () => void) {
		let startY = 0;
		let startX = 0;
		let active = false;
		let armed = false;
		let exitTimer: ReturnType<typeof setTimeout> | undefined;
		let settleTimer: ReturnType<typeof setTimeout> | undefined;
		const backdrop = node.parentElement;
		const reduced = () =>
			typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		function settle() {
			node.style.transition = 'transform .28s cubic-bezier(.3,1.2,.5,1)';
			node.style.transform = '';
			if (backdrop) {
				backdrop.style.transition = 'opacity .22s ease-out';
				backdrop.style.opacity = '1';
			}
			settleTimer = setTimeout(() => {
				node.style.transition = '';
				node.style.willChange = '';
				if (backdrop) backdrop.style.transition = '';
			}, 300);
		}

		const down = (event: TouchEvent) => {
			if (!callback || event.touches.length !== 1) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest('button, a, input, textarea, select, [contenteditable="true"], [role="button"]')) return;
			const body = node.querySelector<HTMLElement>('.body');
			if (body && body.scrollTop > 0) return;
			if (exitTimer) clearTimeout(exitTimer);
			if (settleTimer) clearTimeout(settleTimer);
			startY = event.touches[0].clientY;
			startX = event.touches[0].clientX;
			active = true;
			armed = false;
			node.style.transition = 'none';
			node.style.willChange = 'transform';
			if (backdrop) {
				backdrop.style.transition = 'none';
				backdrop.style.opacity = '1';
			}
		};
		const move = (event: TouchEvent) => {
			if (!active || !callback || event.touches.length !== 1) return;
			const dy = event.touches[0].clientY - startY;
			const dx = event.touches[0].clientX - startX;
			if (!armed && Math.abs(dx) > Math.abs(dy)) {
				active = false;
				settle();
				return;
			}
			if (!armed && dy < -12) armed = true;
			if (!armed) return;
			if (event.cancelable) event.preventDefault();
			// O sheet acompanha o dedo com resistência; o backdrop escurece menos.
			const pull = Math.max(0, -dy);
			node.style.transform = `translateY(${-Math.min(130, pull * 0.55)}px)`;
			if (backdrop) backdrop.style.opacity = String(Math.max(0.35, 1 - pull / 320));
		};
		const end = (event: TouchEvent) => {
			if (!active || !callback) return;
			const touch = event.changedTouches[0];
			const dy = touch ? touch.clientY - startY : 0;
			active = false;
			const triggered = armed && dy <= -48;
			armed = false;
			if (!triggered) {
				settle();
				return;
			}
			if (reduced()) {
				callback();
				return;
			}
			node.style.transition = 'transform .2s cubic-bezier(.4,0,1,1)';
			node.style.transform = 'translateY(-110%)';
			if (backdrop) {
				backdrop.style.transition = 'opacity .2s ease-in';
				backdrop.style.opacity = '0';
			}
			exitTimer = setTimeout(callback, 190);
		};
		const cancel = () => {
			if (!active) return;
			active = false;
			armed = false;
			settle();
		};
		node.addEventListener('touchstart', down, { passive: true });
		node.addEventListener('touchmove', move, { passive: false });
		node.addEventListener('touchend', end);
		node.addEventListener('touchcancel', cancel);
		return {
			destroy() {
				if (exitTimer) clearTimeout(exitTimer);
				if (settleTimer) clearTimeout(settleTimer);
				node.removeEventListener('touchstart', down);
				node.removeEventListener('touchmove', move);
				node.removeEventListener('touchend', end);
				node.removeEventListener('touchcancel', cancel);
			}
		};
	}

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
		const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? null;
		const target = preferred ?? focusables()[0] ?? panel;
		target?.focus();
		if (preferred instanceof HTMLInputElement && preferred.type !== 'date' && preferred.type !== 'time') preferred.select();

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
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} bind:this={panel} tabindex="-1" use:pullUp={onpullup}>
		<div class="grip" class:pull={Boolean(onpullup)} aria-hidden="true"></div>
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
	.grip.pull {
		position: relative;
		width: 64px;
		height: 24px;
		margin: -4px auto 2px;
		background: transparent;
		touch-action: none;
		cursor: grab;
	}
	.grip.pull::before {
		content: '';
		position: absolute;
		top: 8px;
		left: 50%;
		width: 40px;
		height: 4px;
		margin-left: -20px;
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
