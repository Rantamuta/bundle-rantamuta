// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureConversationDefinitionService,
  disposeConversationDefinitionService,
} = require('../lib/session/conversation-definition-service');

function createState(tempRoot) {
  return {
    BundleManager: {
      bundlesPath: `${tempRoot}${path.sep}`,
    },
  };
}

describe('bundle-rantamuta conversation definition service', function () {
  it('returns the same service instance for repeated ensure calls on the same state', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const state = createState(tempRoot);

    const first = ensureConversationDefinitionService(state);
    const second = ensureConversationDefinitionService(state);

    assert.strictEqual(first, second);

    disposeConversationDefinitionService(state);
  });

  it('treats absent metadata.conversation as a deterministic no-conversation outcome', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);

    const outcome = service.resolveConversationBinding(
      { id: 'actorPlanner', metadata: {} },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.deepStrictEqual(outcome, {
      status: 'none',
    });

    disposeConversationDefinitionService(state);
  });

  it('rejects absolute metadata.conversation paths as broken bindings', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);

    const outcome = service.resolveConversationBinding(
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: path.resolve(tempRoot, 'outside.conversation.yml') } },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'broken');
    assert.strictEqual(outcome.error.code, 'CONVERSATION_BINDING_ABSOLUTE_PATH');
    assert.strictEqual(outcome.error.playerMessage, 'actor planner has nothing to say.');

    disposeConversationDefinitionService(state);
  });

  it('rejects metadata.conversation traversal outside the NPC area directory', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);

    const outcome = service.resolveConversationBinding(
      { id: 'actorPlanner', metadata: { conversation: '../outside.conversation.yml' }, name: 'actor planner' },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'broken');
    assert.strictEqual(outcome.error.code, 'CONVERSATION_BINDING_OUTSIDE_AREA');
    assert.strictEqual(outcome.error.playerMessage, 'actor planner has nothing to say.');

    disposeConversationDefinitionService(state);
  });

  it('resolves a relative metadata.conversation path only within the NPC area directory', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const areaRoot = path.join(tempRoot, 'bundle-test', 'areas', 'test');
    fs.mkdirSync(path.join(areaRoot, 'conversations'), { recursive: true });

    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);

    const outcome = service.resolveConversationBinding(
      { id: 'actorPlanner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.deepStrictEqual(outcome, {
      status: 'bound',
      binding: {
        relativePath: 'conversations/actorPlanner.conversation.yml',
        absolutePath: path.join(areaRoot, 'conversations', 'actorPlanner.conversation.yml'),
        areaPath: areaRoot,
        bundle: 'bundle-test',
        areaName: 'test',
      },
    });

    disposeConversationDefinitionService(state);
  });
});
