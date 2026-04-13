// @ts-check
'use strict';

/**
 * @module runtime/authored-instructions/contracts
 * @description
 * Shared contract definitions for the authored-instructions runtime surface.
 *
 * This file centralizes the small result shapes used by authored-instructions
 * validation and transposition:
 *
 * - validation findings
 * - validation success/failure envelopes
 * - transposition success/failure envelopes
 *
 * It exists to keep those contracts consistent across the validator,
 * transposer, and their tests.
 *
 * Current direct users:
 * - `lib/runtime/authored-instructions/index.js`
 * - `lib/runtime/authored-instructions/transposer.js`
 * - `lib/runtime/authored-instructions/validator.js`
 *
 * This file does not validate authored instructions, resolve references, lower
 * effects into runtime instructions, or execute any resulting operations.
 * It only defines and constructs the shared data shapes used by those layers.
 */

/**
 * @typedef {{
 *   code: string,
 *   message: string,
 *   source?: string,
 *   details?: Record<string, *>,
 * }} AuthoredEffectsFinding
 */

/**
 * @typedef {{
 *   ok: true,
 *   operations: Array<*>,
 *   renderMessages: Array<*>,
 * }} AuthoredEffectsTransposeSuccess
 */

/**
 * @typedef {{
 *   ok: false,
 *   code: string,
 *   message: string,
 *   details?: Record<string, *>,
 * }} AuthoredEffectsTransposeFailure
 */

/**
 * @typedef {{
 *   ok: true,
 *   errors: [],
 * }} AuthoredEffectsValidationSuccess
 */

/**
 * @typedef {{
 *   ok: false,
 *   errors: AuthoredEffectsFinding[],
 * }} AuthoredEffectsValidationFailure
 */

/**
 * @param {Array<*>} [operations]
 * @param {Array<*>} [renderMessages]
 * @returns {AuthoredEffectsTransposeSuccess}
 */
function createTransposeSuccess(operations = [], renderMessages = []) {
  return {
    ok: true,
    operations,
    renderMessages,
  };
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, *>} [details]
 * @returns {AuthoredEffectsTransposeFailure}
 */
function createTransposeFailure(code, message, details) {
  return {
    ok: false,
    code,
    message,
    ...(details ? { details } : {}),
  };
}

/**
 * @returns {AuthoredEffectsValidationSuccess}
 */
function createValidationSuccess() {
  return {
    ok: true,
    errors: [],
  };
}

/**
 * @param {AuthoredEffectsFinding[]} errors
 * @returns {AuthoredEffectsValidationFailure}
 */
function createValidationFailure(errors) {
  return {
    ok: false,
    errors,
  };
}

module.exports = {
  createTransposeSuccess,
  createTransposeFailure,
  createValidationSuccess,
  createValidationFailure,
};
