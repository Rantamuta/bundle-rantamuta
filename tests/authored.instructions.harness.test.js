// @ts-check
'use strict';

const assert = require('assert');

const {
  createHarnessScope,
  assertSuccessResult,
  assertFailureResult,
  runHarnessCase,
} = require('./helpers/authored-instructions-harness');

describe('authored instructions harness', function () {
  it('creates a minimal explicit authored-instructions scope fixture', function () {
    const scope = createHarnessScope();

    assert.ok(scope.state);
    assert.ok(scope.player);
    assert.ok(scope.actor);
    assert.ok(scope.npc);
    assert.ok(scope.room);
    assert.ok(scope.area);
    assert.ok(scope.inventory);
    assert.strictEqual(scope.player.room, scope.room);
    assert.strictEqual(scope.npc.room, scope.room);
    assert.strictEqual(scope.room.area, scope.area);
    assert.strictEqual(scope.state.RoomManager.getRoom('test:start'), scope.room);
    assert.strictEqual(scope.state.RoomManager.getRoom('missing:room'), null);
  });

  it('asserts canonical success results', function () {
    const result = {
      ok: true,
      operations: [{ type: 'noop' }],
      renderMessages: [],
    };

    assert.doesNotThrow(() => assertSuccessResult(result));
  });

  it('asserts canonical failure results', function () {
    const result = {
      ok: false,
      code: 'AUTHOR_EFFECT_INVALID',
      message: 'Bad effect.',
    };

    assert.doesNotThrow(() => assertFailureResult(result));
  });

  it('runs a success case against an adapter and checks expected output', function () {
    const adapter = ({ effects, scope }) => ({
      ok: true,
      operations: [{
        type: 'seenEffects',
        count: effects.length,
        actor: scope.actor.name,
      }],
      renderMessages: [],
    });

    const result = runHarnessCase({
      adapter,
      effects: [{ broadcast: { audience: 'room', message: 'Hello.' } }],
      expectSuccess: {
        operations: [{
          type: 'seenEffects',
          count: 1,
          actor: 'Tester',
        }],
        renderMessages: [],
      },
    });

    assertSuccessResult(result);
  });

  it('runs a failure case against an adapter and checks failure shape', function () {
    const adapter = () => ({
      ok: false,
      code: 'AUTHOR_EFFECT_UNSUPPORTED',
      message: 'Unsupported effect.',
    });

    const result = runHarnessCase({
      adapter,
      effects: [{ unsupportedEffect: true }],
      expectFailure: {
        code: 'AUTHOR_EFFECT_UNSUPPORTED',
        message: 'Unsupported effect.',
      },
    });

    assertFailureResult(result);
  });
});
