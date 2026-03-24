'use strict';

const assert = require('assert');
const { deepFreeze } = require('../lib/helpers/deep-freeze');

describe('bundle-rantamuta deep-freeze helper', function () {
  it('recursively freezes nested objects and arrays', function () {
    const value = {
      top: {
        list: [{ count: 1 }],
      },
    };

    const frozen = deepFreeze(value);

    assert.ok(Object.isFrozen(frozen));
    assert.ok(Object.isFrozen(frozen.top));
    assert.ok(Object.isFrozen(frozen.top.list));
    assert.ok(Object.isFrozen(frozen.top.list[0]));
  });

  it('returns primitives unchanged', function () {
    assert.strictEqual(deepFreeze('x'), 'x');
    assert.strictEqual(deepFreeze(42), 42);
    assert.strictEqual(deepFreeze(null), null);
    assert.strictEqual(deepFreeze(undefined), undefined);
  });

  it('handles cyclic objects without throwing', function () {
    const node = { name: 'root' };
    node.self = node;

    const frozen = deepFreeze(node);

    assert.strictEqual(frozen.self, frozen);
    assert.ok(Object.isFrozen(frozen));
  });

  it('does not invoke getters while traversing properties', function () {
    let calls = 0;
    const value = {};
    Object.defineProperty(value, 'expensive', {
      get() {
        calls += 1;
        return { nested: true };
      },
      enumerable: true,
      configurable: true,
    });

    deepFreeze(value);

    assert.strictEqual(calls, 0);
    assert.ok(Object.isFrozen(value));
  });

  it('does not throw when object graph includes Buffer or TypedArray values', function () {
    const value = {
      payload: Buffer.from([1, 2, 3]),
      typed: new Uint16Array([7, 8]),
    };

    const frozen = deepFreeze(value);

    assert.ok(Object.isFrozen(frozen));
    assert.strictEqual(frozen.payload, value.payload);
    assert.strictEqual(frozen.typed, value.typed);
  });
});
