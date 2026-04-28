// @ts-check
'use strict';

/**
 * Phase 1 predicate runtime (service layer).
 *
 * This module implements the plan's runtime-owned predicate evaluation service:
 * - area-local registry loading from `areas/<area>/predicates.js`
 * - export/key/function validation for registry safety
 * - strict evaluation semantics (`=== true` only)
 * - read-only predicate input contract (`{ actor, q, context }`)
 * - warn-once diagnostics for missing/invalid/throwing predicates
 *
 * Boundary by design:
 * - render-facing helper only (no script-public API here)
 * - no direct wiring to room rendering or tag parsing in this phase
 *   (those are wired in later phases)
 */
const fs = require('fs');
const path = require('path');
const { Logger } = require('ranvier');
const { createQueryFacade } = require('./query-facade');

const PREDICATE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_BUNDLES_ROOT_PATH = path.resolve(__dirname, '..', '..', '..');

/**
 * Accept only object-literal style exports for predicate registries.
 * This prevents arrays/functions from being treated as valid maps.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Canonicalize refs/tokens so predicate lookups are case/whitespace stable.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * Normalize arrays/sets/maps/custom inventory wrappers into a plain array.
 * Predicate queries read many collection shapes and need one traversal path.
 *
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

  if (collection && typeof collection === 'object' && Array.isArray(collection.items)) {
    return collection.items;
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
 * Read actor effects in a shape-agnostic way.
 *
 * @param {*} actor
 * @returns {*[]}
 */
function actorEffects(actor) {
  return valuesAsArray(actor && actor.effects);
}

/**
 * Extract a stable effect identifier from either string or object forms.
 *
 * @param {*} entry
 * @returns {string}
 */
function effectId(entry) {
  if (typeof entry === 'string') {
    return normalizeRef(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  return normalizeRef(entry.id || entry.name || entry.entityReference);
}

/**
 * Project raw actor objects into the restricted predicate actor contract.
 * This keeps predicates read-only and prevents accidental engine coupling.
 *
 * @param {*} actor
 * @returns {Readonly<{ ref: string | null, name: string | null, level: number | null, role: number | string | null, roomRef: string | null, effectIds: readonly string[] }> | null}
 */
function normalizeActorView(actor) {
  if (!actor || typeof actor !== 'object') {
    return null;
  }

  const name = typeof actor.name === 'string' && actor.name.trim().length > 0
    ? actor.name.trim()
    : null;

  const refFromActor = typeof actor.ref === 'string' && actor.ref.trim().length > 0
    ? actor.ref.trim()
    : typeof actor.entityReference === 'string' && actor.entityReference.trim().length > 0
      ? actor.entityReference.trim()
      : null;

  const ref = refFromActor || (name ? `player:${name.toLowerCase()}` : null);

  const level = Number.isFinite(actor.level)
    ? Number(actor.level)
    : null;

  const role = (typeof actor.role === 'number' || typeof actor.role === 'string')
    ? actor.role
    : null;

  const roomRef = actor.room && typeof actor.room === 'object' && typeof actor.room.entityReference === 'string'
    ? actor.room.entityReference
    : typeof actor.roomRef === 'string'
      ? actor.roomRef
      : null;

  const effectIds = Object.freeze(
    actorEffects(actor)
      .map(effectId)
      .filter(Boolean)
  );

  return Object.freeze({
    ref,
    name,
    level,
    role,
    roomRef,
    effectIds,
  });
}

/**
 * Normalize caller-provided render context into a predictable shape.
 * This keeps evaluator behavior deterministic across call sites.
 *
 * @param {{
 *  actor?: *,
 *  room?: *,
 *  area?: *,
 *  world?: *,
 *  source?: *,
 *  entity?: *,
 *  currentContainer?: *,
 * }} renderContext
 */
function normalizeRenderContext(renderContext) {
  const input = renderContext && typeof renderContext === 'object'
    ? renderContext
    : {};

  const room = input.room && typeof input.room === 'object'
    ? input.room
    : null;
  const area = input.area && typeof input.area === 'object'
    ? input.area
    : (room && room.area && typeof room.area === 'object' ? room.area : null);

  return {
    actor: Object.prototype.hasOwnProperty.call(input, 'actor') ? input.actor : null,
    room,
    area,
    world: Object.prototype.hasOwnProperty.call(input, 'world') ? input.world : null,
    source: typeof input.source === 'string' && input.source.trim().length > 0
      ? input.source.trim()
      : 'unknown',
    entity: input.entity && typeof input.entity === 'object' ? input.entity : null,
    currentContainer: input.currentContainer && typeof input.currentContainer === 'object'
      ? input.currentContainer
      : null,
  };
}

/**
 * Identify area/bundle context for area-local predicate resolution.
 *
 * @param {{ area: *, room: * }} renderContext
 * @returns {{ areaName: string, bundle: string, areaRef: string }}
 */
function areaLocator(renderContext) {
  const area = renderContext.area && typeof renderContext.area === 'object'
    ? renderContext.area
    : null;

  const areaName = typeof (area && area.name) === 'string'
    ? area.name
    : (() => {
      const roomRef = renderContext.room && typeof renderContext.room.entityReference === 'string'
        ? renderContext.room.entityReference
        : '';
      const parsedArea = String(roomRef).split(':')[0];
      return parsedArea || 'unknown';
    })();

  const bundle = typeof (area && area.bundle) === 'string'
    ? area.bundle
    : '';

  return {
    areaName,
    bundle,
    areaRef: areaName || 'unknown',
  };
}

/**
 * Route warnings to injected logger or fallback logger.
 *
 * @param {*} logger
 * @param {string} message
 */
function warn(logger, message) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message);
    return;
  }

  Logger.warn(message);
}

/**
 * Route errors to injected logger or fallback logger.
 *
 * @param {*} logger
 * @param {string} message
 */
function error(logger, message) {
  if (logger && typeof logger.error === 'function') {
    logger.error(message);
    return;
  }

  Logger.error(message);
}

/**
 * Create a render-only predicate evaluator with area-local registry loading.
 * This runtime intentionally exposes no script-public API.
 *
 * @param {{ bundlesRootPath?: string, logger?: { warn?: Function, error?: Function } }} [options]
 */
function createPredicateRuntime(options = {}) {
  const bundlesRootPath = typeof options.bundlesRootPath === 'string' && options.bundlesRootPath.trim().length > 0
    ? options.bundlesRootPath
    : DEFAULT_BUNDLES_ROOT_PATH;
  const logger = options.logger || Logger;
  const hasInjectedWarnLogger = !!(options.logger && typeof options.logger.warn === 'function');

  /** @type {Map<string, Readonly<Record<string, Function>>>} */
  const areaRegistryCache = new Map();
  /** @type {Set<string>} */
  const warnedKeys = new Set();

  /**
   * Emit non-fatal diagnostics once per (area,predicate,source,code).
   * This preserves signal without log spam in hot render paths.
   *
   * @param {string} areaRef
   * @param {string} predicateName
   * @param {string} source
   * @param {string} code
   * @param {string} message
   */
  function warnOnce(areaRef, predicateName, source, code, message) {
    const key = `${areaRef}:${predicateName}:${source}:${code}`;
    if (warnedKeys.has(key)) {
      return;
    }

    warnedKeys.add(key);
    warn(logger, message);
  }

  /**
   * Load and validate one area's predicate registry and cache the result.
   * Missing or invalid registries degrade to an empty map.
   *
   * @param {string} bundle
   * @param {string} areaName
   * @returns {Readonly<Record<string, Function>>}
   */
  function loadAreaRegistry(bundle, areaName) {
    const areaKey = `${bundle}:${areaName}`;
    if (areaRegistryCache.has(areaKey)) {
      return areaRegistryCache.get(areaKey);
    }

    /** @type {Record<string, Function>} */
    const registry = {};

    if (!bundle || !areaName) {
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    const predicatesPath = path.join(bundlesRootPath, bundle, 'areas', areaName, 'predicates.js');
    if (!fs.existsSync(predicatesPath)) {
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    let loaded;
    try {
      loaded = require(predicatesPath);
    } catch (err) {
      error(logger, `Failed to load predicate registry from [${predicatesPath}]: ${err && err.message ? err.message : String(err)}`);
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    if (!isPlainObject(loaded)) {
      error(logger, `Predicate registry [${predicatesPath}] must export an object map. Registry ignored.`);
      const frozenEmpty = Object.freeze(registry);
      areaRegistryCache.set(areaKey, frozenEmpty);
      return frozenEmpty;
    }

    for (const [predicateName, predicate] of Object.entries(loaded)) {
      if (!PREDICATE_KEY_PATTERN.test(predicateName)) {
        error(logger, `Predicate name [${predicateName}] in [${predicatesPath}] is invalid. Key ignored.`);
        continue;
      }

      if (typeof predicate !== 'function') {
        error(logger, `Predicate [${predicateName}] in [${predicatesPath}] must be a function. Key ignored.`);
        continue;
      }

      registry[predicateName] = predicate;
    }

    const frozenRegistry = Object.freeze(registry);
    areaRegistryCache.set(areaKey, frozenRegistry);
    return frozenRegistry;
  }

  /**
   * Evaluate a named predicate against normalized render context.
   * Failures never throw to callers; non-true outcomes resolve to false.
   *
   * @param {string} predicateName
   * @param {{
   *  actor?: *,
   *  room?: *,
   *  area?: *,
   *  world?: *,
   *  source?: *,
   *  entity?: *,
   *  currentContainer?: *,
   * }} [renderContext]
   * @returns {boolean}
   */
  function evaluate(predicateName, renderContext = {}) {
    const trimmedName = typeof predicateName === 'string' ? predicateName.trim() : '';
    if (!trimmedName) {
      return false;
    }

    const normalizedContext = normalizeRenderContext(renderContext);
    const areaInfo = areaLocator(normalizedContext);

    const registry = loadAreaRegistry(areaInfo.bundle, areaInfo.areaName);
    const predicate = registry[trimmedName];

    if (typeof predicate !== 'function') {
      warnOnce(
        areaInfo.areaRef,
        trimmedName,
        normalizedContext.source,
        'PREDICATE_MISSING',
        `Predicate [${trimmedName}] not found for area [${areaInfo.areaRef}] in source [${normalizedContext.source}].`
      );
      return false;
    }

    const context = Object.freeze({
      source: normalizedContext.source,
      areaRef: areaInfo.areaRef,
      roomRef: normalizedContext.room && typeof normalizedContext.room.entityReference === 'string'
        ? normalizedContext.room.entityReference
        : null,
      entityRef: normalizedContext.entity && typeof normalizedContext.entity.entityReference === 'string'
        ? normalizedContext.entity.entityReference
        : null,
    });

    const q = createQueryFacade({
      actor: normalizedContext.actor,
      room: normalizedContext.room,
      area: normalizedContext.area,
      world: normalizedContext.world,
      entity: normalizedContext.entity,
      currentContainer: normalizedContext.currentContainer,
      onQueryWarning: hasInjectedWarnLogger
        ? (code, message) => {
          warnOnce(areaInfo.areaRef, trimmedName, normalizedContext.source, code, message);
        }
        : undefined,
    });

    const input = Object.freeze({
      actor: normalizeActorView(normalizedContext.actor),
      q,
      context,
    });

    let result;
    try {
      result = predicate(input);
    } catch (err) {
      warnOnce(
        areaInfo.areaRef,
        trimmedName,
        normalizedContext.source,
        'PREDICATE_THROW',
        `Predicate [${trimmedName}] threw in area [${areaInfo.areaRef}] source [${normalizedContext.source}]: ${err && err.message ? err.message : String(err)}`
      );
      return false;
    }

    if (result !== true) {
      if (typeof result !== 'boolean') {
        warnOnce(
          areaInfo.areaRef,
          trimmedName,
          normalizedContext.source,
          'PREDICATE_INVALID_RETURN',
          `Predicate [${trimmedName}] returned non-boolean value in area [${areaInfo.areaRef}] source [${normalizedContext.source}].`
        );
      }
      return false;
    }

    return true;
  }

  return {
    evaluate,
  };
}

module.exports = {
  createPredicateRuntime,
  DEFAULT_BUNDLES_ROOT_PATH,
};
