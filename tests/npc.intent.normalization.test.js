// @ts-check
'use strict';

const assert = require('assert');
const { inspect } = require('util');
const { dispatchNpcIntent } = require('../lib/session/command-dispatch');
const { parseInput } = require('../lib/parse-input');

function formatActual(value) {
  return inspect(value, {
    depth: null,
    colors: false,
    compact: false,
    sorted: true,
  });
}

/**
 * @param {*} value
 * @returns {*}
 */
function asActor(value) {
  return value;
}

/**
 * @param {*} value
 * @param {*} actor
 * @returns {*}
 */
function withPlayerManager(value, actor) {
  const base = value && typeof value === 'object' ? value : {};
  return {
    ...base,
    PlayerManager: {
      getPlayer: () => actor,
    },
  };
}

describe('bundle-rantamuta npc intent normalization', function () {
  it('normalizes text intent through player canonicalization+parse path', async function () {
    /** @type {*} */
    let seenParsedInput = null;
    const actor = asActor({
      name: 'Tomo',
      isNpc: true,
      room: { getBroadcastTargets: () => [actor] },
      socket: { writable: false },
    });

    const command = {
      metadata: {
        entityResolution: {
          rules: {
            intransitive: {},
          },
        },
      },
      execute: async (_args, _player, _alias, context) => {
        seenParsedInput = context && context.parsedInput;
        return {
          ok: true,
          plan: { operations: [{ type: 'noop' }] },
          render: { messages: [] },
        };
      },
    };
    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'look' ? command : null,
      },
    }, actor);

    const result = await dispatchNpcIntent(state, actor, {
      kind: 'text',
      input: 'l',
    });

    assert.deepStrictEqual(
      result,
      { ok: true },
      `expected text intent normalization to succeed, got: ${formatActual(result)}`
    );
    assert.deepStrictEqual(seenParsedInput, parseInput('l'));
  });

  it('normalizes structured intent to the same parser artifact shape', async function () {
    /** @type {*} */
    let seenParsedInput = null;
    const actor = asActor({
      name: 'Tomo',
      isNpc: true,
      room: { getBroadcastTargets: () => [actor] },
      socket: { writable: false },
    });

    const command = {
      metadata: {},
      execute: async (_args, _player, _alias, context) => {
        seenParsedInput = context && context.parsedInput;
        return {
          ok: false,
          error: { code: 'TARGET_NOT_FOUND' },
        };
      },
    };
    const state = withPlayerManager({
      CommandManager: {
        get: key => key === 'put' ? command : null,
      },
    }, actor);

    const result = await dispatchNpcIntent(state, actor, {
      kind: 'structured',
      verb: 'put',
      direct: ['apple'],
      relationToken: 'into',
      indirect: ['chest'],
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: { code: 'TARGET_NOT_FOUND' },
    });
    assert.deepStrictEqual(seenParsedInput, parseInput('put apple into chest'));
  });

  it('rejects structured intents that include bound runtime entities', async function () {
    let executed = false;
    const actor = asActor({
      name: 'Tomo',
      isNpc: true,
      room: { getBroadcastTargets: () => [actor] },
      socket: { writable: false },
    });
    const state = withPlayerManager({
      CommandManager: {
        get: () => ({
          execute: async () => {
            executed = true;
            return { ok: true, plan: { operations: [{ type: 'noop' }] }, render: { messages: [] } };
          },
        }),
      },
    }, actor);

    const result = await dispatchNpcIntent(state, actor, {
      kind: 'structured',
      verb: 'look',
      direct: [{ uuid: 'bound-target' }],
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'NPC_INTENT_INVALID',
        details: {
          reason: 'NON_STRING_TOKEN',
          field: 'direct',
        },
      },
    });
    assert.strictEqual(executed, false);
  });

  it('rejects structured intents with forbidden pre-resolved fields', async function () {
    let executed = false;
    const actor = asActor({
      name: 'Tomo',
      isNpc: true,
      room: { getBroadcastTargets: () => [actor] },
      socket: { writable: false },
    });
    const state = withPlayerManager({
      CommandManager: {
        get: () => ({
          execute: async () => {
            executed = true;
            return { ok: true, plan: { operations: [{ type: 'noop' }] }, render: { messages: [] } };
          },
        }),
      },
    }, actor);

    const result = await dispatchNpcIntent(state, actor, {
      kind: 'structured',
      verb: 'look',
      entityResolution: {
        directTarget: { uuid: 'bound-target' },
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      error: {
        code: 'NPC_INTENT_FORBIDDEN_FIELD',
        details: {
          field: 'entityResolution',
        },
      },
    });
    assert.strictEqual(executed, false);
  });
});
