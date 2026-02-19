// @ts-check
'use strict';

/**
 * Deterministic predicates for benchmark/test-only render and runtime checks.
 * These stay in the stable `test` area so performance baselines do not drift
 * with narrative bundle changes.
 */

const PREDICATE_ROOM_REF = 'test:predicates';
const PREDICATE_AREA_REF = 'test';
const CHEST_REF = 'test:labChest';
const APPLE_REF = 'test:labApple';

module.exports = {
  is_north_door_open: ({ q, context }) => {
    const roomRef = String(context && context.roomRef ? context.roomRef : '').toLowerCase();
    if (roomRef.endsWith(':door')) {
      return q.outboundDoorOpen('north');
    }

    if (roomRef.endsWith(':northdoor')) {
      return q.inboundDoorOpen('south');
    }

    return false;
  },

  bench_always_true: () => true,
  bench_always_false: () => false,

  bench_room_flag_primary: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'variantPrimary'),
  bench_room_flag_secondary: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'variantSecondary'),
  bench_area_flag_enabled: ({ q }) => q.areaFlag(PREDICATE_AREA_REF, 'benchmarkEnabled'),
  bench_room_has_apple: ({ q }) => q.roomHasItem(PREDICATE_ROOM_REF, APPLE_REF),
  bench_room_container_has_apple: ({ q }) => q.roomContainerHasItem(PREDICATE_ROOM_REF, CHEST_REF, APPLE_REF),
  bench_actor_has_apple: ({ q }) => q.actorHasItem(APPLE_REF),
  bench_actor_has_focus: ({ q }) => q.actorHasEffect('focus'),
  bench_actor_quest_active: ({ q }) => q.actorQuestActive('test:predicateQuestActive'),
  bench_actor_quest_completed: ({ q }) => q.actorQuestCompleted('test:predicateQuestDone'),

  bench_composite_small: ({ q }) =>
    q.roomFlag(PREDICATE_ROOM_REF, 'variantPrimary')
      && q.areaFlag(PREDICATE_AREA_REF, 'benchmarkEnabled')
      && q.roomHasItem(PREDICATE_ROOM_REF, APPLE_REF),

  bench_composite_large: ({ q }) =>
    q.roomFlag(PREDICATE_ROOM_REF, 'variantPrimary')
      && q.areaFlag(PREDICATE_AREA_REF, 'benchmarkEnabled')
      && q.roomHasItem(PREDICATE_ROOM_REF, APPLE_REF)
      && q.roomContainerHasItem(PREDICATE_ROOM_REF, CHEST_REF, APPLE_REF)
      && q.actorHasItem(APPLE_REF)
      && q.actorHasEffect('focus')
      && q.actorQuestActive('test:predicateQuestActive')
      && q.actorQuestCompleted('test:predicateQuestDone'),

  bench_invalid_return: () => 1,
  bench_throws: () => {
    throw new Error('bench predicate throw');
  },

  bench_variant_primary: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'variantPrimary'),
  bench_variant_secondary: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'variantSecondary'),
  bench_variant_never: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'variantNever'),

  bench_fragment_a: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'fragmentA'),
  bench_fragment_b: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'fragmentB'),
  bench_fragment_c: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'fragmentC'),
  bench_fragment_d: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'fragmentD'),
  bench_fragment_e: ({ q }) => q.roomFlag(PREDICATE_ROOM_REF, 'fragmentE'),
};
