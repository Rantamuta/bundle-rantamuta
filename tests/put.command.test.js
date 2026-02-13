// @ts-check
'use strict';

const assert = require('assert');
const putCommand = require('../commands/put');
const { parseInput } = require('../lib/parse-input');

function createItem(def = {}) {
  const uuid = def.uuid || `${String(def.name || 'item').replace(/\s+/gu, '-').toLowerCase()}-uuid`;
  return {
    uuid,
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
  const container = createItem({
    ...def,
    type: def.type || 'CONTAINER',
    inventory: def.inventory || new Map(),
  });

  container.addItem = (item) => {
    if (!container.inventory) {
      container.inventory = new Map();
    }
    container.inventory.set(item.uuid, item);
  };

  container.removeItem = (item) => {
    if (container.inventory) {
      container.inventory.delete(item.uuid);
    }
  };

  return container;
}

function createPlayer(inventoryItems, roomItems) {
  const inventory = new Map(inventoryItems.map(item => [item.uuid, item]));
  return {
    inventory,
    room: {
      items: new Set(roomItems),
    },
    addItem(item) {
      inventory.set(item.uuid, item);
    },
    removeItem(item) {
      inventory.delete(item.uuid);
    },
  };
}

describe('bundle-rantamuta put command', function () {
  it('returns transferItem plan for "put <item> in <container>"', function () {
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
    const player = createPlayer([sword], [chest]);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword in old chest',
      player,
      null,
      { parsedInput: parseInput('put rusty sword in old chest') }
    );

    assert.deepStrictEqual(result.ok, true);
    assert.strictEqual(player.inventory.has(sword.uuid), true, 'command must not mutate player inventory');
    assert.strictEqual(chest.inventory.size, 0, 'command must not mutate container inventory');

    const operation = result.plan.operations[0];
    assert.strictEqual(operation.type, 'transferItem');
    assert.strictEqual(operation.item, sword);
    assert.strictEqual(operation.from, player);
    assert.strictEqual(operation.to, chest);
  });

  it('fails when the direct object is missing', function () {
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'] });
    const player = createPlayer([], [chest]);
    const execute = putCommand.command({});

    const result = execute(
      'in old chest',
      player,
      null,
      { parsedInput: parseInput('put in old chest') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_MISSING_ITEM',
        message: 'Put what?',
      },
    });
  });

  it('fails when destination is missing', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const player = createPlayer([sword], []);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword',
      player,
      null,
      { parsedInput: parseInput('put rusty sword') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_MISSING_DESTINATION',
        message: 'Put it where?',
      },
    });
  });

  it('fails when relation token is unsupported', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'] });
    const player = createPlayer([sword], [chest]);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword on old chest',
      player,
      null,
      { parsedInput: parseInput('put rusty sword on old chest') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_UNSUPPORTED_RELATION',
        message: 'You can only put things in containers.',
      },
    });
  });

  it('fails when item is not in inventory', function () {
    const chest = createContainer({ name: 'old chest', keywords: ['old', 'chest'] });
    const player = createPlayer([], [chest]);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword in old chest',
      player,
      null,
      { parsedInput: parseInput('put rusty sword in old chest') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_ITEM_NOT_FOUND',
        message: 'You do not have that.',
      },
    });
  });

  it('fails when target container is not in room', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const player = createPlayer([sword], []);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword in old chest',
      player,
      null,
      { parsedInput: parseInput('put rusty sword in old chest') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_TARGET_NOT_FOUND',
        message: 'You do not see that here.',
      },
    });
  });

  it('fails when target is not a container', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const anvil = createItem({
      name: 'heavy anvil',
      keywords: ['heavy', 'anvil'],
      type: 'OBJECT',
    });
    const player = createPlayer([sword], [anvil]);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword in heavy anvil',
      player,
      null,
      { parsedInput: parseInput('put rusty sword in heavy anvil') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_TARGET_NOT_CONTAINER',
        message: "You can't put things in that.",
      },
    });
  });

  it('fails when target container is full', function () {
    const sword = createItem({ name: 'rusty sword', keywords: ['rusty', 'sword'] });
    const chestInventory = new Map();
    chestInventory.set('existing-item', createItem({ uuid: 'existing-item', name: 'existing item' }));
    const chest = createContainer({
      name: 'old chest',
      keywords: ['old', 'chest'],
      maxItems: 1,
      inventory: chestInventory,
    });
    const player = createPlayer([sword], [chest]);
    const execute = putCommand.command({});

    const result = execute(
      'rusty sword in old chest',
      player,
      null,
      { parsedInput: parseInput('put rusty sword in old chest') }
    );

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'PUT_TARGET_FULL',
        message: 'It is full.',
      },
    });
  });
});
