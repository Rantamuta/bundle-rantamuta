// @ts-check
'use strict';

const { Broadcast } = require('ranvier');

module.exports = {
  aliases: ['l'],
  command: state => (args, player) => {
    /** @type {InstanceType<import('ranvier').Room> | null | undefined} */
    const room = player.room;
    if (!room) {
      Broadcast.sayAt(player, 'You are nowhere.');
      return;
    }

    Broadcast.sayAt(player, `<bold>${room.title}</bold>`);
    Broadcast.sayAt(player, room.description);
  }
};
