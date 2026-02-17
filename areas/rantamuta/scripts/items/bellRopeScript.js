// @ts-check
'use strict';

const CRACKED_BELL_REF = 'rantamuta:crackedBell';
const BRONZE_CLAPPER_REF = 'rantamuta:bronzeClapper';
const BELL_TOLL_AREA_MESSAGE = 'A resonant chime rolls out from the bell tower.';

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} collection
 * @returns {Array<*>}
 */
function toArray(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection.values === 'function') {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === 'function') {
    return Array.from(collection);
  }

  return [];
}

/**
 * @param {*} state
 * @param {string} entityRef
 * @returns {* | null}
 */
function findItemByEntityRef(state, entityRef) {
  const needle = normalizeRef(entityRef);
  if (!needle) {
    return null;
  }

  const manager = state && state.ItemManager;
  const items = manager && manager.items;

  for (const item of toArray(items)) {
    if (normalizeRef(item && item.entityReference) === needle) {
      return item;
    }
  }

  return null;
}

/**
 * @param {*} container
 * @param {string} itemRef
 * @returns {boolean}
 */
function containerHasItemRef(container, itemRef) {
  const needle = normalizeRef(itemRef);
  if (!needle) {
    return false;
  }

  const inventory = container && container.inventory;
  for (const item of toArray(inventory)) {
    if (normalizeRef(item && item.entityReference) === needle) {
      return true;
    }
  }

  return false;
}

/**
 * @param {*} action
 * @param {*} context
 * @param {*} rope
 * @returns {boolean}
 */
function isDirectPullOnThis(action, context, rope) {
  if (!action || typeof action !== 'object' || action.verbId !== 'pull' || action.role !== 'direct') {
    return false;
  }

  const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
    ? context.entityResolution
    : null;

  return !!resolution &&
    resolution.ruleKey === 'direct' &&
    resolution.directTarget === rope;
}

/**
 * @param {*} state
 * @returns {boolean}
 */
function bellHasClapper(state) {
  const crackedBell = findItemByEntityRef(state, CRACKED_BELL_REF);
  if (!crackedBell) {
    return false;
  }

  return containerHasItemRef(crackedBell, BRONZE_CLAPPER_REF);
}

module.exports = {
  listeners: {
    spawn: state => function onSpawn() {
      this.pullSuccessMessage = () => {
        if (bellHasClapper(state)) {
          return {
            type: 'semanticEvent',
            template: '{actor.You} {verb:pull} down on {object.direct}, and the bell tolls cheerfully.',
            audiencePolicy: 'self_and_others',
            participants: {
              actor: { selector: 'currentPlayer' },
            },
            objectText: {
              direct: 'the bell rope',
            },
          };
        }

        return {
          type: 'semanticEvent',
          template: '{actor.You} {verb:haul} down on {object.direct}, but only a distant, mournful clack answers.',
          audiencePolicy: 'self_and_others',
          participants: {
            actor: { selector: 'currentPlayer' },
          },
          objectText: {
            direct: 'the bell rope',
          },
        };
      };

      this.bubbleEvent = (action, context) => {
        if (!isDirectPullOnThis(action, context, this)) {
          return null;
        }

        if (!bellHasClapper(state)) {
          return null;
        }

        return {
          render: {
            messages: [
              {
                type: 'broadcast',
                audience: 'area',
                targetSelector: 'currentArea',
                message: BELL_TOLL_AREA_MESSAGE,
              },
            ],
          },
        };
      };
    },
  },
};
