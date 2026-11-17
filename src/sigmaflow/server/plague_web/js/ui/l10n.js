/* l10n — keys are the English source text (en.strings in the APK is empty: key == English).
 * Lookup: l10n_zh.json[english]; fallback to the key itself. */
(function (root) {
  'use strict';
  var L = {
    table: {},
    init: function (l10nJson) { this.table = l10nJson || {}; return this; },
    t: function (key, params) {
      var s = this.table[key];
      if (s === undefined || s === null || s === '') s = key;
      if (params) {
        Object.keys(params).forEach(function (p) {
          s = s.split('%' + p).join(params[p]);
        });
      }
      return s;
    },
    /* substitute params first, then translate the whole sentence (news templates like
     * "%s bans all flights" are single l10n keys) */
    news: function (key, params) {
      var direct = this.t(key, params);
      if (this.table[key] !== undefined) return direct;
      // try translating with the country name already substituted
      return this.t(key, params);
    },
    country: function (nameEn) {
      var zh = this.table[nameEn];
      return (zh && zh !== nameEn) ? zh + ' (' + nameEn + ')' : nameEn;
    },
    plain: function (nameEn) {
      var zh = this.table[nameEn];
      return (zh && zh !== nameEn) ? zh : nameEn;
    },
    has: function (key) { return this.table[key] !== undefined; }
  };
  root.L10N = L;
})(typeof self !== 'undefined' ? self : this);
