// @ts-check
'use strict';

/**
 * @param {*} collection
 * @returns {Array<*>}
 */
function valuesAsArray(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (typeof collection.values === 'function') {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === 'function') {
    return Array.from(collection);
  }

  return [];
}

/**
 * @param {*} room
 * @returns {string[]}
 */
function roomItemLines(room) {
  return valuesAsArray(room && room.items)
    .map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (typeof item.roomDesc === 'string' && item.roomDesc.length > 0) {
        return item.roomDesc;
      }

      if (typeof item.name === 'string' && item.name.length > 0) {
        return `You see ${item.name} here.`;
      }

      return '';
    })
    .filter(Boolean);
}

/**
 * @param {*} room
 * @returns {string[]}
 */
function roomExitLines(room) {
  const exits = typeof room.getExits === 'function'
    ? valuesAsArray(room.getExits())
    : valuesAsArray(room && room.exits);

  const directions = exits
    .map(exit => String(exit && exit.direction ? exit.direction : '').trim().toLowerCase())
    .filter(Boolean);

  if (!directions.length) {
    return [];
  }

  return [`Exits: ${directions.join(', ')}`];
}

/**
 * @param {*} room
 * @returns {string[]}
 */
function buildRoomViewLines(room) {
  if (!room || typeof room !== 'object') {
    return [];
  }

  /** @type {string[]} */
  const lines = [];

  if (typeof room.title === 'string' && room.title.length > 0) {
    lines.push(`<bold>${room.title}</bold>`);
  }

  if (typeof room.description === 'string' && room.description.length > 0) {
    lines.push(room.description);
  }

  lines.push(...roomExitLines(room));
  lines.push(...roomItemLines(room));
  return lines;
}

module.exports = {
  buildRoomViewLines,
  roomExitLines,
  roomItemLines,
  valuesAsArray,
};
