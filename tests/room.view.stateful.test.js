// @ts-check
'use strict';

const assert = require('assert');
const {
  buildRoomViewLines,
  normalizeRenderContext,
  evaluateRenderPredicate,
} = require('../lib/helpers/room-view-helper');

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
      renderPredicates: {
        slab_open: () => true,
        fallback_open: () => true,
      },
    });

    const lines = buildRoomViewLines(room);

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
      renderPredicates: {
        slab_open: () => false,
      },
    });

    const lines = buildRoomViewLines(room);

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
      renderPredicates: {
        first_true: () => true,
        second_false: () => false,
        third_true: () => true,
      },
    });

    const lines = buildRoomViewLines(room);

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Base description.',
      'Fragment one.',
      'Fragment three.',
    ]);
  });

  it('passes normalized render context to predicates', function () {
    const actor = { name: 'Tester' };
    const world = { tick: 123 };
    const area = { name: 'test-area' };
    let seenContext = null;

    const room = makeRoom({
      area,
      metadata: {
        descriptionVariants: [
          { when: 'slab_open', text: 'Variant A.' },
        ],
      },
      renderPredicates: {
        slab_open: (ctx) => {
          seenContext = ctx;
          return true;
        },
      },
    });

    const lines = buildRoomViewLines(room, { actor, world });

    assert.deepStrictEqual(lines, [
      '<bold>Stateful Room</bold>',
      'Variant A.',
    ]);
    assert.ok(seenContext);
    assert.strictEqual(seenContext.actor, actor);
    assert.strictEqual(seenContext.room, room);
    assert.strictEqual(seenContext.area, area);
    assert.strictEqual(seenContext.world, world);
    assert.ok(Object.isFrozen(seenContext));
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
      renderPredicates: {
        slab_open: () => false,
        frag_open: () => true,
      },
    });

    const before = JSON.stringify(metadata);
    const first = buildRoomViewLines(room);
    const second = buildRoomViewLines(room);
    const after = JSON.stringify(metadata);

    assert.strictEqual(before, after);
    assert.deepStrictEqual(first, second);
  });

  it('evaluateRenderPredicate returns false for missing keys and thrown predicates', function () {
    const room = makeRoom({
      renderPredicates: {
        boom: () => {
          throw new Error('boom');
        },
      },
    });
    const context = normalizeRenderContext(room, {});

    assert.strictEqual(evaluateRenderPredicate(room, 'missing', context), false);
    assert.strictEqual(evaluateRenderPredicate(room, 'boom', context), false);
  });
});
