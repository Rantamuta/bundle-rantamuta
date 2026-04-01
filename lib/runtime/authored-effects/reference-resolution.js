// @ts-check
'use strict';

const DOCUMENTED_CONTEXT_SYMBOLS = new Set([
  'player',
  'actor',
  'npc',
  'room',
  'area',
  'inventory',
]);

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * @param {Record<string, *>} scope
 * @param {string} symbol
 * @returns {* | null}
 */
function resolveContextSymbol(scope, symbol) {
  const normalized = normalizeText(symbol);
  if (!normalized || !DOCUMENTED_CONTEXT_SYMBOLS.has(normalized)) {
    return null;
  }

  return Object.prototype.hasOwnProperty.call(scope, normalized)
    ? scope[normalized]
    : null;
}

/**
 * @param {Record<string, *>} scope
 * @returns {string}
 */
function currentAreaRef(scope) {
  const explicitArea = scope && typeof scope === 'object'
    ? scope.area
    : null;
  const roomArea = scope && typeof scope === 'object' && scope.room && typeof scope.room === 'object'
    ? scope.room.area
    : null;
  const area = explicitArea && typeof explicitArea === 'object'
    ? explicitArea
    : roomArea && typeof roomArea === 'object'
      ? roomArea
      : null;

  const entityReference = normalizeText(area && area.entityReference);
  return entityReference || '';
}

/**
 * Expand a room reference according to the authored-effects DSL contract:
 * bare room ids are current-area relative, while qualified refs stay explicit.
 *
 * @param {Record<string, *>} scope
 * @param {*} value
 * @returns {string}
 */
function expandRoomRef(scope, value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }

  if (normalized.includes(':')) {
    return normalized;
  }

  const areaRef = currentAreaRef(scope);
  if (!areaRef) {
    return '';
  }

  return `${areaRef}:${normalized}`;
}

module.exports = {
  DOCUMENTED_CONTEXT_SYMBOLS,
  resolveContextSymbol,
  currentAreaRef,
  expandRoomRef,
};
