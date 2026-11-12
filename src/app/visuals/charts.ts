/** Chart geometry for render_chart: pure functions so the SVG component stays a thin template. */
export type ChartType =
  'line' | 'area' | 'bar' | 'stacked_bar' | 'horizontal_bar' | 'scatter' | 'pie' | 'donut';
export interface ChartSeries {
  name: string;
  values: (number | [number, number])[];
}

/** Categorical palette chosen to stay readable on both light and dark backgrounds. */
export const chartColors = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#59a14f',
  '#76b7b2',
  '#edc948',
  '#b07aa1',
  '#ff9da7',
  '#9c755f',
  '#8cd17d',
  '#d37295',
  '#a0cbe8',
];

/** Rounds a range out to "nice" tick values (1, 2, 5 × 10ⁿ), always including zero for bar-like charts. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= raw) ?? raw;
  const ticks: number[] = [];
  for (let value = Math.floor(min / step) * step; value <= max + step * 1e-9; value += step)
    ticks.push(Number(value.toPrecision(12)));
  if (ticks.at(-1)! < max) ticks.push(Number((ticks.at(-1)! + step).toPrecision(12)));
  return ticks;
}

/** Short tick label: 1200 → 1.2k, 3000000 → 3M. */
export function formatTick(value: number): string {
  const size = Math.abs(value);
  if (size >= 1e9) return `${Number((value / 1e9).toPrecision(3))}B`;
  if (size >= 1e6) return `${Number((value / 1e6).toPrecision(3))}M`;
  if (size >= 1e4) return `${Number((value / 1e3).toPrecision(3))}k`;
  return String(Number(value.toPrecision(4)));
}

/** SVG path for one pie/donut slice between two angles (radians, clockwise from 12 o'clock). */
export function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string {
  const point = (radius: number, angle: number) =>
    `${cx + radius * Math.sin(angle)} ${cy - radius * Math.cos(angle)}`;
  // A full circle cannot be one arc; stop just short of it.
  const sweep = Math.min(end - start, Math.PI * 2 - 1e-6);
  const large = sweep > Math.PI ? 1 : 0;
  const finish = start + sweep;
  if (!inner)
    return `M ${cx} ${cy} L ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, finish)} Z`;
  return `M ${point(outer, start)} A ${outer} ${outer} 0 ${large} 1 ${point(outer, finish)} L ${point(inner, finish)} A ${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`;
}
