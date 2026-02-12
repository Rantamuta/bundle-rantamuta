'use strict';

const { Broadcast, Player } = require('ranvier');

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

async function enterGame(state, session, io) {
  const player = await loadOrCreatePlayer(state, session.account, session.username);
  player.socket = session.socket;
  session.player = player;
  session.state = 'inGame';

  io.writeLine(session, `Welcome, ${player.name}.`);
  if (player.room) {
    Broadcast.sayAt(player, `<bold>${player.room.title}</bold>`);
    Broadcast.sayAt(player, player.room.description);
  }
  Broadcast.prompt(player);
}

module.exports = {
  enterGame,
};
