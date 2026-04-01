// @ts-check
'use strict';

const {
  createTransposeSuccess,
  createTransposeFailure,
} = require('./contracts');
const {
  resolveScopedReference,
  resolveRoomReference,
} = require('./reference-resolution');
const { validateAuthoredEffects } = require('./validator');

/** @type {Record<string, (payload: Record<string, *>, scope: Record<string, *>) => import('./contracts').AuthoredEffectsTransposeSuccess | import('./contracts').AuthoredEffectsTransposeFailure>} */
const LOWERERS = Object.create(null);

/**
 * @param {string} effectName
 * @param {string} field
 * @param {*} value
 * @param {Record<string, *>} scope
 * @returns {* | import('./contracts').AuthoredEffectsTransposeFailure}
 */
function requireReference(effectName, field, value, scope) {
  const resolved = resolveScopedReference(scope, value);
  if (resolved !== null) {
    return resolved;
  }

  return createTransposeFailure(
    'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
    `${effectName}.${field} could not be resolved from authored-effects scope.`,
    { effectName, field, value }
  );
}

/**
 * @param {import('./contracts').AuthoredEffectsTransposeSuccess} target
 * @param {import('./contracts').AuthoredEffectsTransposeSuccess} source
 */
function appendSuccess(target, source) {
  target.operations.push(...source.operations);
  target.renderMessages.push(...source.renderMessages);
}

/**
 * Generic authored-effects transposer entrypoint.
 *
 * @param {{
 *   effects: Array<*>,
 *   scope: Record<string, *>,
 * }} input
 * @returns {import('./contracts').AuthoredEffectsTransposeSuccess | import('./contracts').AuthoredEffectsTransposeFailure}
 */
function transposeAuthoredEffects(input) {
  const effects = input && typeof input === 'object' && Array.isArray(input.effects)
    ? input.effects
    : input && typeof input === 'object'
      ? input.effects
      : undefined;
  const scope = input && typeof input === 'object' && input.scope && typeof input.scope === 'object'
    ? input.scope
    : {};

  const validation = validateAuthoredEffects(effects);
  if (!validation.ok) {
    return createTransposeFailure(
      'AUTHORED_EFFECTS_INVALID',
      'Authored effects failed validation.',
      { errors: validation.errors }
    );
  }

  const output = createTransposeSuccess();
  for (const entry of effects) {
    const effectName = Object.keys(entry)[0];
    const lowerEffect = LOWERERS[effectName];
    if (!lowerEffect) {
      return createTransposeFailure(
        'AUTHORED_EFFECT_LOWERING_MISSING',
        `No lowering is registered for authored effect "${effectName}".`,
        { effectName }
      );
    }

    const lowered = lowerEffect(entry[effectName], scope);
    if (!lowered.ok) {
      return lowered;
    }

    appendSuccess(output, lowered);
  }

  return output;
}

LOWERERS.transferItem = function lowerTransferItem(payload, scope) {
  const item = requireReference('transferItem', 'item', payload.item, scope);
  if (item && item.ok === false) {
    return item;
  }

  const from = requireReference('transferItem', 'from', payload.from, scope);
  if (from && from.ok === false) {
    return from;
  }

  const to = requireReference('transferItem', 'to', payload.to, scope);
  if (to && to.ok === false) {
    return to;
  }

  return createTransposeSuccess([
    {
      type: 'transferItem',
      item,
      from,
      to,
    },
  ]);
};

LOWERERS.movePlayer = function lowerMovePlayer(payload, scope) {
  const player = payload.player !== undefined
    ? resolveScopedReference(scope, payload.player)
    : resolveScopedReference(scope, 'player');
  if (player === null) {
    return createTransposeFailure(
      'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      'movePlayer.player could not be resolved from authored-effects scope.',
      { effectName: 'movePlayer', field: 'player', value: payload.player }
    );
  }

  const toRoom = resolveRoomReference(scope, payload.toRoom);
  if (toRoom === null) {
    return createTransposeFailure(
      'AUTHORED_EFFECT_REFERENCE_UNRESOLVED',
      'movePlayer.toRoom could not be resolved from authored-effects scope.',
      { effectName: 'movePlayer', field: 'toRoom', value: payload.toRoom }
    );
  }

  return createTransposeSuccess([
    {
      type: 'movePlayer',
      player,
      toRoom,
    },
  ]);
};

module.exports = {
  LOWERERS,
  transposeAuthoredEffects,
};
