// @ts-check
'use strict';

const { createValidationFailure } = require('./contracts');

/**
 * Shared authored-effects validator entrypoint.
 *
 * This entrypoint intentionally lands before per-effect validation logic so
 * consumers can converge on one module path and one diagnostic shape.
 *
 * @param {Array<*>} _effects
 * @returns {import('./contracts').AuthoredEffectsValidationFailure}
 */
function validateAuthoredEffects(_effects) {
  return createValidationFailure([{
    code: 'AUTHORED_EFFECTS_VALIDATOR_NOT_IMPLEMENTED',
    message: 'Authored effects validation has not been implemented yet.',
  }]);
}

module.exports = {
  validateAuthoredEffects,
};
