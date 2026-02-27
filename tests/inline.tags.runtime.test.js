// @ts-check
'use strict';

const assert = require('assert');
const { parseInlineTags } = require('../lib/inline-tags/parse-inline-tags');
const { renderInlineTags } = require('../lib/inline-tags/render-inline-tags');
const { createInlineTagCache } = require('../lib/inline-tags/inline-tag-cache');
const { resolveInlineTags, buildSurfaceRef } = require('../lib/inline-tags/resolve-inline-tags');

describe('bundle-rantamuta inline tag runtime', function () {
  it('parses predicate-only nested tags with escaping', function () {
    const input = 'The hall is [is_night:[is_raining:dark\\|wet|dark\\:still]|bright].';
    const result = parseInlineTags(input);

    assert.deepStrictEqual(result.diagnostics, []);
    assert.strictEqual(Array.isArray(result.ast), true);
    assert.strictEqual(result.ast.length > 0, true);
  });

  it('renders then/else branches using runtime.evaluate', function () {
    const { ast, diagnostics } = parseInlineTags('The lamp is [is_lit:on|off].');
    assert.deepStrictEqual(diagnostics, []);

    const renderedOn = renderInlineTags(ast, {
      evaluate: (name) => name === 'is_lit',
    }, {});
    const renderedOff = renderInlineTags(ast, {
      evaluate: () => false,
    }, {});

    assert.strictEqual(renderedOn, 'The lamp is on.');
    assert.strictEqual(renderedOff, 'The lamp is off.');
  });

  it('uses LRU eviction order in inline tag cache', function () {
    const cache = createInlineTagCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    assert.strictEqual(cache.get('a'), 1);
    cache.set('c', 3);

    assert.strictEqual(cache.get('b'), undefined);
    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('c'), 3);
  });

  it('resolveInlineTags fail-opens on parse diagnostics and logs warning', function () {
    const warnings = [];
    const logger = {
      warn: (message) => warnings.push(message),
    };

    const source = 'Broken [is_lit:on|off';
    const surfaceRef = buildSurfaceRef('test:lantern', 'room.description');
    const output = resolveInlineTags(source, {
      surfaceRef,
      logger,
      runtime: { evaluate: () => true },
    });

    assert.strictEqual(output, source);
    assert.strictEqual(warnings.length > 0, true);
    assert.strictEqual(warnings[0].includes(surfaceRef), true);
  });
});
