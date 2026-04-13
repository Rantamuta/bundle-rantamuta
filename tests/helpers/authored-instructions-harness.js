// @ts-check
'use strict';

const assert = require('assert');

/**
 * @typedef {{
 *   ok: true,
 *   operations: Array<*>,
 *   renderMessages: Array<*>,
 * }} HarnessSuccessResult
 */

/**
 * @typedef {{
 *   ok: false,
 *   code: string,
 *   message: string,
 *   details?: Record<string, *>,
 * }} HarnessFailureResult
 */

/**
 * @typedef {HarnessSuccessResult | HarnessFailureResult} HarnessResult
 */

/**
 * Create a minimal explicit scope object for authored-instructions tests.
 *
 * The harness keeps scope construction boring on purpose so later tests can
 * focus on transposition behavior rather than fixture plumbing.
 *
 * @param {Partial<Record<string, *>>} [overrides]
 * @returns {{
 *   state: { RoomManager: { getRoom: (ref: string) => * | null } },
 *   player: { name: string, room: *, inventory: * },
 *   actor: *,
 *   npc: { name: string, room: * },
 *   room: { entityReference: string, area: * },
 *   area: { name: string, entityReference: string },
 *   inventory: { owner: string },
 * }}
 */
function createHarnessScope(overrides = {}) {
  const area = {
    name: 'Test Area',
    entityReference: 'test',
  };

  const room = {
    entityReference: 'test:start',
    area,
  };

  const inventory = {
    owner: 'player',
  };

  const player = {
    name: 'Tester',
    room,
    inventory,
  };

  const npc = {
    name: 'Guide',
    room,
  };

  const state = {
    RoomManager: {
      getRoom(ref) {
        return ref === 'test:start' ? room : null;
      },
    },
  };

  return {
    state,
    player,
    actor: player,
    npc,
    room,
    area,
    inventory,
    ...overrides,
  };
}

/**
 * Assert the canonical success shape expected from the authored-instructions
 * transposer entrypoint.
 *
 * @param {*} result
 * @returns {asserts result is HarnessSuccessResult}
 */
function assertSuccessResult(result) {
  assert.ok(result && typeof result === 'object', 'expected result object');
  assert.strictEqual(result.ok, true, 'expected ok: true');
  assert.ok(Array.isArray(result.operations), 'expected operations array');
  assert.ok(Array.isArray(result.renderMessages), 'expected renderMessages array');
}

/**
 * Assert the canonical failure shape expected from the authored-instructions
 * transposer entrypoint.
 *
 * @param {*} result
 * @returns {asserts result is HarnessFailureResult}
 */
function assertFailureResult(result) {
  assert.ok(result && typeof result === 'object', 'expected result object');
  assert.strictEqual(result.ok, false, 'expected ok: false');
  assert.strictEqual(typeof result.code, 'string', 'expected string failure code');
  assert.ok(result.code.trim().length > 0, 'expected non-empty failure code');
  assert.strictEqual(typeof result.message, 'string', 'expected string failure message');
  assert.ok(result.message.trim().length > 0, 'expected non-empty failure message');
}

/**
 * Run one table-driven harness case against an adapter.
 *
 * @param {{
 *   adapter: ({ effects: Array<*>, scope: Record<string, *> }) => HarnessResult,
 *   effects: Array<*>,
 *   scope?: Record<string, *>,
 *   expectSuccess?: { operations?: Array<*>, renderMessages?: Array<*> },
 *   expectFailure?: { code: string, message?: string },
 * }} input
 * @returns {HarnessResult}
 */
function runHarnessCase(input) {
  const scope = input.scope || createHarnessScope();
  const result = input.adapter({
    effects: input.effects,
    scope,
  });

  if (input.expectFailure) {
    assertFailureResult(result);
    assert.strictEqual(result.code, input.expectFailure.code);
    if (typeof input.expectFailure.message === 'string') {
      assert.strictEqual(result.message, input.expectFailure.message);
    }
    return result;
  }

  assertSuccessResult(result);
  if (input.expectSuccess && Object.prototype.hasOwnProperty.call(input.expectSuccess, 'operations')) {
    assert.deepStrictEqual(result.operations, input.expectSuccess.operations);
  }
  if (input.expectSuccess && Object.prototype.hasOwnProperty.call(input.expectSuccess, 'renderMessages')) {
    assert.deepStrictEqual(result.renderMessages, input.expectSuccess.renderMessages);
  }
  return result;
}

module.exports = {
  createHarnessScope,
  assertSuccessResult,
  assertFailureResult,
  runHarnessCase,
};
