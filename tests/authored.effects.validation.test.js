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

  it('requires each effect entry to be a single-key object', function () {
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

  it('requires each effect name to be known', function () {
    const result = validateAuthoredEffects([
      { messageRoom: 'Hello.' },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_UNSUPPORTED',
    ]);
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
      { setAreaMetadata: { key: 'story.phase', value: 2 } },
      { setWorldMetadata: { key: 'world.phase', value: 2 } },
      { deleteRoomMetadata: { key: 'bells.rung' } },
      { deleteAreaMetadata: { key: 'story.phase' } },
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

  it('enforces required fields for the currently supported effect contracts', function () {
    const result = validateAuthoredEffects([
      { transferItem: { from: 'inventory', to: 'player' } },
      { movePlayer: {} },
      { operateDoor: { mutation: 'open' } },
      { openDoor: {} },
      { closeAndLockDoor: {} },
      { setPlayerMetadata: { value: 2 } },
      { setRoomMetadata: { key: 'bells.rung' } },
      { setAreaMetadata: { value: 2 } },
      { setWorldMetadata: { key: 'world.phase' } },
      { deleteRoomMetadata: {} },
      { deleteAreaMetadata: {} },
      { deleteWorldMetadata: {} },
      { broadcast: { audience: 'room' } },
      { semanticEvent: { audiencePolicy: 'self', participants: { actor: { selector: 'currentActor' } } } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
    ]);
  });

  it('enforces field types and enum contracts where supported', function () {
    const result = validateAuthoredEffects([
      { deleteRoomMetadata: { key: 'bells.rung', force: 'yes' } },
      { deleteAreaMetadata: { key: 'story.phase', force: 1 } },
      { deleteWorldMetadata: { key: 'world.phase', force: 'true' } },
      { broadcast: { audience: 'nowhere', message: 'Hello.' } },
      { operateDoor: { mutation: 'explode', direction: 'north' } },
      { semanticEvent: { template: '{actor.You} nod{verb}.', audiencePolicy: 'nobody', participants: { actor: { selector: 'currentActor' } } } },
      { semanticEvent: { template: '{actor.You} nod{verb}.', audiencePolicy: 'self', participants: { actor: 'currentActor' } } },
      { transferItem: 'widget' },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_EFFECT_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_EFFECT_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_EFFECT_FIELD_ENUM_INVALID',
      'AUTHORED_EFFECT_FIELD_ENUM_INVALID',
      'AUTHORED_EFFECT_FIELD_ENUM_INVALID',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_PAYLOAD_OBJECT_REQUIRED',
    ]);
  });

  it('allows omission only where the effect contract defines safe implicit values', function () {
    const result = validateAuthoredEffects([
      { movePlayer: { toRoom: 'start' } },
      { setPlayerMetadata: { key: 'story.phase', value: 2 } },
      { setRoomMetadata: { key: 'bells.rung', value: true } },
      { setAreaMetadata: { key: 'story.phase', value: 2 } },
      { transferItem: { item: 'widget', from: 'inventory' } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_REQUIRED',
    ]);
  });

  it('rejects malformed refs structurally where the contract can do so', function () {
    const result = validateAuthoredEffects([
      { movePlayer: { toRoom: '' } },
      { openDoor: { roomRef: '' } },
      { broadcast: { audience: 'room', message: 'Hello.', targetSelector: 'roomByRef' } },
      { broadcast: { audience: 'areaExceptTargets', message: 'Hello.', exceptSelector: 'targetsByRoomRef' } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
      'AUTHORED_EFFECT_FIELD_REQUIRED',
    ]);
  });
});
