<script setup lang="ts">
import { computed } from 'vue';
import { ChartColumn } from '../../icons';
import type { Message } from '../../../shared/types';
import {
  arcPath,
  chartColors,
  formatTick,
  niceTicks,
  type ChartSeries,
  type ChartType,
} from '../../visuals/charts';
import { t } from '../../theme/themes';
import ZoomFrame from '../common/ZoomFrame.vue';

const props = defineProps<{ message: Message }>();
type Args = {
  type: ChartType;
  title?: string;
  labels?: string[];
  series: ChartSeries[];
  xLabel?: string;
  yLabel?: string;
};
const tool = computed(
  () => props.message.metadata.tool as { args: Args; status: string; error?: string },
);
const args = computed(() => tool.value.args);
const color = (index: number) => chartColors[index % chartColors.length];

const width = 640;
const height = 320;
const horizontal = computed(() => args.value.type === 'horizontal_bar');
const round = computed(() => args.value.type === 'pie' || args.value.type === 'donut');
const margin = computed(() => ({
  top: 14,
  right: 16,
  bottom: args.value.xLabel ? 48 : 34,
  left: horizontal.value ? 110 : args.value.yLabel ? 62 : 48,
}));
const plot = computed(() => ({
  x: margin.value.left,
  y: margin.value.top,
  w: width - margin.value.left - margin.value.right,
  h: height - margin.value.top - margin.value.bottom,
}));

const numbers = (series: ChartSeries) =>
  series.values.map((value) => (typeof value === 'number' ? value : value[1]));
const count = computed(() => Math.max(...args.value.series.map((series) => series.values.length)));
const categories = computed(() =>
  Array.from(
    { length: count.value },
    (_, index) => args.value.labels?.[index] ?? String(index + 1),
  ),
);

/** Value axis ticks; bar-like charts always include zero, stacked bars use per-category totals. */
const valueTicks = computed(() => {
  const { type, series } = args.value;
  let values: number[];
  if (type === 'stacked_bar') {
    values = categories.value.flatMap((_, index) => {
      const parts = series.map((item) => numbers(item)[index] ?? 0);
      return [
        parts.filter((value) => value > 0).reduce((a, b) => a + b, 0),
        parts.filter((value) => value < 0).reduce((a, b) => a + b, 0),
      ];
    });
  } else values = series.flatMap(numbers);
  if (type !== 'line' && type !== 'scatter') values.push(0);
  return niceTicks(Math.min(...values), Math.max(...values));
});
const xTicks = computed(() => {
  if (args.value.type !== 'scatter') return [];
  const xs = args.value.series.flatMap((item) =>
    item.values.map((value) => (value as [number, number])[0]),
  );
  return niceTicks(Math.min(...xs), Math.max(...xs));
});

/** Maps a value to its pixel position along the value axis (y, or x for horizontal bars). */
function scaleValue(value: number): number {
  const ticks = valueTicks.value;
  const ratio = (value - ticks[0]) / (ticks.at(-1)! - ticks[0]);
  return horizontal.value
    ? plot.value.x + ratio * plot.value.w
    : plot.value.y + plot.value.h - ratio * plot.value.h;
}
function scaleX(value: number): number {
  const ticks = xTicks.value;
  return plot.value.x + ((value - ticks[0]) / (ticks.at(-1)! - ticks[0])) * plot.value.w;
}
/** Centre of a category band along the category axis. */
function band(index: number): number {
  const span = horizontal.value ? plot.value.h : plot.value.w;
  const start = horizontal.value ? plot.value.y : plot.value.x;
  return start + ((index + 0.5) * span) / count.value;
}
const bandSize = computed(() => (horizontal.value ? plot.value.h : plot.value.w) / count.value);
/** Show every nth category label so labels do not collide. */
const labelEvery = computed(() =>
  Math.max(1, Math.ceil(count.value / (horizontal.value ? plot.value.h / 16 : plot.value.w / 56))),
);

const lines = computed(() =>
  args.value.series.map((series, index) => {
    const values = numbers(series);
    const points = values.map((value, at) => ({ x: band(at), y: scaleValue(value), value }));
    const line = points.map((point, at) => `${at ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const zero = scaleValue(Math.max(valueTicks.value[0], 0));
    const area = `${line} L ${points.at(-1)!.x} ${zero} L ${points[0].x} ${zero} Z`;
    return { name: series.name, color: color(index), line, area, points };
  }),
);

const bars = computed(() => {
  const { type, series } = args.value;
  const result: { x: number; y: number; w: number; h: number; color: string; title: string }[] = [];
  const zero = scaleValue(0);
  const inner = bandSize.value * 0.8;
  categories.value.forEach((label, at) => {
    let up = 0;
    let down = 0;
    series.forEach((item, index) => {
      const value = numbers(item)[at] ?? 0;
      let from = zero;
      let to = scaleValue(value);
      let offset = -inner / 2;
      let thickness = inner / series.length;
      if (type === 'stacked_bar') {
        const base = value >= 0 ? up : down;
        from = scaleValue(base);
        to = scaleValue(base + value);
        if (value >= 0) up += value;
        else down += value;
        thickness = inner;
      } else offset += index * thickness;
      const along = band(at) + offset;
      const title = `${item.name} · ${label}: ${formatTick(value)}`;
      if (horizontal.value)
        result.push({
          x: Math.min(from, to),
          y: along,
          w: Math.abs(to - from),
          h: thickness,
          color: color(index),
          title,
        });
      else
        result.push({
          x: along,
          y: Math.min(from, to),
          w: thickness,
          h: Math.abs(to - from),
          color: color(index),
          title,
        });
    });
  });
  return result;
});

const scatter = computed(() =>
  args.value.series.map((series, index) => ({
    name: series.name,
    color: color(index),
    points: series.values.map((value) => {
      const [x, y] = value as [number, number];
      return {
        cx: scaleX(x),
        cy: scaleValue(y),
        title: `${series.name}: (${formatTick(x)}, ${formatTick(y)})`,
      };
    }),
  })),
);

const slices = computed(() => {
  const values = numbers(args.value.series[0]);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const outer = height / 2 - 16;
  let angle = 0;
  return values.map((value, index) => {
    const start = angle;
    angle += (value / total) * Math.PI * 2;
    const label = categories.value[index];
    return {
      path: arcPath(
        width / 2,
        height / 2,
        outer,
        args.value.type === 'donut' ? outer * 0.58 : 0,
        start,
        angle,
      ),
      color: color(index),
      title: `${label}: ${formatTick(value)} (${Math.round((value / total) * 1000) / 10}%)`,
    };
  });
});
const legend = computed(() =>
  round.value
    ? categories.value.map((name, index) => ({ name, color: color(index) }))
    : args.value.series.map((series, index) => ({ name: series.name, color: color(index) })),
);
const clip = (label: string, size: number) =>
  label.length > size ? `${label.slice(0, size - 1)}…` : label;
</script>

<template>
  <figure class="chart-view">
    <div class="eyebrow">
      <ChartColumn :size="12" /> {{ args.title ?? t('Chart') }}
    </div>
    <p
      v-if="tool.error"
      class="error-text"
    >
      {{ tool.error }}
    </p>
    <ZoomFrame
      v-else-if="tool.status === 'completed'"
      :title="args.title ?? t('Chart')"
    >
      <svg
        class="chart-svg"
        :viewBox="`0 0 ${width} ${height}`"
        role="img"
        :aria-label="args.title ?? t('Chart')"
      >
        <template v-if="round">
          <path
            v-for="(slice, index) in slices"
            :key="index"
            :d="slice.path"
            :fill="slice.color"
            class="slice"
          >
            <title>{{ slice.title }}</title>
          </path>
        </template>
        <template v-else>
          <g class="grid">
            <template
              v-for="tick in valueTicks"
              :key="tick"
            >
              <template v-if="horizontal">
                <line
                  :x1="scaleValue(tick)"
                  :x2="scaleValue(tick)"
                  :y1="plot.y"
                  :y2="plot.y + plot.h"
                />
                <text
                  :x="scaleValue(tick)"
                  :y="plot.y + plot.h + 16"
                  text-anchor="middle"
                >
                  {{ formatTick(tick) }}
                </text>
              </template>
              <template v-else>
                <line
                  :x1="plot.x"
                  :x2="plot.x + plot.w"
                  :y1="scaleValue(tick)"
                  :y2="scaleValue(tick)"
                />
                <text
                  :x="plot.x - 6"
                  :y="scaleValue(tick) + 4"
                  text-anchor="end"
                >
                  {{ formatTick(tick) }}
                </text>
              </template>
            </template>
            <template v-if="args.type === 'scatter'">
              <text
                v-for="tick in xTicks"
                :key="`x${tick}`"
                :x="scaleX(tick)"
                :y="plot.y + plot.h + 16"
                text-anchor="middle"
              >
                {{ formatTick(tick) }}
              </text>
            </template>
            <template
              v-for="(label, index) in categories"
              v-else
              :key="`c${index}`"
            >
              <template v-if="index % labelEvery === 0">
                <text
                  v-if="horizontal"
                  :x="plot.x - 6"
                  :y="band(index) + 4"
                  text-anchor="end"
                >
                  {{ clip(label, 16) }}
                </text>
                <text
                  v-else
                  :x="band(index)"
                  :y="plot.y + plot.h + 16"
                  text-anchor="middle"
                >
                  {{ clip(label, 10) }}
                </text>
              </template>
            </template>
            <text
              v-if="args.xLabel"
              :x="plot.x + plot.w / 2"
              :y="height - 8"
              text-anchor="middle"
              class="axis-label"
            >
              {{ args.xLabel }}
            </text>
            <text
              v-if="args.yLabel"
              :transform="`translate(14 ${plot.y + plot.h / 2}) rotate(-90)`"
              text-anchor="middle"
              class="axis-label"
            >
              {{ args.yLabel }}
            </text>
          </g>
          <template v-if="args.type === 'line' || args.type === 'area'">
            <g
              v-for="series in lines"
              :key="series.name"
            >
              <path
                v-if="args.type === 'area'"
                :d="series.area"
                :fill="series.color"
                opacity="0.22"
              />
              <path
                :d="series.line"
                :stroke="series.color"
                fill="none"
                stroke-width="2"
              />
              <circle
                v-for="(point, index) in series.points"
                :key="index"
                :cx="point.x"
                :cy="point.y"
                r="3"
                :fill="series.color"
              >
                <title>
                  {{ series.name }} · {{ categories[index] }}: {{ formatTick(point.value) }}
                </title>
              </circle>
            </g>
          </template>
          <g v-else-if="args.type === 'scatter'">
            <template
              v-for="series in scatter"
              :key="series.name"
            >
              <circle
                v-for="(point, index) in series.points"
                :key="index"
                :cx="point.cx"
                :cy="point.cy"
                r="4"
                :fill="series.color"
                opacity="0.8"
              >
                <title>{{ point.title }}</title>
              </circle>
            </template>
          </g>
          <g v-else>
            <rect
              v-for="(bar, index) in bars"
              :key="index"
              :x="bar.x"
              :y="bar.y"
              :width="bar.w"
              :height="bar.h"
              :fill="bar.color"
              rx="2"
            >
              <title>{{ bar.title }}</title>
            </rect>
          </g>
        </template>
      </svg>
    </ZoomFrame>
    <ul
      v-if="tool.status === 'completed' && !tool.error && (legend.length > 1 || round)"
      class="chart-legend"
    >
      <li
        v-for="(item, index) in legend"
        :key="index"
      >
        <span :style="{ background: item.color }" />{{ item.name }}
      </li>
    </ul>
  </figure>
</template>

<style scoped>
.chart-view {
  margin: 6px 0;
  display: grid;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.chart-view .eyebrow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chart-svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 420px;
}
.grid line {
  stroke: var(--border);
  stroke-width: 1;
}
.grid text {
  fill: var(--muted);
  font-size: 11px;
}
.grid .axis-label {
  fill: var(--text);
  font-size: 12px;
}
.slice {
  stroke: var(--surface);
  stroke-width: 2;
}
.chart-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--muted);
}
.chart-legend span {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 6px;
  vertical-align: -1px;
}
</style>
