'use strict';

const {
  ensureVirtualDoorService,
  disposeVirtualDoorService,
} = require('../lib/doors/virtual-door-service');

module.exports = {
  listeners: {
    startup: state => function onStartup() {
      ensureVirtualDoorService(state);
    },
    shutdown: state => function onShutdown() {
      disposeVirtualDoorService(state);
    },
  },
};
