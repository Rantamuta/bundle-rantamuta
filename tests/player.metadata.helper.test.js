// @ts-check
'use strict';

const assert = require('assert');
const { getPlayerMetadata } = require('../lib/runtime/mutation/player-metadata');

describe('bundle-rantamuta player metadata helper', function () {
  it('returns default when player is null', function () {
    assert.strictEqual(getPlayerMetadata(null, 'tomo.introShown', false), false);
  });

  it('returns default when metadata path is missing', function () {
    const player = { metadata: {} };
    assert.strictEqual(getPlayerMetadata(player, 'tomo.introShown', false), false);
  });

  it('reads nested metadata path by dot notation', function () {
    const player = {
      metadata: {
        tomo: {
          introShown: true,
        },
      },
    };

    assert.strictEqual(getPlayerMetadata(player, 'tomo.introShown', false), true);
  });

  it('does not mutate metadata on read of missing path', function () {
    const player = { metadata: {} };
    const before = JSON.stringify(player.metadata);

    assert.strictEqual(getPlayerMetadata(player, 'tomo.progress.lastHintAt', 0), 0);

    const after = JSON.stringify(player.metadata);
    assert.strictEqual(after, before);
  });
});
