// @ts-check
'use strict';

const Helper = require('../helpers/entity-resolution-helper');

/**
 * @typedef {import('ranvier/types/GameState')} GameState
 */

const RELATION_CANONICAL_MAP = new Map([
  ['into', 'in'],
  ['onto', 'on'],
]);

const RULE_KEYS = new Set(['intransitive', 'direct', 'indirect', 'directIndirect', 'relationOnly']);
const RELATION_BEARING_RULES = new Set(['indirect', 'directIndirect', 'relationOnly']);

/**
 * @typedef {{
 *   rules?: Record<string, {
 *     acceptedRelations?: string[],
 *     scopeProfile?: Record<string, Array<string | { source: string, nested?: boolean, maxDepth?: number }>>,
 *   }>
 * }} ResolutionDeclaration
 */

/**
 * @typedef {{
 *   ok: true,
 *   value: {
 *     ruleKey: string,
 *     directSpan: string[],
 *     indirectSpan: string[],
 *     relationTokenRaw: string | null,
 *     relationTokenCanonical: string | null,
 *     directTarget?: object,
 *     indirectTarget?: object,
 *     declaration: ResolutionDeclaration,
 *   }
 * }} EntityResolutionSuccess
 */

/**
 * @typedef {{
 *   ok: false,
 *   error: {
 *     code: string,
 *     details?: Record<string, *>,
 *   }
 * }} EntityResolutionFailure
 */

/**
 * @typedef {EntityResolutionSuccess | EntityResolutionFailure} EntityResolutionResult
 */

/**
 * @param {*} value
 * @returns {ResolutionDeclaration | null}
 */
function getDeclaration(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata : {};
  const entityResolution = metadata.entityResolution && typeof metadata.entityResolution === 'object'
    ? metadata.entityResolution
    : null;
  if (entityResolution) {
    return /** @type {ResolutionDeclaration} */ (entityResolution);
  }

  if (metadata.rules && typeof metadata.rules === 'object') {
    return /** @type {ResolutionDeclaration} */ ({ rules: metadata.rules });
  }

  return null;
}

/**
 * @param {string | null | undefined} token
 * @returns {string | null}
 */
function canonicalizeRelation(token) {
  const normalized = Helper.normalizeText(token);
  if (!normalized) {
    return null;
  }

  return RELATION_CANONICAL_MAP.get(normalized) || normalized;
}

/**
 * @param {ResolutionDeclaration} declaration
 * @returns {EntityResolutionFailure | null}
 */
function validateDeclaration(declaration) {
  const rules = declaration.rules && typeof declaration.rules === 'object' ? declaration.rules : null;
  if (!rules) {
    return {
      ok: false,
      error: {
        code: 'FORM_NOT_SUPPORTED',
        details: { reason: 'MISSING_RULES_DECLARATION' },
      },
    };
  }

  const declaredRuleKeys = Object.keys(rules).filter(key => RULE_KEYS.has(key));
  if (!declaredRuleKeys.length) {
    return {
      ok: false,
      error: {
        code: 'FORM_NOT_SUPPORTED',
        details: { reason: 'EMPTY_RULES_DECLARATION' },
      },
    };
  }

  for (const ruleKey of declaredRuleKeys) {
    if (!RELATION_BEARING_RULES.has(ruleKey)) {
      continue;
    }

    const ruleConfig = rules[ruleKey];
    const acceptedRelations = normalizeAcceptedRelations(ruleConfig && ruleConfig.acceptedRelations);
    if (!acceptedRelations.length) {
      return {
        ok: false,
        error: {
          code: 'FORM_NOT_SUPPORTED',
          details: {
            reason: 'INVALID_ACCEPTED_RELATIONS',
            ruleKey,
          },
        },
      };
    }
  }

  return null;
}

/**
 * @param {unknown} acceptedRelations
 * @returns {string[]}
 */
function normalizeAcceptedRelations(acceptedRelations) {
  if (!Array.isArray(acceptedRelations)) {
    return [];
  }

  return acceptedRelations
    .map(relation => canonicalizeRelation(String(relation)))
    .filter(Boolean);
}

/**
 * @param {ResolutionDeclaration} declaration
 * @param {string} ruleKey
 * @returns {boolean}
 */
function hasRule(declaration, ruleKey) {
  const rules = declaration.rules && typeof declaration.rules === 'object' ? declaration.rules : {};
  return Object.prototype.hasOwnProperty.call(rules, ruleKey);
}

/**
 * @param {ResolutionDeclaration} declaration
 * @param {string} ruleKey
 * @returns {Record<string, *>}
 */
function getRuleConfig(declaration, ruleKey) {
  const rules = declaration.rules && typeof declaration.rules === 'object' ? declaration.rules : {};
  const config = rules[ruleKey];
  return config && typeof config === 'object' ? config : {};
}

/**
 * @param {string[]} directSpan
 * @param {string[]} indirectSpan
 * @param {string | null} relationTokenRaw
 * @returns {string}
 */
function detectShape(directSpan, indirectSpan, relationTokenRaw) {
  const hasDirect = directSpan.length > 0;
  const hasIndirect = indirectSpan.length > 0;
  const hasRelation = !!relationTokenRaw;

  if (!hasDirect && !hasIndirect && !hasRelation) {
    return 'intransitive';
  }

  if (hasDirect && !hasIndirect && !hasRelation) {
    return 'directOnly';
  }

  if (!hasDirect && hasIndirect && hasRelation) {
    return 'indirectOnly';
  }

  if (hasDirect && hasIndirect && hasRelation) {
    return 'directIndirect';
  }

  if (!hasDirect && !hasIndirect && hasRelation) {
    return 'relationOnly';
  }

  if (hasDirect && !hasIndirect && hasRelation) {
    return 'directRelationMissingIndirect';
  }

  return 'unknown';
}

/**
 * @param {ResolutionDeclaration} declaration
 * @param {string} shape
 * @returns {{ ok: true, ruleKey: string } | EntityResolutionFailure}
 */
function selectRuleKey(declaration, shape) {
  switch (shape) {
    case 'intransitive':
      if (hasRule(declaration, 'intransitive')) {
        return { ok: true, ruleKey: 'intransitive' };
      }
      if (hasRule(declaration, 'direct') || hasRule(declaration, 'directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_DIRECT' } };
      }
      if (hasRule(declaration, 'indirect') || hasRule(declaration, 'relationOnly')) {
        return { ok: false, error: { code: 'FORM_MISSING_RELATION' } };
      }
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };

    case 'directOnly':
      if (hasRule(declaration, 'direct')) {
        return { ok: true, ruleKey: 'direct' };
      }
      if (hasRule(declaration, 'directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_INDIRECT' } };
      }
      return { ok: false, error: { code: 'FORM_DIRECT_NOT_SUPPORTED' } };

    case 'indirectOnly':
      if (hasRule(declaration, 'indirect')) {
        return { ok: true, ruleKey: 'indirect' };
      }
      if (hasRule(declaration, 'directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_DIRECT' } };
      }
      return { ok: false, error: { code: 'FORM_INDIRECT_NOT_SUPPORTED' } };

    case 'directIndirect':
      return hasRule(declaration, 'directIndirect')
        ? { ok: true, ruleKey: 'directIndirect' }
        : { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };

    case 'relationOnly':
      if (hasRule(declaration, 'relationOnly')) {
        return { ok: true, ruleKey: 'relationOnly' };
      }
      if (hasRule(declaration, 'directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_DIRECT' } };
      }
      if (hasRule(declaration, 'indirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_INDIRECT' } };
      }
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };

    case 'directRelationMissingIndirect':
      return { ok: false, error: { code: 'FORM_MISSING_INDIRECT' } };

    default:
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };
  }
}

/**
 * @param {Record<string, *>} ruleConfig
 * @param {'direct' | 'indirect'} role
 * @returns {Array<{ source: string, nested: boolean, maxDepth: number }>}
 */
function scopeProfileForRole(ruleConfig, role) {
  const profile = ruleConfig.scopeProfile && typeof ruleConfig.scopeProfile === 'object'
    ? ruleConfig.scopeProfile
    : {};

  const roleScopes = Array.isArray(profile[role]) ? profile[role] : [];
  return roleScopes.map(scope => normalizeScope(scope));
}

/**
 * @param {string | { source: string, nested?: boolean, maxDepth?: number }} scope
 * @returns {{ source: string, nested: boolean, maxDepth: number }}
 */
function normalizeScope(scope) {
  if (typeof scope === 'string') {
    const normalizedSource = scope.endsWith('.nested') ? scope.replace(/\.nested$/u, '') : scope;
    return {
      source: normalizedSource,
      nested: scope.endsWith('.nested'),
      maxDepth: Helper.DEFAULT_MAX_NESTED_DEPTH,
    };
  }

  if (scope && typeof scope === 'object') {
    return {
      source: String(scope.source || ''),
      nested: !!scope.nested,
      maxDepth: typeof scope.maxDepth === 'number'
        ? Math.max(0, Math.floor(scope.maxDepth))
        : Helper.DEFAULT_MAX_NESTED_DEPTH,
    };
  }

  return {
    source: '',
    nested: false,
    maxDepth: Helper.DEFAULT_MAX_NESTED_DEPTH,
  };
}

/**
 * @param {*} player
 * @param {Array<{ source: string, nested: boolean, maxDepth: number }>} scopes
 * @returns {Array<{ item: object, scopeIndex: number, depth: number, declarationOrder: number }>}
 */
function collectCandidates(player, scopes) {
  /** @type {Array<{ item: object, scopeIndex: number, depth: number, declarationOrder: number }>} */
  const entries = [];

  for (const [scopeIndex, scope] of scopes.entries()) {
    const baseItems = readScopeItems(player, scope.source);
    const nestedEntries = scope.nested
      ? Helper.getNestedCandidateEntries(baseItems, { maxDepth: scope.maxDepth })
      : baseItems.map((item, declarationOrder) => ({ item, depth: 0, declarationOrder }));

    for (const entry of nestedEntries) {
      entries.push({
        item: entry.item,
        scopeIndex,
        depth: entry.depth,
        declarationOrder: entry.declarationOrder,
      });
    }
  }

  return entries;
}

/**
 * Resolve one scope source identifier into a read-only list of candidate
 * objects for role binding.
 *
 * This is the single scope-to-data switch used by the resolver. Each supported
 * source (for example `player.inventory`, `room.items`, `room.details`,
 * `room.exits`) returns deterministic candidates without mutating game state.
 *
 * @param {*} player
 * @param {string} source
 * @returns {Array<object>}
 */
function readScopeItems(player, source) {
  switch (source) {
    case 'player.inventory':
      return Helper.getPlayerInventoryItems(player);
    case 'room.items':
      return Helper.getRoomItems(player);
    case 'room.details':
      return Helper.getRoomDetails(player);
    case 'room.exits':
      return readExitCandidates(player);
    default:
      return [];
  }
}

/**
 * @param {*} player
 * @returns {Array<object>}
 */
function readExitCandidates(player) {
  const exits = Helper.getRoomExits(player);

  return exits
    .map((exit, index) => toExitCandidate(exit, index))
    .filter(Boolean);
}

/**
 * @param {*} exit
 * @param {number} index
 * @returns {object | null}
 */
function toExitCandidate(exit, index) {
  if (!exit || typeof exit !== 'object') {
    return null;
  }

  const direction = Helper.normalizeText(exit.direction);
  if (!direction) {
    return null;
  }

  const roomId = String(exit.roomId || '').trim();
  const metadata = exit.metadata && typeof exit.metadata === 'object'
    ? exit.metadata
    : {};

  return {
    name: direction,
    keywords: [direction],
    roomId,
    direction,
    metadata,
    uuid: `exit:${direction}:${roomId || 'none'}:${index}`,
  };
}

/**
 * @param {'direct' | 'indirect'} role
 * @param {string[]} span
 * @param {*} player
 * @param {Array<{ source: string, nested: boolean, maxDepth: number }>} scopes
 * @returns {{ ok: true, target: object } | EntityResolutionFailure}
 */
function bindRole(role, span, player, scopes) {
  const candidates = collectCandidates(player, scopes)
    .map(candidate => ({
      ...candidate,
      matchScore: Helper.computeMatchScore(candidate.item, span),
    }))
    .filter(candidate => candidate.matchScore > 0);

  if (!candidates.length) {
    return {
      ok: false,
      error: {
        code: 'TARGET_NOT_FOUND',
        details: { role },
      },
    };
  }

  const bestScopeIndex = Math.min(...candidates.map(candidate => candidate.scopeIndex));
  const scopeFiltered = candidates.filter(candidate => candidate.scopeIndex === bestScopeIndex);

  const bestScore = Math.max(...scopeFiltered.map(candidate => candidate.matchScore));
  const scoreFiltered = scopeFiltered.filter(candidate => candidate.matchScore === bestScore);

  const bestDepth = Math.min(...scoreFiltered.map(candidate => candidate.depth));
  const depthFiltered = scoreFiltered.filter(candidate => candidate.depth === bestDepth);

  if (depthFiltered.length === 1) {
    return { ok: true, target: depthFiltered[0].item };
  }

  const signatures = new Set(depthFiltered.map(candidate => Helper.visibilitySignature(candidate.item)));
  const ordered = [...depthFiltered].sort(compareByDeclarationThenUuid);

  if (signatures.size === 1) {
    return { ok: true, target: ordered[0].item };
  }

  return {
    ok: false,
    error: {
      code: 'AMBIGUOUS_TARGET',
      details: { role },
    },
  };
}

/**
 * @param {{ declarationOrder: number, item: object }} a
 * @param {{ declarationOrder: number, item: object }} b
 * @returns {number}
 */
function compareByDeclarationThenUuid(a, b) {
  if (a.declarationOrder !== b.declarationOrder) {
    return a.declarationOrder - b.declarationOrder;
  }

  const aUuid = Helper.normalizeText(a.item && a.item.uuid);
  const bUuid = Helper.normalizeText(b.item && b.item.uuid);
  if (aUuid < bUuid) {
    return -1;
  }
  if (aUuid > bUuid) {
    return 1;
  }
  return 0;
}

/**
 * @param {GameState} state
 * @param {*} command
 * @param {*} player
 * @param {*} parsedInput
 * @returns {EntityResolutionResult}
 */
function resolveEntityContext(state, command, player, parsedInput) {
  const declaration = getDeclaration(command);
  if (!declaration) {
    return {
      ok: true,
      value: {
        ruleKey: 'legacy',
        directSpan: [],
        indirectSpan: [],
        relationTokenRaw: null,
        relationTokenCanonical: null,
        declaration: { rules: {} },
      },
    };
  }

  const declarationError = validateDeclaration(declaration);
  if (declarationError) {
    return declarationError;
  }

  const directSpan = Helper.normalizeTokenList(parsedInput && parsedInput.primaryTargetSpan);
  const indirectSpan = Helper.normalizeTokenList(parsedInput && parsedInput.secondaryTargetSpan);
  const relationTokenRaw = Helper.normalizeText(parsedInput && parsedInput.relationToken) || null;
  const relationTokenCanonical = canonicalizeRelation(relationTokenRaw);

  const shape = detectShape(directSpan, indirectSpan, relationTokenRaw);
  const selectedRule = selectRuleKey(declaration, shape);
  if (!selectedRule.ok) {
    return selectedRule;
  }

  const ruleKey = selectedRule.ruleKey;
  const ruleConfig = getRuleConfig(declaration, ruleKey);

  if (RELATION_BEARING_RULES.has(ruleKey)) {
    const acceptedRelations = normalizeAcceptedRelations(ruleConfig.acceptedRelations);
    if (!relationTokenCanonical || !acceptedRelations.includes(relationTokenCanonical)) {
      return {
        ok: false,
        error: {
          code: 'FORM_UNSUPPORTED_RELATION',
          details: {
            ruleKey,
            relationTokenRaw,
            relationTokenCanonical,
          },
        },
      };
    }
  }

  const value = {
    ruleKey,
    directSpan,
    indirectSpan,
    relationTokenRaw,
    relationTokenCanonical,
    declaration,
  };

  if (ruleKey === 'intransitive' || ruleKey === 'relationOnly' || ruleKey === 'legacy') {
    return { ok: true, value };
  }

  if (ruleKey === 'direct' || ruleKey === 'directIndirect') {
    const directScopes = scopeProfileForRole(ruleConfig, 'direct');
    const directResult = bindRole('direct', directSpan, player, directScopes);
    if (!directResult.ok) {
      return directResult;
    }

    value.directTarget = directResult.target;
  }

  if (ruleKey === 'indirect' || ruleKey === 'directIndirect') {
    const indirectScopes = scopeProfileForRole(ruleConfig, 'indirect');
    const indirectResult = bindRole('indirect', indirectSpan, player, indirectScopes);
    if (!indirectResult.ok) {
      return indirectResult;
    }

    value.indirectTarget = indirectResult.target;
  }

  return { ok: true, value };
}

module.exports = {
  RULE_KEYS,
  canonicalizeRelation,
  getDeclaration,
  resolveEntityContext,
};
