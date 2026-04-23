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
});
