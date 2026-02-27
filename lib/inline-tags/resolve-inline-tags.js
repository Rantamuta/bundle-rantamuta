// @ts-check
'use strict';

const crypto = require('crypto');
const { Logger } = require('ranvier');
const { createPredicateRuntime } = require('../helpers/predicate-runtime');
const { parseInlineTags } = require('./parse-inline-tags');
const { renderInlineTags } = require('./render-inline-tags');
const { createInlineTagCache, DEFAULT_MAX_ENTRIES } = require('./inline-tag-cache');

const DEFAULT_INLINE_TAG_CACHE_CAPACITY = DEFAULT_MAX_ENTRIES;
const singletonRuntime = createPredicateRuntime();
const singletonCache = createInlineTagCache({ maxEntries: DEFAULT_INLINE_TAG_CACHE_CAPACITY });

/**
 * @param {*} entity
 * @returns {string}
 */
function deriveEntityRef(entity) {
  if (!entity || typeof entity !== 'object') {
    return 'unknown';
  }

  if (typeof entity.entityReference === 'string' && entity.entityReference.trim().length > 0) {
    return entity.entityReference.trim();
  }

  if (typeof entity.ref === 'string' && entity.ref.trim().length > 0) {
    return entity.ref.trim();
  }

  if (entity.area && typeof entity.area === 'object' && typeof entity.area.name === 'string' && typeof entity.id === 'string') {
    return `${entity.area.name}:${entity.id}`;
  }

  return 'unknown';
}

/**
 * @param {*} entityOrRef
 * @param {string} surface
 * @returns {string}
 */
function buildSurfaceRef(entityOrRef, surface) {
  const entityRef = typeof entityOrRef === 'string' && entityOrRef.trim().length > 0
    ? entityOrRef.trim()
    : deriveEntityRef(entityOrRef);
  const normalizedSurface = typeof surface === 'string' && surface.trim().length > 0
    ? surface.trim()
    : 'unknown';

  return `${entityRef}|${normalizedSurface}`;
}

/**
 * @param {string} sourceText
 * @returns {string}
 */
function sourceHash(sourceText) {
  return crypto
    .createHash('sha1')
    .update(sourceText, 'utf8')
    .digest('hex');
}

/**
 * @param {{ logger?: *, renderContext?: Record<string, *> }} options
 * @returns {{ warn?: Function }}
 */
function resolveLogger(options) {
  if (options && options.logger && typeof options.logger.warn === 'function') {
    return options.logger;
  }

  const world = options && options.renderContext && options.renderContext.world && typeof options.renderContext.world === 'object'
    ? options.renderContext.world
    : null;

  if (world && world.Logger && typeof world.Logger.warn === 'function') {
    return world.Logger;
  }

  if (world && world.logger && typeof world.logger.warn === 'function') {
    return world.logger;
  }

  return Logger;
}

/**
 * @param {{ warn?: Function }} logger
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
 * Resolve inline tags to plain text using parser + cache + render runtime.
 *
 * @param {string} sourceText
 * @param {{
 *  surfaceRef?: string,
 *  cache?: { get?: Function, set?: Function },
 *  runtime?: { evaluate?: Function },
 *  renderContext?: Record<string, *>,
 *  logger?: { warn?: Function },
 * }} [options]
 * @returns {string}
 */
function resolveInlineTags(sourceText, options = {}) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    return sourceText;
  }

  const surfaceRef = typeof options.surfaceRef === 'string' && options.surfaceRef.trim().length > 0
    ? options.surfaceRef.trim()
    : 'unknown|unknown';

  const cache = options.cache && typeof options.cache.get === 'function' && typeof options.cache.set === 'function'
    ? options.cache
    : singletonCache;

  const renderContext = options.renderContext && typeof options.renderContext === 'object'
    ? options.renderContext
    : {};

  const runtime = options.runtime && typeof options.runtime.evaluate === 'function'
    ? options.runtime
    : renderContext && renderContext.world && renderContext.world.PredicateRuntime && typeof renderContext.world.PredicateRuntime.evaluate === 'function'
      ? renderContext.world.PredicateRuntime
      : singletonRuntime;

  const logger = resolveLogger({
    logger: options.logger,
    renderContext,
  });

  const cacheKey = `${surfaceRef}:${sourceHash(sourceText)}`;
  let compiled = cache.get(cacheKey);
  if (!compiled) {
    compiled = parseInlineTags(sourceText);
    cache.set(cacheKey, compiled);
  }

  const diagnostics = Array.isArray(compiled && compiled.diagnostics)
    ? compiled.diagnostics
    : [];

  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      const code = diagnostic && typeof diagnostic.code === 'string' ? diagnostic.code : 'E_INLINE_TAG_PARSE';
      const message = diagnostic && typeof diagnostic.message === 'string'
        ? diagnostic.message
        : 'inline-tag parse failure';
      warn(logger, `INLINE_TAG_PARSE ${code} surface=${surfaceRef}: ${message}`);
    }

    return sourceText;
  }

  try {
    return renderInlineTags(compiled.ast, runtime, renderContext);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    warn(logger, `INLINE_TAG_RENDER E_RENDER_FAILURE surface=${surfaceRef}: ${message}`);
    return sourceText;
  }
}

module.exports = {
  resolveInlineTags,
  buildSurfaceRef,
  DEFAULT_INLINE_TAG_CACHE_CAPACITY,
};
