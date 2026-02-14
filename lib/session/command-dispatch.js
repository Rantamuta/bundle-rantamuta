// @ts-check
'use strict';

const { Broadcast, Logger } = require('ranvier');
const { parseInput } = require('../parse-input');
const Mutator = require('./mutator');
const EntityResolution = require('./entity-resolution');

/** @typedef {import('ranvier/types/GameState')} GameState */
/** @typedef {import('ranvier/types/Command')} Command */
/** @typedef {import('./mutator').MutationPlan} MutationPlan */

/**
 * @typedef {object} Session
 * @property {import('ranvier/types/Player')} player
 */

/**
 * Normalize command lookup into a stable nullable command shape.
 * Lookup is exact by intent/alias key; prefix matching is intentionally not used.
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
 * @typedef {{ lines?: string[] }} CommandRenderPayload
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

  if (typeof entity.allowAction === 'function') {
    const outcome = normalizePolicyOutcome(entity.allowAction(action, context));
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
 * @param {*} candidate
 * @param {Array<*>} operations
 * @param {string[]} renderLines
 */
function consumeBubbleContribution(candidate, operations, renderLines) {
  if (!candidate) {
    return;
  }

  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      consumeBubbleContribution(entry, operations, renderLines);
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
  const hasRenderLines = !!render && Array.isArray(render.lines);

  if (hasOperations) {
    operations.push(...contribution.operations);
  }

  if (hasRenderLines && render) {
    renderLines.push(...render.lines.map(line => String(line)));
  }

  if (hasOperations || hasRenderLines) {
    return;
  }

  // Backward-compatible single-operation shape.
  operations.push(contribution);
}

/**
 * @param {*} command
 * @param {Record<string, *>} context
 * @returns {{ operations: Array<*>, renderLines: string[] }}
 */
function collectBubbleContributions(command, context) {
  const reactions = collectPhaseFunctions(command, 'reactions', context);
  /** @type {Array<*>} */
  const operations = [];
  /** @type {string[]} */
  const renderLines = [];

  for (const reaction of reactions) {
    const result = reaction(context);
    consumeBubbleContribution(result, operations, renderLines);
  }

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

  const subjects = [
    { entity: entityResolution.directTarget, role: 'direct' },
    { entity: entityResolution.indirectTarget, role: 'indirect' },
    { entity: player, role: null },
    { entity: room, role: null },
    { entity: area, role: null },
    { entity: questSystem, role: null },
    { entity: world, role: null },
  ];

  for (const subject of subjects) {
    if (!subject.entity || typeof subject.entity !== 'object' || typeof subject.entity.bubbleEvent !== 'function') {
      continue;
    }

    const action = {
      verbId,
      role: subject.role,
      relationTokenCanonical,
    };
    const result = subject.entity.bubbleEvent(action, context);
    consumeBubbleContribution(result, operations, renderLines);
  }

  return { operations, renderLines };
}

/**
 * @param {MutationPlan} basePlan
 * @param {Array<*>} bubbleOperations
 * @returns {MutationPlan}
 */
function mergePlanOperations(basePlan, bubbleOperations) {
  if (!bubbleOperations.length) {
    return basePlan;
  }

  const operations = Array.isArray(basePlan && basePlan.operations)
    ? [...basePlan.operations, ...bubbleOperations]
    : [...bubbleOperations];

  return { operations };
}

/**
 * @param {*} player
 * @param {CommandSuccessResult} success
 * @param {string[]} [bubbleRenderLines]
 */
function renderSuccess(player, success, bubbleRenderLines = []) {
  if (!success || typeof success !== 'object') {
    return;
  }

  /** @type {string[]} */
  const lines = [];
  const render = success.render;
  if (render && typeof render === 'object' && Array.isArray(render.lines)) {
    lines.push(...render.lines.map(line => String(line)));
  }

  if (Array.isArray(bubbleRenderLines) && bubbleRenderLines.length > 0) {
    lines.push(...bubbleRenderLines.map(line => String(line)));
  }

  if (!lines.length) {
    return;
  }

  for (const line of lines) {
    Broadcast.sayAt(player, line);
  }
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
 */
async function handleCommand(state, session, input) {
  const player = session.player;
  const parsedInput = parseInput(input);

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
      Broadcast.sayAt(player, resolveErrorMessage(command, entityResolution.error));
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
      Broadcast.sayAt(player, resolveErrorMessage(command, captureFailure.error));
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
      const bubbleContributions = collectBubbleContributions(command, phaseContext);
      const mergedPlan = mergePlanOperations(result.plan, bubbleContributions.operations);
      Mutator.applyMutationPlan(state, mergedPlan);
      renderSuccess(player, result, bubbleContributions.renderLines);
    } else if (isCommandFailureResult(result)) {
      Broadcast.sayAt(player, resolveErrorMessage(command, result.error));
    }
  } catch (err) {
    /** @type {{ stack?: string, message?: string }} */
    const commandError = err;
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
