// @ts-check
'use strict';

const { Broadcast, Logger } = require('ranvier');
const { parseInput } = require('../parse-input');
const Mutator = require('./mutator');

/** @typedef {import('ranvier/types/GameState')} GameState */
/** @typedef {import('ranvier/types/Command')} Command */
/** @typedef {import('./mutator').MutationPlan} MutationPlan */

/**
 * @typedef {object} Session
 * @property {import('ranvier/types/Player')} player
 */

/**
 * Normalize CommandManager.find(...) into a stable nullable command shape.
 *
 * @param {GameState} state
 * @param {string} commandName
 * @returns {{ command: Command | null, alias: string | null }}
 */
function resolveCommand(state, commandName) {
  const match = state.CommandManager.find(commandName, true);
  if (!match) {
    return { command: null, alias: null };
  }

  if (typeof match === 'object' && 'command' in match && 'alias' in match) {
    return { command: match.command, alias: match.alias };
  }

  return { command: match, alias: null };
}

/**
 * @typedef {{ ok: true, plan: MutationPlan }} CommandSuccessResult
 */

/**
 * @typedef {{ ok: false, error?: { message?: string } }} CommandFailureResult
 */

/**
 * @typedef {undefined | CommandSuccessResult | CommandFailureResult} CommandResult
 */

/**
 * @param {unknown} value
 * @returns {value is CommandSuccessResult}
 */
function isCommandSuccessResult(value) {
  return !!value && typeof value === 'object' && value.ok === true && !!value.plan;
}

/**
 * @param {unknown} value
 * @returns {value is CommandFailureResult}
 */
function isCommandFailureResult(value) {
  return !!value && typeof value === 'object' && value.ok === false;
}

/**
 * @param {unknown} value
 * @returns {value is CommandResult}
 */
function isCommandResult(value) {
  if (value === undefined) {
    return true;
  }

  return isCommandSuccessResult(value) || isCommandFailureResult(value);
}

/**
 * @param {GameState} state
 * @param {Session} session
 * @param {string} input
 */
async function handleCommand(state, session, input) {
  const player = session.player;
  const parsedInput = parseInput(input);

  const isEmpty = !parsedInput.normalizedInput || parsedInput.normalizedInput.length === 0;

  if (isEmpty) {
    Broadcast.prompt(player);
    return;
  }


  const noIntent = !parsedInput.intentToken;

  if (noIntent) {
    Broadcast.sayAt(player, 'Unknown command.');
    Broadcast.prompt(player);
    return;
  }

  const commandName = parsedInput.intentToken;
  const args = parsedInput.normalizedInput.split(' ').slice(1).join(' ');

  const { command, alias } = resolveCommand(state, commandName);

  const noCommandFound = !command || typeof command.execute !== 'function'

  if (noCommandFound) {
    Broadcast.sayAt(player, 'Unknown command.');
    Broadcast.prompt(player);
    return;
  }

  try {
    const result = await command.execute(args, player, alias);

    if (!isCommandResult(result)) {
      Logger.warn('Command returned an invalid result envelope. Ignoring return value.');
      return;
    }

    if (isCommandSuccessResult(result)) {
      Mutator.applyMutationPlan(state, result.plan);
    } else if (isCommandFailureResult(result)) {
      const message = result.error && result.error.message ? result.error.message : 'Command failed.';
      Broadcast.sayAt(player, message);
    }
  } catch (err) {
    /** @type {{ stack?: string, message?: string }} */
    const commandError = err;
    Logger.error(commandError.stack || commandError.message || 'Unknown command error');
    Broadcast.sayAt(player, 'Command failed.');
  }

  const isStillActivePlayer = state.PlayerManager.getPlayer(player.name) === player;
  if (isStillActivePlayer && player.socket && player.socket.writable) {
    Broadcast.prompt(player);
  }
}

module.exports = {
  handleCommand,
};
