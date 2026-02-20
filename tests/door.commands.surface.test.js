// @ts-check
'use strict';

const assert = require('assert');

const openCommand = require('../commands/open');
const closeCommand = require('../commands/close');
const lockCommand = require('../commands/lock');
const unlockCommand = require('../commands/unlock');

/**
 * @param {{
 *  direction?: string,
 *  door?: { closed?: boolean, locked?: boolean, lockedBy?: string },
 *  inventory?: Array<{ uuid?: string, entityReference?: string, name?: string }>,
 * }} [options]
 */
function buildFixture(options = {}) {
  const direction = options.direction || 'north';
  const destinationRef = 'test:northdoorroom';
  const sourceRef = 'test:doorroom';
  const door = {
    closed: false,
    locked: false,
    ...options.door,
  };

  const room = {
    entityReference: sourceRef,
    getExits() {
      return [{ direction, roomId: destinationRef }];
    },
  };
  const destination = {
    entityReference: destinationRef,
    getDoor(fromRoom) {
      return fromRoom && fromRoom.entityReference === sourceRef ? door : null;
    },
  };

  const inventory = Array.isArray(options.inventory) ? options.inventory : [];
  const player = {
    room,
    inventory: new Map(inventory.map((item, index) => [item.uuid || `item-${index}`, item])),
  };
  const state = {
    RoomManager: {
      getRoom(roomRef) {
        if (roomRef === destinationRef) {
          return destination;
        }
        if (roomRef === sourceRef) {
          return room;
        }
        return null;
      },
    },
  };
  const directTarget = { direction, roomId: destinationRef };

  return { state, player, door, direction, directTarget, destinationRef };
}

/**
 * @param {*} commandModule
 * @param {*} state
 * @param {*} player
 * @param {{ ruleKey: string, directTarget?: *, indirectTarget?: *, indirectSpan?: string[] }} resolution
 * @returns {*}
 */
function execute(commandModule, state, player, resolution) {
  return commandModule.command(state)('', player, null, {
    entityResolution: resolution,
  });
}

describe('bundle-rantamuta door command surfaces', function () {
  it('declares allowUnresolvedIndirect for open/lock/unlock directIndirect rules', function () {
    assert.strictEqual(openCommand.metadata.entityResolution.rules.directIndirect.allowUnresolvedIndirect, true);
    assert.strictEqual(lockCommand.metadata.entityResolution.rules.directIndirect.allowUnresolvedIndirect, true);
    assert.strictEqual(unlockCommand.metadata.entityResolution.rules.directIndirect.allowUnresolvedIndirect, true);
  });

  it('returns FORM_NOT_SUPPORTED when resolution rule is unsupported', function () {
    const fixture = buildFixture();
    assert.strictEqual(execute(openCommand, fixture.state, fixture.player, { ruleKey: 'intransitive' }).error.code, 'FORM_NOT_SUPPORTED');
    assert.strictEqual(execute(closeCommand, fixture.state, fixture.player, { ruleKey: 'directIndirect' }).error.code, 'FORM_NOT_SUPPORTED');
    assert.strictEqual(execute(lockCommand, fixture.state, fixture.player, { ruleKey: 'intransitive' }).error.code, 'FORM_NOT_SUPPORTED');
    assert.strictEqual(execute(unlockCommand, fixture.state, fixture.player, { ruleKey: 'intransitive' }).error.code, 'FORM_NOT_SUPPORTED');
  });

  it('returns TARGET_NOT_DOOR when direct target is not an exit', function () {
    const fixture = buildFixture();
    const resolution = { ruleKey: 'direct', directTarget: { entityReference: 'test:rock' } };

    assert.strictEqual(execute(openCommand, fixture.state, fixture.player, resolution).error.code, 'TARGET_NOT_DOOR');
    assert.strictEqual(execute(closeCommand, fixture.state, fixture.player, resolution).error.code, 'TARGET_NOT_DOOR');
    assert.strictEqual(execute(lockCommand, fixture.state, fixture.player, resolution).error.code, 'TARGET_NOT_DOOR');
    assert.strictEqual(execute(unlockCommand, fixture.state, fixture.player, resolution).error.code, 'TARGET_NOT_DOOR');
  });

  it('maps commands to canonical doorMutation operations', function () {
    const openFixture = buildFixture({ door: { closed: true, locked: false } });
    const closeFixture = buildFixture({ door: { closed: false, locked: false } });
    const lockFixture = buildFixture({ door: { closed: false, locked: false, lockedBy: 'test:bronze_key' }, inventory: [{ entityReference: 'test:bronze_key', name: 'bronze key' }] });
    const unlockFixture = buildFixture({ door: { closed: true, locked: true, lockedBy: 'test:bronze_key' }, inventory: [{ entityReference: 'test:bronze_key', name: 'bronze key' }] });

    assert.strictEqual(
      execute(openCommand, openFixture.state, openFixture.player, { ruleKey: 'direct', directTarget: openFixture.directTarget }).plan.operations[0].mutation,
      'open'
    );
    assert.strictEqual(
      execute(closeCommand, closeFixture.state, closeFixture.player, { ruleKey: 'direct', directTarget: closeFixture.directTarget }).plan.operations[0].mutation,
      'close'
    );
    assert.strictEqual(
      execute(lockCommand, lockFixture.state, lockFixture.player, { ruleKey: 'direct', directTarget: lockFixture.directTarget }).plan.operations[0].mutation,
      'closeAndLock'
    );
    assert.strictEqual(
      execute(unlockCommand, unlockFixture.state, unlockFixture.player, { ruleKey: 'direct', directTarget: unlockFixture.directTarget }).plan.operations[0].mutation,
      'unlock'
    );
  });

  it('matches keys by key definition reference (entityReference), not UUID', function () {
    const fixture = buildFixture({
      door: { closed: true, locked: true, lockedBy: 'test:bronze_key' },
      inventory: [{ uuid: 'instance-a', entityReference: 'test:bronze_key', name: 'small bronze key' }],
    });

    const result = execute(openCommand, fixture.state, fixture.player, {
      ruleKey: 'direct',
      directTarget: fixture.directTarget,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.plan.operations[0].mutation, 'open');
  });

  it('accepts multiple carried copies of the same matching key as valid', function () {
    const fixture = buildFixture({
      door: { closed: true, locked: true, lockedBy: 'test:bronze_key' },
      inventory: [
        { uuid: 'key-1', entityReference: 'test:bronze_key', name: 'bronze key' },
        { uuid: 'key-2', entityReference: 'test:bronze_key', name: 'bronze key' },
      ],
    });

    const result = execute(unlockCommand, fixture.state, fixture.player, {
      ruleKey: 'direct',
      directTarget: fixture.directTarget,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.plan.operations[0].mutation, 'unlock');
  });

  it('explicit with-key does not fall back: wrong explicit key fails even if a correct key is carried', function () {
    const fixture = buildFixture({
      door: { closed: true, locked: true, lockedBy: 'test:bronze_key' },
      inventory: [
        { uuid: 'gold-1', entityReference: 'test:gold_key', name: 'gold key' },
        { uuid: 'bronze-1', entityReference: 'test:bronze_key', name: 'bronze key' },
      ],
    });

    const result = execute(openCommand, fixture.state, fixture.player, {
      ruleKey: 'directIndirect',
      directTarget: fixture.directTarget,
      indirectSpan: ['gold', 'key'],
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.code, 'DOOR_WRONG_KEY');
    assert.match(result.error.message, /gold key/i);
  });

  it('explicit with-key phrase filters to compatible candidates and selects deterministically', function () {
    const fixture = buildFixture({
      door: { closed: true, locked: true, lockedBy: 'test:bronze_key' },
      inventory: [
        { uuid: 'silver-1', entityReference: 'test:silver_key', name: 'silver key' },
        { uuid: 'bronze-1', entityReference: 'test:bronze_key', name: 'bronze key' },
      ],
    });

    const result = execute(unlockCommand, fixture.state, fixture.player, {
      ruleKey: 'directIndirect',
      directTarget: fixture.directTarget,
      indirectSpan: ['key'],
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.plan.operations[0].mutation, 'unlock');
    const actorMessage = result.render.messages[0];
    assert.strictEqual(actorMessage.type, 'semanticEvent');
    assert.strictEqual(actorMessage.objectText.indirect, 'bronze key');
  });

  it('no explicit key auto-selects compatible carried key for open/unlock/lock', function () {
    const openFixture = buildFixture({
      door: { closed: true, locked: true, lockedBy: 'test:bronze_key' },
      inventory: [{ entityReference: 'test:bronze_key', name: 'bronze key' }],
    });
    const unlockFixture = buildFixture({
      door: { closed: true, locked: true, lockedBy: 'test:bronze_key' },
      inventory: [{ entityReference: 'test:bronze_key', name: 'bronze key' }],
    });
    const lockFixture = buildFixture({
      door: { closed: false, locked: false, lockedBy: 'test:bronze_key' },
      inventory: [{ entityReference: 'test:bronze_key', name: 'bronze key' }],
    });

    assert.strictEqual(execute(openCommand, openFixture.state, openFixture.player, { ruleKey: 'direct', directTarget: openFixture.directTarget }).ok, true);
    assert.strictEqual(execute(unlockCommand, unlockFixture.state, unlockFixture.player, { ruleKey: 'direct', directTarget: unlockFixture.directTarget }).ok, true);
    assert.strictEqual(execute(lockCommand, lockFixture.state, lockFixture.player, { ruleKey: 'direct', directTarget: lockFixture.directTarget }).ok, true);
  });

  it('emits default idempotent and capture-failure messaging', function () {
    const alreadyOpen = buildFixture({ door: { closed: false, locked: false } });
    const lockedNoKey = buildFixture({ door: { closed: true, locked: true, lockedBy: 'test:bronze_key' }, inventory: [] });
    const alreadyLocked = buildFixture({ door: { closed: true, locked: true } });
    const alreadyUnlocked = buildFixture({ door: { closed: true, locked: false } });

    assert.match(
      execute(openCommand, alreadyOpen.state, alreadyOpen.player, { ruleKey: 'direct', directTarget: alreadyOpen.directTarget }).error.message,
      /already open/i
    );
    assert.match(
      execute(openCommand, lockedNoKey.state, lockedNoKey.player, { ruleKey: 'direct', directTarget: lockedNoKey.directTarget }).error.message,
      /cannot open/i
    );
    assert.match(
      execute(lockCommand, alreadyLocked.state, alreadyLocked.player, { ruleKey: 'direct', directTarget: alreadyLocked.directTarget }).error.message,
      /already locked/i
    );
    assert.match(
      execute(unlockCommand, alreadyUnlocked.state, alreadyUnlocked.player, { ruleKey: 'direct', directTarget: alreadyUnlocked.directTarget }).error.message,
      /already unlocked/i
    );
  });

  it('emits opposite-room broadcast lines explicitly for successful door commands', function () {
    const fixture = buildFixture({ door: { closed: true, locked: false } });
    const closeFixture = buildFixture({ door: { closed: false, locked: false } });

    const openResult = execute(openCommand, fixture.state, fixture.player, { ruleKey: 'direct', directTarget: fixture.directTarget });
    const closeResult = execute(closeCommand, closeFixture.state, closeFixture.player, { ruleKey: 'direct', directTarget: closeFixture.directTarget });

    const openBroadcast = openResult.render.messages.find(message => message.type === 'broadcast');
    assert.ok(openBroadcast);
    assert.strictEqual(openBroadcast.targetSelector, 'roomByRef');
    assert.strictEqual(openBroadcast.targetRoomRef, fixture.destinationRef);
    assert.match(openBroadcast.message, /opens/i);

    const closeBroadcast = closeResult.render.messages.find(message => message.type === 'broadcast');
    assert.ok(closeBroadcast);
    assert.strictEqual(closeBroadcast.targetSelector, 'roomByRef');
    assert.match(closeBroadcast.message, /closes/i);
  });
});
