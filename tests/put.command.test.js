// @ts-check
'use strict';

const assert = require('assert');
const putCommand = require('../commands/put');

function createItem(def = {}) {
  return {
    uuid: def.uuid || `${String(def.name || 'item').replace(/\s+/gu, '-')}-id`,
    name: def.name || 'item',
    keywords: def.keywords || [],
    type: def.type || 'OBJECT',
    maxItems: def.maxItems,
    inventory: def.inventory || null,
    closed: !!def.closed,
    locked: !!def.locked,
  };
}

function createContainer(def = {}) {
  const inventory = def.inventory || new Map();
  return {
    ...createItem({
      ...def,
      type: def.type || 'CONTAINER',
      inventory,
    }),
    addItem(item) {
      if (!this.inventory) {
        this.inventory = new Map();
      }
      this.inventory.set(item.uuid, item);
    },
    removeItem(item) {
      if (!this.inventory) {
        return;
      }
      this.inventory.delete(item.uuid);
    },
  };
}

function createPlayer(def = {}) {
  const inventory = new Map((def.inventoryItems || []).map(item => [item.uuid, item]));
  return {
    inventory,
    room: { items: new Set(def.roomItems || []) },
    addItem(item) {
      inventory.set(item.uuid, item);
    },
    removeItem(item) {
      inventory.delete(item.uuid);
    },
  };
}

function executePut(player, directTarget, indirectTarget) {
  const execute = putCommand.command({});
  return execute('', player, null, {
    entityResolution: {
      ruleKey: 'directIndirect',
      directTarget,
      indirectTarget,
      relationTokenRaw: 'in',
      relationTokenCanonical: 'in',
    },
  });
}

describe('bundle-rantamuta put command', function () {
  it('returns transferItem plan and does not mutate directly', function () {
    const sword = createItem({
      uuid: 'sword-1',
      name: 'rusty sword',
      keywords: ['rusty', 'sword'],
      type: 'WEAPON',
    });
    const chest = createContainer({
      uuid: 'chest-1',
      name: 'old chest',
      keywords: ['old', 'chest'],
      maxItems: 2,
    });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = executePut(player, sword, chest);

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(player.inventory.has(sword.uuid), true);
    assert.strictEqual(chest.inventory.size, 0);
    assert.deepStrictEqual(result.plan, {
      operations: [
        {
          type: 'transferItem',
          item: sword,
          from: player,
          to: chest,
        },
      ],
    });
    assert.deepStrictEqual(result.render, {
      lines: ['You put the rusty sword in the old chest.'],
    });
  });

  it('returns FORM_NOT_SUPPORTED when resolution context is missing', function () {
    const execute = putCommand.command({});
    const player = createPlayer();

    const result = execute('', player, null, {});

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('returns PUT_TARGET_NOT_CONTAINER for non-container indirect target', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const anvil = createItem({ name: 'heavy anvil', keywords: ['heavy', 'anvil'], type: 'OBJECT' });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [anvil] });

    const result = executePut(player, sword, anvil);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUT_TARGET_NOT_CONTAINER', details: undefined },
    });
  });

  it('returns PUT_TARGET_LOCKED when container is locked', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'], locked: true });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = executePut(player, sword, chest);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUT_TARGET_LOCKED', details: undefined },
    });
  });

  it('returns PUT_TARGET_CLOSED when container is closed', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'], closed: true });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = executePut(player, sword, chest);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUT_TARGET_CLOSED', details: undefined },
    });
  });

  it('returns PUT_TARGET_FULL when container has no remaining capacity', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chestInventory = new Map([
      ['existing', createItem({ uuid: 'existing', name: 'existing item' })],
    ]);
    const chest = createContainer({
      name: 'old chest',
      keywords: ['old', 'chest'],
      maxItems: 1,
      inventory: chestInventory,
    });
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = executePut(player, sword, chest);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUT_TARGET_FULL', details: undefined },
    });
  });

  it('returns PUT_INVALID_SOURCE when player is not a reversible container', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'] });
    const player = {
      inventory: new Map([[sword.uuid, sword]]),
      room: { items: new Set([chest]) },
      removeItem: undefined,
      addItem: undefined,
    };

    const result = executePut(player, sword, chest);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUT_INVALID_SOURCE', details: undefined },
    });
  });

  it('returns PUT_INVALID_TARGET when target does not support add/remove', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = {
      ...createItem({ name: 'old chest', keywords: ['old', 'chest'], type: 'CONTAINER', inventory: new Map() }),
      addItem: undefined,
      removeItem: undefined,
    };
    const player = createPlayer({ inventoryItems: [sword], roomItems: [chest] });

    const result = executePut(player, sword, chest);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'PUT_INVALID_TARGET', details: undefined },
    });
  });
});
