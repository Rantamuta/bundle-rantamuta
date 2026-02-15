// @ts-check
'use strict';

const { Broadcast, Player } = require('ranvier');
const { buildRoomViewLines } = require('../helpers/room-view-helper');

/** @typedef {import('ranvier/types/Player')} RanvierPlayer */
/** @typedef {import('ranvier/types/Room')} RanvierRoom */

/**
 * @param {*} room
 * @param {*} actor
 * @param {string} message
 */
function broadcastRoomOthers(room, actor, message) {
  if (!room || typeof room !== 'object' || typeof room.getBroadcastTargets !== 'function') {
    return;
  }

  const normalized = String(message || '').trim();
  if (!normalized) {
    return;
  }

  Broadcast.sayAtExcept(room, normalized, actor ? [actor] : []);
}

async function loadOrCreatePlayer(state, account, username) {
  const isNew = !state.PlayerManager.exists(username);
  /** @type {RanvierPlayer} */
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
  /** @type {RanvierRoom | null | undefined} */
  const room = player.room;
  if (room) {
    broadcastRoomOthers(room, player, `${player.name} suddenly materializes!`);

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

/**
 * @param {*} state
 * @param {*} session
 */
async function quitGame(state, session) {
  const player = session && session.player;
  if (!player || typeof player !== 'object') {
    return;
  }

  const room = player.room;
  if (room) {
    broadcastRoomOthers(room, player, `${player.name} suddenly winks out of existence!`);
  }

  Broadcast.sayAt(player, 'Goodbye.');

  try {
    await state.PlayerManager.save(player);
  } catch (err) {
    // best-effort save
  }

  state.PlayerManager.removePlayer(player, true);
}

module.exports = {
  enterGame,
  quitGame,
};
