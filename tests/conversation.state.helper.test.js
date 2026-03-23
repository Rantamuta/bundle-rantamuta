// @ts-check
'use strict';

const assert = require('assert');
const { applyMutationInstruction } = require('../lib/session/mutator');
const {
  createSetConversationStateInstruction,
  getConversationNpcPath,
  getConversationNpcIdentity,
  getConversationState,
  getConversationStatePath,
} = require('../lib/session/conversation-state');

describe('bundle-rantamuta conversation state helper', function () {
  it('derives area and npc identity from npcRef', function () {
    assert.deepStrictEqual(getConversationNpcIdentity('codex:tomo'), {
      areaId: 'codex',
      npcId: 'tomo',
    });
  });

  it('derives nested conversation paths from npcRef', function () {
    assert.strictEqual(getConversationNpcPath('codex:tomo'), 'conversations.codex.tomo');
    assert.strictEqual(getConversationStatePath('codex:tomo'), 'conversations.codex.tomo.state');
  });

  it('keeps same-named NPC ids in different areas on different persistence paths', function () {
    assert.strictEqual(getConversationStatePath('forest:tomo'), 'conversations.forest.tomo.state');
    assert.strictEqual(getConversationStatePath('rantamuta:tomo'), 'conversations.rantamuta.tomo.state');
    assert.notStrictEqual(getConversationStatePath('forest:tomo'), getConversationStatePath('rantamuta:tomo'));
  });

  it('reads stored conversation state without mutating metadata', function () {
    const player = {
      metadata: {
        conversations: {
          codex: {
            tomo: {
              state: 'greeting',
              visited: ['hello'],
            },
          },
        },
      },
    };
    const before = JSON.stringify(player.metadata);

    assert.strictEqual(getConversationState(player, 'codex:tomo'), 'greeting');
    assert.strictEqual(JSON.stringify(player.metadata), before);
  });

  it('returns undefined when conversation state is absent and does not mutate metadata', function () {
    const player = {
      metadata: {
        conversations: {
          codex: {},
        },
      },
    };
    const before = JSON.stringify(player.metadata);

    assert.strictEqual(getConversationState(player, 'codex:tomo'), undefined);
    assert.strictEqual(JSON.stringify(player.metadata), before);
  });

  it('creates setPlayerMetadata instructions that target only the state leaf', function () {
    const player = { metadata: {} };

    const instruction = createSetConversationStateInstruction(player, 'codex:tomo', 'greeting');

    assert.deepStrictEqual(instruction, {
      type: 'setPlayerMetadata',
      player,
      key: 'conversations.codex.tomo.state',
      value: 'greeting',
    });
  });

  it('rejects undefined conversation state writes so absence is not persisted ambiguously', function () {
    const player = { metadata: {} };

    assert.throws(() => {
      createSetConversationStateInstruction(player, 'codex:tomo', undefined);
    }, /must not be undefined/);
  });

  it('rejects non-string conversation state writes so persisted state remains a state id', function () {
    const player = { metadata: {} };

    assert.throws(() => {
      createSetConversationStateInstruction(player, 'codex:tomo', { state: 'greeting' });
    }, /must be a string/);

    assert.throws(() => {
      createSetConversationStateInstruction(player, 'codex:tomo', ['greeting']);
    }, /must be a string/);
  });

  it('preserves the per-npc object root for future sibling fields when applying the instruction', function () {
    const player = { metadata: {} };
    const instruction = createSetConversationStateInstruction(player, 'codex:tomo', 'greeting');

    applyMutationInstruction({}, instruction);

    assert.deepStrictEqual(player.metadata, {
      conversations: {
        codex: {
          tomo: {
            state: 'greeting',
          },
        },
      },
    });
  });

  it('keeps persisted state for same-named NPC ids independent across areas', function () {
    const player = { metadata: {} };

    applyMutationInstruction({}, createSetConversationStateInstruction(player, 'forest:tomo', 'warning'));
    applyMutationInstruction({}, createSetConversationStateInstruction(player, 'rantamuta:tomo', 'greeting'));

    assert.strictEqual(getConversationState(player, 'forest:tomo'), 'warning');
    assert.strictEqual(getConversationState(player, 'rantamuta:tomo'), 'greeting');
  });

  it('rejects npcRef values that do not have exactly one separator', function () {
    assert.throws(() => getConversationNpcIdentity('tomo'), /<areaId>:<npcId>/);
    assert.throws(() => getConversationNpcIdentity('codex:tomo:extra'), /<areaId>:<npcId>/);
  });

  it('rejects npcRef values that would produce unsafe metadata path segments', function () {
    assert.throws(() => getConversationNpcIdentity('codex:__proto__'), /safe metadata path segments/);
    assert.throws(() => getConversationNpcIdentity('__proto__:tomo'), /safe metadata path segments/);
  });

  it('does not fall back to display name or runtime uuid objects when npcRef is invalid', function () {
    assert.throws(() => getConversationNpcIdentity({ entityReference: 'codex:tomo', name: 'Tomo', uuid: 'npc-123' }), /must be a string/);
  });
});
