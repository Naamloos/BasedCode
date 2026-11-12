/**
 * The guided chat modes: everything except 'default' and 'review' (second opinion).
 * Each mode is declared in its own file under ./modes; this list sets their order in menus.
 */
import archaeology from './modes/archaeology.js';
import designer from './modes/designer.js';
import docs from './modes/docs.js';
import devil from './modes/devil.js';
import duck from './modes/duck.js';
import grill from './modes/grill.js';
import hackerman from './modes/hackerman.js';
import incident from './modes/incident.js';
import migration from './modes/migration.js';
import pair from './modes/pair.js';
import performance from './modes/performance.js';
import planner from './modes/planner.js';
import refactor from './modes/refactor.js';
import reviewer from './modes/reviewer.js';
import teacher from './modes/teacher.js';
import tests from './modes/tests.js';

export type { ChatModeDefinition, ModeExample } from './modes/defineMode.js';

export const guidedModes = [
  duck,
  pair,
  planner,
  archaeology,
  devil,
  grill,
  refactor,
  tests,
  teacher,
  performance,
  migration,
  reviewer,
  incident,
  hackerman,
  docs,
  designer,
] as const;

export type GuidedMode = (typeof guidedModes)[number]['id'];
export const guidedModeIds = guidedModes.map((mode) => mode.id) as [GuidedMode, ...GuidedMode[]];

export function guidedMode(id: string | undefined) {
  return guidedModes.find((mode) => mode.id === id);
}
