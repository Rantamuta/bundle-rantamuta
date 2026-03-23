// @ts-check
'use strict';

const assert = require('assert');
const {
  clearConversationEngagement,
  getConversationEngagement,
  replaceConversationEngagement,
  setConversationEngagement,
} = require('../lib/session/conversation-engagement');

describe('bundle-rantamuta conversation engagement helper', function () {
  it('stores and reads engagement by runtime owner identity', function () {
    const session = { id: 'session-1' };
    const engagement = { npcRef: 'codex:tomo', menuRevision: 1 };

    setConversationEngagement(session, engagement);

    assert.deepStrictEqual(getConversationEngagement(session), engagement);
    clearConversationEngagement(session);
  });

  it('replaces engagement for the same owner and returns the previous value', function () {
    const session = { id: 'session-2' };
    const first = { npcRef: 'codex:tomo', menuRevision: 1 };
    const second = { npcRef: 'codex:tomo', menuRevision: 2 };

    setConversationEngagement(session, first);
    const previous = replaceConversationEngagement(session, second);

    assert.deepStrictEqual(previous, first);
    assert.deepStrictEqual(getConversationEngagement(session), second);
    clearConversationEngagement(session);
  });

  it('clears engagement without touching player metadata', function () {
    const player = {
      metadata: {
        conversations: {
          codex: {
            tomo: {
              state: 'greeting',
            },
          },
        },
      },
    };
    const session = { id: 'session-3', player };
    const before = JSON.stringify(player.metadata);

    setConversationEngagement(session, { npcRef: 'codex:tomo', menuRevision: 1 });
    clearConversationEngagement(session);

    assert.strictEqual(getConversationEngagement(session), undefined);
    assert.strictEqual(JSON.stringify(player.metadata), before);
  });

  it('keeps engagements isolated by owner identity', function () {
    const firstSession = { id: 'session-4a' };
    const secondSession = { id: 'session-4b' };

    setConversationEngagement(firstSession, { npcRef: 'forest:tomo' });
    setConversationEngagement(secondSession, { npcRef: 'rantamuta:tomo' });

    assert.deepStrictEqual(getConversationEngagement(firstSession), { npcRef: 'forest:tomo' });
    assert.deepStrictEqual(getConversationEngagement(secondSession), { npcRef: 'rantamuta:tomo' });

    clearConversationEngagement(firstSession);
    clearConversationEngagement(secondSession);
  });

  it('rejects missing runtime owner identity', function () {
    assert.throws(() => getConversationEngagement(null), /owner/);
    assert.throws(() => setConversationEngagement(null, { npcRef: 'codex:tomo' }), /owner/);
  });
});
