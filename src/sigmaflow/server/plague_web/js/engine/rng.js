/* Seeded PRNG (mulberry32) — deterministic runs for tests, state serializable for saves. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.PlagueEng = root.PlagueEng || {}; root.PlagueEng.Rng = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function Rng(seed) { this.s = seed >>> 0; }
  /* mulberry32 with explicit state: this.s IS the stream position (save/restore exact). */
  Rng.prototype.next = function () {
    this.s = (this.s + 0x6D2B79F5) | 0;
    var t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Rng.prototype.float = function () { return this.next(); };
  Rng.prototype.range = function (lo, hi) { return lo + this.next() * (hi - lo); };
  Rng.prototype.int = function (lo, hi) { return Math.floor(this.range(lo, hi + 1)); }; // inclusive
  Rng.prototype.chance = function (p) { return this.next() < p; };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
  Rng.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(this.next() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  /* Serializable state: exact stream position for deterministic save/load. */
  Rng.prototype.getState = function () { return this.s; };
  Rng.prototype.setState = function (seed) { this.s = seed >>> 0; };
  return Rng;
});
