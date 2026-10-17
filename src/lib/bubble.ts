import { playTone, prefersReducedMotion, pulseHaptic } from './feedback';

/**
 * Bolha de tempo — controlador das animações do briefing do animador
 * (`design-playground/Atlas · Bolhas de tempo.html`).
 *
 * Portado do playground sem os controles de demonstração: material translúcido
 * com tint, cauda que cresce no fim da entrada, conteúdo com stagger, troca
 * célula→célula por deslize + crossfade, saída rápida e variante de toque
 * (assenta para baixo). Sempre ligado: blur e cauda.
 */

const SPRING = 'cubic-bezier(.2,1.15,.25,1)';

export interface BubbleOptions {
	/** Distância vertical da âncora (px). */
	offset?: number;
	/** Aceita hover nas linhas (planejador). */
	interactive?: boolean;
	/** A âncora é o meio dela (chip) em vez do topo (célula). */
	anchorMiddle?: boolean;
	/** Variante de toque: assenta para baixo. */
	touch?: boolean;
	sound?: boolean;
	haptics?: boolean;
	/** Clique numa linha do conteúdo (`data-i`). */
	onRowClick?: (index: number) => void;
	/** Chamado quando a bolha abre (ex.: som/háptica de âncora). */
	onEnter?: () => void;
}

interface Placement {
	l: number;
	t: number;
	tx: number;
}

export class TimeBubble {
	readonly el: HTMLElement;
	private readonly body: HTMLElement;
	private readonly content: HTMLElement;
	private readonly tail: HTMLElement;
	private open = false;
	private anchor: HTMLElement | null = null;
	private html = '';
	private hideTimer: ReturnType<typeof setTimeout> | undefined;
	private token = 0;
	/** Bolha "presa" (dwell no toque): só fecha por fora, rolagem ou ação. */
	private pinned = false;

	constructor(private readonly options: BubbleOptions = {}) {
		const el = document.createElement('div');
		el.className = `tbb${options.interactive ? ' in' : ''}`;
		el.style.setProperty('--of', `${options.offset ?? 10}px`);
		el.innerHTML = '<div class="tbb-m"><div class="tbb-c"></div><i class="tbb-t"></i></div>';
		document.body.appendChild(el);
		this.el = el;
		this.body = el.firstElementChild as HTMLElement;
		this.content = this.body.firstElementChild as HTMLElement;
		this.tail = this.body.lastElementChild as HTMLElement;

		el.addEventListener('pointerenter', () => clearTimeout(this.hideTimer));
		el.addEventListener('pointerleave', () => {
			if (!this.pinned) this.later();
		});
		el.addEventListener('click', (event) => {
			const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-i]');
			if (!row) return;
			const index = Number(row.dataset.i);
			if (Number.isFinite(index)) this.options.onRowClick?.(index);
		});
	}

	get isOpen(): boolean {
		return this.open;
	}

	get currentAnchor(): HTMLElement | null {
		return this.anchor;
	}

	private get reduced(): boolean {
		return prefersReducedMotion();
	}

	private tone(frequency: number, duration: number, rampTo?: number) {
		playTone(frequency, duration, 'sine', 0.03, this.options.sound ?? true);
		if (rampTo) setTimeout(() => playTone(rampTo, duration, 'sine', 0.02, this.options.sound ?? true), 20);
	}

	private vibrate(pattern: number | number[]) {
		pulseHaptic(this.options.haptics ?? true, pattern);
	}

	private place(anchor: HTMLElement): Placement {
		const rect = anchor.getBoundingClientRect();
		const width = this.el.offsetWidth;
		const rawLeft = rect.left + rect.width / 2;
		const left = Math.max(width / 2 + 8, Math.min(window.innerWidth - width / 2 - 8, rawLeft));
		const top = this.options.anchorMiddle ? rect.top + rect.height / 2 : rect.top;
		return { l: left, t: top, tx: Math.max(14, Math.min(width - 14, rawLeft - left + width / 2)) };
	}

	private apply(placement: Placement) {
		this.el.style.left = `${placement.l}px`;
		this.el.style.top = `${placement.t}px`;
		this.body.style.setProperty('--tx', `${placement.tx}px`);
	}

	show(anchor: HTMLElement, html: string, tint: string) {
		clearTimeout(this.hideTimer);
		this.el.style.setProperty('--tint', tint);
		if (!this.open) {
			this.token += 1;
			this.anchor = anchor;
			this.content.innerHTML = html;
			this.el.style.display = 'block';
			this.el.getAnimations().forEach((animation) => animation.cancel());
			this.body.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
			this.apply(this.place(anchor));
			this.open = true;
			this.enter();
		} else if (anchor !== this.anchor || html !== this.html) {
			this.swap(anchor, html);
		}
		this.html = html;
	}

	private enter() {
		const anchor = this.anchor;
		if (!anchor) return;
		this.options.onEnter?.();
		this.tone(520, 0.08, 700);
		this.vibrate(5);
		if (this.reduced) {
			this.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', fill: 'both' });
			return;
		}
		const dy = this.options.touch ? -8 : 10;
		this.body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out', fill: 'both' });
		this.body.animate([{ transform: `translateY(${dy}px) scale(.9)` }, { transform: 'none' }], {
			duration: 400,
			easing: SPRING,
			fill: 'both'
		});
		this.body.animate([{ filter: 'blur(4px)' }, { filter: 'blur(0)' }], { duration: 120, easing: 'ease-out', fill: 'both' });
		[...this.content.children].forEach((child, index) =>
			child.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], {
				duration: 220,
				delay: 75 + Math.min(index, 3) * 30,
				easing: 'ease-out',
				fill: 'both'
			})
		);
		this.tail.animate(
			[
				{ transform: 'translateX(-50%) rotate(45deg) scale(0)' },
				{ transform: 'translateX(-50%) rotate(45deg) scale(1)' }
			],
			{ duration: 160, delay: 260, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'both' }
		);
		anchor.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 220 });
	}

	/** Troca de âncora/conteúdo sem reentrada: desliza e faz crossfade. */
	private swap(anchor: HTMLElement, html: string) {
		const next = this.place(anchor);
		const previous = {
			l: Number.parseFloat(this.el.style.left || '0'),
			t: Number.parseFloat(this.el.style.top || '0'),
			tx: Number.parseFloat(this.body.style.getPropertyValue('--tx') || '0')
		};
		const direction = Math.sign(next.l - previous.l) || 1;
		this.anchor = anchor;
		this.tone(440, 0.05);
		this.vibrate(3);
		if (this.reduced) {
			this.content.innerHTML = html;
			this.apply(next);
			this.content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 60 });
			return;
		}
		const out = this.content.animate(
			[
				{ opacity: 1, transform: 'none' },
				{ opacity: 0, transform: `translateX(${-direction * 4}px)` }
			],
			{ duration: 55, easing: 'ease-in', fill: 'forwards' }
		);
		out.onfinish = () => {
			this.content.innerHTML = html;
			out.cancel();
			[...this.content.children].forEach((child) =>
				child.animate(
					[
						{ opacity: 0, transform: `translateX(${direction * 4}px)` },
						{ opacity: 1, transform: 'none' }
					],
					{ duration: 65, easing: 'ease-out' }
				)
			);
		};
		this.apply(next);
		this.el.animate(
			[
				{ left: `${previous.l}px`, top: `${previous.t}px` },
				{ left: `${next.l}px`, top: `${next.t}px` }
			],
			{ duration: 260, easing: SPRING }
		);
		this.tail.animate([{ left: `${previous.tx}px` }, { left: `${next.tx}px` }], { duration: 260, easing: SPRING });
	}

	/** Esconde depois de 180 ms (dá tempo do ponteiro chegar na bolha). */
	later() {
		if (this.pinned) return;
		clearTimeout(this.hideTimer);
		this.hideTimer = setTimeout(() => this.hide(), 180);
	}

	/** Prende a bolha para a interação por toque (dwell). */
	setPinned(value: boolean) {
		this.pinned = value;
		if (!value) this.later();
	}

	hide(now = false) {
		if (!this.open) return;
		this.pinned = false;
		clearTimeout(this.hideTimer);
		this.open = false;
		const token = ++this.token;
		const finish = () => {
			if (this.token === token && !this.open) this.el.style.display = 'none';
		};
		if (now) {
			this.el.style.display = 'none';
			return;
		}
		const animation = this.body.animate(
			this.reduced
				? [{ opacity: 1 }, { opacity: 0 }]
				: [
						{ opacity: 1, transform: 'none' },
						{ opacity: 0, transform: `translateY(${this.options.touch ? -6 : 6}px) scale(.96)` }
					],
			{ duration: this.reduced ? 120 : 170, easing: 'ease-in', fill: 'forwards' }
		);
		animation.onfinish = finish;
	}

	destroy() {
		clearTimeout(this.hideTimer);
		this.el.remove();
	}
}
