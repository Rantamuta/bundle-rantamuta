// @ts-check
'use strict';

/**
 * Prevent removing the bronze clapper after it has been placed in the cracked
 * bell as part of the Bell Tower ritual.
 */
function createCanDirect(clapper) {
  return (actor, verbId, context) => {
    void actor;

    if (verbId !== 'take') {
      return undefined;
    }

    const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
      ? context.entityResolution
      : null;
    if (!resolution || resolution.ruleKey !== 'direct' || resolution.directTarget !== clapper) {
      return undefined;
    }

    const carriedBy = clapper.carriedBy && typeof clapper.carriedBy === 'object' ? clapper.carriedBy : null;
    const carrierRef = carriedBy && typeof carriedBy.entityReference === 'string'
      ? carriedBy.entityReference
      : '';

    if (carrierRef !== 'codex:crackedBell') {
      return undefined;
    }

    return 'The clapper is locked into position. Removing it would undo the balance.';
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
