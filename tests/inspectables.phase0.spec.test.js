// @ts-check
'use strict';

const assert = require('assert');

describe('inspectables and stateful rendering phased specs', function () {
  describe('phase guardrails (pending)', function () {
    it.skip('look direct scope prefers room.items, then room.details, then player.inventory', function () {
      assert.fail('pending implementation');
    });

    it.skip('look chooses room item over room detail when both match the same noun', function () {
      assert.fail('pending implementation');
    });

    it.skip('look resolves room details and renders their description', function () {
      assert.fail('pending implementation');
    });

    it.skip('non-look actions on details are denied using detail verbs message override', function () {
      assert.fail('pending implementation');
    });

    it.skip('take/get against inventory target returns ALREADY_HAVE_DIRECT', function () {
      assert.fail('pending implementation');
    });

    it.skip('descriptionVariants selects first matching predicate in declaration order', function () {
      assert.fail('pending implementation');
    });

    it.skip('descriptionFragments append all matching lines in declaration order', function () {
      assert.fail('pending implementation');
    });

    it.skip('render predicate evaluation is read-only and side-effect free', function () {
      assert.fail('pending implementation');
    });
  });
});
