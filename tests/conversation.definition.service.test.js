// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ensureConversationDefinitionService,
  disposeConversationDefinitionService,
  _validateConversationDefinitions,
} = require('../lib/runtime/conversation/conversation-definition-service');

function createState(tempRoot) {
  return {
    BundleManager: {
      bundlesPath: `${tempRoot}${path.sep}`,
    },
  };
}

function createValidatorState(tempRoot, npcs, areaName = 'test') {
  return {
    ...createState(tempRoot),
    AreaFactory: {
      getDefinition(name) {
        if (name !== areaName) {
          return null;
        }

        return {
          bundle: 'bundle-test',
          name,
        };
      },
    },
    MobFactory: {
      entities: new Map(
        npcs.map((npc) => [`${areaName}:${npc.id}`, npc])
      ),
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

  it('uses grammatical fallback no-response text for unnamed NPCs', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);

    const outcome = service.resolveConversationBinding(
      { id: 'actorPlanner', metadata: { conversation: path.resolve(tempRoot, 'outside.conversation.yml') } },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'broken');
    assert.strictEqual(outcome.error.playerMessage, 'They have nothing to say.');

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

  it('loads a valid bound conversation definition into a deterministic runtime shape', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
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

    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);

    const outcome = service.getConversationDefinitionForNpc(
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'loaded');
    assert.deepStrictEqual(outcome.definition, {
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
      sourcePath: 'conversations/actorPlanner.conversation.yml',
      absolutePath: conversationPath,
      bundle: 'bundle-test',
      areaName: 'test',
    });

    disposeConversationDefinitionService(state);
  });

  it('reuses the cached loaded definition for repeated NPC lookups', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
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

    const state = createState(tempRoot);
    const service = ensureConversationDefinitionService(state);
    const npc = { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } };
    const area = { bundle: 'bundle-test', name: 'test' };

    const first = service.getConversationDefinitionForNpc(npc, area);
    const second = service.getConversationDefinitionForNpc(npc, area);

    assert.strictEqual(first.status, 'loaded');
    assert.strictEqual(first, second);

    disposeConversationDefinitionService(state);
  });

  it('logs a maintainer-facing error and returns only the generic no-response behavior for a broken configured path', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const logger = {
      errors: [],
      error(message) {
        this.errors.push(String(message));
      },
    };
    const state = {
      ...createState(tempRoot),
      Logger: logger,
    };
    const service = ensureConversationDefinitionService(state);

    const outcome = service.getConversationDefinitionForNpc(
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/missing.conversation.yml' } },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.strictEqual(outcome.status, 'broken');
    assert.strictEqual(outcome.error.code, 'CONVERSATION_FILE_MISSING');
    assert.strictEqual(outcome.error.playerMessage, 'actor planner has nothing to say.');
    assert.strictEqual(logger.errors.length, 1);
    assert.match(logger.errors[0], /CONVERSATION_BINDING CONVERSATION_FILE_MISSING/);

    disposeConversationDefinitionService(state);
  });

  it('does not log loader errors for an NPC with no metadata.conversation', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const logger = {
      errors: [],
      error(message) {
        this.errors.push(String(message));
      },
    };
    const state = {
      ...createState(tempRoot),
      Logger: logger,
    };
    const service = ensureConversationDefinitionService(state);

    const outcome = service.getConversationDefinitionForNpc(
      { id: 'actorPlanner', name: 'actor planner', metadata: {} },
      { bundle: 'bundle-test', name: 'test' }
    );

    assert.deepStrictEqual(outcome, { status: 'none' });
    assert.deepStrictEqual(logger.errors, []);

    disposeConversationDefinitionService(state);
  });

  it('recomputes cached broken player messages for each NPC lookup', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const logger = {
      errors: [],
      error(message) {
        this.errors.push(String(message));
      },
    };
    const state = {
      ...createState(tempRoot),
      Logger: logger,
    };
    const service = ensureConversationDefinitionService(state);
    const area = { bundle: 'bundle-test', name: 'test' };

    const first = service.getConversationDefinitionForNpc(
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/shared-missing.conversation.yml' } },
      area
    );
    const second = service.getConversationDefinitionForNpc(
      { id: 'actorGatekeeper', name: 'actor gatekeeper', metadata: { conversation: 'conversations/shared-missing.conversation.yml' } },
      area
    );

    assert.strictEqual(first.status, 'broken');
    assert.strictEqual(second.status, 'broken');
    assert.strictEqual(first.error.code, 'CONVERSATION_FILE_MISSING');
    assert.strictEqual(second.error.code, 'CONVERSATION_FILE_MISSING');
    assert.strictEqual(first.error.playerMessage, 'actor planner has nothing to say.');
    assert.strictEqual(second.error.playerMessage, 'actor gatekeeper has nothing to say.');
    assert.strictEqual(logger.errors.length, 1);

    disposeConversationDefinitionService(state);
  });

  it('returns no conversation validation findings for bundles with no conversation bindings', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const state = createValidatorState(tempRoot, [
      { id: 'actorPlanner', name: 'actor planner', metadata: {} },
    ]);

    const findings = _validateConversationDefinitions(state);

    assert.deepStrictEqual(findings, []);
    disposeConversationDefinitionService(state);
  });

  it('surfaces maintainer-facing findings for broken conversation bindings during bundle validation', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const areaRoot = path.join(tempRoot, 'bundle-test', 'areas', 'test');
    fs.mkdirSync(areaRoot, { recursive: true });

    const state = createValidatorState(tempRoot, [
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/missing.conversation.yml' } },
    ]);

    const findings = _validateConversationDefinitions(state);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].level, 'error');
    assert.strictEqual(findings[0].code, 'CONVERSATION_FILE_MISSING');
    assert.strictEqual(findings[0].bundle, 'bundle-test');
    assert.strictEqual(findings[0].area, 'test');
    assert.strictEqual(findings[0].path, 'conversations/missing.conversation.yml');
    assert.strictEqual(findings[0].detail.npcRef, 'test:actorPlanner');

    disposeConversationDefinitionService(state);
  });

  it('runs an evaluator-readiness pass for loaded conversation definitions during bundle validation', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
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

    const state = createValidatorState(tempRoot, [
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } },
    ]);

    const findings = _validateConversationDefinitions(state);

    assert.deepStrictEqual(findings, []);
    disposeConversationDefinitionService(state);
  });

  it('surfaces evaluator-readiness failures during bundle validation', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
    const areaRoot = path.join(tempRoot, 'bundle-test', 'areas', 'test');
    const conversationPath = path.join(areaRoot, 'conversations', 'actorPlanner.conversation.yml');
    fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
    fs.writeFileSync(conversationPath, [
      'id: actor_planner',
      'initial: greeting',
      'states:',
      '  greeting: malformed',
      '  done:',
      '    final: true',
      '',
    ].join('\n'), 'utf8');

    const state = createValidatorState(tempRoot, [
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } },
    ]);

    const findings = _validateConversationDefinitions(state);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].level, 'error');
    assert.strictEqual(findings[0].code, 'CONVERSATION_RUNTIME_STATE_MISSING');
    assert.strictEqual(findings[0].bundle, 'bundle-test');
    assert.strictEqual(findings[0].area, 'test');
    assert.strictEqual(findings[0].path, 'conversations/actorPlanner.conversation.yml');

    disposeConversationDefinitionService(state);
  });

  it('surfaces shared authored-instructions validation failures during bundle validation', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
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
      '        actions:',
      '          - messageRoom: "Hello."',
      '        target: done',
      '  done:',
      '    final: true',
      '',
    ].join('\n'), 'utf8');

    const state = createValidatorState(tempRoot, [
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } },
    ]);

    const findings = _validateConversationDefinitions(state);

    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].level, 'error');
    assert.strictEqual(findings[0].code, 'CONVERSATION_DEFINITION_INVALID');
    assert.strictEqual(findings[0].bundle, 'bundle-test');
    assert.strictEqual(findings[0].area, 'test');
    assert.strictEqual(findings[0].path, 'conversations/actorPlanner.conversation.yml');
    assert.deepStrictEqual(findings[0].detail.errors.map(error => error.code), [
      'AUTHORED_INSTRUCTION_UNSUPPORTED',
    ]);

    disposeConversationDefinitionService(state);
  });

  it('uses the same conversation loading path as runtime use during bundle validation', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-service-'));
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

    const state = createValidatorState(tempRoot, [
      { id: 'actorPlanner', name: 'actor planner', metadata: { conversation: 'conversations/actorPlanner.conversation.yml' } },
    ]);
    const service = ensureConversationDefinitionService(state);
    const originalGetConversationDefinitionForNpc = service.getConversationDefinitionForNpc.bind(service);
    let callCount = 0;

    service.getConversationDefinitionForNpc = function wrappedGetConversationDefinitionForNpc(npc, area) {
      callCount += 1;
      return originalGetConversationDefinitionForNpc(npc, area);
    };

    const findings = _validateConversationDefinitions(state);

    assert.deepStrictEqual(findings, []);
    assert.strictEqual(callCount, 1);

    disposeConversationDefinitionService(state);
  });
});
