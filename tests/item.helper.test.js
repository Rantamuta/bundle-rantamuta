'use strict';

const assert = require('assert');
const { matchItems } = require('../lib/helpers/item-helper');

describe('bundle-rantamuta item-helper', function () {
  it('matches by noun alias and all adjective qualifiers', function () {
    const items = [
      { name: 'old rag', keywords: ['rag', 'old'] },
      { name: 'stinky rag', keywords: ['rag', 'stinky'] },
      { name: 'stinky old rag', keywords: ['rag', 'stinky', 'old'] },
    ];

    const matches = matchItems(items, ['stinky', 'old', 'rag']);

    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].name, 'stinky old rag');
  });

  it('matches noun-only input and returns all noun matches in original order', function () {
    const items = [
      { name: 'old rag', keywords: ['rag', 'old'] },
      { name: 'stinky old rag', keywords: ['rag', 'stinky', 'old'] },
      { name: 'wooden stick', keywords: ['stick'] },
    ];

    const matches = matchItems(items, ['rag']);

    assert.deepStrictEqual(matches.map(item => item.name), ['old rag', 'stinky old rag']);
  });

  it('matches adjective tokens from item name even when absent from keywords', function () {
    const items = [
      { name: 'old rag', keywords: ['rag'] },
      { name: 'new rag', keywords: ['rag'] },
    ];

    const matches = matchItems(items, ['old', 'rag']);

    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].name, 'old rag');
  });

  it('returns empty array for invalid or empty inputs', function () {
    assert.deepStrictEqual(matchItems([], []), []);
    assert.deepStrictEqual(matchItems(null, ['rag']), []);
    assert.deepStrictEqual(matchItems([], null), []);
    assert.deepStrictEqual(matchItems([{ name: 'old rag', keywords: ['rag'] }], ['']), []);
  });
});
