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
    if (roomRef.endsWith(':doorroom')) {
      return !q.isDoorClosed('north') && !q.isDoorLocked('north');
    }

    if (roomRef.endsWith(':northdoorroom')) {
      return !q.isDoorClosedBetween('test:doorRoom', 'test:northDoorRoom')
        && !q.isDoorLockedBetween('test:doorRoom', 'test:northDoorRoom');
    }

    return false;
  },

  is_virtual_north_door_open: ({ q, context }) => {
    const roomRef = String(context && context.roomRef ? context.roomRef : '').toLowerCase();
    if (!roomRef.endsWith(':virtualdoorsouthroom')) {
      return false;
    }

    return !q.isDoorClosed('north') && !q.isDoorLocked('north');
  },

  is_virtual_south_door_open: ({ q, context }) => {
    const roomRef = String(context && context.roomRef ? context.roomRef : '').toLowerCase();
    if (!roomRef.endsWith(':virtualdoornorthroom')) {
      return false;
    }

    return !q.isDoorClosedBetween('test:virtualDoorSouthRoom', 'test:virtualDoorNorthRoom')
      && !q.isDoorLockedBetween('test:virtualDoorSouthRoom', 'test:virtualDoorNorthRoom');
  },

  bench_always_true: () => true,
  bench_always_false: () => false,

  bench_room_flag_primary: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantPrimary') === true,
  bench_room_flag_secondary: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantSecondary') === true,
  bench_area_flag_enabled: ({ q }) => q.getAreaMetadata(PREDICATE_AREA_REF, 'benchmarkEnabled') === true,
  bench_room_has_apple: ({ q }) => q.roomHasItem(PREDICATE_ROOM_REF, APPLE_REF),
  bench_room_container_has_apple: ({ q }) => q.roomContainerHasItem(PREDICATE_ROOM_REF, CHEST_REF, APPLE_REF),
  bench_actor_has_apple: ({ q }) => q.actorHasItem(APPLE_REF),
  bench_actor_has_focus: ({ q }) => q.actorHasEffect('focus'),
  bench_actor_quest_active: ({ q }) => q.actorQuestActive('test:predicateQuestActive'),
  bench_actor_quest_completed: ({ q }) => q.actorQuestCompleted('test:predicateQuestDone'),

  bench_composite_small: ({ q }) =>
    q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantPrimary') === true
      && q.getAreaMetadata(PREDICATE_AREA_REF, 'benchmarkEnabled') === true
      && q.roomHasItem(PREDICATE_ROOM_REF, APPLE_REF),

  bench_composite_large: ({ q }) =>
    q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantPrimary') === true
      && q.getAreaMetadata(PREDICATE_AREA_REF, 'benchmarkEnabled') === true
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

  bench_variant_primary: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantPrimary') === true,
  bench_variant_secondary: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantSecondary') === true,
  bench_variant_never: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'variantNever') === true,

  bench_fragment_a: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'fragmentA') === true,
  bench_fragment_b: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'fragmentB') === true,
  bench_fragment_c: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'fragmentC') === true,
  bench_fragment_d: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'fragmentD') === true,
  bench_fragment_e: ({ q }) => q.getRoomMetadata(PREDICATE_ROOM_REF, 'fragmentE') === true,

  is_button_pushed: ({ q }) => q.getRoomMetadata('test:inlineTags', 'buttonPushed') === true,
};
