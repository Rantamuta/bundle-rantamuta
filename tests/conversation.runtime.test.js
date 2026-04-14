'use strict';

const assert = require('assert');
const path = require('path');

const { deepFreeze } = require('../lib/helpers/deep-freeze');
const { ensureConversationDefinitionService, disposeConversationDefinitionService } = require('../lib/runtime/conversation/conversation-definition-service');
const { evaluateConversationRuntime, AUTO_HOP_LIMIT } = require('../lib/runtime/conversation/conversation-runtime');

function createPlayer(metadata = {}) {
  return {
    name: 'Tester',
    metadata,
  };
}

function createConditionEvaluator(passedFlags = [], expectedQ = null, calls = []) {
  const passed = new Set(passedFlags);
  return function conditionEvaluator(condition, context) {
    calls.push({ condition, context });

    if (expectedQ) {
      assert.strictEqual(context.q, expectedQ);
    }

    if (!condition || typeof condition !== 'object') {
      return false;
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'allow')) {
      return passed.has(condition.allow);
    }

    if (Object.prototype.hasOwnProperty.call(condition, 'equals')) {
      return condition.equals === true;
    }

    return false;
  };
}

function createDefinition(overrides = {}) {
  return {
    id: 'runtime_fixture',
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
    ...overrides,
  };
}

function createServiceState() {
  return {
    BundleManager: {
      bundlesPath: `${path.resolve(__dirname, '..', '..')}${path.sep}`,
    },
  };
}

describe('bundle-rantamuta conversation runtime', function () {
  afterEach(function () {
    disposeConversationDefinitionService(this.serviceState);
  });

  it('exports one stable public evaluator surface', function () {
    assert.strictEqual(typeof evaluateConversationRuntime, 'function');
    assert.strictEqual(Number.isInteger(AUTO_HOP_LIMIT), true);
  });

  it('does not require say, talk, or command-dispatch wiring to run', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'inspect');
  });

  it('accepts a loaded definition, player, npcRef, and optional event id', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'event');
  });

  it('supports inspection of the current state when no event id is provided', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'inspect');
    assert.strictEqual(result.sourceState, 'greeting');
    assert.strictEqual(result.settledState, 'greeting');
    assert.deepStrictEqual(result.visibleEvents.map(event => event.id), ['continue']);
  });

  it('rejects calls that omit required runtime inputs', function () {
    const result = evaluateConversationRuntime({
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'CONVERSATION_RUNTIME_DEFINITION_INVALID');
  });

  it('passes a shared-query-surface-compatible read-only condition helper through without rewriting it', function () {
    const calls = [];
    const q = { actorHasItem: () => true };
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                label: 'Continue',
                condition: { allow: 'show-continue' },
                target: 'done',
              },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      q,
      conditionEvaluator: createConditionEvaluator(['show-continue'], q, calls),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(calls.length > 0, true);
    assert.strictEqual(calls[0].context.q, q);
  });

  it('exposes only the shared q.* surface and standard evaluation context fields to conditions', function () {
    const calls = [];
    const q = { actorHasItem: () => true };
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                condition: { allow: 'show-continue' },
                target: 'done',
              },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      q,
      conditionEvaluator: createConditionEvaluator(['show-continue'], q, calls),
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(Object.keys(calls[0].context).sort(), [
      'definition',
      'eventId',
      'index',
      'npcRef',
      'phase',
      'player',
      'q',
      'stateId',
    ]);
  });

  it('treats player input as read-only for evaluation purposes', function () {
    const player = createPlayer({ conversations: { test: { actorPlanner: { state: 'greeting' } } } });
    Object.freeze(player.metadata.conversations.test.actorPlanner);
    Object.freeze(player.metadata.conversations.test);
    Object.freeze(player.metadata.conversations);
    Object.freeze(player.metadata);
    Object.freeze(player);

    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player,
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sourceState, 'greeting');
  });

  it('returns source state, destination state, settled state, visible events, and final-state flag in one stable result', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(Object.keys(result), [
      'ok',
      'mode',
      'sourceState',
      'selectedEvent',
      'selectedTransition',
      'destinationState',
      'settledState',
      'final',
      'visibleEvents',
      'transitionActions',
      'stateEntryActions',
      'trace',
    ]);
    assert.strictEqual(result.sourceState, 'greeting');
    assert.strictEqual(result.destinationState, 'done');
    assert.strictEqual(result.settledState, 'done');
    assert.strictEqual(result.final, true);
  });

  it('returns a trace object with stable top-level fields', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(Object.keys(result.trace), [
      'mode',
      'inputEventId',
      'sourceState',
      'selectedEvent',
      'selectedTransition',
      'destinationState',
      'settledState',
      'final',
      'visibleEventIds',
      'enteredStates',
      'autoVisitedStates',
      'conditionChecks',
      'errors',
    ]);
  });

  it('returns a structured result instead of mutating the caller inputs', function () {
    const definition = deepFreeze(createDefinition());
    const player = createPlayer();
    const snapshot = JSON.stringify(definition);

    const result = evaluateConversationRuntime({
      definition,
      player,
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(JSON.stringify(definition), snapshot);
  });

  it('uses persisted conversation state from player metadata when present', function () {
    const player = createPlayer({
      conversations: {
        test: {
          actorPlanner: {
            state: 'done',
          },
        },
      },
    });

    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player,
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sourceState, 'done');
    assert.strictEqual(result.final, true);
  });

  it('uses the authored initial state when persisted state is absent', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.sourceState, 'greeting');
  });

  it('keeps same-named NPC ids in different areas on different state paths', function () {
    const player = createPlayer({
      conversations: {
        alpha: {
          keeper: { state: 'left' },
        },
        beta: {
          keeper: { state: 'right' },
        },
      },
    });
    const definition = createDefinition({
      initial: 'start',
      states: {
        start: { events: { go: { target: 'left' } } },
        left: { final: true },
        right: { final: true },
      },
    });

    const alpha = evaluateConversationRuntime({
      definition,
      player,
      npcRef: 'alpha:keeper',
    });
    const beta = evaluateConversationRuntime({
      definition,
      player,
      npcRef: 'beta:keeper',
    });

    assert.strictEqual(alpha.ok, true);
    assert.strictEqual(beta.ok, true);
    assert.strictEqual(alpha.sourceState, 'left');
    assert.strictEqual(beta.sourceState, 'right');
  });

  it('preserves authored event order after filtering', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              first: { label: 'First', target: 'done' },
              hidden_by_condition: { label: 'Hidden', condition: { allow: 'show-hidden' }, target: 'done' },
              second: { label: 'Second', target: 'done' },
              default: { target: 'done' },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visibleEvents.map(event => event.id), ['first', 'second']);
  });

  it('excludes hidden default from visible events', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'done' },
              default: { target: 'done' },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visibleEvents.map(event => event.id), ['continue']);
  });

  it('excludes events whose condition does not pass', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              blocked: { condition: { allow: 'blocked' }, target: 'done' },
              visible: { target: 'done' },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visibleEvents.map(event => event.id), ['visible']);
  });

  it('selects the authored event whose id exactly matches the input event id', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              mine: { target: 'done' },
              mineral: { target: 'greeting' },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'mine',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedEvent.eventId, 'mine');
    assert.strictEqual(result.destinationState, 'done');
  });

  it('does not match a different event by prefix or fuzzy similarity', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              mineral: { target: 'done' },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'mine',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedEvent, null);
    assert.strictEqual(result.destinationState, null);
  });

  it('treats event meaning as local to the current state', function () {
    const player = createPlayer({
      conversations: {
        test: {
          actorPlanner: {
            state: 'followup',
          },
        },
      },
    });
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        initial: 'greeting',
        states: {
          greeting: {
            events: {
              answer: { target: 'left' },
            },
          },
          followup: {
            events: {
              answer: { target: 'right' },
            },
          },
          left: { final: true },
          right: { final: true },
        },
      }),
      player,
      npcRef: 'test:actorPlanner',
      eventId: 'answer',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.destinationState, 'right');
  });

  it('takes the target state when an unconditional single-transition event is selected', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.destinationState, 'done');
  });

  it('takes the target state when a conditioned single-transition event passes', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                condition: { allow: 'take-continue' },
                target: 'done',
              },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator(['take-continue']),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.destinationState, 'done');
  });

  it('returns no selected transition when a conditioned single-transition event fails and no default applies', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                condition: { allow: 'take-continue' },
                target: 'done',
              },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedTransition, null);
    assert.strictEqual(result.destinationState, null);
    assert.strictEqual(result.settledState, 'greeting');
  });

  it('uses the first passing guarded transition in authored order', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                transitions: [
                  { condition: { allow: 'first' }, target: 'firstDone' },
                  { condition: { allow: 'second' }, target: 'secondDone' },
                ],
              },
            },
          },
          firstDone: { final: true },
          secondDone: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator(['first', 'second']),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.destinationState, 'firstDone');
  });

  it('does not continue to later guarded transitions after a passing match', function () {
    const calls = [];
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                transitions: [
                  { condition: { allow: 'first' }, target: 'firstDone' },
                  { condition: { allow: 'second' }, target: 'secondDone' },
                ],
              },
            },
          },
          firstDone: { final: true },
          secondDone: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator(['first', 'second'], null, calls),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.destinationState, 'firstDone');
    assert.deepStrictEqual(calls.map(call => call.condition.allow), ['first']);
  });

  it('returns no selected guarded transition when none pass and no default applies', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                transitions: [
                  { condition: { allow: 'first' }, target: 'firstDone' },
                  { condition: { allow: 'second' }, target: 'secondDone' },
                ],
              },
            },
          },
          firstDone: { final: true },
          secondDone: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedTransition, null);
    assert.strictEqual(result.destinationState, null);
  });

  it('uses default when no exact event id exists in the current state', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'done' },
              default: { target: 'fallback' },
            },
          },
          fallback: { final: true },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'unknown',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedEvent.eventId, 'default');
    assert.strictEqual(result.destinationState, 'fallback');
  });

  it('uses default when an exact event exists but no transition in that event is selected', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                condition: { allow: 'take-continue' },
                target: 'done',
              },
              default: {
                target: 'fallback',
              },
            },
          },
          fallback: { final: true },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedEvent.eventId, 'default');
    assert.strictEqual(result.destinationState, 'fallback');
  });

  it('does not use default when an exact event exists and succeeds', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'done' },
              default: { target: 'fallback' },
            },
          },
          fallback: { final: true },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedEvent.eventId, 'continue');
    assert.strictEqual(result.destinationState, 'done');
  });

  it('uses conditioned default when its condition passes', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              default: {
                condition: { allow: 'allow-default' },
                target: 'fallback',
              },
            },
          },
          fallback: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'unknown',
      conditionEvaluator: createConditionEvaluator(['allow-default']),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.destinationState, 'fallback');
  });

  it('returns no transition when neither an exact event nor default applies', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              default: {
                condition: { allow: 'allow-default' },
                target: 'fallback',
              },
            },
          },
          fallback: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'unknown',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedTransition, null);
    assert.strictEqual(result.destinationState, null);
    assert.strictEqual(result.settledState, 'greeting');
  });

  it('collects destination state entry actions after entering the destination state', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                actions: [{ op: 'transition', id: 't1' }],
                target: 'done',
              },
            },
          },
          done: {
            onEntry: {
              actions: [{ op: 'entry', id: 's1' }],
            },
            final: true,
          },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.transitionActions, [{ op: 'transition', id: 't1' }]);
    assert.deepStrictEqual(result.stateEntryActions, [{ op: 'entry', id: 's1' }]);
  });

  it('does not execute returned entry actions', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'done' },
            },
          },
          done: {
            onEntry: {
              actions: [{ type: 'setPlayerMetadata', key: 'x', value: 'y' }],
            },
            final: true,
          },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.player, undefined);
    assert.deepStrictEqual(result.stateEntryActions, [{ type: 'setPlayerMetadata', key: 'x', value: 'y' }]);
  });

  it('does not execute returned transition actions', function () {
    let effectExecuted = false;
    const transitionEffect = {
      type: 'emitMessage',
      execute() {
        effectExecuted = true;
      },
    };

    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                actions: [transitionEffect],
                target: 'done',
              },
            },
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(effectExecuted, false);
    assert.deepStrictEqual(result.transitionActions, [transitionEffect]);
  });

  it('keeps transition actions and state-entry actions separately identifiable in the result or trace', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: {
                actions: [{ id: 'transition-effect' }],
                target: 'done',
              },
            },
          },
          done: {
            onEntry: {
              actions: [{ id: 'entry-effect' }],
            },
            final: true,
          },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.transitionActions, [{ id: 'transition-effect' }]);
    assert.deepStrictEqual(result.stateEntryActions, [{ id: 'entry-effect' }]);
  });

  it('evaluates auto routes only after collecting entry actions', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'routing' },
            },
          },
          routing: {
            onEntry: {
              actions: [{ id: 'routing-entry' }],
            },
            auto: [
              { target: 'done' },
            ],
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.stateEntryActions, [{ id: 'routing-entry' }]);
    assert.deepStrictEqual(result.trace.enteredStates, ['routing', 'done']);
  });

  it('uses the first passing auto route in authored order', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'routing' },
            },
          },
          routing: {
            auto: [
              { condition: { allow: 'first-auto' }, target: 'first' },
              { condition: { allow: 'second-auto' }, target: 'second' },
            ],
          },
          first: { final: true },
          second: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator(['first-auto', 'second-auto']),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.settledState, 'first');
  });

  it('takes an unconditional auto route when earlier conditioned routes fail', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'routing' },
            },
          },
          routing: {
            auto: [
              { condition: { allow: 'blocked' }, target: 'never' },
              { target: 'done' },
            ],
          },
          never: { final: true },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
      conditionEvaluator: createConditionEvaluator([]),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.settledState, 'done');
  });

  it('records the entered states and the settled state in the trace', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'routing' },
            },
          },
          routing: {
            auto: [{ target: 'done' }],
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.trace.enteredStates, ['routing', 'done']);
    assert.strictEqual(result.trace.settledState, 'done');
  });

  it('records the important evaluation steps in a stable trace shape for successful event settling', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'routing' },
            },
          },
          routing: {
            auto: [{ target: 'done' }],
          },
          done: { final: true },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.trace, {
      mode: 'event',
      inputEventId: 'continue',
      sourceState: 'greeting',
      selectedEvent: { eventId: 'continue', source: 'event' },
      selectedTransition: { source: 'event', target: 'routing', index: null },
      destinationState: 'routing',
      settledState: 'done',
      final: true,
      visibleEventIds: [],
      enteredStates: ['routing', 'done'],
      autoVisitedStates: ['routing', 'done'],
      conditionChecks: [
        { phase: 'event', stateId: 'greeting', eventId: 'continue', index: null, passed: true },
        { phase: 'auto', stateId: 'routing', eventId: null, index: 0, passed: true },
      ],
      errors: [],
    });
  });

  it('fails explicitly when one auto chain revisits a state', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'loopA' },
            },
          },
          loopA: {
            auto: [{ target: 'loopB' }],
          },
          loopB: {
            auto: [{ target: 'loopA' }],
          },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'CONVERSATION_RUNTIME_AUTO_LOOP');
  });

  it('records visited states and loop failure reason in the trace when auto routing loops', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'loop_a' },
            },
          },
          loop_a: {
            auto: [{ target: 'loop_b' }],
          },
          loop_b: {
            auto: [{ target: 'loop_a' }],
          },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'CONVERSATION_RUNTIME_AUTO_LOOP');
    assert.deepStrictEqual(result.trace.autoVisitedStates, ['loop_a', 'loop_b']);
    assert.deepStrictEqual(result.trace.enteredStates, ['loop_a', 'loop_b']);
    assert.deepStrictEqual(result.trace.errors, [
      {
        code: 'CONVERSATION_RUNTIME_AUTO_LOOP',
        message: 'Conversation auto routing revisited state "loop_a".',
      },
    ]);
  });

  it('fails explicitly when one auto chain exceeds the 32-hop hard cap', function () {
    /** @type {Record<string, *>} */
    const states = {
      greeting: {
        events: {
          continue: { target: 'step0' },
        },
      },
    };
    for (let index = 0; index <= AUTO_HOP_LIMIT; index += 1) {
      states[`step${index}`] = {
        auto: [{ target: `step${index + 1}` }],
      };
    }
    states[`step${AUTO_HOP_LIMIT + 1}`] = {
      final: true,
    };

    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states,
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'CONVERSATION_RUNTIME_AUTO_HOP_LIMIT');
  });

  it('records visited states and hop-limit failure reason in the trace when auto routing exceeds the cap', function () {
    /** @type {Record<string, *>} */
    const states = {
      greeting: {
        events: {
          continue: { target: 'step_0' },
        },
      },
    };

    for (let i = 0; i <= AUTO_HOP_LIMIT; i += 1) {
      states[`step_${i}`] = {
        auto: [{ target: `step_${i + 1}` }],
      };
    }

    states[`step_${AUTO_HOP_LIMIT + 1}`] = {
      final: true,
    };

    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states,
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'CONVERSATION_RUNTIME_AUTO_HOP_LIMIT');
    assert.strictEqual(result.trace.autoVisitedStates.length, AUTO_HOP_LIMIT + 1);
    assert.strictEqual(result.trace.autoVisitedStates[0], 'step_0');
    assert.strictEqual(result.trace.autoVisitedStates[AUTO_HOP_LIMIT], `step_${AUTO_HOP_LIMIT}`);
    assert.deepStrictEqual(result.trace.errors, [
      {
        code: 'CONVERSATION_RUNTIME_AUTO_HOP_LIMIT',
        message: `Conversation auto routing exceeded the ${AUTO_HOP_LIMIT}-hop limit.`,
      },
    ]);
  });

  it('marks final states clearly in the evaluator result', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.final, true);
  });

  it('returns no visible events from a final state', function () {
    const player = createPlayer({
      conversations: {
        test: {
          actorPlanner: { state: 'done' },
        },
      },
    });
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player,
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.visibleEvents, []);
  });

  it('still reports state-entry actions for a final state when authored', function () {
    const result = evaluateConversationRuntime({
      definition: createDefinition({
        states: {
          greeting: {
            events: {
              continue: { target: 'done' },
            },
          },
          done: {
            onEntry: {
              actions: [{ id: 'final-entry' }],
            },
            final: true,
          },
        },
      }),
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'continue',
    });

    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.stateEntryActions, [{ id: 'final-entry' }]);
  });

  it('fails explicitly when stored player progress points at a missing state', function () {
    const player = createPlayer({
      conversations: {
        test: {
          actorPlanner: { state: 'missing' },
        },
      },
    });
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player,
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'CONVERSATION_RUNTIME_PERSISTED_STATE_MISSING');
  });

  it('does not silently reset to authored initial on invalid stored state', function () {
    const player = createPlayer({
      conversations: {
        test: {
          actorPlanner: { state: 'missing' },
        },
      },
    });
    const result = evaluateConversationRuntime({
      definition: createDefinition(),
      player,
      npcRef: 'test:actorPlanner',
    });

    assert.strictEqual(result.ok, false);
    assert.notStrictEqual(result.sourceState, 'greeting');
  });

  it('does not mutate player metadata when invalid stored state is encountered', function () {
    const player = createPlayer({
      conversations: {
        test: {
          actorPlanner: { state: 'missing' },
        },
      },
    });

    evaluateConversationRuntime({
      definition: createDefinition(),
      player,
      npcRef: 'test:actorPlanner',
    });

    assert.deepStrictEqual(player.metadata.conversations.test.actorPlanner, { state: 'missing' });
  });

  it('loaded definitions from the phase 2 service can be evaluated without a parallel loading path', function () {
    this.serviceState = createServiceState();
    const service = ensureConversationDefinitionService(this.serviceState);

    const outcome = service.getConversationDefinitionForNpc(
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/runtimeDefault.conversation.yml' } },
      { bundle: 'bundle-rantamuta', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'loaded');

    const result = evaluateConversationRuntime({
      definition: outcome.definition,
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      eventId: 'unknown',
      conditionEvaluator: createConditionEvaluator(['allow-default']),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.selectedEvent.eventId, 'default');
  });

  it('conversation runtime accepts branded frozen definition copies and does not mutate them', function () {
    this.serviceState = createServiceState();
    const service = ensureConversationDefinitionService(this.serviceState);

    const outcome = service.getConversationDefinitionForNpc(
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/runtimeOrdering.conversation.yml' } },
      { bundle: 'bundle-rantamuta', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'loaded');

    const frozenDefinition = deepFreeze(outcome.definition);
    const snapshot = JSON.stringify(frozenDefinition);
    const result = evaluateConversationRuntime({
      definition: frozenDefinition,
      player: createPlayer(),
      npcRef: 'test:actorPlanner',
      conditionEvaluator: createConditionEvaluator(['show-first', 'show-third']),
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(JSON.stringify(frozenDefinition), snapshot);
    assert.deepStrictEqual(result.visibleEvents.map(event => event.id), ['first', 'third']);
  });
});
