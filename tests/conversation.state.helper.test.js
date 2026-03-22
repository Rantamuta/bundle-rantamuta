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
});
