'use strict';

const assert = require('assert');
const { deepClone } = require('../lib/helpers/deep-clone');

describe('bundle-rantamuta deep-clone helper', function () {
  it('returns a new top-level object and new nested structures', function () {
    const source = {
      actor: {
        id: 'tomo',
        tags: ['keeper', 'bell'],
      },
      level: 2,
    };

    const clone = deepClone(source);

    assert.notStrictEqual(clone, source);
    assert.notStrictEqual(clone.actor, source.actor);
    assert.notStrictEqual(clone.actor.tags, source.actor.tags);
    assert.deepStrictEqual(clone, source);
  });

  it('leaves the source unchanged when mutating the clone', function () {
    const source = { room: { ref: 'codex:atrium' }, flags: ['lit'] };

    const clone = deepClone(source);
    clone.room.ref = 'codex:hall';
    clone.flags.push('visited');

    assert.deepStrictEqual(source, { room: { ref: 'codex:atrium' }, flags: ['lit'] });
  });

  it('clones arrays of supported values', function () {
    const source = [{ id: 'a' }, ['x', 'y'], 3, null, true];

    const clone = deepClone(source);

    assert.deepStrictEqual(clone, source);
    assert.notStrictEqual(clone, source);
    assert.notStrictEqual(clone[0], source[0]);
    assert.notStrictEqual(clone[1], source[1]);
  });

  it('rejects Map without changing the source', function () {
    const map = new Map([['a', 1]]);

    assert.throws(() => deepClone(map), /plain data/i);
    assert.strictEqual(map.get('a'), 1);
    assert.strictEqual(map.size, 1);
  });

  it('rejects Set without changing the source', function () {
    const set = new Set(['a']);

    assert.throws(() => deepClone(set), /plain data/i);
    assert.strictEqual(set.has('a'), true);
    assert.strictEqual(set.size, 1);
  });

  it('rejects Date without changing the source', function () {
    const date = new Date('2024-01-01T00:00:00.000Z');

    assert.throws(() => deepClone(date), /plain data/i);
    assert.strictEqual(date.toISOString(), '2024-01-01T00:00:00.000Z');
  });

  it('rejects function values without changing the source', function () {
    const source = { handler: () => 'noop', mode: 'x' };

    assert.throws(() => deepClone(source), /function value/i);
    assert.strictEqual(typeof source.handler, 'function');
    assert.strictEqual(source.mode, 'x');
  });

  it('rejects circular input without changing the source', function () {
    const source = { id: 'loop' };
    source.self = source;

    assert.throws(() => deepClone(source), /circular/i);
    assert.strictEqual(source.self, source);
  });

  it('rejects Buffer and typed arrays without changing the source', function () {
    const buffer = Buffer.from('abc');
    const typed = new Uint8Array([1, 2, 3]);

    assert.throws(() => deepClone(buffer), /plain data/i);
    assert.throws(() => deepClone(typed), /plain data/i);
    assert.strictEqual(buffer.toString('utf8'), 'abc');
    assert.deepStrictEqual(Array.from(typed), [1, 2, 3]);
  });

  it('does not invoke getters while inspecting object input', function () {
    const source = {};
    let getterCalls = 0;

    Object.defineProperty(source, 'danger', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter should not run');
      },
    });

    assert.throws(() => deepClone(source), /enumerable data properties/i);
    assert.strictEqual(getterCalls, 0);
  });

  it('does not invoke array index getters while inspecting array input', function () {
    const source = [];
    let getterCalls = 0;

    Object.defineProperty(source, '0', {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error('getter should not run');
      },
    });

    assert.throws(() => deepClone(source), /enumerable data properties/i);
    assert.strictEqual(getterCalls, 0);
  });

  it('returns primitive values unchanged', function () {
    assert.strictEqual(deepClone(1), 1);
    assert.strictEqual(deepClone('x'), 'x');
    assert.strictEqual(deepClone(true), true);
    assert.strictEqual(deepClone(null), null);
    assert.strictEqual(deepClone(undefined), undefined);
  });

  it('copies own "__proto__" as a plain key without mutating clone prototype', function () {
    const source = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');

    const clone = deepClone(source);

    assert.deepStrictEqual(Object.keys(clone).sort(), ['__proto__', 'safe']);
    assert.deepStrictEqual(clone.__proto__, { polluted: true });
    assert.strictEqual(Object.getPrototypeOf(clone), Object.prototype);
    assert.strictEqual(clone.polluted, undefined);
  });

  it('preserves null-prototype objects', function () {
    const source = Object.create(null);
    source.id = 'n0';

    const clone = deepClone(source);

    assert.strictEqual(Object.getPrototypeOf(clone), null);
    assert.deepStrictEqual(Object.keys(clone), ['id']);
    assert.strictEqual(clone.id, 'n0');
  });
});
