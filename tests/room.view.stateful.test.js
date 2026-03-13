// @ts-check
'use strict';

const assert = require('assert');
const {
  buildRoomViewLines,
  normalizeRenderContext,
  evaluateRenderPredicate,
} = require('../lib/helpers/room-view-helper');

function createPredicateRuntimeStub(predicateMap = {}) {
  return {
    evaluate: (name, context) => {
      const predicate = predicateMap[name];

      if (typeof predicate === 'function') {
        return predicate(context);
      }

      return predicate === true;
    },
  };
}

function makeRoom(def = {}) {
  return {
    title: def.title || 'Stateful Room',
    description: def.description || 'Base description.',
    metadata: def.metadata || {},
    renderPredicates: def.renderPredicates || {},
    exits: def.exits || [],
    items: def.items || new Set(),
    npcs: def.npcs || new Set(),
    area: def.area || null,
    describeForLook: def.describeForLook,
  };
}

describe('room view stateful rendering', function () {
  it('uses first matching description variant in declaration order', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionVariants: [
          { when: 'is_slab_open', text: 'Variant A.' },
          { when: 'is_fallback_open', text: 'Variant B.' },
        ],
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_slab_open: () => true,
          is_fallback_open: () => true,
        }),
      },
    });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Variant A.',
    ]);
  });

  it('falls back to base description when no variant predicate matches', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionVariants: [
          { when: 'is_slab_open', text: 'Variant A.' },
        ],
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_slab_open: () => false,
        }),
      },
    });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
    ]);
  });

  it('supports whenNot for variants', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionVariants: [
          { whenNot: 'is_slab_open', text: 'Variant when blocked.' },
        ],
      },
    });

    const blockedLines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_slab_open: () => false,
        }),
      },
    });

    const openLines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_slab_open: () => true,
        }),
      },
    });

    assert.deepStrictEqual(blockedLines, [
      '<bold>Stateful Room</bold>',
      'Variant when blocked.',
    ]);
    assert.deepStrictEqual(openLines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
    ]);
  });

  it('appends all matching description fragments in declaration order', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionFragments: [
          { when: 'is_first_true', text: 'Fragment one.' },
          { when: 'is_second_false', text: 'Fragment two should not render.' },
          { when: 'is_third_true', text: 'Fragment three.' },
        ],
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_first_true: () => true,
          is_second_false: () => false,
          is_third_true: () => true,
        }),
      },
    });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
      'Fragment one.',
      'Fragment three.',
    ]);
  });

  it('supports whenNot for fragments', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionFragments: [
          { whenNot: 'is_slab_open', text: 'Blocked fragment.' },
          { when: 'is_slab_open', text: 'Open fragment.' },
        ],
      },
    });

    const blockedLines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_slab_open: () => false,
        }),
      },
    });

    const openLines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_slab_open: () => true,
        }),
      },
    });

    assert.deepStrictEqual(blockedLines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
      'Blocked fragment.',
    ]);
    assert.deepStrictEqual(openLines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
      'Open fragment.',
    ]);
  });

  it('passes normalized render context to predicate runtime', function () {
    const actor = { name: 'Tester' };
    const area = { name: 'test-area', bundle: 'bundle-test' };
    const seen = [];

    const room = makeRoom({
      area,
      metadata: {
        descriptionVariants: [
          { when: 'is_slab_open', text: 'Variant A.' },
        ],
      },
    });

    const world = {
      tick: 123,
      PredicateRuntime: createPredicateRuntimeStub({
        is_slab_open: (ctx) => {
          seen.push(ctx);
          return true;
        },
      }),
    };

    const lines = buildRoomViewLines(room, { actor, world });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Variant A.',
    ]);

    assert.strictEqual(seen.length, 1);
    const seenContext = seen[0];
    assert.strictEqual(seenContext.actor, actor);
    assert.strictEqual(seenContext.room, room);
    assert.strictEqual(seenContext.area, area);
    assert.strictEqual(seenContext.world, world);
    assert.strictEqual(seenContext.source, 'room.view.variants');
    assert.strictEqual(seenContext.entity, room);
  });

  it('does not mutate room metadata while evaluating variants/fragments', function () {
    const metadata = {
      descriptionVariants: [
        { when: 'is_slab_open', text: 'Variant A.' },
      ],
      descriptionFragments: [
        { when: 'is_fragment_open', text: 'Fragment A.' },
      ],
    };
    const room = makeRoom({
      description: 'Base description.',
      metadata,
    });

    const world = {
      PredicateRuntime: createPredicateRuntimeStub({
        is_slab_open: () => false,
        is_fragment_open: () => true,
      }),
    };

    const before = JSON.stringify(metadata);
    const first = buildRoomViewLines(room, { world });
    const second = buildRoomViewLines(room, { world });
    const after = JSON.stringify(metadata);

    assert.strictEqual(before, after);
    assert.deepStrictEqual(first, second);
  });

  it('does not fallback to room.renderPredicates', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionVariants: [
          { when: 'is_slab_open', text: 'Variant A.' },
        ],
      },
      renderPredicates: {
        is_slab_open: () => true,
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({}),
      },
    });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
    ]);
  });

  it('evaluateRenderPredicate returns false for missing keys and thrown runtime predicates', function () {
    const room = makeRoom();
    const world = {
      PredicateRuntime: {
        evaluate: (name) => {
          if (name === 'boom') {
            throw new Error('boom');
          }

          return false;
        },
      },
    };
    const context = normalizeRenderContext(room, { world });

    assert.strictEqual(evaluateRenderPredicate(room, 'missing', context), false);
    assert.strictEqual(evaluateRenderPredicate(room, 'boom', context), false);
  });

  it('resolves inline tags in room base/variant/fragment/item/npc render text', function () {
    const room = makeRoom({
      description: 'Base says [is_dark:dark|bright].',
      metadata: {
        descriptionVariants: [
          { when: 'is_variant', text: 'Variant says [is_dark:dark|bright].' },
        ],
        descriptionFragments: [
          { when: 'is_fragment', text: 'Fragment says [is_dark:dark|bright].' },
        ],
      },
      items: new Set([
        { entityReference: 'test:item', roomDesc: 'Item says [is_dark:dark|bright].' },
      ]),
      npcs: new Set([
        { entityReference: 'test:npc', roomDesc: 'NPC says [is_dark:dark|bright].' },
      ]),
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          is_variant: () => true,
          is_fragment: () => true,
          is_dark: () => false,
        }),
      },
    });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Variant says bright.',
      'Fragment says bright.',
      'Item says bright.',
      'NPC says bright.',
    ]);
  });
});
