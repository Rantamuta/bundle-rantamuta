// @ts-check
'use strict';

const assert = require('assert');
const predicates = require('../areas/codex/predicates');

describe('bundle-rantamuta codex predicates area identity', function () {
  it('checks gallery feature flag on codex area id', function () {
    const calls = [];
    const q = {
      areaFlag(areaRef, flag) {
        calls.push([areaRef, flag]);
        return areaRef === 'codex' && flag === 'galleryFeatureEnabled';
      },
    };

    const result = predicates.is_gallery_feature_enabled({ q });

    assert.strictEqual(result, true);
    assert.deepStrictEqual(calls, [['codex', 'galleryFeatureEnabled']]);
  });
});
