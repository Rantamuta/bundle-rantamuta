'use strict';

const assert = require('assert');
const { handleGetPassword } = require('../lib/session/auth-flow');

describe('bundle-rantamuta auth-flow', function () {
  it('forwards io to enterGame after successful password validation', async function () {
    const loadedAccount = {
      username: 'flowuser',
      banned: false,
      deleted: false,
      checkPassword: () => true,
      hasCharacter: () => true,
      addCharacter: () => {},
      save: () => {},
    };

    const state = {
      AccountManager: {
        loadAccount: async () => loadedAccount,
      },
    };

    const session = {
      username: 'flowuser',
      isNewAccount: false,
    };

    const io = {
      writeLine: () => {},
      prompt: () => {},
    };

    let actualIoArg;
    const enterGame = async (nextState, nextSession, ioArg) => {
      assert.strictEqual(nextState, state);
      assert.strictEqual(nextSession, session);
      actualIoArg = ioArg;
    };

    await handleGetPassword(state, session, 'correct-password', io, enterGame);

    assert.strictEqual(actualIoArg, io);
  });
});
