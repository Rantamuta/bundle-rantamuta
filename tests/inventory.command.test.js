// @ts-check
'use strict';

const assert = require('assert');
const inventoryCommand = require('../commands/inventory');
const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/session/entity-resolution');

function createPlayer(def = {}) {
  return {
    inventory: def.inventory || new Map(),
  };
}

describe('bundle-rantamuta inventory command', function () {
  it('declares intransitive entity-resolution rule metadata', function () {
    assert.ok(inventoryCommand.metadata);
    assert.ok(inventoryCommand.metadata.entityResolution);
    assert.deepStrictEqual(inventoryCommand.metadata.entityResolution.rules, {
      intransitive: {},
    });
  });

  it('returns FORM_NOT_SUPPORTED when resolution rule is not intransitive', function () {
    const execute = inventoryCommand.command({});
    const player = createPlayer();

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'direct' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('entity-resolution rejects direct-object inventory form for intransitive-only declaration', function () {
    const player = createPlayer();
    const result = EntityResolution.resolveEntityContext({}, inventoryCommand, player, parseInput('inventory sword'));

    assert.strictEqual(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.strictEqual(result.error.code, 'FORM_DIRECT_NOT_SUPPORTED');
  });

  it('returns INVENTORY_NO_PLAYER when player is missing', function () {
    const execute = inventoryCommand.command({});
    const result = execute('', null, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'INVENTORY_NO_PLAYER', details: undefined },
    });
  });

  it('renders "You have nothing." when inventory is empty', function () {
    const execute = inventoryCommand.command({});
    const player = createPlayer({ inventory: new Map() });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        lines: ['You have nothing.'],
      },
    });
  });

  it('renders deterministic inventory listing using item names in map insertion order', function () {
    const execute = inventoryCommand.command({});
    const apple = { uuid: 'apple-1', name: 'apple', keywords: ['apple'] };
    const coin = { uuid: 'coin-1', name: 'gold coin', keywords: ['gold', 'coin'] };
    const player = createPlayer({
      inventory: new Map([
        [apple.uuid, apple],
        [coin.uuid, coin],
      ]),
    });

    const result = execute('', player, null, {
      entityResolution: { ruleKey: 'intransitive' },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        lines: ['You are carrying:', '- apple', '- gold coin'],
      },
    });
  });
});
