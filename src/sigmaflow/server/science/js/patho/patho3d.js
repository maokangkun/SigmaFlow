/* ================= 虚拟病原体 · 3D 形态视图(P6) =================
 * 软件渲染的"示意形态"观察器: 按病原体大类生成 Scheinförmig 模型
 * (病毒衣壳+刺突 / 细菌杆-球+鞭毛+芽孢 / 真菌芽殖+菌丝 / 原虫不规则体 /
 * 蠕虫分节链 / 朊粒纤维束), 画家算法 z 排序 + Lambert 双光源。
 * 铁律之下的诚实: 这是教学示意图, 不是真实结构 —— 标签永远写明。
 */
(() => {
  'use strict';
  const G = typeof window !== 'undefined' ? window : globalThis;
  const PALETTE = {
    virus: ['#d05a76', '#a8485f'], bacterium: ['#3f9e8f', '#2f7a6e'], fungus: ['#c9a15a', '#a07c3e'],
    protozoa: ['#6d84c9', '#5268a8'], worm: ['#b08560', '#8a6544'], prion: ['#9a7ab5', '#755a90'],
  };

  function morphology(entry, tt) {
    // 返回 {spheres:[{x,y,z,r,c,op}], captions, spikes}
    const k = entry.kind, parts = { spheres: [], captions: [], spikes: 0 };
    const push = (x, y, z, r, c, op) => parts.spheres.push({ x, y, z, r, c, glow: op });
    const [c1, c2] = (PALETTE[k] || PALETTE.virus).map ? (PALETTE[k] || PALETTE.virus) : PALETTE.virus;
    if (k === 'virus') {
      // 衣壳: 内层密集球构成球壳 + 刺突经线环
      const R = 62;
      for (let i = 0; i < 5; i++) for (let j = 0; j < 10; j++) {
        const a = (j / 10) * Math.PI * 2, b = (i / 4 - 0.5) * Math.PI * 0.92;
        push(Math.cos(a) * Math.cos(b) * R * 0.82, Math.sin(b) * R * 0.82, Math.sin(a) * Math.cos(b) * R * 0.82, 12, c1);
      }
      for (let ring = 0; ring < 3; ring++) {
        const b = (ring / 2 - 0.5) * Math.PI * 0.66, n = 12 - ring * 2;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + tt * 0.15 + ring * 0.4;
          const x = Math.cos(a) * Math.cos(b), y = Math.sin(b), z = Math.sin(a) * Math.cos(b);
          push(x * (R + 12), y * (R + 12), z * (R + 12), 8.5, c2, 0.92);   // 刺突头
          push(x * (R + 3), y * (R + 3), z * (R + 3), 2.6, c2);            // 刺突柄
          parts.spikes++;
        }
      }
      // 核衣壳螺旋
      for (let i = 0; i < 16; i++) {
        const a = i * 0.55 + tt * 0.3, r = 20;
        push(Math.cos(a) * r, (i / 16 - 0.5) * 46, Math.sin(a) * r, 6.5, '#e8d7de');
      }
      parts.captions.push('包膜病毒示意图: 刺突(经线 3 环) + 螺旋核衣壳');
    } else if (k === 'bacterium') {
      const rod = !/cocci|staph|strep|梭|strepto/i.test(entry.zh + entry.id);
      if (rod) {
        for (let i = -1; i <= 1; i++) push(i * 34, 0, 0, 30, c1);
        push(0, 26, 0, 26, c2, 0.35); push(0, -26, 0, 26, c2, 0.2);      // 荚膜(半透)
        for (const fz of [-1, 1]) for (let i = 0; i < 14; i++) {
          const ph = i * 0.5 + tt * 3 * fz;
          push(46 * fz + i * 5 * fz, Math.sin(ph) * 22, Math.cos(ph) * 6, 2.2, c2, 0.9);
        }
        if (/芽孢|anthr|梭|clostrid/i.test(entry.zh + entry.id)) push(0, 0, 34, 24, '#d8c9a0', 0.85);  // 芽孢
        parts.captions.push(rod ? '杆菌示意: 鞭毛波动推进 + 荚膜' + (/芽孢|anthr|梭/.test(entry.zh) ? ' + 芽孢' : '') : '');
        parts.spikes = 28;  // 鞭毛节点数(形态学上可供像素验收)
      } else {
        for (const [dx, dy] of [[-20, -12], [20, -12], [-20, 16], [20, 16]]) push(dx, dy, 0, 24, c1);
        for (let i = 0; i < 12; i++) push(0, 62 + Math.sin(i * 0.7 + tt * 2) * 4, Math.cos(i * 0.7) * 5, 1.8, c2, 0.9);
        parts.captions.push('球菌示意: 四联排列 + 菌毛');
      }
    } else if (k === 'fungus') {
      if (/丝|霉|mold/i.test(entry.id + entry.zh)) {
        for (const dx of [-40, 0, 40]) for (let i = 0; i < 9; i++) push(dx, -70 + i * 18, Math.sin(i * 0.8 + dx) * 8, 9, i === 8 ? c2 : c1);
        parts.captions.push('丝状真菌示意: 分枝菌丝 + 顶端孢子');
      } else {
        push(0, 0, 0, 58, c1);
        push(52, 28, 12, 26, c2, 0.95); push(-46, 34, -8, 20, c2, 0.9);    // 出芽
        parts.captions.push('酵母示意: 出芽繁殖');
      }
      parts.spikes = 27;
    } else if (k === 'protozoa') {
      const seed = [[0, 0, 0, 44], [38, 20, -14, 26], [-40, -8, 18, 24], [10, 42, 22, 22], [-22, -40, -20, 20], [30, -36, 10, 18]];
      for (const [x, y, z, r] of seed) push(x, y, z, r, c1);
      for (let fz = 0; fz < 3; fz++) for (let i = 0; i < 10; i++) {
        const ph = i * 0.55 + tt * 4 + fz * 2.1;
        const a = fz * 2.09;
        push(Math.cos(a) * 46 + i * 5.5, Math.sin(ph) * 10, Math.sin(a) * 46 + Math.cos(a) * i * 2.5 + i * 3, 2.4, c2, 0.9);
      }
      parts.spikes = 30; parts.captions.push('原虫示意: 不规则体 + 波动膜/鞭毛');
    } else if (k === 'helminth') {
      for (let i = 0; i < 14; i++) {
        const ph = (i / 13) * Math.PI * 2.2 + tt * 0.9;
        const r = 30 - Math.abs(i - 6.5) * 1.6;
        push(Math.cos(ph) * 60 * 0.0 + (i - 6.5) * 15, Math.sin(ph) * 26, Math.cos(0.6 * i) * 10, r, i % 3 === 0 ? c2 : c1);
      }
      push(-98, Math.sin(-0.6 + tt * 0.9) * 26, Math.cos(-0.8) * 10, 17, c2); // 头节
      parts.captions.push('蠕虫示意: 分节链 + 头节(体节按解剖退化示意)');
      parts.spikes = 15;
    } else {  // prion
      for (const dx of [-34, 0, 34]) for (let i = 0; i < 14; i++) {
        push(dx + (i % 2 ? 7 : -7) + Math.sin(i * 0.9 + tt) * 2, -58 + i * 9, Math.cos(i * 0.8 + dx) * 4, 6.5, i % 4 === 0 ? c2 : c1);
      }
      parts.captions.push('朊粒示意: β-折叠纤维束(错误折叠聚集)');
      parts.spikes = 42;
    }
    return parts;
  }

  let S = null;   // {yaw, pitch, zoom, dragging, lastX, lastY, t0, raf, entry, el:{box, cv, cap}}

  function render() {
    const s = S;
    if (!s || !document.getElementById('patho3d')) { close(); return; }
    const cv = s.el.cv, ctx = cv.getContext('2d');
    const W = cv.width, Hh = cv.height;
    ctx.fillStyle = '#10131c'; ctx.fillRect(0, 0, W, Hh);
    const tt = (performance.now() - s.t0) / 1000;
    if (!s.dragging) s.yaw += 0.008;                                 // 自转(拖拽即接管)
    const m = morphology(s.entry, tt);
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw), cp = Math.cos(s.pitch), sp = Math.sin(s.pitch);
    const zo = s.zoom * Math.min(W, Hh) / 260;
    const view = m.spheres.map(p => {
      let x = p.x * cy - p.z * sy, z1 = p.x * sy + p.z * cy, y = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
      return { x: W / 2 + x * zo, y: Hh / 2 + y * zo, z: z2, r: Math.max(1.2, p.r * zo * (1 - z2 / 900)), c: p.c, glow: p.glow };
    }).sort((a, b) => b.z - a.z);
    for (const p of view) {
      const nx = (-0.45), ny = (-0.35), NZ = 0.82;   // 面向相机的简化法线近似 + z 项
      const lum = 0.34 + 0.5 * Math.max(0, (NZ * (p.r / (16 * zo * 0.5 + 12)) + 0.4)) + (p.glow ? 0.18 : 0);
      ctx.globalAlpha = p.glow ? Math.min(1, p.glow) : 1;
      ctx.fillStyle = shade(p.c, lum);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
      if (p.r > 10 * zo) {       // 高光点(大球才有)
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath(); ctx.arc(p.x - p.r * 0.32, p.y - p.r * 0.34, p.r * 0.28, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (s.el.cap) s.el.cap.textContent = `${s.entry.zh}(${s.entry.id}) · ${m.captions[0] || ''} · tier ${s.entry.tier} —— 示意形态, 非真实结构`;
    s.raf = requestAnimationFrame(render);
  }

  function shade(hex, lum) {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v * lum)));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function open(entryId) {
    const C = G.PathoCatalog;
    const id = entryId || (G.PathoHost && G.PathoHost.state() && G.PathoHost.state().entry.id);
    const entry = C && (C.get(id) || C.get(id));
    if (!C || !entry) { if (G.CS && G.CS.toast) G.CS.toast('先选择病原体', 'error'); return; }
    close();
    const box = document.createElement('div');
    box.id = 'patho3d';
    box.innerHTML = `
      <div class="p23d-card">
        <div class="p23d-head"><b>🦠 形态视图</b><button type="button" class="pai-x" id="p23dClose">✕</button></div>
        <canvas id="p23dCv" width="480" height="400"></canvas>
        <div class="p23d-hint">拖拽旋转 · 滚轮缩放 · 自动自转</div>
        <div class="p23d-cap" id="p23dCap"></div>
      </div>`;
    (document.getElementById('pathogen-root') || document.body).appendChild(box);
    S = {
      yaw: 0.4, pitch: 0.18, zoom: 1, dragging: false, t0: performance.now(), raf: 0,
      entry,
      el: { box, cv: box.querySelector('#p23dCv'), cap: box.querySelector('#p23dCap') },
    };
    box.addEventListener('mousedown', e => { if (e.target.tagName !== 'BUTTON') { S.dragging = true; S.lastX = e.clientX; S.lastY = e.clientY; } });
    window.addEventListener('mousemove', e => {
      if (!S || !S.dragging) return;
      S.yaw += (e.clientX - S.lastX) * 0.011;
      S.pitch = Math.max(-1.3, Math.min(1.3, S.pitch + (e.clientY - S.lastY) * 0.008));
      S.lastX = e.clientX; S.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { if (S) S.dragging = false; });
    box.addEventListener('wheel', e => { e.preventDefault(); S.zoom = Math.max(0.45, Math.min(2.2, S.zoom * (e.deltaY < 0 ? 1.09 : 0.92))); }, { passive: false });
    box.querySelector('#p23dClose').addEventListener('click', close);
    render();
  }

  function close() {
    if (S && S.raf) cancelAnimationFrame(S.raf);
    if (S && S.el.box && S.el.box.parentNode) S.el.box.parentNode.removeChild(S.el.box);
    S = null;
  }

  G.Patho3D = { open, close, morphology, state: () => S };
  G.openPatho3D = () => G.Patho3D.open();
})();
