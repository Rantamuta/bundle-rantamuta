// @ts-check
'use strict';

const { Broadcast } = require('ranvier');
const io = require('../lib/session/io');
const { handleGetName, handleGetPassword } = require('../lib/session/auth-flow');
const { enterGame, quitGame } = require('../lib/session/player-lifecycle');
const { handleCommand } = require('../lib/session/command-dispatch');

module.exports = {
  event: state => async (session, inputData) => {
    if (session.processing) {
      return;
    }

    session.processing = true;
    try {
      const input = String(inputData || '').trim();

      switch (session.state) {
        case 'getName':
          handleGetName(state, session, input, io);
          return;

        case 'getPassword':
          await handleGetPassword(state, session, input, io, enterGame);
          return;

        case 'inGame': {
          const firstSpace = input.indexOf(' ');
          const commandToken = (firstSpace === -1 ? input : input.slice(0, firstSpace)).toLowerCase();
          const commandArgsRaw = firstSpace === -1 ? '' : input.slice(firstSpace + 1).trim();

          switch (commandToken) {
            case 'quit':
            case 'exit':
              await quitGame(state, session);
              return;
            case 'teleport': {
              const player = session && session.player;
              const numericRole = player && typeof player === 'object'
                ? Number(player.role)
                : Number.NaN;
              const isAdmin = Number.isFinite(numericRole) && numericRole >= 2;
              if (!isAdmin) {
                break;
              }

              const roomManager = state && typeof state === 'object'
                ? state.RoomManager
                : null;
              const destination = roomManager && typeof roomManager.getRoom === 'function'
                ? roomManager.getRoom(commandArgsRaw)
                : undefined;

              player.moveTo(destination);
              Broadcast.prompt(player);
              return;
            }
          }

          return await handleCommand(state, session, input);
        }

        default:
          session.state = 'getName';
          io.prompt(session, 'Welcome, what is your name? ');
      }
    } finally {
      session.processing = false;
    }
  }
};
