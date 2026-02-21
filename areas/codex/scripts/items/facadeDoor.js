'use strict';

const DOOR_VERBS = new Set(['open', 'close', 'lock', 'unlock']);

function asObject(value) {
  return value && typeof value === 'object' ? value : {};
}

function valuesAsArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === 'function') return Array.from(collection);
  return [];
}

function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDirection(value) {
  return String(value || '').trim().toLowerCase();
}

function actorHasKey(actor, keyRef) {
  const needle = normalizeRef(keyRef);
  if (!needle) return true;
  for (const item of valuesAsArray(actor && actor.inventory)) {
    const itemRef = normalizeRef(item && (item.entityReference || item.id || item.name));
    if (itemRef === needle) return true;
  }
  return false;
}

function verbFlavor(flavor, verbId) {
  const base = String(verbId || '').trim().toLowerCase();
  if (typeof flavor[base] === 'string') {
    return flavor[base];
  }

  return `{actor.You} {verb:${base}} the brass iris gate.`;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return null;
}

module.exports = {
  listeners: {
    spawn: state => function onSpawn() {
      void state;
      const metadata = asObject(this.metadata);
      const cfg = asObject(metadata.facadeDoor);
      const denied = asObject(cfg.denied);
      const remote = asObject(cfg.remote);
      const flavor = asObject(cfg.flavor);

      // Make this item usable as a door target for open/close/lock/unlock.
      this.roomId = String(cfg.roomId || '').trim();
      this.direction = String(cfg.direction || '').trim().toLowerCase();

      // Hint `go` to suppress generic composed unlock/open+leave messaging on this facade edge.
      const currentRoom = this.room && typeof this.room === 'object'
        ? this.room
        : null;
      const targetRoomRef = normalizeRef(this.roomId);
      const targetDirection = normalizeDirection(this.direction);
      for (const exit of valuesAsArray(currentRoom && currentRoom.exits)) {
        const exitRoomRef = normalizeRef(exit && exit.roomId);
        const exitDirection = normalizeDirection(exit && exit.direction);
        if (exitRoomRef === targetRoomRef && exitDirection === targetDirection) {
          exit.suppressComposedDoorMovementMessages = true;
          const priorCanDirect = typeof exit.canDirect === 'function'
            ? exit.canDirect.bind(exit)
            : null;
          const priorPlanDirect = typeof exit.planDirect === 'function'
            ? exit.planDirect.bind(exit)
            : null;

          const facadeExitCanDirect = (actor, verbId, context) => {
            void context;
            const verb = String(verbId || '').trim().toLowerCase();
            if (verb !== 'go') {
              return null;
            }

            if (!actorHasKey(actor, cfg.requiredKeyRef)) {
              const deniedMessage = typeof denied[verb] === 'string' ? denied[verb] : null;
              if (deniedMessage) {
                return deniedMessage;
              }
            }

            return null;
          };

          const facadeExitPlanDirect = (actor, verbId, context) => {
            void actor;
            const verb = String(verbId || '').trim().toLowerCase();
            if (verb !== 'go') {
              return null;
            }

            const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
              ? context.entityResolution
              : null;
            if (!resolution || resolution.directTarget !== exit) {
              return null;
            }

            return {
              renderPolicy: {
                replaceSuccess: true,
              },
              render: {
                messages: [
                  {
                    type: 'semanticEvent',
                    template: verbFlavor(flavor, verb),
                    audiencePolicy: 'self_and_others',
                    participants: {
                      actor: { selector: 'currentPlayer' },
                    },
                    objectText: {
                      direct: 'brass iris gate',
                    },
                  },
                ],
              },
            };
          };

          exit.canDirect = (actor, verbId, context) => firstDefined(
            facadeExitCanDirect(actor, verbId, context),
            priorCanDirect ? priorCanDirect(actor, verbId, context) : null
          );
          exit.planDirect = (actor, verbId, context) => firstDefined(
            facadeExitPlanDirect(actor, verbId, context),
            priorPlanDirect ? priorPlanDirect(actor, verbId, context) : null
          );
          break;
        }
      }

      this.canDirect = (actor, verbId, context) => {
        void context;
        const verb = String(verbId || '').trim().toLowerCase();
        if (!DOOR_VERBS.has(verb)) return null;

        if (!actorHasKey(actor, cfg.requiredKeyRef)) {
          const deniedMessage = typeof denied[verb] === 'string' ? denied[verb] : null;
          if (deniedMessage) return deniedMessage;
        }

        return null;
      };

      this.planDirect = (actor, verbId, context) => {
        const verb = String(verbId || '').trim().toLowerCase();
        if (!DOOR_VERBS.has(verb)) return null;

        const resolution = context && context.entityResolution && typeof context.entityResolution === 'object'
          ? context.entityResolution
          : null;
        if (!resolution || resolution.directTarget !== this) return null;

        const applied = verbFlavor(flavor, verb);
        const remoteMessage = typeof remote[verb] === 'string' ? remote[verb] : '';

        const contribution = {
          renderPolicy: {
            replaceSuccess: true,
          },
          render: {
            messages: [
              {
                type: 'semanticEvent',
                template: applied,
                audiencePolicy: 'self_and_others',
                participants: {
                  actor: { selector: 'currentPlayer' },
                },
                objectText: {
                  direct: 'brass iris gate',
                },
              },
              remoteMessage
                ? {
                  type: 'broadcast',
                  audience: 'room',
                  targetSelector: 'roomByRef',
                  targetRoomRef: this.roomId,
                  message: remoteMessage,
                }
                : null,
            ].filter(Boolean),
          },
        };

        return contribution;
      };
    },
  },
};
