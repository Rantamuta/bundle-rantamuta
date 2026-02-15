// @ts-check
'use strict';

const { quitGame } = require('../lib/session/player-lifecycle');

module.exports = {
  aliases: ['exit'],
  command: state => async (args, player, alias, context) => {
    const session = context && context.session && typeof context.session === 'object'
      ? context.session
      : { player };
    await quitGame(state, session);
  }
};
