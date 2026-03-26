// @ts-check
'use strict';

const Helper = require('../../helpers/entity-resolution-helper');
const GoExitHookHelper = require('../../doors/go-exit-hook-helper');
const Syntax = require('./verb-local-syntax');

/**
 * @typedef {import('ranvier/types/GameState')} GameState
 */

const RELATION_BEARING_RULES = new Set(['indirect', 'directIndirect', 'relationOnly']);
const RELATION_TOKENS = new Set(['in', 'on', 'from', 'with', 'to', 'into', 'onto', 'off', 'over', 'under']);

/**
 * @typedef {{
 *   syntaxRules?: string[],
 *   compiledRules?: Array<import('./verb-local-syntax').CompiledRule>,
 *   rules?: Record<string, {
 *     acceptedRelations?: string[],
 *     allowUnresolvedIndirect?: boolean,
 *     scopeProfile?: Record<string, Array<string | { source: string, nested?: boolean, maxDepth?: number }>>,
 *   }>
 * }} ResolutionDeclaration
 */

function getDeclaration(command, verbId) {
  if (!command || typeof command !== 'object') {
    return null;
  }

  const metadata = command.metadata && typeof command.metadata === 'object'
    ? command.metadata
    : {};
  const entityResolution = metadata.entityResolution && typeof metadata.entityResolution === 'object'
    ? metadata.entityResolution
    : {};
  const syntaxRules = Array.isArray(metadata.syntaxRules)
    ? metadata.syntaxRules.map(rule => String(rule || '').trim()).filter(Boolean)
    : null;
  const precompiledRules = Array.isArray(metadata.compiledRules)
    ? metadata.compiledRules
    : null;
  const legacyRules = entityResolution.rules && typeof entityResolution.rules === 'object'
    ? entityResolution.rules
    : metadata.rules && typeof metadata.rules === 'object'
      ? metadata.rules
      : null;

  if (syntaxRules === null && !legacyRules) {
    return null;
  }

  const declaration = {
    rules: legacyRules || {},
    syntaxRules,
  };

  declaration.compiledRules = precompiledRules || (Array.isArray(declaration.syntaxRules)
    ? Syntax.compileSyntaxRules(verbId, declaration.syntaxRules)
    : []);
  return declaration;
}

function normalizeAcceptedRelations(acceptedRelations) {
  if (!Array.isArray(acceptedRelations)) {
    return [];
  }

  return acceptedRelations
    .map(relation => Syntax.canonicalizeRelation(String(relation)))
    .filter(Boolean);
}

function validateDeclaration(declaration) {
  if (!declaration) {
    return {
      ok: false,
      error: {
        code: 'FORM_NOT_SUPPORTED',
        details: { reason: 'MISSING_RULES_DECLARATION' },
      },
    };
  }

  for (const [ruleKey, ruleConfig] of Object.entries(declaration.rules || {})) {
    if (!RELATION_BEARING_RULES.has(ruleKey)) {
      continue;
    }

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

  if (!Array.isArray(declaration.syntaxRules) || !declaration.syntaxRules.length) {
    return {
      ok: false,
      error: {
        code: 'FORM_NOT_SUPPORTED',
        details: { reason: 'EMPTY_RULES_DECLARATION' },
      },
    };
  }

  return null;
}

function getRuleConfig(declaration, ruleKey) {
  const rules = declaration && declaration.rules && typeof declaration.rules === 'object'
    ? declaration.rules
    : {};
  const config = rules[ruleKey];
  return config && typeof config === 'object' ? config : {};
}

function detectLegacyShape(bodyTokens) {
  const normalizedBody = Helper.normalizeTokenList(bodyTokens);
  const relationIndex = normalizedBody.findIndex(token => RELATION_TOKENS.has(token));
  const directSpan = relationIndex >= 0
    ? normalizedBody.slice(0, relationIndex)
    : normalizedBody.slice();
  const indirectSpan = relationIndex >= 0
    ? normalizedBody.slice(relationIndex + 1)
    : [];
  const relationTokenRaw = relationIndex >= 0 ? normalizedBody[relationIndex] : null;
  const relationTokenCanonical = relationTokenRaw ? Syntax.canonicalizeRelation(relationTokenRaw) : null;

  const hasDirect = directSpan.length > 0;
  const hasIndirect = indirectSpan.length > 0;
  const hasRelation = !!relationTokenRaw;

  let shape = 'unknown';
  if (!hasDirect && !hasIndirect && !hasRelation) {
    shape = 'intransitive';
  } else if (hasDirect && !hasIndirect && !hasRelation) {
    shape = 'directOnly';
  } else if (!hasDirect && hasIndirect && hasRelation) {
    shape = 'indirectOnly';
  } else if (hasDirect && hasIndirect && hasRelation) {
    shape = 'directIndirect';
  } else if (!hasDirect && !hasIndirect && hasRelation) {
    shape = 'relationOnly';
  } else if (hasDirect && !hasIndirect && hasRelation) {
    shape = 'directRelationMissingIndirect';
  }

  return {
    directSpan,
    indirectSpan,
    relationTokenRaw,
    relationTokenCanonical,
    shape,
  };
}

function selectLegacyRuleKey(declaration, shape) {
  const hasRule = (ruleKey) => Object.prototype.hasOwnProperty.call(declaration.rules || {}, ruleKey);

  switch (shape) {
    case 'intransitive':
      if (hasRule('intransitive')) {
        return { ok: true, ruleKey: 'intransitive' };
      }
      if (hasRule('direct') || hasRule('directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_DIRECT' } };
      }
      if (hasRule('indirect') || hasRule('relationOnly')) {
        return { ok: false, error: { code: 'FORM_MISSING_RELATION' } };
      }
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };

    case 'directOnly':
      if (hasRule('direct')) {
        return { ok: true, ruleKey: 'direct' };
      }
      if (hasRule('directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_INDIRECT' } };
      }
      return { ok: false, error: { code: 'FORM_DIRECT_NOT_SUPPORTED' } };

    case 'indirectOnly':
      if (hasRule('indirect')) {
        return { ok: true, ruleKey: 'indirect' };
      }
      if (hasRule('directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_DIRECT' } };
      }
      return { ok: false, error: { code: 'FORM_INDIRECT_NOT_SUPPORTED' } };

    case 'directIndirect':
      if (hasRule('directIndirect')) {
        return { ok: true, ruleKey: 'directIndirect' };
      }
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };

    case 'relationOnly':
      if (hasRule('relationOnly')) {
        return { ok: true, ruleKey: 'relationOnly' };
      }
      if (hasRule('directIndirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_DIRECT' } };
      }
      if (hasRule('indirect')) {
        return { ok: false, error: { code: 'FORM_MISSING_INDIRECT' } };
      }
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };

    case 'directRelationMissingIndirect':
      return { ok: false, error: { code: 'FORM_MISSING_INDIRECT' } };

    default:
      return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };
  }
}

function scopeProfileForRole(ruleConfig, role) {
  const profile = ruleConfig.scopeProfile && typeof ruleConfig.scopeProfile === 'object'
    ? ruleConfig.scopeProfile
    : {};

  const roleScopes = Array.isArray(profile[role]) ? profile[role] : [];
  return roleScopes.map(scope => normalizeScope(scope));
}

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

function readScopeItems(player, source) {
  switch (source) {
    case 'player.inventory':
      return Helper.getPlayerInventoryItems(player);
    case 'room.items':
      return Helper.getRoomItems(player);
    case 'room.npcs':
      return Helper.getRoomNpcs(player);
    case 'room.details':
      return Helper.getRoomDetails(player);
    case 'room.exits':
      return readExitCandidates(player);
    default:
      return [];
  }
}

function readExitCandidates(player) {
  const exits = Helper.getRoomExits(player);
  return exits.map((exit, index) => toExitCandidate(exit, index)).filter(Boolean);
}

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

  const candidate = {
    name: direction,
    keywords: [direction],
    roomId,
    direction,
    metadata,
    uuid: `exit:${direction}:${roomId || 'none'}:${index}`,
  };
  const authoredCanDirect = typeof exit.canDirect === 'function' ? exit.canDirect : null;
  const authoredPlanDirect = typeof exit.planDirect === 'function' ? exit.planDirect : null;
  const fallbackGoCanDirect = GoExitHookHelper.createFallbackGoCanDirect(candidate);
  const fallbackGoPlanDirect = GoExitHookHelper.createFallbackGoPlanDirect(candidate);

  candidate.canDirect = (actor, verbId, context) => {
    const fallbackDecision = fallbackGoCanDirect(actor, verbId, context);
    if (fallbackDecision !== null && fallbackDecision !== undefined) {
      return fallbackDecision;
    }

    return authoredCanDirect ? authoredCanDirect(actor, verbId, context) : null;
  };

  candidate.planDirect = (actor, verbId, context) => {
    const fallbackContribution = fallbackGoPlanDirect(actor, verbId, context);
    if (GoExitHookHelper.isContributionFailure(fallbackContribution)) {
      return fallbackContribution;
    }

    const authoredContribution = authoredPlanDirect
      ? authoredPlanDirect(actor, verbId, context)
      : null;
    if (authoredContribution === null || authoredContribution === undefined) {
      return fallbackContribution;
    }

    if (GoExitHookHelper.isContributionFailure(authoredContribution)) {
      return authoredContribution;
    }

    if (GoExitHookHelper.contributionRequestsReplaceSuccess(authoredContribution)) {
      const strippedFallback = GoExitHookHelper.stripGoDoorFlavorRender(fallbackContribution);
      if (strippedFallback === null || strippedFallback === undefined) {
        return authoredContribution;
      }
      return mergePlanContributionPayloads(strippedFallback, authoredContribution);
    }

    if (fallbackContribution === null || fallbackContribution === undefined) {
      return authoredContribution;
    }

    return mergePlanContributionPayloads(fallbackContribution, authoredContribution);
  };

  return candidate;
}

function contributionOperations(contribution) {
  if (!contribution || typeof contribution !== 'object') {
    return [];
  }

  const plan = contribution.plan;
  return plan && typeof plan === 'object' && Array.isArray(plan.operations)
    ? plan.operations
    : [];
}

function contributionRenderMessages(contribution) {
  if (!contribution || typeof contribution !== 'object') {
    return [];
  }

  const render = contribution.render;
  return render && typeof render === 'object' && Array.isArray(render.messages)
    ? render.messages
    : [];
}

function contributionReplaceSuccess(contribution) {
  return GoExitHookHelper.contributionRequestsReplaceSuccess(contribution);
}

function mergePlanContributionPayloads(fallbackContribution, authoredContribution) {
  if (!fallbackContribution || typeof fallbackContribution !== 'object') {
    return authoredContribution;
  }
  if (!authoredContribution || typeof authoredContribution !== 'object') {
    return fallbackContribution;
  }

  const mergedOperations = [
    ...contributionOperations(fallbackContribution),
    ...contributionOperations(authoredContribution),
  ];
  const mergedRenderMessages = [
    ...contributionRenderMessages(fallbackContribution),
    ...contributionRenderMessages(authoredContribution),
  ];
  const replaceSuccess = contributionReplaceSuccess(fallbackContribution) || contributionReplaceSuccess(authoredContribution);

  const merged = {};
  if (mergedOperations.length) {
    merged.plan = { operations: mergedOperations };
  }
  if (mergedRenderMessages.length) {
    merged.render = { messages: mergedRenderMessages };
  }
  if (replaceSuccess) {
    merged.renderPolicy = { replaceSuccess: true };
  }

  return merged;
}

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

function defaultScopesFor(role, slotKind) {
  if (slotKind === 'EXIT') {
    return [normalizeScope('room.exits')];
  }

  if (slotKind === 'LIVING') {
    return [normalizeScope('room.npcs')];
  }

  if (role === 'indirect') {
    return [normalizeScope('player.inventory'), normalizeScope('room.items'), normalizeScope('room.npcs')];
  }

  return [
    normalizeScope('room.items'),
    normalizeScope('room.npcs'),
    normalizeScope('room.details'),
    normalizeScope('player.inventory'),
  ];
}

function resolveEntitySlot(slot, player, scopes) {
  const effectiveScopes = scopes.length ? scopes : defaultScopesFor(slot.role || 'direct', slot.kind);
  const candidates = collectCandidates(player, effectiveScopes)
    .map(candidate => ({
      ...candidate,
      matchScore: Helper.computeMatchScore(candidate.item, slot.tokens),
    }))
    .filter(candidate => candidate.matchScore > 0)
    .filter(candidate => slot.kind !== 'LIVING' || !!candidate.item.isNpc);

  if (!candidates.length) {
    return { status: 'missing', candidates: [] };
  }

  const bestScopeIndex = Math.min(...candidates.map(candidate => candidate.scopeIndex));
  const scopeFiltered = candidates.filter(candidate => candidate.scopeIndex === bestScopeIndex);

  const bestScore = Math.max(...scopeFiltered.map(candidate => candidate.matchScore));
  const scoreFiltered = scopeFiltered.filter(candidate => candidate.matchScore === bestScore);

  const bestDepth = Math.min(...scoreFiltered.map(candidate => candidate.depth));
  const depthFiltered = scoreFiltered.filter(candidate => candidate.depth === bestDepth);

  const ordered = [...depthFiltered].sort(compareByDeclarationThenUuid).map(entry => entry.item);
  if (ordered.length === 1) {
    return { status: 'resolved', selected: ordered[0], candidates: ordered };
  }

  const signatures = new Set(ordered.map(candidate => Helper.visibilitySignature(candidate)));
  if (signatures.size === 1) {
    return { status: 'resolved', selected: ordered[0], candidates: ordered };
  }

  return { status: 'ambiguous', candidates: ordered };
}

function bindRole(role, slotKind, span, player, scopes) {
  const result = resolveEntitySlot({
    kind: slotKind,
    role,
    tokens: span,
    start: 0,
    end: span.length,
  }, player, scopes);

  if (result.status === 'resolved') {
    return { ok: true, target: result.selected };
  }

  if (result.status === 'ambiguous') {
    return {
      ok: false,
      error: {
        code: 'AMBIGUOUS_TARGET',
        details: { role },
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'TARGET_NOT_FOUND',
      details: { role },
    },
  };
}

function fallbackNoMatchForLegacyDeclaration(declaration, bodyTokens) {
  const legacy = detectLegacyShape(bodyTokens);
  const selectedRule = selectLegacyRuleKey(declaration, legacy.shape);
  if (!selectedRule.ok) {
    return selectedRule;
  }

  if (RELATION_BEARING_RULES.has(selectedRule.ruleKey)) {
    const ruleConfig = getRuleConfig(declaration, selectedRule.ruleKey);
    const acceptedRelations = normalizeAcceptedRelations(ruleConfig.acceptedRelations);
    if (!legacy.relationTokenCanonical || !acceptedRelations.includes(legacy.relationTokenCanonical)) {
      return {
        ok: false,
        error: {
          code: 'FORM_UNSUPPORTED_RELATION',
          details: {
            ruleKey: selectedRule.ruleKey,
            relationTokenRaw: legacy.relationTokenRaw,
            relationTokenCanonical: legacy.relationTokenCanonical,
          },
        },
      };
    }
  }

  return { ok: false, error: { code: 'FORM_NOT_SUPPORTED' } };
}

function inferStructuralFailureRole(compiledRule, bodyTokens) {
  const derivedRuleKey = compiledRule && typeof compiledRule === 'object'
    ? compiledRule.derivedRuleKey
    : null;

  if (derivedRuleKey === 'direct') {
    return 'direct';
  }

  if (derivedRuleKey === 'indirect') {
    return 'indirect';
  }

  if (derivedRuleKey === 'directIndirect') {
    const legacy = detectLegacyShape(bodyTokens);
    if (!legacy.directSpan.length) {
      return 'direct';
    }
    if (!legacy.indirectSpan.length) {
      return 'indirect';
    }
  }

  return null;
}

/**
 * @param {any} compiledRule
 * @param {string[]} bodyTokens
 * @returns {{ ok: false, error: { code: string, message?: string, details?: Record<string, *> } }}
 */
function classifyStructuralBindingFailure(compiledRule, bodyTokens) {
  const legacy = detectLegacyShape(bodyTokens);
  const role = inferStructuralFailureRole(compiledRule, bodyTokens);
  //TODO: These conditionals smell, but the fix is deferred to a full rewrite of the `direct` vs `indirect` targetting.
  if (role === 'direct' && !legacy.directSpan.length) {
    return {
      ok: false,
      error: {
        code: 'FORM_MISSING_DIRECT',
      },
    };
  }

  if (role === 'indirect' && !legacy.indirectSpan.length) {
    return {
      ok: false,
      error: {
        code: 'FORM_MISSING_INDIRECT',
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'TARGET_NOT_FOUND',
      details: role ? { role } : undefined,
    },
  };
}

function buildInterpretationValue(verbId, declaration, selectedRule, slotStates, deferredIndirectResolutionError) {
  const directSlot = slotStates.find(slot => slot.role === 'direct' && Syntax.isEntityBearingSlot(slot.kind));
  const indirectSlot = slotStates.find(slot => slot.role === 'indirect' && Syntax.isEntityBearingSlot(slot.kind));
  const ambiguousSlots = slotStates
    .map((slot, slotIndex) => ({ slot, slotIndex }))
    .filter(({ slot }) => slot.status === 'ambiguous')
    .map(({ slot, slotIndex }) => ({
      slotIndex,
      slotKind: slot.kind,
      role: slot.role || null,
      surface: slot.surface,
      tokenRange: [slot.start, slot.end - 1],
      candidates: slot.candidates || [],
    }));

  return {
    verbId,
    outcome: ambiguousSlots.length ? 'ambiguous' : 'success',
    ruleKey: selectedRule.derivedRuleKey || 'syntax',
    matchedRuleText: selectedRule.ruleText,
    compiledRuleId: selectedRule.compiledRuleId,
    syntaxRule: selectedRule.ruleText,
    declaration,
    slots: slotStates,
    directSpan: directSlot ? directSlot.tokens : [],
    indirectSpan: indirectSlot ? indirectSlot.tokens : [],
    relationTokenRaw: selectedRule.relationLiteralToken,
    relationTokenCanonical: selectedRule.canonicalRelationToken,
    directTarget: directSlot && directSlot.status === 'resolved' && directSlot.selected != null
      ? directSlot.selected
      : undefined,
    indirectTarget: indirectSlot && indirectSlot.status === 'resolved' && indirectSlot.selected != null
      ? indirectSlot.selected
      : undefined,
    indirectResolutionError: deferredIndirectResolutionError || undefined,
    ambiguity: ambiguousSlots,
  };
}

/**
 * @param {GameState} state
 * @param {*} command
 * @param {*} player
 * @param {*} parsedInput
 * @returns {{ ok: true, value: Record<string, *> } | { ok: false, error: { code: string, message?: string, details?: Record<string, *> } }}
 */
function resolveEntityContext(state, command, player, parsedInput) {
  void state;

  const verbId = Helper.normalizeText(parsedInput && parsedInput.intentToken);
  const declaration = getDeclaration(command, verbId || 'verb');
  if (!declaration) {
    return {
      ok: true,
      value: {
        ruleKey: 'legacy',
        matchedRuleText: null,
        compiledRuleId: null,
        directSpan: [],
        indirectSpan: [],
        relationTokenRaw: null,
        relationTokenCanonical: null,
        declaration: { rules: {} },
        slots: [],
        ambiguity: [],
      },
    };
  }

  const declarationError = validateDeclaration(declaration);
  if (declarationError) {
    return /** @type {{ ok: false, error: { code: string, message?: string, details?: Record<string, *> } }} */ (declarationError);
  }

  const bodyTokens = Helper.normalizeTokenList(parsedInput && parsedInput.bodyTokens);
  let firstStructuralBindingFailure = null;

  for (const compiledRule of declaration.compiledRules || []) {
    const ruleConfig = getRuleConfig(declaration, compiledRule.derivedRuleKey || '');
    let deferredIndirectResolutionError = null;
    const matched = Syntax.tryMatchRule(compiledRule, bodyTokens, (slot) => {
      if (!Syntax.isEntityBearingSlot(slot.kind)) {
        return /** @type {{ status: 'resolved', selected: object | null, candidates: object[] }} */ ({
          status: 'resolved',
          selected: null,
          candidates: [],
        });
      }

      const scopes = scopeProfileForRole(ruleConfig, slot.role === 'indirect' ? 'indirect' : 'direct');
      const resolution = resolveEntitySlot(slot, player, scopes);

      if (
        slot.role === 'indirect' &&
        ruleConfig.allowUnresolvedIndirect === true &&
        (resolution.status === 'missing' || resolution.status === 'ambiguous')
      ) {
        deferredIndirectResolutionError = {
          code: resolution.status === 'ambiguous' ? 'AMBIGUOUS_TARGET' : 'TARGET_NOT_FOUND',
          details: {
            role: 'indirect',
            ...(Array.isArray(resolution.candidates) && resolution.candidates.length
              ? { candidates: resolution.candidates }
              : {}),
          },
        };

        return /** @type {{ status: 'resolved', selected: object | null, candidates: object[] }} */ ({
          status: 'resolved',
          selected: null,
          candidates: resolution.candidates || [],
        });
      }

      return /** @type {{ status: 'resolved', selected: object, candidates: object[] } | { status: 'ambiguous', candidates: object[] } | { status: 'missing', candidates: object[] }} */ (resolution);
    });

    if (!matched.ok) {
      const failedMatch = /** @type {{ ok: false, reason: string }} */ (matched);
      if (
        !firstStructuralBindingFailure &&
        (failedMatch.reason === 'ENTITY_SLOT_MISSING' || failedMatch.reason === 'ENTITY_SLOT_NO_VIABLE_BINDING')
      ) {
        firstStructuralBindingFailure = classifyStructuralBindingFailure(compiledRule, bodyTokens);
      }
      continue;
    }

    const interpretation = buildInterpretationValue(
      verbId,
      declaration,
      compiledRule,
      matched.slotStates,
      deferredIndirectResolutionError
    );
    if (matched.outcome === 'ambiguous') {
      const singleRole = interpretation.ambiguity.length === 1
        ? interpretation.ambiguity[0].role
        : null;
      return {
        ok: false,
        error: {
          code: 'AMBIGUOUS_TARGET',
          message: buildAmbiguityMessage(interpretation.ambiguity),
          details: {
            role: singleRole || undefined,
            ambiguity: interpretation.ambiguity,
            compiledRuleId: interpretation.compiledRuleId,
            matchedRuleText: interpretation.matchedRuleText,
          },
        },
      };
    }

    return {
      ok: true,
      value: interpretation,
    };
  }

  if (firstStructuralBindingFailure) {
    return firstStructuralBindingFailure;
  }

  if (Object.keys(declaration.rules || {}).length > 0) {
    return /** @type {{ ok: true, value: Record<string, *> } | { ok: false, error: { code: string, message?: string, details?: Record<string, *> } }} */ (
      fallbackNoMatchForLegacyDeclaration(declaration, bodyTokens)
    );
  }

  return {
    ok: false,
    error: {
      code: 'FORM_NOT_SUPPORTED',
    },
  };
}

function buildAmbiguityMessage(ambiguityEntries) {
  if (!Array.isArray(ambiguityEntries) || !ambiguityEntries.length) {
    return 'Which one do you mean?';
  }

  return ambiguityEntries
    .map((entry) => {
      const label = entry.surface || 'that';
      return `Which ${label} do you mean?`;
    })
    .join(' ');
}

module.exports = {
  canonicalizeRelation: Syntax.canonicalizeRelation,
  getDeclaration,
  resolveEntityContext,
};
