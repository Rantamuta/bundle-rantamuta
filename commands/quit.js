// @ts-check
'use strict';

const { Broadcast } = require('ranvier');

module.exports = {
  aliases: ['exit'],
  command: state => async (args, player) => {
    Broadcast.sayAt(player, 'Goodbye.');

    try {
      await state.PlayerManager.save(player);
    } catch (err) {
      // best-effort save
    }

    state.PlayerManager.removePlayer(player, true);
  }
};
