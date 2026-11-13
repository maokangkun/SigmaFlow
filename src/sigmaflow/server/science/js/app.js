/* Application controller: routing, accessible dialogs and real UI interactions. */
(() => {
  'use strict';
  const e = CS.escape, i = CS.icon, H = CS.viewHelpers;
  const allowedRoutes = Object.keys(CS.views).filter(x => !['sidebar','topbar','composer','inspector','scatterPanel','reportDocument','sequenceTool'].includes(x));
  let uploadContext = 'data', modalReturnFocus = null;
  const parseHash = () => {
    const value = location.hash.replace(/^#\/?/, '').split('?')[0];
    const [seg, id] = value.split('/');
    if (seg === 'chat' && id) return { route: 'chat', id };
    if (seg === 'trace') return { route: 'trace', id: id || null };
    return { route: allowedRoutes.includes(value) ? value : 'home', id: null };
  };
  const readRoute = () => parseHash().route;
  // 本次会话已回源刷新过的 run: 避免反复拉取(导航来回点也只拉一次)
  const refreshedRuns = new Set();
  const applyRoute = () => {
    const { route, id } = parseHash();
    if ((route === 'chat' || route === 'trace') && id) {
      const run = CS.state.runs.find(r => r.id === id);
      // 服务端存档是权威, 本地只是缓存(刷新/断线/中断都会让本地落后):
      // 打开会话时只要没有生成中的消息, 一律回源同步一次(本次会话内只拉一次),
      // 不再猜测本地数据是否完整 —— 截断版/陈旧版一律被服务端全量版替换。
      // 刷新前正停在该会话的场景(currentRunId===id)也要触发; 生成中跳过,
      // 以免吃掉流式中的消息
      const streaming = run?.messages?.some(m => m.streaming);
      // 看起来陈旧的本地副本(重启残留/暂停态/服务端流式标记)每次打开都强制
      // 回源同步, 不吃 refreshedRuns 的一次性豁免——否则一次静默失败(如瞬时
      // 断网/鉴码过期)会让陈旧版本陪伴整个会话周期
      const staleLocal = !!run && (run.reloaded || ['running', 'paused', 'connecting', 'awaiting'].includes(run.status) || (run.messages || []).some(m => m.serverStreaming));
      const needsSync = (!streaming && !refreshedRuns.has(id)) || (staleLocal && !streaming);
      if (CS.state.currentRunId !== id || needsSync) {
        CS.state.currentRunId = id;
        if (run?.projectId) CS.state.projectId = run.projectId;
        if (needsSync) { refreshedRuns.add(id); loadRemoteConversation(id); }
      }
    }
    return route;
  };
  CS.navigate = (route, runId) => {
    CS.ui.mobileSidebar = false;
    CS.ui.userMenu = false;
    if (!allowedRoutes.includes(route)) route = 'home';
    const id = route === 'chat' || route === 'trace' ? (runId || CS.state.currentRunId || null) : null;
    const hash = '#/' + route + (id ? '/' + id : '');
    if (location.hash === hash) CS.render();
    else location.hash = hash;
  };
  // 生成中状态: 标签页 icon 旋转提示。
  // Chrome 会把 SVG favicon 静态栅格化、不执行其中的 CSS 动画,
  // 因此用 canvas 逐帧绘制旋转 logo 并切换 favicon(约 12 帧/秒)。
  const _faviconEl = document.querySelector('#favicon');
  const _faviconStatic = _faviconEl ? _faviconEl.href : '';
  const _faviconCanvas = document.createElement('canvas');
  _faviconCanvas.width = _faviconCanvas.height = 64;
  const _faviconCtx = _faviconCanvas.getContext('2d');
  let _faviconImg = null, _faviconBusy = null, _faviconTimer = null, _faviconAngle = 0;
  const _faviconFrame = () => {
    if (!_faviconImg || !_faviconEl) return;
    const ctx = _faviconCtx, size = 64;
    ctx.clearRect(0, 0, size, size);
    // DNA logo: 静止, 缩小居中
    const logo = size * 0.55;
    ctx.drawImage(_faviconImg, (size - logo) / 2, (size - logo) / 2, logo, logo);
    // 绿色彗尾进度环: 底轨 + 尾部渐亮的弧段
    const r = size * 0.44;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(84,134,120,.18)';
    ctx.lineWidth = size * 0.08;
    ctx.stroke();
    const segs = 24, span = Math.PI * 1.35;
    for (let k = 0; k < segs; k++) {
      const a0 = _faviconAngle + span * k / segs, a1 = _faviconAngle + span * (k + 1) / segs;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, r, a0, a1 + 0.02);
      ctx.strokeStyle = `rgba(84,134,120,${(0.12 + 0.88 * (k / segs)).toFixed(3)})`;
      ctx.lineWidth = size * 0.08;
      ctx.stroke();
    }
    _faviconAngle = (_faviconAngle + 0.15) % (Math.PI * 2);  // 一圈约 3.1s
    _faviconEl.href = _faviconCanvas.toDataURL('image/png');
  };
  const syncFavicon = () => {
    const busy = CS.state.runs.some(r => (r.messages || []).some(m => m.streaming));
    if (busy === _faviconBusy) return;
    _faviconBusy = busy;
    if (busy) {
      if (!_faviconTimer) _faviconTimer = setInterval(_faviconFrame, 80);
    } else {
      if (_faviconTimer) { clearInterval(_faviconTimer); _faviconTimer = null; }
      if (_faviconEl) _faviconEl.href = _faviconStatic;
    }
  };
  if (_faviconEl) {
    _faviconImg = new Image();
    _faviconImg.src = _faviconStatic;
  }
  const _origRender = () => {
    const active = document.activeElement;
    const focus = active?.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const x = window.scrollX, y = window.scrollY;
    const sidebarScroll = document.querySelector('.sidebar-scroll')?.scrollTop || 0;
    const conversationScroll = document.querySelector('.conversation')?.scrollTop || 0;
    const inspectorScroll = document.querySelector('.inspector')?.scrollTop || 0;
    document.documentElement.dataset.contrast = CS.state.settings.contrast ? 'high' : 'normal';
    document.documentElement.dataset.motion = CS.state.settings.reducedMotion ? 'reduced' : 'normal';
    // 消息轨迹配色方案: 挂在根元素上, CSS 变量按方案重定义
    document.documentElement.dataset.trackpalette = ['macaron', 'classic', 'mono'].includes(CS.state.settings.trackPalette) ? CS.state.settings.trackPalette : 'macaron';
    const bootRes = CS.state.me;
    // 多用户门禁: 未登录一律停留在登录页; 已登录访问登录页则回主页
    if (CS.ui.route === 'auth') {
      if (!(bootRes && bootRes.mode === 'multi' && !(bootRes.user && bootRes.user.name))) {
        location.hash = '#/home';
        return;
      }
    } else if (bootRes && bootRes.mode === 'multi' && !(bootRes.user && bootRes.user.name)) {
      CS.ui.route = 'auth';
      location.hash = '#/auth';
    }
    const page = CS.views[CS.ui.route] || CS.views.home;
    const fullscreen = CS.ui.route === 'settings';
    if (CS.ui.route === 'auth') {
      // 登录/注册是独立的全屏页面, 不带侧栏与主布局
      document.getElementById('app').innerHTML = page();
      window.scrollTo(0, 0);
      setTimeout(() => document.getElementById('auth-username')?.focus(), 40);
      syncFavicon();
      return;
    }
    document.getElementById('app').innerHTML = `<div class="app-shell">${fullscreen ? '' : CS.views.sidebar()}<main id="main" class="main-shell ${fullscreen ? 'main-fullscreen' : ''}" tabindex="-1"><header class="topbar ${fullscreen ? 'topbar-fullscreen' : 'topbar-menu'}"${fullscreen ? ' style="height:auto;align-items:flex-start"' : ''}>${fullscreen ? `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:12px;"><button type="button" class="text-button" data-nav="home">${i('arrowleft','',14)}<span>返回工作空间</span></button></div><div class="topbar-status"></div>` : `<div class="row"><button class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="打开菜单">${i('menu')}</button></div>`}</header><div class="main-cols">${page()}${typeof CS.views.terminalDrawer === 'function' ? CS.views.terminalDrawer() : ''}</div></main></div>`;
    const sidebar = document.querySelector('.sidebar-scroll'); if (sidebar) sidebar.scrollTop = sidebarScroll;
    const conversation = document.querySelector('.conversation'); if (conversation) conversation.scrollTop = conversationScroll;
    const inspector = document.querySelector('.inspector'); if (inspector) inspector.scrollTop = inspectorScroll;
    if (focus) {
      const target = document.getElementById(focus.id);
      if (target) { target.focus({ preventScroll: true }); if (typeof focus.start === 'number' && target.setSelectionRange && !['number','checkbox'].includes(target.type)) { try { target.setSelectionRange(focus.start, focus.end); } catch {} } }
    }
    window.scrollTo(x, y);
    const app = document.getElementById('app');
    if (CS.ui.modal) { app.inert = true; app.setAttribute('aria-hidden', 'true'); }
    syncFavicon();
  };
  CS.bus.addEventListener('render', () => CS.render());

  // 服务器状态栏(输入框下方): 轮询 /system, 直接改 DOM 不触发重渲染
  const fmtBps = v => v >= 1048576 ? (v / 1048576).toFixed(1) + 'MB/s'
    : v >= 1024 ? (v / 1024).toFixed(1) + 'KB/s' : Math.round(v) + 'B/s';
  const sysBar = (pct, cls = '') =>
    `<span class="sys-bar ${cls}${pct >= 90 ? ' warn' : ''}"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(0)}%"></span></span>`;
  let _sysStatsHtml = null;
  const updateSysStats = async () => {
    const el = document.getElementById('sys-stats');
    if (!el) return;
    try {
      const s = await CS.api.request('/system');
      // 首行布局: OS | 条区(sys-bars) | 网速, 条区内部共享网格 —— 各条列平分剩余空间,
      // 条既等长又随输入框宽度伸缩; 标签/数字列按内容宽度完整显示, 窄时条先收缩(下限 16px)
      const barCells = (lab, pct, tip, val) =>
        `<i class="sys-lab" title="${tip}">${lab}</i>${sysBar(val)}<i class="sys-pct">${pct}%</i>`;
      const diskCells = (s.disks || [s.disk]).map((d, i) =>
        barCells(`${i ? CS.escape(d.path) : '磁盘'} ${d.used_gb}/${d.total_gb}GB`, Math.round(d.percent),
          `磁盘占用 (${CS.escape(d.path)}) ${d.used_gb}/${d.total_gb}GB`, d.percent)).join('');
      const segs = [
        `<span class="sys-seg sys-os" title="${CS.escape(s.os)}">${CS.escape(s.os)}</span>`,
        `<span class="sys-bars">`
        + barCells(`CPU ${s.cpu.cores}核`, Math.round(s.cpu.usage), CS.escape(s.cpu.model), s.cpu.usage)
        + barCells(`内存 ${s.memory.used_gb}/${s.memory.total_gb}GB`, Math.round(s.memory.percent),
          `内存 ${s.memory.used_gb}/${s.memory.total_gb}GB (${Math.round(s.memory.percent)}%)`, s.memory.percent)
        + diskCells
        + `</span>`,
        `<span class="sys-seg sys-net" title="网速(上传/下载)">网速 ↑${fmtBps(s.net.up_bps)} ↓${fmtBps(s.net.down_bps)}</span>`,
      ].join('');
      const gpus = (s.gpus || []).map((g, idx) =>
        `<span class="sys-gpu" title="GPU${idx} · ${CS.escape(g.name)} · 显存 ${g.mem_used_gb}/${g.mem_total_gb}GB (${Math.round(g.mem_used_gb / g.mem_total_gb * 100)}%) · 利用率 ${Math.round(g.usage)}%">`
        + `<b>${idx}</b>${sysBar(g.mem_used_gb / g.mem_total_gb * 100, 'mem')}${sysBar(g.usage, 'util')}</span>`).join('');
      const gpuModel = s.gpus?.length
        ? `<span class="sys-seg sys-gpu-model" title="${CS.escape(s.gpus[0].name)}">${CS.escape(s.gpus[0].name.replace(/^NVIDIA\s+/i, ''))}${s.gpus.length > 1 ? ` ×${s.gpus.length}` : ''}</span>`
        : '';
      el.innerHTML = `<span class="sys-line sys-line1">${segs}</span>`
        + (s.gpus?.length ? `<span class="sys-line sys-gpus" title="每卡: 上条=显存(绿), 下条=利用率(紫), ≥90% 变红">${gpuModel}${gpus}</span>` : '');
      _sysStatsHtml = el.innerHTML;
    } catch { /* 后端不可达时保持现状, 下轮再试 */ }
  };
  setInterval(() => { if (document.getElementById('sys-stats')) updateSysStats(); }, 3000);
  // present 富预览懒加载: 图片直显 / csv 表格 / json 摘要。
  // IntersectionObserver 只加载视口附近的卡片; 同一路径结果缓存, 重渲染秒填。
  // present 预览双缓存(payload + 渲染结果): 简易 LRU(各 80 条)防超长
  // 会话高频 present 场景下无限增长; get 命中即重排到最新
  CS._presentCap = 80;
  CS._presentCache = new Map();
  // 已渲染的预览 HTML 缓存: 流式期间的结构变化会整页重建 DOM, 异步填充
  // 会在重渲染间隙闪现占位符、图片重挂载高度塌缩(滚动卡在图片消息)——
  // 缓存命中时在渲染帧内同步回填, 用户看不到任何中间态
  CS._presentHtml = new Map();
  CS._presentCachePut = (key, payload, html) => {
    CS._presentCache.set(key, payload);
    while (CS._presentCache.size > CS._presentCap) CS._presentCache.delete(CS._presentCache.keys().next().value);
    CS._presentHtml.set(key, html ?? '');
    while (CS._presentHtml.size > CS._presentCap) CS._presentHtml.delete(CS._presentHtml.keys().next().value);
  };
  CS._presentCacheGet = key => {
    const payload = CS._presentCache.get(key);
    if (payload !== undefined) { CS._presentCache.delete(key); CS._presentCache.set(key, payload); }
    const html = CS._presentHtml.get(key);
    if (html !== undefined) { CS._presentHtml.delete(key); CS._presentHtml.set(key, html); }
    return { payload, html };
  };
  CS._presentLoad = async el => {
    const path = el.dataset.path || '';
    const pid = el.dataset.pid || '';
    const kind = el.dataset.kind || '';
    const name = el.dataset.name || '';
    const key = pid + '|' + path;
    el.dataset.state = 'loading';
    if (el.classList.contains('ref-thumb')) {
      // 引用芯片缩略图: 复用 payload 缓存, 只取 dataUrl
      try {
        let payload = CS._presentCache.get(key);
        if (!payload || !payload.dataUrl) {
          payload = await CS.api.request(`/fs/file?path=${encodeURIComponent(path)}${pid ? '&projectId=' + encodeURIComponent(pid) : ''}`, { method: 'GET', timeout: 30000 });
          CS._presentCachePut(key, payload, CS._presentHtml.get(key) || '');
        }
        if (el.dataset.state !== 'loading') return;
        if (payload.dataUrl) { el.src = payload.dataUrl; el.dataset.state = 'done'; }
        else { el.style.display = 'none'; el.dataset.state = 'error'; }
      } catch { el.style.display = 'none'; el.dataset.state = 'error'; }
      return;
    }
    try {
      const cached = CS._presentCacheGet(key);
      let payload = cached.payload;
      if (!payload) {
        payload = await CS.api.request(`/fs/file?path=${encodeURIComponent(path)}${pid ? '&projectId=' + encodeURIComponent(pid) : ''}`, { method: 'GET', timeout: 30000 });
      }
      if (el.dataset.state !== 'loading') return;  // 重渲染已替换节点
      let html = cached.html;
      if (!html) {
        if (kind === 'image') {
          html = payload.dataUrl ? `<img class="present-img" src="${payload.dataUrl}" alt="${e(name)}">` : `<div class="present-preview-note small muted">${e(payload.note || '该图片无法内联预览，点击"查看"。')}</div>`;
        } else if (kind === 'table') {
          html = CS.csvPreviewTable(String(payload.content || ''), name);
        } else if (kind === 'json') {
          html = CS.jsonPreviewBlock(String(payload.content || ''), name, /jsonl/i.test(name));
        }
        html = html || '<div class="present-preview-note small muted">暂无可预览内容。</div>';
      }
      CS._presentCachePut(key, payload, html);
      el.innerHTML = html;
      el.dataset.state = 'done';
    } catch (err) {
      const msg = `<div class="present-preview-note small muted">预览加载失败：${e(CS.api.friendlyError ? CS.api.friendlyError(err) : String((err && err.message) || err))}</div>`;
      CS._presentCachePut(key, { error: true }, msg);
      el.innerHTML = msg;
      el.dataset.state = 'error';
    }
  };
  CS._presentIO = new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) { CS._presentIO.unobserve(en.target); CS._presentLoad(en.target); }
  }, { rootMargin: '260px' });
  // ---- webview live: 服务端真浏览器帧流 + 输入转发 ----
  CS._wvLive = new Map();  // sid -> {ws, el}
  CS._wvFrame = new Map();  // sid -> {d,w,h} 最后一帧缓存: 重渲染后同步回填防黑屏
  CS._wvLiveAttach = el => {
    const sid = el.dataset.sid;
    if (!sid) return;
    const view = el.querySelector('.wv-live-view');
    const img = el.querySelector('.wv-live-img');
    const conn = el.querySelector('.wv-live-conn');
    const urlbar = el.querySelector('.wv-live-urlbar');
    if (!view || !img) return;
    let st = CS._wvLive.get(sid);
    if (!st) {
      const base = CS.api.wsUrl().replace(/\/ws$/, '');
      const url = base + '/wv/live/' + encodeURIComponent(sid);
      let ws;
      try { ws = new WebSocket(url); } catch { if (conn) conn.textContent = '无法连接'; return; }
      st = { ws };
      CS._wvLive.set(sid, st);
    }
    const ws = st.ws;
    const send = o => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
    ws.addEventListener('open', () => send({ t: 'hello' }));
    if (ws.readyState === 1) send({ t: 'hello' });
    // 坐标换算: 显示宽 → 帧宽(设备像素)
    const pt = ev => {
      const r = img.getBoundingClientRect();
      const sx = (parseFloat(img.dataset.w) || r.width) / Math.max(1, r.width);
      const sy = (parseFloat(img.dataset.h) || r.height) / Math.max(1, r.height);
      return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
    };
    let dragging = false;
    let lastMove = 0;
    const move = (ev, force) => {
      const now = performance.now();
      if (!force && now - lastMove < 25) return;  // 40Hz 上限, 轨迹密度足够且不淹 CDP
      lastMove = now;
      const p = pt(ev);
      send({ t: 'mouse', st: 'moved', x: p.x, y: p.y, ...(dragging ? { drag: 1 } : {}) });
    };
    // 悬停移动全量转发: 人机验证(Cloudflare/极验等)依赖点击前的鼠标轨迹,
    // 只转发拖拽会让点击变成"瞬移", 直接判机器人
    view.addEventListener('mousemove', ev => move(ev));
    view.addEventListener('mousedown', ev => { ev.preventDefault(); view.focus(); move(ev, true); dragging = true; const p = pt(ev); send({ t: 'mouse', st: 'pressed', x: p.x, y: p.y }); });
    window.addEventListener('mouseup', ev => { if (!dragging) return; dragging = false; const p = pt(ev); send({ t: 'mouse', st: 'released', x: p.x, y: p.y }); });
    view.addEventListener('wheel', ev => { ev.preventDefault(); const p = pt(ev); send({ t: 'wheel', x: Math.round(p.x), y: Math.round(p.y), dx: Math.round(ev.deltaX), dy: Math.round(ev.deltaY) }); }, { passive: false });
    view.addEventListener('keydown', ev => {
      const k = ev.key;
      if (k.length === 1 || ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(k)) {
        if (k.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) ev.preventDefault();
        send({ t: 'key', key: k, code: ev.code, text: k.length === 1 ? k : '' });
      }
    });
    view.addEventListener('paste', ev => { const txt = (ev.clipboardData || {}).getData ? ev.clipboardData.getData('text') : ''; if (txt) send({ t: 'paste', text: txt.slice(0, 5000) }); });
    // 同 sid 可能有多张卡(模型重复展示同一 URL): 全部扇出。
    // 注意 NodeList 没有 querySelectorAll, 先展开成元素再查。
    const _cur = () => {
      if (CS._wvLive.get(sid) !== st) return null;
      const cards = [...document.querySelectorAll(`.wv-live[data-sid="${CSS.escape(sid)}"]`)];
      if (!cards.length) return null;
      return {
        imgs: cards.flatMap(c => [...c.querySelectorAll('.wv-live-img')]),
        cons: cards.flatMap(c => [...c.querySelectorAll('.wv-live-conn')]),
        views: cards.flatMap(c => [...c.querySelectorAll('.wv-live-view')]),
        urlbars: cards.flatMap(c => [...c.querySelectorAll('.wv-live-urlbar')]),
      };
    };
    ws.onmessage = m => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      const c = _cur(); if (!c) return;
      if (d.t === 'frame') {
        CS._wvFrame.set(sid, { d: d.d, w: d.w, h: d.h });
        c.imgs.forEach(img => {
          img.src = 'data:image/jpeg;base64,' + d.d;
          img.dataset.w = d.w; img.dataset.h = d.h;
          img.style.display = 'block';
        });
        c.cons.forEach(cn => { cn.style.display = 'none'; });
        c.views.forEach(v => v.classList.add('wv-live-on'));
      } else if (d.t === 'url') {
        CS._wvFrame.get(sid) && (CS._wvFrame.get(sid).url = d.url);
        c.urlbars.forEach(ub => { ub.textContent = d.url || ''; });
      } else if (d.t === 'err' || d.t === 'done') {
        CS._wvFrame.delete(sid);
        c.cons.forEach(cn => { cn.textContent = d.t === 'done' ? '会话已结束' : (d.msg || '连接失败'); cn.style.display = ''; });
        c.views.forEach(v => v.classList.remove('wv-live-on'));
        CS._wvLive.delete(sid);
      }
    };
    ws.onclose = () => { CS._wvLive.delete(sid); const c = _cur(); if (c) c.views.forEach(v => v.classList.remove('wv-live-on')); };
  };
  // 表格/JSON 预览区允许选中文本, 点击不再冒泡触发整卡弹窗(图片点击仍进弹窗)
  document.addEventListener('click', ev => {
    const pv = ev.target && ev.target.closest ? ev.target.closest('.present-preview') : null;
    if (pv && pv.dataset.kind !== 'image') ev.stopPropagation();
  }, true);
  // 会话滚动容器的平滑滚轮: Linux/无平滑系统的原生滚轮是逐格直跳,
  // 且指针落在折叠条上时默认增量会整段丢失 —— 统一接管: 滚轮增量累积
  // 成目标位置, rAF 指数缓动逼近(非线性平滑), 新增量到达即并入目标。
  // 拖动滚动条/触摸/键盘滚动时目标是即时 scrollTop, 不受影响
  (() => {
    const state = new WeakMap();  // conv -> {target, raf}
    const ease = conv => {
      const st = state.get(conv);
      if (!st) return;
      const dist = st.target - conv.scrollTop;
      if (Math.abs(dist) < 0.5) { conv.scrollTop = st.target; state.delete(conv); return; }
      conv.scrollTop += dist * 0.18;  // 指数逼近: 快落慢收的非线性曲线
      st.raf = requestAnimationFrame(() => ease(conv));
    };
    document.addEventListener('wheel', e => {
      const conv = e.target && e.target.closest ? e.target.closest('.conversation') : null;
      if (!conv || conv.scrollHeight <= conv.clientHeight) return;
      // 容器内嵌套的横向滚动条(轨迹热力图/表格)自己能消费时让位
      if (e.deltaX !== 0) return;
      const nested = e.target.closest('.run-track,.table-wrap,pre,.term-wrap');
      if (nested && nested.scrollWidth > nested.clientWidth) return;
      const factor = e.deltaMode === 1 ? 16 : 1;  // 行模式增量转像素
      const max = conv.scrollHeight - conv.clientHeight;
      let st = state.get(conv);
      if (!st) { st = { target: conv.scrollTop, raf: 0 }; state.set(conv, st); }
      else if (!st.raf) st.raf = 0;
      st.target = Math.max(0, Math.min(max, st.target + e.deltaY * factor));
      e.preventDefault();
      if (!st.raf) st.raf = requestAnimationFrame(() => ease(conv));
    }, { passive: false, capture: true });
  })();
  // 轨迹热力图: 纯竖向滚轮转为横向滚动(容器只横向溢出; 触控板自带
  // 横向增量时走原生行为)
  document.addEventListener('wheel', e => {
    const el = e.target && e.target.closest ? e.target.closest('.run-track') : null;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (e.deltaX !== 0) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  // 重试等待倒计时: 全局每秒驱动, 不依赖发送闭包内的流式计时器
  setInterval(() => {
    if (!CS.ui.chatRetry) return;
    document.querySelectorAll('.retry-countdown[data-until]').forEach(cd => {
      const left = Math.ceil((Number(cd.dataset.until) - Date.now()) / 1000);
      cd.textContent = left > 0 ? left + 's 后重试' : '正在重试…';
    });
  }, 1000);
  updateSysStats();
  // 全量重渲染会重建空的 sys-stats 容器, 用缓存内容立即回填, 避免对话生成期间状态栏闪空
  // 全量重渲染会重建 .conversation 容器导致滚动位置丢失(如展开思考/工具块时页面跳走)。
  // 渲染前记录 scrollTop, 渲染后恢复; 显式的 scrollToLatest() 在渲染返回后仍会覆盖为新位置。
  CS.render = function() {
    // 界面缩放: 每次渲染幂等同步 body zoom, 启动加载设置后无需额外初始化
    const _zs = Number(CS.state.settings.uiScale);
    document.body.style.zoom = (Number.isFinite(_zs) && _zs >= 85 && _zs <= 125 && _zs !== 100) ? String(_zs / 100) : '';
    const conv = document.querySelector('.conversation');
    const savedTop = conv ? conv.scrollTop : 0;
    const hadConv = !!conv;
    // 虚拟患者页: 引擎状态机持有大量活 DOM 引用(波形扫掠/WebGL 上下文/表单),
    // 与其每次渲染重建再逐个回填, 不如把整个 #patient-root 节点原样搬回新壳
    const patKeep = CS.ui.route === 'patient' ? document.getElementById('patient-root') : null;
    const p2Keep = CS.ui.route === 'pathogen' ? document.getElementById('pathogen-root') : null;
    const flyKeep = CS.ui.route === 'fly' ? document.getElementById('fly-root') : null;
    // webview iframe 保活: 流式期间整页重建会重新 src 加载(验证页进度丢失),
    // 渲染前收集已加载的 frame, 渲染后原样搬回新位置
    const wvKeep = new Map();
    document.querySelectorAll('iframe.wv-frame[data-state="loaded"]').forEach(f => { if (f.dataset.src && !wvKeep.has(f.dataset.src)) wvKeep.set(f.dataset.src, f); });
    _origRender();
    if (CS.ui.route === 'patient') {
      const fresh = document.getElementById('patient-root');
      if (patKeep && fresh && fresh !== patKeep) fresh.replaceWith(patKeep);
      else if (!patKeep) CS.mountPatientPage();  // 首次进入: 引擎 init + 3D 视图挂载
      // 界面缩放(body zoom)只在渲染时同步: 每次渲染后按当前 zoom 精确补齐高度,
      // 防 100vh 不感知 zoom 在页面下方露空白带/截断内容
      if (CS._patientFit) CS._patientFit();
      if (CS._patLogSync) CS._patLogSync();
    }
    // 虚拟病原体页: 同样保活 #pathogen-root(图表 canvas 与引擎后续接入)
    if (CS.ui.route === 'pathogen') {
      const fresh = document.getElementById('pathogen-root');
      if (p2Keep && fresh && fresh !== p2Keep) fresh.replaceWith(p2Keep);
      else if (!p2Keep) {
        // pathogen.js/pathenv.js 已挂 data-lazy: 拉到后再挂载(页面期间可能已切走, 过滤)。
        CS.ensureLazy('pathogen', 'pathenv').then(() => {
          // mount 自带幂等门(root 缺失/已挂载都会早退), 无需在调用侧判 root。
          if (CS.ui.route === 'pathogen' && window.mountPathogenPage) window.mountPathogenPage();
        });
      }
    }
    // 虚拟果蝇页: 保活 #fly-root(3D canvas), fly.js 懒加载后挂载
    if (CS.ui.route === 'fly') {
      const fresh = document.getElementById('fly-root');
      if (flyKeep && fresh && fresh !== flyKeep) fresh.replaceWith(flyKeep);
      else if (!flyKeep) {
        // 3D 内核(cell3d.min 提供 THREE/OrbitControls)与页面控制器都按需拉
        CS.ensureLazy('fly', 'cell3d.min').then(() => {
          if (CS.ui.route === 'fly' && window.mountFlyPage) window.mountFlyPage();
        });
      }
    }
    if (CS.ui.route !== 'fly' && window.FlyUI) { try { FlyUI.suspend(); } catch {} }
    if (CS.ui.route !== 'patient' && CS._patientLive) {
      CS.unmountPatientPage();  // 离开患者页: 停引擎定时器 + 释放 WebGL
    }
    CS._patientLive = CS.ui.route === 'patient';
    // 虚拟细胞页: 每次渲染后重建 three 场景(innerHTML 整体替换会丢 canvas)
    if (CS.ui.route === 'cell') CS.mountCellViewer();
    // 工具设置的参数编辑框需要按内容自适应高度, 在每次渲染后同步
    CS.sizeSchemaEditors();
    // present 富预览: 缓存命中的同步回填(渲染帧内, 零闪烁); 未加载的交给 IO
    if (CS._presentIO) document.querySelectorAll('.present-preview[data-state="idle"]').forEach(el => {
      const key = (el.dataset.pid || '') + '|' + (el.dataset.path || '');
      if (CS._presentHtml && CS._presentHtml.has(key)) {
        el.innerHTML = CS._presentHtml.get(key);
        el.dataset.state = 'done';
      } else CS._presentIO.observe(el);
    });
    // webview live 真浏览器卡片: 最后一帧缓存同步回填(重渲染不闪黑), 再幂等重绑
    document.querySelectorAll('.wv-live[data-sid]').forEach(el => {
      const f = CS._wvFrame && CS._wvFrame.get(el.dataset.sid);
      if (f) {
        const img = el.querySelector('.wv-live-img');
        if (img && !img.src) {
          img.src = 'data:image/jpeg;base64,' + f.d;
          img.dataset.w = f.w; img.dataset.h = f.h;
          img.style.display = 'block';
          const conn = el.querySelector('.wv-live-conn');
          if (conn) conn.style.display = 'none';
          el.querySelector('.wv-live-view')?.classList.add('wv-live-on');
        }
        const ub = el.querySelector('.wv-live-urlbar');
        if (ub && f.url) ub.textContent = f.url;
      }
      try { CS._wvLiveAttach(el); } catch {}
    });
    // webview iframe 懒加载: 进入视口前 300px 才设 src(历史卡片不重复打外站);
    // 已加载的帧优先原样搬回(保活), 搬不回的才走懒加载
    document.querySelectorAll('iframe.wv-frame[data-state="idle"]').forEach(el => {
      const kept = wvKeep.get(el.dataset.src);
      if (kept) { el.replaceWith(kept); return; }
      if (!CS._wvIO) CS._wvIO = new IntersectionObserver(entries => {
        for (const en of entries) if (en.isIntersecting) {
          CS._wvIO.unobserve(en.target);
          en.target.src = en.target.dataset.src || '';
          en.target.dataset.state = 'loaded';
        }
      }, { rootMargin: '300px' });
      CS._wvIO.observe(el);
    });
    // 弹出菜单(模型/项目等)向上展开时钳制高度: 不超出视口上缘, 内部滚动兜底,
    // 否则首页输入框位置较高时长菜单顶部选项会被视口裁掉无法看到
    document.querySelectorAll('.model-menu').forEach(m => {
      const r = m.getBoundingClientRect();
      if (r.top < 8) { m.style.maxHeight = Math.max(200, Math.floor(r.bottom - 8)) + 'px'; m.scrollTop = 0; }
    });
    // 用户消息 @引用芯片的图片缩略图: 同一套缓存, 命中即同步设 src
    if (CS._presentIO) document.querySelectorAll('img.ref-thumb[data-state="idle"]').forEach(el => {
      const key = (el.dataset.pid || '') + '|' + (el.dataset.path || '');
      const cached = CS._presentCache.get(key);
      if (cached && cached.dataUrl) { el.src = cached.dataUrl; el.dataset.state = 'done'; }
      else CS._presentIO.observe(el);
    });
    const el = document.getElementById('sys-stats');
    if (el && _sysStatsHtml) el.innerHTML = _sysStatsHtml;
    if (hadConv) { const fresh = document.querySelector('.conversation'); if (fresh) fresh.scrollTop = savedTop; }
    CS.syncAnchorRail();
    // 超长轨迹格视觉截断检测: 首列越出容器左缘时挂 tr-trunc(左缘渐隐)。
    // 数据层已放宽到全部渲染, 截断完全交给视觉层; justify-flex-end 的
    // 左溢出 scrollWidth 测不到, 用首列几何判定, 幂等无循环渲染
    // 轨迹横向滚动: 贴右生长端 / 保留用户左移位置; 左缘渐隐仅在还有更早内容且
    // 未左移时展示(滚动后渐隐反而遮住最旧的格子)。渲染重建 DOM, 滚动位置由
    // CS.ui.trackScroll 跨渲染接力; 拖拽平移用文档级委托, 只绑一次
    if (!CS._trackPanBound) {
      CS._trackPanBound = true;
      document.addEventListener('pointerdown', e => {
        const track = e.target.closest && e.target.closest('.run-track');
        if (!track || e.button !== 0) return;
        const startX = e.clientX;
        const startLeft = track.scrollLeft;
        let moved = false;
        const move = ev => {
          const dx = ev.clientX - startX;
          if (Math.abs(dx) > 4) moved = true;
          if (moved) track.scrollLeft = startLeft - dx;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          // 位移超阈值判定为拖拽: 抑制其后的 click 跳转(click 同步派发后才清标)
          if (moved) { track.dataset.dragged = '1'; setTimeout(() => { delete track.dataset.dragged; }, 0); }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    for (const track of document.querySelectorAll('.run-track')) {
      if (!track._trScrollBound) {
        track._trScrollBound = true;
        track.addEventListener('scroll', () => {
          CS.ui.trackScroll = { left: track.scrollLeft, pinned: track.scrollLeft >= track.scrollWidth - track.clientWidth - 1 };
          // 渐隐语义: 右侧还有未看过的更早内容(未滚到最左)才在左缘提示
          const over = track.scrollWidth > track.clientWidth + 1;
          track.classList.toggle('tr-trunc', (over && track.scrollLeft > 1) || (track.title || '').includes('还有更早'));
        }, { passive: true });
      }
      const st = CS.ui.trackScroll;
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      track.scrollLeft = st && !st.pinned ? Math.min(st.left, max) : max;
      const over = track.scrollWidth > track.clientWidth + 1;
      // 数据层兜底丢块(极端超长会话)的渐隐由渲染层以 title 声明, 一并保留
      track.classList.toggle('tr-trunc', (over && track.scrollLeft > 1) || (track.title || '').includes('还有更早'));
    }
    // 终端面板: 迁移 xterm 到新容器并 attach/fit
    if (CS.ui.terminal?.open) CS.agent.pty?.mount();
    // Token 用量热力图: 按容器宽度自适应列数(测量后才重排, 最多一次额外渲染)
    CS.fitUsageHeatmap();
  };
  // 热力图列数自适应: 每列 14px(12px 格 + 2px 间隙), 18~53 列之间取容器能容纳的最多周数;
  // 与当前列数一致时不重渲染, 避免循环
  CS.fitUsageHeatmap = () => {
    const compute = () => {
      const box = document.querySelector('.usage-heatmap');
      if (!box) return;
      const inner = box.clientWidth - 24 - 16 - 3 - 1;  // 排除 padding、星期标签列与其 flex 间隙, 留 1px 缓冲
      const weeks = Math.max(18, Math.min(53, Math.floor((inner + 2) / 14)));
      const gap = Math.min(5, Math.max(2, (inner - weeks * 12) / Math.max(1, weeks - 1)));
      // 列数或间隙变化都要重渲染; 收敛后两者稳定, 不会循环
      const changed = weeks !== CS.ui.usageHeatCols || Math.abs((CS.ui.usageHeatGap || 2) - gap) > 0.05;
      CS.ui.usageHeatGap = Math.round(gap * 10) / 10;
      if (changed) { CS.ui.usageHeatCols = weeks; CS.render(); }
    };
    // 推迟到布局稳定(双重 rAF)后再测量, 避免滚动条出现/消失导致宽度漂移
    requestAnimationFrame(() => requestAnimationFrame(compute));
  };

  // ===== 会话锚点轨(Codex 风格左侧短横线) =====
  // 参考 dsh-conversation-anchors(biggerboy) 的交互设计: 每轮用户提问一条短横线,
  // scroll-spy 高亮当前轮; 悬停时邻近横线按距离缩短形成菱形起伏并弹出预览卡;
  // 点击平滑定位并闪光; 超出 70vh 时内部滚动 + 悬停出现上下步进按钮; 支持键盘跳转。
  const _anchorRail = {
    el: null, tip: null, waveIndex: -1, spyRaf: 0, bound: false,
  };
  const _anchorTurns = () => {
    // 一轮 = 一个用户提问气泡; 标题取气泡正文(去掉时间戳/附件), 摘要取随后第一段回复文本
    const conv = document.querySelector('.conversation');
    if (!conv || CS.ui.route !== 'chat') return [];
    const clean = el => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.message-meta,.message-meta-row,.attachment-list').forEach(x => x.remove());
      return (clone.textContent || '').replace(/\s+/g, ' ').trim();
    };
    return [...conv.querySelectorAll('.user-message')].map((el, idx) => {
      let body = '';
      const block = el.closest('.msg-block') || el;
      for (let s = block.nextElementSibling; s && !body; s = s.nextElementSibling) {
        const textEl = s.matches('.user-message') ? null : (s.querySelector?.('.agent-intro') || s.querySelector?.('.think-summary-text'));
        if (textEl) body = (textEl.textContent || '').replace(/\s+/g, ' ').trim();
      }
      return { key: 'u' + idx, el, title: clean(el).slice(0, 160), body: body.slice(0, 200) };
    });
  };
  const _anchorSpy = () => {
    const rail = _anchorRail.el;
    if (!rail?.classList.contains('show')) return;
    const conv = document.querySelector('.conversation');
    if (!conv) return;
    const cRect = conv.getBoundingClientRect();
    const rows = [...rail.querySelectorAll('.anchor-tick-row')];
    const turns = _anchorTurns();
    if (rows.length !== turns.length) return;  // 渲染未同步, 等 sync
    let active = 0;
    const line = cRect.top + Math.max(140, cRect.height * 0.35);
    turns.forEach((t, i) => { if (t.el.getBoundingClientRect().top <= line) active = i; });
    rows.forEach((row, i) => row.toggleAttribute('data-active', i === active));
    const activeRow = rows[active];
    if (activeRow && rail.dataset.spyKey !== activeRow.dataset.key) {
      rail.dataset.spyKey = activeRow.dataset.key;
      // 当前项跟进可视区: 整列溢出内部滚动时把活动行滚进滚动器可视区
      const scroller = rail.querySelector('.anchor-rail-scroll');
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        const top = activeRow.offsetTop - scroller.clientHeight / 2 + activeRow.offsetHeight / 2;
        scroller.scrollTop = Math.max(0, Math.min(top, scroller.scrollHeight - scroller.clientHeight));
      }
    }
  };
  const _anchorJump = (idx, flash = true) => {
    const turns = _anchorTurns();
    const t = turns[idx];
    if (!t) return;
    const reduced = document.documentElement.dataset.motion === 'reduced';
    t.el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    if (flash) { t.el.setAttribute('data-flash', ''); setTimeout(() => t.el.removeAttribute('data-flash'), 1200); }
    // 落点校验补滚: present 卡/图片/懒加载内容会在滚动进行中继续撑高容器,
    // smooth 动画锁定的是启动时刻的目标位置, 落点常停在半路(目标元素还在
    // 视口下方几千像素)。落定后量一次实际偏差, 仍偏则瞬时补滚到位; 内容
    // 还在长就再校验, 最多三轮防抖动循环
    const settle = n => {
      setTimeout(() => {
        if (!t.el.isConnected || n <= 0) return;
        const top = t.el.getBoundingClientRect().top;
        if (Math.abs(top) > 80) {
          t.el.scrollIntoView({ behavior: 'auto', block: 'start' });
          settle(n - 1);
        }
      }, reduced ? 80 : 750);
    };
    settle(3);
  };
  const _anchorClearWave = () => {
    _anchorRail.waveIndex = -1;
    const rail = _anchorRail.el; if (!rail) return;
    rail.removeAttribute('data-waving');
    rail.querySelectorAll('[data-wave]').forEach(x => x.removeAttribute('data-wave'));
    _anchorRail.tip.hidden = true;
  };
  const _anchorWave = index => {
    const rail = _anchorRail.el; if (!rail) return;
    const rows = [...rail.querySelectorAll('.anchor-tick-row')];
    if (index < 0 || index >= rows.length) { _anchorClearWave(); return; }
    rail.setAttribute('data-waving', '');
    rows.forEach((row, i) => {
      const dist = Math.abs(i - index);
      if (dist > 5) row.removeAttribute('data-wave');
      else row.setAttribute('data-wave', String(dist));
    });
    _anchorRail.waveIndex = index;
    const turns = _anchorTurns();
    const t = turns[index];
    const tip = _anchorRail.tip;
    if (!t || !tip) return;
    tip.querySelector('.anchor-tip-title').textContent = t.title || '(空提问)';
    tip.querySelector('.anchor-tip-body').textContent = t.body || '还没有回复内容。';
    tip.hidden = false;
    const r = rows[index].getBoundingClientRect();
    const th = tip.offsetHeight || 70;
    const top = Math.min(window.innerHeight - th - 10, Math.max(10, r.top + r.height / 2 - th / 2));
    tip.style.left = Math.round(r.right + 10) + 'px';
    tip.style.top = Math.round(top) + 'px';
  };
  CS.syncAnchorRail = () => {
    const rail = _anchorRail.el; if (!rail) return;
    const turns = _anchorTurns();
    const main = document.querySelector('.chat-main');
    const mRect = main?.getBoundingClientRect();
    const left = mRect ? Math.round(mRect.left) - 50 : 6;
    const fits = mRect && left >= 4 && window.innerWidth - (mRect.right || 0) > 0;
    if (turns.length < 2 || !fits) { rail.classList.remove('show'); _anchorRail.tip.hidden = true; return; }
    rail.classList.add('show');
    rail.style.left = Math.max(4, left) + 'px';
    _anchorClearWave();
    rail.querySelector('.anchor-rail-scroll').innerHTML = turns.map(t =>
      `<button type="button" class="anchor-tick-row" data-key="${e(t.key)}" aria-label="第 ${Number(t.key.slice(1)) + 1} 轮提问: ${e(t.title.slice(0, 60))}"><span class="anchor-tick"></span></button>`).join('');
    const scroller = rail.querySelector('.anchor-rail-scroll');
    scroller.scrollTop = scroller.scrollHeight;  // 常态底部对齐同 dsh: 最新轮在轨尾
    _anchorRail.spyRaf && cancelAnimationFrame(_anchorRail.spyRaf);
    _anchorRail.spyRaf = requestAnimationFrame(_anchorSpy);
    // 溢出时 hover 显示步进按钮
    scroller.parentElement.toggleAttribute('data-overflow', scroller.scrollHeight > scroller.clientHeight + 1);
  };
  const _anchorInit = () => {
    if (document.getElementById('anchor-rail')) return;
    const rail = document.createElement('nav');
    rail.id = 'anchor-rail';
    rail.setAttribute('aria-label', '会话锚点导航');
    rail.innerHTML = `<button type="button" class="anchor-step anchor-step-up" aria-label="上一轮提问">${i('chevron', '', 14)}</button><div class="anchor-rail-scroll"></div><button type="button" class="anchor-step anchor-step-down" aria-label="下一轮提问">${i('chevron', '', 14)}</button>`;
    document.body.append(rail);
    const tip = document.createElement('div');
    tip.id = 'anchor-tip'; tip.hidden = true;
    tip.innerHTML = `<div class="anchor-tip-title"></div><div class="anchor-tip-body"></div>`;
    document.body.append(tip);
    _anchorRail.el = rail; _anchorRail.tip = tip;
    // 事件委托: 点击定位
    rail.addEventListener('click', ev => {
      const row = ev.target.closest?.('.anchor-tick-row');
      if (row) { _anchorJump(Number(row.dataset.key.replace('u', '')), true); return; }
      const step = ev.target.closest?.('.anchor-step');
      if (step) {
        const rows = [...rail.querySelectorAll('.anchor-tick-row')];
        let cur = rows.findIndex(r => r.hasAttribute('data-active'));
        cur = step.classList.contains('anchor-step-up') ? cur - 1 : cur + 1;
        if (cur >= 0 && cur < rows.length) { rows[cur].focus({ preventScroll: true }); _anchorJump(cur, true); }
      }
    });
    // 悬停菱形起伏 + 预览卡
    rail.addEventListener('mousemove', ev => {
      if (ev.target.closest?.('.anchor-step')) { _anchorClearWave(); return; }
      const rows = [...rail.querySelectorAll('.anchor-tick-row')];
      let best = -1, bestDist = Infinity;
      rows.forEach((row, i) => {
        const r = row.getBoundingClientRect();
        const d = Math.abs(ev.clientY - (r.top + r.bottom) / 2);
        if (d < bestDist) { bestDist = d; best = i; }
      });
      if (best >= 0 && best !== _anchorRail.waveIndex) _anchorWave(best);
      else if (best >= 0) _anchorWave(best);  // 每次移动都刷新 tip 位置
    });
    rail.addEventListener('mouseleave', _anchorClearWave);
    // 键盘跳转: 焦点在轨上时 ↑↓ j k Home End; 输入框内不抢键(事件绑定在 rail 上自然不会收到)
    rail.addEventListener('keydown', ev => {
      const rows = [...rail.querySelectorAll('.anchor-tick-row')];
      if (!rows.length) return;
      let cur = rows.indexOf(document.activeElement);
      if (cur < 0) cur = rows.findIndex(r => r.hasAttribute('data-active'));
      if (cur < 0) cur = rows.length - 1;
      let next = null;
      if (ev.key === 'ArrowUp' || ev.key === 'k') next = cur - 1;
      else if (ev.key === 'ArrowDown' || ev.key === 'j') next = cur + 1;
      else if (ev.key === 'Home') next = 0;
      else if (ev.key === 'End') next = rows.length - 1;
      if (next === null) return;
      ev.preventDefault();
      next = Math.max(0, Math.min(next, rows.length - 1));
      rows[next].focus({ preventScroll: true });
      _anchorJump(next, false);
    });
    // 对话区滚动 scroll-spy(rAF 节流)
    window.addEventListener('scroll', ev => {
      const t = ev.target;
      if (!(t instanceof Element) || !t.classList?.contains('conversation')) return;
      if (_anchorRail.spyRaf) cancelAnimationFrame(_anchorRail.spyRaf);
      _anchorRail.spyRaf = requestAnimationFrame(_anchorSpy);
    }, true);
    window.addEventListener('resize', () => { CS.syncAnchorRail(); CS.fitUsageHeatmap(); });
  };
  _anchorInit();
  // 对话区滚动条: 滚动时短暂显示, 停止后隐藏
  let _scrollbarTimer = null;
  window.addEventListener('scroll', event => {
    const el = event.target;
    if (!(el instanceof Element) || !el.classList?.contains('conversation')) return;
    el.classList.add('is-scrolling');
    clearTimeout(_scrollbarTimer);
    _scrollbarTimer = setTimeout(() => el.classList.remove('is-scrolling'), 900);
  }, true);

  window.addEventListener('hashchange', () => {
    CS.ui.route = applyRoute(); CS.ui.mobileSidebar = false; CS.closeModal(); CS.render(); window.scrollTo(0, 0);
    document.title = 'SigmaFlow Science · ' + ({ home: '科研工作空间', chat: 'Agent 对话', trace: '会话 Trace', data: '数据集', projects: '项目', workflows: '工作流', results: '分析结果', literature: '文献', tools: '生物工具', tasks: '任务队列', settings: '设置', help: '帮助', patient: '虚拟患者' }[CS.ui.route] || '工作空间');
  });

  // WS 断线自动重连成功后: 拉取受影响会话的最新存档(静默换新),
  // 服务端兜底归档落库后终态/轨迹即可无缝合并, 用户无需刷新页面
  CS.agent._afterWsRestored = async runIds => {
    // 续播由 ws 层 chat.replay 接管(journal 按 seq 补齐缺失事件), 这里只
    // 给用户一个"后台任务已接回"的提示; 不整表换新, 避免与续流事件竞态
    if (runIds && runIds.length) CS.toast('网络已恢复，后台任务已接续同步。', 'info');
  };

  const loadRemoteConversation = async id => {
    const hadLocal = CS.state.runs.some(r => r.id === id);
    // 首次远程加载(本地无副本)才出骨架; 已有副本时静默换新, 不打断阅读
    if (!hadLocal) CS.ui.loadingRunId = id;
    try {
      // 存档消息 → 内存消息: 新格式解压块时间线 {t,x}/{t,n,a,r}..., 旧格式压平
      // 记录重建 blocks; 分页循环里每页复用同一解码
      const decodeMsg = m => {
        const msg = { role: m.role, content: m.content, at: m.at || new Date().toISOString(), ...(m.steering ? { steering: true, ...(m.steerId ? { steerId: m.steerId } : {}) } : {}), ...(m.reasoning ? { reasoning: m.reasoning } : {}), ...(m.tools?.length ? { tools: m.tools } : {}), ...(m.asks?.length ? { asks: m.asks } : {}), ...(m.deliverables?.length ? { deliverables: m.deliverables } : {}), ...(m.error ? { error: m.error } : {}), ...(m.tokens ? { tokens: m.tokens, promptTokens: m.promptTokens, elapsed: m.elapsed } : {}), ...(m.streaming ? { streaming: true, serverStreaming: true } : {}) };
        if (msg.role === 'assistant' && Array.isArray(m.blocks) && m.blocks.length) {
          msg.blocks = m.blocks.map(b => {
            if (!b || typeof b !== 'object') return null;
            if (b.t === 'think') return { type: 'think', text: b.x || '' };
            if (b.t === 'tool') return { type: 'tool', name: b.n || '工具', args: b.a && typeof b.a === 'object' ? b.a : {}, result: b.r || '', isError: !!b.e };
            if (b.t === 'ask') return { type: 'ask', id: b.id, questions: Array.isArray(b.qs) ? b.qs : [], answered: !!b.ok, result: b.r || '', answers: Array.isArray(b.ans) ? b.ans : null, stale: !b.ok };
            if (b.t === 'text') return { type: 'text', text: b.x || '' };
            if (b.t === 'compact') return { type: 'compact', text: b.x || '' };
            if (b.t === 'deliverables') return { type: 'deliverables', files: Array.isArray(b.files) ? b.files : [] };
            if (b.t === 'present') return { type: 'present', typ: b.typ || 'file', path: b.path, name: b.name, ext: b.ext, klass: b.klass, size: b.size, title: b.title, note: b.note, pid: b.pid || '' };
            if (b.t === 'webview') return { type: 'webview', mode: b.mode || 'remote', url: b.url, path: b.path, sid: b.sid, title: b.title, note: b.note, height: b.height, live: b.live ? 1 : 0, pid: b.pid || '' };
            if (b.t === 'sysnote') return { type: 'sysnote', text: b.x || '' };
            if (b.t === 'steer') return { type: 'steer', text: b.x || '', ...(b.id ? { steerId: b.id } : {}) };
            return null;
          }).filter(Boolean);
          // 历史快照行兜底: 服务端早期快照把正文累积进 content 字段而不发
          // text 块, 块时间线渲染不读 content——补一个 text 块防正文丢失
          if (msg.blocks.length && !msg.blocks.some(b => b && b.type === 'text') && String(m.content || '').trim()) msg.blocks.push({ type: 'text', text: m.content });
        }
        if (msg.role === 'assistant' && !msg.blocks && (msg.reasoning || msg.tools?.length || msg.asks?.length || msg.deliverables?.length)) {
          const blocks = [];
          if (msg.reasoning) blocks.push({ type: 'think', text: msg.reasoning });
          for (const t of msg.tools || []) blocks.push({ type: 'tool', name: t.name, args: t.args, result: t.result });
          for (const a of msg.asks || []) blocks.push({ type: 'ask', id: a.id, questions: a.questions, answered: !!a.answered, result: a.result, answers: Array.isArray(a.answers) ? a.answers : null, stale: !a.answered });
          if (msg.content) blocks.push({ type: 'text', text: msg.content });
          if (msg.deliverables?.length) blocks.push({ type: 'deliverables', files: msg.deliverables });
          msg.blocks = blocks;
        }
        return msg;
      };
      // 分块传输: 每页 30 条; 大存档不再一把梭(长会话整包 JSON 曾撑爆 HTTP
      // 超时窗口), 逐页拉逐页渲染, 首页到达即可阅读
      const PAGE = 30;
      const fetchPage = offset => CS.api.request(`/conversations/${encodeURIComponent(id)}/content?offset=${offset}&limit=${PAGE}`, { method: 'GET', timeout: 60000 });
      let data;
      try { data = await fetchPage(0); }
      catch (first) { await new Promise(r => setTimeout(r, 900)); data = await fetchPage(0); }
      const meta = CS.ui.conversations.find(c => c.id === id) || {};
      const total = Number(data.total ?? 0);
      const first = Array.isArray(data.content) ? data.content : [];
      // 空壳会话(如"发送即落库"上线前被服务重启腰斩的遗留): 以空白会话正常进入
      if (!first.length && !total) {
        if (!hadLocal) CS.toast('该会话暂无消息记录，可直接发送新消息继续。');
      }
      const run = { id, kind: 'chat', title: meta.title || data.title || '会话', projectId: data.projectId, prompt: '', datasetIds: [], config: {}, ...(data.systemPrompt ? { systemPrompt: data.systemPrompt } : {}),
              messages: first.map(decodeMsg),
              steps: [], createdAt: meta.createdAt ? new Date(meta.createdAt).toISOString() : new Date().toISOString(), status: data.status === 'running' ? 'running' : 'complete', progress: 0, transport: 'chat', isDemo: false };
      // 本地无副本: 首页渲染先行(分页继续后台补全); 已有副本: 拉完再整体换新,
      // 加载过程不闪烁也不再出现"当前视图忽然变短"
      if (!hadLocal) {
        const oldIdx2 = CS.state.runs.findIndex(r => r.id === id);
        if (oldIdx2 >= 0) CS.state.runs[oldIdx2] = run;
        else CS.state.runs.push(run);
        if (data.projectId) CS.state.projectId = data.projectId;
        // 只换数据不拽视图: 加载期间用户可能已切到别的会话, 强制 navigate 会把
        // 用户硬拉回来(表现为"切换不过去/又被拽回"); currentRunId 只归 applyRoute 管
        CS.save();
        CS.render();
      }
      let offset = first.length;
      while (offset < total) {
        const page = await fetchPage(offset);
        const rows = Array.isArray(page.content) ? page.content : [];
        if (!rows.length) break;  // 服务端切片为空防御, 防 total 与实际不一致死循环
        run.messages.push(...rows.map(decodeMsg));
        offset += rows.length;
        if (!hadLocal) CS.render();
      }
      // 归位独立压缩卡(旧版存档形态): 压缩当时插在 reply 前面的独立消息,
      // 按卡的实际发生时点嵌入到相邻回复的块时间线里(compacted 宣告块的位置
      // 就是锚点), 之后独立消息仅作为契约载体隐藏不渲染
      const relocateCompactCards = msgs => {
        let seq = 0;  // 第 N 张卡 ↔ 第 N 条压缩宣告
        const cards = msgs.filter(m => !m.hidden && m.role !== 'user' && String(m.content || '').startsWith('[Conversation compressed'));
        cards.forEach(card => {
          const ci = msgs.indexOf(card);
          // 卡是 splice 到含宣告的流式回复之前的, 宣告块在其后的消息里 — 向后找
          for (let di = ci + 1; di <= ci + 3; di++) {
            const cand = msgs[di];
            if (!cand || cand.role !== 'assistant' || !Array.isArray(cand.blocks)) continue;
            const marks = cand.blocks.map((b2, bi) => (b2 && b2.type === 'sysnote' && /Conversation history was just compacted/.test(String(b2.text || '')) ? bi : -1)).filter(x => x >= 0);
            // 第 N 张卡 ↔ 第 N 条压缩宣告; 只查本卡对应宣告位置是否已嵌, 不扫别处
            if (marks.length > seq) {
              const bi = marks[seq];
              const prev = bi > 0 ? cand.blocks[bi - 1] : null;
              if (!(prev && prev.type === 'compact')) {
                cand.blocks.splice(bi, 0, { type: 'compact', text: String(card.content || '') });
              }
              card.hidden = true;
              seq++;
              break;
            }
          }
        });
      };
      relocateCompactCards(run.messages);
      // 流式快照残留合并: 中途刷新会让服务端落一行 streaming 快照, 任务结束
      // 后前端整表归档又写入终态行, 两行并存时快照行渲染成"永远生成中"的假象。
      // 尾行非流式且覆盖了前一条快照的内容(长度≥或前缀相同) → 快照行并入隐藏
      const _msgs = run.messages;
      const _last = _msgs[_msgs.length - 1];
      const _prev = _msgs[_msgs.length - 2];
      if (
        _last && _prev && _last.role === 'assistant' && _prev.role === 'assistant' &&
        _prev.streaming && !_last.streaming
      ) {
        const a = String(_prev.content || '');
        const b2 = String(_last.content || '');
        if (b2.length >= a.length || (a && b2.startsWith(a.slice(0, 60)))) {
          // 隐藏的同时必须清掉 streaming 标记: 残留标记会让停止按钮/
          // 侧边栏绿点/favicon 把已结束的会话继续渲染成"运行中"
          _prev.hidden = true;
          delete _prev.streaming;
        }
      }
      // 兜底: 服务端已终态的会话, 任何消息上的流式标记都是残留
      if (data.status !== 'running') run.messages.forEach(m => { delete m.streaming; });
      // 刷新恢复: 尾条 assistant 带服务端 streaming 标记 = 任务仍在后台运行,
      // 周期拉存档原位更新该消息(3s 近实时), 终态到达(streaming 消失)即停。
      // 发新消息时清除(真实流式由 chat.done 驱动, 避免双源互写)
      const stopStreamPoll = () => { if (CS._streamPoll) { clearInterval(CS._streamPoll.timer); CS._streamPoll = null; } };
      stopStreamPoll();
      // 轮询条件: 尾条是流式快照, 或服务端仍在运行(模型思考期存档可能还只有
      // user 行, 首条内容行到达时轮询负责补挂 assistant 消息)
      const tailMsg = run.messages[run.messages.length - 1];
      const tailLive = tailMsg && tailMsg.role === 'assistant' && tailMsg.streaming;
      if (tailLive || data.status === 'running') {
        const poll = async () => {
          if (CS._streamPoll?.id !== id) { stopStreamPoll(); return; }
          try {
            const d = await CS.api.request(`/conversations/${encodeURIComponent(id)}/content`, { method: 'GET', timeout: 30000 });
            const rows = Array.isArray(d.content) ? d.content : [];
            const lastA = [...rows].reverse().find(r2 => r2.role === 'assistant' && (r2.streaming || r2.content || r2.blocks?.length));
            const msg = run.messages[run.messages.length - 1];
            const msgLive = msg && msg.role === 'assistant' && msg.streaming;
            if (lastA && lastA.streaming) {
              const decoded = decodeMsg(lastA);
              if (msgLive) {
                if (decoded.content !== msg.content || JSON.stringify(decoded.blocks) !== JSON.stringify(msg.blocks)) {
                  msg.content = decoded.content; msg.blocks = decoded.blocks;
                  if (CS.state.currentRunId === id) CS.render();
                }
              } else {
                // 首条流式行到达: 补挂 assistant 消息(刷新时模型还在思考)
                run.messages.push(decoded);
                run.status = 'running';
                if (CS.state.currentRunId === id) CS.render();
              }
              return;  // 仍在后台运行: 继续轮询
            }
            if (d.status === 'running') return;  // 思考期尚无 assistant 行: 继续等
            // 服务端已终态: 落终态行(防重复推送同内容旧行)
            if (lastA) {
              const decoded = decodeMsg(lastA);
              if (msgLive) { msg.content = decoded.content; msg.blocks = decoded.blocks; msg.streaming = false; }
              else if (!run.messages.some(m2 => m2.role === 'assistant' && (m2.content || '') === decoded.content)) run.messages.push(decoded);
              if (decoded.tokens) { const t2 = run.messages[run.messages.length - 1]; t2.tokens = decoded.tokens; t2.promptTokens = decoded.promptTokens; t2.elapsed = decoded.elapsed; }
            }
            stopStreamPoll();
            run.status = 'complete';
            CS.save();
            CS.render();
          } catch { /* 网络抖动: 下一轮继续 */ }
        };
        CS._streamPoll = { id, timer: setInterval(poll, 3000) };
        _observeLiveStream(id, run);
      }
      if (hadLocal) {
        // 同 id 旧 run 整体替换为服务端全量版; 用户消息自带的引用上下文
        // (refContext)只存在本地, 按消息序号原样保留
        const oldIdx = CS.state.runs.findIndex(r => r.id === id);
        // 发送链路在途的刚建会话(_pendingSend 30s 内)服务端内容可能还是空,
        // 整表替换会吞掉本地已推入的用户消息, 流式事件随后写进孤儿对象;
        // 此情形只补服务端元信息, 内容保留本地版
        const oldRun = oldIdx >= 0 ? CS.state.runs[oldIdx] : null;
        const inFlightSend = !!oldRun && !run.messages.length && (oldRun.messages || []).length && Date.now() - (oldRun._pendingSend || 0) < 30000;
        if (oldRun && inFlightSend) {
          oldRun.projectId = run.projectId || oldRun.projectId;
          oldRun.status = run.status !== 'complete' ? run.status : oldRun.status;
        } else if (oldIdx >= 0) {
          const oldMsgs = CS.state.runs[oldIdx].messages || [];
          oldMsgs.forEach((om, i2) => { if (om?.role === 'user' && om.refContext && run.messages[i2]?.role === 'user') run.messages[i2].refContext = om.refContext; });
          CS.state.runs[oldIdx] = run;
        }
        else CS.state.runs.push(run);
        if (data.projectId) CS.state.projectId = data.projectId;
        CS.save();   // 同上: 数据换新即可, 不导航不夺视图
        CS.render();
        if (first.length) CS.toast('已从服务端同步该会话内容。', 'info');
      } else {
        CS.save();
        CS.render();
      }
    } catch (error) {
      // 失败要可见并允许下次重试: 本地副本继续展示, 但不锁死回源同步
      refreshedRuns.delete(id);
      CS.toast('会话同步失败，当前显示本地缓存版本：' + CS.api.friendlyError(error), 'error');
    }
    finally { if (CS.ui.loadingRunId === id) { CS.ui.loadingRunId = null; CS.render(); } }
  };
    const startChat = prompt => {
    const run = {
      id: CS.uid('run'), kind: 'chat', title: prompt.slice(0, 24) || (CS.ui.pendingUploads || []).find(u => u.status === 'done')?.name?.slice(0, 24) || '新会话',
      projectId: CS.state.projectId, prompt, datasetIds: [...CS.ui.attachments], config: {},
      messages: [], steps: [], createdAt: new Date().toISOString(), status: 'complete',
      progress: 0, transport: 'chat', isDemo: false,
    };
    // _pendingSend: 发送链路在途标记(@引用注入等会延迟 chat.send), 期间
    // 服务端会话刚建好内容还是空, 回源同步的整表替换不能吞掉本地消息
    run._pendingSend = Date.now();
    CS.state.runs.push(run); CS.state.currentRunId = run.id; CS.save();
    CS.agent.registerConversation(run);
    CS.ui.composer = ''; CS.ui.attachments = []; CS.ui.expandedLogs.clear();
    CS.navigate('chat', run.id);
    sendChatMessage(run, prompt, run.datasetIds);
  };
  // ===== 虚拟患者(生理模拟引擎)页面生命周期 =====
  // 引擎本体在 js/patient.js(移植层 window.PatientSim/PatientViewer); 这里只做
  // 壳层编排: mount = 引擎 init + 3D 挂载, unmount = 停定时器 + 释放 WebGL。
  // 引擎状态 S 为脚本级全局, 离开再回来不重置(可通过「复苏重置」手动清零)。
  CS.mountPatientPage = () => {
    const root = document.getElementById('patient-root');
    if (!root) return;
    // 生理引擎(~300KB)与 3D 内核(cell3d ~700KB, 人体器官视图依赖它)按需加载:
    // 首屏不下载, 进本页才取; 两者齐了才挂载, 否则 3D 会静默跳过。
    if (!window.PatientSim || !window.CellViewer) {
      if (CS._patientLazyBusy) return;
      CS._patientLazyBusy = true;
      CS.ensureLazy('cell3d.min', 'patient').then(() => {
        CS._patientLazyBusy = false;
        const ready = window.PatientSim && window.CellViewer && document.getElementById('patient-root');
        if (ready) CS.mountPatientPage();
      });
      return;
    }
    // 高度适配: CSS 的 100vh 不感知 body zoom(界面缩放≠100 时会在页面下方
    // 露空白带或内容出界), 用视觉坐标精确补齐 —— 布局高 = 可视余量 / zoom
    const fit = () => {
      const el = document.getElementById('patient-root');
      if (!el) return;
      if (window.matchMedia('(max-width:1000px)').matches) { el.style.height = ''; return; }
      const zoom = parseFloat(document.body.style.zoom) || 1;
      const top = el.getBoundingClientRect().top;
      el.style.height = Math.max(560, (window.innerHeight - top) / zoom) + 'px';
    };
    CS._patientFit = fit;
    fit();
    function zoomOf(){ return parseFloat(document.body.style.zoom) || 1; }
    // 事件记录卡与监护屏卡(#waves: 设备+状态图标条)等高, 卡片行底边对齐;
    // #waves 高度随状态图标条出现/消失而变, ResizeObserver 稳态同步; zoom 换算保证缩放下也对齐
    CS._patLogSync = () => {
      const w = document.querySelector('#patient-root #waves');
      const l = document.querySelector('#patient-root .pat-logpanel');
      if (!w || !l) return;
      const h = w.getBoundingClientRect().height / zoomOf();
      l.style.flex = 'none';
      l.style.height = Math.round(h) + 'px';
    };
    CS._patLogSync();
    if (!CS._patientFitBound) {
      CS._patientFitBound = true;
      window.addEventListener('resize', () => { if (document.getElementById('patient-root') && CS._patientFit) { CS._patientFit(); if (CS._patLogSync) CS._patLogSync(); } });
      if (window.ResizeObserver) {
        const obs = new ResizeObserver(() => { if (document.getElementById('patient-root') && CS._patLogSync) CS._patLogSync(); });
        if (document.querySelector('#patient-root #waves')) obs.observe(document.querySelector('#patient-root #waves'));
      }
    }
    if (window.PatientSim) PatientSim.mount();
    const cv = document.getElementById('h3d');
    if (window.PatientViewer && cv) PatientViewer.mount(cv);
  };
  CS.unmountPatientPage = () => {
    if (window.PatientSim) PatientSim.unmount();  // 内部顺带释放 3D 视图
  };

  // ===== 虚拟细胞 3D 查看器 =====
  // 内核来自 vendor/cell3d.min.js(window.CellViewer: three + GLTFLoader + DRACOLoader
  // + OrbitControls + RoomEnvironment); GLB/JPG 由 learningcell 静态部署提供
  // (/learningcell/..., 与本页面同源), Draco 解码器同源加载。
  CS.cellViewerDispose = () => {
    const v = CS._cellViewer;
    if (!v) return;
    try { cancelAnimationFrame(v.raf); } catch {}
    try { v.ro && v.ro.disconnect(); } catch {}
    try { v.io && v.io.disconnect(); } catch {}
    try {
      v.scene && v.scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          Object.values(m).forEach(x => { if (x && x.isTexture) x.dispose(); });
          m.dispose();
        });
      });
    } catch {}
    try { v.controls && v.controls.dispose(); } catch {}
    try { v.renderer.dispose(); v.renderer.forceContextLoss && v.renderer.forceContextLoss(); } catch {}
    CS._cellViewer = null;
  };
  CS.cellViewerReset = () => {
    const v = CS._cellViewer;
    if (!v) return;
    v.controls.target.set(0, 0, 0);
    if (v.basePos) v.camera.position.copy(v.basePos);
    v.controls.update();
    v.needsRender = true;
  };
  CS.mountCellViewer = () => {
    CS.cellViewerDispose();
    const stage = document.getElementById('cell-stage');
    if (!stage) return;
    // 3D 内核(cell3d.min.js, ~700KB)按需加载: 首屏不下载, 进细胞页才取。
    if (!window.CellViewer) {
      if (CS._cellLazyBusy) return;
      CS._cellLazyBusy = true;
      CS.ensureLazy('cell3d.min').then(() => {
        CS._cellLazyBusy = false;
        if (window.CellViewer && document.getElementById('cell-stage')) CS.mountCellViewer();
      });
      return;
    }
    const CV = window.CellViewer;
    const model = (CS.CELL_MODELS || []).find(m => m.key === CS.ui.cellModel) || (CS.CELL_MODELS || [])[0];
    const loadEl = stage.querySelector('.cell-load');
    const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fallback = msg => {
      if (loadEl) loadEl.className = 'cell-load';
      const t = loadEl ? loadEl.querySelector('#cell-load-text') : null;
      if (t) t.textContent = msg; else if (loadEl) loadEl.textContent = msg;
      const old = stage.querySelector('.cell-fallback');
      if (old) old.remove();
      stage.insertAdjacentHTML('beforeend', `<div class="cell-fallback"><img src="${model ? model.img : ''}" alt="${model ? esc(model.name) : ''} 预览"><p>${esc(msg)}</p><p class="tiny muted">3D 素材位于站点内(dist/cell 与 vendor/draco), 无法访问时请重新执行站点构建。</p></div>`);
    };
    if (!CV || !model) { fallback('3D 组件未加载或模型数据缺失。'); return; }
    const THREE = CV.THREE;
    const w = Math.max(200, stage.clientWidth), h = Math.max(220, stage.clientHeight);
    // preserveDrawingBuffer: 让 canvas 像素随时可读(预览图截取/调试计数);
    // 渲染已是按需模式, 保留后备缓冲的代价可忽略
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    // 像素比封顶 1.5: 百万级三角形模型在 2x 视网膜下逐帧光栅是滚动掉帧的主因
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.domElement.className = 'cell-canvas';
    stage.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 2000);
    // PBR 环境(RoomEnvironment 经 PMREM) + 双向柔和补光
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new CV.RoomEnvironment(), 0.04).texture;
    const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 2); scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.7); rim.position.set(-4, 2, -3); scene.add(rim);
    const controls = new CV.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = !!CS.ui.cellAutoRotate;
    controls.autoRotateSpeed = 1.1;
    const v = { renderer, scene, camera, controls, raf: 0, ro: null, io: null, basePos: null, needsRender: true, visible: true, lastPaint: 0 };
    CS._cellViewer = v;
    // 按需渲染: 只有相机变化(拖拽/缩放/自动旋转)才真正 draw; 静止时空转 rAF,
    // GPU 释放给页面滚动合成; 自动旋转时也限 ~30fps(动画足够顺滑, 负载减半)
    controls.addEventListener('change', () => { v.needsRender = true; });
    const render = t => {
      v.raf = requestAnimationFrame(render);
      if (!v.visible) return;
      const moved = controls.update();
      if (!moved && !v.needsRender) return;
      if (v.lastPaint && t - v.lastPaint < 31) return;
      v.lastPaint = t;
      renderer.render(scene, camera);
      if (!moved) v.needsRender = false;
    };
    render(0);
    // 舞台滚出视口时整体暂停(含 rAF 的 controls 更新), 回来时补一帧
    const io = new IntersectionObserver(ents => {
      v.visible = !!(ents[ents.length - 1] && ents[ents.length - 1].isIntersecting);
      if (v.visible) v.needsRender = true;
    }, { threshold: 0.02 });
    io.observe(stage);
    v.io = io;
    // 模型加载: Draco 解码器与 GLB 都来自 learningcell 同源静态目录
    try {
      const draco = new CV.DRACOLoader();
      // decoder vendor 在 js/vendor/draco(build 后 dist/vendor/draco): 相对路径随页面
      // 所在部署前缀自适应(caddy /sigmaflow 剥前缀或 4110 直访都成立), 不再跨站加载
      draco.setDecoderPath('vendor/draco/');
      const loader = new CV.GLTFLoader();
      loader.setDRACOLoader(draco);
      const loading = document.getElementById('cell-load-text');
      loader.load(model.glb,
        gltf => {
          if (CS._cellViewer !== v) return;  // 渲染期间切走了, 直接丢弃
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          gltf.scene.position.sub(center);
          scene.add(gltf.scene);
          camera.near = Math.max(maxDim / 500, 0.001);
          camera.far = maxDim * 60;
          // 拉近的默认机位: 距离约 1.7*maxDim(原 2.56), 模型视觉放大约 1.5 倍
          camera.position.set(maxDim * 1.05, maxDim * 0.6, maxDim * 1.25);
          v.basePos = camera.position.clone();
          camera.updateProjectionMatrix();
          controls.minDistance = maxDim * 0.5;
          controls.maxDistance = maxDim * 6;
          controls.update();
          v.needsRender = true;  // 装配完成后立即出首帧
          if (loadEl) {
            loadEl.className = 'cell-load ok';
            const lt = loadEl.querySelector('#cell-load-text'); if (lt) lt.textContent = model.name + ' 模型已就绪';
            setTimeout(() => { if (loadEl.parentNode && loadEl.className === 'cell-load ok') loadEl.className = 'cell-load hide'; }, 2200);
          }
        },
        ev => {
          if (ev && ev.total && loading) loading.textContent = '正在加载 ' + model.name + ' 模型… ' + Math.round(ev.loaded / ev.total * 100) + '%';
        },
        err => fallback('3D 模型加载失败: ' + ((err && (err.message || err.type)) ? String(err.message || err.type).slice(0, 90) : '资源不可达')));
    } catch (eLoad) { fallback('3D 初始化失败: ' + (eLoad && eLoad.message ? eLoad.message : '未知错误')); }
    const ro = new ResizeObserver(() => {
      const nw = Math.max(200, stage.clientWidth), nh = Math.max(220, stage.clientHeight);
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      v.needsRender = true;
    });
    ro.observe(stage);
    v.ro = ro;
  };
  let _chatRenderAt = 0;
  const scrollToLatest = () => {
    const conversation = document.querySelector('.conversation');
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
    CS.ui.canJumpLatest = false;
    CS.ui.followLock = false;  // 主动回到底部后恢复跟随
  };
  // 用户已向上翻阅时不要抢滚动: 只有贴近底部才跟随新内容滚到底,
  // 否则流式期间的每次重渲染都会把用户的滚动位置拉回底部, 表现为滚动卡顿。
  const nearBottom = () => {
    const el = document.querySelector('.conversation');
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // 流式期间只更新正在生成的那条消息, 避免整页 innerHTML 重建(长会话下每次
  // 100ms+, 会把主线程占满, 表现为滚动掉帧)。结构变化(思考区出现等)时返回
  // false, 由调用方退回全量渲染。
  // 上下文圆环的轻量更新: 输入草稿变化时不整页重渲染, 直接改环弧/百分比/浮层数字
  CS.updateContextRing = () => {
    const btn = document.querySelector('.ctx-ring-btn');
    const pop = document.querySelector('.ctx-pop');
    if (!btn && !pop) return;
    const u = CS.contextUsage();
    if (btn) {
      const R = 9, C = 2 * Math.PI * R;
      const on = C * Math.max(u.pct, 2) / 100;
      const fill = btn.querySelector('.ctx-fill');
      if (fill) fill.setAttribute('stroke-dashoffset', (C - on).toFixed(2));
      const pctEl = btn.querySelector('.ctx-pct');
      if (pctEl) pctEl.textContent = u.pct + '%';
      btn.dataset.level = u.pct >= 90 ? 'danger' : u.pct >= 60 ? 'warn' : 'ok';
      btn.title = `上下文已用 ~${u.pct}% · 点击查看详情`;
    }
    if (pop) {
      const win = u.window, seg = t => t > 0 ? `width:${Math.max(0, Math.min(100, t / win * 100)).toFixed(2)}%;min-width:5px` : 'width:0%;min-width:0';
      const q = k => pop.querySelector(`[data-ctx="${k}"]`);
      const setText = (k, v) => { const el = q(k); if (el) el.textContent = v; };
      const setWidth = (k, style) => { const el = q(k); if (el) el.style.cssText = style; };
      setText('pct', u.pct + '%');
      setText('cap', `${CS.kfmt(u.total)} / ${CS.kfmt(win).slice(1)}`);
      setWidth('w-sys', seg(u.sysT)); setWidth('w-tools', seg(u.toolT)); setWidth('w-msgs', seg(u.msgsT));
      setText('v-sys', CS.kfmt(u.sysT)); setText('v-tools', CS.kfmt(u.toolT)); setText('v-msgs', CS.kfmt(u.msgsT));
    }
  };
  // Agent 工具设置: 进入设置页时懒加载; 保存或恢复后刷新上下文圆环
  // 工具结果入库上限: 设置页展示与保存 ( science 数据目录 settings.json )
  CS.loadToolLimit = async () => {
    if (CS.ui.toolLimit == null) {
      try { const d = await CS.api.request('/tool-result-limit'); CS.ui.toolLimit = d.limit ?? 30000; } catch { /* 拿不到保持空占位, 保存时用默认 */ }
    }
    if (CS.ui.turnBudget == null) {
      try { const d = await CS.api.request('/turn-budget'); CS.ui.turnBudget = d.limit ?? 100; } catch { /* 同上 */ }
    }
    CS.render();
  };
  CS.loadAgentTools = async () => {
    if (CS.ui.agentTools) return;
    try {
      const d = await CS.api.request('/tools');
      CS.ui.agentTools = d.tools || [];
      if (!CS.ui.toolDraft) CS.ui.toolDraft = CS.ui.agentTools.map(t => ({ ...t }));
      CS.render();
    } catch (error) { CS.toast('工具列表加载失败：' + CS.api.friendlyError(error), 'error'); }
  };
  CS.loadAgentTokens = async () => {
    if (CS.ui.tokens) return;
    try {
      const d = await CS.api.request('/tokens');
      CS.ui.tokens = d.tokens || [];
      CS.render();
    } catch (error) { CS.toast('Token 配置加载失败：' + CS.api.friendlyError(error), 'error'); }
  };
  CS.refreshContextInfo = async () => {
    try { CS.ui.contextInfo = await CS.api.request('/context-info'); } catch {}
    CS.updateContextRing();
  };
  // Agent 技能设置: 进入设置页时懒加载, 保存或恢复后刷新上下文圆环
  CS.loadAgentSkills = async () => {
    if (CS.ui.agentSkills) return;
    try {
      const d = await CS.api.request('/skills');
      CS.ui.agentSkills = d.skills || [];
      if (!CS.ui.skillDraft) CS.ui.skillDraft = CS.ui.agentSkills.map(s => ({ ...s }));
      CS.render();
    } catch (error) { CS.toast('技能列表加载失败：' + CS.api.friendlyError(error), 'error'); }
  };
  // MCP 服务设置: 同样懒加载; 草稿每行带稳定 key (新增行用临时 key, 保存时以名称为准)
  CS.loadAgentMcp = async () => {
    if (CS.ui.mcpServers) return;
    try {
      const d = await CS.api.request('/mcp');
      CS.ui.mcpServers = d.servers || [];
      if (!CS.ui.mcpDraft) CS.ui.mcpDraft = CS.ui.mcpServers.map(s => ({ ...s, key: s.id }));
      CS.render();
    } catch (error) { CS.toast('MCP 配置加载失败：' + CS.api.friendlyError(error), 'error'); }
  };
  // 系统提示词设置: 懒加载内置默认与自定义配置; 草稿仅含 prompt/enabled
  CS.loadSystemPrompt = async () => {
    if (!CS.ui.memSettings) {
      try { CS.ui.memSettings = (await CS.api.request('/memory-settings')).memory || { recall: true }; }
      catch { CS.ui.memSettings = { recall: true }; }
    }
    if (CS.ui.systemPrompt) { CS.render(); return; }
    try {
      const d = await CS.api.request('/system-prompt');
      CS.ui.systemPrompt = d;
      if (!CS.ui.syspromptDraft) CS.ui.syspromptDraft = { prompt: d.prompt || '', enabled: !!d.enabled };
      CS.render();
    } catch (error) { CS.toast('系统提示词加载失败：' + CS.api.friendlyError(error), 'error'); }
  };

  // 上下文压缩参数: GET 拉取当前生效值; draft 供表单未保存修改, 数字输入不重渲染
  CS.loadAgentCompaction = async force => {
    if (CS.ui.agentCompaction && !force) {
      if (!CS.ui.compactionDraft) CS.ui.compactionDraft = { ...CS.ui.agentCompaction };
      return;
    }
    try {
      const d = await CS.api.request('/compaction');
      CS.ui.agentCompaction = d.compaction || {};
      if (!CS.ui.compactionDraft) CS.ui.compactionDraft = { ...CS.ui.agentCompaction };
      CS.render();
    } catch (error) { CS.toast('压缩参数加载失败：' + CS.api.friendlyError(error), 'error'); }
  };
  // Token 用量卡数据: 服务端聚合 SigmaFlow 自身会话记录; force=true 跳过前端缓存重拉
  CS.loadUsage = async force => {
    if (CS.ui.usage && !force) return;
    try {
      const d = await CS.api.request('/usage-tokens');
      CS.ui.usage = d;
    } catch (error) { CS.ui.usage = { error: CS.api.friendlyError(error), loading: false }; }
    if (CS.ui.route === 'settings' && CS.ui.settingsTab === 'usage') CS.render();
  };
  // 参数编辑框: 透明 textarea 叠在高亮 pre 上, 输入时刷新高亮; 高度由 sizeSchemaEditors 统一管理
  CS.sizeSchemaEditors = () => {
    // 先按内容自适应, 再把同一网格行(左右两列)的编辑器统一到该行最大高度, 保证每行两卡等高
    const byRow = new Map();
    document.querySelectorAll('.tool-group-rows').forEach(grid => {
      const gridKey = Math.round(grid.getBoundingClientRect().top);
      grid.querySelectorAll(':scope > .tool-setting-row').forEach(row => {
        const ed = row.querySelector('.schema-editor');
        const ta = ed?.querySelector('.tool-schema-input');
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight}px`;
        const pre = ed.querySelector('.schema-highlight');
        if (pre) pre.style.height = `${ta.scrollHeight}px`;
        const key = `${gridKey}|${Math.round(row.getBoundingClientRect().top)}`;
        if (!byRow.has(key)) byRow.set(key, []);
        byRow.get(key).push({ ta, pre });
      });
    });
    for (const pair of byRow.values()) {
      if (pair.length < 2) continue;
      const h = Math.max(...pair.map(p => parseFloat(p.ta.style.height)));
      for (const p of pair) {
        p.ta.style.height = `${h}px`;
        if (p.pre) p.pre.style.height = `${h}px`;
      }
    }
  };
  CS.syncSchemaHighlight = ta => {
    const pre = ta.closest('.schema-editor')?.querySelector('.schema-highlight');
    if (!pre) return;
    pre.innerHTML = `${CS.views.hlJSON(CS.views.prettyJSON(ta.value))}\n`;
    CS.sizeSchemaEditors();
  };
    // 刷新后的实时流接棒: 会话仍在后台运行时向服务端申请 chat.observe,
  // 从 journal 尾部续播新增事件 —— 恢复真正的逐字流式渲染, 而不是
  // 3s 存档轮询的一坨一坨整页闪现。失败(已结束/journal 失效/WS 断)时
  // 静默回退轮询(轮询始终保留作兜底, 此处不关它)。
  function _observeLiveStream(id, run, attempt = 0) {
    // reload 后 HTTP 存档先到、WS 可能尚未握完手: 未连接时等连接就绪再试
    // (上限 5 次 × 1s), 仍失败回退存档轮询。等待期不走幂等检查 —— 否则
    // 重试会被自己设置的标记挡死(永远挂不上观察)
    if (!CS.api.ws.open() && attempt < 5) {
      CS._observing = { id, waiting: true };
      setTimeout(() => _observeLiveStream(id, run, attempt + 1), 1000);
      return;
    }
    if (CS._observing?.id === id && !CS._observing?.waiting) return;  // 已有活跃观察
    CS._observing = { id };
    const visible = () => CS.state.currentRunId === id && CS.ui.route === 'chat';
    // 目标消息动态取: 轮询补挂/快照替换可能换对象, 每次事件都重新定位尾条流式行
    const liveReply = () => {
      const m = run.messages[run.messages.length - 1];
      return m && m.role === 'assistant' && m.streaming ? m : null;
    };
    let renderAt = 0;
    // 全量重放接棒: 首个事件到达时把存档基线重置为空, 从零重建块时间线
    // (与发起端同构); 重放走内存 journal 毫秒级追平, 不闪。同时停掉存档
    // 轮询 —— 轮询的 3s 快照整条覆盖会与实时增量互写, 正文来回跳。
    let rebased = false;
    const rebaseOnce = () => {
      if (rebased) return;
      rebased = true;
      const m = liveReply();
      if (m) { m.blocks = []; m.content = ''; m.reasoning = ''; m.tools = []; m.asks = []; m.deliverables = []; m.tokens = 0; }
      if (CS._streamPoll?.id === id) { clearInterval(CS._streamPoll.timer); CS._streamPoll = null; }
    };
    const liveRender = () => {
      const m = liveReply();
      if (!m || !visible() || Date.now() - renderAt < 120) return;
      renderAt = Date.now();
      const follow = nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false;
      if (!updateStreamingDom(m)) CS.render();
      if (follow) scrollToLatest();
    };
    const toolEvent = (t, reqId) => {
      const m = liveReply();
      if (!m) return;
      CS.liveBlocks.pushTool(m, run, t, reqId);  // compact 分支可能重建消息对象, 事件级落盘在 pushTool 内
      CS.liveBlocks.mirror(m);
      CS.save();  // 工具事件落盘, 观察端与发起端同等防丢
      const follow = visible() && nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false;
      if (visible()) CS.render();
      if (follow) scrollToLatest();
    };
    CS.api.ws.chat(
      { _action: 'chat.observe', runId: id },
      delta => { rebaseOnce(); const m = liveReply(); if (!m) return; CS.liveBlocks.pushDelta(m, delta); CS.liveBlocks.mirror(m); m.tokens = (m.tokens || 0) + ((delta.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length + (delta.length - (delta.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length) / 4); liveRender(); },
      think => { rebaseOnce(); const m = liveReply(); if (!m) return; CS.liveBlocks.pushThink(m, think); CS.liveBlocks.mirror(m); liveRender(); },
      (t, reqId) => { rebaseOnce(); toolEvent(t, reqId); },
      null,
      usage => { rebaseOnce(); const m = liveReply(); if (m && usage.promptTokens) { m.promptTokens = usage.promptTokens; if (visible() && Date.now() - renderAt > 120) { renderAt = Date.now(); CS.render(); } } if (usage.cacheTokens != null && liveReply()) liveReply().cacheTokens = usage.cacheTokens; },
      null, null,
      sd => {
        // 引导插话回显: 与发起端同一条路径, 按 steerId 去重(重放不重复)。
        // 内嵌进流式 reply 的块时间线(分割点=插入时刻), 详见 steerEvent
        const txt = String(sd.text || '');
        const sid = String(sd.id || '');
        if (!txt) return;
        const dupRow = sid && run.messages.some(m2 => m2.steerId === sid);
        const live = liveReply();
        const dupBlk = sid && live && live.blocks.some(b2 => b2 && b2.type === 'steer' && b2.steerId === sid);
        if (sid && (dupRow || dupBlk)) return;
        if (live) {
          live.blocks.push({ type: 'steer', text: txt, ...(sid ? { steerId: sid } : {}), at: sd.at || new Date().toISOString() });
          CS.liveBlocks.mirror(live);
        } else {
          run.messages.push({ role: 'user', content: txt, steering: true, ...(sid ? { steerId: sid } : {}), at: sd.at || new Date().toISOString() });
        }
        CS.save();
        if (visible()) CS.render();
      }
    ).then(() => {
      // 终态到达: 重放构建的内容就是完整终版(与服务端兑底归档同源), 直接
      // 收尾即可 —— 不再 loadRemoteConversation: done 事件先于兑底归档落库
      // 到达, 立即回拉会取到旧 streaming 快照, 把已流完的正文推倒重来
      if (CS._observing?.id === id) CS._observing = null;
      if (CS._streamPoll?.id === id) { clearInterval(CS._streamPoll.timer); CS._streamPoll = null; }
      const m = run.messages[run.messages.length - 1];
      if (m && m.role === 'assistant') delete m.streaming;
      run.status = 'complete';
      CS.save(); CS.render();
      syncConversation(run);
    }).catch(() => {
      if (CS._observing?.id === id) CS._observing = null;  // 回退轮询兜底
    });
  }
  // 流式块累积的唯一实现(sendChatMessage 实时流与刷新后的 observe 接棒共用):
// delta/think/tool/deliverables/present/webview/sysnote/compact/ask 事件
// 按序累积进目标 assistant 消息的块时间线, mirror() 同步 content/tools 等摘要字段
CS.liveBlocks = {
  mirror(reply) {
    reply.content = reply.blocks.filter(b => b.type === 'text').map(b => b.text).join('');
    reply.reasoning = reply.blocks.filter(b => b.type === 'think').map(b => b.text).join('');
    reply.tools = reply.blocks.filter(b => b.type === 'tool').map(b => ({ name: b.name, args: b.args, result: b.result, isError: !!b.isError }));
    reply.asks = reply.blocks.filter(b => b.type === 'ask').map(b => ({ id: b.id, questions: b.questions, answered: !!b.answered, result: b.result || '', ...(b.answers ? { answers: b.answers } : {}) }));
    reply.deliverables = reply.blocks.filter(b => b.type === 'deliverables').flatMap(b => b.files || []);
  },
  pushThink(reply, think) {
    const last = reply.blocks[reply.blocks.length - 1];
    if (last && last.type === 'think') last.text += think;
    else reply.blocks.push({ type: 'think', text: think, at: Date.now() });
  },
  pushDelta(reply, delta) {
    const last = reply.blocks[reply.blocks.length - 1];
    if (last && last.type === 'text') last.text += delta;
    else reply.blocks.push({ type: 'text', text: delta, at: Date.now() });
  },
  pushTool(reply, run, t, reqId) {
    // 压缩两阶段走块内嵌: 开始往当前流式 reply 的块时间线推空 compact 块
    // (渲染成"正在压缩会话"等待卡), 完成时把摘要填进该块 — 卡的位置与
    // 压缩实际发生的时刻一致, 不再出现插到回复消息前面的错位
    if (t.kind === 'compactStart') {
      const lastMsg = run.messages[run.messages.length - 1];
      if (lastMsg && lastMsg.streaming && Array.isArray(lastMsg.blocks)) {
        if (lastMsg.blocks.some(b2 => b2 && b2.type === 'compact' && !String(b2.text || '').trim())) return;  // 防重
        lastMsg.blocks.push({ type: 'compact', text: '', at: Date.now() });
        CS.save(); if (visible()) CS.render();
        return;
      }
      return;  // 没有可嵌入的流式回复时静默(等待块由完成事件直接建)
    }
    if (t.kind === 'compact' && t.text) {
      const target = run.messages.find(m => Array.isArray(m.blocks) && m.blocks.some(b2 => b2 && b2.type === 'compact' && !String(b2.text || '').trim()));
      if (target) {
        const empty = target.blocks.find(b2 => b2.type === 'compact' && !String(b2.text || '').trim());
        empty.text = String(t.text);
        empty.end = Date.now();
        CS.save(); if (visible()) CS.render();
        return;
      }
      // 无等待块(事件重放/HTTP 快路径): 嵌入当前流式或最后一条回复
      const lastMsg = run.messages[run.messages.length - 1];
      const targetMsg = lastMsg && lastMsg.role === 'assistant' && Array.isArray(lastMsg.blocks) ? lastMsg : null;
      if (targetMsg && !targetMsg.blocks.some(b2 => b2 && b2.type === 'compact' && String(b2.text || '') === String(t.text))) {
        targetMsg.blocks.push({ type: 'compact', text: String(t.text), at: Date.now() });
        CS.save(); CS.render();
        return;
      }
      return;
    }
    // 产出文件行(dsh deliverables 思路): 后到的事件携带全量清单, 移除旧块重挂尾部
    if (t.kind === 'deliverables' && Array.isArray(t.files)) {
      reply.blocks = reply.blocks.filter(b => b.type !== 'deliverables');
      if (t.files.length) reply.blocks.push({ type: 'deliverables', files: t.files });
      return;
    }
    // sysnote: agent 循环注入的 [System] 提示(nudge/finalize/goal/后台结果回灌)
    if (t.kind === 'sysnote') {
      reply.blocks.push({ type: 'sysnote', text: String(t.text || ''), at: Date.now() });
      return;
    }
    // 引导未送达(轮次预算耗尽后才排到的插话): 显式提示, 不静默吞
    if (t.kind === 'steerDropped') {
      reply.blocks.push({ type: 'sysnote', text: `[Steering] ${t.count} 条引导消息未送达模型(本次回复的轮次预算已用尽)：${(t.texts || []).join(' / ')}`, at: Date.now() });
      return;
    }
    // present: 模型主动呈现的富媒介文件卡片(typ 字段为将来的非文件形态预留)
    if (t.kind === 'present') {
      reply.blocks.push({ type: 'present', typ: t.typ || 'file', path: t.path, name: t.name, ext: t.ext, klass: t.klass, size: t.size, title: t.title, note: t.note, pid: run?.projectId || CS.state.projectId, at: Date.now() });
      return;
    }
    if (t.kind === 'webview') {
      reply.blocks.push({ type: 'webview', mode: t.mode || 'remote', url: t.url, path: t.path, sid: t.sid, title: t.title, note: t.note, height: t.height, live: t.live ? 1 : 0, pid: run?.projectId || CS.state.projectId, at: Date.now() });
      return;
    }
    // 每次工具调用独立成块, 不再合并进之前的工具列表
    if (t.kind === 'call') {
      // ask 的通用工具卡跳过: 问题卡片由专门的 ask 事件负责
      if (t.isAsk) return;
      reply.blocks.push({ type: 'tool', name: t.name, args: t.args, result: null, at: Date.now() });
    } else if (t.kind === 'ask') {
      reply.blocks.push({ type: 'ask', id: t.id, requestId: reqId, questions: Array.isArray(t.questions) ? t.questions : [], answered: false, at: Date.now() });
    } else {
      if (t.isAsk) {
        const ab = [...reply.blocks].reverse().find(b => b.type === 'ask' && !b.answered);
        if (ab) { ab.answered = true; if (!ab.result) ab.result = t.result; ab.end = Date.now(); return; }
      }
      // FIFO 配对: call 整批广播、工具顺序执行, 结果属于最早未收尾的同名调用
      const ent = reply.blocks.find(b => b.type === 'tool' && b.name === t.name && b.result == null);
      if (ent) { ent.result = t.result; ent.isError = !!t.isError; if (typeof ent.at === 'number') ent.end = Date.now(); }
      else reply.blocks.push({ type: 'tool', name: t.name, result: t.result, isError: !!t.isError, at: Date.now() });
    }
  },
};

  const updateStreamingDom = reply => {
    // 时间线增量更新: 块类型签名没变时只就地更新生长中的块, 避免整页重渲染;
    // 签名变化(新块出现)则返回 false 让调用方全量渲染
    const contentEl = document.querySelector(`.agent-intro[data-stream-at="${CSS.escape(reply.at)}"]`);
    const body = contentEl?.closest('.agent-body');
    if (!contentEl || !body) return false;
    const blocks = reply.blocks || [];
    if (body.dataset.blockSig !== blocks.map(b => b.type).join(',')) return false;
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'text') {
      contentEl.innerHTML = CS.markdown(last.text);
      return true;
    }
    // 最后一块是思考/工具: 就地更新其摘要行与(展开时的)思考正文
    const liveRoot = body.querySelector('.think-root[data-live="1"]');
    if (liveRoot && last) {
      const summary = liveRoot.querySelector('.think-summary-text');
      if (summary) summary.textContent = last.type === 'think' ? last.text : JSON.stringify(last.args || {}).slice(0, 160);
      const thinkBody = liveRoot.querySelector('.think-body');
      if (thinkBody) thinkBody.textContent = last.text || '';
    }
    return true;
  };
  // 监听对话区滚动: 离开底部 80px 以上时显示"跳到最新"按钮。
  // 只切换按钮的 hidden 属性, 不要在这里 CS.render() —— 全量 innerHTML 重建
  // 会销毁滚动容器, 打断 Chrome 的滚动手势锁定(scroll latching),
  // 表现为滚轮滚一段就冻住、必须动一下鼠标才能继续。
  document.addEventListener('scroll', ev => {
    const el = ev.target;
    if (!el.classList?.contains('conversation')) return;
    const show = el.scrollHeight - el.scrollTop - el.clientHeight >= 80;  // 离底部远 → 显示
    if (!show) CS.ui.followLock = false;  // 用户回到底部后恢复跟随
    if (show === CS.ui.canJumpLatest) return;
    CS.ui.canJumpLatest = show;
    const btn = document.querySelector('.jump-latest');
    if (btn) btn.hidden = !show;
  }, true);
  // 会话内容同步到服务端（供其他浏览器打开）; 失败后延迟重试一次
  const syncConversation = async (run, retry = true) => {
    const conv = CS.ui.conversations.find(c => c.id === run.id);
    // 块级时间线持久化: 压缩格式 {t,x}/{t,n,a,r}/{t,ask…}, 加载时交错的思考/工具/文本原样重放
    const savedBlocks = m => {
      const out = [];
      (m.blocks || []).forEach(b => {
        if (b.type === 'think') out.push({ t: 'think', x: b.text || '' });
        else if (b.type === 'tool') out.push({ t: 'tool', n: b.name || '工具', a: b.args && typeof b.args === 'object' ? b.args : {}, r: b.result == null ? '' : String(b.result), ...(b.isError ? { e: true } : {}) });
        else if (b.type === 'ask') out.push({ t: 'ask', id: b.id, qs: Array.isArray(b.questions) ? b.questions : [], ok: !!b.answered, r: b.result || '', ans: Array.isArray(b.answers) ? b.answers : null });
        else if (b.type === 'text') out.push({ t: 'text', x: b.text || '' });
        else if (b.type === 'deliverables') out.push({ t: 'deliverables', files: b.files || [] });
        else if (b.type === 'present') out.push({ t: 'present', typ: b.typ || 'file', path: b.path, name: b.name, ext: b.ext, klass: b.klass, size: b.size, title: b.title, note: b.note, pid: b.pid || '' });
        else if (b.type === 'webview') out.push({ t: 'webview', mode: b.mode || 'remote', url: b.url, path: b.path, sid: b.sid, title: b.title, note: b.note, height: b.height, live: b.live ? 1 : 0, pid: b.pid || '' });
        else if (b.type === 'sysnote') out.push({ t: 'sysnote', x: b.text || '' });
        else if (b.type === 'steer') out.push({ t: 'steer', x: b.text || '', ...(b.steerId ? { id: b.steerId } : {}) });
      });
      return out;
    };
    const payload = {
      id: run.id, title: run.title, projectId: run.projectId,
      pinned: !!conv?.pinned, archived: !!conv?.archived,
      content: run.messages.filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => { const sb = m.role === 'assistant' ? savedBlocks(m) : []; return { role: m.role, content: m.content, at: m.at, ...(m.steering ? { steering: true, ...(m.steerId ? { steerId: m.steerId } : {}) } : {}), ...(m.model ? { model: m.model } : {}), ...(m.reasoning ? { reasoning: m.reasoning } : {}), ...(m.tools?.length ? { tools: m.tools } : {}), ...(m.asks?.length ? { asks: m.asks } : {}), ...(sb.length ? { blocks: sb } : {}), ...(m.deliverables?.length ? { deliverables: m.deliverables } : {}), ...(m.error ? { error: m.error } : {}), ...(m.tokens ? { tokens: m.tokens, promptTokens: m.promptTokens, elapsed: m.elapsed, ...(m.contextTokens ? { contextTokens: m.contextTokens } : {}), ...(m.cacheTokens ? { cacheTokens: m.cacheTokens } : {}) } : {}) }; }),
    };
    try { await CS.api.modelCall('conversation.save', 'POST', '/conversations', payload); }
    catch { if (retry) setTimeout(() => syncConversation(run, false), 3000); }
  };
  // ---- @file 引用(dsh file-reference 思路的轻量版) ----
  // 输入 @ 弹出项目目录补全菜单(独立 DOM, 不进 render 流, 避免重渲染丢焦点);
  // 发送时把 @路径 解析成文件内容附加进当轮上下文, 仅发送侧注入不回显。
  CS.fileRef = { open: false, items: [], active: 0, start: 0, token: '', query: '', dir: '', mode: 'text' };
  // 文件引用的项目归属: 会话页跟随会话项目(与发送侧 refContext 一致), 其它页面用全局关联项目
  const _fsProjectId = () => {
    const run = CS.ui.route === 'chat' ? CS.currentRun() : null;
    return (run && run.projectId) || CS.state.projectId;
  };
  const _fsTreeCache = {};
  const _fsListDir = async (path, pidOverride) => {
    const pid = pidOverride || _fsProjectId();
    if (!pid) return [];
    const key = pid + '|' + (path || '');
    const hit = _fsTreeCache[key];
    if (hit && Date.now() - hit.ts < 60000) return hit.entries;
    try {
      const data = await CS.api.request('/fs/tree?projectId=' + encodeURIComponent(pid) + '&path=' + encodeURIComponent(path || ''), { method: 'GET' });
      _fsTreeCache[key] = { ts: Date.now(), entries: data.entries || [] };
      return data.entries || [];
    } catch { return []; }
  };
  let _fileRefTimer = null;
  const _fileRefPing = () => { if (_fileRefTimer) clearTimeout(_fileRefTimer); _fileRefTimer = setTimeout(_updateFileRefMenu, 140); };
  const _closeFileRef = () => { CS.fileRef.open = false; const m = document.getElementById('fileref-menu'); if (m) m.remove(); };
  const _updateFileRefMenu = async () => {
    const ta = document.getElementById('composer-text');
    if (!ta || !_fsProjectId()) { _closeFileRef(); return; }
    const pos = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, pos);
    const m = before.match(/@([\w./-]*)$/);
    if (!m) { _closeFileRef(); return; }
    const token = m[1] || '';
    const start = pos - token.length - 1;
    const slash = token.lastIndexOf('/');
    const dir = slash >= 0 ? token.slice(0, slash) : '';
    const frag = slash >= 0 ? token.slice(slash + 1) : token;
    const entries = await _fsListDir(dir);
    const items = entries.filter(x => x.name.toLowerCase().startsWith(frag.toLowerCase())).slice(0, 8);
    Object.assign(CS.fileRef, { open: items.length > 0, mode: 'text', items, active: 0, start, token: '@' + token, query: token, dir });
    _renderFileRefMenu();
  };
  const _renderFileRefMenu = () => {
    const fr = CS.fileRef;
    const ta = document.getElementById('composer-text');
    let el = document.getElementById('fileref-menu');
    if (!fr.open || !ta) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'fileref-menu'; el.className = 'fileref-menu'; document.body.appendChild(el); }
    // btn 模式: 锚定工具条「文件」按钮; text 模式: 锚定输入框
    const btnMode = fr.mode === 'btn';
    const anchor = btnMode ? (document.querySelector('[aria-label="添加文件附件"]') || ta) : ta;
    // btn 模式在目录非空时首行给「返回上级」(不占 items 索引)
    const upRow = btnMode && fr.dir ? `<button type="button" class="fileref-item fileref-up" data-action="pick-fileref" data-up="1" data-path="${e(fr.dir)}" data-isdir="1">${i('back', '', 14)}<span class="fileref-name">.. 返回上级</span></button>` : '';
    const body = fr.items.length ? fr.items.map((it, idx) =>
      `<button type="button" class="fileref-item${idx === fr.active ? ' active' : ''}" data-action="pick-fileref" data-path="${e(it.path)}" data-isdir="${it.type === 'dir' ? 1 : ''}">${i(it.type === 'dir' ? 'folder' : 'file', '', 14)}<span class="fileref-name">${e(it.name)}</span>${it.type === 'dir' ? '<span class="tiny muted">目录</span>' : ''}</button>`
    ).join('') : '<div class="fileref-empty">空目录</div>';
    const head = btnMode
      ? '<div class="fileref-head">引用项目文件 · 当前 ' + e(fr.dir || '项目根目录') + ' · ↑↓ 选择 · Enter 确认</div>'
      : '<div class="fileref-head">引用项目文件 · ↑↓ 选择 · Enter 确认</div>';
    el.innerHTML = head + upRow + body;
    // 定位: 先渲染出实际高度再放在锚点上方, 留 8px 间隙防止压住按钮/输入框
    const r = anchor.getBoundingClientRect();
    el.style.left = Math.max(8, r.left) + 'px';
    el.style.top = Math.max(8, r.top - el.offsetHeight - 8) + 'px';
    el.style.minWidth = Math.max(240, Math.min(430, r.width * 0.6)) + 'px';
  };
  const _applyFileRefPick = async (path, isDir, up) => {
    const ta = document.getElementById('composer-text'); const fr = CS.fileRef;
    if (!ta) return;
    // btn 模式: 目录切换浏览, 文件则把 @路径 插进输入框光标处
    if (fr.mode === 'btn') {
      if (isDir) {
        const dir = up ? (path ? path.split('/').slice(0, -1).join('/') : '') : path;
        Object.assign(fr, { dir, items: await _fsListDir(dir), active: 0 });
        _renderFileRefMenu();
        return;
      }
      _closeFileRef();
      const pos = ta.selectionStart ?? ta.value.length;
      const insert = '@' + path + ' ';
      ta.value = ta.value.slice(0, pos) + insert + ta.value.slice(pos);
      CS.ui.composer = ta.value;
      const send = document.querySelector('.send-button');
      if (send) send.disabled = !ta.value.trim();
      try { ta.setSelectionRange(pos + insert.length, pos + insert.length); } catch {}
      ta.focus();
      return;
    }
    const insert = isDir ? '@' + path + '/' : '@' + path + ' ';
    ta.value = ta.value.slice(0, fr.start) + insert + ta.value.slice(fr.start + fr.token.length);
    CS.ui.composer = ta.value;
    const send = document.querySelector('.send-button');
    if (send) send.disabled = !ta.value.trim();
    const caret = fr.start + insert.length;
    ta.focus();
    try { ta.setSelectionRange(caret, caret); } catch {}
    if (isDir) { Object.assign(fr, { query: path, token: '@' + path, start: fr.start }); _updateFileRefMenu(); }
    else { fr.open = false; _renderFileRefMenu(); }
  };

  const sendChatMessage = async (run, text, datasetIds, opts = {}) => {
    // 分页加载未完成时不放行: 契约/压缩卡可能还在后页, 半份历史会让模型
    // 基于截断上下文接续
    if (CS.ui.loadingRunId === run.id) { CS.toast('会话内容仍在加载，稍候再发送。', 'error'); return; }
    // pi 式引导(steering): 本会话仍有流式回复在跑时, 新消息不再并发开第二个
    // chat.send(两条回复交叉), 而是排进服务端 steer 队列 —— agent 在当前
    // 工具批/回合结束后把它注入上下文继续。user 消息由 journal 回显
    // (chat.steer 事件 → onSteer)统一渲染, 此处不本地预插避免双写。
    // 刷新恢复早期(3s 存档轮询尚未把 streaming 行补挂)以 run.status==='running'
    // 兜底; 误判时服务端回"没有正在进行的回复"走 noSteer 回退正常发送
    if (!opts.noSteer && (run.messages.some(m => m.streaming) || run.status === 'running')) {
      const r2 = await CS.api.steer(run.id, text);
      if (r2.ok) {
        const attachLeft = (CS.ui.pendingUploads || []).some(u => u.status === 'done');
        CS.toast('已插入引导消息：当前工具/回合结束后送达模型。' + (attachLeft ? '（附件不随引导发送，已保留待下次发送）' : ''), 'info');
      } else if (/没有正在进行/.test(r2.error || '')) {
        // 竞态窗口: 流式标记刚清但本轮竞态抢进 —— 回退为普通发送
        return sendChatMessage(run, text, datasetIds, { ...opts, noSteer: true });
      } else {
        // 失败不吞输入: 文本退回输入框 —— 用户若已开始打下一段话, 原文拼在
        // 前面而不是整体覆盖(覆盖会丢新输入)
        CS.ui.composer = text + (CS.ui.composer.trim() ? '\n' + CS.ui.composer : '');
        CS.render();
        CS.toast('引导发送失败：' + (r2.error || '未知错误') + '，原文已退回输入框。', 'error');
      }
      return;
    }
    // 真实流式开始: 停掉刷新恢复用的存档轮询, 避免双源互写
    if (CS._streamPoll) { clearInterval(CS._streamPoll.timer); CS._streamPoll = null; }
    // 上传附件以零宽字符标记(\u200B@path)注入消息尾部: 模型可读路径,
    // 服务端归档保留(刷新后芯片可重建), 展示层剥离标记不显示裸路径
    const _zwRef = (CS.ui.pendingUploads || []).filter(u => u.status === 'done' && u.path).map(u => '\u200B@[[' + u.path + ']]');
    if (_zwRef.length) { text = (text ? text.replace(/\s+$/, '') + ' ' : '') + _zwRef.join(' '); CS.ui.pendingUploads = []; CS._persistUploads(); }
    // 隐形续接(压缩完成后): 不插可见用户消息, 历史以压缩摘要卡结尾,
    // 服务端契约把摘要卡组装为 user 末条, 模型基于摘要直接开始下一轮
    if (!opts.hiddenContinue) run.messages.push({ role: 'user', content: text, datasetIds: [...datasetIds], at: new Date().toISOString() });
    // @file 引用注入: @路径 在项目目录下读出文件内容, 作为 refContext 附在发送侧
    // (展示仍用原文; 刷新后 refContext 不持久, 模型可再用 read 工具读文件)
    const _lastUser = run.messages[run.messages.length - 1];
    if (_lastUser && _lastUser.role === 'user' && (/\u200B@\[\[[^\]]*\]\]/.test(text) || /@[/~]?[\w][\w./-]*/.test(text))) {
      try {
        const pid = run.projectId || CS.state.projectId;
        {
          // 括号标记(上传附件, 路径可含空格) + 手动 @引用(无空格) 双格式解析
          const bracket = (text.match(/\u200B@\[\[[^\]]*\]\]/g) || []).map(t => t.slice(4, -2));
          const plain = (text.match(/@[/~]?[\w][\w./-]*/g) || []).map(t => t.slice(1));
          const tokens = [...new Set([...bracket, ...plain])].slice(0, 5);
          const parts = [];
          const images = [];
          for (const t of tokens) {
            try {
              const absT = /^[/~]/.test(t);
              if (!absT && !pid) continue;  // 相对引用需要项目; 绝对路径(暂存上传)无项目也可读
              const qs = (absT ? '' : 'projectId=' + encodeURIComponent(pid) + '&') + 'path=' + encodeURIComponent(t);
              const data = await CS.api.request('/fs/file?' + qs, { method: 'GET' });
              if (data && data.kind === 'image' && data.dataUrl && images.length < 4) {
                // 多模态: 图片以 dataUrl 附在消息上(模型按 image_url 内容块收到原图)
                images.push(data.dataUrl);
              } else if (data && !data.binary && typeof data.content === 'string' && data.content.trim()) {
                parts.push('<file path="' + t + '">\n' + data.content.slice(0, 16000) + (data.content.length > 16000 ? '\n…(内容过长已截断)' : '') + '\n</file>');
              }
            } catch {}
          }
          if (parts.length) _lastUser.refContext = '<referenced-files>\n用户在消息中引用了以下项目文件, 内容如下:\n' + parts.join('\n') + '\n</referenced-files>';
          if (images.length) _lastUser.images = images;
        }
      } catch {}
    }
    // blocks: 按到达顺序的时间线段(think/tool/text), loop 会话里多轮交替不会互相覆盖;
    // content/reasoning/tools 是从 blocks 汇出的镜像, 兼容历史/持久化/复制等旧读方
    // 流式可见性: 用户正停在哪个会话由 currentRunId 决定。切走后分片继续
    // 写 reply(数据不丢), 但不触发整页重渲染 —— 否则后台会话的流式分片会以
    // 8 次/秒的频率整页重建 innerHTML, 侧栏按钮在 mousedown 与 click 之间被
    // 销毁, 表现为"会话点击没反应/切换不回来"
    const visible = () => CS.state.currentRunId === run.id && CS.ui.route === 'chat';
    const mirror = () => CS.liveBlocks.mirror(reply);
    const pushThink = think => CS.liveBlocks.pushThink(reply, think);
    const pushDelta = delta => CS.liveBlocks.pushDelta(reply, delta);
    const pushTool = (t, reqId) => CS.liveBlocks.pushTool(reply, run, t, reqId);
    const reply = { role: 'assistant', content: '', blocks: [], streaming: true, at: new Date().toISOString(), model: CS.state.settings.model || '默认模型' };
    run.messages.push(reply);
    CS.save(); CS.render();
    setTimeout(scrollToLatest, 20);
    let timerInterval = null;
    const finishTimer = () => {
      if (timerInterval) clearInterval(timerInterval);
      timerInterval = null;
      delete reply.streaming;
      reply.elapsed = Date.now() - new Date(reply.at).getTime();  // 总耗时(ms)
      if (reply.reasoning) reply.reasoningMs = Date.now() - new Date(reply.at).getTime();
      reply.at = new Date().toISOString();
      CS.ui.thinkingText = '';
    };
    try {
      const history = run.messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.role === 'user' && m.refContext ? m.content + '\n\n' + m.refContext : m.content, ...(m.role === 'user' && m.images?.length ? { images: m.images } : {}) }));
      timerInterval = setInterval(() => {
        if (!reply.streaming) { clearInterval(timerInterval); return; }
        // 流式期间上下文占用也在增长, 顺带同步圆环显示
        CS.updateContextRing();
        // 只匹配本轮的活跃计时元素(完成标签是 elapsed-done, 无 data-start)
        const el = document.querySelector('.elapsed-timer[data-start="' + CSS.escape(reply.at) + '"]');
        if (el) el.textContent = CS.elapsed(el.dataset.start);
        // 重试等待倒计时: 到点后文案切换为"正在重试", 首个 delta/think 会清掉整行
        document.querySelectorAll('.retry-countdown[data-until]').forEach(cd => {
          const left = Math.ceil((Number(cd.dataset.until) - Date.now()) / 1000);
          cd.textContent = left > 0 ? left + 's 后重试' : '正在重试…';
        });
        // 纯正文流没有结构变化, name 行不会因思考块出现而重渲染,
        // 需要在这里动态补建缺失的 ↓ 累计/token 速率标签。
        const downSel = '.tok-down[data-start="' + CSS.escape(reply.at) + '"]';
        const down = document.querySelector(downSel);
        if (reply.tokens) {
          if (down) down.textContent = '↓ ' + CS.num(reply.tokens);
          else if (el) el.insertAdjacentHTML('beforebegin', `<span class="tok-down" data-start="${reply.at}">↓ ${CS.num(reply.tokens)}</span>`);
        }
        const rateSel = '.tok-rate[data-start="' + CSS.escape(reply.at) + '"]';
        const rate = document.querySelector(rateSel);
        const rateText = CS.tokRateText(reply);
        if (rate) { if (rateText) rate.textContent = rateText; }
        else if (rateText && el) el.insertAdjacentHTML('afterend', `<span class="tok-rate" data-start="${reply.at}">${rateText}</span>`);
      }, 1000);
      CS.ui.thinkingText = '';
      // 流式期间的实时 tok 估算: CJK 约 1 token/字, 其他约 4 字符/token。
      // 只用于生成中的实时标签, 完成后被服务端真实 usage 覆盖。
      const estTokens = s => {
        const cjk = (s.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
        return cjk + (s.length - cjk) / 4;
      };
      const toolEvent = (t, reqId) => {
        if (CS.ui.chatRetry) CS.ui.chatRetry = null;  // 已有产出, 不再处于重试等待
        pushTool(t, reqId);
        mirror();
        CS.save();  // 流式中途刷新会丢失工具/ask 块, 每个工具事件落盘一次
        const follow = visible() && nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false;
        if (visible()) CS.render();
        if (follow) scrollToLatest();
      };
      // 模型请求失败进入重试: 在等待指示处显示第 N/5 次失败与原因(间隔随次数递增)
      // 发新请求前先清上一轮残留, 否则上一会话的失败状态会在等待期错误显示
      if (CS.ui.chatRetry) { CS.ui.chatRetry = null; }
      const retryEvent = r => {
        if (!r || !r.attempt) return;
        CS.ui.chatRetry = { runId: run.id, attempt: r.attempt, total: r.total || 5, error: r.error || '', waitUntil: Date.now() + (r.wait || 0) * 1000 };
        if (visible()) CS.render();
      };
      // 引导插话回显: journal 的 chat.steer 事件把 user 消息送进消息流
      // (发送者与其他订阅端同一条路径; 回放/续播去重按内容)
      const steerEvent = sd => {
        const txt = String(sd.text || '');
        if (!txt) return;
        // 按 steerId 去重: journal 回显与断线重放会各送达一次; 同一文本引导
        // 多次时各是不同 id, 各自渲染(内容去重会把第二条吞掉, 刷新后又出现)
        const sid = String(sd.id || '');
        const dupRow = sid && run.messages.some(m2 => m2.steerId === sid);
        const dupBlk = sid && reply.blocks.some(b2 => b2 && b2.type === 'steer' && b2.steerId === sid);
        if (sid && (dupRow || dupBlk)) return;
        // 引导消息内嵌进回复块时间线: 显示在插入时刻的位置(其后的回应段之前),
        // 把一轮回复视觉上分成两段 —— 而不是追加在整轮回复之后(那会让分割点
        // 错位到下一轮)。无流式 reply(罕见, 极端时序)时退回独立消息形态
        if (reply && reply.streaming) {
          reply.blocks.push({ type: 'steer', text: txt, ...(sid ? { steerId: sid } : {}), at: sd.at || new Date().toISOString() });
          CS.liveBlocks.mirror(reply);
        } else {
          run.messages.push({ role: 'user', content: txt, steering: true, ...(sid ? { steerId: sid } : {}), at: sd.at || new Date().toISOString() });
        }
        CS.save();
        if (CS.state.currentRunId === run.id && CS.ui.route === 'chat') CS.render();
      };
      const done = await CS.api.chat(history, delta => {
        if (CS.ui.chatRetry) CS.ui.chatRetry = null;
        pushDelta(delta);
        mirror();
        reply.tokens = (reply.tokens || 0) + estTokens(delta);
        const now = Date.now();
        if (visible() && now - _chatRenderAt > 120) { _chatRenderAt = now; const follow = nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false; if (!updateStreamingDom(reply)) CS.render(); if (follow) scrollToLatest(); }
      }, think => {
        if (CS.ui.chatRetry) CS.ui.chatRetry = null;
        pushThink(think);
        mirror();
        reply.tokens = (reply.tokens || 0) + estTokens(think);
        CS.ui.thinkingText = reply.reasoning;
        const now = Date.now();
        if (visible() && now - _chatRenderAt > 120) { _chatRenderAt = now; const follow = nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false; if (!updateStreamingDom(reply)) CS.render(); if (follow) scrollToLatest(); }
      }, toolEvent, retryEvent, usage => {
        // 每轮模型调用后的累计 usage: 流式期间即时更新输入与缓存计数
        if (usage.promptTokens) {
          reply.promptTokens = usage.promptTokens;
          const now = Date.now();
          if (visible() && now - _chatRenderAt > 120) { _chatRenderAt = now; CS.render(); }
        }
        if (usage.cacheTokens != null) reply.cacheTokens = usage.cacheTokens;
      }, progress => {
        // 长工具心跳: 保活为主; 在正在运行的工具卡标题行内联更新「已运行 Xs」(直接 DOM, 不触发 render)
        const running = [...reply.blocks].reverse().find(b => b.type === 'tool' && b.result == null);
        if (!running) return;
        const sec = Math.max(1, Math.round(Number(progress.elapsed) || 0));
        const titleEl = document.querySelector('.think-root.tool-root[data-state="running"] .think-title');
        if (titleEl && !titleEl.querySelector('.tool-heartbeat')) {
          const span = document.createElement('span');
          span.className = 'tool-heartbeat';
          titleEl.appendChild(span);
        }
        const span = document.querySelector('.think-root.tool-root[data-state="running"] .tool-heartbeat');
        if (span) span.textContent = ` 已运行 ${sec}s`;
      }, sysText => {
        // 实发 system 提示词(服务端 bound 后的成品): 写入 run 供 Trace 页 #0 系统条展示
        if (sysText && run) { run.systemPrompt = sysText; CS.save(); }
      }, steerEvent);
      // HTTP 降级路径: 服务端在响应里带回压缩元数据, 复用插卡逻辑保持契约一致
      if (done.compaction && done.compaction.text) toolEvent(done.compaction);
      // 正文以流式时间线为准(保留各轮文本); 服务端最终内容仅在本地没收到任何文本时兑底
      if (!reply.content && typeof done.content === 'string' && done.content) {
        reply.content = done.content;
        // WS 断线后走 HTTP 同步接口的场景没有流式回调, blocks 里不会有文本段;
        // 兑底内容必须同时转成 text 块, 否则渲染出空消息
        if (!reply.blocks.some(b => b.type === 'text')) reply.blocks.push({ type: 'text', text: done.content });
      }
      if (done.tokens) reply.tokens = done.tokens;  // 真实 usage(含思考 token), 覆盖流式粗估
      if (done.promptTokens) reply.promptTokens = done.promptTokens;
      // 最后一轮当次 prompt(真实窗口占用): 供上下文圆环与 meta 行使用; 与累计 promptTokens 区分
      if (done.contextTokens) reply.contextTokens = done.contextTokens;
      if (done.cacheTokens) reply.cacheTokens = done.cacheTokens;
      CS.audio.playDone();  // 回复完成提示音; 出错分支不播放
    } catch (error) {
      const msg = CS.api.friendlyError(error);
      // 互斥拒绝自动转引导: 刷新恢复窗口/双标签页等场景下, 普通发送撞上服务端
      // "该会话已有回复正在生成" —— 不渲染错误块, 本地回滚刚推入的 user 消息与
      // reply(服务端互斥检查在 user 行落库之前, 存档干净), 文本原样转 chat.steer
      if (/已有回复正在生成/.test(String(error?.message || msg))) {
        const ui2 = run.messages.indexOf(_lastUser);
        const ri2 = run.messages.indexOf(reply);
        if (ri2 >= 0) run.messages.splice(ri2, 1);
        if (ui2 >= 0) run.messages.splice(ui2, 1);
        finishTimer();
        CS.save();
        const r3 = await CS.api.steer(run.id, text);
        if (r3.ok) {
          CS.toast('该会话已有回复在生成，已转为引导消息插入。', 'info');
          if (CS.state.currentRunId === run.id && CS.ui.route === 'chat') CS.render();
          // 不做整表归档: steer 行刚由服务端落库, journal 回显未到达时本地表
          // 不含它, 整表 upsert 会把服务端的 steer 行抹掉(刷新后丢引导消息)
          return;
        }
        // steer 也失败: 回滚无效, 走正常错误呈现(消息重新推回)
        run.messages.push({ role: 'user', content: text, datasetIds: [...datasetIds], at: new Date().toISOString() });
        run.messages.push(reply);
        reply.streaming = true;
      }
      if (error && (error.silent || String(error.message || '').includes('无法续播'))) {
        // 服务端 journal 已失效(容量淘汰/服务重启)或深度离线: 不把会话
        // 定格成错误——任务结果由服务端兑底归档兜底, 从存档静默合并最新
        // 内容即可; 已流出的部分正文原样保留
        CS.toast('后台任务结果已存档，已从服务端同步最新内容。', 'info');
        try { await loadRemoteConversation(run.id); } catch {}
        reply.error = null;
      } else {
        // 失败不再伪装成正文追在 content 里, 而是挂到 error 字段,
        // 由红色错误块呈现(可展开看详情), 已流出的部分正文保持原样
        reply.error = { message: msg, detail: error?.stack ? (msg + '\n\n' + error.stack) : msg };
      }
    }
    finishTimer();
    reply.blocks = reply.blocks.filter(b => b.type === 'tool' || b.type === 'ask' || b.type === 'deliverables' || b.type === 'present' || b.type === 'webview' || !!b.text);  // 丢弃中途产生的空段
    CS.save(); CS.render();
    if (!CS.ui.followLock && CS.state.settings.autoScroll !== false) setTimeout(scrollToLatest, 20);  // 用户暂停跟随或关闭自动滚动时不拽到底部
    syncConversation(run);
    // 首轮回复完成后用 LLM 生成会话标题(dsh session-title-llm 思路):
    // 失败静默保留兜底标题, 不重试不阻塞
    if (!run.titleGenerated) {
      run.titleGenerated = true;
      const firstUser = (run.messages.find(m => m.role === 'user') || {}).content || '';
      CS.api.request('/conversations/' + encodeURIComponent(run.id) + '/title', { method: 'POST', timeout: 25000, body: JSON.stringify({ modelId: CS.state.settings.modelId, prompt: firstUser, reply: (reply.content || '').slice(0, 400) }) })
        .then(t => { if (t && t.title) { run.title = t.title; const c = CS.ui.conversations.find(x => x.id === run.id); if (c) c.title = t.title; CS.save(); CS.render(); } })
        .catch(() => {});
    }
  };
  const openNewTask = (prompt, workflowId = 'singlecell', ids = []) => {
    const run = CS.agent.create(prompt, workflowId, ids, { organism: CS.ui.organism, minGenes: Number(CS.ui.minGenes), maxMito: Number(CS.ui.maxMito), synthetic: true });
    CS.ui.composer = ''; CS.ui.attachments = []; CS.ui.expandedLogs.clear();
    CS.closeModal(); CS.navigate('chat');
    CS.agent.registerConversation(run);
  };
  const inferWorkflow = prompt => /文献|论文|综述|literature|paper/i.test(prompt) ? 'literature' : /格式|质控|缺失|quality/i.test(prompt) ? 'quality' : /拟南芥|转录组|rnaseq|RNA-seq/i.test(prompt) && !/单细胞/.test(prompt) ? 'rnaseq' : 'singlecell';
  const copyText = async text => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.left = '-9999px'; document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); if (!ok) throw new Error('浏览器阻止复制，请改用文件导出。'); }
    CS.toast('已复制到剪贴板。');
  };
  const citation = p => `${p.authors} (${p.year}). ${p.title}. ${p.journal}. https://doi.org/${p.doi}`;
  CS.enterAccount = (out, message) => {
    // 账号切换: 清掉上个用户的本地工作区缓存再重新加载; reset 会恢复 defaults
    // (含 me: null 与默认 endpoint), 所以 reset 之后再写入 me 与实际接口地址
    const keepEndpoint = CS.state.settings.endpoint;
    CS.reset();
    CS.state.settings.endpoint = keepEndpoint;
    CS.state.me = out;
    CS.ui.composer = ''; CS.ui.attachments = []; CS.save();
    CS.navigate('home');
    if (message) CS.toast(message);
  };
  // 微信扫码: 服务端签发跳转地址, 弹窗完成扫码后由回跳页换发会话
  // 微信弹窗回跳页换票成功后通知主窗进入工作区
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.type === 'wechat-login-ok' && event.data.user && event.data.user.name) {
      CS.enterAccount({ mode: 'multi', user: event.data.user }, `欢迎，${event.data.user.name}。`);
    }
  });

  // 多用户模式: 未登录时的统一入口, 跳转完整登录/注册页面 rather than 浮层。
  CS.showAuthGate = () => {
    const me = CS.state.me;
    if (me && me.mode === 'multi' && !(me.user && me.user.name)) {
      if (CS.ui.modal) CS.closeModal();
      if (CS.ui.route !== 'auth') CS.navigate('auth');
    }
  };
  CS.handleAuthLoss = () => {
    const me = CS.state.me;
    if (me && me.mode === 'multi' && me.user && me.user.name) {
      CS.state.me = { mode: 'multi', user: null };
      CS.toast('登录已过期，请重新登录。', 'error');
    }
    CS.showAuthGate();
  };
  CS.showModal = (type, payload = {}) => {
    modalReturnFocus = document.activeElement;
    CS.ui.modal = { type, ...payload };
    CS.renderModal();
    const app = document.getElementById('app'); app.inert = true; app.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { document.querySelector('.modal input:not([type=hidden]), .modal textarea, .modal button')?.focus(); }, 30);
  };
  CS.closeModal = () => {
    if (!CS.ui.modal) return;
    CS.ui.modal = null; document.getElementById('modal-root').innerHTML = '';
    document.getElementById('app').inert = false; document.getElementById('app').removeAttribute('aria-hidden');
    document.body.style.overflow = '';
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus({ preventScroll: true });
  };
  CS.renderModal = () => {
    const modal = CS.ui.modal; if (!modal) return;
    let title = '', body = '', footer = '', wide = false;
    if (modal.type === 'fs-preview') {
      title = modal.name || '文件预览'; wide = true;
      const kind = modal.kind || 'text';
      const pk = modal.presentKlass;
      if (modal.presenting && pk === 'audio' && modal.dataUrl) {
        body = `<div class="modal-pad" style="text-align:center"><div class="row-between mb-20"><span class="small muted mono">${e(modal.path || '')}</span><span class="small muted">${CS.formatBytes(modal.size)}</span></div><audio controls src="${modal.dataUrl}" style="width:100%"></audio></div>`;
      } else if (modal.presenting && pk === 'video' && modal.dataUrl) {
        body = `<div class="modal-pad"><div class="row-between mb-20"><span class="small muted mono">${e(modal.path || '')}</span><span class="small muted">${CS.formatBytes(modal.size)}</span></div><video controls src="${modal.dataUrl}" style="width:100%;max-height:62vh;border-radius:8px;background:#111"></video></div>`;
      } else if (modal.presenting && pk === 'html' && modal.dataUrl) {
        body = `<div class="modal-pad"><div class="row-between mb-20"><span class="small muted mono">${e(modal.path || '')}</span><span class="small muted">${CS.formatBytes(modal.size)}</span></div><iframe src="${modal.dataUrl}" sandbox="allow-scripts" style="width:100%;height:62vh;border:1px solid #d9dde5;border-radius:8px;background:#fff"></iframe></div>`;
      } else if (modal.presenting && pk === '3d' && modal.dataUrl) {
        body = `<div class="modal-pad"><div class="row-between mb-20"><span class="small muted mono">${e(modal.path || '')}</span><span class="small muted">${CS.formatBytes(modal.size)}</span></div><div id="present-3d-stage" class="present-3d-stage"></div></div>`;
        setTimeout(() => { try { CS.mountPresent3D('present-3d-stage', modal.dataUrl); } catch {} }, 40);
      } else {
      const metaBar = `<div class="row-between mb-20"><span class="small muted mono">${e(modal.path || '')}</span><span class="small muted">${kind !== 'text' && kind !== 'binary' ? e(String(kind).toUpperCase() + ' · ') : ''}${CS.formatBytes(modal.size)}</span></div>`;
      if (kind === 'pdf' && modal.dataUrl) {
        body = `<div class="modal-pad">${metaBar}<iframe src="${modal.dataUrl}" title="${e(modal.name || 'pdf')}" style="width:100%;height:66vh;border:0;border-radius:8px;background:#fff"></iframe>${modal.note ? `<p class="small muted mt-8">${e(modal.note)}</p>` : ''}</div>`;
      } else if (kind === 'image' && modal.dataUrl) {
        body = `<div class="modal-pad" style="text-align:center">${metaBar}<img src="${modal.dataUrl}" alt="${e(modal.name || '')}" style="max-width:100%;max-height:60vh;border-radius:8px" />${modal.note ? `<p class="small muted mt-8">${e(modal.note)}</p>` : ''}</div>`;
      } else if (kind === 'markdown' && !modal.binary) {
        body = `<div class="modal-pad">${metaBar}<div class="md-body fs-md" style="max-height:62vh;overflow:auto">${CS.markdown(modal.content || '')}</div>${modal.truncated ? '<p class="small muted mt-12">内容过大，仅显示前 512 KB。</p>' : ''}</div>`;
      } else if ((kind === 'json' || kind === 'jsonl') && !modal.binary) {
        let pretty = modal.content || '';
        try {
          if (kind === 'json') pretty = JSON.stringify(JSON.parse(pretty), null, 2);
          else pretty = pretty.trim().split('\n').filter(Boolean).map(l => JSON.stringify(JSON.parse(l), null, 2)).join('\n');
        } catch { /* 解析失败按原文高亮 */ }
        body = `<div class="modal-pad">${metaBar}<pre class="code-view" style="max-height:62vh;overflow:auto;margin:0">${CS.fsHighlight(pretty, 'json')}</pre>${modal.truncated ? '<p class="small muted mt-12">内容过大，仅显示前 512 KB。</p>' : ''}</div>`;
      } else if (kind === 'code' && !modal.binary) {
        body = `<div class="modal-pad">${metaBar}<pre class="code-view" style="max-height:62vh;overflow:auto;margin:0">${CS.fsHighlight(modal.content || '', modal.lang || '')}</pre>${modal.truncated ? '<p class="small muted mt-12">内容过大，仅显示前 512 KB。</p>' : ''}</div>`;
      } else if (modal.binary) {
        body = `<div class="modal-pad"><p class="small muted">二进制文件（${CS.formatBytes(modal.size)}），不支持预览。${modal.note ? e(modal.note) : ''}</p></div>`;
      } else {
        body = `<div class="modal-pad">${metaBar}<pre style="max-height:62vh;overflow:auto;margin:0">${e(modal.content || '')}</pre>${modal.truncated ? '<p class="small muted mt-12">内容过大，仅显示前 512 KB。</p>' : ''}</div>`;
      }
      }
    } else if (modal.type === 'feedback') {
      // 消息反馈弹窗: 点赞/点踩共用, 类别随 rating 切换(dsh message-feedback 思路)
      const cats = modal.rating === 'up'
        ? ['有用', '准确', '清晰', '高效']
        : ['不准确', '不完整', '太慢', '格式混乱', '危险操作', '其他'];
      title = modal.rating === 'up' ? '点赞 · 这条回复好在哪？' : '点踩 · 这条回复出了什么问题？';
      body = `<div class="modal-pad stack">
        <div class="feedback-cats">${cats.map(c => `<button type="button" class="feedback-cat${modal.picked === c ? ' picked' : ''}" data-action="pick-feedback-cat" data-cat="${e(c)}">${e(c)}</button>`).join('')}</div>
        <textarea id="feedback-note" class="feedback-note" rows="3" maxlength="500" placeholder="补充说明（可选，不会发送给模型）">${e(modal.note || '')}</textarea>
        <p class="small muted">反馈仅用于改进模型与产品，不会进入对话上下文。</p>
      </div>`;
      footer = H.btn('submit-feedback', '提交反馈', 'check', 'primary');
    } else if (modal.type === 'import') {
      title = '添加研究数据';
      body = `<div class="dropzone" id="dropzone" data-dropzone><div class="upload-mark">${i('upload','',24)}</div><p>拖拽文件到这里，或${H.btn('pick-files','选择本地文件','','small-btn flat')}</p><span class="sub">CSV / TSV / FASTA / H5AD / FASTQ / MTX / JSON</span></div><div class="mt-20">${H.notice('导入仅在本地登记。文本预览最多读取 64 KB；不解压、不执行文件。二进制数据仅查看元信息。')}</div>${modal.imported?.length ? `<div class="mt-20 stack">${modal.imported.map(d => `<div class="row">${H.tile('file','green')}<div class="grow"><h3>${e(d.name)}</h3><span class="small muted">${CS.formatBytes(d.size)} · 已在本地登记</span></div>${i('checkcircle','',17)}</div>`).join('')}</div>` : ''}`;
      footer = H.btn('close-modal','完成','check','primary');
    } else if (modal.type === 'dataset-picker') {
      title = '将数据加入研究上下文';
      body = `<p class="small muted mb-20">选择数据记录，附加到当前问题。演示执行不上传原始文件。</p>${CS.state.datasets.map(d => `<button class="dataset-picker-row" data-action="pick-dataset" data-id="${e(d.id)}">${H.tile(d.format === 'H5AD' ? 'cells' : 'file')}<div class="grow"><strong>${e(d.name)}</strong><p>${e(d.format)} · ${d.source === 'demo' ? '合成演示' : '本地导入'}</p></div>${i(CS.ui.attachments.includes(d.id) ? 'checkcircle' : 'plus','',17)}</button>`).join('')}`;
    } else if (modal.type === 'agent-tools' || modal.type === 'agent-skills') {
      // 会话工具/技能只读展示: 与设置页启用状态一致, 禁用的不显示; 提供入口跳设置
      const isTools = modal.type === 'agent-tools';
      title = isTools ? '会话工具' : '会话技能';
      const rows = ((isTools ? CS.ui.agentTools : CS.ui.agentSkills) || []).filter(t => t.enabled);
      const item = (name, desc, badge) => `<div class="session-list-item"><div class="row gap-6"><strong>${e(name)}</strong>${badge || ''}</div><span class="small muted">${e(desc)}</span></div>`;
      let list;
      if (isTools) {
        // 与设置页同规则分组排序: 内置三类固定顺序, MCP 按配置顺序
        const GROUP_LABELS = { builtin: '内置工具 · 基础', sciverse: '内置工具 · Sciverse', arxiv: '内置工具 · arXiv' };
        const GROUP_ORDER = { builtin: 0, sciverse: 1, arxiv: 2 };
        const groups = [];
        for (const t of rows) {
          const origin = t.origin || 'builtin';
          let g = groups.find(x => x.origin === origin);
          if (!g) groups.push(g = { origin, label: GROUP_LABELS[origin] || `MCP · ${origin}`, rank: GROUP_ORDER[origin] ?? 3, items: [] });
          g.items.push(t);
        }
        groups.sort((a, b) => a.rank - b.rank);
        list = groups.map(g => `<div class="session-list-group">${e(g.label)}<span class="count">${g.items.length} 个工具</span></div>${g.items.map(t => item(t.name, t.description)).join('')}`).join('');
      } else {
        list = rows.map(s => item(s.name, s.description, s.builtin ? '<span class="pill green">内置</span>' : '')).join('');
      }
      const empty = rows.length ? '' : H.notice(isTools ? '当前没有启用的工具。可在设置的 Agent 工具里开启。' : '当前没有启用的技能。可在设置的 Agent 技能里开启。');
      body = `<p class="small muted mb-20">${isTools ? '当前对话 Agent 可调用的工具, 与设置页“Agent 工具”的启用状态一致; 禁用的工具不会发给模型、也不占用上下文。' : '当前对话 Agent 可用的技能; 技能清单作为系统提示词的一部分自动附加, 禁用的技能不进入会话、不占用上下文。'}</p>${empty}<div class="session-list">${list}</div>`;
      footer = `${H.btn(isTools ? 'open-tool-settings' : 'open-skill-settings','打开设置','settings','flat')}${H.btn('close-modal','关闭','','flat')}`;
    } else if (modal.type === 'project') {
      const p = modal.project || {}; title = p.id ? '编辑研究项目' : '新的研究，从这里开始';
      body = `<form id="project-form" data-form="project"><div class="field"><label for="project-name">项目名称</label><input id="project-name" name="name" value="${e(p.name || '')}" placeholder="例如 immune_cell_atlas" maxlength="60" required autocomplete="off"></div><div class="field"><label for="project-dir">项目目录</label><div class="dir-row"><input id="project-dir" value="${e(CS.ui.modal.pickedDir || p.dir || '')}" placeholder="选择文件夹，或输入名称后使用默认路径" readonly autocomplete="off"><button type="button" class="btn small-btn" data-action="browse-dir">浏览</button></div><div id="dir-listing"></div><span class="hint">选择文件夹后以其名称作为项目名；只填名称时使用默认路径下的同名文件夹。</span></div><div class="field"><label for="project-description">项目描述</label><textarea id="project-description" name="description" placeholder="这个项目希望回答什么问题？" rows="3" maxlength="240">${e(p.description || '')}</textarea></div><div class="field"><label for="project-tags">标签</label><input id="project-tags" name="tags" value="${e((p.tags || []).join(', '))}" placeholder="单细胞, 文献, 方法" maxlength="100"><span class="hint">用英文或中文逗号分隔，最多 5 个标签。</span></div></form>`;
      footer = `${p.id ? H.btn('archive-project',p.archived ? '恢复项目' : '归档项目','folder','flat',`data-id="${e(p.id)}"`) : ''}${H.btn('close-modal','取消','','flat')}<button class="btn primary" type="submit" form="project-form">${i('check','',15)} 保存项目</button>`;
    } else if (modal.type === 'remote-project') {
      title = '连接远程项目';
      body = `<form id="remote-project-form" data-form="remote-project"><div class="field"><label for="remote-project-name">项目名称</label><input id="remote-project-name" name="name" placeholder="例如 team_shared_atlas" maxlength="60" required autocomplete="off"></div><div class="field"><label for="remote-project-address">远程地址</label><input id="remote-project-address" name="address" placeholder="https://sigmaflow.example.org/share/…" spellcheck="false"></div><span class="hint">连接后项目会列在本机项目列表中，数据仍保存在远端。</span></form>`;
      footer = `${H.btn('close-modal','取消','','flat')}<button class="btn primary" type="submit" form="remote-project-form">${i('external','',15)} 连接</button>`;
    } else if (modal.type === 'preview') {
      title = modal.dataset.name; wide = true;
      body = `<div class="row gap-6 mb-20">${H.pill(modal.dataset.format)}${H.pill(CS.formatBytes(modal.dataset.size))}${H.pill(modal.dataset.source === 'demo' ? '演示数据' : '本地文件',modal.dataset.source === 'demo' ? 'purple' : 'green')}</div>${modal.loading ? '<p class="muted">正在读取本地预览…</p>' : modal.table ? `<div class="table-wrap"><table><thead><tr>${modal.table[0].map(col => `<th>${e(col)}</th>`).join('')}</tr></thead><tbody>${modal.table.slice(1).map(row => `<tr>${row.map(col => `<td title="${e(col)}">${e(col)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="tiny muted mt-12">显示 ${Math.max(0,modal.table.length-1)} 行数据 · 最多预览前 100 行 / 64 KB，不代表完整文件。</p>` : modal.text !== undefined ? `<div class="file-preview"><pre>${e(modal.text)}</pre></div>` : H.notice(modal.message || '此格式仅登记文件元信息。请接入专用后端后进行矩阵解析。')}<div class="mt-20">${H.notice(modal.dataset.description || '已在本地导入的研究文件。')}</div>`;
      footer = `${H.btn('attach-preview','加入新对话','plus','primary',`data-id="${e(modal.dataset.id)}"`)}${H.btn('close-modal','关闭','','flat')}`;
    } else if (modal.type === 'note') {
      title = '文献阅读笔记';
      const p = CS.data.papers.find(p => p.id === modal.id);
      body = `<p class="small muted mb-20">${e(p.title)}</p><form id="note-form" data-form="note"><textarea id="paper-note-text" class="note-editor" maxlength="10000" placeholder="记录你的阅读思考、证据局限与待验证问题…">${e(CS.state.notes[modal.id] || '')}</textarea></form><p class="tiny faint mt-12">笔记仅在本机保存，不自动发送到模型。</p>`;
      footer = `<button class="btn primary" form="note-form" type="submit">${i('check','',15)} 保存笔记</button>`;
    } else if (modal.type === 'fs-input') {
      // 文件浏览器右键操作的输入弹窗(重命名/移动/复制/新建): 回车提交, 校验在 confirm handler
      title = modal.title;
      body = `<p class="confirm-text">${e(modal.label || '')}</p><input id="fs-op-input" class="text-input mono" style="width:100%" value="${e(modal.value || '')}" placeholder="${e(modal.placeholder || '')}" autocomplete="off" />`;
      footer = H.btn('close-modal','取消','','flat') + H.btn('confirm-fs-op', modal.confirmLabel || '确认','check','primary');
      const submit = () => { const btn = document.querySelector('.modal-footer [data-action="confirm-fs-op"]'); if (btn) btn.click(); };
      setTimeout(() => {
        const inp = document.getElementById('fs-op-input');
        if (inp) { inp.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } }; inp.select(); }
      }, 40);
    } else if (modal.type === 'confirm') {
      title = modal.title;
      body = `<p class="confirm-text">${e(modal.message)}</p>`;
      footer = H.btn('close-modal','取消','','flat') + H.btn(modal.confirmAction,modal.confirmLabel || '确认','check',modal.danger ? 'flat danger' : 'primary');
    } else if (modal.type === 'cell') {
      const p = CS.points.find(p => p.id === modal.id); const g = CS.data.groups[p.group];
      title = '合成细胞详情';
      body = `<div class="row mb-20">${H.tile('cells')}<div><h3>${e(p.id)}</h3><span class="small muted">${e(g.name)} · 合成数据点</span></div></div><div class="info-pairs"><span>分组</span><span>${e(g.name)}</span><span>显示坐标 X</span><span>${p.x.toFixed(2)}</span><span>显示坐标 Y</span><span>${p.y.toFixed(2)}</span><span>数据来源</span><span>synthetic-ui-fixture</span></div><div class="mt-20">${H.notice('坐标是用于界面展示的二维随机点，不是实际降维计算结果。')}</div>`;
    }
    document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><h2 id="modal-title">${e(title)}</h2>${H.iconBtn('close-modal', 'x', '关闭对话框')}</header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`;
  };

  const previewDataset = async id => {
    const dataset = CS.state.datasets.find(d => d.id === id); if (!dataset) return;
    CS.showModal('preview', { dataset, loading: true });
    let text, message;
    try {
      if (dataset.source === 'demo') {
        if (dataset.format === 'CSV') text = dataset.id === 'ds-plant' ? 'gene,control_1,control_2,control_3,condition_1,condition_2,condition_3\nDEMO_GENE_1,21,34,29,53,49,57\nDEMO_GENE_2,78,81,75,68,64,70\nDEMO_GENE_3,15,18,20,19,21,17\n' : CS.data.sampleCSV;
        else if (dataset.format === 'FASTA') text = CS.data.sampleFASTA;
        else message = '这是元信息示例，不包含真实二进制文件。查看分析结果可体验预设的合成图表。';
      } else if (!CS.files.has(id)) message = '页面刷新后，原始文件对象已释放。请重新导入相同文件以恢复预览；当前只保留元信息。';
      else if (/^(CSV|TSV|TXT|JSON|FASTA|FA|FASTQ|FQ)$/.test(dataset.format)) text = await CS.files.get(id).slice(0,65536).text();
      else message = '此格式仅登记元信息。为保护浏览器内存，本地演示不读取大型或二进制矩阵。';
      // An asynchronous file read must not reopen a dialog that the user already closed.
      if (CS.ui.modal?.type !== 'preview' || CS.ui.modal.dataset.id !== id) return;
      const result = { ...CS.ui.modal, loading: false, message };
      if (text !== undefined && ['CSV','TSV'].includes(dataset.format)) result.table = CS.parseCSV(text,dataset.format === 'TSV' ? '\t' : ',',101).rows;
      else if (text !== undefined) result.text = text;
      CS.ui.modal = result; CS.renderModal();
    } catch(error) { CS.toast('读取文件失败：'+error.message,'error'); CS.closeModal(); }
  };

  const handleFiles = async files => {
    const accepted = [];
    for (const file of [...files]) {
      const format = file.name.split('.').pop().toUpperCase();
      if (!['CSV','TSV','TXT','JSON','FASTA','FA','FASTQ','FQ','H5AD','H5','MTX','GZ'].includes(format)) { CS.toast(`不支持 ${file.name} 的文件格式。`,'error'); continue; }
      if (file.size > 2 * 1024 ** 3) { CS.toast('单文件超过 2 GB，请通过后端或专用客户端处理。','error'); continue; }
      if (file.size === 0) { CS.toast(`${file.name} 是空文件。`,'error'); continue; }
      if (CS.state.datasets.length >= 500) { CS.toast('本地工作空间最多保留 500 份文件记录。','error'); break; }
      let record = CS.state.datasets.find(d => d.source === 'local' && d.name === file.name && d.size === file.size && d.lastModified === file.lastModified);
      if (!record) {
        record = { id: CS.uid('ds'), name: file.name, format, size: file.size, source: 'local', projectId: CS.state.projectId, added: CS.today(), lastModified: file.lastModified, description: '本地导入文件；未上传，不执行文件内容。' };
        CS.state.datasets.push(record);
      }
      CS.files.set(record.id,file); accepted.push(record);
      if (uploadContext === 'attachment' && !CS.ui.attachments.includes(record.id)) CS.ui.attachments.push(record.id);
    }
    CS.save(); CS.render();
    if (accepted.length) {
      if (uploadContext === 'preview') await previewDataset(accepted[0].id);
      else if (CS.ui.modal?.type === 'import') { CS.ui.modal.imported = [...(CS.ui.modal.imported || []), ...accepted]; CS.renderModal(); }
      CS.toast(`已在本地登记 ${accepted.length} 份文件，未上传。`);
    }
  };
  const chooseFiles = context => { uploadContext = context; const input = document.getElementById('file-input'); input.value = ''; input.click(); };
  // 待发附件持久化: 上传后页面刷新/换标签页会让内存态清零, 附件凭空消失
  // (文件已在暂存区, 只是引用丢了)。落 localStorage, 启动时恢复; objectURL
  // 不可持久, 恢复项无缩略图(显示图标), 发送后消息内的图片预览不受影响。
  CS._persistUploads = () => {
    try {
      const rows = (CS.ui.pendingUploads || []).filter(u => u.status === 'done' && u.path).map(u => ({ name: u.name, size: u.size, status: 'done', path: u.path, thumb: '', error: '' }));
      localStorage.setItem('sigmaflow-science.pendingUploads', JSON.stringify(rows));
    } catch {}
  };
  CS._restoreUploads = () => {
    try {
      const raw = localStorage.getItem('sigmaflow-science.pendingUploads');
      if (!raw) return;
      const rows = JSON.parse(raw);
      if (Array.isArray(rows) && rows.length) CS.ui.pendingUploads = (CS.ui.pendingUploads || []).concat(rows.filter(r => r && r.path && !(CS.ui.pendingUploads || []).some(u => u.path === r.path)));
    } catch {}
  };
  CS._restoreUploads();
  // 本地文件上传(+号/粘贴): 文件进项目目录(/fs/upload, 同名自动改名), @引用
  // 插入输入框; 图片用 objectURL 做缩略图。上传中的附件会阻止发送。
  const uploadLocalFiles = async files => {
    CS.ui.pendingUploads = CS.ui.pendingUploads || [];
    const pid = CS.state.projectId;  // 无项目: 落用户暂存目录, 返回绝对路径
    for (const file of [...files]) {
      if (file.size > 32 * 1024 * 1024) { CS.toast(`${file.name} 超过 32 MB 上传上限。`, 'error'); continue; }
      if (file.size === 0) { CS.toast(`${file.name} 是空文件。`, 'error'); continue; }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const entry = { name: file.name, size: file.size, status: 'uploading', thumb: '', path: '', error: '' };
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) { try { entry.thumb = URL.createObjectURL(file); } catch {} }
      CS.ui.pendingUploads.push(entry);
      CS.render();
      try {
        const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error || new Error('读取失败')); r.readAsDataURL(file); });
        let name = file.name, out = null;
        for (let t = 0; t < 5 && !out; t++) {
          try { out = await CS.api.request('/fs/upload', { method: 'POST', body: JSON.stringify({ projectId: pid || '', name, dataBase64: dataUrl }) }); }
          catch (err) {
            const msg = CS.api.friendlyError(err);
            if (t < 4 && /已存在|exists/i.test(msg)) { const dot = file.name.lastIndexOf('.'); name = dot > 0 ? `${file.name.slice(0, dot)} (${t + 1}).${file.name.slice(dot + 1)}` : `${file.name} (${t + 1})`; continue; }
            throw err;
          }
        }
        entry.name = out.name; entry.path = out.path; entry.size = out.size; entry.status = 'done';
        CS._persistUploads();
        // 不往输入框插入 @引用(裸路径对用户是噪声): 附件由芯片展示, 发送时在
        // sendChatMessage 里以零宽字符标记(\u200B@path)静默注入消息内容
        const send = document.querySelector('.send-button'); if (send) send.disabled = !CS.ui.composer.trim() && !CS.ui.pendingUploads.some(u => u.status === 'done');
      } catch (err) {
        entry.status = 'error'; entry.error = CS.api.friendlyError(err);
        CS.toast(`${file.name} 上传失败：${entry.error}`, 'error');
      }
      CS._persistUploads();
      CS.render();
    }
  };
  const emitRender = () => { CS.save(); CS.render(); };
  const exportMetadata = () => {
    const rows = CS.state.datasets.filter(d => CS.ui.datasetSelection.has(d.id));
    if (!rows.length) return;
    const columns = ['name','format','size','source','added','projectId'];
    const text = [columns.join(','),...rows.map(d => columns.map(col => CS.csvCell(d[col])).join(','))].join('\r\n');
    CS.download('dataset_metadata.csv','\uFEFF'+text,'text/csv;charset=utf-8'); CS.toast('已导出所选文件元信息。');
  };
  const _loadDirListing = async path => {
    const box = document.getElementById('dir-listing');
    if (!box) return;
    box.innerHTML = '<p class="small muted">读取目录…</p>';
    try {
      const d = await CS.api.request('/fs/dirs?path=' + encodeURIComponent(path));
      CS.ui.projectsRoot = CS.ui.projectsRoot || d.root;
      box.dataset.parent = d.parent || '';
      box.dataset.path = d.path;
      box.innerHTML = `<div class="dir-list"><div class="dir-list-head"><span class="dir-list-path" title="${e(d.path)}">${'\u2066'}${e(d.path)}${'\u2069'}</span>`
        + (d.parent ? `<button type="button" class="text-button muted small" data-action="dir-parent">上一级</button>` : '')
        + `<button type="button" class="text-button muted small" data-action="dir-cancel">收起</button></div>`
      box.innerHTML = `<div class="dir-list"><div class="dir-list-head"><span class="dir-list-path" title="${e(d.path)}">${'\u2066'}${e(d.path)}${'\u2069'}</span>`
        + (d.parent ? `<button type="button" class="text-button muted small" data-action="dir-parent">上一级</button>` : '')
        + `<button type="button" class="text-button muted small" data-action="dir-cancel">收起</button></div>`
        + `<div class="menu-divider"></div>`
        + `<div class="dir-new-row"><input id="dir-new-name" placeholder="新建文件夹…" maxlength="120" autocomplete="off"><button type="button" class="btn small-btn" data-action="dir-create">新建</button></div>`
        + `<div class="menu-divider"></div>`
        + (d.error ? `<div class="dir-empty">${e(d.error)}</div>` : '')
        + (d.dirs.length ? `<div class="dir-list-body">${d.dirs.map(x => `<button type="button" class="dir-item" data-action="dir-navigate" data-id="${e(x.path)}">${i('folder','',14)}<span>${e(x.name)}</span></button>`).join('')}</div>` : (d.error ? '' : '<div class="dir-empty">此目录下没有子文件夹</div>'))
        + `<div class="menu-divider"></div><button type="button" class="btn small-btn dir-pick-btn" data-action="dir-pick" data-id="${e(d.path)}">选择此文件夹作为项目目录</button></div>`;
    } catch (err) {
      box.innerHTML = '<p class="small">读取目录失败：' + e(CS.api.friendlyError(err)) + '</p>';
    }
  };
  // 展开/收起思考或工具块: 全量重渲染后把被点击的行锚回原视口位置,
  // 否则上方同类块同时展开增高(展开态是全局的)会把点击行挤出视野。
  const _toggleAnchored = (row, mutate) => {
    const block = row?.closest('.msg-block');
    const idx = block ? [...block.parentElement.children].indexOf(block) : -1;
    const rowTop = row?.getBoundingClientRect().top;
    mutate();
    CS.render();
    if (!row || idx < 0) return;
    const freshConv = document.querySelector('.conversation');
    const freshBlock = freshConv?.children[idx];
    // 同一动作可能出现多行(每条消息可有多个思考/工具块), 用 data-id 精确定位被点击的那行,
    // 否则滚动补偿会以错误的行为基准, 表现为页面位置乱跳
    const sel = '[data-action="' + row.dataset.action + '"]' + (row.dataset.id != null ? '[data-id="' + CSS.escape(row.dataset.id) + '"]' : '');
    const freshRow = freshBlock ? freshBlock.querySelector(sel) : null;
    if (freshRow && freshConv) freshConv.scrollTop += freshRow.getBoundingClientRect().top - rowTop;
  };
  // ask 问题卡定位: bkey 形如 runId|msgIdx|blockIdx, 与时间线块渲染用的键一致
  const _askCtx = bkey => {
    const [runId, mi, bi] = String(bkey || '').split('|');
    const run = CS.state.runs.find(r => r.id === runId);
    const block = run?.messages?.[Number(mi)]?.blocks?.[Number(bi)];
    if (!block || block.type !== 'ask') return null;
    return { run, block };
  };
  const actions = {
    // 微信扫码登录: 服务端拿跳转地址并弹窗, 回跳页交换会话后发 message
    'wechat-login': async () => {
      const out = await CS.api.request('/auth/wechat/start');
      window.open(out.url, 'wechat_login', 'width=660,height=780');
      CS.toast('请在微信弹窗中扫码确认。');
    },
    'toggle-sidebar': () => { CS.ui.mobileSidebar = !CS.ui.mobileSidebar; CS.render(); },
    'toggle-sidebar-fold': () => { CS.ui.sidebarFolded = !CS.ui.sidebarFolded; CS.persistFoldBar(); CS.render(); },
    // ===== 虚拟细胞 =====
    'cell-pick': id => {
      const m = (CS.CELL_MODELS || []).find(x => x.key === id);
      if (!m) return;
      if (id === CS.ui.cellModel) return;
      CS.ui.cellModel = id;
      CS.render();
    },
    'cell-rotate': () => { CS.ui.cellAutoRotate = !CS.ui.cellAutoRotate; if (CS._cellViewer) CS._cellViewer.controls.autoRotate = CS.ui.cellAutoRotate; CS.render(); },
    'cell-reset-view': () => CS.cellViewerReset(),
    'cell-quick': id => { const ta = document.getElementById('cell-ask-text'); if (ta) { ta.value = id || ''; ta.focus(); } },
    'cell-ask': () => {
      const ta = document.getElementById('cell-ask-text');
      const q = (ta && ta.value || '').trim();
      if (!q) { CS.toast('请先输入要询问 Agent 的问题。', 'error'); return; }
      const m = (CS.CELL_MODELS || []).find(x => x.key === CS.ui.cellModel) || (CS.CELL_MODELS || [])[0];
      if (!m) return;
      // 带上模型上下文进入新会话, Agent 回答可追溯
      startChat(`【虚拟细胞 · ${m.name}】我正在观察${m.name}的三维结构模型(结构要点: ${m.tags.join('、')})。请回答: ${q}`);
    },
    'toggle-user-menu': () => { CS.ui.userMenu = !CS.ui.userMenu; CS.render(); },
    'auth-tab': (id, target) => {
      // 切换登录/注册会重绘表单; 先把已输入的内容存为草稿, 渲染后回填
      CS.ui.authDraft = { username: document.getElementById('auth-username')?.value || '', password: document.getElementById('auth-password')?.value || '' };
      CS.ui.authTab = target.dataset.tab === 'register' ? 'register' : 'login';
      CS.render();
      setTimeout(() => document.getElementById('auth-username')?.focus(), 30);
    },
    'toggle-model-menu': () => { CS.ui.modelMenu = !CS.ui.modelMenu; CS.render(); },
    'toggle-context-menu': () => { CS.ui.contextMenu = !CS.ui.contextMenu; CS.ui.modelMenu = false; CS.render(); },
    'pick-model': async id => {
      const model = CS.ui.models.find(x => x.id === id);
      if (!model) { CS.ui.modelMenu = false; CS.render(); return; }
      CS.state.settings.modelId = model.id; CS.state.settings.model = model.model;
      CS.ui.modelMenu = false; emitRender();
      try { await CS.api.modelCall('model.save', 'POST', '/models', { id: model.id, providerId: model.providerId, model: model.model, isDefault: true, contextWindow: model.contextWindow || null }); CS.agent.loadModels(); }
      catch (error) { CS.toast('切换默认模型失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'toggle-project-menu': () => { CS.ui.projectMenu = !CS.ui.projectMenu; CS.render(); },
    'clear-project': () => { CS.state.projectId = null; CS.ui.projectMenu = false; CS.save(); CS.render(); },
    'pick-project': id => { CS.state.projectId = id; CS.ui.projectMenu = false; CS.save(); CS.render(); },
    'toggle-project': id => { CS.ui.expandedProjects.has(id) ? CS.ui.expandedProjects.delete(id) : CS.ui.expandedProjects.add(id); CS.persistFold(); CS.render(); },
    'toggle-projects-section': () => { CS.ui.projectsCollapsed = !CS.ui.projectsCollapsed; CS.persistFoldSection(); CS.render(); },
    'toggle-unassigned': () => { CS.ui.unassignedCollapsed = !CS.ui.unassignedCollapsed; CS.persistFoldLoose(); CS.render(); },
    'toggle-fs-section': () => { CS.ui.fsCollapsed = !CS.ui.fsCollapsed; CS.persistFoldFs(); CS.render(); },
    'fs-dir': (id, el) => {
      const path = el?.dataset?.path || id;
      const st = CS.ui.fs; if (!path || !st) return;
      if (st.expanded.has(path)) st.expanded.delete(path);
      else { st.expanded.add(path); if (!Array.isArray(st.children[path])) CS.agent.loadFsDir(path); }
      CS.render();
    },
    'fs-open': (id, el) => { const path = el?.dataset?.path || id; if (path) CS.agent.previewFsFile(path); },
    'fs-term': () => { CS.ui.terminal.open = !CS.ui.terminal.open; CS.render(); },
    'term-close': () => { CS.ui.terminal.open = false; CS.render(); },
    'term-clear': () => { CS.agent.pty?.clear(); },
    'fs-upload': () => { document.getElementById('fs-upload-input')?.click(); },
    'fs-refresh': () => { _fsRefreshAll(); CS.render(); },
    // ---- 文件浏览器右键菜单: 动作全部经 POST /fs/op 白名单(不开放任意 shell) ----
    'open-present': (id, el) => {
      // present 卡片点击: entry 的分类信息由渲染层带上, 预览器按 klass 分派
      const d = el ? el.dataset : null;
      if (!d || !d.path) return;
      CS.agent.presentPreview({ pid: d.bpid || CS.state.projectId, path: d.path, klass: d.klass, name: d.name, title: d.title, size: Number(d.size) || 0 });
    },
    'wv-open': (id, el) => {
      // 远程页打开真实地址: Cloudflare 等强质询只能在真实域名上完成, 代理页里必然失败
      const target = el?.dataset?.real || el?.dataset?.src || '';
      if (target) window.open(target, '_blank', 'noopener');
    },
    'wv-toggle': (id, el) => {
      // 网页卡片折叠/展开: 点头部切换(按钮点击不冒泡触发——closest 命中按钮自身 action)
      const k = el?.dataset?.foldKey;
      if (!k) return;
      if (!CS.ui.wvFold) CS.ui.wvFold = new Set();
      if (CS.ui.wvFold.has(k)) CS.ui.wvFold.delete(k); else CS.ui.wvFold.add(k);
      CS.render();
    },
    'wv-live-reload': (id, el) => {
      const st = CS._wvLive?.get(el?.dataset?.sid || '');
      if (st && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'reload' }));
    },
    'wv-live-end': (id, el) => {
      const sid = el?.dataset?.sid || '';
      const st = CS._wvLive?.get(sid);
      if (st && st.ws.readyState === 1) st.ws.send(JSON.stringify({ t: 'bye' }));
      CS._wvLive?.delete(sid);
    },
    'wv-cookie': (id, el) => {
      const sid = el?.dataset?.sid || '';
      if (!sid) return;
      CS.showModal('fs-input', { title: '交接验证 Cookie', label: '粘贴浏览器里的 Cookie 请求头（新窗口完成验证后：F12 → Network → 任一该站请求 → Request Headers → Cookie，整段复制）', value: '', action: 'wv-cookie', src: sid, confirmLabel: '注入会话' });
    },
    'wv-reload': (id, el) => {
      const frame = el?.closest('.webview-block')?.querySelector('iframe.wv-frame');
      if (!frame) return;
      const base = frame.dataset.src || frame.src;
      if (!base) return;
      frame.src = base + (base.includes('?') ? '&' : '?') + '_wv=' + Date.now();
      frame.dataset.state = 'loaded';
    },
    'fs-menu-copy-path': (id, el) => {
      const path = el?.dataset?.path || '';
      CS.ui.fsCtx = null; CS.render();
      if (navigator.clipboard) navigator.clipboard.writeText(path).then(() => CS.toast('路径已复制。', 'info'), () => {});
      else CS.toast(path, 'info');
    },
    'fs-menu-copy': (id, el) => {
      const path = el?.dataset?.path || '';
      CS.ui.fsCtx = null;
      CS.showModal('fs-input', { title: '复制到…', label: '项目内目标路径(不存在的新路径)', value: path, action: 'copy', src: path, confirmLabel: '复制' });
    },
    'fs-menu-move': (id, el) => {
      const path = el?.dataset?.path || '';
      CS.ui.fsCtx = null;
      CS.showModal('fs-input', { title: '移动到…', label: '项目内目标路径(不存在的新路径)', value: path, action: 'move', src: path, confirmLabel: '移动' });
    },
    'fs-menu-rename': (id, el) => {
      const path = el?.dataset?.path || '';
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      CS.ui.fsCtx = null;
      CS.showModal('fs-input', { title: '重命名', label: '新名称(不含路径分隔符)', value: path.split('/').pop(), prefix: parent, action: 'rename', src: path, confirmLabel: '重命名' });
    },
    'fs-menu-delete': (id, el) => {
      const path = el?.dataset?.path || '', type = el?.dataset?.type || 'file';
      CS.ui.fsCtx = null;
      CS.showModal('confirm', { title: type === 'dir' ? '删除文件夹？' : '删除文件？', message: type === 'dir' ? '将删除文件夹「' + path + '」及其全部内容。此操作不可撤销。' : '将删除文件「' + path + '」。此操作不可撤销。', confirmAction: 'confirm-fs-delete', confirmLabel: '删除', danger: true, fsPath: path });
    },
    'fs-menu-newfile': (id, el) => {
      const path = el?.dataset?.path || '';
      CS.ui.fsCtx = null;
      CS.showModal('fs-input', { title: '新建文件', label: '文件名(不含路径分隔符)', value: '', action: 'touch', src: path, confirmLabel: '创建' });
    },
    'fs-menu-newfolder': (id, el) => {
      const path = el?.dataset?.path || '';
      CS.ui.fsCtx = null;
      CS.showModal('fs-input', { title: '新建文件夹', label: '文件夹名(不含路径分隔符)', value: '', action: 'mkdir', src: path, confirmLabel: '创建' });
    },
    'confirm-fs-delete': async () => {
      const path = (CS.ui.modal && CS.ui.modal.fsPath) || ''; CS.closeModal();
      if (!path) return;
      try {
        await CS.api.request('/fs/op', { method: 'POST', body: JSON.stringify({ projectId: CS.ui.fs && CS.ui.fs.projectId, action: 'delete', src: path }) });
        _fsRefreshAll(); CS.toast('已删除。', 'info');
      } catch (err) { CS.toast('删除失败：' + CS.api.friendlyError(err), 'error'); }
    },
    'confirm-fs-op': async () => {
      const m = CS.ui.modal || {};
      const inputEl = document.getElementById('fs-op-input');
      const val = (inputEl && inputEl.value || '').trim();
      if (!val) { CS.toast('请填写内容。', 'error'); return; }
      let dst = val;
      if (m.action === 'rename') {
        if (/[\\\/]/.test(val)) { CS.toast('重命名只允许单段名称。', 'error'); return; }
        dst = m.prefix ? m.prefix + '/' + val : val;
      }
      if ((m.action === 'touch' || m.action === 'mkdir') && /[\\\/]/.test(val)) { CS.toast('名称不能包含路径分隔符。', 'error'); return; }
      if (m.action === 'wv-cookie') {
        CS.closeModal();
        try {
          const r = await CS.api.request(`/wv/${encodeURIComponent(m.src)}/cookies`, { method: 'POST', body: JSON.stringify({ cookie: val, ua: navigator.userAgent }) });
          CS.toast(`已注入 ${r.cookies} 个 Cookie（浏览器 UA 已同步）。让助手用 webview_fetch 复查即可。`, 'success');
        } catch (err) { CS.toast('注入失败：' + CS.api.friendlyError(err), 'error'); }
        return;
      }
      CS.closeModal();
      try {
        await CS.api.request('/fs/op', { method: 'POST', body: JSON.stringify({ projectId: CS.ui.fs && CS.ui.fs.projectId, action: m.action, src: m.src, dst, name: val }) });
        // 新建动作: 展开所在目录让用户立刻看到产物(收起状态下新建是盲操作)
        if ((m.action === 'touch' || m.action === 'mkdir') && m.src && CS.ui.fs) CS.ui.fs.expanded.add(m.src);
        _fsRefreshAll(); CS.toast('操作完成。', 'info');
      } catch (err) { CS.toast('操作失败：' + CS.api.friendlyError(err), 'error'); }
    },
    'toggle-project-settings': id => { CS.ui.projectSettingsMenu = CS.ui.projectSettingsMenu === id ? null : id; CS.render(); },
    'ask-pick-option': (id, el) => {
      // id = 时间线块的 bkey; 点击选项切换选中, 单选互斥, 多选可叠加
      const ctx = _askCtx(id); if (!ctx || ctx.block.answered) return;
      const qi = Number(el?.dataset?.qi), oi = Number(el?.dataset?.oi);
      if (!ctx.block.questions[qi] || !ctx.block.questions[qi].options?.[oi]) return;
      CS.ui.askSel = CS.ui.askSel || {};
      const per = CS.ui.askSel[id] = CS.ui.askSel[id] || {};
      const set = per[qi] = per[qi] || new Set();
      if (set.has(oi)) set.delete(oi);
      else { if (!ctx.block.questions[qi].multi_select) set.clear(); set.add(oi); }
      CS.render();
    },
    'ask-submit': id => {
      const ctx = _askCtx(id); if (!ctx) return;
      const block = ctx.block;
      if (block.answered || block.submitting || block.stale) return;
      const answers = (block.questions || []).map((q, qi) => {
        const set = ((CS.ui.askSel || {})[id] || {})[qi] || new Set();
        const selected = (q.options || []).filter((_, oi) => set.has(oi)).map(o => o.label);
        const custom = (((CS.ui.askDraft || {})[`${id}|${qi}`]) || '').trim();
        return { id: q.id || `q${qi + 1}`, selected, ...(custom ? { custom } : {}) };
      });
      if (answers.some(a => !a.selected.length && !a.custom)) { CS.toast('请先回答全部问题。', 'error'); return; }
      block.submitting = true; CS.render();
      (async () => {
        try {
          await CS.api.ws.send('ask.answer', { data: { id: block.id, answers } });
          block.answered = true;
          block.answers = answers;  // 保留结构化答复, 供折叠卡展开态回放
          block.result = '已回答: ' + answers.map(a => a.selected.join('、') || a.custom).join(' | ');
        } catch (error) {
          CS.toast(CS.api.friendlyError(error), 'error');
        }
        block.submitting = false;
        if (CS.ui.askSel) delete CS.ui.askSel[id];
        CS.save(); CS.render();
        syncConversation(ctx.run);
      })();
    },
    'toggle-ask': (id, el) => _toggleAnchored(el, () => {
      CS.ui.askOpen = CS.ui.askOpen || {};
      CS.ui.askOpen[id] = !CS.ui.askOpen[id];
    }),
    'open-deliverable': async (id, el) => {
      // 产出文件 chip: 点击用文件预览弹窗打开(项目目录内路径)
      // 分发器把 dataset.id 作为首参传入, chip 用的是 data-path → 从元素上取
      const path = el?.dataset?.path;
      const run = CS.currentRun();
      if (!path || !run) return;
      if (!run.projectId) { CS.toast('该会话未关联项目目录，无法打开文件。', 'error'); return; }
      try {
        const data = await CS.api.request('/fs/file?projectId=' + encodeURIComponent(run.projectId) + '&path=' + encodeURIComponent(path), { method: 'GET' });
        CS.showModal('fs-preview', { name: String(path).split('/').pop(), ...data });
      } catch (err) { CS.toast((err?.message || '请检查文件是否在项目目录内'), 'error'); }
    },
    'toggle-plan': () => {
      // 计划模式(dsh plan-mode 思路): 开启后模型只探查出 <plan> 方案, 批准后才动手
      CS.ui.planMode = !CS.ui.planMode;
      CS.save(); CS.render();
      CS.toast(CS.ui.planMode ? '规划模式已开启：模型将先给出方案，确认后执行。' : '规划模式已关闭。');
    },
    'approve-plan': id => {
      // 批准计划: 关闭计划模式并自动发出执行指令
      const run = CS.currentRun(); const m = run?.messages[Number(id)];
      if (!run || !m) return;
      CS.ui.planMode = false;
      CS.ui.composer = ''; CS.save();
      sendChatMessage(run, '已批准该计划。请直接按上述计划开始执行，无需再次规划。', []);
    },
    'refine-plan': () => { document.getElementById('composer-text')?.focus(); },
    'pick-fileref': (id, el) => {
      _applyFileRefPick(el.dataset.path || '', el.dataset.isdir === '1', el.dataset.up === '1');
    },
    'rate-message': (id, el) => {
      // 消息反馈(dsh message-feedback 思路): 只落日志永不进模型上下文
      const run = CS.currentRun(); const m = run?.messages[Number(id)];
      if (!m) return;
      CS.showModal('feedback', { messageId: String(id), rating: el?.dataset?.rating || 'up', picked: '', note: '' });
    },
    'pick-feedback-cat': (id, el) => {
      if (!CS.ui.modal || CS.ui.modal.type !== 'feedback') return;
      CS.ui.modal.picked = el.dataset.cat || '';
      CS.renderModal();
    },
    'submit-feedback': () => {
      const md = CS.ui.modal;
      if (!md || md.type !== 'feedback') return;
      const run = CS.currentRun();
      const m = run?.messages[Number(md.messageId)];
      const note = document.getElementById('feedback-note')?.value || '';
      const payload = {
        conversationId: run?.id || '', messageId: md.messageId, rating: md.rating,
        category: md.picked || (md.rating === 'up' ? '有用' : '其他'),
        note, snippet: (m?.content || '').slice(0, 200),
      };
      CS.api.request('/feedback', { method: 'POST', body: JSON.stringify(payload) })
        .then(() => {
          if (m) m.feedback = { rating: md.rating, category: payload.category };
          CS.closeModal(); CS.save(); CS.render();
          CS.toast('感谢反馈，已记录。');
        })
        .catch(err => CS.toast('反馈提交失败：' + (err?.message || ''), 'error'));
    },
    'copy-message': id => {
      const run = CS.currentRun(); const m = run?.messages[Number(id)];
      if (!m) return;
      // 剥离上传附件的零宽隐藏引用(\u200B@path): 展示层不显示, 复制也不应带出
      const text = String(m.content || '').replace(/\u200B@\[\[[^\]]*\]\]/g, '').replace(/\u200B@\S+/g, '').replace(/\s+$/, '');
      navigator.clipboard?.writeText(text).then(() => CS.toast('已复制到剪贴板。')).catch(() => CS.toast('复制失败。', 'error'));
    },
    'delete-message': id => {
      const run = CS.currentRun(); const idx = Number(id);
      const m = run?.messages?.[idx];
      if (!m || m.streaming) return;
      if (!confirm('删除这条消息？删除会同步到服务端存档，影响所有设备上的该会话。')) return;
      run.messages.splice(idx, 1);
      CS.save();
      CS.render();
      syncConversation(run);
      CS.toast('已删除该消息。');
    },
    'edit-message': id => {
      const run = CS.currentRun(); const idx = Number(id);
      if (!run || !run.messages[idx]) return;
      CS.ui.composer = run.messages[idx].content;
      run.messages.splice(idx);  // 截断该消息及其后的回复，重新编辑发送
      CS.save(); CS.render();
      document.querySelector('.composer-input, textarea')?.focus();
    },
    'branch-chat': id => {
      const run = CS.currentRun(); const idx = Number(id);
      if (!run) return;
      const branch = {
        ...run, id: CS.uid('run'), kind: 'chat',
        title: (run.title.slice(0, 20) + ' ·分支'), messages: JSON.parse(JSON.stringify(run.messages.slice(0, idx + 1))),
        createdAt: new Date().toISOString(),
      };
      CS.state.runs.push(branch); CS.state.currentRunId = branch.id; CS.save();
      CS.agent.registerConversation(branch);
      CS.render(); CS.toast('已从该消息创建分支聊天。');
    },
    'toggle-pin-conversation': id => {
      const conv = CS.ui.conversations.find(c => c.id === id); if (!conv) return;
      conv.pinned = !conv.pinned;
      CS.emit('render');
      CS.api.modelCall('conversation.save', 'POST', '/conversations', { id: conv.id, title: conv.title, projectId: conv.projectId, pinned: conv.pinned, archived: !!conv.archived }).catch(() => {});
    },
    'archive-conversation': id => {
      const conv = CS.ui.conversations.find(c => c.id === id); if (!conv) return;
      conv.archived = true;
      CS.emit('render');
      CS.api.modelCall('conversation.save', 'POST', '/conversations', { id: conv.id, title: conv.title, projectId: conv.projectId, pinned: !!conv.pinned, archived: true }).then(() => CS.agent.loadConversations()).catch(() => {});
    },
    'delete-project': id => {
      const project = CS.state.projects.find(p => p.id === id); if (!project) return;
      CS.ui.projectSettingsMenu = null;
      CS.showModal('confirm',{title:'删除项目？',message:'将删除项目「' + project.name + '」。其下会话不会删除，转为未归属项目的会话。此操作不可撤销。',confirmAction:'confirm-delete-project',confirmLabel:'删除',danger:true,projectId:id});
    },
    'confirm-delete-project': async () => {
      const id = CS.ui.modal?.projectId; if (!id) return;
      try {
        const data = await CS.api.modelCall('project.delete', 'DELETE', `/projects/${encodeURIComponent(id)}`);
        CS.state.projects = CS.state.projects.filter(p => p.id !== id);
        CS.ui.conversations = data.conversations || CS.ui.conversations;
        if (CS.state.projectId === id) CS.state.projectId = null;
        CS.ui.expandedProjects.delete(id);
        CS.save(); CS.closeModal(); CS.render(); CS.toast('项目已删除。');
      } catch (error) { CS.toast('删除失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'stop-generation': () => { CS.api.ws.stopChats(); },
    'toggle-thinking': (id, el) => _toggleAnchored(el, () => { CS.ui.thinkingOpen = !CS.ui.thinkingOpen; }),
    'toggle-block': (id, el) => _toggleAnchored(el, () => {
      const opening = !CS.ui.blockOpen[id];
      CS.ui.blockOpen[id] = !CS.ui.blockOpen[id];
      // 流式期间手动展开会增加内容: 若此刻贴近底部(近底阀值内)跟随逻辑会把视口拽走,
      // 表现为展开后页面乱跳; 展开时暂停跟随, 回到底部或点跳到最新时恢复
      if (opening) CS.ui.followLock = true;
    }),
    'toggle-tools': (id, el) => _toggleAnchored(el, () => { CS.ui.toolsOpen = !CS.ui.toolsOpen; }),
    'toggle-proc': (id, el) => {
      const set = CS.ui.procOpen || (CS.ui.procOpen = new Set());
      const opening = !set.has(id);
      if (opening) { set.add(id); CS.ui.followLock = true; }  // 展开大量增高, 暂停跟随防视口乱跳
      else set.delete(id);
      CS.render();
    },
    'toggle-error': (id, el) => _toggleAnchored(el, () => {
      // 展开状态按 消息键 存储: 点哪条只开哪条, 不再全局串开
      const k = el?.dataset?.errkey;
      if (!k) return;
      const set = CS.ui.errorOpenSet || (CS.ui.errorOpenSet = new Set());
      if (set.has(k)) set.delete(k); else set.add(k);
    }),
    'toggle-compact': (id, el) => {
      // 摘要卡点击折叠/展开: 卡默认折叠, 点开过的进已展开集(键 = 会话id+消息序号)
      const k = el?.dataset?.ckey;
      if (!k) return;
      const set = CS.ui.compactExpandedSet || (CS.ui.compactExpandedSet = new Set());
      if (set.has(k)) set.delete(k); else set.add(k);
      CS.render();
    },
    'jump-latest': () => { CS.ui.canJumpLatest = false; CS.render(); scrollToLatest(); },
    // 轨迹热力图方块点击: 平滑滚动到对应消息并高亮一瞬
    'open-trace': () => CS.navigate('trace'),
    'toggle-trace-row': id => { const s = CS.ui.traceOpen instanceof Set ? CS.ui.traceOpen : (CS.ui.traceOpen = new Set()); const n = Number(id); s.has(n) ? s.delete(n) : s.add(n); CS.render(); },
    // 时间线块行展开: 查看单个块的完整输入/输出; 多行可同时展开, 键为 行索引:块序号
    'toggle-trace-block': id => { const s = CS.ui.traceBlockOpen instanceof Set ? CS.ui.traceBlockOpen : (CS.ui.traceBlockOpen = new Set()); s.has(id) ? s.delete(id) : s.add(id); CS.render(); },
    // 输入框折叠开关: 左上触发角收起为右下角方块, 点方块展开还原
    'composer-fold': () => {
      const el = document.querySelector('.chat-composer');
      const from = el ? el.getBoundingClientRect() : null;
      const collapsing = !CS.state.settings.composerCollapsed;
      // 折叠前消息区贴近底部时, 折叠让高度变大后跟随滚到新底部, 避免下方留白
      const cv0 = document.querySelector('.conversation');
      const nearBottom = cv0 ? cv0.scrollHeight - cv0.scrollTop - cv0.clientHeight < 90 : false;
      // 卡体高度 = 输入卡本身(不含下方 23px 硬件信息条与间隙), 收起过程的高度阶段以它为目标
      const form0 = el?.querySelector('.composer');
      const cardH = (form0 && form0.getBoundingClientRect().height > 0) ? form0.getBoundingClientRect().height : (CS.ui.composerCardH || ((from?.height || 154) - 28));
      if (collapsing) CS.ui.composerCardH = cardH;
      CS.state.settings.composerCollapsed = !CS.state.settings.composerCollapsed;
      CS.save();
      CS.render();
      if (collapsing && nearBottom) setTimeout(() => { const cv = document.querySelector('.conversation'); if (cv) cv.scrollTop = cv.scrollHeight; }, 40);
      // FLIP: 渲染替换后从旧盒尺寸/位置平滑回弹到新位, 收起与展开都动
      const el2 = document.querySelector('.chat-composer');
      if (!el2 || !from || CS.state.settings.reducedMotion) return;
      const to = el2.getBoundingClientRect();
      // 苹果风三段动效: 直接动 width/height 数值(无 scale 变形), 反向次序展开
      const easeOut = 'cubic-bezier(.22,.61,.36,1)', spring = 'cubic-bezier(.2,1.4,.4,1)';
      const FW = from.width + 'px', FH = from.height + 'px', TW = to.width + 'px', TH = to.height + 'px';
      // 落定段直接用 spring 缓动收尾, 不做像素级过冲(避免收尾尺寸抖动)
      const frames = collapsing ? [
        { width: FW, height: cardH + 'px', offset: 0, easing: easeOut },
        { width: TW, height: cardH + 'px', offset: 0.45, easing: easeOut },
        { width: TW, height: TH, offset: 1, easing: spring }
      ] : [
        { width: FW, height: FH, offset: 0, easing: easeOut },
        { width: FW, height: TH, offset: 0.42, easing: easeOut },
        { width: TW, height: TH, offset: 1, easing: 'cubic-bezier(.3,.7,.4,1)' }
      ];
      el2.animate(frames, { duration: 2000, easing: 'linear' });
      // 工具条/发送区按钮依次浮现: 每个按钮的延迟与其右缘到卡片右缘的距离成比例, 即宽度推进到能容纳该按钮时才显示
      if (!collapsing) {
        const grow = to.width - from.width;
        [...el2.querySelectorAll('.composer-toolbar .composer-tools > *, .composer-toolbar .composer-submit > *')].forEach(btn => {
          const r = btn.getBoundingClientRect();
          const delay = Math.max(0, Math.min(1900, ((to.right - r.right) / (grow || 1)) * 2000));
          btn.animate([
            { opacity: '0', transform: 'translateY(6px)' },
            { opacity: '1', transform: 'none' }
          ], { duration: 240, delay, easing: 'ease-out', fill: 'backwards' });
        });
      }
      // 展开过程中隐藏「回到底部」按钮: 先置 hidden, 动画结束后按原状态恢复(不改 ui 状态、不触发额外 render)
      if (!collapsing) {
        const jl = document.querySelector('.jump-latest');
        if (jl) jl.hidden = true;
        const ta = document.querySelector('#composer-text');
        if (ta) ta.classList.add('ph-hold');
        setTimeout(() => {
          const j2 = document.querySelector('.jump-latest');
          if (j2) j2.hidden = !CS.ui.canJumpLatest;
          const t2 = document.querySelector('#composer-text');
          if (t2) t2.classList.remove('ph-hold');
        }, 2050);
      }
    },
    'toggle-embed-compact': (id, el) => {
      // 嵌入摘要卡折叠: 卡默认折叠, 点开过的进已展开集(键 = 会话id|mi|bi)
      if (!CS.ui.embedCompactExpanded) CS.ui.embedCompactExpanded = new Set();
      if (CS.ui.embedCompactExpanded.has(id)) CS.ui.embedCompactExpanded.delete(id);
      else CS.ui.embedCompactExpanded.add(id);
      CS.render();
    },
    'jump-compact': () => {
      // 压缩宣告 chip → 跳到最近的摘要卡(末次压缩的卡在卡序列尾部)
      const cards = [...document.querySelectorAll('.compact-card')];
      const el = cards[cards.length - 1];
      if (!el) { CS.toast('未找到摘要卡。', 'error'); return; }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('msg-flash', 'jump-flash');
      void el.offsetWidth;
      el.classList.add('jump-flash');
      setTimeout(() => el.classList.remove('jump-flash'), 2600);
    },
    'track-jump': (id, el) => {
      // 拖拽平移结束后的 click 不算跳转: 位移超阈值的拖动已置 dragged 标
      if (el && el.closest && el.closest('.run-track') && el.closest('.run-track').dataset.dragged) return;
      // 格子 id 两态: "mi:bi"(块级钉点) / "mi"(消息级: 用户消息/错误格/旧存档)
      const colon = id.indexOf(':');
      const mi = parseInt(colon >= 0 ? id.slice(0, colon) : id, 10);
      if (isNaN(mi)) return;
      const target = document.querySelector('.conversation [data-mi="' + mi + '"]');
      if (!target) { CS.toast('该消息不在当前视图中。', 'error'); return; }
      // 长工具链消息整体可达数千像素高: 滚到消息元素本身(块居中)会落在消息
      // 正中部的工具块森林里, 末尾的红色错误行不在视口内。点击红色错误格的
      // 意图是"看哪里出错了", 优先滚到消息内的错误行本身。
      const isErr = !!(el && el.classList && el.classList.contains('tr-error'));
      // 块级格: 直接滚到消息内对应的块元素; 空块/分段渲染等差异导致锚点缺失时
      // 回退到整条消息, 保证点击总有正确落点
      let anchor = null;
      if (colon >= 0 && !isErr) {
        const bi = parseInt(id.slice(colon + 1), 10);
        if (!isNaN(bi)) {
          const blk = target.querySelector('[data-bi="' + bi + '"]');
          if (blk) anchor = blk;
          else if (!anchor) {
            // 过程折叠: 目标块藏在"处理详情"里(元素不在 DOM) —— 计算它所属的
            // 组(组号 = 该块之前的引导块数), 展开该组后重试定位
            const run = CS.currentRun();
            const m = run?.messages?.[mi];
            const blkData = m?.blocks?.[bi];
            if (m && blkData) {
              const g = m.blocks.slice(0, bi).filter(x => x && x.type === 'steer').length;
              const gKey = (run.id || '') + '|' + mi + '|g' + g;
              const set = CS.ui.procOpen || (CS.ui.procOpen = new Set());
              if (!set.has(gKey)) {
                set.add(gKey);
                CS.render();
                anchor = document.querySelector('.conversation [data-mi="' + mi + '"] [data-bi="' + bi + '"]') || null;
              }
            }
          }
        }
      }
      if (!anchor) {
        anchor = (isErr && target.querySelector(':scope .think-root.error-root')) || target;
      }
      anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // jump-flash 不依赖宿主类名(块级锚点无 .msg-block), 色条+描边更醒目
      anchor.classList.remove('msg-flash', 'jump-flash');
      void anchor.offsetWidth;
      anchor.classList.add('jump-flash');
      setTimeout(() => anchor.classList.remove('jump-flash'), 2600);
    },
    'open-conversation': id => {
      if (!CS.state.runs.some(r => r.id === id) && !CS.ui.conversations.some(c => c.id === id)) { CS.toast('该会话不存在。', 'error'); return; }
      CS.expandProject((CS.ui.conversations.find(c => c.id === id) || {}).projectId);
      CS.navigate('chat', id);
    },
    'connect-project': () => { CS.ui.projectMenu = false; CS.showModal('remote-project'); },
    'submit-remote-project': () => {},
    'settings-tab': id => { CS.ui.settingsTab = id; CS.render(); if (id === 'tools') { CS.loadAgentTools(); CS.loadAgentTokens(); } if (id === 'skills') CS.loadAgentSkills(); if (id === 'mcp') CS.loadAgentMcp(); if (id === 'keys') CS.loadAgentTokens(); if (id === 'privacy') CS.loadToolLimit(); if (id === 'sysprompt') CS.loadSystemPrompt(); if (id === 'context') CS.loadAgentCompaction(); if (id === 'usage') CS.loadUsage(); },
    'usage-gran': id => { CS.ui.usageGran = id; CS.render(); },
    'reload-usage': () => { CS.ui.usage = null; CS.loadUsage(true); },
    'configure-model': () => { CS.ui.modelMenu = false; CS.ui.settingsTab = 'agent'; CS.navigate('settings'); },
    'add-provider': () => { CS.ui.edit = { type: 'provider', id: null }; CS.render(); },
    'edit-provider': id => { CS.ui.edit = { type: 'provider', id }; CS.render(); },
    'delete-provider': id => { CS.ui.pendingDelete = id; CS.showModal('confirm',{title:'删除服务商？',message:'将删除该服务商及其下所有模型配置。此操作不可撤销。',confirmAction:'confirm-delete-provider',confirmLabel:'删除',danger:true}); },
    'confirm-delete-provider': async () => {
      const id = CS.ui.pendingDelete; CS.ui.pendingDelete = null;
      try {
        const data = await CS.api.modelCall('provider.delete', 'DELETE', `/providers/${encodeURIComponent(id)}`);
        CS.ui.providers = data.providers || []; CS.ui.models = data.models || [];
        if (CS.ui.edit?.id === id) CS.ui.edit = null;
        if (!CS.ui.models.some(m => m.id === CS.state.settings.modelId)) { const def = CS.ui.models.find(m => m.isDefault) || CS.ui.models[0]; CS.state.settings.modelId = def?.id || null; CS.state.settings.model = def?.model || ''; }
        CS.save(); CS.render(); CS.toast('服务商已删除。');
      } catch (error) { CS.toast('删除失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'save-provider': async () => {
      const name = document.getElementById('provider-name')?.value.trim() || '';
      const baseUrl = document.getElementById('provider-base-url')?.value.trim() || '';
      const apiKey = document.getElementById('provider-api-key')?.value.trim() || '';
      if (!baseUrl) { CS.toast('接口地址不能为空。','error'); return; }
      if (!/^https?:\/\//i.test(baseUrl)) { CS.toast('接口地址必须是 http(s):// 开头的 URL。','error'); return; }
      CS.ui.testing = true; CS.render();
      try {
        await CS.api.modelCall('provider.save', 'POST', '/providers', { id: CS.ui.edit?.id || undefined, name, baseUrl, apiKey: apiKey || undefined });
        CS.ui.edit = null;
        await CS.agent.loadModels();
        CS.toast('服务商已保存。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
      finally { CS.ui.testing = false; emitRender(); }
    },
    'add-model': id => { CS.ui.edit = { type: 'model', id: null }; CS.ui.providerModels = null; CS.ui.draftModelName = ''; CS.ui.draftProviderId = id || null; CS.render(); },
    'edit-model': id => { const m = CS.ui.models.find(x => x.id === id); CS.ui.edit = { type: 'model', id }; CS.ui.providerModels = null; CS.ui.draftModelName = m?.model || ''; CS.ui.draftProviderId = m?.providerId || null; CS.render(); CS.fetchModelMetaSoon(true); },
    'cancel-edit': () => { CS.ui.edit = null; CS.ui.providerModels = null; CS.render(); },
    'tool-toggle': id => {
      const t = (CS.ui.toolDraft || []).find(x => x.id === id);
      if (!t) return;
      t.enabled = !t.enabled;
      CS.render();
    },
    'tool-group-toggle': id => {
      // 点击组标题折叠/展开该组工具: 展开表存进持久化 settings, 缺省折叠,
      // 手动展开过的组重渲染/刷新后都保持
      const st = CS.state.settings;
      st.toolGroupsOpen = st.toolGroupsOpen || {};
      st.toolGroupsOpen[id] = !st.toolGroupsOpen[id];
      CS.save(); CS.render();
    },
    'tool-group-switch': id => {
      // 组级开关: 组内有禁用项 → 一键全开; 全部启用 → 一键全关
      const list = CS.ui.toolDraft || (CS.ui.toolDraft = (CS.ui.agentTools || []).map(t => ({ ...t })));
      const members = list.filter(t => CS.toolGroupKey(t) === id);
      if (!members.length) return;
      const enable = members.some(t => !t.enabled);
      members.forEach(t => { t.enabled = enable; });
      CS.render();
    },
    'ctx-compact': async () => {
      // 圆环弹卡里的手动压缩: 会话流内出现 agent 样式的压缩等待消息(与回复一致),
      // 完成后原地变为摘要卡; 全程不重开圆环弹卡
      const run = CS.currentRun();
      if (!run) return;
      if (run.messages.some(m => m.streaming || m.compactPending)) { CS.toast('正在生成回复或压缩中，稍后再试。', 'error'); return; }
      CS.ui.contextMenu = false; CS.render();
      const msgsBefore = CS.contractMsgsEst();
      const pending = { id: 'cmpp-' + Math.random().toString(36).slice(2, 8), role: 'assistant', compactPending: true, blocks: [], streaming: true, content: '', at: new Date().toISOString() };
      run.messages.push(pending);
      CS.save(); CS.render();
      setTimeout(scrollToLatest, 30);
      // 压缩等待不在正常回复的 timerInterval 更新链里, 自起一个 tick(结束自清):
      // 同时负责刷新计时器与流式摘要增量的 markdown 渲染(直改 DOM, 不整树重渲染)
      const tick = setInterval(() => {
        const still = (CS.currentRun() || { messages: [] }).messages.some(m => m.compactPending && m.id === pending.id);
        if (!still) { clearInterval(tick); return; }
        const el = document.querySelector('.compact-reply-block .elapsed-timer');
        if (el) el.textContent = CS.elapsed(pending.at);
        if (pending.summaryDelta) {
          const blk = document.querySelector('.compact-reply-block');
          if (blk) {
            // 流式卡与最终卡同外壳: 首个 delta 建卡(静态头 + 空 body), 之后只刷 body 内的 markdown
            let card = blk.querySelector('.compact-card');
            if (!card) {
              const status = blk.querySelector('.compact-status');
              const div = document.createElement('div');
              div.className = 'compact-card compact-streaming-card';
              div.innerHTML = '<div class="compact-head"><span class="compact-ico"></span><span class="compact-title">上下文已压缩</span><span class="tiny muted compact-sub">摘要生成中…</span></div><div class="compact-body md-body compact-streaming"></div>';
              if (status && status.parentElement) status.insertAdjacentElement('afterend', div);
              else blk.appendChild(div);
              card = blk.querySelector('.compact-card');
            }
            const body = card.querySelector('.compact-body');
            body.innerHTML = CS.markdown(pending.summaryDelta);
            if (!seenDelta) { seenDelta = true; setTimeout(scrollToLatest, 30); }
          }
        }
      }, 500);
      let seenDelta = false;
      try {
        // 流式压缩: SSE 增量推送摘要, 等待消息下方跟打字机一样的节奏长出摘要卡
        const resp = await fetch(CS.api.url(`/conversations/${encodeURIComponent(run.id)}/compact-stream`), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!resp.ok) {
          let detail = `HTTP ${resp.status}`;
          try { const b = await resp.json(); if (b?.detail) detail = String(b.detail); } catch {}
          if (resp.status === 401 && typeof CS.handleAuthLoss === 'function') setTimeout(() => { try { CS.handleAuthLoss(); } catch {} }, 0);
          throw new Error(detail);
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let r = null, streamErr = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let ev = 'message', data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event: ')) ev = line.slice(7).trim();
              else if (line.startsWith('data: ')) data += (data ? '\n' : '') + line.slice(6);
            }
            if (!data) continue;
            let payload; try { payload = JSON.parse(data); } catch { continue; }
            if (ev === 'delta' && payload.text) pending.summaryDelta = (pending.summaryDelta || '') + payload.text;
            else if (ev === 'done') r = payload;
            else if (ev === 'error') streamErr = new Error(String(payload.detail || '压缩失败'));
          }
        }
        if (streamErr) throw streamErr;
        if (!r) throw new Error('压缩流提前结束');
        if (!r.applied) {
          run.messages = run.messages.filter(m => m !== pending);
          CS.save(); CS.render();
          CS.toast('上下文还很轻，无需压缩。');
          return;
        }
        const dropped = Math.max(0, Math.floor(Number(r.droppedTotal ?? r.removed) || 0));
        // 界面保留全部历史(用户随时可回看), 只收缩模型上下文:
        // 压缩契约在服务端会话构建时应用(最后一张摘要卡之前不再发送)
        // 锚点估算失效: 旧 promptTokens 反映压缩前量级, 清掉后圆环改为逐条估算,
        // 下一次真实回复的 usage 回填后锚点机制自然重新校准
        run.messages.forEach(m => { if (m.promptTokens) delete m.promptTokens; });
        // 等待消息原地变成摘要卡(它 push 时就在末尾 = 压缩时刻的最新消息)
        // 完成: 计时与 in/out 元数据与正常回复同构(调用摘要 LLM 的真实用量)
        pending.compactPending = false;
        delete pending.streaming;
        pending.compact = true;
        pending.elapsed = Date.now() - new Date(pending.at).getTime();
        pending.content = String(r.text || '');
        if (r.summaryTokens) pending.tokens = r.summaryTokens; else delete pending.tokens;
        if (r.summaryInputTokens) pending.promptTokens = r.summaryInputTokens;
        pending.model = CS.state.settings.model || '';
        pending.at = new Date().toISOString();
        CS.save();
        await syncConversation(run);       // 服务端先落库, 后续统计才读到新列表
        CS.render();
        await CS.refreshContextInfo().catch(() => {});
        const msgsAfter = CS.contractMsgsEst();
        CS.toast(`已压缩：早期 ${r.droppedTotal || dropped} 条并入摘要, 对话上下文 ${CS.kfmt(msgsBefore)} → ${CS.kfmt(msgsAfter)} tokens; 全部历史保留在会话里。`);
        // 压缩完成后自动接续: 不插可见用户消息, 把压缩摘要作为历史上下文
        // 直接触发下一轮输出(hiddenContinue: 服务端契约将摘要卡组装为 user 末条)
        if (run === CS.currentRun() && !run.messages.some(m => m.streaming || m.compactPending)) sendChatMessage(run, '', [], { hiddenContinue: true });
      } catch (error) {
        run.messages = run.messages.filter(m => m !== pending);
        CS.save(); CS.render();
        CS.toast('压缩失败：' + CS.api.friendlyError(error), 'error');
      }
    },
    'save-tools': async () => {
      if (!CS.ui.toolDraft?.length) { CS.toast('没有需要保存的修改。'); return; }
      try {
        const d = await CS.api.request('/tools', { method: 'POST', body: JSON.stringify({ tools: CS.ui.toolDraft }) });
        CS.ui.agentTools = d.tools || [];
        CS.ui.toolDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('工具设置已保存，下一次请求生效。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'reset-tools': async () => {
      if (!confirm('清除全部工具自定义设置并恢复默认？')) return;
      try {
        const d = await CS.api.request('/tools', { method: 'POST', body: JSON.stringify({ reset: true }) });
        CS.ui.agentTools = d.tools || [];
        CS.ui.toolDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('工具设置已恢复默认。');
      } catch (error) { CS.toast('恢复失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'save-tokens': async () => {
      // 只提交有变化的条目: 非空值 → 保存/覆盖; 空值且已保存 → 不提交(用清除按钮删除)
      const draft = CS.ui.tokensDraft || {};
      const updates = {};
      for (const t of (CS.ui.tokens || [])) {
        const value = String(draft[t.id] ?? '').trim();
        if (value) updates[t.id] = value;
      }
      if (!Object.keys(updates).length) { CS.toast('没有需要保存的修改。'); return; }
      try {
        const d = await CS.api.request('/tokens', { method: 'POST', body: JSON.stringify({ tokens: updates }) });
        CS.ui.tokens = d.tokens || [];
        CS.ui.tokensDraft = null;
        CS.ui.agentTools = null;
        CS.ui.toolDraft = null;
        CS.ui.mcpServers = null;
        CS.ui.mcpDraft = null;
        await CS.loadAgentTools();
        await CS.refreshContextInfo();
        CS.toast('API Key 已保存，相关工具/服务启用状态已同步。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'token-clear': async id => {
      try {
        const d = await CS.api.request('/tokens', { method: 'POST', body: JSON.stringify({ tokens: { [id]: '' } }) });
        CS.ui.tokens = d.tokens || [];
        CS.ui.tokensDraft = null;
        CS.ui.agentTools = null;
        CS.ui.toolDraft = null;
        CS.ui.mcpServers = null;
        CS.ui.mcpDraft = null;
        await CS.loadAgentTools();
        await CS.refreshContextInfo();
        CS.toast('密钥已清除，相关工具/服务已关闭。');
      } catch (error) { CS.toast('清除失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'skill-toggle': id => {
      const s = (CS.ui.skillDraft || []).find(x => x.id === id);
      if (!s) return;
      s.enabled = !s.enabled;
      CS.render();
    },
    'save-skills': async () => {
      if (!CS.ui.skillDraft?.length) { CS.toast('没有需要保存的修改。'); return; }
      try {
        const d = await CS.api.request('/skills', { method: 'POST', body: JSON.stringify({ skills: CS.ui.skillDraft }) });
        CS.ui.agentSkills = d.skills || [];
        CS.ui.skillDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('技能设置已保存，下一次会话生效。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'reset-skills': async () => {
      if (!confirm('清除全部技能自定义设置并恢复默认？')) return;
      try {
        const d = await CS.api.request('/skills', { method: 'POST', body: JSON.stringify({ reset: true }) });
        CS.ui.agentSkills = d.skills || [];
        CS.ui.skillDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('技能设置已恢复默认。');
      } catch (error) { CS.toast('恢复失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'mcp-toggle': key => {
      const s = (CS.ui.mcpDraft || []).find(x => x.key === key);
      if (!s) return;
      s.enabled = !s.enabled;
      CS.render();
    },
    'mcp-remove': key => {
      CS.ui.mcpDraft = (CS.ui.mcpDraft || []).filter(x => x.key !== key);
      CS.render();
    },
    'add-mcp': () => {
      CS.ui.mcpDraft = (CS.ui.mcpDraft || []).concat([{ id: '', key: `new-${Date.now()}`, name: '', url: '', enabled: true, builtin: false, modified: false }]);
      CS.render();
    },
    'save-mcp': async () => {
      const draft = CS.ui.mcpDraft || [];
      if (draft.some(s => !s.name.trim())) { CS.toast('MCP 服务器名称不能为空。', 'error'); return; }
      if (draft.some(s => !s.url.trim())) { CS.toast('MCP 地址不能为空。', 'error'); return; }
      try {
        const body = { servers: draft.map(s => ({ name: s.name, url: s.url, enabled: s.enabled })) };
        const d = await CS.api.request('/mcp', { method: 'POST', body: JSON.stringify(body) });
        CS.ui.mcpServers = d.servers || [];
        CS.ui.mcpDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('MCP 配置已保存，下一次会话生效。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'reset-mcp': async () => {
      if (!confirm('清除全部 MCP 服务器并恢复内置配置？')) return;
      try {
        const d = await CS.api.request('/mcp', { method: 'POST', body: JSON.stringify({ reset: true }) });
        CS.ui.mcpServers = d.servers || [];
        CS.ui.mcpDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('MCP 配置已恢复默认。');
      } catch (error) { CS.toast('恢复失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'compaction-toggle': () => {
      const d = CS.ui.compactionDraft || (CS.ui.compactionDraft = { ...(CS.ui.agentCompaction || {}) });
      d.enabled = !(d.enabled !== false);
      CS.render();
    },
    'save-compaction': async () => {
      const d = CS.ui.compactionDraft || {};
      try {
        const r = await CS.api.request('/compaction', { method: 'POST', body: JSON.stringify({
          enabled: d.enabled !== false,
          ratio: Number(d.ratio),
          keepRecentTokens: Number(d.keepRecentTokens),
          minDrops: Number(d.minDrops),
          summaryTokens: Number(d.summaryTokens),
          resultChars: Number(d.resultChars),
          argChars: Number(d.argChars),
        }) });
        CS.ui.agentCompaction = r.compaction || {};
        CS.ui.compactionDraft = { ...CS.ui.agentCompaction };
        CS.render();
        CS.toast('压缩参数已保存，立即对下一次会话生效。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'reset-compaction': async () => {
      if (!confirm('恢复压缩参数默认值？')) return;
      try {
        const r = await CS.api.request('/compaction', { method: 'POST', body: JSON.stringify({ reset: true }) });
        CS.ui.agentCompaction = r.compaction || {};
        CS.ui.compactionDraft = { ...r.compaction };
        CS.render();
        CS.toast('已恢复默认压缩参数。');
      } catch (error) { CS.toast('恢复失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'memory-recall-toggle': async () => {
      const on = !(CS.ui.memSettings && CS.ui.memSettings.recall);
      try {
        const r = await CS.api.request('/memory-settings', { method: 'POST', body: JSON.stringify({ recall: on }) });
        CS.ui.memSettings = r.memory || { recall: on };
        CS.render();
        CS.toast(on ? '跨会话记忆已开启，下一轮生效。' : '跨会话记忆已关闭，下一轮生效。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'sysprompt-toggle': () => {
      const d = CS.ui.syspromptDraft || (CS.ui.syspromptDraft = { prompt: '', enabled: false });
      d.enabled = !d.enabled;
      CS.render();
    },
    'save-sysprompt': async () => {
      const d = CS.ui.syspromptDraft || { prompt: '', enabled: false };
      if (d.enabled && !d.prompt.trim()) { CS.toast('启用自定义系统提示词时内容不能为空。', 'error'); return; }
      try {
        const r = await CS.api.request('/system-prompt', { method: 'POST', body: JSON.stringify({ prompt: d.prompt, enabled: d.enabled }) });
        CS.ui.systemPrompt = { ...(CS.ui.systemPrompt || {}), prompt: r.prompt, enabled: r.enabled };
        CS.ui.syspromptDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('系统提示词已保存，下一次会话生效。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'reset-sysprompt': async () => {
      if (!confirm('清除自定义系统提示词并恢复内置默认？')) return;
      try {
        await CS.api.request('/system-prompt', { method: 'POST', body: JSON.stringify({ prompt: '', enabled: false }) });
        CS.ui.systemPrompt = { ...(CS.ui.systemPrompt || {}), prompt: '', enabled: false };
        CS.ui.syspromptDraft = null;
        await CS.refreshContextInfo();
        CS.render();
        CS.toast('系统提示词已恢复内置默认。');
      } catch (error) { CS.toast('恢复失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'delete-model': id => { CS.ui.pendingDelete = id; CS.showModal('confirm',{title:'删除模型？',message:'将从服务端删除此模型配置。此操作不可撤销。',confirmAction:'confirm-delete-model',confirmLabel:'删除',danger:true}); },
    'confirm-delete-model': async () => {
      const id = CS.ui.pendingDelete; CS.ui.pendingDelete = null;
      try {
        const data = await CS.api.modelCall('model.delete', 'DELETE', `/models/${encodeURIComponent(id)}`);
        CS.ui.models = data.models || [];
        if (CS.state.settings.modelId === id) { const def = CS.ui.models.find(m => m.isDefault) || CS.ui.models[0]; CS.state.settings.modelId = def?.id || null; CS.state.settings.model = def?.model || ''; }
        CS.save(); CS.render(); CS.toast('模型已删除。');
      } catch (error) { CS.toast('删除失败：' + CS.api.friendlyError(error), 'error'); }
    },
    'save-model': async () => {
      const providerId = document.getElementById('model-provider')?.value || CS.ui.draftProviderId;
      const model = document.getElementById('model-name')?.value.trim() || '';
      const ctxWin = parseInt(document.getElementById('model-ctx-window')?.value, 10);  // 必须在 render 前读取, 否则表单会被重建清空
      if (!providerId) { CS.toast('请选择服务商。','error'); return; }
      if (!model) { CS.toast('模型名称不能为空。','error'); return; }
      CS.ui.testing = true; CS.render();
      try {
        await CS.api.modelCall('model.save', 'POST', '/models', { id: CS.ui.edit?.id || undefined, providerId, model, isDefault: true, contextWindow: ctxWin > 0 ? ctxWin : null });
        CS.ui.edit = null; CS.ui.providerModels = null; CS.ui.draftModelName = '';
        await CS.agent.loadModels();
        CS.toast('模型已保存。');
      } catch (error) { CS.toast('保存失败：' + CS.api.friendlyError(error), 'error'); }
      finally { CS.ui.testing = false; emitRender(); }
    },
    'fetch-provider-models': async () => {
      const pid = document.getElementById('model-provider')?.value || CS.ui.draftProviderId;
      const current = document.getElementById('model-name')?.value || '';
      if (current !== '') CS.ui.draftModelName = current;
      if (pid) CS.ui.draftProviderId = pid;
      CS.ui.providerModels = { loading: true, list: null, error: null };
      CS.render();
      try {
        const result = await CS.api.modelCall('provider.models', 'POST', '/providers/list-models', { id: CS.ui.draftProviderId });
        CS.ui.providerModels = result.ok ? { loading: false, list: result.models } : { loading: false, list: null, error: result.error || '获取失败' };
      } catch (error) { CS.ui.providerModels = { loading: false, list: null, error: error.message }; }
      CS.render();
    },
    'dd-toggle': id => { CS.ui.dropdown = CS.ui.dropdown === id ? null : id; CS.render(); },
    'dd-pick-provider': id => { CS.ui.draftProviderId = id; CS.ui.dropdown = null; CS.render(); },
    'dd-pick-model': name => { CS.ui.draftModelName = name; CS.ui.dropdown = null; CS.render(); CS.fetchModelMetaSoon(true); },
    'test-provider': async id => {
      const provider = CS.ui.providers.find(x => x.id === id); if (!provider) return;
      CS.ui.testing = true; CS.render();
      try {
        const result = await CS.api.modelCall('provider.test', 'POST', '/providers/test', { id });
        CS.ui.apiHealth = `服务商 ${provider.name}：${result.ok ? '连接成功 · ' + result.latencyMs + ' ms' + (result.modelCount ? ' · ' + result.modelCount + ' 个模型' : '') : '连接失败 · ' + (result.error || 'HTTP ' + result.status)}`;
        CS.toast(CS.ui.apiHealth);
      } catch (error) { CS.toast('测试失败：' + CS.api.friendlyError(error), 'error'); }
      finally { CS.ui.testing = false; CS.render(); }
    },
    'logout': () => {
      CS.ui.userMenu = false;
      if (CS.state.me && CS.state.me.mode === 'multi') {
        // 先在 reset 之前发登出请求: 此时 endpoint 是探测后的正确地址
        // (reset 会把 endpoint 恢复成默认值, 挂错前缀的请求会落到静态文件 405)
        const bye = CS.api.request('/auth/logout', { method: 'POST' }).catch(() => null);
        // 等服务端清除会话 cookie 完成再整页刷新, 避免旧 cookie 残留导致登录层不弹出
        ;(async () => {
          await bye;
          CS.reset();
          CS.state.me = { mode: 'multi', user: null };
          setTimeout(() => { window.location.reload(); }, 30);
        })();
        return;
      }
      CS.state.username = ''; CS.save(); CS.render(); CS.toast('已退出登录。');
    },
    'go-home': () => CS.navigate('home'), 'go-data': () => CS.navigate('data'), 'go-workflows': () => CS.navigate('workflows'),
    'new-project': async () => {
      CS.showModal('project');
      if (!CS.ui.projectsRoot) {
        try { CS.ui.projectsRoot = (await CS.api.request('/fs/dirs')).root; }
        catch { /* 接口不可达时保存时按名称推断 */ }
      }
      // dir 字段保持空, 占位提示"选择文件夹, 或留空使用默认路径下的同名文件夹"
      const dirEl = document.getElementById('project-dir');
      if (dirEl) dirEl.value = '';
    },
    // 项目目录浏览: 列表直接注入容器 DOM, 不走全局重渲染, 避免表单输入丢失
    'browse-dir': async () => {
      const modal = CS.ui.modal;
      if (!CS.ui.projectsRoot) {
        try { CS.ui.projectsRoot = (await CS.api.request('/fs/dirs')).root; }
        catch { CS.toast('无法访问服务端目录接口。', 'error'); return; }
      }
      // 浏览始终从已选目录(或默认根路径)开始, 不使用按名称推断的占位值
      _loadDirListing(modal.pickedDir || CS.ui.projectsRoot);
    },
    'dir-navigate': dirPath => { _loadDirListing(dirPath); },
    'dir-parent': () => {
      const box = document.getElementById('dir-listing');
      if (box?.dataset.parent) _loadDirListing(box.dataset.parent);
    },
    'dir-cancel': () => { document.getElementById('dir-listing').innerHTML = ''; },
    // 新建文件夹: 在当前浏览目录下创建, 成功后进入新目录(用户可直接点「选择此文件夹」)
    // 设置页: 工具结果入库上限 / 单次回复轮次预算 (science settings.json, 即时生效)
    'save-tool-limit': async () => {
      const el = document.getElementById('tool-limit-input');
      const v = parseInt((el?.value || '').trim(), 10);
      if (!Number.isFinite(v)) { CS.toast('请输入有效数字。', 'error'); return; }
      try { const d = await CS.api.request('/tool-result-limit', { method: 'POST', body: JSON.stringify({ limit: v }) }); CS.ui.toolLimit = d.limit; CS.toast('已保存工具结果入库上限。'); CS.render(); }
      catch (err) { CS.toast(CS.api.friendlyError(err), 'error'); }
    },
    'reset-tool-limit': async () => {
      try { const d = await CS.api.request('/tool-result-limit', { method: 'POST', body: JSON.stringify({ limit: 30000 }) }); CS.ui.toolLimit = d.limit; CS.render(); CS.toast('已恢复默认 30000。'); }
      catch (error) { CS.toast(CS.api.friendlyError(error), 'error'); }
    },
    'save-turn-budget': async () => {
      const el = document.getElementById('turn-budget-input');
      const v = parseInt((el?.value || '').trim(), 10);
      if (!Number.isFinite(v) || v < 10) { CS.toast('请输入不小于 10 的轮数。', 'error'); return; }
      try { const d = await CS.api.request('/turn-budget', { method: 'POST', body: JSON.stringify({ limit: v }) }); CS.ui.turnBudget = d.limit; CS.render(); CS.toast('已保存，下一次回复生效。'); }
      catch (err) { CS.toast(CS.api.friendlyError(err), 'error'); }
    },
    'reset-turn-budget': async () => {
      try { const d = await CS.api.request('/turn-budget', { method: 'POST', body: JSON.stringify({ limit: 100 }) }); CS.ui.turnBudget = d.limit; CS.render(); CS.toast('已恢复默认 100 轮。'); }
      catch (err) { CS.toast(CS.api.friendlyError(err), 'error'); }
    },
    'save-nudge-threshold': async () => {
      const el = document.getElementById('nudge-threshold-input');
      const v = parseInt((el?.value || '').trim(), 10);
      if (!Number.isFinite(v) || v < 0) { CS.toast('请输入不小于 0 的数字。', 'error'); return; }
      try { const d = await CS.api.request('/nudge-threshold', { method: 'POST', body: JSON.stringify({ limit: v }) }); CS.ui.nudgeThreshold = d.limit; CS.render(); CS.toast(d.limit === 0 ? '已设为 0，静默提醒已关闭。' : '已保存，下一次回复生效。'); }
      catch (err) { CS.toast(CS.api.friendlyError(err), 'error'); }
    },
    'reset-nudge-threshold': async () => {
      try { const d = await CS.api.request('/nudge-threshold', { method: 'POST', body: JSON.stringify({ limit: 10 }) }); CS.ui.nudgeThreshold = d.limit; CS.render(); CS.toast('已恢复默认 10 个。'); }
      catch (err) { CS.toast(CS.api.friendlyError(err), 'error'); }
    },
    'dir-create': async () => {
      const box = document.getElementById('dir-listing');
      const input = document.getElementById('dir-new-name');
      const name = (input?.value || '').trim();
      if (!name) { CS.toast('请输入文件夹名称。', 'error'); return; }
      const btn = box?.querySelector('[data-action="dir-create"]');
      if (btn) btn.disabled = true;
      try {
        const d = await CS.api.request('/fs/mkdir', { method: 'POST', body: JSON.stringify({ path: box.dataset.path || '', name }) });
        CS.toast('已创建文件夹 ' + (d.created || name) + '。');
        const created = (d.dirs || []).find(x => x.name === d.created);
        await _loadDirListing(created ? created.path : d.path);
      } catch (err) { CS.toast(CS.api.friendlyError(err), 'error'); }
    },
    'dir-pick': dirPath => {
      const modal = CS.ui.modal;
      modal.pickedDir = dirPath;
      document.getElementById('project-dir').value = dirPath;
      // 项目名称为空时, 用所选文件夹名同步为项目名; 已填写时不覆盖
      const nameEl = document.getElementById('project-name');
      if (nameEl && !nameEl.value.trim()) {
        const folderName = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
        if (folderName) nameEl.value = folderName;
      }
      document.getElementById('dir-listing').innerHTML = '';
    },
    'edit-project': id => { const p = CS.state.projects.find(p=>p.id===id); CS.showModal('project',{project:p, pickedDir: p?.dir || ''}); },
    'open-project': id => {
      const project = CS.state.projects.find(p=>p.id===id); if (!project) return;
      CS.expandProject(id);
      CS.state.projectId = id; CS.ui.composer = ''; CS.ui.attachments = [];
      const lastRun = CS.state.runs.filter(r=>r.projectId===id).at(-1);
      CS.state.currentRunId = lastRun?.id || null; CS.save(); CS.navigate(lastRun ? 'chat' : 'home');
    },
    'archive-project': id => { const p = CS.state.projects.find(p=>p.id===id); p.archived = !p.archived; CS.save(); CS.closeModal(); CS.render(); CS.toast(p.archived ? '项目已归档；数据与任务记录仍保留。' : '项目已恢复。'); },
    'demo-start': () => openNewTask('请使用 PBMC 演示数据，展示从质量检查、细胞图谱到表达特征和分析记录的完整过程。执行前先让我确认计划。','singlecell',['ds-pbmc','ds-meta'].filter(id=>CS.state.datasets.some(d=>d.id===id))),
    'literature-plan': () => openNewTask('围绕单细胞 RNA-seq 数据分析，整理一份可追溯的文献阅读清单。','literature'),
    'close-modal': () => CS.closeModal(),
    'back-to-chat': () => CS.navigate('chat'),
    // 「文件」按钮: 与输入 @ 同效, 弹项目文件引用浮层(选择后把 @路径 插入输入框);
    // 再点一次或 Esc 或点击其它区域关闭
    'add-attachment': async () => {
      const fr = CS.fileRef;
      if (fr.open && fr.mode === 'btn') { _closeFileRef(); return; }
      if (!CS.state.projectId) { CS.toast('先关联项目后再引用文件，或直接在输入框输入 @ 引用。', 'error'); return; }
      const items = await _fsListDir('');
      Object.assign(fr, { open: true, mode: 'btn', items, active: 0, dir: '', token: '', start: 0, query: '' });
      _renderFileRefMenu();
    },
    'import-data': () => { uploadContext='data'; CS.showModal('import'); },
    'upload-local': () => {
      let input = document.getElementById('upload-input');
      if (!input) { input = document.createElement('input'); input.type = 'file'; input.id = 'upload-input'; input.multiple = true; input.hidden = true; input.addEventListener('change', () => { uploadLocalFiles(input.files); input.value = ''; }); document.body.appendChild(input); }
      input.value = ''; input.click();
    },
    'remove-upload': name => {
      const u = (CS.ui.pendingUploads || []).find(x => x.name === name);
      if (u && u.path) CS.ui.composer = CS.ui.composer.split('\u200B@[[' + u.path + ']]').join('').split('@' + u.path).join('').replace(/ {2,}/g, ' ');
      CS.ui.pendingUploads = CS.ui.pendingUploads.filter(x => x.name !== name);
      CS._persistUploads();
      const ta = document.getElementById('composer-text'); if (ta) ta.value = CS.ui.composer;
      const send = document.querySelector('.send-button'); if (send) send.disabled = !CS.ui.composer.trim() && !CS.ui.pendingUploads.some(u => u.status === 'done');
      CS.render();
    },
    'pick-files': () => chooseFiles(uploadContext),
    'preview-csv-import': () => chooseFiles('preview'),
    'choose-dataset': () => CS.showModal('dataset-picker'),
    'pick-dataset': id => { if (!CS.ui.attachments.includes(id)) CS.ui.attachments.push(id); CS.closeModal(); CS.render(); CS.toast('数据已加入当前问题。'); },
    'remove-attachment': id => { CS.ui.attachments = CS.ui.attachments.filter(x=>x!==id); CS.render(); },
    'attach-dataset': id => { CS.ui.attachments=[id]; CS.state.currentRunId=null; CS.save(); CS.navigate('home'); },
    'attach-preview': id => { CS.closeModal(); actions['attach-dataset'](id); },
    'choose-tools': async () => { await CS.loadAgentTools(); CS.showModal('agent-tools'); },
    'choose-skills': async () => { await CS.loadAgentSkills(); CS.showModal('agent-skills'); },
    'open-tool-settings': () => { CS.closeModal(); CS.ui.settingsTab = 'tools'; CS.navigate('settings'); CS.loadAgentTools(); CS.loadAgentTokens(); },
    'open-skill-settings': () => { CS.closeModal(); CS.ui.settingsTab = 'skills'; CS.navigate('settings'); CS.loadAgentSkills(); },
    'approve-run': () => CS.agent.approve(CS.currentRun()),
    'pause-run': () => CS.agent.control(CS.currentRun(),'pause'),
    'cancel-run': () => CS.agent.control(CS.currentRun(),'cancel'),
    'restart-run': () => { const r=CS.currentRun(); openNewTask(r.prompt,r.workflowId,r.datasetIds); },
    'toggle-log': id => { const num=Number(id); CS.ui.expandedLogs.has(num) ? CS.ui.expandedLogs.delete(num) : CS.ui.expandedLogs.add(num); CS.render(); },
    'toggle-inspector': () => { CS.state.settings.inspector=!CS.state.settings.inspector; emitRender(); },
    'open-run': id => { CS.state.currentRunId=id; const run=CS.currentRun(); CS.state.projectId=run.projectId; CS.save(); CS.navigate('chat'); },
    'open-current-chat': () => CS.navigate('chat'),
    'open-results': () => { CS.ui.resultTab='overview'; CS.navigate('results'); },
    'show-sample-results': () => { CS.state.currentRunId=null; CS.ui.resultTab='overview'; emitRender(); },
    'data-tab': id => { CS.ui.filters.dataTab=id; CS.ui.datasetSelection.clear(); CS.render(); },
    'project-tab': id => { CS.ui.filters.projectTab=id; CS.render(); },
    'paper-tab': id => { CS.ui.filters.paperTab=id; CS.render(); },
    'tool-tab': id => { CS.ui.filters.toolTab=id; CS.render(); },
    'result-tab': id => { CS.ui.resultTab=id; CS.render(); },
    'workflow-category': id => { CS.ui.workflowCategory=id; CS.render(); },
    'select-workflow': id => { CS.ui.workflowId=id; CS.render(); },
    'toggle-advanced': () => { CS.ui.advanced=!CS.ui.advanced; CS.render(); },
    'start-workflow': () => {
      if (!CS.state.datasets.some(d=>d.id===CS.ui.datasetId)) { CS.toast('请先选择有效的数据记录。','error'); return; }
      if (!Number.isFinite(Number(CS.ui.minGenes)) || Number(CS.ui.minGenes)<1 || Number(CS.ui.minGenes)>10000 || !Number.isFinite(Number(CS.ui.maxMito)) || Number(CS.ui.maxMito)<0 || Number(CS.ui.maxMito)>100) { CS.toast('请检查高级参数：min_genes 为 1–10000，max_mito 为 0–100。','error'); return; }
      const workflow=CS.workflow(CS.ui.workflowId); const dataset=CS.state.datasets.find(d=>d.id===CS.ui.datasetId);
      openNewTask(`请围绕 ${dataset.name} 创建“${workflow.title}”的演示计划。物种上下文为 ${CS.ui.organism}，请先确认步骤再执行。`,workflow.id,[dataset.id]);
    },
    'preview-data': id => previewDataset(id),
    'export-dataset-metadata': exportMetadata,
    'delete-datasets': () => CS.showModal('confirm',{title:'移除数据记录？',message:`将移除所选 ${CS.ui.datasetSelection.size} 份本地记录。不会删除电脑上的原文件，但相关任务可能失去输入记录名称。`,confirmAction:'confirm-delete-datasets',confirmLabel:'移除记录',danger:true}),
    'confirm-delete-datasets': () => {
      const ids=CS.ui.datasetSelection; CS.state.datasets=CS.state.datasets.filter(d=>!ids.has(d.id)); ids.forEach(id=>CS.files.delete(id)); CS.ui.attachments=CS.ui.attachments.filter(id=>!ids.has(id)); ids.clear();
      if (!CS.state.datasets.some(d=>d.id===CS.ui.datasetId)) CS.ui.datasetId=CS.state.datasets[0]?.id || '';
      CS.closeModal(); emitRender(); CS.toast('记录已移除；原文件未删除。');
    },
    'download-sample': () => CS.download('sample_metadata.csv',CS.data.sampleCSV,'text/csv;charset=utf-8'),
    'zoom-in': () => { CS.ui.zoom=Math.min(2,CS.ui.zoom+.2); CS.render(); },
    'zoom-out': () => { CS.ui.zoom=Math.max(.8,CS.ui.zoom-.2); CS.render(); },
    'zoom-reset': () => { CS.ui.zoom=1; CS.ui.group='all'; CS.render(); },
    'filter-group': id => { CS.ui.group=CS.ui.group===id ? 'all' : id; CS.render(); },
    'select-cell': id => { CS.ui.selectedCell=id; CS.render(); CS.showModal('cell',{id}); },
    'export-chart': () => { const body = document.getElementById('umap-chart')?.outerHTML || CS.scatter(); CS.download('synthetic_cell_atlas.svg',body,'image/svg+xml;charset=utf-8'); CS.toast('已导出合成示例 SVG。'); },
    'export-markers': () => { const text='gene,synthetic_group,synthetic_expression,synthetic_fraction\n'+CS.data.markers.map(m=>[m.gene,m.group,m.value,m.fraction].map(CS.csvCell).join(',')).join('\n'); CS.download('synthetic_expression.csv',text,'text/csv;charset=utf-8'); },
    'export-report': () => { CS.download('sigmaflow_science_demo_record.md',CS.report(CS.currentRun())); CS.toast('已导出演示记录。'); },
    'export-run-json': () => CS.download('sigmaflow_science_run.json',JSON.stringify(CS.currentRun() || {source:'synthetic-ui-fixture',isDemo:true,groups:CS.data.groups},null,2),'application/json'),
    'explain-result': () => {
      if (!CS.currentRun()) { openNewTask('请解释单细胞演示图表中，颜色、分组与数据来源分别表示什么。','singlecell',['ds-pbmc'].filter(id=>CS.state.datasets.some(d=>d.id===id))); }
      else { CS.ui.composer='请解释这张合成图表的分组与局限。'; CS.navigate('chat'); }
    },
    'bookmark-paper': id => { CS.state.bookmarks=CS.state.bookmarks.includes(id) ? CS.state.bookmarks.filter(x=>x!==id) : [...CS.state.bookmarks,id]; emitRender(); },
    'paper-note': id => CS.showModal('note',{id}),
    'copy-citation': async id => { const p=CS.data.papers.find(p=>p.id===id); await copyText(citation(p)); },
    'export-bibliography': () => { const papers=CS.state.bookmarks.length ? CS.data.papers.filter(p=>CS.state.bookmarks.includes(p.id)) : CS.data.papers; CS.download('reading_list.md','# SigmaFlow Science · 文献阅读清单\n\n以下为预置文献记录，不是在线检索结果。\n\n'+papers.map(p=>'- '+citation(p)+(CS.state.notes[p.id] ? '\n\n  阅读笔记：'+CS.state.notes[p.id] : '')).join('\n\n')); },
    'search-pubmed': () => { const q=document.getElementById('pubmed-query').value.trim(); if (!q) { CS.toast('请先输入检索关键词。','error'); return; } window.open('https://pubmed.ncbi.nlm.nih.gov/?term='+encodeURIComponent(q),'_blank','noopener,noreferrer'); },
    'open-tool': id => {
      const tool=CS.data.tools.find(t=>t.id===id); if (!tool) return;
      if (tool.url) { window.open(tool.url,'_blank','noopener,noreferrer'); return; }
      CS.ui.activeTool=id; CS.render(); setTimeout(()=>document.querySelector('.tool-workspace')?.scrollIntoView({block:'nearest',behavior:'auto'}),50);
    },
    'load-sequence-example': () => { CS.ui.sequence=CS.data.sampleFASTA; CS.ui.sequenceResult=null; CS.render(); },
    'compute-sequence': () => { CS.ui.sequence=document.getElementById('sequence-input').value; try { CS.ui.sequenceResult=CS.sequenceStats(CS.ui.sequence); CS.render(); CS.toast('已完成本地序列统计。'); } catch(error) { CS.ui.sequenceResult=null; CS.render(); CS.toast(error.message,'error'); } },
    'export-sequence': () => CS.download('sequence_statistics.json',JSON.stringify({source:'local-browser-calculation',gcDenominator:'A+C+G+T',results:CS.ui.sequenceResult},null,2),'application/json'),
    'setting-toggle': id => { CS.state.settings[id]=!CS.state.settings[id]; emitRender(); },
    'sound-preview': () => CS.audio.playDone(true),
    'export-workspace': () => CS.download('sigmaflow_science_workspace.json',JSON.stringify({...CS.state,exportedAt:new Date().toISOString(),containsOriginalFiles:false},null,2),'application/json'),
    'reset-workspace': () => CS.showModal('confirm',{title:'清空并恢复示例？',message:'将清除本地的项目、对话、笔记、任务和文件记录，恢复初始示例。此操作不可撤销，不影响电脑上的原文件。',confirmAction:'confirm-reset',confirmLabel:'清空并恢复',danger:true}),
    'confirm-reset': () => { CS.state.runs.forEach(r=>{ if(['running','paused','connecting'].includes(r.status)) CS.agent.control(r,'cancel'); }); CS.reset(); CS.closeModal(); CS.navigate('home'); CS.toast('已恢复初始演示工作空间。'); },
    'test-api': async () => {
      CS.ui.testing=true; CS.render();
      try {
        const start=performance.now();
        await CS.api.request('/health');
        const ms=Math.round(performance.now()-start);
        const model=CS.ui.models.find(x => x.id === CS.state.settings.modelId) || CS.ui.models.find(x => x.isDefault) || CS.ui.models[0];
        let provider='';
        if (model) {
          const result=await CS.api.modelCall('provider.test', 'POST', '/providers/test', { id: model.providerId });
          provider=' · 模型 '+result.latencyMs+' ms'+(result.ok ? (result.modelCount ? '（'+result.modelCount+' 个可用模型）' : '') : '（失败：'+(result.error || 'HTTP '+result.status)+'）');
        }
        CS.state.settings.latency=ms; CS.state.settings.lastTest='ok';
        CS.ui.apiHealth=`连接成功 · 服务 ${ms} ms`+provider;
        CS.toast(CS.ui.apiHealth);
      }
      catch(error){ CS.state.settings.latency=null; CS.state.settings.lastTest='fail'; CS.ui.apiHealth='连接失败'; CS.toast('接口不可用：'+CS.api.friendlyError(error),'error'); }
      finally{ CS.ui.testing=false; CS.save(); CS.render(); }
    }
  };
  // 文件浏览器右键: 记录光标位渲染菜单; click/Escape 关闭在全局 click 与键盘处理里
  document.addEventListener('contextmenu', ev => {
    const row = ev.target.closest && ev.target.closest('.fs-row');
    if (!row) { if (CS.ui.fsCtx) { CS.ui.fsCtx = null; CS.render(); } return; }
    const type = row.dataset.action === 'fs-dir' ? 'dir' : 'file';
    ev.preventDefault();
    CS.ui.fsCtx = { path: row.dataset.path || '', type, x: ev.clientX, y: ev.clientY };
    CS.render();
  });
  // 会话切换点击丢失安全网: 流式/同步期间的整页重渲染会在 mousedown 与
  // click 之间销毁按钮节点, click 事件随之丢失(表现为点了没反应)。在
  // pointerdown 记下会话按钮, pointerup 时若原节点已被替换(不在 DOM 里),
  // 就地补发切换 —— 节点仍在则让正常 click 路径接管, 不重复执行
  let _convPress = null;
  document.addEventListener('pointerdown', event => {
    const t = event.target.closest?.('[data-action="open-conversation"]');
    if (t) _convPress = { el: t, id: t.dataset.id, at: Date.now(), x: event.clientX, y: event.clientY };
    else _convPress = null;
  }, true);
  document.addEventListener('pointerup', event => {
    const p = _convPress; _convPress = null;
    if (!p || Date.now() - p.at > 1500) return;   // 长按/误触不算
    // 位移阈值: 按下后拖出很远再松开是拖拽而非点击(即使节点已被重渲染替换)
    if (Math.abs((event.clientX || 0) - p.x) > 12 || Math.abs((event.clientY || 0) - p.y) > 12) return;
    if (p.el.isConnected) return;                 // 节点还活着: 正常 click 会送达
    const fn = actions['open-conversation'];
    if (fn) { try { fn(p.id); } catch (error) { console.error(error); } }
  }, true);
  document.addEventListener('click', async event => {
    if (CS.ui.userMenu && !event.target.closest('.workspace-chip')) { CS.ui.userMenu = false; CS.render(); }
    if (CS.ui.modelMenu && !event.target.closest('.model-select')) { CS.ui.modelMenu = false; CS.render(); }
    if (CS.ui.contextMenu && !event.target.closest('.ctx-use')) { CS.ui.contextMenu = false; CS.render(); }
    if (CS.ui.projectMenu && !event.target.closest('.composer-project')) { CS.ui.projectMenu = false; CS.render(); }
    if (CS.ui.projectSettingsMenu && !event.target.closest('.project-link')) { CS.ui.projectSettingsMenu = null; CS.render(); }
    if (CS.ui.fsCtx && !event.target.closest('.fs-ctx-menu')) { CS.ui.fsCtx = null; CS.render(); }
    if (CS.ui.dropdown && !event.target.closest('.dd-wrap')) { CS.ui.dropdown = null; CS.render(); }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      if (nav.dataset.nav==='home') { CS.state.currentRunId=null; CS.ui.composer=''; CS.ui.attachments=[]; CS.save(); }
      CS.navigate(nav.dataset.nav); return;
    }
    if (event.target.classList.contains('modal-backdrop')) { CS.closeModal(); return; }
    if (CS.fileRef.open && !event.target.closest?.('#fileref-menu') && event.target.id !== 'composer-text' && !event.target.closest?.('[data-action="add-attachment"]')) _closeFileRef();
    const target=event.target.closest('[data-action]'); if (!target || target.disabled) return;
    const action=actions[target.dataset.action];
    if (action) { event.preventDefault(); try { await action(target.dataset.id,target); } catch(error) { console.error(error); CS.toast(error.message || '操作失败，请重试。','error'); } }
  });
  document.addEventListener('pointerdown', event => {
    const grip = event.target.closest?.('.term-resizer');
    if (!grip) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = Number(CS.ui.terminal.width) || 480;
    const move = e2 => {
      const w = Math.max(320, Math.min(window.innerWidth - 500, startW + (startX - e2.clientX)));
      CS.ui.terminal.width = w;
      const wrap = document.querySelector('.term-wrap'); if (wrap) wrap.style.width = w + 'px';
      if (CS.ui.terminal.open) requestAnimationFrame(() => CS.agent.pty?.fitNow());
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      CS.persistTermWidth();
      // 拖拽结束立即同步最终尺寸, 避免等去抖延时
      if (CS.ui.terminal.open) CS.agent.pty?.flushResize();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  // 输入框直接粘贴文件/图片: 剪贴板带文件时转为上传(与 + 号同一入口)
  document.addEventListener('paste', ev => {
    const ta = ev.target;
    if (!ta || ta.id !== 'composer-text') return;
    const files = ev.clipboardData && ev.clipboardData.files;
    if (files && files.length) { ev.preventDefault(); uploadLocalFiles(files); }
  });
  document.addEventListener('input', event => {
    const el = event.target;
    // ask 自由输入草稿: 只存到 UI 状态里不重渲染, 否则每次键入都会重建 DOM 丢失焦点
    if (el?.classList?.contains('ask-custom-input')) {
      CS.ui.askDraft = CS.ui.askDraft || {};
      CS.ui.askDraft[el.dataset.key || ''] = el.value;
    }
    // 反馈弹窗备注草稿: 存到 modal 对象不重渲染, 选类别重渲染时带回
    if (el?.id === 'feedback-note' && CS.ui.modal?.type === 'feedback') {
      CS.ui.modal.note = el.value;
    }
    // 流式期间在输入框打字: 就地增删"引导发送"键(不整页重渲染防丢焦点)。
    // 停止键旁边出现一个发送键, 提示此刻发送 = 插入引导而非新会话消息
    if (el?.id === 'composer-text') {
      const wrap = el.closest('.composer')?.querySelector('.composer-submit');
      if (wrap) {
        const has = !!wrap.querySelector('.send-steer');
        const want = !!wrap.querySelector('.send-stop') && el.value.trim();
        if (want && !has) {
          const btn = document.createElement('button');
          btn.type = 'submit';
          btn.className = 'send-button send-steer';
          btn.title = '作为引导消息插入当前任务 · Enter';
          btn.setAttribute('aria-label', '插入引导消息');
          btn.innerHTML = i('up', '', 19);
          wrap.appendChild(btn);
        } else if (!want && has) {
          wrap.querySelector('.send-steer').remove();
        }
      }
    }
    // 通用设置的音量滑杆: 只更新状态与数字标签不重渲染, 松手后 change 再落盘
    if (el?.classList?.contains('sound-volume-input')) {
      CS.state.settings.soundVolume = Math.min(1, Math.max(0, Number(el.value) / 100));
      const label = el.parentElement?.querySelector('.sound-volume-label');
      if (label) label.textContent = `${el.value}%`;
    }
    // 界面缩放滑杆: 拖动即时生效(直接改 body zoom), 不重渲染
    if (el?.classList?.contains('ui-scale-input')) {
      CS.state.settings.uiScale = Math.min(125, Math.max(85, Number(el.value) || 100));
      document.body.style.zoom = String(CS.state.settings.uiScale / 100);
      const label = el.parentElement?.querySelector('.ui-scale-label');
      if (label) label.textContent = `${CS.state.settings.uiScale}%`;
    }
  });
  document.addEventListener('change', event => {
    if (event.target?.classList?.contains?.('sound-volume-input') || event.target?.classList?.contains?.('ui-scale-input')) CS.save();
    // 终端主题切换: 持久化到 settings, 重渲染后所有终端卡立即换肤
    // 消息轨迹配色切换: 持久化到 settings, 根元素 data 属性换肤
    if (event.target?.classList?.contains?.('track-palette-select')) {
      const _pv = String(event.target.value || 'macaron').replace(/[^a-z0-9-]/gi, '').toLowerCase();
      CS.state.settings.trackPalette = ['macaron', 'classic', 'mono'].includes(_pv) ? _pv : 'macaron';
      CS.save(); CS.render(); CS.toast('消息轨迹配色已切换。');
    }
    if (event.target?.classList?.contains?.('terminal-theme-select')) {
      CS.state.settings.terminalTheme = String(event.target.value || 'monokai').replace(/[^a-z0-9-]/gi, '').toLowerCase();
      CS.save(); CS.render(); CS.toast('终端主题已切换。');
    }
    if (event.target?.id === 'fs-upload-input') {
      const picked = [...(event.target.files || [])];
      event.target.value = '';
      CS.uploadFsFiles(picked);
    }
  });
  document.addEventListener('submit', event => {
    const form=event.target; const type=form.dataset.form; if(!type) return; event.preventDefault();
    if(type==='auth') {
      const username=document.getElementById('auth-username').value.trim();
      const password=document.getElementById('auth-password').value;
      const confirmEl=document.getElementById('auth-confirm');
      if(confirmEl && password!==confirmEl.value){CS.toast('两次输入的密码不一致。','error');return;}
      const path='/auth/' + (CS.ui.authTab==='register' ? 'register' : 'login');
      (async () => {
        try {
          const out=await CS.api.request(path,{method:'POST',body:JSON.stringify({username,password})});
          const welcome = CS.ui.authTab === 'register';
          CS.ui.authTab='login'; CS.ui.authDraft=null;
          CS.enterAccount(out, welcome ? `欢迎，${out.user.name}。` : `欢迎回来，${out.user.name}。`);
          CS.agent.loadModels();
          CS.agent.loadProjects().then(() => CS.agent.loadConversations());
          CS.render();
        } catch(error){ CS.toast((error && error.message) || '登录失败。','error'); }
      })();
      return;
    }
    if(type==='composer') {
      const prompt=CS.ui.composer.trim();
      if(!prompt && !(CS.ui.pendingUploads||[]).some(u=>u.status==='done')) return;
      if((CS.ui.pendingUploads||[]).some(u=>u.status==='uploading')) { CS.toast('附件还在上传，稍候再发送。','error'); return; }
      const _dropErr=(CS.ui.pendingUploads||[]).filter(u=>u.status==='error').length;
      if (_dropErr) CS.toast(`已忽略 ${_dropErr} 个上传失败的附件。`, 'info');
      CS.ui.pendingUploads=(CS.ui.pendingUploads||[]).filter(u=>u.status!=='error');
      const active=CS.currentRun();
      if(CS.ui.route==='chat' && active?.kind === 'chat') {
        // pendingUploads 不在此清空: 附件路径(​@[[path]] 标记)在 sendChatMessage
        // 内部读取后注入并自清; 先清会让"已有会话续发"永远丢附件(只有新会话
        // 的 startChat 路径正常)。steer 分支不消费附件, 芯片保留待下轮正常发送
        CS.ui.composer=''; CS.ui.attachments=[]; CS.save();
        sendChatMessage(active,prompt,[]);
      } else if(CS.ui.route==='chat' && active) {
        const run=active; run.messages.push({role:'user',content:prompt,datasetIds:[...CS.ui.attachments],at:new Date().toISOString()});
        run.messages.push({role:'assistant',content:'这是演示对话，不是模型生成的科研解释。当前任务的输入、计划和步骤都可在上方查看；结果中的点云与表达值为合成示例。要获取真实分析，请通过服务端接入模型与经过验证的分析工作流。',at:new Date().toISOString()});
        CS.ui.composer=''; CS.ui.attachments=[]; CS.ui.pendingUploads=[]; CS.save(); CS.render(); setTimeout(()=>document.querySelector('.chat-composer')?.scrollIntoView({block:'end'}),20);
      } else startChat(prompt);
    } else if(type==='project') {
      const name=document.getElementById('project-name').value.trim(); const description=document.getElementById('project-description').value.trim(); const tags=document.getElementById('project-tags').value.split(/[,，]/).map(t=>t.trim()).filter(Boolean).slice(0,5);
      const id=CS.ui.modal.project?.id;
      if(!name) {CS.toast('项目名称不能为空。','error');return;}
      // 目录优先级: 用户显式选择 > 默认根 + 项目名; 编辑既有项目时保留旧 dir
      let dir=CS.ui.modal.pickedDir || CS.ui.projectsRoot+'/'+name;
      if(id) dir = CS.ui.modal.pickedDir || CS.state.projects.find(p=>p.id===id)?.dir || dir;
      if(CS.state.projects.some(p=>p.name.toLowerCase()===name.toLowerCase() && p.id!==id)) {CS.toast('已有同名项目，请换一个名称。','error');return;}
      if(id) Object.assign(CS.state.projects.find(p=>p.id===id),{name,description,tags,dir,updated:CS.today()});
      else { const project={id:CS.uid('pr'),name,description,tags,dir,icon:'folder',created:CS.today(),updated:CS.today(),archived:false};CS.state.projects.unshift(project);CS.state.projectId=project.id; }
      CS.save();CS.closeModal();CS.navigate('projects');CS.toast('项目已保存。');
      const saved=CS.state.projects.find(p=>p.id===id) || (id ? null : CS.state.projects[0]);
      CS.api.modelCall('project.save','POST','/projects',{id:saved.id,name:saved.name,description:saved.description||'',tags:saved.tags||[],icon:saved.icon||'folder',dir:saved.dir||''}).catch(()=>{});
    } else if(type==='remote-project') {
      const name=document.getElementById('remote-project-name').value.trim(); const address=document.getElementById('remote-project-address').value.trim();
      if(!name) {CS.toast('项目名称不能为空。','error');return;}
      if(!address) {CS.toast('远程地址不能为空。','error');return;}
      const project={id:CS.uid('pr'),name,description:'远程项目 · '+address,tags:['远程'],icon:'folder',remote:address,created:CS.today(),updated:CS.today(),archived:false};
      CS.state.projects.unshift(project);CS.state.projectId=project.id;
      CS.save();CS.closeModal();CS.render();CS.toast('已连接远程项目。');
      CS.api.modelCall('project.save','POST','/projects',{id:project.id,name,description:project.description,tags:['远程'],icon:'folder',remote:address}).catch(()=>{});
    } else if(type==='note') {
      const text=document.getElementById('paper-note-text').value; CS.state.notes[CS.ui.modal.id]=text;CS.save();CS.closeModal();CS.render();CS.toast('阅读笔记已保存。');
    }
  });
  // LiteLLM 自动查询: 输入或选择模型名后拉取价格/上下文, 填进表单提示行; 局部更新 hint 不触发重渲染
  CS.fetchModelMetaSoon = immediate => {
    clearTimeout(CS.ui._metaTimer);
    const run = async () => {
      const name = CS.ui.draftModelName?.trim() || '';
      const box = document.getElementById('model-meta-hint');
      if (!box) return;
      if (!name) { box.textContent = ''; CS.ui.modelMeta = null; return; }
      box.textContent = '正在查询 LiteLLM 模型库…';
      try {
        const meta = await CS.api.request('/model-meta?model=' + encodeURIComponent(name));
        CS.ui.modelMeta = meta;
        if (!document.getElementById('model-meta-hint')) return;
        box.innerHTML = meta.matched ? [
          meta.priceInUsdPerM != null ? `输入 $${meta.priceInUsdPerM}/M` : '输入价未公布',
          meta.priceOutUsdPerM != null ? `输出 $${meta.priceOutUsdPerM}/M` : '输出价未公布',
          meta.contextWindow ? `上下文 ${CS.usageNum(meta.contextWindow)}` : '',
          meta.maxOutputTokens ? `最大输出 ${CS.usageNum(meta.maxOutputTokens)}` : '',
          `目录键 ${meta.litellmKey}`,
        ].filter(Boolean).join(' · ') + '（自动读取，可手动覆盖）' : 'LiteLLM 模型库未收录此模型，上下文按默认 131072，建议手动填写。';
      } catch { box.textContent = ''; }
    };
    CS.ui._metaTimer = setTimeout(run, immediate ? 0 : 500);
  };
  const searchBindings={ 'data-search':'data','project-search':'project','paper-search':'literature','tool-search':'tools' };
  document.addEventListener('input',event=>{
    const target=event.target,id=target.id;
    if(id==='composer-text') {CS.ui.composer=target.value; const send=document.querySelector('.send-button');if(send)send.disabled=!target.value.trim()&&!(CS.ui.pendingUploads||[]).some(u=>u.status==='done');CS.updateContextRing();_fileRefPing();}
    else if(searchBindings[id]) {CS.ui.filters[searchBindings[id]]=target.value;CS.render();}
    else if(id==='marker-search') {CS.ui.markerSearch=target.value;CS.render();}
    else if(id==='sequence-input') CS.ui.sequence=target.value;
    else if(id==='model-name') { CS.ui.draftModelName=target.value; CS.fetchModelMetaSoon(); }
    else if(id==='pubmed-query') CS.ui.pubmedQuery=target.value;
    else if(id==='min-genes') CS.ui.minGenes=target.value;
    else if(id==='max-mito') CS.ui.maxMito=target.value;
    else if(id&&id.startsWith('compact-')){ const d=CS.ui.compactionDraft; if(d && target.dataset.field) d[target.dataset.field]=target.value; }
        else if(id==='sysprompt-textarea'){ const d=CS.ui.syspromptDraft||(CS.ui.syspromptDraft={prompt:'',enabled:!!CS.ui.systemPrompt?.enabled}); d.prompt=target.value; }
    else if(target.dataset?.toolId){ const t=(CS.ui.toolDraft||[]).find(x=>x.id===target.dataset.toolId); if(t) t[target.dataset.field]=target.value; if(target.dataset.field==='schema') CS.syncSchemaHighlight(target); }
    else if(target.dataset?.skillId){ const s=(CS.ui.skillDraft||[]).find(x=>x.id===target.dataset.skillId); if(s) s[target.dataset.field]=target.value; }
    else if(target.dataset?.mcpId){ const s=(CS.ui.mcpDraft||[]).find(x=>x.key===target.dataset.mcpId); if(s) s[target.dataset.field]=target.value; }
    else if(id.startsWith('token-')) { const d=CS.ui.tokensDraft||(CS.ui.tokensDraft={}); d[id.slice(6)]=target.value; }
  });
  // 窗口尺寸变化会改变软换行位置, 重新计算两层高度
  window.addEventListener('resize', () => CS.sizeSchemaEditors());
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target.id==='file-input'){handleFiles(target.files);}
    else if(target.dataset.checkDataset){const id=target.dataset.checkDataset;target.checked ? CS.ui.datasetSelection.add(id) : CS.ui.datasetSelection.delete(id);CS.render();}
    else if(target.id==='select-all-data'){
      const f=CS.ui.filters;CS.state.datasets.filter(d=>(f.dataTab==='all'||d.source===f.dataTab)&&(d.name+d.format+d.description).toLowerCase().includes(f.data.toLowerCase())).forEach(d=>target.checked?CS.ui.datasetSelection.add(d.id):CS.ui.datasetSelection.delete(d.id));CS.render();
    } else if(target.id==='workflow-dataset') CS.ui.datasetId=target.value;
    else if(target.id==='workflow-organism') CS.ui.organism=target.value;
  });
  document.addEventListener('keydown',event=>{
    // Ctrl+` 全局开关终端面板, 与 VSCode 惯例一致; 未登录时无终端可用
    if(event.ctrlKey && event.code==='Backquote'){if(CS.state.me?.mode==='multi'&&!(CS.state.me.user&&(CS.state.me.user.name)))return;event.preventDefault();CS.ui.terminal.open=!CS.ui.terminal.open;CS.render();if(CS.ui.terminal.open)setTimeout(()=>CS.agent.pty?.focus(),120);else setTimeout(()=>document.querySelector('.composer-input')?.focus(),80);return;}
    if(event.key==='Escape'){if(CS.ui.modal)CS.closeModal();else if(CS.fileRef.open){event.preventDefault();_closeFileRef();}else if(CS.ui.userMenu){CS.ui.userMenu=false;CS.render();}else if(CS.ui.modelMenu){CS.ui.modelMenu=false;CS.render();}else if(CS.ui.contextMenu){CS.ui.contextMenu=false;CS.render();}else if(CS.ui.mobileSidebar){CS.ui.mobileSidebar=false;CS.render();}return;}
    if(event.altKey && event.key.toLowerCase()==='n'){event.preventDefault();CS.state.currentRunId=null;CS.ui.composer='';CS.ui.attachments=[];CS.save();CS.navigate('home');return;}
    // @file 补全菜单: 打开时接管方向键/Enter/Tab/Esc, 不触发发送
    if(CS.fileRef.open && (event.target.id==='composer-text' || CS.fileRef.mode==='btn')) {
      const fr = CS.fileRef;
      if(event.key==='ArrowDown'){event.preventDefault();fr.active=Math.min(fr.items.length-1,fr.active+1);_renderFileRefMenu();return;}
      if(event.key==='ArrowUp'){event.preventDefault();fr.active=Math.max(0,fr.active-1);_renderFileRefMenu();return;}
      if(event.key==='Escape'){event.preventDefault();_closeFileRef();return;}
      if((event.key==='Enter'||event.key==='Tab') && !event.isComposing){event.preventDefault();const it=fr.items[fr.active];if(it)_applyFileRefPick(it.path, it.type==='dir');return;}
    }
    // 发送键位: enterSend=true 时 Enter 直接发送(Shift+Enter 换行); false 时 Enter 换行, Ctrl/Cmd+Enter 发送
    if(event.target.id==='composer-text' && event.key==='Enter' && !event.isComposing){
      const wantSend = CS.state.settings.enterSend !== false ? !event.shiftKey : !!(event.ctrlKey || event.metaKey);
      if (wantSend) { event.preventDefault(); event.target.closest('form').requestSubmit(); }
    }
    // 项目表单内回车不自动提交, 只能点击保存按钮保存项目
    if(event.key==='Enter' && !event.isComposing && event.target.closest?.('#project-form') && event.target.tagName!=='TEXTAREA'){event.preventDefault();}
    if(event.key==='Tab' && CS.ui.modal){
      const items=[...document.querySelectorAll('.modal button:not([disabled]), .modal input, .modal textarea, .modal select, .modal a[href]')].filter(x=>x.offsetParent!==null);
      if(!items.length)return;const first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
    if((event.key==='Enter'||event.key===' ') && event.target.tagName==='circle'){event.preventDefault();actions['select-cell'](event.target.dataset.id);}
  });
  document.addEventListener('dragover',event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();document.querySelector('[data-dropzone]')?.classList.add('dragover');}});
  document.addEventListener('dragleave',event=>{if(event.target.closest?.('[data-dropzone]'))document.querySelector('[data-dropzone]')?.classList.remove('dragover');});
  document.addEventListener('drop',event=>{
    if(!event.dataTransfer.files.length)return;event.preventDefault();document.querySelector('[data-dropzone]')?.classList.remove('dragover');
    if(event.target.closest('[data-dropzone]') || ['data','home','chat'].includes(CS.ui.route)) {if(!CS.ui.modal)uploadContext=['home','chat'].includes(CS.ui.route)?'attachment':'data';handleFiles(event.dataTransfer.files);}
    else CS.toast('请在数据页面或文件导入区域拖入文件。','error');
  });
  window.addEventListener('error',event=>{console.error('[SigmaFlow Science]',event.message);});
  CS.agent.loadModels = async () => {
    try {
      const [pv, md] = await Promise.all([
        CS.api.modelCall('provider.list', 'GET', '/providers'),
        CS.api.modelCall('model.list', 'GET', '/models'),
      ]);
      CS.ui.providers = Array.isArray(pv.providers) ? pv.providers : [];
      CS.ui.models = Array.isArray(md.models) ? md.models : [];
      CS.ui.modelsLoaded = true;
      // 固定开销(系统提示词+工具定义)的 token 估算, 失败时前端用回退常数
      CS.api.modelCall('context.info', 'GET', '/context-info').then(r => { if (r && r.systemTokens) { CS.ui.contextInfo = r; CS.emit('render'); } }).catch(() => {});
      if (CS.ui.models.length && !CS.ui.models.some(m => m.id === CS.state.settings.modelId)) {
        const def = CS.ui.models.find(m => m.isDefault) || CS.ui.models[0];
        CS.state.settings.modelId = def.id; CS.state.settings.model = def.model;
      }
      CS.save(); CS.emit('render');
    } catch (error) { CS.ui.modelsLoaded = false; }
  };
  CS.ui.route=applyRoute();CS.render();
  // 服务地址自动探测：依次尝试 当前地址 -> 页面前缀推导地址 -> /api，取第一个健康可达者。
  // 必须等它完成再加载模型列表，否则首次访问（无痕窗口/新设备）会用错误地址拉取。
  CS.api.detectEndpoint = async () => {
    const probe = async base => { try { const r = await fetch(base.replace(/\/$/, '') + '/health'); if (!r.ok) return false; return (await r.json()).status === 'ok'; } catch { return false; } };
    const match = location.pathname.match(/^(\/[a-zA-Z0-9_-]+)\/science\/?$/);
    const candidates = [];
    if (CS.state.settings.endpoint) candidates.push(CS.state.settings.endpoint);
    if (match) candidates.push(match[1] + '/api');
    if (!candidates.includes('/api')) candidates.push('/api');
    for (const base of [...new Set(candidates)]) {
      if (await probe(base)) {
        if (CS.state.settings.endpoint !== base) {
          CS.state.settings.endpoint = base; CS.save(); CS.render();
          // 地址已变：重置 WS 状态，让后续连接用新地址
          CS.api.ws.failedAt = 0;
          const stale = CS.api.ws.socket; CS.api.ws.socket = null; CS.api.ws.state = 'closed';
          if (stale) { try { stale.close(); } catch {} }
          CS.toast('服务接口地址已自动设为 ' + base);
        }
        return;
      }
    }
  };
  CS.agent.loadProjects = async () => {
    try {
      let data = await CS.api.modelCall('project.list', 'GET', '/projects');
      if (!data.projects?.length && CS.state.projects.length) {
        for (const p of CS.state.projects.filter(x => !x.archived)) {
          await CS.api.modelCall('project.save', 'POST', '/projects', { id: p.id, name: p.name, description: p.description || '', tags: p.tags || [], icon: p.icon || 'folder', remote: p.remote || null }).catch(() => {});
        }
        data = await CS.api.modelCall('project.list', 'GET', '/projects');
      }
      CS.state.projects = (data.projects || []).map(p => ({ ...p, created: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : CS.today(), updated: p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : CS.today(), archived: false }));
      if (CS.state.projects.length && !CS.state.projects.some(p => p.id === CS.state.projectId)) CS.state.projectId = CS.state.projects[0].id;
      CS.save(); CS.emit('render');
    } catch (error) { /* 服务器不可用时保持本地项目列表 */ }
  };
  CS.uploadFsFiles = async fileList => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const project = CS.state.projects.find(p => p.id === CS.state.projectId);
    if (!project) { CS.toast('请先选择项目再上传文件。', 'error'); return; }
    for (const file of files) {
      if (file.size > 32 * 1024 * 1024) { CS.toast(`${file.name} 超过 32 MB，已跳过。`, 'error'); continue; }
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const out = await CS.api.request('/fs/upload', { method: 'POST', body: JSON.stringify({ projectId: CS.state.projectId, name: file.name, dataBase64: String(dataUrl).split(',')[1] || '' }) });
        CS.toast(`已上传 ${out.name}（${CS.formatBytes(out.size)}）`);
      } catch (error) { CS.toast(`上传 ${file.name} 失败：${(error && error.message) || '未知错误'}`, 'error'); }
    }
    const st = CS.ui.fs;
    if (st) { st.children = {}; st.git = {}; st.root = null; st.loading = true; CS.agent.loadFsDir(''); }
    CS.render();
  };
  CS.agent.loadConversations = async () => {
    try {
      const data = await CS.api.modelCall('conversation.list', 'GET', '/conversations');
      CS.ui.conversations = Array.isArray(data.conversations) ? data.conversations : [];
      // 运行状态以服务端为准: 页面刷新/关闭期间任务的终态已落库, 本地残留的
      // running 标记会让会话永远显示"运行中"且停止按钮空转。本页有在途请求的
      // 会话跳过(chat.send 与本列表存在先后竞态, 在途即真相)
      const _byId = new Map(CS.ui.conversations.map(c => [c.id, c]));
      // activeChats 是 Set(元素为 {requestId, runId}): 直接 .map 会抛错并
      // 静默中止整个列表加载, 必须先展开
      const _inflight = new Set([...(CS.api.ws?.activeChats || [])].map(e => (typeof e === 'string' ? null : e?.runId)).filter(Boolean));
      let _fixed = false;
      for (const r of CS.state.runs || []) {
        if (!['running', 'connecting', 'awaiting', 'paused'].includes(r.status)) continue;
        if (_inflight.has(r.id)) continue;
        const c = _byId.get(r.id);
        if (!c || c.status !== 'running') {
          r.status = 'complete';
          (r.messages || []).forEach(m => { delete m.streaming; });
          _fixed = true;
        }
      }
      if (_fixed) CS.save();
      CS.emit('render');
    } catch (error) { /* 忽略：服务器不可用时保留旧列表 */ }
  };
  CS.agent.registerConversation = run => {
    if (!run) return;
    CS.ui.conversations.unshift({ id: run.id, title: run.title, projectId: run.projectId, createdAt: Date.now(), updatedAt: Date.now() });
    const payload = { id: run.id, title: run.title, projectId: run.projectId };
    const real = (run.messages || []).filter(m => m.role === 'user' || m.role === 'assistant' && m.content);
    if (real.length) payload.content = real.map(m => ({ role: m.role, content: m.content }));  // 空则不带 → 服务端保留已有
    CS.api.modelCall('conversation.save', 'POST', '/conversations', payload)
      .then(() => CS.agent.loadConversations()).catch(() => {});
  };
  const _fsRefreshAll = () => {
    const st = CS.ui.fs; if (!st) return;
    const keep = new Set([...st.expanded]);
    st.children = {}; st.git = {}; st.loading = true;
    CS.agent.loadFsDir('');
    for (const path of keep) if (path) CS.agent.loadFsDir(path);
  };
  CS.agent.loadFsDir = async path => {
    const st = CS.ui.fs; if (!st) return;
    try {
      const data = await CS.api.request('/fs/tree?projectId=' + encodeURIComponent(st.projectId) + '&path=' + encodeURIComponent(path || ''), { method: 'GET' });
      const cur = CS.ui.fs; if (!cur || cur.projectId !== st.projectId) return;
      if (path) { cur.children[path] = data.entries || []; cur.expanded.add(path); } else cur.root = data.entries || [];
      cur.git = { ...cur.git, ...(data.git || {}) };
      cur.loading = false;
      CS.emit('render');
    } catch (error) {
      const cur = CS.ui.fs; if (cur && cur.projectId === st.projectId) {
        cur.loading = false;
        if (!path && !Array.isArray(cur.root)) { cur.root = []; cur.error = (error && error.message) || ''; }
        // 子目录请求失败也必须落地一个数组: 渲染层以 children[path] 是否为
        // 数组判断"数据已到", 失败不填的话该行 spinner 永远不消失
        if (path && !Array.isArray(cur.children[path])) cur.children[path] = [];
      }
      CS.emit('render');
    }
  };
  // present 的 3D 预览: cell3d.min.js 组件包(THREE/GLTFLoader/DRACO/OrbitControls)
  // 裸搭场景; modal 关闭时整体释放
  CS.present3dDispose = () => {
    const v = CS._presentViewer; if (!v) return;
    try { cancelAnimationFrame(v.raf); } catch {}
    try { v.renderer.dispose(); v.renderer.forceContextLoss && v.renderer.forceContextLoss(); } catch {}
    CS._presentViewer = null;
  };
  CS.mountPresent3D = (stageId, url) => {
    CS.present3dDispose();
    if (!window.CellViewer) {
      if (CS._presentLazyBusy) return;
      CS._presentLazyBusy = true;
      CS.ensureLazy('cell3d.min').then(() => {
        CS._presentLazyBusy = false;
        if (window.CellViewer) CS.mountPresent3D(stageId, url);
      });
      return;
    }
    const CV = window.CellViewer;
    const stage = document.getElementById(stageId);
    if (!stage || !CV) { if (stage) stage.innerHTML = '<p class="small muted" style="padding:20px">3D 预览不可用。</p>'; return; }
    const w = stage.clientWidth || 640, h = stage.clientHeight || 480;
    const renderer = new CV.THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(w, h);
    renderer.toneMapping = CV.THREE.ACESFilmicToneMapping;
    stage.appendChild(renderer.domElement);
    const scene = new CV.THREE.Scene();
    const camera = new CV.THREE.PerspectiveCamera(45, w / h, 0.01, 2000);
    const pmrem = new CV.THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new CV.RoomEnvironment(), 0.04).texture;
    const key = new CV.THREE.DirectionalLight(0xffffff, 2.0); key.position.set(3, 5, 2); scene.add(key);
    const rim = new CV.THREE.DirectionalLight(0xbfd4ff, 0.7); rim.position.set(-4, 2, -3); scene.add(rim);
    const controls = new CV.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const v = { renderer, raf: 0 };
    CS._presentViewer = v;
    controls.addEventListener('change', () => { v.needsRender = true; });
    const render = () => { v.raf = requestAnimationFrame(render); if (controls.update()) v.needsRender = true; renderer.render(scene, camera); };
    render();
    try {
      const draco = new CV.DRACOLoader(); draco.setDecoderPath('vendor/draco/');
      const loader = new CV.GLTFLoader(); loader.setDRACOLoader(draco);
      loader.load(url, gltf => {
        scene.add(gltf.scene);
        const box = new CV.THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new CV.THREE.Vector3()); const center = box.getCenter(new CV.THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        camera.position.set(center.x + maxDim * 0.9, center.y + maxDim * 0.7, center.z + maxDim * 1.2);
        camera.lookAt(center);
        controls.target.copy(center);
        v.needsRender = true;
      }, undefined, () => { stage.innerHTML = '<p class="small muted" style="padding:20px">模型加载失败。</p>'; });
    } catch {}
  };
  const _origClose = CS.closeModal;
  CS.closeModal = function() {
    if (CS.ui.modal && CS.ui.modal.type === 'fs-preview') CS.present3dDispose();
    return _origClose();
  };

  // present 卡片预览: 与 fs-preview 共用后端(/fs/file), 渲染按 klass 分派
  CS.agent.presentPreview = async entry => {
    // 项目外文件(如 /tmp 产物)以绝对路径展示: 无 projectId 也可预览(服务端
    // 对绝对路径走同一黑名单护栏); 相对路径仍必须携带项目
    const abs = /^[/~]/.test(entry.path || '');
    if (!entry.pid && !abs) { CS.toast('该文件不在项目目录内，无法预览。', 'error'); return; }
    try {
      const qs = (entry.pid ? 'projectId=' + encodeURIComponent(entry.pid) + '&' : '') + 'path=' + encodeURIComponent(entry.path);
      const data = await CS.api.request('/fs/file?' + qs, { method: 'GET' });
      CS.showModal('fs-preview', { name: entry.title || entry.name, path: entry.path, ...data, presentKlass: entry.klass, presenting: true });
    } catch (error) { CS.toast('无法读取该文件：' + CS.api.friendlyError(error), 'error'); }
  };
  CS.agent.previewFsFile = async path => {
    const st = CS.ui.fs; if (!st) return;
    try {
      const data = await CS.api.request('/fs/file?projectId=' + encodeURIComponent(st.projectId) + '&path=' + encodeURIComponent(path), { method: 'GET' });
      CS.showModal('fs-preview', { name: path.split('/').pop(), ...data });
    } catch { CS.toast('无法读取该文件。', 'error'); }
  };
  CS.api.detectEndpoint().finally(async () => {
    // 微信扫码回跳: 主窗或弹窗先交换会话再继续启动; 弹窗关闭并通知主窗
    const qp = new URLSearchParams(location.search);
    if (qp.get('code') && qp.get('state')) {
      const wasPopup = !!window.opener;
      history.replaceState(null, '', location.pathname + location.hash);
      try {
        const out = await CS.api.request('/auth/wechat/exchange', { method: 'POST', body: JSON.stringify({ code: qp.get('code'), state: qp.get('state') }) });
        if (wasPopup) {
          try { window.opener.postMessage({ type: 'wechat-login-ok', user: out.user }, location.origin); } catch {}
          setTimeout(() => window.close(), 100);
          return;
        }
        CS.state.me = out;
      } catch (wxError) {
        CS.toast('微信登录未完成：' + ((wxError && wxError.message) || '请重新扫码'), 'error');
      }
    }
    try { CS.state.me = await CS.api.request('/auth/me', { method: 'GET' }); } catch { CS.state.me = null; }
    CS.api.request('/auth/wechat/config').then(cfg => {
      const on = !!(cfg && cfg.enabled);
      if (on !== CS.state.wechatLogin) { CS.state.wechatLogin = on; if (CS.ui.route === 'auth') CS.render(); }
    }).catch(() => { });
    CS.emit('render');
    const me = CS.state.me;
    if (me && me.mode === 'multi' && !(me.user && me.user.name)) { CS.ui.route = 'auth'; CS.showAuthGate(); return; }
    CS.agent.loadModels();
    CS.agent.loadProjects().then(() => CS.agent.loadConversations());
  });
  if(CS.storageUnavailable)CS.toast('浏览器存储不可用，当前仅在内存运行。','error');
})();
