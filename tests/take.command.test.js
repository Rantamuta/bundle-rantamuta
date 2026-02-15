// @ts-check
'use strict';

const assert = require('assert');
const takeCommand = require('../commands/take');

function createItem(def = {}) {
  return {
    uuid: def.uuid || `${String(def.name || 'item').replace(/\s+/gu, '-')}-id`,
    name: def.name || 'item',
    keywords: def.keywords || [],
    type: def.type || 'OBJECT',
    metadata: def.metadata || {},
    carriedBy: def.carriedBy || null,
    room: def.room || null,
    closed: !!def.closed,
  };
}

function createRoom(def = {}) {
  const items = new Set(def.items || []);
  const room = {
    items,
    addItem(item) {
      items.add(item);
      item.room = room;
      item.carriedBy = null;
    },
    removeItem(item) {
      items.delete(item);
      item.room = null;
    },
  };
  return room;
}

function createPlayer(def = {}) {
  const inventory = new Map((def.inventoryItems || []).map(item => [item.uuid, item]));
  return {
    inventory,
    room: def.room || createRoom(),
    addItem(item) {
      inventory.set(item.uuid, item);
      item.carriedBy = this;
      item.room = null;
    },
    removeItem(item) {
      inventory.delete(item.uuid);
      if (item.carriedBy === this) {
        item.carriedBy = null;
      }
    },
    isInventoryFull: def.isInventoryFull || (() => false),
  };
}

function executeTake(player, directTarget) {
  const execute = takeCommand.command({});
  return execute('', player, null, {
    entityResolution: {
      ruleKey: 'direct',
      directTarget,
    },
  });
}

describe('bundle-rantamuta take command', function () {
  it('declares direct scope order including room.details and nested player.inventory', function () {
    assert.deepStrictEqual(takeCommand.metadata.entityResolution.rules.direct.scopeProfile.direct, [
      { source: 'room.items', nested: true },
      'room.details',
      { source: 'player.inventory', nested: true },
    ]);
  });

  it('returns transferItem plan and does not mutate directly', function () {
    const room = createRoom();
    const coin = createItem({ uuid: 'coin-1', name: 'gold coin', keywords: ['gold', 'coin'], room });
    room.items.add(coin);
    const player = createPlayer({ room });

    const result = executeTake(player, coin);

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(room.items.has(coin), true);
    assert.strictEqual(player.inventory.has(coin.uuid), false);
    assert.deepStrictEqual(result.plan, {
      operations: [
        {
          type: 'transferItem',
          item: coin,
          from: room,
          to: player,
        },
      ],
    });
    assert.deepStrictEqual(result.render, {
      lines: ['You take the gold coin.'],
    });
  });

  it('returns FORM_NOT_SUPPORTED when resolution context is missing', function () {
    const execute = takeCommand.command({});
    const player = createPlayer();

    const result = execute('', player, null, {});

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('returns ALREADY_HAVE_DIRECT when item is already in player inventory', function () {
    const coin = createItem({ uuid: 'coin-held', name: 'gold coin', keywords: ['gold', 'coin'] });
    const player = createPlayer({ inventoryItems: [coin] });
    coin.carriedBy = player;

    const result = executeTake(player, coin);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'ALREADY_HAVE_DIRECT', details: undefined },
    });
  });

  it('returns TAKE_NOT_REACHABLE when item is inside a closed container chain', function () {
    const room = createRoom();
    const chest = createItem({ uuid: 'chest-1', name: 'old chest', closed: true, room });
    const gem = createItem({ uuid: 'gem-1', name: 'red gem', carriedBy: chest });
    const player = createPlayer({ room });

    const result = executeTake(player, gem);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'TAKE_NOT_REACHABLE', details: undefined },
    });
  });

  it('returns TAKE_NOT_TAKEABLE for container items by default', function () {
    const room = createRoom();
    const chest = createItem({
      uuid: 'chest-locked',
      name: 'old chest',
      keywords: ['old', 'chest'],
      type: 'CONTAINER',
      room,
    });
    room.items.add(chest);
    const player = createPlayer({ room });

    const result = executeTake(player, chest);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'TAKE_NOT_TAKEABLE', details: undefined },
    });
  });

  it('returns TAKE_INVALID_SOURCE when source cannot transfer items', function () {
    const room = createRoom();
    const brokenHolder = { closed: false, room, carriedBy: null };
    const gem = createItem({ uuid: 'gem-2', name: 'blue gem', carriedBy: brokenHolder });
    const player = createPlayer({ room });

    const result = executeTake(player, gem);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'TAKE_INVALID_SOURCE', details: undefined },
    });
  });

  it('returns TAKE_INVALID_TARGET when player cannot transfer items', function () {
    const room = createRoom();
    const coin = createItem({ uuid: 'coin-2', name: 'silver coin', room });
    room.items.add(coin);
    const player = {
      room,
      addItem: undefined,
      removeItem: undefined,
    };

    const result = executeTake(player, coin);

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'TAKE_INVALID_TARGET', details: undefined },
    });
  });
});
