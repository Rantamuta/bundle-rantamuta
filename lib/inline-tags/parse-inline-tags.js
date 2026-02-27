// @ts-check
'use strict';

const PREDICATE_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ESCAPABLE = new Set(['[', ']', ':', '|', '\\']);

/**
 * @param {string} value
 * @returns {{ type: 'text', value: string }}
 */
function textNode(value) {
  return { type: 'text', value };
}

/**
 * @param {string} predicate
 * @param {Array<object>} thenNodes
 * @param {Array<object>} elseNodes
 * @returns {{ type: 'tag', predicate: string, thenNodes: Array<object>, elseNodes: Array<object> }}
 */
function tagNode(predicate, thenNodes, elseNodes) {
  return {
    type: 'tag',
    predicate,
    thenNodes,
    elseNodes,
  };
}

class ParseError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} index
   */
  constructor(code, message, index) {
    super(message);
    this.name = 'ParseError';
    this.code = code;
    this.index = index;
  }
}

/**
 * @param {string} source
 * @param {number} index
 * @returns {{ code: string, message: string, index: number }}
 */
function parseDiagnosticFromError(source, index) {
  if (source[index] === '[') {
    return {
      code: 'E_MISSING_COLON',
      message: "expected ':' after predicate",
      index,
    };
  }

  return {
    code: 'E_TAG_UNTERMINATED',
    message: "unterminated tag: expected closing ']" + "'",
    index,
  };
}

/**
 * @param {string} source
 * @returns {{ parseDocument: () => Array<object> }}
 */
function createParser(source) {
  let index = 0;

  /**
   * @param {Set<string> | null} stopTokens
   * @returns {Array<object>}
   */
  function parseSegments(stopTokens) {
    /** @type {Array<object>} */
    const nodes = [];
    let buffer = '';

    while (index < source.length) {
      const ch = source[index];

      if (stopTokens && stopTokens.has(ch)) {
        break;
      }

      if (ch === '\\') {
        if (index + 1 >= source.length) {
          buffer += '\\';
          index += 1;
          continue;
        }

        const next = source[index + 1];
        if (ESCAPABLE.has(next)) {
          buffer += next;
        } else {
          buffer += `\\${next}`;
        }
        index += 2;
        continue;
      }

      if (ch === '[') {
        if (buffer.length > 0) {
          nodes.push(textNode(buffer));
          buffer = '';
        }
        nodes.push(parseTag());
        continue;
      }

      buffer += ch;
      index += 1;
    }

    if (buffer.length > 0) {
      nodes.push(textNode(buffer));
    }

    return nodes;
  }

  /**
   * @returns {object}
   */
  function parseTag() {
    const tagStartIndex = index;
    index += 1; // consume '['

    const predicateStart = index;
    while (index < source.length && source[index] !== ':') {
      const current = source[index];
      if (current === '[' || current === ']' || current === '|') {
        throw new ParseError('E_MISSING_COLON', "expected ':' after predicate", tagStartIndex);
      }
      index += 1;
    }

    if (index >= source.length) {
      throw new ParseError('E_MISSING_COLON', "expected ':' after predicate", tagStartIndex);
    }

    const predicate = source.slice(predicateStart, index).trim();
    if (!PREDICATE_KEY_PATTERN.test(predicate)) {
      throw new ParseError('E_INVALID_PREDICATE', `invalid predicate key '${predicate}'`, predicateStart);
    }

    index += 1; // consume ':'
    const thenNodes = parseSegments(new Set(['|', ']']));

    if (index >= source.length) {
      throw new ParseError('E_TAG_UNTERMINATED', "unterminated tag: expected closing ']'", tagStartIndex);
    }

    /** @type {Array<object>} */
    let elseNodes = [];
    if (source[index] === '|') {
      index += 1;
      elseNodes = parseSegments(new Set([']']));
      if (index >= source.length) {
        throw new ParseError('E_TAG_UNTERMINATED', "unterminated tag: expected closing ']'", tagStartIndex);
      }
    }

    if (source[index] !== ']') {
      throw new ParseError('E_TAG_UNTERMINATED', "unterminated tag: expected closing ']'", tagStartIndex);
    }

    index += 1; // consume ']'
    return tagNode(predicate, thenNodes, elseNodes);
  }

  return {
    parseDocument: () => parseSegments(null),
  };
}

/**
 * Parse predicate-only inline tags into AST for render-time evaluation.
 * On parse error, returns one diagnostic and falls back to a text-only AST.
 *
 * @param {string} template
 * @returns {{ ast: Array<object>, diagnostics: Array<{ code: string, message: string, index: number }> }}
 */
function parseInlineTags(template) {
  const source = typeof template === 'string' ? template : String(template || '');
  if (!source.length) {
    return {
      ast: [],
      diagnostics: [],
    };
  }

  try {
    const parser = createParser(source);
    return {
      ast: parser.parseDocument(),
      diagnostics: [],
    };
  } catch (error) {
    if (error instanceof ParseError) {
      return {
        ast: [textNode(source)],
        diagnostics: [{
          code: error.code,
          message: error.message,
          index: error.index,
        }],
      };
    }

    const fallback = parseDiagnosticFromError(source, 0);
    return {
      ast: [textNode(source)],
      diagnostics: [fallback],
    };
  }
}

module.exports = {
  parseInlineTags,
};
