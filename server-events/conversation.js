'use strict';

const {
  ensureConversationDefinitionService,
  disposeConversationDefinitionService,
  primeConversationDefinitions,
} = require('../lib/runtime/conversation/conversation-definition-service');

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
