// @ts-check
'use strict';

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
