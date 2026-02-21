// @ts-check
'use strict';

/**
 * Prevent removing the wax seal after it has been placed in the reliquary as
 * part of the Bell Tower ritual.
 */
function createCanDirect(waxSeal) {
  return (actor, verbId, context) => {
    void actor;

    if (verbId !== 'take') {
      return undefined;
    }

    const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : null;
    if (!resolution || resolution.ruleKey !== 'direct' || resolution.directTarget !== waxSeal) {
      return undefined;
    }

    const carriedBy = waxSeal.carriedBy && typeof waxSeal.carriedBy === 'object' ? waxSeal.carriedBy : null;
    const carrierRef = carriedBy && typeof carriedBy.entityReference === 'string'
      ? carriedBy.entityReference
      : '';

    if (carrierRef !== 'codex:reliquary') {
      return undefined;
    }

    return 'The seal is set into the reliquary. Removing it would break the rite.';
  };
}

function createSpawnListener() {
  return function onSpawn() {
    this.canDirect = createCanDirect(this);
  };
}

module.exports = {
  listeners: {
    spawn: () => createSpawnListener(),
  },
};
