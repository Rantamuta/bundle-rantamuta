// @ts-check
'use strict';

const Helper = require('../helpers/entity-resolution-helper');

const SLOT_KINDS = new Set(['TEXT', 'WORD', 'NUMBER', 'ENTITY', 'LIVING', 'EXIT']);
const VARIABLE_WIDTH_SLOTS = new Set(['TEXT', 'ENTITY', 'LIVING', 'EXIT']);
const ENTITY_BEARING_SLOTS = new Set(['ENTITY', 'LIVING', 'EXIT']);
const LEGACY_RELATION_CANONICAL_MAP = new Map([
  ['into', 'in'],
  ['onto', 'on'],
]);

/**
 * @typedef {{ type: 'literal', value: string } | { type: 'slot', kind: string }} CompiledAtom
 * @typedef {{
 *   ruleText: string,
 *   compiledRuleId: string,
 *   atoms: CompiledAtom[],
 *   derivedRuleKey: string | null,
 *   relationLiteralToken: string | null,
 *   canonicalRelationToken: string | null,
 * }} CompiledRule
 */

function canonicalizeRelation(token) {
  const normalized = Helper.normalizeText(token);
  if (!normalized) {
    return null;
  }

  return LEGACY_RELATION_CANONICAL_MAP.get(normalized) || normalized;
}

/**
 * @param {string} verbId
 * @param {string[]} syntaxRules
 * @returns {CompiledRule[]}
 */
function compileSyntaxRules(verbId, syntaxRules) {
  return syntaxRules.map((ruleText, index) => compileSyntaxRule(verbId, ruleText, index));
}

/**
 * @param {string} verbId
 * @param {string} ruleText
 * @param {number} index
 * @returns {CompiledRule}
 */
function compileSyntaxRule(verbId, ruleText, index) {
  const normalizedRuleText = String(ruleText || '').trim();
  if (!normalizedRuleText) {
    throw new Error(`Invalid empty syntax rule for ${verbId}`);
  }

  const parts = normalizedRuleText === '(empty)'
    ? []
    : normalizedRuleText.split(/\s+/u).map(part => String(part).trim()).filter(Boolean);

  /** @type {CompiledAtom[]} */
  const atoms = parts.map((part) => {
    if (SLOT_KINDS.has(part)) {
      return { type: 'slot', kind: part };
    }

    return { type: 'literal', value: Helper.normalizeText(part) };
  });

  const relationLiteralIndex = atoms.findIndex((atom, atomIndex) => {
    if (atom.type !== 'literal') {
      return false;
    }

    const next = atoms[atomIndex + 1];
    return !!(next && next.type === 'slot' && ENTITY_BEARING_SLOTS.has(next.kind));
  });

  const relationLiteral = relationLiteralIndex >= 0 && atoms[relationLiteralIndex] && atoms[relationLiteralIndex].type === 'literal'
    ? atoms[relationLiteralIndex]
    : null;
  const firstLiteral = atoms[0] && atoms[0].type === 'literal'
    ? atoms[0]
    : null;

  const canonicalRelationToken = relationLiteral
    ? canonicalizeRelation(relationLiteral.value)
    : atoms.length > 0 && atoms.every(atom => atom.type === 'literal') && firstLiteral
      ? canonicalizeRelation(firstLiteral.value)
    : null;

  const entitySlotRoles = atoms
    .map((atom, atomIndex) => ({ atom, atomIndex }))
    .filter(({ atom }) => atom.type === 'slot' && ENTITY_BEARING_SLOTS.has(atom.kind))
    .map(({ atomIndex }) => {
      const previous = atoms[atomIndex - 1];
      return previous && previous.type === 'literal' ? 'indirect' : 'direct';
    });

  const directCount = entitySlotRoles.filter(role => role === 'direct').length;
  const indirectCount = entitySlotRoles.filter(role => role === 'indirect').length;

  let derivedRuleKey = null;
  if (atoms.length === 0) {
    derivedRuleKey = 'intransitive';
  } else if (atoms.every(atom => atom.type === 'literal')) {
    derivedRuleKey = 'relationOnly';
  } else if (directCount === 1 && indirectCount === 0 && entitySlotRoles.length === 1) {
    derivedRuleKey = 'direct';
  } else if (directCount === 0 && indirectCount === 1 && entitySlotRoles.length === 1) {
    derivedRuleKey = 'indirect';
  } else if (directCount === 1 && indirectCount === 1 && entitySlotRoles.length === 2) {
    derivedRuleKey = 'directIndirect';
  }

  return {
    ruleText: normalizedRuleText,
    compiledRuleId: `${verbId}:${index}`,
    atoms,
    derivedRuleKey,
    relationLiteralToken: relationLiteral
      ? relationLiteral.value
      : atoms.length > 0 && atoms.every(atom => atom.type === 'literal') && firstLiteral
        ? firstLiteral.value
        : null,
    canonicalRelationToken,
  };
}

/**
 * Precompile authored syntax metadata when a command module is loaded.
 *
 * @param {string} verbId
 * @param {Record<string, *> | null | undefined} metadata
 * @returns {Record<string, *>}
 */
function compileCommandSyntaxMetadata(verbId, metadata) {
  const base = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const syntaxRules = Array.isArray(base.syntaxRules)
    ? base.syntaxRules.map(rule => String(rule || '').trim()).filter(Boolean)
    : [];

  if (!syntaxRules.length) {
    return base;
  }

  return {
    ...base,
    syntaxRules,
    compiledRules: compileSyntaxRules(verbId, syntaxRules),
  };
}

function isEntityBearingSlot(kind) {
  return ENTITY_BEARING_SLOTS.has(kind);
}

function isVariableWidthSlot(kind) {
  return VARIABLE_WIDTH_SLOTS.has(kind);
}

function countRemainingMinimumTokens(atoms, startIndex) {
  let minimum = 0;
  for (let index = startIndex; index < atoms.length; index += 1) {
    const atom = atoms[index];
    if (atom.type === 'literal') {
      minimum += 1;
      continue;
    }

    if (atom.kind === 'WORD' || atom.kind === 'NUMBER' || isVariableWidthSlot(atom.kind)) {
      minimum += 1;
    }
  }

  return minimum;
}

function deriveEntitySlotRole(atoms, atomIndex) {
  const previous = atoms[atomIndex - 1];
  return previous && previous.type === 'literal' ? 'indirect' : 'direct';
}

function cloneSlotState(slotState) {
  return {
    kind: slotState.kind,
    role: slotState.role || null,
    start: slotState.start,
    end: slotState.end,
    tokens: slotState.tokens.slice(),
    surface: slotState.surface,
    status: slotState.status,
    selected: slotState.selected || null,
    candidates: Array.isArray(slotState.candidates) ? slotState.candidates.slice() : [],
  };
}

/**
 * @param {CompiledRule} rule
 * @param {string[]} tokens
 * @param {(slot: { kind: string, role: string | null, tokens: string[], start: number, end: number }) => { status: 'resolved', selected: object, candidates: object[] } | { status: 'ambiguous', candidates: object[] } | { status: 'missing', candidates: object[] }} resolveSlot
 * @returns {{ ok: true, outcome: 'success' | 'ambiguous', slotStates: Array<ReturnType<typeof cloneSlotState>> } | { ok: false, reason: string }}
 */
function tryMatchRule(rule, tokens, resolveSlot) {
  /** @type {Array<ReturnType<typeof cloneSlotState>>} */
  const slotStates = [];

  function recurse(atomIndex, tokenIndex) {
    if (atomIndex === rule.atoms.length) {
      if (tokenIndex !== tokens.length) {
        return { ok: false, reason: 'UNCONSUMED_TOKENS' };
      }

      const outcome = slotStates.some(slot => slot.status === 'ambiguous')
        ? 'ambiguous'
        : 'success';
      return {
        ok: true,
        outcome,
        slotStates: slotStates.map(cloneSlotState),
      };
    }

    const atom = rule.atoms[atomIndex];
    if (atom.type === 'literal') {
      if (tokens[tokenIndex] !== atom.value) {
        return { ok: false, reason: 'LITERAL_MISMATCH' };
      }

      return recurse(atomIndex + 1, tokenIndex + 1);
    }

    if (atom.kind === 'WORD' || atom.kind === 'NUMBER') {
      const token = tokens[tokenIndex];
      if (!token) {
        return { ok: false, reason: 'MISSING_FIXED_SLOT' };
      }

      if (atom.kind === 'NUMBER' && Number.isNaN(Number(token))) {
        return { ok: false, reason: 'NUMBER_PARSE_FAILED' };
      }

      slotStates.push({
        kind: atom.kind,
        role: null,
        start: tokenIndex,
        end: tokenIndex + 1,
        tokens: [token],
        surface: token,
        status: 'resolved',
        selected: null,
        candidates: [],
      });
      const next = recurse(atomIndex + 1, tokenIndex + 1);
      if (next.ok) {
        return next;
      }

      slotStates.pop();
      return next;
    }

    const minimumRemaining = countRemainingMinimumTokens(rule.atoms, atomIndex + 1);
    const maxEndExclusive = tokens.length - minimumRemaining;
    let firstAmbiguous = null;
    let firstSpecificFailure = null;
    let sawResolvedEntitySpan = false;
    let sawMissingEntitySpan = false;

    for (let endExclusive = maxEndExclusive; endExclusive > tokenIndex; endExclusive -= 1) {
      const spanTokens = tokens.slice(tokenIndex, endExclusive);
      const role = isEntityBearingSlot(atom.kind)
        ? deriveEntitySlotRole(rule.atoms, atomIndex)
        : null;
      const slotState = {
        kind: atom.kind,
        role,
        start: tokenIndex,
        end: endExclusive,
        tokens: spanTokens,
        surface: spanTokens.join(' '),
        status: 'resolved',
        selected: null,
        candidates: [],
      };

      if (isEntityBearingSlot(atom.kind)) {
        const resolution = resolveSlot(slotState);
        slotState.status = resolution.status;
        slotState.selected = resolution.status === 'resolved' ? resolution.selected : null;
        slotState.candidates = resolution.candidates || [];

        if (resolution.status === 'missing') {
          sawMissingEntitySpan = true;
          continue;
        }

        sawResolvedEntitySpan = true;
      }

      slotStates.push(slotState);
      const next = recurse(atomIndex + 1, endExclusive);
      if (next.ok) {
        if (next.outcome === 'success') {
          return next;
        }
        if (!firstAmbiguous) {
          firstAmbiguous = next;
        }
      } else if (
        !firstSpecificFailure &&
        (next.reason === 'ENTITY_SLOT_MISSING' || next.reason === 'ENTITY_SLOT_NO_VIABLE_BINDING')
      ) {
        firstSpecificFailure = next;
      }

      slotStates.pop();
    }

    if (firstAmbiguous) {
      return firstAmbiguous;
    }

    if (firstSpecificFailure) {
      return firstSpecificFailure;
    }

    if (isEntityBearingSlot(atom.kind)) {
      if (sawMissingEntitySpan && !sawResolvedEntitySpan) {
        return { ok: false, reason: 'ENTITY_SLOT_MISSING' };
      }

      if (sawResolvedEntitySpan) {
        return { ok: false, reason: 'ENTITY_SLOT_NO_VIABLE_BINDING' };
      }
    }

    return { ok: false, reason: 'VARIABLE_SLOT_NO_SPAN' };
  }

  return recurse(0, 0);
}

module.exports = {
  SLOT_KINDS,
  compileCommandSyntaxMetadata,
  compileSyntaxRule,
  compileSyntaxRules,
  isEntityBearingSlot,
  canonicalizeRelation,
  tryMatchRule,
};
