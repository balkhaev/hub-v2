export const WIDGET_PROTOCOL_VERSION = 1;

/**
 * @typedef {object} WidgetAction
 * @property {string} command
 * @property {string} label
 * @property {string=} requiredRole
 * @property {boolean=} confirmation
 * @property {Record<string, unknown>=} input
 */

/**
 * Build a typed widget envelope. Widgets are projections; entity state remains
 * canonical in the API and every action is a named, server-authorized command.
 *
 * @param {object} input
 * @param {string} input.type
 * @param {{kind: string, id: string}} input.entity
 * @param {Record<string, unknown>} input.snapshot
 * @param {WidgetAction[]=} input.actions
 */
export function createWidget({ type, entity, snapshot, actions = [] }) {
  if (!type.includes(".")) {
    throw new TypeError("Widget type must be namespaced, for example persona.card");
  }

  return {
    type,
    version: WIDGET_PROTOCOL_VERSION,
    entity,
    snapshot,
    actions,
  };
}

/** @param {unknown} value */
export function isWidgetEnvelope(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof value.type === "string" &&
      value.version === WIDGET_PROTOCOL_VERSION &&
      value.entity &&
      typeof value.entity.kind === "string" &&
      typeof value.entity.id === "string" &&
      value.snapshot &&
      typeof value.snapshot === "object" &&
      Array.isArray(value.actions),
  );
}
