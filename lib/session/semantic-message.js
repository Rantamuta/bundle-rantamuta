// @ts-check
'use strict';

/**
 * Standalone semantic-message renderer.
 *
 * This module is intentionally not wired into command-dispatch yet.
 * It exists as a harness-ready implementation surface for validating
 * semantic-event behavior before integration.
 *
 * Design notes:
 * - This file is pure text transformation: it does not send output or mutate world state.
 * - Inputs are a semantic instruction + lightweight render context + one recipient POV.
 * - Output is either:
 *   - `{ ok: true, included: true, text }` when POV is included by audience policy
 *   - `{ ok: true, included: false, text: '' }` when POV is excluded
 *   - `{ ok: false, code, message }` for structured validation/render failures
 *
 * Why keep this separate for now:
 * - We can iterate quickly on template behavior and grammar rules.
 * - CLI/tests can harden behavior before any dispatcher integration.
 */

const AUDIENCE_POLICIES = new Set([
  'self',
  'others',
  'self_and_others',
  'self_target_and_others',
  'target_and_others',
]);

/**
 * Explicit irregular inflection mapping used by `{verb:<base>}`.
 *
 * These mappings are normalized by lowercase lookup and applied before
 * suffix/fallback rules so behavior is deterministic and testable.
 */
const IRREGULAR_VERBS = Object.freeze({
  were: 'was',
  "don't": "doesn't",
  "aren't": "isn't",
  possum: 'possums',
  staff: 'staves',
  die: 'dies',
  barf: 'barfs',
  hum: 'hums',
});

/**
 * Pronoun profile table for v1.
 *
 * We intentionally support a small set right now (`he`, `she`, `it`) and can
 * extend later with custom pronoun profiles without changing call sites.
 */
const PRONOUN_FORMS = Object.freeze({
  he: Object.freeze({ subj: 'he', obj: 'him', poss: 'his', refl: 'himself' }),
  she: Object.freeze({ subj: 'she', obj: 'her', poss: 'her', refl: 'herself' }),
  it: Object.freeze({ subj: 'it', obj: 'it', poss: 'its', refl: 'itself' }),
});

/** @typedef {'self' | 'target' | 'other'} Pov */

/**
 * Lightweight entity view consumed by renderer logic.
 *
 * `pronoun` is optional. When absent, possessive/reflexive fall back to
 * name-based or neutral forms.
 */
/** @typedef {{ name?: string, pronoun?: string, isNpc?: boolean, isLiving?: boolean, kind?: string, id?: string|number, uuid?: string, entityReference?: string }} EntityLike */

/**
 * @typedef {{
 *   selector: 'currentPlayer'
 * } | {
 *   selector: 'entityByContextRole',
 *   role: 'directTarget' | 'indirectTarget'
 * }} ParticipantSelector
 */

/**
 * Semantic event payload used by the standalone renderer.
 *
 * Notes:
 * - `audiencePolicy` controls inclusion/exclusion for POV categories.
 * - `participants` binds template roles to contextual entities.
 * - `objectText` provides explicit noun phrases for object slots.
 * - `templates.*` optionally overrides canonical template per audience bucket.
 *
 * @typedef {{
 *   type: 'semanticEvent',
 *   template: string,
 *   audiencePolicy: string,
 *   participants: {
 *     actor: ParticipantSelector,
 *     target?: ParticipantSelector,
 *     direct?: ParticipantSelector,
 *     indirect?: ParticipantSelector,
 *   },
 *   objectText?: { direct?: string, indirect?: string },
 *   templates?: { actor?: string, target?: string, others?: string }
 * }} SemanticEventInstruction
 */

/**
 * @typedef {{
 *   currentPlayer?: EntityLike | null,
 *   directTarget?: EntityLike | null,
 *   indirectTarget?: EntityLike | null,
 *   otherRecipient?: EntityLike | null,
 * }} SemanticRenderContext
 */

/**
 * @typedef {{
 *   actor: EntityLike,
 *   target?: EntityLike | null,
 *   direct?: EntityLike | null,
 *   indirect?: EntityLike | null,
 * }} ResolvedParticipants
 */

/**
 * @typedef {{
 *   ok: true,
 *   included: boolean,
 *   text: string
 * } | {
 *   ok: false,
 *   code: string,
 *   message: string
 * }} SemanticRenderResult
 */

// Used when rendering an `other` POV without an explicit recipient entity.
const DEFAULT_OTHER_RECIPIENT = Object.freeze({ name: 'Someone' });

/**
 * Normalize all user/designer-provided string-ish inputs through one path.
 *
 * This keeps matching, lookup, and template-token handling consistent.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || '').trim();
}

/**
 * Runtime guard for "plain object-like" checks in JS.
 *
 * We intentionally keep this broad because instruction/context payloads come
 * from dynamic sources (tests, CLI literals, future dispatcher inputs).
 *
 * @param {*} value
 * @returns {value is Record<string, *>}
 */
function isObject(value) {
  return !!value && typeof value === 'object';
}

/**
 * Human-facing display name resolution.
 *
 * Fallbacks are intentionally simple (`someone`) because this renderer should
 * never throw just because a name is absent.
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {string}
 */
function displayName(entity) {
  if (!entity || typeof entity !== 'object') {
    return 'someone';
  }

  const name = normalizeText(entity.name);
  return name || 'someone';
}

/**
 * Participant display names are treated as proper nouns in semantic messaging.
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {string}
 */
function displayParticipantName(entity) {
  return capitalizeTokenValue(displayName(entity));
}

/**
 * `target.name` semantics:
 * - character-like entities (player/NPC shape): capitalize as proper name
 * - non-character entities: preserve authored object casing
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {string}
 */
function displayTargetName(entity) {
  if (isCharacterEntity(entity)) {
    return displayParticipantName(entity);
  }
  return displayName(entity);
}

/**
 * Compute a stable identity key for de-dup/equality checks.
 *
 * Priority order mirrors "most specific to least specific":
 * 1. uuid
 * 2. entityReference
 * 3. id
 * 4. normalized display name
 *
 * This gives deterministic behavior even in lightweight harness contexts.
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {string}
 */
function stableEntityKey(entity) {
  if (!entity || typeof entity !== 'object') {
    return '';
  }

  if (entity.uuid !== undefined && entity.uuid !== null) {
    return `uuid:${String(entity.uuid)}`;
  }
  if (entity.entityReference !== undefined && entity.entityReference !== null) {
    return `ref:${String(entity.entityReference)}`;
  }
  if (entity.id !== undefined && entity.id !== null) {
    return `id:${String(entity.id)}`;
  }
  return `name:${displayName(entity).toLowerCase()}`;
}

/**
 * Semantic identity check used by perspective logic.
 *
 * Why this matters:
 * - Pronouns, `{*.you}`, and verb inflection all depend on "is recipient the
 *   same logical entity as subject/target?" not just object reference equality.
 *
 * @param {EntityLike | null | undefined} a
 * @param {EntityLike | null | undefined} b
 * @returns {boolean}
 */
function sameEntity(a, b) {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }

  const ak = stableEntityKey(a);
  const bk = stableEntityKey(b);
  return !!ak && ak === bk;
}

/**
 * Generate a name-based possessive form.
 *
 * This is the fallback when a third-person pronoun profile is not available.
 *
 * @param {string} name
 * @returns {string}
 */
function possessive(name) {
  const normalized = normalizeText(name);
  if (!normalized) {
    return 'their';
  }
  return /s$/i.test(normalized) ? `${normalized}'` : `${normalized}'s`;
}

/**
 * Capitalize the first character of a rendered token value.
 *
 * v1 only uses this for actor/target placeholder capitalization.
 *
 * @param {*} value
 * @returns {string}
 */
function capitalizeTokenValue(value) {
  const text = String(value || '');
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Resolve pronoun profile for an entity.
 *
 * v1 supports a single normalized pronoun field with values:
 * - `he`
 * - `she`
 * - `it`
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {{ subj: string, obj: string, poss: string, refl: string } | null}
 */
function pronounProfile(entity) {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  const key = normalizeText(entity.pronoun).toLowerCase();
  if (!key || !Object.prototype.hasOwnProperty.call(PRONOUN_FORMS, key)) {
    return null;
  }

  return PRONOUN_FORMS[key];
}

/**
 * Detect character-like entities using the Ranvier shape.
 *
 * v1 rules:
 * - entities exposing `isNpc` boolean getter/property are treated as living characters
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {boolean}
 */
function isCharacterEntity(entity) {
  if (!entity || typeof entity !== 'object') {
    return false;
  }
  return typeof entity.isNpc === 'boolean';
}

/**
 * Resolve third-person possessive for a participant when recipient is someone else.
 *
 * Priority:
 * 1. explicit pronoun profile
 * 2. character fallback (name possessive)
 * 3. non-character fallback (`its`)
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {string}
 */
function thirdPersonPossessive(entity) {
  const pronouns = pronounProfile(entity);
  if (pronouns) {
    return pronouns.poss;
  }
  if (isCharacterEntity(entity)) {
    return possessive(displayName(entity));
  }
  return 'its';
}

/**
 * Resolve third-person reflexive for a participant when recipient is someone else.
 *
 * Priority:
 * 1. explicit pronoun profile
 * 2. character fallback (neutral reflexive)
 * 3. non-character fallback (`itself`)
 *
 * @param {EntityLike | null | undefined} entity
 * @returns {string}
 */
function thirdPersonReflexive(entity) {
  const pronouns = pronounProfile(entity);
  if (pronouns) {
    return pronouns.refl;
  }
  if (isCharacterEntity(entity)) {
    return 'themself';
  }
  return 'itself';
}

/**
 * Inflect a base verb for third-person singular when needed.
 *
 * Pipeline (deterministic):
 * 1. irregular lookup
 * 2. targeted suffix rules
 * 3. generic suffix fallbacks
 *
 * `shouldInflect=false` returns the base form unchanged.
 *
 * @param {string} baseVerb
 * @param {boolean} shouldInflect
 * @returns {string}
 */
function inflectVerb(baseVerb, shouldInflect) {
  const base = normalizeText(baseVerb);
  if (!base) {
    return '';
  }

  if (!shouldInflect) {
    return base;
  }

  const lower = base.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(IRREGULAR_VERBS, lower)) {
    return IRREGULAR_VERBS[lower];
  }

  // Legacy-targeted suffix handling preserved as deterministic rules.
  if (lower.endsWith('ff')) {
    return `${base}s`;
  }
  if (lower.endsWith('penis')) {
    return `${base}es`;
  }

  if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(base)) {
    return `${base.slice(0, -1)}ies`;
  }

  if (/(s|sh|ch|x|z)$/i.test(base)) {
    return `${base}es`;
  }

  return `${base}s`;
}

/**
 * Decide whether a given POV should receive output under audience policy.
 *
 * This is strictly inclusion logic; recipient-set construction is handled by
 * higher layers (and eventually by dispatcher integration).
 *
 * @param {string} audiencePolicy
 * @param {Pov} pov
 * @returns {boolean}
 */
function includesPov(audiencePolicy, pov) {
  switch (audiencePolicy) {
    case 'self':
      return pov === 'self';
    case 'others':
      return pov === 'other';
    case 'self_and_others':
      return pov === 'self' || pov === 'other';
    case 'self_target_and_others':
      return pov === 'self' || pov === 'target' || pov === 'other';
    case 'target_and_others':
      return pov === 'target' || pov === 'other';
    default:
      return false;
  }
}

/**
 * Resolve one participant selector into a concrete entity from render context.
 *
 * This function is intentionally small and strict: unknown selectors return
 * null and are handled upstream as structured validation failures.
 *
 * @param {ParticipantSelector} selector
 * @param {SemanticRenderContext} context
 * @returns {EntityLike | null}
 */
function resolveSelector(selector, context) {
  if (!selector || typeof selector !== 'object') {
    return null;
  }

  if (selector.selector === 'currentPlayer') {
    return context.currentPlayer || null;
  }

  if (selector.selector === 'entityByContextRole') {
    if (selector.role === 'directTarget') {
      return context.directTarget || null;
    }
    if (selector.role === 'indirectTarget') {
      return context.indirectTarget || null;
    }
    return null;
  }

  return null;
}

/**
 * Validate instruction shape before attempting participant or template render.
 *
 * This returns compact structured errors so callers can surface diagnostics
 * predictably in tests/CLI and later dispatcher traces.
 *
 * @param {*} instruction
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function validateInstruction(instruction) {
  if (!isObject(instruction)) {
    return {
      ok: false,
      code: 'SEMANTIC_EVENT_INVALID',
      message: 'Instruction must be an object.',
    };
  }

  if (instruction.type !== 'semanticEvent') {
    return {
      ok: false,
      code: 'SEMANTIC_EVENT_INVALID',
      message: 'Instruction type must be "semanticEvent".',
    };
  }

  const template = normalizeText(instruction.template);
  if (!template) {
    return {
      ok: false,
      code: 'SEMANTIC_TEMPLATE_INVALID',
      message: 'Template must be a non-empty string.',
    };
  }

  const audiencePolicy = normalizeText(instruction.audiencePolicy);
  if (!AUDIENCE_POLICIES.has(audiencePolicy)) {
    return {
      ok: false,
      code: 'SEMANTIC_AUDIENCE_POLICY_INVALID',
      message: `Unsupported audience policy "${audiencePolicy || '<empty>'}".`,
    };
  }

  const participants = instruction.participants;
  if (!isObject(participants) || !isObject(participants.actor)) {
    return {
      ok: false,
      code: 'SEMANTIC_PARTICIPANT_MISSING',
      message: 'participants.actor is required.',
    };
  }

  // v1 selector contract is a closed enum.
  const participantKeys = ['actor', 'target', 'direct', 'indirect'];
  for (const key of participantKeys) {
    if (!Object.prototype.hasOwnProperty.call(participants, key)) {
      continue;
    }

    const selector = participants[key];
    if (!isObject(selector)) {
      return {
        ok: false,
        code: 'SEMANTIC_EVENT_INVALID',
        message: `participants.${key} must be an object selector.`,
      };
    }

    if (selector.selector === 'currentPlayer') {
      continue;
    }

    if (selector.selector === 'entityByContextRole' &&
      (selector.role === 'directTarget' || selector.role === 'indirectTarget')) {
      continue;
    }

    return {
      ok: false,
      code: 'SEMANTIC_EVENT_INVALID',
      message: `participants.${key} selector is invalid.`,
    };
  }

  return { ok: true };
}

/**
 * Resolve all participant slots needed by template rendering.
 *
 * Actor is required by contract. Other roles are optional and are checked
 * lazily if/when a template references them.
 *
 * @param {SemanticEventInstruction} instruction
 * @param {SemanticRenderContext} context
 * @returns {{ ok: true, value: ResolvedParticipants } | { ok: false, code: string, message: string }}
 */
function resolveParticipants(instruction, context) {
  const participants = instruction.participants;
  const actor = resolveSelector(participants.actor, context);
  if (!actor) {
    return {
      ok: false,
      code: 'SEMANTIC_PARTICIPANT_MISSING',
      message: 'Actor participant could not be resolved.',
    };
  }

  return {
    ok: true,
    value: {
      actor,
      target: participants.target ? resolveSelector(participants.target, context) : null,
      direct: participants.direct ? resolveSelector(participants.direct, context) : null,
      indirect: participants.indirect ? resolveSelector(participants.indirect, context) : null,
    },
  };
}

/**
 * Choose audience-specific template override if present.
 *
 * Canonical template remains the default.
 *
 * @param {SemanticEventInstruction} instruction
 * @param {Pov} pov
 * @returns {string}
 */
function selectTemplate(instruction, pov) {
  const templates = isObject(instruction.templates) ? instruction.templates : null;
  if (!templates) {
    return instruction.template;
  }

  if (pov === 'self' && typeof templates.actor === 'string') {
    return templates.actor;
  }

  if (pov === 'target' && typeof templates.target === 'string') {
    return templates.target;
  }

  if (pov === 'other' && typeof templates.others === 'string') {
    return templates.others;
  }

  return instruction.template;
}

/**
 * Resolve the "current viewer" entity used for perspective-sensitive tokens.
 *
 * - self => actor
 * - target => resolved target
 * - other => context.otherRecipient fallback
 *
 * @param {ResolvedParticipants} participants
 * @param {SemanticRenderContext} context
 * @param {Pov} pov
 * @returns {EntityLike}
 */
function resolveRecipient(participants, context, pov) {
  if (pov === 'self') {
    return participants.actor;
  }
  if (pov === 'target' && participants.target) {
    return participants.target;
  }
  if (pov === 'other' && context.otherRecipient) {
    return context.otherRecipient;
  }
  return DEFAULT_OTHER_RECIPIENT;
}

/**
 * Resolve a single `{token}` placeholder into rendered text.
 *
 * Important behavior:
 * - Unknown token => `SEMANTIC_TEMPLATE_INVALID`
 * - Missing referenced participant/object => `SEMANTIC_PARTICIPANT_MISSING`
 * - `{verb:...}` inflects relative to actor-as-subject in v1
 *
 * @param {string} token
 * @param {ResolvedParticipants} participants
 * @param {EntityLike} recipient
 * @param {{ direct?: string, indirect?: string }} objectText
 * @returns {{ ok: true, value: string } | { ok: false, code: string, message: string }}
 */
function resolveToken(token, participants, recipient, objectText) {
  const rawKey = normalizeText(token);
  const key = rawKey.toLowerCase();
  if (!key) {
    return {
      ok: false,
      code: 'SEMANTIC_TEMPLATE_INVALID',
      message: 'Empty placeholder token.',
    };
  }

  // Title-cased token segments opt into first-letter capitalization.
  // Examples:
  // - {actor.You}
  // - {target.Poss}
  // - {verb:Stab}
  const capitalizeOutput = /^(actor|target)(?:\.|$)/.test(key) && /(^|[.:])[A-Z]/.test(rawKey);
  const toValue = (value) => ({
    ok: true,
    value: capitalizeOutput ? capitalizeTokenValue(value) : String(value),
  });

  if (key.startsWith('verb:')) {
    const baseVerb = normalizeText(key.slice('verb:'.length));
    if (!baseVerb) {
      return {
        ok: false,
        code: 'SEMANTIC_TEMPLATE_INVALID',
        message: 'Verb placeholder requires a base verb.',
      };
    }
    // In v1 the actor is grammatical subject by default.
    const shouldInflect = !sameEntity(recipient, participants.actor);
    return toValue(inflectVerb(baseVerb, shouldInflect));
  }

  if (key === 'actor' || key === 'actor.you') {
    return toValue(sameEntity(recipient, participants.actor) ? 'You' : displayParticipantName(participants.actor));
  }
  if (key === 'actor.name') {
    return toValue(displayParticipantName(participants.actor));
  }
  if (key === 'actor.poss') {
    // Recipient-relative second-person path takes precedence.
    if (sameEntity(recipient, participants.actor)) {
      return toValue('your');
    }
    return toValue(thirdPersonPossessive(participants.actor));
  }
  if (key === 'actor.name_poss') {
    return toValue(possessive(displayParticipantName(participants.actor)));
  }
  if (key === 'actor.refl') {
    if (sameEntity(recipient, participants.actor)) {
      return toValue('yourself');
    }
    return toValue(thirdPersonReflexive(participants.actor));
  }

  if (key === 'target' || key === 'target.you') {
    if (!participants.target) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references target but no target is resolved.',
      };
    }
    return toValue(sameEntity(recipient, participants.target) ? 'you' : displayName(participants.target));
  }
  if (key === 'target.name') {
    if (!participants.target) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references target.name but no target is resolved.',
      };
    }
    return toValue(displayTargetName(participants.target));
  }
  if (key === 'target.poss') {
    if (!participants.target) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references target.poss but no target is resolved.',
      };
    }
    if (sameEntity(recipient, participants.target)) {
      return toValue('your');
    }
    return toValue(thirdPersonPossessive(participants.target));
  }
  if (key === 'target.name_poss') {
    if (!participants.target) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references target.name_poss but no target is resolved.',
      };
    }
    return toValue(possessive(displayTargetName(participants.target)));
  }
  if (key === 'target.refl') {
    if (!participants.target) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references target.refl but no target is resolved.',
      };
    }
    if (sameEntity(recipient, participants.target)) {
      return toValue('yourself');
    }
    return toValue(thirdPersonReflexive(participants.target));
  }

  if (key === 'direct') {
    // Explicit object text (if provided) wins over entity label lookup.
    if (typeof objectText.direct === 'string' && normalizeText(objectText.direct)) {
      return toValue(normalizeText(objectText.direct));
    }
    if (!participants.direct) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references direct but no direct participant is resolved.',
      };
    }
    return toValue(displayName(participants.direct));
  }

  if (key === 'indirect') {
    // Explicit object text (if provided) wins over entity label lookup.
    if (typeof objectText.indirect === 'string' && normalizeText(objectText.indirect)) {
      return toValue(normalizeText(objectText.indirect));
    }
    if (!participants.indirect) {
      return {
        ok: false,
        code: 'SEMANTIC_PARTICIPANT_MISSING',
        message: 'Template references indirect but no indirect participant is resolved.',
      };
    }
    return toValue(displayName(participants.indirect));
  }

  if (key === 'object.direct') {
    if (typeof objectText.direct === 'string' && normalizeText(objectText.direct)) {
      return toValue(normalizeText(objectText.direct));
    }
    return {
      ok: false,
      code: 'SEMANTIC_PARTICIPANT_MISSING',
      message: 'Template references object.direct but objectText.direct is missing.',
    };
  }

  if (key === 'object.indirect') {
    if (typeof objectText.indirect === 'string' && normalizeText(objectText.indirect)) {
      return toValue(normalizeText(objectText.indirect));
    }
    return {
      ok: false,
      code: 'SEMANTIC_PARTICIPANT_MISSING',
      message: 'Template references object.indirect but objectText.indirect is missing.',
    };
  }

  return {
    ok: false,
    code: 'SEMANTIC_TEMPLATE_INVALID',
    message: `Unknown placeholder "{${key}}".`,
  };
}

/**
 * Render a template with semantic placeholders.
 *
 * Escaping strategy:
 * - We temporarily replace escaped braces (`{{` and `}}`) with private
 *   sentinel chars so token regex does not process them.
 * - After placeholder replacement, sentinels are restored to literal braces.
 *
 * @param {string} template
 * @param {ResolvedParticipants} participants
 * @param {EntityLike} recipient
 * @param {{ direct?: string, indirect?: string }} objectText
 * @returns {{ ok: true, value: string } | { ok: false, code: string, message: string }}
 */
function renderTemplate(template, participants, recipient, objectText) {
  const literalOpen = '\uE000';
  const literalClose = '\uE001';
  const escaped = String(template)
    .replaceAll('{{', literalOpen)
    .replaceAll('}}', literalClose);

  const tokenPattern = /\{([^{}]+)\}/g;
  let failed = null;
  const rendered = escaped.replace(tokenPattern, (_full, rawToken) => {
    const tokenResult = resolveToken(rawToken, participants, recipient, objectText);
    if (!tokenResult.ok) {
      failed = tokenResult;
      return '';
    }
    return tokenResult.value;
  });

  if (failed) {
    return failed;
  }

  return {
    ok: true,
    value: rendered
      .replaceAll(literalOpen, '{')
      .replaceAll(literalClose, '}'),
  };
}

/**
 * Standalone semantic-message entrypoint used by tests and CLI harness.
 *
 * @param {SemanticEventInstruction} instruction
 * @param {SemanticRenderContext} context
 * @param {Pov} pov
 * @returns {SemanticRenderResult}
 */
function renderSemanticEvent(instruction, context, pov) {
  // 1) Validate payload shape.
  const validated = validateInstruction(instruction);
  if (!validated.ok) {
    const validationFailure = /** @type {{ code: string, message: string }} */ (validated);
    return {
      ok: false,
      code: validationFailure.code,
      message: validationFailure.message,
    };
  }

  // 2) Validate POV input early.
  if (pov !== 'self' && pov !== 'target' && pov !== 'other') {
    return {
      ok: false,
      code: 'SEMANTIC_EVENT_INVALID',
      message: `Invalid pov "${String(pov)}".`,
    };
  }

  // 3) Fast-path exclusion: nothing to render for this POV under audience policy.
  if (!includesPov(instruction.audiencePolicy, pov)) {
    return { ok: true, included: false, text: '' };
  }

  // 4) Resolve participants from context selectors.
  const resolvedParticipants = resolveParticipants(instruction, context);
  if (!resolvedParticipants.ok) {
    const participantFailure = /** @type {{ code: string, message: string }} */ (resolvedParticipants);
    return {
      ok: false,
      code: participantFailure.code,
      message: participantFailure.message,
    };
  }

  // `target` POV with no target is treated as "not included", not an error.
  if (pov === 'target' && !resolvedParticipants.value.target) {
    return { ok: true, included: false, text: '' };
  }

  // 5) Render selected template from the resolved recipient perspective.
  const template = selectTemplate(instruction, pov);
  const recipient = resolveRecipient(resolvedParticipants.value, context, pov);
  const rendered = renderTemplate(
    template,
    resolvedParticipants.value,
    recipient,
    instruction.objectText && isObject(instruction.objectText) ? instruction.objectText : {}
  );
  if (!rendered.ok) {
    const renderFailure = /** @type {{ code: string, message: string }} */ (rendered);
    return {
      ok: false,
      code: renderFailure.code,
      message: renderFailure.message,
    };
  }

  return {
    ok: true,
    included: true,
    text: rendered.value,
  };
}

module.exports = {
  IRREGULAR_VERBS,
  inflectVerb,
  renderSemanticEvent,
};
