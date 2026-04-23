'use strict';

const assert = require('assert');

const {
  createConversationConditionEvaluator,
  parseQueryObjectCondition,
} = require('../lib/runtime/conversation/conversation-condition-evaluator');

describe('bundle-rantamuta conversation condition evaluator', function () {
  it('exports a conversation-owned condition evaluator factory', function () {
    assert.strictEqual(typeof createConversationConditionEvaluator, 'function');

    const conditionEvaluator = createConversationConditionEvaluator();

    assert.strictEqual(typeof conditionEvaluator, 'function');
  });

  it('accepts the narrow single-key declarative query-object condition shape', function () {
    assert.deepStrictEqual(parseQueryObjectCondition({ actorHasItem: 'test:brassKey' }), {
      methodName: 'actorHasItem',
      args: ['test:brassKey'],
    });
  });

  it('accepts array values as ordered query arguments', function () {
    assert.deepStrictEqual(parseQueryObjectCondition({ roomHasItem: ['test:start', 'test:apple'] }), {
      methodName: 'roomHasItem',
      args: ['test:start', 'test:apple'],
    });
  });

  it('calls the same-named q facade method with the condition value as arguments', function () {
    const conditionEvaluator = createConversationConditionEvaluator();
    const calls = [];
    const q = {
      roomHasItem(roomRef, itemRef) {
        calls.push({ roomRef, itemRef });
        return true;
      },
    };

    const result = conditionEvaluator({ roomHasItem: ['test:start', 'test:apple'] }, { q });

    assert.strictEqual(result, true);
    assert.deepStrictEqual(calls, [
      { roomRef: 'test:start', itemRef: 'test:apple' },
    ]);
  });

  it('returns true only for exact true query results', function () {
    const conditionEvaluator = createConversationConditionEvaluator();

    assert.strictEqual(conditionEvaluator({ actorHasItem: 'test:key' }, { q: { actorHasItem: () => true } }), true);
    assert.strictEqual(conditionEvaluator({ actorHasItem: 'test:key' }, { q: { actorHasItem: () => false } }), false);
    assert.strictEqual(conditionEvaluator({ actorHasItem: 'test:key' }, { q: { actorHasItem: () => 'true' } }), false);
    assert.strictEqual(conditionEvaluator({ actorHasItem: 'test:key' }, { q: { actorHasItem: () => 1 } }), false);
    assert.strictEqual(conditionEvaluator({ actorHasItem: 'test:key' }, { q: { actorHasItem: () => undefined } }), false);
  });
});
