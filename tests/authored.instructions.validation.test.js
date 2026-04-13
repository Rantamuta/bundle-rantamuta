// @ts-check
'use strict';

const assert = require('assert');

const { validateAuthoredInstructions } = require('../lib/runtime/authored-instructions');

describe('authored instructions validator', function () {
  it('accepts an empty authored-instructions array', function () {
    const result = validateAuthoredInstructions([]);

    assert.deepStrictEqual(result, {
      ok: true,
      errors: [],
    });
  });

  it('rejects a non-array authored-instructions root', function () {
    const result = validateAuthoredInstructions(null);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTIONS_ARRAY_REQUIRED',
    ]);
  });

  it('requires each effect entry to be a single-key object', function () {
    const result = validateAuthoredInstructions([
      'broadcast',
      { broadcast: { audience: 'room', message: 'Hello.' }, transferItem: {} },
    ], { source: 'test-source' });

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_ENTRY_OBJECT_REQUIRED',
      'AUTHORED_INSTRUCTION_ENTRY_SINGLE_KEY_REQUIRED',
    ]);
    assert.strictEqual(result.errors[0].source, 'test-source');
    assert.strictEqual(result.errors[1].source, 'test-source');
  });

  it('requires each effect name to be known', function () {
    const result = validateAuthoredInstructions([
      { messageRoom: 'Hello.' },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_UNSUPPORTED',
    ]);
  });

  it('accepts one structurally valid payload for each currently supported effect', function () {
    const result = validateAuthoredInstructions([
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
    const result = validateAuthoredInstructions([
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
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    ]);
  });

  it('enforces field types and enum contracts where supported', function () {
    const result = validateAuthoredInstructions([
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
      'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_ENUM_INVALID',
      'AUTHORED_INSTRUCTION_FIELD_ENUM_INVALID',
      'AUTHORED_INSTRUCTION_FIELD_ENUM_INVALID',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_PAYLOAD_OBJECT_REQUIRED',
    ]);
  });

  it('allows omission only where the effect contract defines safe implicit values', function () {
    const result = validateAuthoredInstructions([
      { movePlayer: { toRoom: 'start' } },
      { setPlayerMetadata: { key: 'story.phase', value: 2 } },
      { setRoomMetadata: { key: 'bells.rung', value: true } },
      { setAreaMetadata: { key: 'story.phase', value: 2 } },
      { transferItem: { item: 'widget', from: 'inventory' } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    ]);
  });

  it('rejects malformed refs structurally where the contract can do so', function () {
    const result = validateAuthoredInstructions([
      { movePlayer: { toRoom: '' } },
      { openDoor: { roomRef: '' } },
      { broadcast: { audience: 'room', message: 'Hello.', targetSelector: 'roomByRef' } },
      { broadcast: { audience: 'areaExceptTargets', message: 'Hello.', exceptSelector: 'targetsByRoomRef' } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    ]);
  });

  it('accepts explicit targeting fields for metadata effects when they are structurally valid', function () {
    const result = validateAuthoredInstructions([
      { setPlayerMetadata: { player: 'player', key: 'story.phase', value: 2 } },
      { setRoomMetadata: { roomRef: 'codex:start', key: 'bells.rung', value: true } },
      { setRoomMetadata: { actor: 'npc', key: 'bells.rung', value: true } },
      { setAreaMetadata: { actor: 'npc', key: 'story.phase', value: 2 } },
      { deleteRoomMetadata: { roomRef: 'codex:start', key: 'bells.rung', force: true } },
      { deleteRoomMetadata: { actor: 'npc', key: 'bells.rung', force: false } },
      { deleteAreaMetadata: { actor: 'npc', key: 'story.phase', force: true } },
    ]);

    assert.deepStrictEqual(result, {
      ok: true,
      errors: [],
    });
  });

  it('rejects malformed optional targeting fields for metadata set effects', function () {
    const result = validateAuthoredInstructions([
      { setPlayerMetadata: { player: '', key: 'story.phase', value: 2 } },
      { setPlayerMetadata: { player: '   ', key: 'story.phase', value: 2 } },
      { setPlayerMetadata: { player: 7, key: 'story.phase', value: 2 } },
      { setRoomMetadata: { roomRef: '', key: 'bells.rung', value: true } },
      { setRoomMetadata: { roomRef: '   ', key: 'bells.rung', value: true } },
      { setRoomMetadata: { roomRef: 7, key: 'bells.rung', value: true } },
      { setRoomMetadata: { actor: '', key: 'bells.rung', value: true } },
      { setRoomMetadata: { actor: '   ', key: 'bells.rung', value: true } },
      { setRoomMetadata: { actor: 7, key: 'bells.rung', value: true } },
      { setAreaMetadata: { actor: '', key: 'story.phase', value: 2 } },
      { setAreaMetadata: { actor: '   ', key: 'story.phase', value: 2 } },
      { setAreaMetadata: { actor: 7, key: 'story.phase', value: 2 } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    ]);
  });

  it('rejects malformed optional targeting fields for metadata delete effects', function () {
    const result = validateAuthoredInstructions([
      { deleteRoomMetadata: { roomRef: '', key: 'bells.rung' } },
      { deleteRoomMetadata: { roomRef: '   ', key: 'bells.rung' } },
      { deleteRoomMetadata: { roomRef: 7, key: 'bells.rung' } },
      { deleteRoomMetadata: { actor: '', key: 'bells.rung' } },
      { deleteRoomMetadata: { actor: '   ', key: 'bells.rung' } },
      { deleteRoomMetadata: { actor: 7, key: 'bells.rung' } },
      { deleteAreaMetadata: { actor: '', key: 'story.phase' } },
      { deleteAreaMetadata: { actor: '   ', key: 'story.phase' } },
      { deleteAreaMetadata: { actor: 7, key: 'story.phase' } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_REQUIRED',
    ]);
  });

  it('rejects malformed metadata delete force values even when optional targeting fields are present', function () {
    const result = validateAuthoredInstructions([
      { deleteRoomMetadata: { roomRef: 'codex:start', key: 'bells.rung', force: 'yes' } },
      { deleteRoomMetadata: { actor: 'npc', key: 'bells.rung', force: 1 } },
      { deleteAreaMetadata: { actor: 'npc', key: 'story.phase', force: 'true' } },
    ]);

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
      'AUTHORED_INSTRUCTION_FIELD_BOOLEAN_REQUIRED',
    ]);
  });
});
