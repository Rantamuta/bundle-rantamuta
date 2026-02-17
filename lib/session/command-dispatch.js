// @ts-check
'use strict';

const { Broadcast, Logger } = require('ranvier');
const { parseInput } = require('../parse-input');
const Mutator = require('./mutator');
const EntityResolution = require('./entity-resolution');
const RenderDispatch = require('./render-dispatch');

/**
 * Session command dispatcher.
 *
 * Purpose:
 * - Parse player (a.k.a. actor) input and resolve intent/targets.
 * - Orchestrate the execution of the verb/command.
 * - Ensure that changes to game state are atomic, coherent, and isolated through `Mutator`.
 *
 * Phase model (docs/normative/CommandArchitecture.md):
 * 0. Receive Input (intake)
 *    - Receive and normalize player input.
 *    - Identify the verb/command (a.k.a. intent key)
 *    - If unknown/empty input, stop before later phases.
 * 1. Entity Resolution (binding)
 *    - Understand which objects/entities the player is referring to, if any.
 *    - Resolve direct/indirect entities for the command context.
 * 2. Capture (veto)
 *    - See if any entity or policy hook objects want to veto the command.
 *    - The order of checks is: world -> quest system -> area -> room -> player -> indirect target -> direct target.
 *    - If any veto is found, stop before later phases and render the veto message.
 *    - Veto is not allowed to mutate state.
 * 3. Target (verb)
 *    - Add the instruction to execute the command's primary intent (e.g. take, drop, give).
 *    - Target is allowed to add mutation instructions to the plan.
 *    - Target is allowed to override the success render instructions.
 *    - Add the instruction to render the command's primary success message to the render plan.
 *    - Execute command planner and return `{ ok, plan, render? }`.
 *    - No direct mutation/output from the target function.
 * 4. Bubble (reaction)
 *    - Collect command-declared reaction contributions in declared order.
 *    - No veto and no mutation.
 * 5. Commit (transaction)
 *    - Apply target mutation plan atomically through `Mutator`.
 *    - On commit failure, 
 *        - revert the mutation plan, 
 *        - render command failure, and 
 *        - stop success render.
 * 6. Render/Dispatch (output)
 *    - Render the success message
 *    - Render reaction (bubble) messages in contribution order.
 *    - Uses `RenderDispatch` to execute render instructions, which may *not* include additional instructions and/or side-effectful operations (e.g. move player, inflict damage, etc.).
 *
 * Invariants:
 * - No success narration before successful commit.
 * - Bubble cannot veto and cannot mutate.
 * - Render instruction failures are best-effort and do not roll back commit.
 */

/** @typedef {import('ranvier/types/GameState')} GameState */
/** @typedef {import('ranvier/types/Command')} Command */
/** @typedef {import('./mutator').MutationPlan} MutationPlan */

/**
 * @typedef {object} Session
 * @property {import('ranvier/types/Player')} player
 */

/**
 * The command from manager.get("commandName") might return
 * a command or { command, alias } or null. This function returns a stable shape for easier downstream handling.
 *
 * @param {GameState} state
 * @param {string} commandName
 * @returns {{ command: Command | null, alias: string | null }}
 */
function resolveCommand(state, commandName) {
  const manager = state && state.CommandManager;
  if (!manager || typeof manager !== 'object') {
    return { command: null, alias: null };
  }

  if (typeof manager.get === 'function') {
    const command = manager.get(commandName);
    if (!command) {
      return { command: null, alias: null };
    }

    const isAlias = command && Array.isArray(command.aliases) && command.aliases.includes(commandName) && command.name !== commandName;
    return { command, alias: isAlias ? commandName : null };
  }

  // Legacy fallback for test stubs that only provide find(...).
  if (typeof manager.find === 'function') {
    const match = manager.find(commandName, true);
    if (!match) {
      return { command: null, alias: null };
    }

    if (typeof match === 'object' && 'command' in match && 'alias' in match) {
      if (match.alias !== commandName) {
        return { command: null, alias: null };
      }
      return { command: match.command, alias: match.alias };
    }

    // A bare command result from find(...) cannot prove exact-key lookup.
    return { command: null, alias: null };
  }

  return { command: null, alias: null };
}

/**
 * @typedef {{
 *   messages?: Array<string | { type?: string, text?: string, message?: string, [key: string]: * }>
 * }} CommandRenderPayload
 */

/**
 * @typedef {{ ok: true, plan: MutationPlan, render?: CommandRenderPayload }} CommandSuccessResult
 */

/**
 * @typedef {{ ok: false, error?: { code?: string, message?: string, details?: Record<string, *> } }} CommandFailureResult
 */

/**
 * @typedef {undefined | CommandSuccessResult | CommandFailureResult} CommandResult
 */

/**
 * @param {unknown} value
 * @returns {value is CommandSuccessResult}
 */
function isCommandSuccessResult(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = /** @type {Record<string, unknown>} */ (value);
  return candidate.ok === true && !!candidate.plan;
}

/**
 * @param {unknown} value
 * @returns {value is CommandFailureResult}
 */
function isCommandFailureResult(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = /** @type {Record<string, unknown>} */ (value);
  return candidate.ok === false;
}

/**
 * @param {unknown} value
 * @returns {value is CommandResult}
 */
function isCommandResult(value) {
  if (value === undefined) {
    return true;
  }

  return isCommandSuccessResult(value) || isCommandFailureResult(value);
}

const DEFAULT_ERROR_MESSAGES = {
  FORM_NOT_SUPPORTED: 'You can\'t do that.',
  FORM_DIRECT_NOT_SUPPORTED: 'You can\'t do that.',
  FORM_INDIRECT_NOT_SUPPORTED: 'You can\'t do that.',
  FORM_MISSING_DIRECT: 'What do you mean?',
  FORM_MISSING_INDIRECT: 'What do you mean?',
  FORM_MISSING_RELATION: 'What do you mean?',
  FORM_UNSUPPORTED_RELATION: 'You can\'t do that.',
  TARGET_NOT_FOUND: {
    direct: 'You do not see that.',
    indirect: 'You do not see that.',
  },
  AMBIGUOUS_TARGET: {
    direct: 'Which one do you mean?',
    indirect: 'Which one do you mean?',
  },
  FORBIDDEN_BLOCKED: 'You can\'t do that.',
  DETAIL_ACTION_DENIED: 'You can\'t do that.',
  ALREADY_HAVE_DIRECT: 'You already have that.',
};

/**
 * @param {*} command
 * @returns {*}
 */
function commandMetadata(command) {
  return command && command.metadata && typeof command.metadata === 'object'
    ? command.metadata
    : {};
}

/**
 * @param {*} messageMap
 * @param {string} code
 * @param {Record<string, *>} [details]
 * @returns {string | null}
 */
function lookupMessage(messageMap, code, details = {}) {
  if (!messageMap || typeof messageMap !== 'object') {
    return null;
  }

  const entry = messageMap[code];
  if (typeof entry === 'string') {
    return entry;
  }

  if (entry && typeof entry === 'object') {
    const role = typeof details.role === 'string' ? details.role : '';
    if (role && typeof entry[role] === 'string') {
      return entry[role];
    }
  }

  return null;
}

/**
 * @param {*} command
 * @param {*} error
 * @returns {string}
 */
function resolveErrorMessage(command, error) {
  const metadata = commandMetadata(command);
  const errorInfo = error && typeof error === 'object' ? error : {};
  const code = typeof errorInfo.code === 'string' ? errorInfo.code : '';
  const details = errorInfo.details && typeof errorInfo.details === 'object'
    ? /** @type {Record<string, *>} */ (errorInfo.details)
    : {};

  if (typeof errorInfo.message === 'string' && errorInfo.message.length > 0) {
    return errorInfo.message;
  }

  if (code) {
    const commandMessage = lookupMessage(metadata.errorMessages, code, details);
    if (commandMessage) {
      return commandMessage;
    }

    const defaultMessage = lookupMessage(DEFAULT_ERROR_MESSAGES, code, details);
    if (defaultMessage) {
      return defaultMessage;
    }
  }

  return 'Command failed.';
}

/**
 * @param {*} value
 * @returns {{ ok: true } | { ok: false, error: { code: string, message?: string, details?: Record<string, *> } } | null}
 */
function normalizePolicyOutcome(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (value === true || value === 'allow') {
    return { ok: true };
  }

  if (value === false || value === 'deny') {
    return {
      ok: false,
      error: { code: 'FORBIDDEN_BLOCKED' },
    };
  }

  if (typeof value === 'string') {
    return {
      ok: false,
      error: {
        code: 'FORBIDDEN_BLOCKED',
        message: value,
      },
    };
  }

  if (typeof value !== 'object') {
    return null;
  }

  const candidate = /** @type {{ ok?: boolean, allow?: boolean, code?: string, message?: string, details?: Record<string, *> }} */ (value);

  if (candidate.ok === true || candidate.allow === true) {
    return { ok: true };
  }

  if (candidate.ok === false || candidate.allow === false) {
    return {
      ok: false,
      error: {
        code: candidate.code || 'FORBIDDEN_BLOCKED',
        message: candidate.message,
        details: candidate.details,
      },
    };
  }

  return null;
}

/**
 * @param {*} roleConfig
 * @param {string | null} relationTokenCanonical
 * @returns {{ matched: boolean, value?: * }}
 */
function resolveRolePermission(roleConfig, relationTokenCanonical) {
  if (roleConfig === undefined || roleConfig === null) {
    return { matched: false };
  }

  if (typeof roleConfig !== 'object') {
    return { matched: true, value: roleConfig };
  }

  const roleObject = /** @type {Record<string, *>} */ (roleConfig);
  const relationMap = roleObject.relations && typeof roleObject.relations === 'object'
    ? /** @type {Record<string, *>} */ (roleObject.relations)
    : null;

  if (relationMap && relationTokenCanonical && Object.prototype.hasOwnProperty.call(relationMap, relationTokenCanonical)) {
    return { matched: true, value: relationMap[relationTokenCanonical] };
  }

  if (Object.prototype.hasOwnProperty.call(roleObject, 'default')) {
    return { matched: true, value: roleObject.default };
  }

  if (Object.prototype.hasOwnProperty.call(roleObject, 'allow') || Object.prototype.hasOwnProperty.call(roleObject, 'ok')) {
    return { matched: true, value: roleConfig };
  }

  return { matched: false };
}

/**
 * @param {*} verbConfig
 * @param {'direct' | 'indirect' | null} role
 * @param {string | null} relationTokenCanonical
 * @returns {*}
 */
function resolveVerbPermission(verbConfig, role, relationTokenCanonical) {
  if (verbConfig === undefined || verbConfig === null) {
    return undefined;
  }

  if (typeof verbConfig !== 'object') {
    return verbConfig;
  }

  const verbObject = /** @type {Record<string, *>} */ (verbConfig);

  if (role && Object.prototype.hasOwnProperty.call(verbObject, role)) {
    const roleResolution = resolveRolePermission(verbObject[role], relationTokenCanonical);
    if (roleResolution.matched) {
      return roleResolution.value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(verbObject, 'default')) {
    return verbObject.default;
  }

  if (Object.prototype.hasOwnProperty.call(verbObject, 'allow') || Object.prototype.hasOwnProperty.call(verbObject, 'ok')) {
    return verbConfig;
  }

  return undefined;
}

/**
 * @param {*} entity
 * @param {{ verbId: string, role: 'direct' | 'indirect' | null, relationTokenCanonical: string | null }} action
 * @returns {*}
 */
function resolveMetadataPermission(entity, action) {
  if (!entity || typeof entity !== 'object') {
    return undefined;
  }

  const metadata = entity.metadata && typeof entity.metadata === 'object'
    ? /** @type {Record<string, *>} */ (entity.metadata)
    : null;
  if (!metadata) {
    return undefined;
  }

  const permissions = metadata.permissions && typeof metadata.permissions === 'object'
    ? /** @type {Record<string, *>} */ (metadata.permissions)
    : null;
  if (!permissions) {
    return undefined;
  }

  const verbs = permissions.verbs && typeof permissions.verbs === 'object'
    ? /** @type {Record<string, *>} */ (permissions.verbs)
    : null;

  if (verbs && Object.prototype.hasOwnProperty.call(verbs, action.verbId)) {
    const resolvedVerbPermission = resolveVerbPermission(verbs[action.verbId], action.role, action.relationTokenCanonical);
    if (resolvedVerbPermission !== undefined) {
      return resolvedVerbPermission;
    }
  }

  if (Object.prototype.hasOwnProperty.call(permissions, 'default')) {
    return permissions.default;
  }

  return undefined;
}

/**
 * @param {*} entity
 * @param {{ verbId: string, role: 'direct' | 'indirect' | null, relationTokenCanonical: string | null }} action
 * @param {Record<string, *>} context
 * @returns {{ ok: true } | { ok: false, error: { code: string, message?: string, details?: Record<string, *> } } | null}
 */
function evaluateEntityPolicy(entity, action, context) {
  if (!entity || typeof entity !== 'object') {
    return null;
  }

  // Room details are look-only by design. Non-look verbs always deny, with an
  // optional per-verb override message from detail.verbs.<verbId>.
  if (entity.kind === 'roomDetail') {
    if (action.verbId === 'look') {
      return { ok: true };
    }

    const verbs = entity.verbs && typeof entity.verbs === 'object'
      ? /** @type {Record<string, *>} */ (entity.verbs)
      : null;
    const message = verbs && typeof verbs[action.verbId] === 'string'
      ? String(verbs[action.verbId]).trim()
      : '';

    return {
      ok: false,
      error: {
        code: 'DETAIL_ACTION_DENIED',
        message: message || undefined,
      },
    };
  }

  // Role-routed capture hooks (accepted-next contract):
  // - direct target: canDirect(actor, verbId, context)
  // - indirect target: canIndirect(actor, verbId, relationTokenCanonical, context)
  if (action.role === 'direct' && typeof entity.canDirect === 'function') {
    const outcome = normalizePolicyOutcome(entity.canDirect(context.player, action.verbId, context));
    if (outcome) {
      return outcome;
    }
  }

  if (action.role === 'indirect' && typeof entity.canIndirect === 'function') {
    const outcome = normalizePolicyOutcome(entity.canIndirect(
      context.player,
      action.verbId,
      action.relationTokenCanonical,
      context
    ));
    if (outcome) {
      return outcome;
    }
  }

  const metadataPermission = resolveMetadataPermission(entity, action);
  return normalizePolicyOutcome(metadataPermission);
}

/**
 * @param {Record<string, *>} context
 * @returns {Array<{ entity: *, role: 'direct' | 'indirect' | null }>}
 */
function capturePolicySubjects(context) {
  const entityResolution = context.entityResolution && typeof context.entityResolution === 'object'
    ? /** @type {Record<string, *>} */ (context.entityResolution)
    : {};
  const player = context.player && typeof context.player === 'object'
    ? context.player
    : null;
  const room = player && typeof player === 'object' && player.room && typeof player.room === 'object'
    ? player.room
    : null;
  const area = room && typeof room === 'object' && room.area && typeof room.area === 'object'
    ? room.area
    : null;
  const questSystem = context.state && typeof context.state === 'object' && context.state.QuestFactory
    ? context.state.QuestFactory
    : null;
  const world = context.state && typeof context.state === 'object'
    ? context.state
    : null;

  return [
    { entity: world, role: null },
    { entity: questSystem, role: null },
    { entity: area, role: null },
    { entity: room, role: null },
    { entity: player, role: null },
    { entity: entityResolution.indirectTarget, role: 'indirect' },
    { entity: entityResolution.directTarget, role: 'direct' },
  ];
}

/**
 * @param {*} command
 * @param {Record<string, *>} context
 * @returns {CommandFailureResult | null}
 */
function runCapturePolicyHooks(command, context) {
  const entityResolution = context.entityResolution && typeof context.entityResolution === 'object'
    ? /** @type {Record<string, *>} */ (context.entityResolution)
    : {};
  const parsedInput = context.parsedInput && typeof context.parsedInput === 'object'
    ? /** @type {Record<string, *>} */ (context.parsedInput)
    : {};
  const verbId = typeof command.name === 'string' && command.name.length > 0
    ? command.name
    : typeof parsedInput.intentToken === 'string'
      ? parsedInput.intentToken
      : '';
  const relationTokenCanonical = typeof entityResolution.relationTokenCanonical === 'string'
    ? entityResolution.relationTokenCanonical
    : null;

  for (const subject of capturePolicySubjects(context)) {
    if (!subject.entity || typeof subject.entity !== 'object') {
      continue;
    }

    const action = {
      verbId,
      role: subject.role,
      relationTokenCanonical,
    };
    const policyResult = evaluateEntityPolicy(subject.entity, action, context);
    if (policyResult && policyResult.ok === false) {
      return {
        ok: false,
        error: {
          ...policyResult.error,
          details: {
            ...(policyResult.error.details || {}),
            role: subject.role || undefined,
          },
        },
      };
    }
  }

  return null;
}

/**
 * @param {*} command
 * @param {string} key
 * @param {Record<string, *>} context
 * @returns {Array<function(Record<string, *>): *>}
 */
function collectPhaseFunctions(command, key, context) {
  const metadata = commandMetadata(command);
  const source = metadata[key];

  if (Array.isArray(source)) {
    return source.filter(fn => typeof fn === 'function');
  }

  if (typeof source === 'function') {
    const generated = source(context);
    if (Array.isArray(generated)) {
      return generated.filter(fn => typeof fn === 'function');
    }
  }

  return [];
}

/**
 * @param {*} command
 * @param {Record<string, *>} context
 * @returns {CommandFailureResult | null}
 */
function runCaptureChecks(command, context) {
  const checks = collectPhaseFunctions(command, 'captureChecks', context);
  for (const check of checks) {
    const result = check(context);
    if (result === false) {
      return { ok: false, error: { code: 'FORBIDDEN_BLOCKED' } };
    }

    if (!result || result === true) {
      continue;
    }

    if (typeof result === 'object' && 'ok' in result) {
      const candidate = /** @type {{ ok?: boolean, vetoInfo?: *, code?: string, details?: Record<string, *> }} */ (result);
      if (candidate.ok === false) {
        if (candidate.vetoInfo && typeof candidate.vetoInfo === 'object') {
          const veto = /** @type {{ code?: string, details?: Record<string, *>, message?: string }} */ (candidate.vetoInfo);
          return { ok: false, error: veto };
        }

        return {
          ok: false,
          error: {
            code: candidate.code || 'FORBIDDEN_BLOCKED',
            details: candidate.details,
          },
        };
      }
    }
  }

  const policyFailure = runCapturePolicyHooks(command, context);
  if (policyFailure) {
    return policyFailure;
  }

  return null;
}

/**
 * @typedef {{ kind: 'line', line: string } | { kind: 'instruction', instruction: * }} RenderMessage
 */

/**
 * @param {*} renderPayload
 * @param {string} sourceLabel
 * @returns {RenderMessage[]}
 */
function extractRenderMessages(renderPayload, sourceLabel) {
  if (!renderPayload || typeof renderPayload !== 'object') {
    return [];
  }

  /** @type {Record<string, *>} */
  const render = /** @type {*} */ (renderPayload);
  /** @type {RenderMessage[]} */
  const messages = [];

  if (!Object.prototype.hasOwnProperty.call(render, 'messages')) {
    Logger.error(`${sourceLabel} returned legacy render payload (lines/instructions). Use render.messages only.`);
    return messages;
  }

  if (!Array.isArray(render.messages)) {
    Logger.error(`${sourceLabel} returned invalid render.messages payload (expected array). Contribution ignored.`);
    return [];
  }

  for (const entry of render.messages) {
    if (typeof entry === 'string') {
      messages.push({ kind: 'line', line: entry });
      continue;
    }

    if (!entry || typeof entry !== 'object') {
      Logger.error(`${sourceLabel} returned invalid render.messages entry (expected string/object). Entry ignored.`);
      continue;
    }

    const candidate = /** @type {Record<string, *>} */ (entry);
    const type = typeof candidate.type === 'string'
      ? candidate.type.trim().toLowerCase()
      : '';

    if (type === 'line') {
      const lineText = Object.prototype.hasOwnProperty.call(candidate, 'text')
        ? candidate.text
        : candidate.message;
      if (lineText === undefined || lineText === null) {
        Logger.error(`${sourceLabel} returned line message without text/message payload. Entry ignored.`);
        continue;
      }
      messages.push({ kind: 'line', line: String(lineText) });
      continue;
    }

    messages.push({ kind: 'instruction', instruction: candidate });
  }

  return messages;
}

/**
 * @param {*} candidate
 * @param {RenderMessage[]} renderMessages
 * @param {{ operationsRejected: number, renderLinesAdded: number, renderInstructionsAdded: number }} diagnostics
 */
function consumeBubbleContribution(candidate, renderMessages, diagnostics) {
  if (!candidate) {
    return;
  }

  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      consumeBubbleContribution(entry, renderMessages, diagnostics);
    }
    return;
  }

  if (typeof candidate !== 'object') {
    return;
  }

  const contribution = /** @type {Record<string, *>} */ (candidate);
  const hasOperations = Array.isArray(contribution.operations);
  const render = contribution.render && typeof contribution.render === 'object'
    ? /** @type {Record<string, *>} */ (contribution.render)
    : null;

  if (hasOperations) {
    diagnostics.operationsRejected += contribution.operations.length;
    Logger.error('Bubble contribution attempted to enqueue mutation operations. Bubble may contribute render only.');
  }

  if (render) {
    const extracted = extractRenderMessages(render, 'Bubble contribution');
    if (extracted.length) {
      renderMessages.push(...extracted);
      diagnostics.renderLinesAdded += extracted.filter(entry => entry.kind === 'line').length;
      diagnostics.renderInstructionsAdded += extracted.filter(entry => entry.kind === 'instruction').length;
    }
  }

  // Unknown payload shapes are ignored to keep bubble contributions data-only.
}

/**
 * @param {*} command
 * @param {Record<string, *>} context
 * @returns {{ renderMessages: RenderMessage[], operationsRejected: number, renderLinesAdded: number, renderInstructionsAdded: number }}
 */
function collectBubbleContributions(command, context) {
  const reactions = collectPhaseFunctions(command, 'reactions', context);
  /** @type {RenderMessage[]} */
  const renderMessages = [];
  const diagnostics = {
    operationsRejected: 0,
    renderLinesAdded: 0,
    renderInstructionsAdded: 0,
  };

  for (const reaction of reactions) {
    const result = reaction(context);
    consumeBubbleContribution(result, renderMessages, diagnostics);
  }

  return {
    renderMessages,
    operationsRejected: diagnostics.operationsRejected,
    renderLinesAdded: diagnostics.renderLinesAdded,
    renderInstructionsAdded: diagnostics.renderInstructionsAdded,
  };
}

/**
 * @param {*} planPayload
 * @param {string} sourceLabel
 * @returns {Array<*>}
 */
function extractPlanOperations(planPayload, sourceLabel) {
  if (!planPayload || typeof planPayload !== 'object') {
    return [];
  }

  /** @type {Record<string, *>} */
  const plan = /** @type {*} */ (planPayload);
  if (!Array.isArray(plan.operations)) {
    Logger.error(`${sourceLabel} returned invalid plan payload (expected plan.operations array). Contribution ignored.`);
    return [];
  }

  return plan.operations;
}

/**
 * @param {*} candidate
 * @param {Array<*>} operations
 * @param {RenderMessage[]} renderMessages
 * @param {string} sourceLabel
 * @returns {CommandFailureResult | null}
 */
function consumeTargetPlanContribution(candidate, operations, renderMessages, sourceLabel) {
  if (candidate === undefined || candidate === null) {
    return null;
  }

  if (isCommandFailureResult(candidate)) {
    return candidate;
  }

  if (isCommandSuccessResult(candidate)) {
    const extractedOps = extractPlanOperations(candidate.plan, sourceLabel);
    if (extractedOps.length) {
      operations.push(...extractedOps);
    }

    const extractedMessages = extractRenderMessages(candidate.render, sourceLabel);
    if (extractedMessages.length) {
      renderMessages.push(...extractedMessages);
    }

    return null;
  }

  if (typeof candidate !== 'object') {
    return null;
  }

  /** @type {Record<string, *>} */
  const contribution = /** @type {*} */ (candidate);
  if (contribution.ok === false) {
    const error = contribution.error && typeof contribution.error === 'object'
      ? /** @type {Record<string, *>} */ (contribution.error)
      : {};
    const message = typeof contribution.message === 'string' && contribution.message.length > 0
      ? contribution.message
      : (typeof error.message === 'string' ? error.message : undefined);

    return {
      ok: false,
      error: {
        code: typeof error.code === 'string' && error.code.length > 0 ? error.code : 'COMMAND_FAILED',
        message,
        details: error.details && typeof error.details === 'object'
          ? /** @type {Record<string, *>} */ (error.details)
          : undefined,
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(contribution, 'plan')) {
    const extractedOps = extractPlanOperations(contribution.plan, sourceLabel);
    if (extractedOps.length) {
      operations.push(...extractedOps);
    }
  }

  const extractedMessages = extractRenderMessages(contribution.render, sourceLabel);
  if (extractedMessages.length) {
    renderMessages.push(...extractedMessages);
  }

  return null;
}

/**
 * @param {*} command
 * @param {Record<string, *>} context
 * @returns {{ operations: Array<*>, renderMessages: RenderMessage[], failure: CommandFailureResult | null }}
 */
function collectTargetPlanContributions(command, context) {
  const entityResolution = context.entityResolution && typeof context.entityResolution === 'object'
    ? /** @type {Record<string, *>} */ (context.entityResolution)
    : {};
  const parsedInput = context.parsedInput && typeof context.parsedInput === 'object'
    ? /** @type {Record<string, *>} */ (context.parsedInput)
    : {};
  const verbId = typeof command.name === 'string' && command.name.length > 0
    ? command.name
    : typeof parsedInput.intentToken === 'string'
      ? parsedInput.intentToken
      : '';
  const relationTokenCanonical = typeof entityResolution.relationTokenCanonical === 'string'
    ? entityResolution.relationTokenCanonical
    : null;

  /** @type {Array<*>} */
  const operations = [];
  /** @type {RenderMessage[]} */
  const renderMessages = [];

  const directTarget = entityResolution.directTarget;
  if (directTarget && typeof directTarget === 'object' && typeof directTarget.planDirect === 'function') {
    const directResult = directTarget.planDirect(context.player, verbId, context);
    const directFailure = consumeTargetPlanContribution(
      directResult,
      operations,
      renderMessages,
      'Direct target planDirect'
    );
    if (directFailure) {
      return { operations, renderMessages, failure: directFailure };
    }
  }

  const indirectTarget = entityResolution.indirectTarget;
  if (indirectTarget && typeof indirectTarget === 'object' && typeof indirectTarget.planIndirect === 'function') {
    const indirectResult = indirectTarget.planIndirect(
      context.player,
      verbId,
      relationTokenCanonical,
      context
    );
    const indirectFailure = consumeTargetPlanContribution(
      indirectResult,
      operations,
      renderMessages,
      'Indirect target planIndirect'
    );
    if (indirectFailure) {
      return { operations, renderMessages, failure: indirectFailure };
    }
  }

  return { operations, renderMessages, failure: null };
}

/**
 * This function is responsible for interpreting the various render instructions from the target phase and the bubble contributions, and delivering them to the screen in the correct order.
 * @param {Record<string, *>} dispatchContext
 * @param {CommandSuccessResult} success
 * @param {RenderMessage[]} [bubbleRenderMessages]
 * @returns {{ linesRendered: number, instructionsAttempted: number, failures: number }}
 */
function renderSuccess(dispatchContext, success, bubbleRenderMessages = []) {
  if (!success || typeof success !== 'object') {
    return { linesRendered: 0, instructionsAttempted: 0, failures: 0 };
  }

  const player = dispatchContext.player;
  let linesRendered = 0;
  let instructionsAttempted = 0;
  let failures = 0;
  const render = success.render;
  const targetRenderMessages = extractRenderMessages(render, 'Command');
  const queue = [
    ...targetRenderMessages,
    ...(Array.isArray(bubbleRenderMessages) ? bubbleRenderMessages : []),
  ];

  for (const message of queue) {
    if (message.kind === 'line') {
      Broadcast.sayAt(player, message.line);
      linesRendered += 1;
      continue;
    }

    const instructionStats = RenderDispatch.executeRenderInstructions(dispatchContext, [message.instruction]);
    instructionsAttempted += instructionStats.instructionsAttempted;
    failures += instructionStats.failures;
  }

  return { linesRendered, instructionsAttempted, failures };
}

/**
 * Execute a command with full phase context. Ranvier `Command` wrappers expose
 * `func` and drop extra args in `execute`, so prefer `func` when present.
 *
 * @param {*} command
 * @param {string} args
 * @param {*} player
 * @param {string | null} alias
 * @param {Record<string, *>} context
 * @returns {Promise<unknown>}
 */
async function executeCommand(command, args, player, alias, context) {
  if (command && typeof command.func === 'function') {
    return command.func(args, player, alias, context);
  }

  return command.execute(args, player, alias, context);
}

/**
 * @param {GameState} state
 * @param {Session} session
 * @param {string} input
 * @returns {Promise<void>}
 */
async function handleCommand(state, session, input) {
  const player = session.player;
  const parsedInput = /** @type {Record<string, *>} */ (parseInput(input));

  const isEmpty = !parsedInput.normalizedInput || parsedInput.normalizedInput.length === 0;

  if (isEmpty) {
    Broadcast.prompt(player);
    return;
  }


  const noIntent = !parsedInput.intentToken;

  if (noIntent) {
    Broadcast.sayAt(player, 'What?');
    Broadcast.prompt(player);
    return;
  }

  const commandName = parsedInput.intentToken;
  const args = parsedInput.normalizedInput.split(' ').slice(1).join(' ');

  const { command, alias } = resolveCommand(state, commandName);

  const noCommandFound = !command || typeof command.execute !== 'function'

  if (noCommandFound) {
    Broadcast.sayAt(player, 'What?');
    Broadcast.prompt(player);
    return;
  }

  try {
    const entityResolution = EntityResolution.resolveEntityContext(state, command, player, parsedInput);
    if (!entityResolution.ok) {
      const resolutionFailure = /** @type {{ error: { code?: string, details?: Record<string, *> } }} */ (entityResolution);
      const message = resolveErrorMessage(command, resolutionFailure.error);
      Broadcast.sayAt(player, message);
      Broadcast.prompt(player);
      return;
    }

    const phaseContext = {
      state,
      session,
      player,
      command,
      alias,
      parsedInput,
      rawInput: input,
      entityResolution: entityResolution.value,
    };

    const captureFailure = runCaptureChecks(command, phaseContext);
    if (captureFailure) {
      const message = resolveErrorMessage(command, captureFailure.error);
      Broadcast.sayAt(player, message);
      Broadcast.prompt(player);
      return;
    }

    const result = await executeCommand(command, args, player, alias, {
      parsedInput,
      rawInput: input,
      entityResolution: entityResolution.value,
    });

    if (!isCommandResult(result)) {
      Logger.warn('Command returned an invalid result envelope. Ignoring return value.');
      return;
    }

    if (isCommandSuccessResult(result)) {
      const targetPlanContributions = collectTargetPlanContributions(command, phaseContext);
      if (targetPlanContributions.failure) {
        const message = resolveErrorMessage(command, targetPlanContributions.failure.error);
        Broadcast.sayAt(player, message);
        Broadcast.prompt(player);
        return;
      }

      const bubbleContributions = collectBubbleContributions(command, phaseContext);
      const baseOperations = extractPlanOperations(result.plan, 'Command');
      const mergedPlan = {
        operations: [
          ...baseOperations,
          ...targetPlanContributions.operations,
        ],
      };

      try {
        Mutator.applyMutationPlan(state, mergedPlan);
      } catch (err) {
        /** @type {{ stack?: string, message?: string, name?: string }} */
        const commitError = /** @type {*} */ (err);
        Logger.error(commitError.stack || commitError.message || 'Unknown commit error');
        Broadcast.sayAt(player, 'Command failed.');
        const isStillActivePlayer = state.PlayerManager.getPlayer(player.name) === player;
        if (isStillActivePlayer && player.socket && player.socket.writable) {
          Broadcast.prompt(player);
        }
        return;
      }

      const renderStats = renderSuccess(
        {
          state,
          player,
          directTarget: entityResolution.value && entityResolution.value.directTarget
            ? entityResolution.value.directTarget
            : null,
          indirectTarget: entityResolution.value && entityResolution.value.indirectTarget
            ? entityResolution.value.indirectTarget
            : null,
        },
        result,
        [
          ...targetPlanContributions.renderMessages,
          ...bubbleContributions.renderMessages,
        ]
      );
      void renderStats;
    } else if (isCommandFailureResult(result)) {
      const message = resolveErrorMessage(command, result.error);
      Broadcast.sayAt(player, message);
    }
  } catch (err) {
    /** @type {{ stack?: string, message?: string, name?: string }} */
    const commandError = /** @type {*} */ (err);
    Logger.error(commandError.stack || commandError.message || 'Unknown command error');
    Broadcast.sayAt(player, 'Command failed.');
  }

  const isStillActivePlayer = state.PlayerManager.getPlayer(player.name) === player;
  if (isStillActivePlayer && player.socket && player.socket.writable) {
    Broadcast.prompt(player);
  }
}

module.exports = {
  handleCommand,
};
