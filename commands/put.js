// @ts-check
'use strict';

const { Broadcast } = require('ranvier');

module.exports = {
  command: state => (args, player) => {
    Broadcast.sayAt(player, 'Put is not implemented yet.');
  }
};
