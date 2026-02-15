// @ts-check
'use strict';

/**
 * Ritual Put Target
 * -----------------
 *
 * This script is attached to puzzle containers like:
 * - cracked bell
 * - reliquary
 * - stone basin
 *
 * Designer goal:
 * - Accept one specific offering item (for example: bronze clapper in cracked bell).
 * - Reject wrong offerings with a clear, authored message.
 * - Emit a flavor line on successful correct placement.
 * - Optionally update the object's long description based on whether the
 *   correct offering is currently inside the container.
 *
 * Pipeline goal:
 * - Do not mutate world state in capture/target hooks.
 * - Only contribute policy decisions (allowAction) and reaction output
 *   (bubbleEvent). Actual item movement is still handled by the mutator/commit.
 */
const {
  acceptsDirectTarget,
  getPutPolicy,
  isPutToIndirectTarget,
} = require('../helpers/putPolicy');

/**
 * Normalize entity refs and metadata values so comparisons are predictable.
 *
 * Why this exists:
 * Designers write refs in YAML, and case/spacing differences are easy to make.
 * Normalizing here makes matching robust and deterministic.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Return inventory contents as a plain array for easy iteration.
 *
 * Why this exists:
 * In this codebase an inventory may be map-like or iterable. This helper hides
 * that shape difference so puzzle checks can stay simple.
 *
 * @param {*} entity
 * @returns {Array<*>}
 */
function inventoryValues(entity) {
  const inventory = entity && entity.inventory;
  if (!inventory) {
    return [];
  }

  if (typeof inventory.values === 'function') {
    return Array.from(inventory.values());
  }

  if (typeof inventory[Symbol.iterator] === 'function') {
    return Array.from(inventory);
  }

  return [];
}

/**
 * Check whether this container currently holds the puzzle's accepted item.
 *
 * Example:
 * - cracked bell policy expects `rantamuta:bronzeClapper`
 * - if the bell inventory contains an item with that entityReference,
 *   this returns true.
 *
 * Why this exists:
 * We need a single authoritative "is solved for this object right now?"
 * check to drive stateful descriptions.
 *
 * @param {*} entity
 * @param {*} policy
 * @returns {boolean}
 */
function hasAcceptedItem(entity, policy) {
  const acceptedItemRef = normalizeRef(policy && policy.acceptedItemRef);
  if (!acceptedItemRef) {
    return false;
  }

  for (const item of inventoryValues(entity)) {
    const entityRef = normalizeRef(item && item.entityReference);
    if (entityRef === acceptedItemRef) {
      return true;
    }
  }

  return false;
}

/**
 * Update this object's long description from optional puzzle policy fields:
 * - descriptionEmpty
 * - descriptionFilled
 *
 * How designers use it in YAML:
 * metadata:
 *   puzzle:
 *     putPolicy:
 *       acceptedItemRef: "rantamuta:bronzeClapper"
 *       descriptionEmpty: "The old bell ... clapper is missing."
 *       descriptionFilled: "The old bell ... clapper now hangs within it."
 *
 * Behavior:
 * - If accepted item is present, use descriptionFilled (fallback to empty).
 * - If accepted item is absent, use descriptionEmpty (fallback to filled).
 *
 * Why this exists:
 * This keeps look/examine text aligned with live puzzle state without changing
 * any command logic.
 *
 * @param {*} entity
 */
function syncPuzzleDescription(entity) {
  const policy = getPutPolicy(entity);
  if (!policy) {
    return;
  }

  const descriptionEmpty = typeof policy.descriptionEmpty === 'string'
    ? policy.descriptionEmpty.trim()
    : '';
  const descriptionFilled = typeof policy.descriptionFilled === 'string'
    ? policy.descriptionFilled.trim()
    : '';

  if (!descriptionEmpty && !descriptionFilled) {
    return;
  }

  const nextDescription = hasAcceptedItem(entity, policy)
    ? descriptionFilled || descriptionEmpty
    : descriptionEmpty || descriptionFilled;

  if (!nextDescription) {
    return;
  }

  entity.description = nextDescription;
}

module.exports = {
  listeners: {
    /**
     * spawn runs when the item instance enters the game world.
     *
     * We install three things here:
     * 1. allowAction: capture-phase veto for wrong offerings.
     * 2. bubbleEvent: bubble-phase flavor line for correct offerings.
     * 3. addItem/removeItem wrappers: keep description synchronized whenever
     *    commit actually moves items in/out.
     *
     * Note:
     * We preserve any previously attached behavior by calling prior hook
     * functions first and honoring their explicit result when present.
     *
     * @param {*} state
     * @returns {function(this: *, ...args: *[]): void}
     */
    spawn: state => function onSpawn() {
      // Preserve existing hook behavior if another script/decorator installed it.
      const previousAllowAction = typeof this.allowAction === 'function'
        ? this.allowAction
        : null;
      const previousBubbleEvent = typeof this.bubbleEvent === 'function'
        ? this.bubbleEvent
        : null;

      // Preserve current mutator-facing methods so we can wrap, not replace.
      const previousAddItem = typeof this.addItem === 'function'
        ? this.addItem
        : null;
      const previousRemoveItem = typeof this.removeItem === 'function'
        ? this.removeItem
        : null;

      // Commit path eventually calls addItem/removeItem when transferItem runs.
      // Wrapping here lets us react to actual committed state transitions.
      if (previousAddItem) {
        this.addItem = (item) => {
          const result = previousAddItem.call(this, item);
          // After successful insertion, refresh long description from current state.
          syncPuzzleDescription(this);
          return result;
        };
      }

      if (previousRemoveItem) {
        this.removeItem = (item) => {
          const result = previousRemoveItem.call(this, item);
          // After successful removal, refresh long description from current state.
          syncPuzzleDescription(this);
          return result;
        };
      }

      /**
       * Capture-phase policy hook.
       *
       * Responsibilities:
       * - Only care about `put` where this object is the indirect target.
       * - Read policy from metadata (`acceptedItemRef`, `rejectMessage`).
       * - Allow correct offerings; deny incorrect offerings.
       * - Return `undefined` when this hook has no opinion (so other policy
       *   layers can continue).
       */
      this.allowAction = (action, context) => {
        // Respect earlier hook chain first.
        if (previousAllowAction) {
          const previousResult = previousAllowAction.call(this, action, context);
          if (previousResult !== undefined && previousResult !== null) {
            return previousResult;
          }
        }

        // Ignore everything except "put <x> in <this>" style interactions.
        if (!isPutToIndirectTarget(action, context, this)) {
          return undefined;
        }

        // If no policy exists, this script has no veto opinion.
        const policy = getPutPolicy(this);
        if (!policy) {
          return undefined;
        }

        // Entity Resolution already bound the direct target for us.
        const directTarget = context && context.entityResolution && context.entityResolution.directTarget;
        if (acceptsDirectTarget(policy, directTarget)) {
          // Correct item: allow the command to continue.
          return undefined;
        }

        // Wrong item: deny with authored message or safe fallback.
        return typeof policy.rejectMessage === 'string' && policy.rejectMessage.length > 0
          ? policy.rejectMessage
          : 'You can\'t put that there.';
      };

      /**
       * Bubble-phase reaction hook.
       *
       * Responsibilities:
       * - After command passes validation, optionally add a flavor line
       *   (for example "The cracked bell hums with a low resonance.").
       * - Do not mutate world state here.
       * - Return null when no contribution should be added.
       */
      this.bubbleEvent = (action, context) => {
        // Respect earlier hook chain first.
        if (previousBubbleEvent) {
          const previousResult = previousBubbleEvent.call(this, action, context);
          if (previousResult !== undefined && previousResult !== null) {
            return previousResult;
          }
        }

        // Ignore unrelated actions.
        if (!isPutToIndirectTarget(action, context, this)) {
          return null;
        }

        // Need a configured success render line to contribute.
        const policy = getPutPolicy(this);
        if (!policy || typeof policy.successRender !== 'string' || policy.successRender.length === 0) {
          return null;
        }

        // Only show this flavor line when the direct item is the accepted one.
        const directTarget = context && context.entityResolution && context.entityResolution.directTarget;
        if (!acceptsDirectTarget(policy, directTarget)) {
          return null;
        }

        // Return data-only bubble contribution for dispatch/render.
        return {
          render: {
            lines: [policy.successRender],
          },
        };
      };

      // Initialize description immediately on spawn so room/look text starts in
      // the correct state even before any new command is run.
      syncPuzzleDescription(this);
    },
  },
};
