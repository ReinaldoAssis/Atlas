import { isTauri } from '@tauri-apps/api/core';

type FeedbackTone = 'tap' | 'success' | 'erase' | 'paint';

let audio: AudioContext | undefined;

/**
 * “Thock” de digitação: pulso grave, filtrado e curto. A variação sutil evita
 * o efeito metralhadora sem chamar atenção.
 */
export function playTypingThock(enabled = true): void {
	if (!enabled || typeof window === 'undefined') return;
	try {
		audio ??= new AudioContext();
		if (audio.state === 'suspended') void audio.resume();
		const now = audio.currentTime;
		const base = 155 + Math.random() * 35;
		const oscillator = audio.createOscillator();
		const filter = audio.createBiquadFilter();
		const gain = audio.createGain();
		oscillator.type = 'triangle';
		oscillator.frequency.setValueAtTime(base, now);
		oscillator.frequency.exponentialRampToValueAtTime(base * 0.72, now + 0.035);
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime(460, now);
		filter.Q.setValueAtTime(0.7, now);
		gain.gain.setValueAtTime(0.0001, now);
		gain.gain.exponentialRampToValueAtTime(0.016, now + 0.004);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
		oscillator.connect(filter);
		filter.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(now);
		oscillator.stop(now + 0.06);
	} catch {
		// Audio is best effort; a browser may deny playback before a user gesture.
	}
}

export function playFeedback(tone: FeedbackTone, enabled = true, variation = 0): void {
	if (!enabled || typeof window === 'undefined') return;
	try {
		audio ??= new AudioContext();
		if (audio.state === 'suspended') void audio.resume();
		const now = audio.currentTime;
		const oscillator = audio.createOscillator();
		const gain = audio.createGain();
		const frequencies = { tap: 520, success: 680, erase: 280, paint: 410 + (variation % 7) * 38 };
		const duration = tone === 'success' ? 0.2 : 0.095;
		oscillator.type = 'sine';
		oscillator.frequency.setValueAtTime(frequencies[tone], now);
		if (tone === 'success') oscillator.frequency.exponentialRampToValueAtTime(920, now + duration);
		gain.gain.setValueAtTime(0.0001, now);
		gain.gain.exponentialRampToValueAtTime(tone === 'tap' ? 0.035 : 0.055, now + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(now);
		oscillator.stop(now + duration + 0.015);
	} catch {
		// Audio is best effort; a browser may deny playback before a user gesture.
	}
}

export function pulseHaptic(enabled = true, pattern: number | number[] = 10): void {
	if (!enabled || typeof navigator === 'undefined') return;
	try {
		if (isTauri()) {
			void import('@tauri-apps/plugin-haptics').then(({ impactFeedback }) => impactFeedback(Array.isArray(pattern) && pattern.length > 1 ? 'medium' : 'light')).catch(() => {});
			return;
		}
		if ('vibrate' in navigator) navigator.vibrate(pattern);
	} catch { /* Haptics are unavailable in some WebViews. */ }
}

export function playTone(
	frequency: number,
	duration = 0.12,
	type: OscillatorType = 'sine',
	volume = 0.05,
	enabled = true
): void {
	if (!enabled || typeof window === 'undefined') return;
	try {
		audio ??= new AudioContext();
		if (audio.state === 'suspended') void audio.resume();
		const now = audio.currentTime;
		const oscillator = audio.createOscillator();
		const gain = audio.createGain();
		oscillator.type = type;
		oscillator.frequency.value = frequency;
		gain.gain.setValueAtTime(volume, now);
		gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
		oscillator.connect(gain);
		gain.connect(audio.destination);
		oscillator.start(now);
		oscillator.stop(now + duration);
	} catch {
		// Audio is best effort; a browser may deny playback before a user gesture.
	}
}

export function vibrate(pattern: number | number[] = 10): void {
	if (typeof navigator === 'undefined') return;
	try {
		if ('vibrate' in navigator) navigator.vibrate(pattern);
	} catch {
		/* Vibration is unavailable in some WebViews. */
	}
}

export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function centerOf(element: HTMLElement | null): [number, number] {
	if (!element) return [window.innerWidth / 2, window.innerHeight / 2];
	const bounds = element.getBoundingClientRect();
	return [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
}

export function burstAt(x: number, y: number, count = 10, options: { up?: boolean; color?: string } = {}): void {
	if (typeof document === 'undefined' || prefersReducedMotion()) return;
	for (let index = 0; index < count; index += 1) {
		const particle = document.createElement('i');
		particle.className = 'atlas-particle';
		particle.style.left = `${x}px`;
		particle.style.top = `${y}px`;
		if (options.color) particle.style.background = options.color;
		document.body.append(particle);
		const angle = options.up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
		const distance = 30 + Math.random() * 60;
		particle
			.animate(
				[
					{ transform: 'translate(0, 0) scale(1)', opacity: 1 },
					{ transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px) scale(0)`, opacity: 0 }
				],
				{ duration: 700, easing: 'ease-out' }
			)
			.addEventListener('finish', () => particle.remove());
	}
}

export function floatValue(x: number, y: number, text: string, color?: string): void {
	if (typeof document === 'undefined' || prefersReducedMotion()) return;
	const element = document.createElement('b');
	element.className = 'atlas-float';
	element.textContent = text;
	element.style.left = `${x}px`;
	element.style.top = `${y}px`;
	if (color) element.style.color = color;
	document.body.append(element);
	element
		.animate(
			[
				{ transform: 'translate(-50%, 0)', opacity: 1 },
				{ transform: 'translate(-50%, -60px)', opacity: 0 }
			],
			{ duration: 1000, easing: 'ease-out' }
		)
		.addEventListener('finish', () => element.remove());
}

export function popElement(element: HTMLElement | null): void {
	if (!element || prefersReducedMotion()) return;
	element.animate(
		[{ transform: 'scale(.92)' }, { transform: 'scale(1.05)' }, { transform: 'none' }],
		{ duration: 400, easing: 'cubic-bezier(.3,1.6,.5,1)' }
	);
}

export function confetti(
	canvas: HTMLCanvasElement | null,
	count = 100,
	options: { colors?: string[]; fromTop?: boolean } = {}
): void {
	if (!canvas || prefersReducedMotion()) return;
	const context = canvas.getContext('2d');
	if (!context) return;
	const colors = options.colors ?? ['#d4f25a', '#ffb347', '#9cc8ff', '#c6a8ff', '#f1a5c5'];
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	const fromTop = options.fromTop ?? false;
	const pieces = Array.from({ length: count }, (_, index) => ({
		x: fromTop ? Math.random() * window.innerWidth : window.innerWidth / 2,
		y: fromTop ? -20 - Math.random() * 200 : window.innerHeight * 0.55,
		vx: fromTop ? (Math.random() - 0.5) * 3 : (Math.random() - 0.5) * 16,
		vy: fromTop ? 2 + Math.random() * 4 : -8 - Math.random() * 11,
		rotation: Math.random() * 6,
		spin: 5 + Math.random() * 6,
		size: fromTop ? 7 + Math.random() * 5 : 5 + Math.random() * 6,
		color: colors[index % colors.length]
	}));
	let frames = 0;
	const draw = () => {
		context.clearRect(0, 0, canvas.width, canvas.height);
		for (const piece of pieces) {
			if (fromTop) {
				piece.y += piece.vy;
				piece.x += piece.vx + Math.sin(piece.rotation) * 1.4;
				piece.rotation += 0.12;
				context.fillStyle = piece.color;
				context.beginPath();
				context.ellipse(piece.x, piece.y, piece.size / 2, Math.abs(Math.cos(piece.rotation)) * piece.size / 2 + 1, 0, 0, 6.3);
				context.fill();
			} else {
				piece.vy += 0.36;
				piece.x += piece.vx;
				piece.y += piece.vy;
				piece.rotation += 0.2;
				context.fillStyle = piece.color;
				context.save();
				context.translate(piece.x, piece.y);
				context.rotate(piece.rotation);
				context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.55);
				context.restore();
			}
		}
		frames += 1;
		if (frames < (fromTop ? 170 : 120)) requestAnimationFrame(draw);
		else context.clearRect(0, 0, canvas.width, canvas.height);
	};
	requestAnimationFrame(draw);
}

export function emitParticles(element: HTMLElement | null, count = 5): void {
	if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	const bounds = element.getBoundingClientRect();
	for (let index = 0; index < count; index += 1) {
		const particle = document.createElement('i');
		particle.className = 'feedback-particle';
		particle.style.left = `${bounds.left + bounds.width / 2}px`;
		particle.style.top = `${bounds.top + bounds.height / 2}px`;
		particle.style.setProperty('--dx', `${Math.cos((Math.PI * 2 * index) / count) * (12 + Math.random() * 16)}px`);
		particle.style.setProperty('--dy', `${Math.sin((Math.PI * 2 * index) / count) * (12 + Math.random() * 16)}px`);
		document.body.append(particle);
		particle.addEventListener('animationend', () => particle.remove(), { once: true });
	}
}
