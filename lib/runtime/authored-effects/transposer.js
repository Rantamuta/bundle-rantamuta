// @ts-check
'use strict';

const {
  createTransposeSuccess,
  createTransposeFailure,
} = require('./contracts');
const { validateAuthoredEffects } = require('./validator');

/** @type {Record<string, (payload: Record<string, *>, scope: Record<string, *>) => import('./contracts').AuthoredEffectsTransposeSuccess | import('./contracts').AuthoredEffectsTransposeFailure>} */
const LOWERERS = Object.create(null);

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

module.exports = {
  LOWERERS,
  transposeAuthoredEffects,
};
