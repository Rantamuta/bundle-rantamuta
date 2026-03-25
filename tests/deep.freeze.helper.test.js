'use strict';

const assert = require('assert');
const { deepFreeze } = require('../lib/helpers/deep-freeze');

describe('bundle-rantamuta deep-freeze helper', function () {
  it('returns a new top-level object and new nested structures', function () {
    const source = {
      actor: {
        id: 'tomo',
        tags: ['keeper', 'bell'],
      },
      level: 2,
    };

    const frozen = deepFreeze(source);

    assert.notStrictEqual(frozen, source);
    assert.notStrictEqual(frozen.actor, source.actor);
    assert.notStrictEqual(frozen.actor.tags, source.actor.tags);
    assert.deepStrictEqual(frozen, source);
  });

  it('deeply freezes the returned clone and leaves source unfrozen', function () {
    const source = { room: { ref: 'codex:atrium' }, flags: ['lit'] };

    const frozen = deepFreeze(source);

    assert.strictEqual(Object.isFrozen(frozen), true);
    assert.strictEqual(Object.isFrozen(frozen.room), true);
    assert.strictEqual(Object.isFrozen(frozen.flags), true);
    assert.strictEqual(Object.isFrozen(source), false);
    assert.strictEqual(Object.isFrozen(source.room), false);
    assert.strictEqual(Object.isFrozen(source.flags), false);
  });

  it('leaves source data unchanged', function () {
    const source = { room: { ref: 'codex:atrium' }, flags: ['lit'] };

    const frozen = deepFreeze(source);

    assert.deepStrictEqual(source, { room: { ref: 'codex:atrium' }, flags: ['lit'] });
    assert.deepStrictEqual(frozen, source);
  });

  it('rejects unsupported Map input without changing source', function () {
    const map = new Map([['a', 1]]);

    assert.throws(() => deepFreeze(map), /plain data/i);
    assert.strictEqual(map.get('a'), 1);
  });

  it('rejects unsupported Set input without changing source', function () {
    const set = new Set(['a']);

    assert.throws(() => deepFreeze(set), /plain data/i);
    assert.strictEqual(set.has('a'), true);
  });

  it('rejects unsupported Date input without changing source', function () {
    const date = new Date('2024-01-01T00:00:00.000Z');

    assert.throws(() => deepFreeze(date), /plain data/i);
    assert.strictEqual(date.toISOString(), '2024-01-01T00:00:00.000Z');
  });

  it('rejects function values without changing source', function () {
    const source = { handler: () => 'noop', mode: 'x' };

    assert.throws(() => deepFreeze(source), /function value/i);
    assert.strictEqual(typeof source.handler, 'function');
    assert.strictEqual(source.mode, 'x');
  });

  it('rejects circular input without changing source', function () {
    const source = { id: 'loop' };
    source.self = source;

    assert.throws(() => deepFreeze(source), /circular/i);
    assert.strictEqual(source.self, source);
    assert.strictEqual(Object.isFrozen(source), false);
  });

  it('rejects Buffer and typed arrays without changing source', function () {
    const buffer = Buffer.from('abc');
    const typed = new Uint8Array([1, 2, 3]);

    assert.throws(() => deepFreeze(buffer), /plain data/i);
    assert.throws(() => deepFreeze(typed), /plain data/i);
    assert.strictEqual(buffer.toString('utf8'), 'abc');
    assert.deepStrictEqual(Array.from(typed), [1, 2, 3]);
  });

  it('returns primitive values unchanged', function () {
    assert.strictEqual(deepFreeze(1), 1);
    assert.strictEqual(deepFreeze('x'), 'x');
    assert.strictEqual(deepFreeze(true), true);
    assert.strictEqual(deepFreeze(null), null);
    assert.strictEqual(deepFreeze(undefined), undefined);
  });

  it('freezes cloned own "__proto__" key as data, not as prototype mutation', function () {
    const source = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');

    const frozen = deepFreeze(source);

    assert.deepStrictEqual(Object.keys(frozen).sort(), ['__proto__', 'safe']);
    assert.deepStrictEqual(frozen.__proto__, { polluted: true });
    assert.strictEqual(Object.getPrototypeOf(frozen), Object.prototype);
    assert.strictEqual(frozen.polluted, undefined);
    assert.strictEqual(Object.isFrozen(frozen.__proto__), true);
  });
});
