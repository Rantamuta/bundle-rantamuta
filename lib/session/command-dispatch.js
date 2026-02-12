'use strict';

const { Broadcast, Logger } = require('ranvier');
const { parseInput } = require('../parse-input');

async function handleCommand(state, session, input) {
  const player = session.player;
  const parsedInput = parseInput(input);

  if (parsedInput.classification === 'unknown intent') {
    Broadcast.prompt(player);
    return;
  }

  if (parsedInput.classification === 'semantic error') {
    Broadcast.sayAt(player, 'Unknown command.');
    Broadcast.prompt(player);
    return;
  }

  const commandName = parsedInput.intentToken;
  const args = parsedInput.normalizedInput.split(' ').slice(1).join(' ');

  const match = state.CommandManager.find(commandName, true);
  if (!match || !match.command) {
    Broadcast.sayAt(player, 'Unknown command.');
    Broadcast.prompt(player);
    return;
  }

  try {
    await match.command.execute(args, player, match.alias);
  } catch (err) {
    Logger.error(err.stack || err.message);
    Broadcast.sayAt(player, 'Command failed.');
  }

  if (!player.__pruned && player.socket && player.socket.writable) {
    Broadcast.prompt(player);
  }
}

module.exports = {
  handleCommand,
};
