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
 * @returns {*}
 */
function execute(commandModule, resolution) {
  return commandModule.command({})('', {}, null, {
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

  it('returns baseline DOOR_NOT_IMPLEMENTED for supported open/close/lock/unlock forms', function () {
    const directTarget = { id: 'north-exit' };
    const indirectTarget = { id: 'bronze-key' };

    assert.deepStrictEqual(
      execute(openCommand, { ruleKey: 'direct', directTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(openCommand, { ruleKey: 'directIndirect', directTarget, indirectTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(closeCommand, { ruleKey: 'direct', directTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(lockCommand, { ruleKey: 'direct', directTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(lockCommand, { ruleKey: 'directIndirect', directTarget, indirectTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(unlockCommand, { ruleKey: 'direct', directTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
    assert.deepStrictEqual(
      execute(unlockCommand, { ruleKey: 'directIndirect', directTarget, indirectTarget }),
      { ok: false, error: { code: 'DOOR_NOT_IMPLEMENTED', details: undefined } }
    );
  });
});
