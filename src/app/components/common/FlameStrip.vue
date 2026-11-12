<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import {
  effectsEnabled,
  effectsStats,
  heat,
  motionAllowed,
  webglRenderer,
  onBurst,
  onStamp,
  type Burst,
  type ParticleKind,
} from '../../theme/effects';
import { flamePalette, rgb } from '../../theme/themes';

// Two layers: a WebGL fragment shader draws the fire body from scrolling fractal noise,
// and a 2D canvas draws embers that drift up from it (plus bursts the UI requests).
const flames = ref<HTMLCanvasElement>();
const vignette = ref<HTMLDivElement>();
const embers = ref<HTMLCanvasElement>();
// Pixel-art fire: both canvases render at 1 pixel per `pixelSize` CSS px and get upscaled with
// `image-rendering: pixelated`. 6px blocks = ~1/36 of the pixels, which is what makes it cheap.
const pixelSize = 6;

const vertexSource = 'attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }';
const fragmentSource = `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float heat;
uniform vec3 colorDeep;
uniform vec3 colorBody;
uniform vec3 colorTips;
uniform vec3 colorCore;
uniform float rainbow;
vec3 hsv(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
// Sin-free hash (Dave Hoskins): much cheaper than fract(sin()) on most GPUs.
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0, amplitude = 0.5;
  for (int i = 0; i < 4; i++) { value += amplitude * noise(p); p = p * 2.03 + vec2(1.7, 9.2); amplitude *= 0.5; }
  return value;
}
// Two octaves are plenty for the slow, large warp and tongue layers.
float fbm2(vec2 p) { return 0.5 * noise(p) + 0.25 * noise(p * 2.03 + vec2(1.7, 9.2)); }
void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  float scale = resolution.x / resolution.y;
  vec2 p = vec2(uv.x * scale * 1.6, uv.y);
  // Tongues: columns of varying height across the width. Computed first so empty sky can bail out early.
  float tongues = fbm2(vec2(p.x * 3.0, time * 0.35)) * 1.07 + 0.25;
  float height = (0.42 + heat * 0.55) * tongues;
  // body*1.25 never exceeds ~1.2, so pixels this far above the tongue can't be lit.
  if (uv.y > height * 1.3) { gl_FragColor = vec4(0.0); return; }
  // Rising turbulence: a slow large layer distorts a fast fine layer, which reads as licking flames.
  vec2 warp = vec2(fbm2(p * 1.3 - vec2(0.0, time * 0.6)), fbm2(p * 1.3 + vec2(5.2, -time * 0.7))) * 1.33;
  float body = fbm(p * vec2(2.2, 2.8) + warp * 1.4 - vec2(0.0, time * 1.9));
  float shape = body * 1.25 - uv.y / max(height, 0.05);
  // Posterize into hard bands for the retro look.
  float flame = floor(smoothstep(-0.05, 0.75, shape) * 5.0 + 0.5) / 5.0;
  vec3 deep = colorDeep, bodyColor = colorBody, tips = colorTips, core = colorCore;
  if (rainbow > 0.5) {
    // Full-saturation hue wave sweeping across the strip, like an RGB keyboard.
    vec3 hue = hsv(fract(uv.x * 0.8 + uv.y * 0.3 - time * 0.25));
    deep = hue * 0.45; bodyColor = hue; tips = mix(hue, vec3(1.0), 0.25); core = mix(hue, vec3(1.0), 0.7);
  }
  vec3 color = mix(deep, bodyColor, smoothstep(0.0, 0.45, flame));
  color = mix(color, tips, smoothstep(0.45, 0.8, flame));
  color = mix(color, core,smoothstep(0.85, 1.0, flame) * (0.4 + heat * 0.6));
  float alpha = smoothstep(0.0, 0.35, flame) * (1.0 - smoothstep(0.75, 1.0, uv.y));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

let gl: WebGLRenderingContext | null = null;
type Uniform = WebGLUniformLocation | null;
let uniforms:
  | {
      resolution: Uniform;
      time: Uniform;
      heat: Uniform;
      deep: Uniform;
      body: Uniform;
      tips: Uniform;
      core: Uniform;
      rainbow: Uniform;
    }
  | undefined;
let embersContext: CanvasRenderingContext2D | null = null;
let frame = 0;
let started = 0;
let lastTime = 0;
let observer: ResizeObserver | undefined;
let stopBursts: (() => void) | undefined;
let stopStamps: (() => void) | undefined;
const stampText = ref('');
const stampKey = ref(0);
let stampTimer = 0;
function showStamp(text: string) {
  stampText.value = text;
  stampKey.value++;
  clearTimeout(stampTimer);
  stampTimer = window.setTimeout(() => {
    stampText.value = '';
  }, 1600);
  // The stamp lands with a shockwave of sparks and embers from the middle of the screen.
  const x = window.innerWidth / 2,
    y = window.innerHeight * 0.42;
  addBurst({ x, y, count: 50, power: 2.2, kind: 'spark' });
  addBurst({ x, y, count: 30, power: 1.6, kind: 'ember' });
}

interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  hue: number;
}
const particles: Particle[] = [];
let spawnDebt = 0;
let lastHeatVar = -1;

let paletteRgb: number[][] = [];
watch(
  flamePalette,
  () => {
    paletteRgb = flamePalette.value.colors.map(rgb);
  },
  { immediate: true },
);

// Pre-rendered soft glows, stamped for each ember with additive blending. Redrawn when the palette changes.
// A rainbow palette gets one glow per hue step so embers can carry their own colour.
const hueSteps = 24;
let glows: HTMLCanvasElement[] = [];
function makeGlow(core: string, tips: string, body: string, deep: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, core);
  gradient.addColorStop(0.25, tips);
  gradient.addColorStop(0.6, body);
  gradient.addColorStop(1, deep);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return canvas;
}
function paintGlow() {
  const [deep, body, tips, core] = flamePalette.value.colors;
  glows = flamePalette.value.rainbow
    ? Array.from({ length: hueSteps }, (_, step) => {
        const hue = (step / hueSteps) * 360;
        return makeGlow(
          `hsl(${hue} 100% 85%)`,
          `hsla(${hue} 100% 60% / .9)`,
          `hsla(${hue} 100% 50% / .35)`,
          `hsla(${hue} 100% 30% / 0)`,
        );
      })
    : [makeGlow(core, `${tips}e6`, `${body}59`, `${deep}00`)];
}
paintGlow();
watch(flamePalette, paintGlow);

/** Rainbow hue (0–1) at a horizontal position, sweeping over time to match the shader. */
function hueAt(x: number): number {
  const time = (performance.now() - started) / 1000;
  return ((((x / window.innerWidth) * 0.8 - time * 0.25) % 1) + 1) % 1;
}

function compile(type: number, source: string): WebGLShader | null {
  const shader = gl!.createShader(type)!;
  gl!.shaderSource(shader, source);
  gl!.compileShader(shader);
  return gl!.getShaderParameter(shader, gl!.COMPILE_STATUS) ? shader : null;
}

function setupGl(): boolean {
  // Ask for the discrete GPU, and refuse a software (SwiftShader) context so we know when WebGL isn't really accelerated.
  const options: WebGLContextAttributes = {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: true,
  };
  gl = flames.value?.getContext('webgl', options) ?? null;
  let software = false;
  if (!gl) {
    software = true;
    console.warn(
      '[BasedCode] Hardware WebGL unavailable; fire falls back to a software context. Check chrome://gpu.',
    );
    gl =
      flames.value?.getContext('webgl', { ...options, failIfMajorPerformanceCaveat: false }) ??
      null;
  }
  if (!gl) {
    webglRenderer.value = 'WebGL unavailable';
    return false;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  webglRenderer.value = software ? `${renderer} (software, not GPU)` : renderer;
  console.info('[BasedCode] WebGL renderer:', renderer);
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    gl = null;
    return false;
  }
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const location = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  uniforms = {
    resolution: gl.getUniformLocation(program, 'resolution'),
    time: gl.getUniformLocation(program, 'time'),
    heat: gl.getUniformLocation(program, 'heat'),
    deep: gl.getUniformLocation(program, 'colorDeep'),
    body: gl.getUniformLocation(program, 'colorBody'),
    tips: gl.getUniformLocation(program, 'colorTips'),
    core: gl.getUniformLocation(program, 'colorCore'),
    rainbow: gl.getUniformLocation(program, 'rainbow'),
  };
  return true;
}

function resize() {
  if (flames.value) {
    flames.value.width = Math.max(1, Math.round(flames.value.clientWidth / pixelSize));
    flames.value.height = Math.max(1, Math.round(flames.value.clientHeight / pixelSize));
    gl?.viewport(0, 0, flames.value.width, flames.value.height);
  }
  if (embers.value) {
    // Same low-res grid as the fire, so embers come out as chunky pixels. Drawing code stays in CSS px.
    embers.value.width = Math.max(1, Math.ceil(window.innerWidth / pixelSize));
    embers.value.height = Math.max(1, Math.ceil(window.innerHeight / pixelSize));
    embersContext = embers.value.getContext('2d');
    if (embersContext) {
      embersContext.setTransform(1 / pixelSize, 0, 0, 1 / pixelSize, 0, 0);
      embersContext.imageSmoothingEnabled = false;
    }
  }
}

function spawn(x: number, y: number, power: number, spread: number, kind: ParticleKind = 'ember') {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
  // Sparks fly fast and die young; ash barely moves and lingers; embers float in between.
  const speed =
    (kind === 'spark'
      ? 180 + Math.random() * 380
      : kind === 'ash'
        ? 10 + Math.random() * 50
        : 40 + Math.random() * 120) * power;
  const maxLife =
    kind === 'spark'
      ? 0.25 + Math.random() * 0.45
      : kind === 'ash'
        ? 1.2 + Math.random() * 1.4
        : 0.8 + Math.random() * 1.6;
  const size =
    kind === 'spark'
      ? 1 + Math.random() * 1.5
      : kind === 'ash'
        ? 1.5 + Math.random() * 2.5
        : 3 + Math.random() * 7 * Math.min(power, 1.6);
  particles.push({
    kind,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: maxLife,
    maxLife,
    size,
    spin: Math.random() * Math.PI,
    hue: hueAt(x),
  });
}

function addBurst(event: Burst) {
  const spread =
    event.kind === 'spark' ? Math.PI * 1.7 : event.kind === 'ash' ? Math.PI * 2 : Math.PI * 1.4;
  for (let index = 0; index < event.count; index++)
    spawn(event.x, event.y, event.power * (0.8 + Math.random() * 1.4), spread, event.kind);
  if (event.kind !== 'ash') heat.value = Math.min(1, heat.value + 0.15 * event.power);
}

function draw(context: CanvasRenderingContext2D, particle: Particle, fade: number) {
  const rainbow = flamePalette.value.rainbow;
  const hue = particle.hue * 360;
  if (particle.kind === 'spark') {
    // A streak along the direction of travel, white-hot at the head.
    context.globalCompositeOperation = 'lighter';
    context.globalAlpha = Math.min(1, fade * 2);
    context.strokeStyle = rainbow
      ? `hsl(${hue} 100% ${fade > 0.5 ? 80 : 60}%)`
      : fade > 0.5
        ? flamePalette.value.colors[3]
        : flamePalette.value.colors[2];
    context.lineWidth = particle.size;
    context.beginPath();
    context.moveTo(particle.x, particle.y);
    context.lineTo(particle.x - particle.vx * 0.035, particle.y - particle.vy * 0.035);
    context.stroke();
  } else if (particle.kind === 'ash') {
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = Math.min(1, fade * 1.5) * 0.7;
    context.fillStyle =
      fade > 0.75 ? (rainbow ? `hsl(${hue} 100% 55%)` : flamePalette.value.colors[1]) : '#8a8580'; // Still glowing for a moment, then grey.
    context.save();
    context.translate(particle.x, particle.y);
    context.rotate(particle.spin);
    context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.6);
    context.restore();
  } else {
    context.globalCompositeOperation = 'lighter';
    const size = particle.size * (0.4 + fade * 0.8);
    context.globalAlpha = Math.min(1, fade * 1.6) * 0.85;
    const glow = glows[Math.floor(particle.hue * glows.length) % glows.length];
    context.drawImage(glow, particle.x - size, particle.y - size, size * 2, size * 2);
  }
}

// Measurement: counts every animation frame the page gets (not just effect ticks), so low fps here = the page is janking.
let statFrames = 0,
  statTicks = 0,
  statWork = 0,
  statWorstGap = 0,
  statPrev = 0,
  statSince = 0;
function recordFrame(now: number) {
  statFrames++;
  if (statPrev) statWorstGap = Math.max(statWorstGap, now - statPrev);
  statPrev = now;
  statSince ||= now;
  if (now - statSince < 1000) return;
  const seconds = (now - statSince) / 1000;
  effectsStats.value = `${Math.round(statFrames / seconds)} fps · worst frame ${Math.round(statWorstGap)} ms · effects ${(statTicks ? statWork / statTicks : 0).toFixed(2)} ms/tick · ${particles.length} particles`;
  statFrames = statTicks = statWork = statWorstGap = 0;
  statSince = now;
}

function tick(now: number) {
  frame = requestAnimationFrame(tick);
  recordFrame(now);

  // Measured ~0.13 ms per tick on an RTX 3060: throttling saved nothing and only looked choppy, so run every frame.
  const delta = Math.min(0.05, (now - (lastTime || now)) / 1000);
  lastTime = now;
  const workStart = performance.now();
  statTicks++;
  heat.value = Math.max(0.3, heat.value - delta * 0.18);

  if (gl && uniforms && flames.value) {
    gl.uniform2f(uniforms.resolution, flames.value.width, flames.value.height);
    gl.uniform1f(uniforms.time, (now - started) / 1000);
    gl.uniform1f(uniforms.heat, heat.value);
    const [deep, body, tips, core] = paletteRgb;
    gl.uniform3fv(uniforms.deep, deep);
    gl.uniform3fv(uniforms.body, body);
    gl.uniform3fv(uniforms.tips, tips);
    gl.uniform3fv(uniforms.core, core);
    gl.uniform1f(uniforms.rainbow, flamePalette.value.rainbow ? 1 : 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  if (!embersContext) return;
  // Idle embers rise from the fire line; more when it is stoked.
  const width = window.innerWidth;
  const base = window.innerHeight - 26 - 30;
  spawnDebt += delta * (5 + heat.value * 45);
  while (spawnDebt >= 1) {
    spawnDebt--;
    spawn(Math.random() * width, base + Math.random() * 30, 0.5 + heat.value, 0.9);
  }
  embersContext.clearRect(0, 0, width, window.innerHeight);
  for (let index = particles.length - 1; index >= 0; index--) {
    const particle = particles[index];
    particle.life -= delta;
    // Swap-remove: splice in a loop is O(n²) with ~1k particles.
    if (particle.life <= 0) {
      particles[index] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    if (particle.kind === 'spark') {
      particle.vy += 520 * delta; // Sparks arc back down.
      particle.vx *= 1 - 1.2 * delta;
    } else if (particle.kind === 'ash') {
      particle.vy += (18 - particle.vy) * delta; // Settle to a slow fall.
      particle.vx += (Math.random() - 0.5) * 60 * delta;
      particle.spin += delta * 3;
    } else {
      // Buoyancy, drag and a little flutter.
      particle.vy -= 30 * delta;
      particle.vx += (Math.random() - 0.5) * 80 * delta;
      particle.vx *= 1 - 0.9 * delta;
      particle.vy *= 1 - 0.4 * delta;
    }
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    draw(embersContext, particle, particle.life / particle.maxLife);
  }
  embersContext.globalAlpha = 1;
  embersContext.globalCompositeOperation = 'source-over';
  if (particles.length > 700) particles.splice(0, particles.length - 700);
  // Expose the heat to CSS (edge glow, combo colors) without touching the DOM every frame.
  // Only the vignette reads --heat; setting it on :root would restyle the whole document.
  if (Math.abs(heat.value - lastHeatVar) > 0.02) {
    lastHeatVar = heat.value;
    vignette.value?.style.setProperty('--heat', heat.value.toFixed(2));
  }
  statWork += performance.now() - workStart;
}

function start() {
  if (frame || !effectsEnabled.value || !motionAllowed.value || document.hidden) return;
  if (!gl) setupGl();
  resize();
  started ||= performance.now();
  lastTime = 0;
  frame = requestAnimationFrame(tick);
}
function stop() {
  cancelAnimationFrame(frame);
  frame = 0;
  particles.length = 0;
  embersContext?.clearRect(0, 0, window.innerWidth, window.innerHeight);
}
const visibility = () => {
  if (document.hidden) stop();
  else start();
};

onMounted(() => {
  observer = new ResizeObserver(resize);
  if (flames.value) observer.observe(flames.value);
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visibility);
  stopBursts = onBurst(addBurst);
  stopStamps = onStamp(showStamp);
  start();
});
onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  stopBursts?.();
  stopStamps?.();
  clearTimeout(stampTimer);
  window.removeEventListener('resize', resize);
  document.removeEventListener('visibilitychange', visibility);
});
watch([effectsEnabled, motionAllowed], () => {
  stop();
  start();
});
</script>

<template>
  <div
    v-show="effectsEnabled && motionAllowed"
    class="flame-layer"
    aria-hidden="true"
  >
    <canvas
      ref="flames"
      class="flame-strip"
    />
  </div>
  <div
    v-show="effectsEnabled && motionAllowed"
    class="effects-layer"
    aria-hidden="true"
  >
    <div
      ref="vignette"
      class="heat-vignette"
    />
    <canvas
      ref="embers"
      class="ember-field"
    />
    <div
      v-if="stampText"
      :key="stampKey"
      class="fire-stamp"
    >
      {{ stampText }}
    </div>
  </div>
</template>
