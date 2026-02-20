// @ts-check
'use strict';

const assert = require('assert');

const openCommand = require('../commands/open');
const closeCommand = require('../commands/close');
const lockCommand = require('../commands/lock');
const unlockCommand = require('../commands/unlock');

/**
 * @param {*} commandModule
 * @param {{ ruleKey: string, directTarget?: *, indirectTarget?: * }} resolution
 * @param {*} [player]
 * @returns {*}
 */
function execute(commandModule, resolution, player = { room: { entityReference: 'test:doorroom' } }) {
  return commandModule.command({})('', player, null, {
    entityResolution: resolution,
  });
}

describe('bundle-rantamuta door command surfaces', function () {
  it('declares open with direct + directIndirect(with) entity-resolution rules', function () {
    assert.deepStrictEqual(openCommand.metadata.entityResolution.rules, {
      direct: {
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
        },
      },
      directIndirect: {
        acceptedRelations: ['with'],
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
          indirect: ['player.inventory'],
        },
      },
    });
  });

  it('declares close with direct entity-resolution rule', function () {
    assert.deepStrictEqual(closeCommand.metadata.entityResolution.rules, {
      direct: {
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
        },
      },
    });
  });

  it('declares lock with direct + directIndirect(with) entity-resolution rules', function () {
    assert.deepStrictEqual(lockCommand.metadata.entityResolution.rules, {
      direct: {
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
        },
      },
      directIndirect: {
        acceptedRelations: ['with'],
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
          indirect: ['player.inventory'],
        },
      },
    });
  });

  it('declares unlock with direct + directIndirect(with) entity-resolution rules', function () {
    assert.deepStrictEqual(unlockCommand.metadata.entityResolution.rules, {
      direct: {
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
        },
      },
      directIndirect: {
        acceptedRelations: ['with'],
        scopeProfile: {
          direct: ['room.exits', 'room.items'],
          indirect: ['player.inventory'],
        },
      },
    });
  });

  it('returns FORM_NOT_SUPPORTED when open resolution rule is unsupported', function () {
    const result = execute(openCommand, { ruleKey: 'intransitive' });
    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('returns FORM_NOT_SUPPORTED when close resolution rule is unsupported', function () {
    const result = execute(closeCommand, { ruleKey: 'directIndirect' });
    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('returns FORM_NOT_SUPPORTED when lock resolution rule is unsupported', function () {
    const result = execute(lockCommand, { ruleKey: 'intransitive' });
    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('returns FORM_NOT_SUPPORTED when unlock resolution rule is unsupported', function () {
    const result = execute(unlockCommand, { ruleKey: 'intransitive' });
    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'FORM_NOT_SUPPORTED', details: undefined },
    });
  });

  it('maps open/close/lock/unlock to doorMutation operations for resolved exits', function () {
    const player = {
      room: {
        entityReference: 'test:doorroom',
      },
    };
    const directTarget = {
      direction: 'north',
      roomId: 'test:northdoorroom',
    };
    const indirectTarget = { entityReference: 'test:bronze_key' };

    assert.deepStrictEqual(
      openCommand.command({})('', player, null, {
        entityResolution: { ruleKey: 'direct', directTarget },
      }).plan.operations[0],
      {
        type: 'doorMutation',
        mutation: 'open',
        actor: player,
        fromRoomRef: 'test:doorroom',
        direction: 'north',
        roomRef: 'test:northdoorroom',
      }
    );
    assert.deepStrictEqual(
      closeCommand.command({})('', player, null, {
        entityResolution: { ruleKey: 'direct', directTarget },
      }).plan.operations[0],
      {
        type: 'doorMutation',
        mutation: 'close',
        actor: player,
        fromRoomRef: 'test:doorroom',
        direction: 'north',
        roomRef: 'test:northdoorroom',
      }
    );
    assert.deepStrictEqual(
      lockCommand.command({})('', player, null, {
        entityResolution: { ruleKey: 'directIndirect', directTarget, indirectTarget },
      }).plan.operations[0],
      {
        type: 'doorMutation',
        mutation: 'closeAndLock',
        actor: player,
        fromRoomRef: 'test:doorroom',
        direction: 'north',
        roomRef: 'test:northdoorroom',
      }
    );
    assert.deepStrictEqual(
      unlockCommand.command({})('', player, null, {
        entityResolution: { ruleKey: 'directIndirect', directTarget, indirectTarget },
      }).plan.operations[0],
      {
        type: 'doorMutation',
        mutation: 'unlock',
        actor: player,
        fromRoomRef: 'test:doorroom',
        direction: 'north',
        roomRef: 'test:northdoorroom',
      }
    );
  });

  it('returns TARGET_NOT_DOOR when direct target is not an exit', function () {
    const notADoor = { entityReference: 'test:rock' };

    assert.deepStrictEqual(
      execute(openCommand, { ruleKey: 'direct', directTarget: notADoor }),
      { ok: false, error: { code: 'TARGET_NOT_DOOR', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(closeCommand, { ruleKey: 'direct', directTarget: notADoor }),
      { ok: false, error: { code: 'TARGET_NOT_DOOR', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(lockCommand, { ruleKey: 'direct', directTarget: notADoor }),
      { ok: false, error: { code: 'TARGET_NOT_DOOR', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(unlockCommand, { ruleKey: 'direct', directTarget: notADoor }),
      { ok: false, error: { code: 'TARGET_NOT_DOOR', details: undefined } }
    );

  });
});
