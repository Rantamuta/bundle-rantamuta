// @ts-check
'use strict';

/**
 * @param {{ evaluate?: Function } | null | undefined} runtime
 * @param {string} predicate
 * @param {Record<string, *>} renderContext
 * @returns {boolean}
 */
function evaluate(runtime, predicate, renderContext) {
  if (!runtime || typeof runtime.evaluate !== 'function') {
    return false;
  }

  try {
    return runtime.evaluate(predicate, renderContext) === true;
  } catch (_error) {
    return false;
  }
}

/**
 * @param {Array<object>} nodes
 * @param {{ evaluate?: Function } | null | undefined} runtime
 * @param {Record<string, *>} renderContext
 * @returns {string}
 */
function renderNodes(nodes, runtime, renderContext) {
  if (!Array.isArray(nodes) || !nodes.length) {
    return '';
  }

  let output = '';
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue;
    }

    if (node.type === 'text') {
      output += typeof node.value === 'string' ? node.value : '';
      continue;
    }

    if (node.type === 'tag') {
      const predicate = typeof node.predicate === 'string' ? node.predicate : '';
      const matched = evaluate(runtime, predicate, renderContext);
      const branchNodes = matched ? node.thenNodes : node.elseNodes;
      output += renderNodes(Array.isArray(branchNodes) ? branchNodes : [], runtime, renderContext);
    }
  }

  return output;
}

/**
 * Render inline-tag AST through predicate runtime evaluation.
 *
 * @param {Array<object>} ast
 * @param {{ evaluate?: Function } | null | undefined} runtime
 * @param {Record<string, *>} renderContext
 * @returns {string}
 */
function renderInlineTags(ast, runtime, renderContext = {}) {
  return renderNodes(Array.isArray(ast) ? ast : [], runtime, renderContext);
}

module.exports = {
  renderInlineTags,
};
