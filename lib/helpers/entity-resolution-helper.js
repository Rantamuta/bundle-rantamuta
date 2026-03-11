// @ts-check
'use strict';

const DEFAULT_MAX_NESTED_DEPTH = 4;

/**
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {*} value
 * @returns {string[]}
 */
function normalizeTokenList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeText).filter(Boolean);
}

/**
 * @param {*} collection
 * @returns {Array<object>}
 */
function getCollectionValues(collection) {
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
 * @param {*} player
 * @returns {Array<object>}
 */
function getPlayerInventoryItems(player) {
  return getCollectionValues(player && player.inventory);
}

/**
 * @param {*} player
 * @returns {Array<object>}
 */
function getRoomItems(player) {
  const room = player && player.room;
  return getCollectionValues(room && room.items);
}

/**
 * @param {*} player
 * @returns {Array<object>}
 */
function getRoomPlayers(player) {
  const room = player && player.room;
  return getCollectionValues(room && room.players);
}

/**
 * @param {*} player
 * @returns {Array<object>}
 */
function getRoomNpcs(player) {
  const room = player && player.room;
  return getCollectionValues(room && room.npcs);
}

/**
 * @param {*} player
 * @returns {Array<object>}
 */
function getRoomExits(player) {
  const room = player && player.room;
  if (!room || typeof room !== 'object') {
    return [];
  }

  if (typeof room.getExits === 'function') {
    return getCollectionValues(room.getExits());
  }

  return getCollectionValues(room.exits);
}

/**
 * Read room-authored detail definitions from `room.metadata.details` and
 * normalize them into resolver candidates.
 *
 * Details are lightweight, look-oriented nouns that can participate in entity
 * resolution without being full runtime Item instances.
 *
 * @param {*} player
 * @returns {Array<object>}
 */
function getRoomDetails(player) {
  const room = player && player.room;
  if (!room || typeof room !== 'object') {
    return [];
  }

  const metadata = room.metadata && typeof room.metadata === 'object'
    ? room.metadata
    : null;
  const rawDetails = metadata && Array.isArray(metadata.details)
    ? metadata.details
    : [];

  const roomRef = normalizeText(room.entityReference) || normalizeText(room.id) || 'room';

  return rawDetails
    .map((detail, index) => toDetailCandidate(detail, index, roomRef))
    .filter(Boolean);
}

/**
 * Convert one raw room detail definition into a deterministic candidate object
 * used by the resolver. The candidate is intentionally item-shaped (`name`,
 * `keywords`, `uuid`) so existing token scoring and tie-break rules can be
 * reused without special-case branches.
 *
 * @param {*} detail
 * @param {number} index
 * @param {string} roomRef
 * @returns {object | null}
 */
function toDetailCandidate(detail, index, roomRef) {
  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const detailObject = /** @type {Record<string, *>} */ (detail);
  const id = normalizeText(detailObject.id) || `detail-${index}`;
  const name = normalizeText(detailObject.name) || id;
  const keywords = normalizeTokenList(detailObject.keywords);
  const metadata = detailObject.metadata && typeof detailObject.metadata === 'object'
    ? { ...detailObject.metadata }
    : {};

  return {
    kind: 'roomDetail',
    detailId: id,
    name,
    keywords,
    description: detailObject.description,
    verbs: detailObject.verbs,
    metadata,
    uuid: `detail:${roomRef}:${id}:${index}`,
  };
}

/**
 * @param {*} container
 * @returns {Array<object>}
 */
function getContainerItems(container) {
  return getCollectionValues(container && container.inventory);
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isContainerLike(value) {
  return !!value && typeof value === 'object' && !!value.inventory;
}

/**
 * @param {*} value
 * @returns {string}
 */
function getUuid(value) {
  return normalizeText(value && value.uuid);
}

/**
 * @param {Array<object>} baseItems
 * @param {{ maxDepth?: number }} options
 * @returns {Array<{ item: object, depth: number, declarationOrder: number }>}
 */
function getNestedCandidateEntries(baseItems, options = {}) {
  const maxDepth = typeof options.maxDepth === 'number'
    ? Math.max(0, Math.floor(options.maxDepth))
    : DEFAULT_MAX_NESTED_DEPTH;

  /** @type {Array<{ item: object, depth: number, declarationOrder: number }>} */
  const entries = [];
  /** @type {Set<string>} */
  const seenContainerKeys = new Set();
  /** @type {WeakSet<object>} */
  const seenContainerRefs = new WeakSet();

  let depthZeroOrder = 0;
  /** @type {Array<object>} */
  let currentContainers = [];

  for (const item of baseItems) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    entries.push({ item, depth: 0, declarationOrder: depthZeroOrder });
    depthZeroOrder += 1;

    if (isContainerLike(item) && maxDepth > 0 && markContainerSeen(item, seenContainerKeys, seenContainerRefs)) {
      currentContainers.push(item);
    }
  }

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    if (!currentContainers.length) {
      break;
    }

    let declarationOrder = 0;
    /** @type {Array<object>} */
    const nextContainers = [];

    for (const container of currentContainers) {
      const children = getContainerItems(container);

      for (const child of children) {
        if (!child || typeof child !== 'object') {
          continue;
        }

        entries.push({ item: child, depth, declarationOrder });
        declarationOrder += 1;

        if (isContainerLike(child) && markContainerSeen(child, seenContainerKeys, seenContainerRefs)) {
          nextContainers.push(child);
        }
      }
    }

    currentContainers = nextContainers;
  }

  return entries;
}

/**
 * @param {object} container
 * @param {Set<string>} seenContainerKeys
 * @param {WeakSet<object>} seenContainerRefs
 * @returns {boolean}
 */
function markContainerSeen(container, seenContainerKeys, seenContainerRefs) {
  const uuid = getUuid(container);
  if (uuid) {
    if (seenContainerKeys.has(uuid)) {
      return false;
    }

    seenContainerKeys.add(uuid);
    return true;
  }

  if (seenContainerRefs.has(container)) {
    return false;
  }

  seenContainerRefs.add(container);
  return true;
}

/**
 * @param {object} item
 * @returns {Set<string>}
 */
function itemTokenSet(item) {
  const tokens = new Set();
  const name = normalizeText(item && item.name);
  if (name) {
    tokens.add(name);
    for (const token of name.split(/\s+/u)) {
      if (token) {
        tokens.add(token);
      }
    }
  }

  for (const keyword of normalizeTokenList(item && item.keywords)) {
    tokens.add(keyword);
    for (const token of keyword.split(/\s+/u)) {
      if (token) {
        tokens.add(token);
      }
    }
  }

  return tokens;
}

/**
 * @param {object} item
 * @returns {Set<string>}
 */
function itemKeywordPhraseSet(item) {
  const phrases = new Set();

  for (const keyword of normalizeTokenList(item && item.keywords)) {
    phrases.add(keyword);
  }

  return phrases;
}

/**
 * @param {object} item
 * @param {string[]} span
 * @returns {number}
 */
function computeMatchScore(item, span) {
  const normalizedSpan = normalizeTokenList(span);
  if (!normalizedSpan.length) {
    return 0;
  }

  const phrase = normalizedSpan.join(' ');
  const name = normalizeText(item && item.name);
  if (name && name === phrase) {
    return 3;
  }

  const keywordPhrases = itemKeywordPhraseSet(item);
  if (keywordPhrases.has(phrase)) {
    return 2;
  }

  const noun = normalizedSpan[normalizedSpan.length - 1];
  const qualifiers = normalizedSpan.slice(0, -1);
  const tokens = itemTokenSet(item);

  if (!tokens.has(noun)) {
    return 0;
  }

  if (!qualifiers.every(qualifier => tokens.has(qualifier))) {
    return 0;
  }

  return 1;
}

/**
 * @param {*} item
 * @returns {string}
 */
function visibilitySignature(item) {
  const metadata = item && item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  const resolutionMetadata = metadata && metadata.resolution && typeof metadata.resolution === 'object'
    ? metadata.resolution
    : {};

  const displayNameNormalized = normalizeText(item && item.name);
  const disambiguationLabelNormalized = normalizeText(resolutionMetadata.disambiguationLabel);
  const descriptors = normalizeTokenList(resolutionMetadata.descriptors);

  const visibleStateBits = [];
  if (item && item.isEquipped) {
    visibleStateBits.push('equipped');
  }
  if (item && item.closed) {
    visibleStateBits.push('closed');
  }
  if (item && item.locked) {
    visibleStateBits.push('locked');
  }

  return JSON.stringify({
    displayNameNormalized,
    disambiguationLabelNormalized,
    visibleDescriptorsNormalized: descriptors,
    visibleStateBits,
  });
}

module.exports = {
  DEFAULT_MAX_NESTED_DEPTH,
  normalizeText,
  normalizeTokenList,
  getCollectionValues,
  getPlayerInventoryItems,
  getRoomItems,
  getRoomPlayers,
  getRoomNpcs,
  getRoomExits,
  getRoomDetails,
  getContainerItems,
  getNestedCandidateEntries,
  computeMatchScore,
  visibilitySignature,
};
