// @ts-check
'use strict';

const { Account, Data } = require('ranvier');

const NAME_PATTERN = /^[a-zA-Z0-9]+$/;

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

function handleGetName(state, session, input, io) {
  if (!input) {
    io.prompt(session, 'Welcome, what is your name? ');
    return;
  }

  const error = isValidName(state, input);
  if (error) {
    io.writeLine(session, error);
    io.prompt(session, 'Welcome, what is your name? ');
    return;
  }

  session.username = input;
  session.isNewAccount = !Data.exists('account', input);
  session.state = 'getPassword';
  io.prompt(session, 'Password: ');
}

async function handleGetPassword(state, session, input, io, enterGame) {
  if (!input) {
    io.prompt(session, 'Password: ');
    return;
  }

  const username = session.username;
  let account;

  if (session.isNewAccount) {
    account = await createAccount(state, username, input);
  } else {
    account = await loadAccount(state, username);
    if (account.banned) {
      io.writeLine(session, 'This account is banned.');
      session.socket.end();
      return;
    }

    if (account.deleted) {
      io.writeLine(session, 'This account has been deleted.');
      session.socket.end();
      return;
    }

    if (!account.checkPassword(input)) {
      io.writeLine(session, 'Invalid password.');
      io.prompt(session, 'Password: ');
      return;
    }
  }

  if (!account.hasCharacter(username)) {
    account.addCharacter(username);
    account.save();
  }

  session.account = account;
  await enterGame(state, session, io);
}

module.exports = {
  handleGetName,
  handleGetPassword,
};
