// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureConversationDefinitionService,
  disposeConversationDefinitionService,
  getConversationDefinitionService,
  primeConversationDefinitions,
} = require('../lib/runtime/conversation/conversation-definition-service');
const conversationServerEvent = require('../server-events/conversation');

function createState(tempRoot, logger) {
  return {
    BundleManager: {
      bundlesPath: `${tempRoot}${path.sep}`,
    },
    Logger: logger,
    MobFactory: {
      entities: new Map(),
    },
    AreaFactory: {
      getDefinition(areaName) {
        return areaName === 'test'
          ? { bundle: 'bundle-test' }
          : null;
      },
    },
  };
}

describe('bundle-rantamuta conversation definition startup', function () {
  it('primes configured NPC conversation definitions and reports broken bindings', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-prime-'));
    const areaRoot = path.join(tempRoot, 'bundle-test', 'areas', 'test');
    const conversationPath = path.join(areaRoot, 'conversations', 'actorPlanner.conversation.yml');
    fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
    fs.writeFileSync(conversationPath, [
      'id: actor_planner',
      'initial: greeting',
      'states:',
      '  greeting:',
      '    events:',
      '      continue:',
      '        target: done',
      '  done:',
      '    final: true',
      '',
    ].join('\n'), 'utf8');

    const logger = {
      errors: [],
      error(message) {
        this.errors.push(String(message));
      },
    };
    const state = createState(tempRoot, logger);
    state.MobFactory.entities.set('test:actorPlanner', {
      id: 'actorPlanner',
      name: 'actor planner',
      metadata: {
        conversation: 'conversations/actorPlanner.conversation.yml',
      },
    });
    state.MobFactory.entities.set('test:actorGatekeeper', {
      id: 'actorGatekeeper',
      name: 'actor gatekeeper',
      metadata: {
        conversation: 'conversations/missing.conversation.yml',
      },
    });

    const findings = primeConversationDefinitions(state);
    const service = getConversationDefinitionService(state);
    const loaded = service.getConversationDefinitionForNpc(
      state.MobFactory.entities.get('test:actorPlanner'),
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.strictEqual(loaded.status, 'loaded');
    assert.deepStrictEqual(findings, [
      {
        npcRef: 'test:actorGatekeeper',
        code: 'CONVERSATION_FILE_MISSING',
        message: 'Conversation file "conversations/missing.conversation.yml" does not exist for area "bundle-test:test".',
      },
    ]);
    assert.strictEqual(logger.errors.length, 1);
    assert.match(logger.errors[0], /CONVERSATION_BINDING CONVERSATION_FILE_MISSING/);

    disposeConversationDefinitionService(state);
  });

  it('startup/shutdown listeners manage the conversation definition service lifecycle', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-prime-'));
    const logger = {
      errors: [],
      error(message) {
        this.errors.push(String(message));
      },
    };
    const state = createState(tempRoot, logger);
    const startup = conversationServerEvent.listeners.startup(state);
    const shutdown = conversationServerEvent.listeners.shutdown(state);

    startup();
    const first = ensureConversationDefinitionService(state);
    shutdown();
    const second = ensureConversationDefinitionService(state);

    assert.notStrictEqual(first, second);

    disposeConversationDefinitionService(state);
  });
});
