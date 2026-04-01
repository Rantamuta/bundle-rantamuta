// @ts-check
'use strict';

const { createTransposeFailure } = require('./contracts');

/**
 * Generic authored-effects transposer entrypoint.
 *
 * This package-level entrypoint exists before effect-specific lowering is
 * implemented so consumers can depend on one stable module path and one
 * stable result contract.
 *
 * @param {{
 *   effects: Array<*>,
 *   scope: Record<string, *>,
 * }} _input
 * @returns {import('./contracts').AuthoredEffectsTransposeFailure}
 */
function transposeAuthoredEffects(_input) {
  return createTransposeFailure(
    'AUTHORED_EFFECTS_NOT_IMPLEMENTED',
    'Authored effects transposition has not been implemented yet.'
  );
}

module.exports = {
  transposeAuthoredEffects,
};
