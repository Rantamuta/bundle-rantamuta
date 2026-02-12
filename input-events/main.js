// @ts-check
'use strict';

const io = require('../lib/session/io');
const { handleGetName, handleGetPassword } = require('../lib/session/auth-flow');
const { enterGame } = require('../lib/session/player-lifecycle');
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

        case 'inGame':
          await handleCommand(state, session, input);
          return;

        default:
          session.state = 'getName';
          io.prompt(session, 'Welcome, what is your name? ');
      }
    } finally {
      session.processing = false;
    }
  }
};
