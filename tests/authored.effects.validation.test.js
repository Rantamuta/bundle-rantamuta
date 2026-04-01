// @ts-check
'use strict';

const assert = require('assert');

const { validateAuthoredEffects } = require('../lib/runtime/authored-effects');

describe('authored effects validator', function () {
  it('accepts an empty authored-effects array', function () {
    const result = validateAuthoredEffects([]);

    assert.deepStrictEqual(result, {
      ok: true,
      errors: [],
    });
  });

  it('rejects a non-array authored-effects root', function () {
    const result = validateAuthoredEffects(null);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECTS_ARRAY_REQUIRED',
    ]);
  });

  it('rejects non-object and multi-key effect entries', function () {
    const result = validateAuthoredEffects([
      'broadcast',
      { broadcast: { audience: 'room', message: 'Hello.' }, transferItem: {} },
    ], { source: 'test-source' });

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_ENTRY_OBJECT_REQUIRED',
      'AUTHORED_EFFECT_ENTRY_SINGLE_KEY_REQUIRED',
    ]);
    assert.strictEqual(result.errors[0].source, 'test-source');
    assert.strictEqual(result.errors[1].source, 'test-source');
  });

  it('accepts one structurally valid payload for each currently supported effect', function () {
    const result = validateAuthoredEffects([
      { transferItem: { item: 'widget', from: 'inventory', to: 'player' } },
      { movePlayer: { toRoom: 'start' } },
      { operateDoor: { mutation: 'open', direction: 'north' } },
      { openDoor: { direction: 'north' } },
      { closeAndLockDoor: { direction: 'north' } },
      { setPlayerMetadata: { key: 'story.phase', value: 2 } },
      { setRoomMetadata: { key: 'bells.rung', value: true } },
      { setAreaMetadata: { actor: 'player', key: 'story.phase', value: 2 } },
      { setWorldMetadata: { key: 'world.phase', value: 2 } },
      { deleteRoomMetadata: { key: 'bells.rung' } },
      { deleteAreaMetadata: { actor: 'player', key: 'story.phase' } },
      { deleteWorldMetadata: { key: 'world.phase' } },
      { broadcast: { audience: 'room', message: 'Hello.' } },
      {
        semanticEvent: {
          template: '{actor.You} nod{verb}.',
          audiencePolicy: 'self',
          participants: {
            actor: { selector: 'currentActor' },
          },
        },
      },
    ]);

    assert.deepStrictEqual(result, {
      ok: true,
      errors: [],
    });
  });

  it('rejects unsupported effect names', function () {
    const result = validateAuthoredEffects([
      { messageRoom: 'Hello.' },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_UNSUPPORTED',
    ]);
  });

  it('rejects malformed effect payloads per effect contract', function () {
    const result = validateAuthoredEffects([
      { transferItem: { from: 'inventory', to: 'player' } },
      { movePlayer: { player: 'player' } },
      { broadcast: { audience: 'nowhere', message: '' } },
      { semanticEvent: { template: '', audiencePolicy: 'self', participants: {} } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_ENUM_INVALID',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
    ]);
  });
});
