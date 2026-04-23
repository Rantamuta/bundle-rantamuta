'use strict';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseQueryObjectCondition(condition) {
  if (!isPlainObject(condition)) {
    throw new Error('Conversation condition must be a query object.');
  }

  const keys = Object.keys(condition);
  if (keys.length !== 1) {
    throw new Error('Conversation condition must contain exactly one query key.');
  }

  const methodName = keys[0];
  const value = condition[methodName];
  const args = Array.isArray(value) ? value : [value];

  return { methodName, args };
}

function evaluateQueryObjectCondition(condition, context = {}) {
  const { methodName, args } = parseQueryObjectCondition(condition);
  const q = context.q;

  if (!q || typeof q[methodName] !== 'function') {
    throw new Error(`Conversation condition requires q.${methodName}(...).`);
  }

  return q[methodName](...args) === true;
}

function createConversationConditionEvaluator() {
  return function conversationConditionEvaluator(condition, context) {
    return evaluateQueryObjectCondition(condition, context);
  };
}

module.exports = {
  createConversationConditionEvaluator,
  evaluateQueryObjectCondition,
  parseQueryObjectCondition,
};
