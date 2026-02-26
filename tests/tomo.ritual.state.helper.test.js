// @ts-check
'use strict';

const assert = require('assert');
const ritualState = require('../areas/codex/scripts/helpers/ritualState');

function createContainer(entityReference, containsRefs) {
  return {
    entityReference,
    inventory: new Set((containsRefs || []).map(ref => ({ entityReference: ref })),
    ),
  };
}

function createStateFromBits(bits) {
  const hasWax = (bits & 0b001) !== 0;
  const hasStone = (bits & 0b010) !== 0;
  const hasClapper = (bits & 0b100) !== 0;

  const reliquary = createContainer('codex:reliquary', hasWax ? ['codex:waxSeal'] : []);
  const basin = createContainer('codex:stoneBasin', hasStone ? ['codex:prayerStone'] : []);
  const bell = createContainer('codex:crackedBell', hasClapper ? ['codex:bronzeClapper'] : []);

  return {
    ItemManager: {
      items: new Set([reliquary, basin, bell]),
    },
  };
}

describe('bundle-rantamuta codex ritualState helper', function () {
  it('returns deterministic ordered missing steps for all 8 placement combinations', function () {
    const expectedOrder = [
      'wax_seal_reliquary',
      'prayer_stone_basin',
      'bronze_clapper_bell',
    ];

    for (let bits = 0; bits < 8; bits += 1) {
      const state = createStateFromBits(bits);
      const result = ritualState.getRitualState(state);

      const expectedCompleted =
        Number((bits & 0b001) !== 0) +
        Number((bits & 0b010) !== 0) +
        Number((bits & 0b100) !== 0);

      assert.strictEqual(result.completedCount, expectedCompleted);
      assert.strictEqual(result.isComplete, expectedCompleted === 3);
      assert.ok(Array.isArray(result.missingSteps));

      const expectedMissing = expectedOrder.filter((_, index) => ((bits >> index) & 1) === 0);
      assert.deepStrictEqual(result.missingSteps.map(step => step.key), expectedMissing);
    }
  });

  it('matches containers/items by normalized entity ref', function () {
    const state = {
      ItemManager: {
        items: new Set([
          createContainer('  CoDeX:ReLiQuArY ', [' CODEX:WAXSEAL ']),
          createContainer('codex:stoneBasin', ['codex:prayerStone']),
          createContainer('codex:crackedBell', ['codex:bronzeClapper']),
        ]),
      },
    };

    const result = ritualState.getRitualState(state);
    assert.strictEqual(result.isComplete, true);
    assert.strictEqual(result.completedCount, 3);
    assert.deepStrictEqual(result.missingSteps, []);
  });
});
