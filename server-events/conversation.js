'use strict';

const {
  ensureConversationDefinitionService,
  disposeConversationDefinitionService,
  primeConversationDefinitions,
} = require('../lib/session/conversation-definition-service');

module.exports = {
  listeners: {
    startup: state => function onStartup() {
      ensureConversationDefinitionService(state);
      primeConversationDefinitions(state);
    },
    shutdown: state => function onShutdown() {
      disposeConversationDefinitionService(state);
    },
  },
};
