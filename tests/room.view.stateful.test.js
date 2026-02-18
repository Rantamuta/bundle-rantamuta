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
          { when: 'slab_open', text: 'Variant A.' },
          { when: 'fallback_open', text: 'Variant B.' },
        ],
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          slab_open: () => true,
          fallback_open: () => true,
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
          { when: 'slab_open', text: 'Variant A.' },
        ],
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          slab_open: () => false,
        }),
      },
    });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
    ]);
  });

  it('appends all matching description fragments in declaration order', function () {
    const room = makeRoom({
      description: 'Base description.',
      metadata: {
        descriptionFragments: [
          { when: 'first_true', text: 'Fragment one.' },
          { when: 'second_false', text: 'Fragment two should not render.' },
          { when: 'third_true', text: 'Fragment three.' },
        ],
      },
    });

    const lines = buildRoomViewLines(room, {
      world: {
        PredicateRuntime: createPredicateRuntimeStub({
          first_true: () => true,
          second_false: () => false,
          third_true: () => true,
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

  it('passes normalized render context to predicate runtime', function () {
    const actor = { name: 'Tester' };
    const area = { name: 'test-area', bundle: 'bundle-test' };
    const seen = [];

    const room = makeRoom({
      area,
      metadata: {
        descriptionVariants: [
          { when: 'slab_open', text: 'Variant A.' },
        ],
      },
    });

    const world = {
      tick: 123,
      PredicateRuntime: createPredicateRuntimeStub({
        slab_open: (ctx) => {
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
        { when: 'slab_open', text: 'Variant A.' },
      ],
      descriptionFragments: [
        { when: 'frag_open', text: 'Fragment A.' },
      ],
    };
    const room = makeRoom({
      description: 'Base description.',
      metadata,
    });

    const world = {
      PredicateRuntime: createPredicateRuntimeStub({
        slab_open: () => false,
        frag_open: () => true,
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
          { when: 'slab_open', text: 'Variant A.' },
        ],
      },
      renderPredicates: {
        slab_open: () => true,
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
});
