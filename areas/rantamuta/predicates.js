// @ts-check
'use strict';

/**
 * Bell Crypt render predicates for room description fragments.
 *
 * These remain descriptive-only and mirror the gate-requirement placements
 * used by gameplay policy in room scripts.
 */

/**
 * Placement requirements that open the Bell Crypt descent.
 * Each tuple is [roomRef, containerRef, itemRef].
 * @type {Array<[string, string, string]>}
 */
const DESCENT_REQUIREMENTS = [
  ['rantamuta:bell_belfry', 'rantamuta:crackedBell', 'rantamuta:bronzeClapper'],
  ['rantamuta:bell_nave', 'rantamuta:reliquary', 'rantamuta:waxSeal'],
  ['rantamuta:bell_crypt', 'rantamuta:stoneBasin', 'rantamuta:prayerStone'],
];

/**
 * @param {*} q
 * @returns {boolean}
 */
function isDescentOpen(q) {
  if (!q || typeof q.roomContainerHasItem !== 'function') {
    return false;
  }

  return DESCENT_REQUIREMENTS.every(([roomRef, containerRef, itemRef]) =>
    q.roomContainerHasItem(roomRef, containerRef, itemRef)
  );
}

/**
 * @param {*} q
 * @returns {boolean}
 */
function basinRunesGlowing(q) {
  if (!q || typeof q.roomContainerHasItem !== 'function') {
    return false;
  }

  return q.roomContainerHasItem(
    'rantamuta:bell_crypt',
    'rantamuta:stoneBasin',
    'rantamuta:prayerStone'
  );
}

/**
 * @param {*} q
 * @returns {boolean}
 */
function hasBronzeClapperInBell(q) {
  if (!q || typeof q.roomContainerHasItem !== 'function') {
    return false;
  }

  return q.roomContainerHasItem(
    'rantamuta:bell_belfry',
    'rantamuta:crackedBell',
    'rantamuta:bronzeClapper'
  );
}

/**
 * @param {*} q
 * @returns {boolean}
 */
function hasWaxSealInReliquary(q) {
  if (!q || typeof q.roomContainerHasItem !== 'function') {
    return false;
  }

  return q.roomContainerHasItem(
    'rantamuta:bell_nave',
    'rantamuta:reliquary',
    'rantamuta:waxSeal'
  );
}

/**
 * @param {*} q
 * @returns {boolean}
 */
function hasResonantShardInGallery(q) {
  if (!q || typeof q.roomHasItem !== 'function') {
    return false;
  }

  return q.roomHasItem('rantamuta:perception_gallery', 'rantamuta:resonantShard');
}

module.exports = {
  is_slab_open: ({ q }) => isDescentOpen(q),
  is_basin_runes_glowing: ({ q }) => basinRunesGlowing(q),
  is_gallery_feature_enabled: ({ q }) =>
    !!(q && typeof q.areaFlag === 'function' && q.areaFlag('rantamuta', 'galleryFeatureEnabled')),
  is_gallery_mirrors_awake: ({ q }) =>
    !!(q && typeof q.roomFlag === 'function' && q.roomFlag('rantamuta:perception_gallery', 'mirrorsAwake')),
  is_resonant_shard_in_gallery: ({ q }) => hasResonantShardInGallery(q),
  does_viewer_hold_resonant_shard: ({ q }) =>
    !!(q && typeof q.actorHasItem === 'function' && q.actorHasItem('rantamuta:resonantShard')),
  is_wax_seal_in_reliquary: ({ q }) => hasWaxSealInReliquary(q),
  is_bronze_clapper_in_bell: ({ q }) => hasBronzeClapperInBell(q),
  is_gallery_harmonic: ({ q }) =>
    isDescentOpen(q) && hasBronzeClapperInBell(q) && hasWaxSealInReliquary(q),
};
