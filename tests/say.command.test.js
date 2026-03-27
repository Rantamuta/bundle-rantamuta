// @ts-check
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sayCommand = require('../commands/say');
const { parseInput } = require('../lib/parse-input');
const EntityResolution = require('../lib/runtime/command/entity-resolution');
const { disposeConversationDefinitionService } = require('../lib/runtime/conversation/conversation-definition-service');

function createPlayer(def = {}) {
  return {
    room: def.room || null,
    metadata: def.metadata || {},
  };
}

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

function createConversationNpc(metadata = {}, areaName = 'test') {
  return {
    uuid: 'npc-tomo',
    id: 'actorPlanner',
    name: 'Bell Keeper Tomo',
    keywords: ['tomo', 'keeper'],
    isNpc: true,
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

describe('bundle-rantamuta say command', function () {
  afterEach(function () {
    if (this.state) {
      disposeConversationDefinitionService(this.state);
    }
  });

  it('declares addressed and free-text syntax rules in declaration order', function () {
    assert.ok(sayCommand.metadata);
    assert.deepStrictEqual(sayCommand.metadata.syntaxRules, [
      'TEXT to LIVING',
      'TEXT',
      '(empty)',
    ]);
    assert.ok(Array.isArray(sayCommand.metadata.compiledRules));
  });

  it('entity-resolution binds addressed speech to an indirect living target', function () {
    const tomo = {
      uuid: 'npc-tomo',
      name: 'Bell Keeper Tomo',
      keywords: ['tomo', 'keeper'],
      isNpc: true,
    };
    const player = {
      room: { npcs: new Set([tomo]) },
      inventory: new Map(),
    };

    const result = EntityResolution.resolveEntityContext({}, sayCommand, player, parseInput('say hello there to tomo'));

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.strictEqual(result.value.matchedRuleText, 'TEXT to LIVING');
    assert.strictEqual(result.value.indirectTarget, tomo);
    assert.strictEqual(result.value.relationTokenCanonical, 'to');
    assert.strictEqual(result.value.slots[0].surface, 'hello there');
  });

  it('returns SAY_EMPTY veto for empty normalized speech', function () {
    assert.ok(Array.isArray(sayCommand.metadata.captureChecks));
    const check = sayCommand.metadata.captureChecks[0];
    assert.strictEqual(typeof check, 'function');

    const result = check({
      parsedInput: {
        normalizedInput: 'say      ',
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      code: 'SAY_EMPTY',
    });
  });

  it('returns SAY_TOO_LONG veto when normalized speech exceeds 256 chars', function () {
    const check = sayCommand.metadata.captureChecks[0];
    const overLimit = `${'x'.repeat(257)}`;
    const result = check({
      parsedInput: {
        normalizedInput: `say ${overLimit}`,
      },
    });

    assert.deepStrictEqual(result, {
      ok: false,
      code: 'SAY_TOO_LONG',
    });
  });

  it('uses the matched TEXT slot for addressed speech output', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });
    const tomo = createConversationNpc({});

    const result = execute('hello there to tomo', player, null, {
      entityResolution: {
        matchedRuleText: 'TEXT to LIVING',
        indirectTarget: tomo,
        relationTokenCanonical: 'to',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 2,
            tokens: ['hello', 'there'],
            surface: 'hello there',
            status: 'resolved',
          },
          {
            kind: 'LIVING',
            role: 'indirect',
            start: 3,
            end: 4,
            tokens: ['tomo'],
            surface: 'tomo',
            status: 'resolved',
            selected: tomo,
            candidates: [tomo],
          },
        ],
      },
    });

    assert.strictEqual(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: [
          {
            type: 'semanticEvent',
            template: '{actor.you} {verb:say}, "{object.direct}" to {target.you}.',
            audiencePolicy: 'self_target_and_others',
            participants: {
              actor: { selector: 'currentActor' },
              target: { selector: 'entityByContextRole', role: 'indirectTarget' },
            },
            objectText: {
              direct: 'hello there',
            },
          },
        ],
      },
    });
  });

  it('sanitizes whitespace and returns semanticEvent success envelope with noop plan', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    const result = execute('   hello\n\n   there\tfriend   ', player, null, {
      entityResolution: {
        matchedRuleText: 'TEXT',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 3,
            tokens: ['hello', 'there', 'friend'],
            surface: 'hello there friend',
            status: 'resolved',
          },
        ],
      },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: [
          {
            type: 'semanticEvent',
            template: '{actor.you} {verb:say}, "{object.direct}"',
            audiencePolicy: 'self_and_others',
            participants: {
              actor: { selector: 'currentActor' },
            },
            objectText: {
              direct: 'hello there friend',
            },
          },
        ],
      },
    });
  });

  it('routes addressed speech through conversation handling when the spoken event matches', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'say-command-conversation-'));
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
    const execute = sayCommand.command(state);
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });
    const tomo = createConversationNpc({
      conversation: 'conversations/actorPlanner.conversation.yml',
    });

    const result = execute('continue to tomo', player, null, {
      entityResolution: {
        matchedRuleText: 'TEXT to LIVING',
        indirectTarget: tomo,
        relationTokenCanonical: 'to',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 1,
            tokens: ['continue'],
            surface: 'continue',
            status: 'resolved',
          },
          {
            kind: 'LIVING',
            role: 'indirect',
            start: 2,
            end: 3,
            tokens: ['tomo'],
            surface: 'tomo',
            status: 'resolved',
            selected: tomo,
            candidates: [tomo],
          },
        ],
      },
    });

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

  it('falls through to ordinary addressed speech when no conversation route matches', function () {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'say-command-conversation-'));
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
    const execute = sayCommand.command(state);
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });
    const tomo = createConversationNpc({
      conversation: 'conversations/actorPlanner.conversation.yml',
    });

    const result = execute('unknown to tomo', player, null, {
      entityResolution: {
        matchedRuleText: 'TEXT to LIVING',
        indirectTarget: tomo,
        relationTokenCanonical: 'to',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 1,
            tokens: ['unknown'],
            surface: 'unknown',
            status: 'resolved',
          },
          {
            kind: 'LIVING',
            role: 'indirect',
            start: 2,
            end: 3,
            tokens: ['tomo'],
            surface: 'tomo',
            status: 'resolved',
            selected: tomo,
            candidates: [tomo],
          },
        ],
      },
    });

    assert.deepStrictEqual(result, {
      ok: true,
      plan: {
        operations: [{ type: 'noop' }],
      },
      render: {
        messages: [
          {
            type: 'semanticEvent',
            template: '{actor.you} {verb:say}, "{object.direct}" to {target.you}.',
            audiencePolicy: 'self_target_and_others',
            participants: {
              actor: { selector: 'currentActor' },
              target: { selector: 'entityByContextRole', role: 'indirectTarget' },
            },
            objectText: {
              direct: 'unknown',
            },
          },
        ],
      },
    });
    assert.deepStrictEqual(errors, []);
  });

  it('throws when say is invoked without matchedRuleText and only legacy ruleKey is present', function () {
    const execute = sayCommand.command({});
    const player = createPlayer({
      room: { title: 'Room', description: 'Desc' },
    });

    assert.throws(() => execute('hello there', player, null, {
      entityResolution: {
        ruleKey: 'indirect',
        slots: [
          {
            kind: 'TEXT',
            role: null,
            start: 0,
            end: 2,
            tokens: ['hello', 'there'],
            surface: 'hello there',
            status: 'resolved',
          },
        ],
      },
    }), /matchedRuleText/);
  });
});
