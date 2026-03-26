// @ts-check
'use strict';

const assert = require('assert');
const { validateConversationDefinition } = require('../lib/runtime/conversation/conversation-definition-validation');

describe('bundle-rantamuta conversation definition validation', function () {
  it('accepts a valid minimal authored conversation definition', function () {
    const result = validateConversationDefinition({
      id: 'actor_planner',
      initial: 'greeting',
      states: {
        greeting: {
          events: {
            continue: {
              target: 'done',
            },
          },
        },
        done: {
          final: true,
        },
      },
    }, 'test:actorPlanner');

    assert.deepStrictEqual(result, {
      ok: true,
      errors: [],
    });
  });

  it('rejects missing top-level required fields with deterministic codes', function () {
    const result = validateConversationDefinition({}, 'test:missing');

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'CONVERSATION_ID_REQUIRED',
      'CONVERSATION_INITIAL_REQUIRED',
      'CONVERSATION_STATES_REQUIRED',
    ]);
  });

  it('rejects an initial state that does not exist', function () {
    const result = validateConversationDefinition({
      id: 'actor_planner',
      initial: 'greeting',
      states: {
        done: { final: true },
      },
    }, 'test:missingInitialState');

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'CONVERSATION_INITIAL_STATE_MISSING',
    ]);
  });

  it('rejects missing target states across event, default, transition, and auto references', function () {
    const result = validateConversationDefinition({
      id: 'actor_planner',
      initial: 'greeting',
      states: {
        greeting: {
          events: {
            continue: {
              target: 'missing_event',
            },
            branching: {
              transitions: [
                { target: 'missing_transition' },
              ],
            },
            default: {
              target: 'missing_default',
            },
          },
        },
        routing_only: {
          auto: [{ target: 'missing_auto' }],
        },
      },
    }, 'test:missingTargets');

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'CONVERSATION_EVENT_TARGET_MISSING',
      'CONVERSATION_TRANSITION_TARGET_MISSING',
      'CONVERSATION_DEFAULT_TARGET_MISSING',
      'CONVERSATION_AUTO_TARGET_MISSING',
    ]);
  });

  it('rejects forbidden final and auto state shape combinations', function () {
    const result = validateConversationDefinition({
      id: 'actor_planner',
      initial: 'greeting',
      states: {
        greeting: {
          final: true,
          auto: [{ target: 'done' }],
          events: {
            continue: {
              target: 'done',
            },
            default: {
              target: 'done',
            },
          },
        },
        done: {
          final: true,
        },
      },
    }, 'test:forbiddenCombos');

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'CONVERSATION_FINAL_STATE_HAS_EVENTS',
      'CONVERSATION_FINAL_STATE_HAS_DEFAULT',
      'CONVERSATION_AUTO_STATE_HAS_EVENTS',
      'CONVERSATION_AUTO_STATE_HAS_DEFAULT',
      'CONVERSATION_AUTO_STATE_IS_FINAL',
    ]);
  });

  it('rejects malformed event shape', function () {
    const result = validateConversationDefinition({
      id: 'actor_planner',
      initial: 'greeting',
      states: {
        greeting: {
          events: {
            invalid_mix: {
              target: 'done',
              transitions: [
                { target: 'done' },
              ],
            },
            invalid_empty: {},
            invalid_transition_target: {
              transitions: [
                {},
              ],
            },
          },
        },
        done: { final: true },
      },
    }, 'test:malformedEvent');

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'CONVERSATION_EVENT_SHAPE_CONFLICT',
      'CONVERSATION_EVENT_TARGET_REQUIRED',
      'CONVERSATION_TRANSITION_TARGET_REQUIRED',
    ]);
  });

  it('rejects malformed auto shape', function () {
    const result = validateConversationDefinition({
      id: 'actor_planner',
      initial: 'routing',
      states: {
        routing: {
          auto: [{}],
        },
      },
    }, 'test:malformedAuto');

    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.errors.map(error => error.code), [
      'CONVERSATION_AUTO_TARGET_REQUIRED',
    ]);
  });
});
