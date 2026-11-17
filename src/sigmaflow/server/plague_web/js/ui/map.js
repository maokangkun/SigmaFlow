/* World map — renders realmap.svg country paths (authoritative geometry, path ids ==
 * country keys), paints countries by infection/death state, animates transmission
 * particles along air/sea/land routes, handles hover + click. */
(function (root) {
  'use strict';

  var VIEW_W = 960, VIEW_H = 632;          // from map_geometry.json svg_canvas
  var LAYER_TY = -420.36218;               // svg_layer_translate_y

  function MapView(opts) {
    this.container = opts.container;
    this.onHover = opts.onHover || function () {};
    this.onClick = opts.onClick || function () {};
    this.countries = opts.countries;       // countries.json
    this.routes = opts.routes;             // routes.json
    this.centers = {};                     // key -> {x,y} svg space
    this.parts = [];                       // {el, base}
    this.particles = [];
    this.paused = false;
    this._build();
  }

  MapView.prototype._build = function () {
    var self = this;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + VIEW_W + ' ' + VIEW_H);
    svg.setAttribute('class', 'worldmap');
    this.svg = svg;

    fetch('assets/map/realmap.svg').then(function (r) { return r.text(); }).then(function (txt) {
      var doc = new DOMParser().parseFromString(txt, 'image/svg+xml');
      var detail = null;
      var gs0 = doc.querySelectorAll('svg > g');
      for (var gi = 0; gi < gs0.length; gi++) {
        if (gs0[gi].getAttribute('inkscape:label') === 'detail') { detail = gs0[gi]; break; }
      }
      if (!detail) {
        // fallback: first <g> containing country-id paths
        for (var i = 0; i < gs0.length; i++) {
          if (gs0[i].querySelector('path[id]')) { detail = gs0[i]; break; }
        }
      }
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('transform', 'translate(0,' + LAYER_TY + ')');
      var paths = detail.querySelectorAll('path[id]');
      var seen = {};
      for (var p = 0; p < paths.length; p++) {
        var src = paths[p];
        var idRaw = src.getAttribute('id');
        var base = idRaw.replace(/\d+$/, '');   // australia2 -> australia (73 parts → 58 countries)
        var el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        el.setAttribute('d', src.getAttribute('d'));
        el.setAttribute('data-country', base);
        el.setAttribute('class', 'country-shape');
        el.addEventListener('mouseenter', function (ev) {
          self.onHover(this.getAttribute('data-country'), ev);
        });
        el.addEventListener('mouseleave', function () { self.onHover(null); });
        el.addEventListener('click', function (ev) {
          self.onClick(this.getAttribute('data-country'), ev);
        });
        g.appendChild(el);
        self.parts.push({ el: el, base: base });
        seen[base] = true;
      }
      self.countryCount = Object.keys(seen).length;
      svg.insertBefore(g, svg.firstChild);
      svg.dataset.ready = '1';
      svg.dispatchEvent(new CustomEvent('mapready', { bubbles: true }));
      if (self.afterBuild) self.afterBuild();
    });

    // particle canvas overlay (same viewBox space)
    var canvas = document.createElement('canvas');
    canvas.className = 'route-canvas';
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    var wrap = document.createElement('div');
    wrap.className = 'map-wrap';
    wrap.appendChild(svg);
    wrap.appendChild(canvas);
    this.container.appendChild(wrap);
    this.wrap = wrap;

    window.addEventListener('resize', function () { self._resize(); });
    this._resize();
    this._loop();
  };

  MapView.prototype._resize = function () {
    var r = this.wrap.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(2, Math.round(r.width * dpr));
    this.canvas.height = Math.max(2, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.viewW = r.width; this.viewH = r.height;
  };

  MapView.prototype.centerOf = function (key) {
    if (this.centers[key]) return this.centers[key];
    var raw = (this.countries[key] || {}).country_center;   // "x,y" in svg canvas space
    if (!raw) return null;
    var xy = raw.split(',').map(Number);
    this.centers[key] = { x: xy[0], y: xy[1] };
    return this.centers[key];
  };

  MapView.prototype._toCanvas = function (pt) {
    var s = Math.min(this.viewW / VIEW_W, this.viewH / VIEW_H);
    var ox = (this.viewW - VIEW_W * s) / 2, oy = (this.viewH - VIEW_H * s) / 2;
    return { x: (pt.x * s + ox) * this.dpr, y: (pt.y * s + oy) * this.dpr, s: s * this.dpr };
  };

  /* infection state → color: healthy gray → infected red → dead black */
  MapView.prototype.colorFor = function (st) {
    if (!st) return '#4b5a50';
    var N = st.pop0 || 1;
    var deadF = st.dead / N, infF = st.infected / Math.max(1, st.healthy + st.infected);
    if (st.infected <= 0 && deadF <= 0) return '#46554b';
    var r, g, b;
    if (deadF > 0.999) return '#0c0c0c';
    // blend: base green-gray → red by infection, → black by deaths
    var base = [70, 85, 75], red = [196, 32, 32], black = [12, 12, 12];
    function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
    var c = mix(base, red, Math.min(1, Math.pow(infF, 0.6)));
    c = mix(c, black, Math.min(1, deadF * 1.15));
    r = Math.round(c[0]); g = Math.round(c[1]); b = Math.round(c[2]);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  };

  /* engine countries state → paint paths */
  MapView.prototype.paint = function (engineCountries) {
    var self = this;
    if (!this.parts.length) { this.afterBuild = function () { self.paint(engineCountries); }; return; }
    this.parts.forEach(function (p) {
      var st = engineCountries[p.base];
      p.el.style.fill = self.colorFor(st);
      var inf = st && st.infected > 0;
      p.el.classList.toggle('has-plague', !!inf);
      p.el.classList.toggle('dead', !!(st && st.pop0 && st.dead / st.pop0 > 0.999));
    });
  };

  /* spawn particles for routes with infected, open-border endpoints */
  MapView.prototype.updateParticles = function (engine, dt) {
    var self = this;
    if (!engine) return;
    function routeOk(a, b, kind) {
      var A = engine.countries[a], B = engine.countries[b];
      if (!A || !B || A.infected <= 0 || B.healthy <= 0) return false;
      if (kind === 'air') return A.airOpen && B.airOpen;
      if (kind === 'sea') return A.seaOpen && B.seaOpen;
      return A.landOpen && B.landOpen;
    }
    var kinds = [
      { list: engine.airRoutes, kind: 'air', color: '#ffd166', rate: 0.10 },
      { list: engine.seaRoutes, kind: 'sea', color: '#6ec6ff', rate: 0.05 },
      { list: engine.landRoutes, kind: 'land', color: '#b0b0b0', rate: 0.03 }
    ];
    kinds.forEach(function (K) {
      K.list.forEach(function (r) {
        var fwd = routeOk(r.a, r.b, K.kind), rev = routeOk(r.b, r.a, K.kind);
        if ((fwd || rev) && Math.random() < K.rate) {
          var from = fwd ? r.a : r.b, to = fwd ? r.b : r.a;
          self.particles.push({ from: from, to: to, t: 0, color: K.color, kind: K.kind });
        }
      });
    });
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.t += dt * (p.kind === 'air' ? 0.35 : p.kind === 'sea' ? 0.18 : 0.10);
      if (p.t >= 1) this.particles.splice(i, 1);
    }
    if (this.particles.length > 400) this.particles.splice(0, this.particles.length - 400);
  };

  MapView.prototype._loop = function () {
    var self = this;
    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.1, (now - last) / 1000); last = now;
      var ctx = self.ctx;
      ctx.clearRect(0, 0, self.canvas.width, self.canvas.height);
      if (self.onFrame) self.onFrame(dt);
      self.particles.forEach(function (p) {
        var A = self.centerOf(p.from), B = self.centerOf(p.to);
        if (!A || !B) return;
        var a = self._toCanvas(A), b = self._toCanvas(B);
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * 0.12 - 8 * a.s / 4;
        var t = p.t;
        var x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x;
        var y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y;
        ctx.beginPath();
        ctx.arc(x, y, 1.6 * self.dpr, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  };

  root.MapView = MapView;
})(typeof self !== 'undefined' ? self : this);
