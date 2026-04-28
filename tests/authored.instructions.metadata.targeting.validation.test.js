// @ts-check
'use strict';

const assert = require('assert');

const { validateAuthoredInstructions } = require('../lib/runtime/authored-instructions');

describe('authored instructions metadata targeting validation', function () {
  it('reports only unsupported for malformed unsupported metadata targeting fields', function () {
    const result = validateAuthoredInstructions([
      { setRoomMetadata: { player: '', key: 'bells.rung', value: true } },
      { setPlayerMetadata: { actor: '', key: 'story.phase', value: 2 } },
      { setWorldMetadata: { roomRef: 7, key: 'world.phase', value: 2 } },
    ]);

    assert.deepStrictEqual(result, {
      ok: false,
      errors: [
        {
          code: 'AUTHORED_INSTRUCTION_FIELD_UNSUPPORTED',
          message: 'setRoomMetadata.player is not supported for this instruction.',
          details: {
            instructionName: 'setRoomMetadata',
            field: 'player',
            value: '',
            supportedFields: ['actor', 'roomRef'],
          },
        },
        {
          code: 'AUTHORED_INSTRUCTION_FIELD_UNSUPPORTED',
          message: 'setPlayerMetadata.actor is not supported for this instruction.',
          details: {
            instructionName: 'setPlayerMetadata',
            field: 'actor',
            value: '',
            supportedFields: ['player'],
          },
        },
        {
          code: 'AUTHORED_INSTRUCTION_FIELD_UNSUPPORTED',
          message: 'setWorldMetadata.roomRef is not supported for this instruction.',
          details: {
            instructionName: 'setWorldMetadata',
            field: 'roomRef',
            value: 7,
            supportedFields: [],
          },
        },
      ],
    });
  });
});
