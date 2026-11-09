/* ================= 虚拟果蝇(FlyChat) · 页面控制器 =================
 * 与虚拟患者/病原体页同构: V.fly 渲染静态壳 #fly-root, app.js 在重渲染时
 * 把活的 DOM 原样搬回(保 3D canvas)。本文件负责:
 *   - 引擎探测(/fly/status): 在线 → 聊天 + 实时全脑 3D; 离线 → 一键部署卡
 *   - 聊天(POST /fly/chat): 每 token 增量驱动全脑 LIF 仿真, 回复由
 *     Qwen2.5-1.5B(LoRA) 经脑状态前缀投影生成
 *   - 3D: 胞体云底图 + 活动神经元辉光(轮询 /fly/activity) + 突触连线
 *     + LOD2 全脑线框(按需分块加载)
 * 引擎与 50GB 级权重独立部署(不随 python 包分发), 本页经同源代理访问。
 * 3D 内核复用 vendor/cell3d.min.js 的 THREE/OrbitControls(懒加载)。
 */
(() => {
  'use strict';
  const esc = s => CS.escape(String(s ?? ''));
  const S = {
    mounted: false, busy: false, timers: [], raf: 0,
    meta: null, engineOk: null, wireMesh: null, wireLoading: false,
    activePts: null, activeEdges: null, baseActiveSize: 6,
    renderer: null, scene: null, camera: null, controls: null,
    fpsT: 0, fpsN: 0,
  };
  window.FlyUI = {
    reset: () => _reset(),
    toggleWire: () => _toggleWire(),
    suspend: () => _teardown(true),
    // 调试/测试句柄: 投影模型包围盒中心到屏幕坐标(相对画布尺寸的 0~1)
    probe: () => {
      const cv = window.CellViewer;
      if (!cv || !S.scene || !S.camera || !S.meta) return null;
      const bb = new cv.THREE.Box3();
      // 与胞体云同源: 用 soma 有效点集建包围盒
      const soma = S.meta.soma;
      let n = 0;
      for (const sp of soma) { if (sp) { if (!n) { bb.min.set(sp[0], sp[1], sp[2]); bb.max.set(sp[0], sp[1], sp[2]); } else bb.expandByPoint(new cv.THREE.Vector3(sp[0], sp[1], sp[2])); n++; if (n > 200000) break; } }
      const c = bb.getCenter(new cv.THREE.Vector3()).project(S.camera);
      return { x: (c.x + 1) / 2, y: (1 - c.y) / 2 };
    },
  };

  const stopTimers = () => { S.timers.forEach(t => clearInterval(t)); S.timers = []; if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } };

  // 离开页面(或重挂)时: 停轮询/渲染循环, 释放 WebGL 上下文
  const _teardown = suspendOnly => {
    stopTimers();
    if (S.renderer) { try { S.renderer.dispose(); } catch {} }
    if (suspendOnly) S.mounted = false;
  };

  const _msg = (role, text, meta) => {
    const box = document.getElementById('flyMsgs');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'fly-msg ' + role;
    d.innerHTML = `<div class="fly-msg-text">${esc(text)}</div>` + (meta ? `<div class="fly-msg-meta small">${esc(meta)}</div>` : '');
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 200) box.firstElementChild.remove();
  };

  const _foot = t => { const el = document.getElementById('flyFoot'); if (el) el.textContent = t; };
  const _hud = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
  const _dot = ok => { const el = document.getElementById('flyDot'); if (el) el.className = 'fly-dot ' + (ok ? 'on' : 'off'); };

  // ---------------- 引擎探测 / 部署引导 ----------------
  const _pollStatus = async () => {
    try {
      const st = await CS.api.request('/fly/status', { method: 'GET', timeout: 8000 });
      const wasOk = S.engineOk;
      S.engineOk = !!st.ok;
      _dot(S.engineOk);
      if (!st.ok) {
        if (wasOk !== false) _renderSetup(st);
        _foot('引擎未连接（' + (st.error || '不可达') + '）');
        return;
      }
      if (wasOk === false) window.location.reload();  // 部署完成后恢复完整界面
      const s = st.status || {};
      _foot(`就绪 · ${s.llm_base || 'LLM'} + ${s.adapter || ''} · 已对话 ${s.turns ?? 0} 轮 · 累计 ${CS.num(s.n_tokens_total || 0)} token · 全脑 ${CS.num(s.n_neurons || 0)} 神经元`);
    } catch (err) {
      S.engineOk = false;
      _dot(false);
      if (document.getElementById('flySetup') === null) _renderSetup({ error: CS.api.friendlyError(err), repo: '' });
      _foot('状态查询失败。');
    }
  };

  // 引擎离线时的部署引导卡(新拟态): 权重不在 python 包里, 从 GitHub 一键下载
  const _renderSetup = st => {
    const body = document.getElementById('flyChat');
    const viz = document.getElementById('flyViz');
    if (!body || document.getElementById('flySetup')) return;
    if (viz) viz.innerHTML = `<div class="fly-setup-viz small">🪰<br>大脑 3D 视图在引擎上线后自动点亮</div>`;
    body.innerHTML = `
      <div class="fly-setup" id="flySetup">
        <div class="fly-setup-ic">🪰</div>
        <h2>果蝇引擎尚未连接</h2>
        <p class="small muted">虚拟果蝇需要独立的全脑仿真引擎（LIF 仿真 × Qwen2.5-1.5B LoRA，含 50GB 级权重与连接组数据），引擎不随 SigmaFlow 包分发。按下面三步即可在任意 GPU 机器上部署，然后回到本页一键检测。</p>
        <ol class="fly-setup-steps small">
          <li><b>下载代码与权重</b> — <code>git clone ${esc(st.repo || 'https://github.com/maokangkun/flychat')}</code> 后运行 <code>./scripts/download_weights.sh</code>：自动从 GitHub Release 拉取权重/连接组/3D 数据（约 325MB，含 SHA256 校验）和 Qwen 基座（约 3GB，官方源自动镜像回退）。</li>
          <li><b>启动引擎</b> — <code>conda env create -f environment.yml &amp;&amp; conda activate flychat &amp;&amp; python server.py 4116</code>（需要 CUDA GPU；首次启动加载权重约 1 分钟）。</li>
          <li><b>接入本页</b> — 引擎与本服务同机时无需配置；异地部署时在服务端设置环境变量 <code>SIGMAFLOW_FLY_URL=http://引擎IP:4116</code> 并重启。</li>
        </ol>
        <div class="row wrap">
          <button type="button" class="btn primary" onclick="FlyUI.retry()">重新检测引擎</button>
          <a class="btn flat" href="${esc(st.repo || 'https://github.com/maokangkun/flychat')}" target="_blank" rel="noopener">打开下载页</a>
        </div>
        <p class="tiny muted mt-12">当前探测地址：${esc(st.engine || '')}${st.error ? ' · ' + esc(st.error) : ''}</p>
      </div>`;
  };
  window.FlyUI.retry = () => { S.engineOk = null; _pollStatus(); };

  // ---------------- 聊天 ----------------
  const _reset = async () => {
    try {
      await CS.api.request('/fly/reset', { method: 'POST', timeout: 15000 });
      _msg('fly', '（对话历史已重置，脑状态清零）');
      _pollStatus();
    } catch (err) { _msg('fly', '(重置失败) ' + CS.api.friendlyError(err)); }
  };

  const _send = async ev => {
    ev.preventDefault();
    const inp = document.getElementById('flyInput');
    const btn = document.getElementById('flySend');
    const text = (inp?.value || '').trim();
    if (!text || S.busy) return;
    S.busy = true; if (btn) btn.disabled = true; if (inp) inp.value = '';
    _msg('user', text);
    _foot('全脑仿真 + 增量生成中 …（每个 token 驱动一次 16 万神经元子窗）');
    try {
      const j = await CS.api.request('/fly/chat', { method: 'POST', body: JSON.stringify({ text }), timeout: 600000 });
      if (j && j.ok) {
        _msg('fly', j.reply || '（空回复）', `上下文 ${j.n_context_tokens} tok · 脑仿真 ${j.n_brain_tokens} tok · 脑状态 ${j.n_prefix_slots} 前缀 · ${j.wall_s}s`);
      } else {
        _msg('fly', '(错误) ' + ((j && (j.error || j.detail)) || 'unknown'));
      }
    } catch (err) {
      _msg('fly', '(请求失败) ' + CS.api.friendlyError(err));
    }
    S.busy = false; if (btn) btn.disabled = false; if (inp) inp.focus();
    _pollStatus();
  };

  // ---------------- 3D(移植自 flychat app.js, 复用 CellViewer 的 THREE) ----------------
  // 圆形辉光贴图: WebGL 点精灵默认方块, 径向渐变让活动点渲染成柔和圆点
  const _glowTexture = (THREE, hardness) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(255,255,255,${hardness})`);
    grad.addColorStop(0.45, `rgba(255,255,255,${hardness * 0.55})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  };

  const _init3D = async () => {
    const CV = window.CellViewer;
    const canvas = document.getElementById('flyCanvas');
    if (!CV || !canvas) return;
    const THREE = CV.THREE;
    S.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    S.scene = new THREE.Scene();
    // 浅色底(与页面新拟态一致): 叠加混合在浅底会糊成一片白, 活动点改
    // 普通混合 + 高饱和暖色, 辉光层降透明度作柔边
    S.scene.background = new THREE.Color(0xe9edf4);
    S.camera = new THREE.PerspectiveCamera(50, 1, 10, 2e6);
    S.camera.position.set(45000, 25000, 90000);
    S.controls = new CV.OrbitControls(S.camera, canvas);
    S.controls.enableDamping = true;

    const resize = () => {
      const box = canvas.parentElement;
      if (!box) return;
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      S.renderer.setSize(w, h, false);
      S.camera.aspect = w / h;
      S.camera.updateProjectionMatrix();
    };
    S.resize = resize;
    resize();

    // viewer 元数据(胞体坐标): 引擎侧 9MB JSON, 走同源代理(经 CS.api 解析)
    try {
      S.meta = await CS.api.request('/fly/data/meta.json', { method: 'GET', timeout: 90000 });
    } catch (err) {
      _hud('flyHudN', '3D 数据加载失败: ' + CS.api.friendlyError(err));
      return;
    }
    _hud('flyHudN', CS.num(S.meta.nNeurons) + ' 神经元');

    // 胞体云底图
    const soma = S.meta.soma;
    const n = soma.length;
    const pos = new Float32Array(n * 3);
    let nv = 0;
    for (let i = 0; i < n; i++) {
      const sp = soma[i];
      if (sp) { pos[nv * 3] = sp[0]; pos[nv * 3 + 1] = sp[1]; pos[nv * 3 + 2] = sp[2]; nv++; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.slice(0, nv * 3), 3));
    S.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8b96b4, size: 2.2, sizeAttenuation: false })));

    // 包围盒中心 → 相机注视点: 胞体坐标原点不在模型质心, 不居中会把
    // 大脑顶到视野角落; 相机按初始视角方向平移到中心正前方
    const bb = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position'));
    const ctr = bb.getCenter(new THREE.Vector3());
    S.controls.target.copy(ctr);
    S.camera.position.set(ctr.x + 45000, ctr.y + 25000, ctr.z + 90000);
    S.controls.update();

    // 活动神经元覆盖层(轮询重建) + 加色辉光二次绘制
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g2.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g2.setDrawRange(0, 0);
    S.baseActiveSize = 6;
    const matCore = new THREE.PointsMaterial({
      size: S.baseActiveSize, sizeAttenuation: false, vertexColors: true,
      map: _glowTexture(THREE, 1.0), transparent: true, opacity: 1.0, depthWrite: false, alphaTest: 0.02,
    });
    S.activePts = new THREE.Points(g2, matCore);
    S.activePts.frustumCulled = false;
    S.scene.add(S.activePts);
    const halo = new THREE.Points(g2, new THREE.PointsMaterial({
      size: S.baseActiveSize * 1.7, sizeAttenuation: false, vertexColors: true,
      map: _glowTexture(THREE, 0.9), transparent: true, opacity: 0.16, depthWrite: false,
    }));
    halo.frustumCulled = false;
    S.scene.add(halo);

    // 活动神经元之间的突触连线(连接组强连接子图)
    const EDGE_MAX = 1600;
    const ge = new THREE.BufferGeometry();
    ge.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EDGE_MAX * 6), 3));
    ge.setAttribute('color', new THREE.BufferAttribute(new Float32Array(EDGE_MAX * 6), 3));
    ge.setDrawRange(0, 0);
    S.activeEdges = new THREE.LineSegments(ge, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false,
    }));
    S.activeEdges.frustumCulled = false;
    S.scene.add(S.activeEdges);

    (function loop() {
      S.raf = requestAnimationFrame(loop);
      if (!document.getElementById('fly-root')) { stopTimers(); return; }
      S.controls.update();
      // 心跳脉冲: 活动点尺寸随呼吸节律起伏
      if (S.activePts && S.activePts.material) {
        const pulse = 1 + 0.5 * Math.sin(performance.now() / 160);
        S.activePts.material.size = S.baseActiveSize * pulse;
        halo.material.size = S.baseActiveSize * 1.7 * pulse;
      }
      S.renderer.render(S.scene, S.camera);
      S.fpsN++;
      const now = performance.now();
      if (now - S.fpsT > 1000) { _hud('flyHudFps', S.fpsN + ' fps'); S.fpsN = 0; S.fpsT = now; }
    })();
    S.timers.push(setInterval(resize, 1500));
  };

  // 活动快照轮询: 把引擎的放电率映射到胞体云上(亮暖色 = 高频)
  const _pollActivity = async () => {
    if (!S.meta || !S.activePts || !document.getElementById('fly-root')) return;
    try {
      const a = await CS.api.request('/fly/activity', { method: 'GET', timeout: 6000 });
      if (!a || !a.active) return;
      const pos = S.activePts.geometry.attributes.position.array;
      const col = S.activePts.geometry.attributes.color.array;
      let k = 0;
      let rmax = 1e-9;
      for (const [, r] of a.active) if (r > rmax) rmax = r;
      for (const [vi, r] of a.active) {
        const sp = S.meta.soma[vi];
        if (!sp) continue;
        pos[k * 3] = sp[0]; pos[k * 3 + 1] = sp[1]; pos[k * 3 + 2] = sp[2];
        // 浅底上的高饱和橙红: 高频 → 更亮更黄, 低频 → 深红
        const t = Math.pow(r / rmax, 0.3);
        col[k * 3] = 0.72 + 0.28 * t;
        col[k * 3 + 1] = 0.10 + 0.42 * t;
        col[k * 3 + 2] = 0.06 + 0.05 * t;
        k++;
      }
      S.activePts.geometry.setDrawRange(0, k);
      S.activePts.geometry.attributes.position.needsUpdate = true;
      S.activePts.geometry.attributes.color.needsUpdate = true;
      if (S.activeEdges && a.edges && a.edges.length) {
        const ep = S.activeEdges.geometry.attributes.position.array;
        const ec = S.activeEdges.geometry.attributes.color.array;
        let e2 = 0;
        for (const [va, vb, w] of a.edges) {
          const sa = S.meta.soma[va], sb = S.meta.soma[vb];
          if (!sa || !sb || e2 >= 1600) continue;
          ep[e2 * 6] = sa[0]; ep[e2 * 6 + 1] = sa[1]; ep[e2 * 6 + 2] = sa[2];
          ep[e2 * 6 + 3] = sb[0]; ep[e2 * 6 + 4] = sb[1]; ep[e2 * 6 + 5] = sb[2];
          const t = Math.pow(w, 0.5);
          for (const off of [0, 3]) {
            ec[e2 * 6 + off] = 0.58 + 0.30 * t;
            ec[e2 * 6 + off + 1] = 0.16 + 0.34 * t;
            ec[e2 * 6 + off + 2] = 0.10 + 0.06 * t;
          }
          e2++;
        }
        S.activeEdges.geometry.setDrawRange(0, e2 * 2);
        S.activeEdges.geometry.attributes.position.needsUpdate = true;
        S.activeEdges.geometry.attributes.color.needsUpdate = true;
      } else if (S.activeEdges) {
        S.activeEdges.geometry.setDrawRange(0, 0);
      }
      _hud('flyHudAct', '活动 ' + CS.num(a.n_active_brain || k));
    } catch { /* 瞬时失败: 下一轮继续 */ }
  };

  // LOD2 全脑线框: 按需分块拉取(104 块 × ~3MB), 只在用户点击时加载
  const _toggleWire = async () => {
    const btn = document.getElementById('flyWireBtn');
    const CV = window.CellViewer;
    if (!CV || !S.scene || S.wireMesh || S.wireLoading) return;
    S.wireLoading = true;
    if (btn) btn.textContent = '线框加载中…';
    try {
      const chunks = [];
      for (let c = 0; ; c++) {
        const id = String(c).padStart(3, '0');
        let buf;
        try {
          const r = await fetch(CS.api.url(`/fly/data/lod2/chunk_${id}.bin`), { credentials: 'include' });
          if (!r.ok) break;
          buf = await r.arrayBuffer();
        } catch { break; }
        const dv = new DataView(buf);
        const n = dv.getUint32(0, true);
        const nNodes = dv.getUint32(4, true);
        const nSegs = dv.getUint32(8, true);
        const segOff = new Uint32Array(buf, 12 + 4 * (n + 1), n + 1);
        const posOff = 12 + 8 * (n + 1);
        chunks.push({
          segOff,
          positions: new Float32Array(buf, posOff, nNodes * 3),
          segments: new Uint32Array(buf, posOff + nNodes * 12, nSegs * 2),
          n,
        });
        if (btn) btn.textContent = `线框 ${c + 1} 块…`;
      }
      let total = 0;
      for (const ch of chunks) total += ch.segOff[ch.n];
      const pos = new Float32Array(total * 6);
      let o = 0;
      for (const ch of chunks) {
        for (let i = 0; i < ch.n; i++) {
          const s0 = ch.segOff[i] * 2, s1 = ch.segOff[i + 1] * 2;
          for (let s = s0; s < s1; s += 2) {
            const a = ch.segments[s] * 3, b2 = ch.segments[s + 1] * 3;
            pos.set(ch.positions.subarray(a, a + 3), o); o += 3;
            pos.set(ch.positions.subarray(b2, b2 + 3), o); o += 3;
          }
        }
      }
      const g = new CV.THREE.BufferGeometry();
      g.setAttribute('position', new CV.THREE.BufferAttribute(pos, 3));
      S.wireMesh = new CV.THREE.LineSegments(g, new CV.THREE.LineBasicMaterial({
        color: 0x6e7ea6, transparent: true, opacity: 0.32,
      }));
      S.scene.add(S.wireMesh);
      if (btn) { btn.textContent = '线框已加载'; btn.classList.add('primary'); }
    } catch {
      if (btn) btn.textContent = '线框加载失败';
    }
    S.wireLoading = false;
  };

  // ---------------- 挂载 ----------------
  window.mountFlyPage = () => {
    const root = document.getElementById('fly-root');
    if (!root || S.mounted) return;
    S.mounted = true;
    _msg('fly', '输入一句话试试 —— 果蝇脑对每个 token 做 4ms 增量仿真（16 万神经元），回复由脑状态前缀驱动的 Qwen2.5-1.5B 生成；生成期间右侧大脑实时高亮放电神经元与突触连线。');
    document.getElementById('flyForm')?.addEventListener('submit', _send);
    window.addEventListener('resize', S.resize = S.resize || (() => {}));
    _init3D();
    _pollStatus();
    S.timers.push(setInterval(_pollStatus, 5000));
    S.timers.push(setInterval(_pollActivity, 450));
  };
})();
