'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { disposeConversationDefinitionService } = require('../lib/runtime/conversation/conversation-definition-service');
const { tryDirectedConversation } = require('../lib/runtime/conversation/directed-speech');

function createState(tempRoot, errors = []) {
  return {
    BundleManager: {
      bundlesPath: `${tempRoot}${path.sep}`,
    },
    Logger: {
      error(message) {
        errors.push(String(message));
      },
    },
  };
}

function createPlayer(metadata = {}) {
  return {
    name: 'Tester',
    metadata,
  };
}

function createNpc(metadata = {}, areaName = 'test') {
  return {
    id: 'actorPlanner',
    name: 'actor planner',
    entityReference: `${areaName}:actorPlanner`,
    metadata,
    room: {
      area: {
        bundle: 'bundle-test',
        name: areaName,
      },
    },
  };
}

function writeConversation(tempRoot, bodyLines, areaName = 'test') {
  const conversationPath = path.join(
    tempRoot,
    'bundle-test',
    'areas',
    areaName,
    'conversations',
    'actorPlanner.conversation.yml'
  );
  fs.mkdirSync(path.dirname(conversationPath), { recursive: true });
  fs.writeFileSync(conversationPath, `${bodyLines.join('\n')}\n`, 'utf8');
}

describe('bundle-rantamuta conversation directed speech facade', function () {
  afterEach(function () {
    if (this.state) {
      disposeConversationDefinitionService(this.state);
    }
  });

  it('exports one small facade entrypoint', function () {
    assert.strictEqual(typeof tryDirectedConversation, 'function');
  });

  it('returns null when the addressed npc has no conversation binding', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-directed-speech-'));
    const errors = [];
    const state = createState(tempRoot, errors);
    this.state = state;

    const result = tryDirectedConversation(state, createPlayer(), 'continue', createNpc({}));

    assert.strictEqual(result, null);
    assert.deepStrictEqual(errors, []);
  });

  it('falls through and relies on existing definition-service logging when the binding is broken', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-directed-speech-'));
    const errors = [];
    const state = createState(tempRoot, errors);
    this.state = state;

    const result = tryDirectedConversation(
      state,
      createPlayer(),
      'continue',
      createNpc({ conversation: 'conversations/missing.conversation.yml' })
    );

    assert.strictEqual(result, null);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /CONVERSATION_BINDING CONVERSATION_FILE_MISSING/);
  });

  it('returns null when the current state has no matching route for the spoken event', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-directed-speech-'));
    writeConversation(tempRoot, [
      'id: actor_planner',
      'initial: greeting',
      'states:',
      '  greeting:',
      '    events:',
      '      continue:',
      '        target: done',
      '  done:',
      '    final: true',
    ]);
    const errors = [];
    const state = createState(tempRoot, errors);
    this.state = state;

    const result = tryDirectedConversation(
      state,
      createPlayer(),
      'unknown',
      createNpc({ conversation: 'conversations/actorPlanner.conversation.yml' })
    );

    assert.strictEqual(result, null);
    assert.deepStrictEqual(errors, []);
  });

  it('returns a command-style envelope when the spoken event matches a conversation transition', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-directed-speech-'));
    writeConversation(tempRoot, [
      'id: actor_planner',
      'initial: greeting',
      'states:',
      '  greeting:',
      '    events:',
      '      continue:',
      '        target: done',
      '  done:',
      '    final: true',
    ]);
    const errors = [];
    const state = createState(tempRoot, errors);
    this.state = state;
    const player = createPlayer();

    const result = tryDirectedConversation(
      state,
      player,
      'continue',
      createNpc({ conversation: 'conversations/actorPlanner.conversation.yml' })
    );

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [
          {
            type: 'setPlayerMetadata',
            player,
            key: 'conversations.test.actorPlanner.state',
            value: 'done',
          },
        ],
      },
      render: {
        messages: [],
      },
    });
    assert.deepStrictEqual(errors, []);
  });

  it('lowers canonical authored instructions into command operations and render instructions', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-directed-speech-'));
    writeConversation(tempRoot, [
      'id: actor_planner',
      'initial: greeting',
      'states:',
      '  greeting:',
      '    events:',
      '      continue:',
      '        effects:',
      '          - broadcast:',
      '              audience: room',
      '              message: "Transition line."',
      '          - setWorldMetadata:',
      '              key: world.phase',
      '              value: 2',
      '        target: done',
      '  done:',
      '    onEntry:',
      '      effects:',
      '        - broadcast:',
      '            audience: room',
      '            message: "Entry line."',
    ]);
    const errors = [];
    const state = createState(tempRoot, errors);
    this.state = state;
    const player = createPlayer();

    const result = tryDirectedConversation(
      state,
      player,
      'continue',
      createNpc({ conversation: 'conversations/actorPlanner.conversation.yml' })
    );

    assert.deepStrictEqual(result.plan.operations, [
      {
        type: 'setWorldMetadata',
        key: 'world.phase',
        value: 2,
      },
      {
        type: 'setPlayerMetadata',
        player,
        key: 'conversations.test.actorPlanner.state',
        value: 'done',
      },
    ]);
    assert.deepStrictEqual(result.render.messages, [
      {
        type: 'broadcast',
        audience: 'room',
        message: 'Transition line.',
      },
      {
        type: 'broadcast',
        audience: 'room',
        message: 'Entry line.',
      },
    ]);
    assert.deepStrictEqual(errors, []);
  });

  it('logs and falls through when matched authored instructions cannot be resolved at runtime', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-directed-speech-'));
    writeConversation(tempRoot, [
      'id: actor_planner',
      'initial: greeting',
      'states:',
      '  greeting:',
      '    events:',
      '      continue:',
      '        effects:',
      '          - transferItem:',
      '              item: widget',
      '              from: inventory',
      '              to: player',
      '        target: done',
      '  done:',
      '    final: true',
    ]);
    const errors = [];
    const state = createState(tempRoot, errors);
    this.state = state;

    const result = tryDirectedConversation(
      state,
      createPlayer(),
      'continue',
      createNpc({ conversation: 'conversations/actorPlanner.conversation.yml' })
    );

    assert.strictEqual(result, null);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /CONVERSATION_DIRECTED_SPEECH AUTHORED_INSTRUCTION_REFERENCE_UNRESOLVED/);
  });
});
