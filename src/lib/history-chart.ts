/** Série simples para os gráficos de histórico (SVG próprio, sem lib). */
export interface HistoryPoint {
	date: string;
	value: number;
}

export interface HistoryChart {
	width: number;
	height: number;
	line: string;
	area: string;
	coords: [number, number][];
	targetY: number | null;
}

export function buildHistoryChart(
	points: HistoryPoint[],
	target: number | null,
	width = 320,
	height = 120
): HistoryChart | null {
	if (!points.length) return null;
	const pad = 12;
	const scale = target == null ? points.map((point) => point.value) : [...points.map((point) => point.value), target];
	const min = Math.min(...scale);
	const max = Math.max(...scale);
	const span = max - min || 1;
	const x = (index: number) =>
		points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - pad * 2);
	const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);
	const coords = points.map((point, index) => [x(index), y(point.value)] as [number, number]);
	const line = coords.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
	const area = `${line} L${coords[coords.length - 1][0].toFixed(1)} ${height} L${coords[0][0].toFixed(1)} ${height} Z`;
	return { width, height, line, area, coords, targetY: target == null ? null : y(target) };
}
