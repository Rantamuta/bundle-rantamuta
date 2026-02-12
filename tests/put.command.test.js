'use strict';

const assert = require('assert');
const { parseInput, SEMANTIC_ERROR_CODE } = require('../lib/parse-input');
const put = require('../commands/put');

let nextUuid = 1;

function createItem(name, keywords = name.split(/\s+/u)) {
  return {
    uuid: `item-${nextUuid++}`,
    name,
    keywords,
    carriedBy: null,
    room: null,
  };
}

function createContainer(name, options = {}) {
  const maxItems = Number.isInteger(options.maxItems) ? options.maxItems : 10;
  const inventory = new Map();

  return {
    ...createItem(name),
    type: 'container',
    inventory,
    maxItems,
    isInventoryFull() {
      return this.inventory.size >= this.maxItems;
    },
    addItem(item) {
      if (this.isInventoryFull()) {
        throw new Error('Container is full');
      }

      this.inventory.set(item.uuid, item);
      item.carriedBy = this;
      item.room = null;
    },
    removeItem(item) {
      this.inventory.delete(item.uuid);
      if (item.carriedBy === this) {
        item.carriedBy = null;
      }
    },
  };
}

function createRoom() {
  const items = new Map();

  return {
    items,
    addItem(item) {
      items.set(item.uuid, item);
      item.room = this;
      item.carriedBy = null;
    },
    removeItem(item) {
      items.delete(item.uuid);
      if (item.room === this) {
        item.room = null;
      }
    },
    hasItem(item) {
      return items.has(item.uuid);
    },
  };
}

function createPlayer() {
  const output = [];
  const inventory = new Map();
  const room = createRoom();
  const player = {
    name: 'ScenarioPlayer',
    socket: {
      writable: true,
      _prompted: false,
      write: line => {
        output.push(String(line));
        return true;
      },
    },
    room,
    inventory: { items: inventory },
    getBroadcastTargets() {
      return [this];
    },
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
    hasItem(item) {
      return inventory.has(item.uuid);
    },
  };

  return { player, output };
}

function createFixture(options = {}) {
  const sword = createItem('rusty sword');
  const chest = createContainer('old chest', { maxItems: options.containerMaxItems });
  const { player, output } = createPlayer();

  return {
    state: {},
    sword,
    chest,
    player,
    output,
    run: args => {
      const execute = put.command({});
      return execute(args, player, 'put');
    },
    roomHasItem: item => player.room.hasItem(item),
    containerHasItem: item => chest.inventory.has(item.uuid),
    outputText: () => output.join(''),
  };
}

describe('bundle-rantamuta put command guardrails', function () {
  it('parses relation-form put input into intent and target spans', function () {
    const parsedInput = parseInput('put rusty sword in old chest');

    assert.strictEqual(parsedInput.intentToken, 'put');
    assert.deepStrictEqual(parsedInput.primaryTargetSpan, ['rusty', 'sword']);
    assert.strictEqual(parsedInput.relationToken, 'in');
    assert.deepStrictEqual(parsedInput.secondaryTargetSpan, ['old', 'chest']);
    assert.strictEqual(parsedInput.classification, 'success');
    assert.strictEqual(parsedInput.errorEnvelope, null);
  });

  it('classifies missing secondary target span as semantic error', function () {
    const parsedInput = parseInput('put rusty sword in');

    assert.strictEqual(parsedInput.classification, 'semantic error');
    assert.deepStrictEqual(parsedInput.errorEnvelope, {
      class: 'semantic error',
      code: SEMANTIC_ERROR_CODE,
      details: {
        intentToken: 'put',
        relationToken: 'in',
        missingSpan: 'secondaryTargetSpan',
      },
    });
  });

  it('put <item> in <container> when container exists should move item into <container>', async function () {
    const fixture = createFixture();
    fixture.player.addItem(fixture.sword);
    fixture.player.room.addItem(fixture.chest);

    const result = await fixture.run('rusty sword in old chest');

    assert.ok(result, 'put command should return a result object');
    assert.strictEqual(result.classification, 'success');
    assert.strictEqual(result.errorEnvelope, null);
    assert.strictEqual(fixture.player.hasItem(fixture.sword), false);
    assert.strictEqual(fixture.containerHasItem(fixture.sword), true);
    assert.match(fixture.outputText(), /put/i);
  });

  it('put <item> in <container> when <item> does not exist should give primary target object error and not mutate state', async function () {
    const fixture = createFixture();
    fixture.player.room.addItem(fixture.chest);

    const result = await fixture.run('rusty sword in old chest');

    assert.ok(result, 'put command should return a result object');
    assert.strictEqual(result.classification, 'invalid context/target');
    assert.deepStrictEqual(result.errorEnvelope, {
      class: 'invalid context/target',
      code: 'PUT_INVALID_CONTEXT_PRIMARY_TARGET_NOT_FOUND',
      details: {
        intentToken: 'put',
        primaryTargetSpan: ['rusty', 'sword'],
      },
    });
    assert.strictEqual(fixture.player.hasItem(fixture.sword), false);
    assert.strictEqual(fixture.roomHasItem(fixture.sword), false);
    assert.strictEqual(fixture.containerHasItem(fixture.sword), false);
    assert.match(fixture.outputText(), /can(?:not|'t) find|not have/i);
  });

  it('put <item> in <container> when <container> does not exist should give secondary target error and not mutate state', async function () {
    const fixture = createFixture();
    fixture.player.addItem(fixture.sword);

    const result = await fixture.run('rusty sword in old chest');

    assert.ok(result, 'put command should return a result object');
    assert.strictEqual(result.classification, 'invalid context/target');
    assert.deepStrictEqual(result.errorEnvelope, {
      class: 'invalid context/target',
      code: 'PUT_INVALID_CONTEXT_SECONDARY_TARGET_NOT_FOUND',
      details: {
        intentToken: 'put',
        relationToken: 'in',
        secondaryTargetSpan: ['old', 'chest'],
      },
    });
    assert.strictEqual(fixture.player.hasItem(fixture.sword), true);
    assert.strictEqual(fixture.containerHasItem(fixture.sword), false);
    assert.match(fixture.outputText(), /can(?:not|'t) find|no .*chest/i);
  });

  it('put <item> in <container> when container is full should give forbidden target error and not mutate state', async function () {
    const fixture = createFixture({ containerMaxItems: 1 });
    const existingItem = createItem('existing trinket');

    fixture.player.addItem(fixture.sword);
    fixture.player.room.addItem(fixture.chest);
    fixture.chest.addItem(existingItem);

    const result = await fixture.run('rusty sword in old chest');

    assert.ok(result, 'put command should return a result object');
    assert.strictEqual(result.classification, 'forbidden/blocked');
    assert.deepStrictEqual(result.errorEnvelope, {
      class: 'forbidden/blocked',
      code: 'PUT_FORBIDDEN_BLOCKED_CAPACITY',
      details: {
        intentToken: 'put',
        relationToken: 'in',
      },
    });
    assert.strictEqual(fixture.player.hasItem(fixture.sword), true);
    assert.strictEqual(fixture.containerHasItem(fixture.sword), false);
    assert.match(fixture.outputText(), /full|can(?:not|'t) put/i);
  });
});
