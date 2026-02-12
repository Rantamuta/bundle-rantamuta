'use strict';

const {
  Account,
  Broadcast,
  Data,
  Logger,
  Player,
} = require('ranvier');
const { parseInput } = require('../lib/parse-input');

const NAME_PATTERN = /^[a-zA-Z0-9]+$/;

function writeLine(session, message = '') {
  session.socket.write(message + '\r\n');
}

function prompt(session, message) {
  session.socket.write(message);
}

function nameBounds(state) {
  const minAccount = state.Config.get('minAccountNameLength', 3);
  const maxAccount = state.Config.get('maxAccountNameLength', 20);
  const minPlayer = state.Config.get('minPlayerNameLength', 3);
  const maxPlayer = state.Config.get('maxPlayerNameLength', 20);

  return {
    min: Math.max(minAccount, minPlayer),
    max: Math.min(maxAccount, maxPlayer),
  };
}

function isValidName(state, name) {
  const { min, max } = nameBounds(state);
  if (name.length < min || name.length > max) {
    return `Name must be between ${min} and ${max} characters.`;
  }

  if (!NAME_PATTERN.test(name)) {
    return 'Name must use only letters and numbers.';
  }

  return null;
}

async function loadAccount(state, username) {
  const account = await state.AccountManager.loadAccount(username);
  account.name = account.username;
  return account;
}

async function createAccount(state, username, password) {
  const account = new Account({
    username,
    characters: [],
    password: null,
    metadata: {},
  });
  account.name = account.username;
  account.setPassword(password);
  state.AccountManager.addAccount(account);
  return account;
}

async function loadOrCreatePlayer(state, account, username) {
  const isNew = !state.PlayerManager.exists(username);
  let player;

  if (!isNew) {
    player = await state.PlayerManager.loadPlayer(state, account, username);
  } else {
    player = new Player({
      name: username,
      account,
      room: state.Config.get('startingRoom', 'rantamuta:start'),
      attributes: {},
      inventory: { items: [], max: state.Config.get('defaultMaxPlayerInventory', 16) },
      quests: { active: [], completed: [] },
      prompt: '> ',
      metadata: {},
      effects: [],
    });

    state.PlayerManager.events.attach(player);
    state.PlayerManager.addPlayer(player);
  }

  player.hydrate(state);

  if (isNew) {
    await state.PlayerManager.save(player);
  }

  return player;
}

async function enterGame(state, session) {
  const player = await loadOrCreatePlayer(state, session.account, session.username);
  player.socket = session.socket;
  session.player = player;
  session.state = 'inGame';

  writeLine(session, `Welcome, ${player.name}.`);
  if (player.room) {
    Broadcast.sayAt(player, `<bold>${player.room.title}</bold>`);
    Broadcast.sayAt(player, player.room.description);
  }
  Broadcast.prompt(player);
}

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
  event: state => async (session, inputData) => {
    if (session.processing) {
      return;
    }

    session.processing = true;
    try {
      const input = String(inputData || '').trim();

      switch (session.state) {
        case 'getName': {
          if (!input) {
            prompt(session, 'Welcome, what is your name? ');
            return;
          }

          const error = isValidName(state, input);
          if (error) {
            writeLine(session, error);
            prompt(session, 'Welcome, what is your name? ');
            return;
          }

          session.username = input;
          session.isNewAccount = !Data.exists('account', input);
          session.state = 'getPassword';
          prompt(session, 'Password: ');
          return;
        }

        case 'getPassword': {
          if (!input) {
            prompt(session, 'Password: ');
            return;
          }

          const username = session.username;
          let account;

          if (session.isNewAccount) {
            account = await createAccount(state, username, input);
          } else {
            account = await loadAccount(state, username);
            if (account.banned) {
              writeLine(session, 'This account is banned.');
              session.socket.end();
              return;
            }

            if (account.deleted) {
              writeLine(session, 'This account has been deleted.');
              session.socket.end();
              return;
            }

            if (!account.checkPassword(input)) {
              writeLine(session, 'Invalid password.');
              prompt(session, 'Password: ');
              return;
            }
          }

          if (!account.hasCharacter(username)) {
            account.addCharacter(username);
            account.save();
          }

          session.account = account;
          await enterGame(state, session);
          return;
        }

        case 'inGame':
          await handleCommand(state, session, input);
          return;

        default:
          session.state = 'getName';
          prompt(session, 'Welcome, what is your name? ');
      }
    } finally {
      session.processing = false;
    }
  }
};
