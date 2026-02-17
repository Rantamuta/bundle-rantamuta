// @ts-check
'use strict';

/**
 * Prevent removing the prayer stone after it has been placed in the stone
 * basin as part of the Bell Tower ritual.
 */
function createAllowAction(prayerStone) {
  return (action, context) => {
    if (!action || typeof action !== 'object' || action.verbId !== 'take' || action.role !== 'direct') {
      return undefined;
    }

    const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : null;
    if (!resolution || resolution.ruleKey !== 'direct' || resolution.directTarget !== prayerStone) {
      return undefined;
    }

    const carriedBy = prayerStone.carriedBy && typeof prayerStone.carriedBy === 'object' ? prayerStone.carriedBy : null;
    const carrierRef = carriedBy && typeof carriedBy.entityReference === 'string'
      ? carriedBy.entityReference
      : '';

    if (carrierRef !== 'rantamuta:stoneBasin') {
      return undefined;
    }

    return 'The basin holds the stone as if in quiet guardianship. You cannot remove it.';
  };
}

function createSpawnListener() {
  return function onSpawn() {
    this.allowAction = createAllowAction(this);
  };
}

module.exports = {
  listeners: {
    spawn: state => createSpawnListener(state),
  },
};
