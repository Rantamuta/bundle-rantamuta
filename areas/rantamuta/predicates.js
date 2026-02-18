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

module.exports = {
  is_slab_open: ({ q }) => isDescentOpen(q),
  is_basin_runes_glowing: ({ q }) => basinRunesGlowing(q),
};
