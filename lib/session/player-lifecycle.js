// @ts-check
'use strict';

const { Broadcast, Player } = require('ranvier');
const { buildRoomViewLines } = require('../helpers/room-view-helper');

async function loadOrCreatePlayer(state, account, username) {
  const isNew = !state.PlayerManager.exists(username);
  /** @type {InstanceType<import('ranvier').Player>} */
  let player;
  const accountPassword = account && typeof account === 'object' && typeof account.password === 'string'
    ? account.password
    : '';

  if (!isNew) {
    player = await state.PlayerManager.loadPlayer(state, account, username);
  } else {
    player = new Player({
      name: username,
      account,
      password: accountPassword,
      room: state.Config.get('startingRoom'),
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
  /** @type {InstanceType<import('ranvier').Room> | null | undefined} */
  const room = player.room;
  if (room) {
    const lines = buildRoomViewLines(room, {
      actor: player,
      room,
      area: room.area || null,
      world: state,
    });
    for (const line of lines) {
      Broadcast.sayAt(player, line);
    }
  }
  Broadcast.prompt(player);
}

module.exports = {
  enterGame,
};
