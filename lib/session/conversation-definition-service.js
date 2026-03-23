// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const { Data, Logger } = require('ranvier');
const { validateConversationDefinition } = require('./conversation-definition-validation');

const DEFAULT_BUNDLES_ROOT_PATH = path.resolve(__dirname, '..', '..', '..');

/**
 * @typedef {{ relativePath: string, absolutePath: string, areaPath: string, bundle: string, areaName: string }} ConversationBinding
 * @typedef {{ status: 'none' }} NoConversationBindingOutcome
 * @typedef {{ status: 'bound', binding: ConversationBinding }} BoundConversationBindingOutcome
 * @typedef {{ status: 'broken', error: { code: string, message: string, playerMessage: string, details?: Record<string, *> } }} BrokenConversationBindingOutcome
 * @typedef {NoConversationBindingOutcome | BoundConversationBindingOutcome | BrokenConversationBindingOutcome} ConversationBindingOutcome
 * @typedef {{ status: 'loaded', definition: { id: string, initial: string, states: Record<string, *>, sourcePath: string, absolutePath: string, bundle: string, areaName: string } }} LoadedConversationDefinitionOutcome
 * @typedef {LoadedConversationDefinitionOutcome | BrokenConversationBindingOutcome} ConversationDefinitionLoadOutcome
 * @typedef {{
 *   resolveConversationBinding: function(*, *): ConversationBindingOutcome,
 *   loadConversationDefinition: function(ConversationBinding, *): ConversationDefinitionLoadOutcome,
 *   getConversationDefinitionForNpc: function(*, *): ConversationDefinitionLoadOutcome | NoConversationBindingOutcome,
 *   primeConversationDefinitions: function(): Array<{ npcRef: string, code: string, message: string }>,
 *   dispose: function(): void,
 * }} ConversationDefinitionService
 */

/** @type {WeakMap<object, ConversationDefinitionService>} */
const serviceRegistry = new WeakMap();

/**
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {*} state
 * @returns {string}
 */
function getBundlesRootPath(state) {
  const bundlesPath = state
    && isObjectRecord(state.BundleManager)
    && typeof state.BundleManager.bundlesPath === 'string'
    ? state.BundleManager.bundlesPath
    : '';

  return bundlesPath
    ? path.resolve(bundlesPath)
    : DEFAULT_BUNDLES_ROOT_PATH;
}

/**
 * @param {*} state
 * @returns {{ error?: Function }}
 */
function getLogger(state) {
  if (state && isObjectRecord(state.Logger)) {
    return state.Logger;
  }

  return Logger;
}

/**
 * @param {*} npc
 * @returns {string}
 */
function getNpcDisplayName(npc) {
  const name = npc && typeof npc.name === 'string'
    ? npc.name.trim()
    : '';

  return name || 'They';
}

/**
 * @param {*} npc
 * @returns {string}
 */
function getNoResponseMessage(npc) {
  return `${getNpcDisplayName(npc)} has nothing to say.`;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {*} npc
 * @param {Record<string, *>} [details]
 * @returns {{ status: 'broken', error: { code: string, message: string, playerMessage: string, details?: Record<string, *> } }}
 */
function createBrokenBinding(code, message, npc, details) {
  return {
    status: 'broken',
    error: {
      code,
      message,
      playerMessage: getNoResponseMessage(npc),
      ...(details ? { details } : {}),
    },
  };
}

/**
 * @param {*} area
 * @returns {{ bundle: string, areaName: string } | null}
 */
function normalizeAreaInfo(area) {
  const bundle = area && typeof area.bundle === 'string' ? area.bundle.trim() : '';
  const areaName = area && typeof area.name === 'string' ? area.name.trim() : '';

  if (!bundle || !areaName) {
    return null;
  }

  return { bundle, areaName };
}

/**
 * @param {*} rawPath
 * @returns {boolean}
 */
function isWindowsAbsolutePath(rawPath) {
  return typeof rawPath === 'string' && /^[A-Za-z]:[\\/]/u.test(rawPath.trim());
}

/**
 * @param {*} npc
 * @param {*} area
 * @param {{ bundlesRootPath?: string }} [options]
 * @returns {ConversationBindingOutcome}
 */
function resolveConversationBinding(npc, area, options = {}) {
  const metadata = npc && isObjectRecord(npc.metadata) ? npc.metadata : null;
  if (!metadata || !Object.prototype.hasOwnProperty.call(metadata, 'conversation')) {
    return { status: 'none' };
  }

  const areaInfo = normalizeAreaInfo(area);
  if (!areaInfo) {
    return createBrokenBinding(
      'CONVERSATION_BINDING_AREA_UNRESOLVED',
      'Conversation binding requires an area with bundle and name.',
      npc
    );
  }

  const rawPath = metadata.conversation;
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return createBrokenBinding(
      'CONVERSATION_BINDING_INVALID',
      'metadata.conversation must be a non-empty relative path string.',
      npc
    );
  }

  if (path.isAbsolute(rawPath) || isWindowsAbsolutePath(rawPath)) {
    return createBrokenBinding(
      'CONVERSATION_BINDING_ABSOLUTE_PATH',
      `Conversation binding "${String(rawPath)}" must be a relative path inside the NPC area directory.`,
      npc,
      { conversation: rawPath }
    );
  }

  const relativePath = rawPath.trim().replace(/\\/gu, '/');
  if (!relativePath.endsWith('.conversation.yml')) {
    return createBrokenBinding(
      'CONVERSATION_BINDING_INVALID_EXTENSION',
      `Conversation binding "${relativePath}" must reference a ".conversation.yml" file.`,
      npc,
      { conversation: relativePath }
    );
  }

  const bundlesRootPath = options.bundlesRootPath
    ? path.resolve(options.bundlesRootPath)
    : DEFAULT_BUNDLES_ROOT_PATH;
  const areaPath = path.resolve(bundlesRootPath, areaInfo.bundle, 'areas', areaInfo.areaName);
  const absolutePath = path.resolve(areaPath, relativePath);
  const relativeToArea = path.relative(areaPath, absolutePath);

  if (
    relativeToArea === ''
    || relativeToArea === '.'
    || relativeToArea.startsWith(`..${path.sep}`)
    || relativeToArea === '..'
    || path.isAbsolute(relativeToArea)
  ) {
    return createBrokenBinding(
      'CONVERSATION_BINDING_OUTSIDE_AREA',
      `Conversation binding "${relativePath}" must resolve within area "${areaInfo.bundle}:${areaInfo.areaName}".`,
      npc,
      { conversation: relativePath }
    );
  }

  return {
    status: 'bound',
    binding: {
      relativePath,
      absolutePath,
      areaPath,
      bundle: areaInfo.bundle,
      areaName: areaInfo.areaName,
    },
  };
}

/**
 * @param {ConversationBinding} binding
 * @returns {ConversationDefinitionLoadOutcome}
 */
function loadConversationDefinition(binding) {
  if (!binding || !isObjectRecord(binding)) {
    return createBrokenBinding(
      'CONVERSATION_BINDING_INVALID',
      'Conversation binding must be an object before loading.',
      { name: 'They' }
    );
  }

  if (!fs.existsSync(binding.absolutePath)) {
    return createBrokenBinding(
      'CONVERSATION_FILE_MISSING',
      `Conversation file "${binding.relativePath}" does not exist for area "${binding.bundle}:${binding.areaName}".`,
      { name: 'They' },
      { absolutePath: binding.absolutePath, relativePath: binding.relativePath }
    );
  }

  let doc;
  try {
    doc = Data.parseFile(binding.absolutePath);
  } catch (error) {
    return createBrokenBinding(
      'CONVERSATION_FILE_PARSE_FAILED',
      `Conversation file "${binding.relativePath}" failed to parse: ${error && error.message ? error.message : String(error)}`,
      { name: 'They' },
      { absolutePath: binding.absolutePath, relativePath: binding.relativePath }
    );
  }

  const validation = validateConversationDefinition(doc, binding.relativePath);
  if (!validation.ok) {
    return createBrokenBinding(
      'CONVERSATION_DEFINITION_INVALID',
      `Conversation file "${binding.relativePath}" failed runtime validation.`,
      { name: 'They' },
      { absolutePath: binding.absolutePath, relativePath: binding.relativePath, errors: validation.errors }
    );
  }

  return {
    status: 'loaded',
    definition: Object.freeze({
      id: doc.id,
      initial: doc.initial,
      states: doc.states,
      sourcePath: binding.relativePath,
      absolutePath: binding.absolutePath,
      bundle: binding.bundle,
      areaName: binding.areaName,
    }),
  };
}

/**
 * @param {*} state
 * @returns {ConversationDefinitionService}
 */
function createConversationDefinitionService(state) {
  const bundlesRootPath = getBundlesRootPath(state);
  const logger = getLogger(state);
  /** @type {Map<string, *>} */
  const definitionCache = new Map();

  /**
   * @param {{ status: 'broken', error: { code: string, message: string } }} outcome
   * @returns {void}
   */
  function logBrokenOutcome(outcome) {
    if (!outcome || outcome.status !== 'broken') {
      return;
    }

    if (logger && typeof logger.error === 'function') {
      logger.error(`CONVERSATION_BINDING ${outcome.error.code}: ${outcome.error.message}`);
    }
  }

  return {
    resolveConversationBinding(npc, area) {
      return resolveConversationBinding(npc, area, { bundlesRootPath });
    },

    loadConversationDefinition(binding, npc) {
      const loaded = loadConversationDefinition(binding);
      if (loaded.status === 'broken') {
        loaded.error.playerMessage = getNoResponseMessage(npc);
      }
      return loaded;
    },

    getConversationDefinitionForNpc(npc, area) {
      const bindingOutcome = resolveConversationBinding(npc, area, { bundlesRootPath });
      if (bindingOutcome.status !== 'bound') {
        if (bindingOutcome.status === 'broken') {
          logBrokenOutcome(bindingOutcome);
        }
        return bindingOutcome;
      }

      const cached = definitionCache.get(bindingOutcome.binding.absolutePath);
      if (cached) {
        return cached;
      }

      const loaded = this.loadConversationDefinition(bindingOutcome.binding, npc);
      if (loaded.status === 'broken') {
        logBrokenOutcome(loaded);
      }
      definitionCache.set(bindingOutcome.binding.absolutePath, loaded);
      return loaded;
    },

    primeConversationDefinitions() {
      const findings = [];
      const mobFactory = state && isObjectRecord(state.MobFactory) && state.MobFactory.entities instanceof Map
        ? state.MobFactory
        : null;
      const areaFactory = state && isObjectRecord(state.AreaFactory) && typeof state.AreaFactory.getDefinition === 'function'
        ? state.AreaFactory
        : null;
      if (!mobFactory || !areaFactory) {
        return findings;
      }

      for (const [npcRef, npcDef] of mobFactory.entities.entries()) {
        const separator = String(npcRef || '').indexOf(':');
        if (separator <= 0) {
          continue;
        }

        const areaName = String(npcRef).slice(0, separator);
        const areaDef = areaFactory.getDefinition(areaName);
        const areaInfo = areaDef && typeof areaDef.bundle === 'string'
          ? { bundle: areaDef.bundle, name: areaName }
          : null;
        if (!areaInfo) {
          continue;
        }

        const outcome = this.getConversationDefinitionForNpc(npcDef, areaInfo);
        if (outcome.status === 'broken') {
          findings.push({
            npcRef,
            code: outcome.error.code,
            message: outcome.error.message,
          });
        }
      }

      return findings;
    },

    dispose() {
      definitionCache.clear();
    },
  };
}

/**
 * Prime configured conversation definitions for loaded NPC definitions.
 *
 * @param {*} state
 * @returns {Array<{ npcRef: string, code: string, message: string }>}
 */
function primeConversationDefinitions(state) {
  return ensureConversationDefinitionService(state).primeConversationDefinitions();
}

/**
 * @param {*} state
 * @returns {ConversationDefinitionService}
 */
function ensureConversationDefinitionService(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    throw new TypeError('ensureConversationDefinitionService(state): state must be an object.');
  }

  const existing = serviceRegistry.get(state);
  if (existing) {
    return existing;
  }

  const service = createConversationDefinitionService(state);
  serviceRegistry.set(state, service);
  return service;
}

/**
 * @param {*} state
 * @returns {ConversationDefinitionService}
 */
function getConversationDefinitionService(state) {
  return ensureConversationDefinitionService(state);
}

/**
 * @param {*} state
 * @returns {void}
 */
function disposeConversationDefinitionService(state) {
  if (!state || (typeof state !== 'object' && typeof state !== 'function')) {
    return;
  }

  const service = serviceRegistry.get(state);
  if (service && typeof service.dispose === 'function') {
    service.dispose();
  }

  serviceRegistry.delete(state);
}

module.exports = {
  DEFAULT_BUNDLES_ROOT_PATH,
  createConversationDefinitionService,
  disposeConversationDefinitionService,
  ensureConversationDefinitionService,
  getConversationDefinitionService,
  loadConversationDefinition,
  primeConversationDefinitions,
  resolveConversationBinding,
};
