<script setup lang="ts">
/**
 * Ambient background while effects are on: based things (emoji and words) drift across the
 * screen like an aquarium, bobbing and occasionally spinning.
 *
 * Every movement is a CSS transform animation, so the browser's compositor runs it on the GPU at
 * the display's refresh rate with no JavaScript per frame. JS only runs when a critter finishes a
 * lap, to give it a new look and lane.
 */
import { ref } from 'vue';
import { effectsEnabled, motionAllowed } from '../../theme/effects';

const EMOJI = ['🗿', '😎', '🔥', '💯', '🚀', '🧠', '🫃'];
const WORDS = ['BASED', 'BANNED', 'gg', 'chat???', 'rizz', 'codegod', 'sigma', 'cooking', 'fr fr', 'goated', 'kirkified'];
const COUNT = 69;

interface Critter {
  id: number;
  text: string;
  isWord: boolean;
  /** Lane, as a percentage of the screen height. */
  top: number;
  /** Seconds for one crossing; near critters are faster. */
  duration: number;
  /** Negative delay starts the critter part-way across the screen. */
  delay: number;
  leftward: boolean;
  size: number;
  opacity: number;
  bob: number;
  bobDuration: number;
  spinDuration: number;
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

function create(id: number, midSwim: boolean): Critter {
  const depth = Math.random();
  const isWord = Math.random() < 0.4;
  const duration = 60 - depth * 35;
  return {
    id,
    text: isWord ? pick(WORDS) : pick(EMOJI),
    isWord,
    top: 2 + Math.random() * 92,
    duration,
    delay: midSwim ? -Math.random() * duration : 0,
    leftward: Math.random() < 0.5,
    size: Math.round(14 + depth * 22),
    opacity: 0.1 + depth * 0.18,
    bob: 6 + depth * 10,
    bobDuration: 3 + Math.random() * 3,
    spinDuration: 20 + Math.random() * 40,
  };
}

const critters = ref(Array.from({ length: COUNT }, (_, index) => create(index, true)));

/** After a crossing, swap the critter for a fresh one in a new lane. */
function relaunch(index: number, event: AnimationEvent) {
  // Scoped styles suffix keyframe names with a hash, so match the prefix.
  if (event.animationName.startsWith('aquarium-swim') && event.target === event.currentTarget) {
    critters.value[index] = create(critters.value[index].id, false);
  }
}
</script>

<template>
  <div
    v-if="effectsEnabled && motionAllowed"
    class="based-aquarium"
    aria-hidden="true"
  >
    <div
      v-for="(critter, index) in critters"
      :key="`${critter.id}-${critter.text}-${critter.top}`"
      class="swim"
      :style="{
        top: `${critter.top}%`,
        animationDuration: `${critter.duration}s`,
        animationDelay: `${critter.delay}s`,
        animationDirection: critter.leftward ? 'reverse' : 'normal',
      }"
      @animationiteration="relaunch(index, $event)"
    >
      <div
        class="bob"
        :style="{ '--bob': `${critter.bob}px`, animationDuration: `${critter.bobDuration}s` }"
      >
        <span
          class="critter"
          :class="{ word: critter.isWord, flipped: !critter.isWord && critter.leftward }"
          :style="{
            fontSize: `${critter.size}px`,
            opacity: critter.opacity,
            animationDuration: `${critter.spinDuration}s`,
          }"
        >{{ critter.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.based-aquarium {
  position: fixed;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
}
.swim {
  position: absolute;
  left: 0;
  will-change: transform;
  animation: aquarium-swim linear infinite;
}
.bob {
  will-change: transform;
  animation: aquarium-bob ease-in-out infinite alternate;
}
.critter {
  display: block;
  line-height: 1;
  white-space: nowrap;
  font-family: system-ui, 'Segoe UI Emoji', sans-serif;
  will-change: transform;
  animation: aquarium-spin ease-in-out infinite;
}
.critter.word {
  font-weight: 800;
  font-size: 0.8em;
  color: var(--accent);
}
.critter.flipped {
  scale: -1 1;
}
@keyframes aquarium-swim {
  from { transform: translate3d(-15vw, 0, 0); }
  to { transform: translate3d(110vw, 0, 0); }
}
@keyframes aquarium-bob {
  from { transform: translate3d(0, calc(var(--bob) * -1), 0) rotate(-6deg); }
  to { transform: translate3d(0, var(--bob), 0) rotate(6deg); }
}
/* Mostly still, with one full spin near the end of each cycle. */
@keyframes aquarium-spin {
  0%, 94% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>
