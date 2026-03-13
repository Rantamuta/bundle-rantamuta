// @ts-check
'use strict';

/**
 * @param {*} value
 * @returns {Record<string, *>}
 */
function asObject(value) {
  return value && typeof value === 'object'
    ? /** @type {Record<string, *>} */ (value)
    : {};
}

/**
 * @param {*} npc
 * @returns {Record<string, *>}
 */
function readConfig(npc) {
  return asObject(asObject(npc && npc.metadata).actorHarness);
}

/**
 * @param {*} npc
 * @returns {function(*, string, Record<string, *>): *}
 */
function createCanActor(npc) {
  return (actor, verbId, context) => {
    void context;

    const config = readConfig(npc);
    const denyVerb = String(config.denyVerb || '').trim();
    if (!denyVerb || verbId !== denyVerb) {
      return null;
    }

    const message = String(config.denyMessage || '').trim();
    return {
      allow: false,
      message: message || 'The harness gate refuses that verb.',
      details: {
        source: 'test.actorHookHarness',
      },
    };
  };
}

/**
 * @param {*} npc
 * @returns {function(*, string, Record<string, *>): *}
 */
function createPlanActor(npc) {
  return (actor, verbId, context) => {
    void context;

    const config = readConfig(npc);
    const planVerb = String(config.planVerb || '').trim();
    if (!planVerb || verbId !== planVerb) {
      return null;
    }

    const contribution = {};
    const planMessage = String(config.planMessage || '').trim();
    if (planMessage) {
      contribution.render = {
        messages: [planMessage],
      };
    }

    const roomMetadataKey = String(config.roomMetadataKey || '').trim();
    if (roomMetadataKey) {
      contribution.plan = {
        operations: [
          {
            type: 'setRoomMetadata',
            actor,
            key: roomMetadataKey,
            value: config.roomMetadataValue,
          },
        ],
      };
    }

    return Object.keys(contribution).length > 0 ? contribution : null;
  };
}

/**
 * @returns {function(): void}
 */
function createSpawnListener() {
  return function onSpawn() {
    this.canActor = createCanActor(this);
    this.planActor = createPlanActor(this);
  };
}

module.exports = {
  listeners: {
    spawn: () => createSpawnListener(),
  },
};
