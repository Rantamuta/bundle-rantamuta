// @ts-check
'use strict';

const { Broadcast, Logger } = require('ranvier');
const { parseInput } = require('../parse-input');

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

  const match = state.CommandManager.find(commandName, true);
  const { alias } = match || {};
  const command = alias ? match.command : match;

  if (!command || typeof command.execute !== 'function') {
    Broadcast.sayAt(player, 'Unknown command.');
    Broadcast.prompt(player);
    return;
  }

  try {
    await match.command.execute(args, player, match.alias);
  } catch (err) {
    /** @type {{ stack?: string, message?: string }} */
    const commandError = err;
    Logger.error(commandError.stack || commandError.message || 'Unknown command error');
    Broadcast.sayAt(player, 'Command failed.');
  }

  if (!player.__pruned && player.socket && player.socket.writable) {
    Broadcast.prompt(player);
  }
}

module.exports = {
  handleCommand,
};
