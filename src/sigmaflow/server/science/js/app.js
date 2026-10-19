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
    return { route: allowedRoutes.includes(value) ? value : 'home', id: null };
  };
  const readRoute = () => parseHash().route;
  const applyRoute = () => {
    const { route, id } = parseHash();
    if (route === 'chat' && id && CS.state.currentRunId !== id) {
      CS.state.currentRunId = id;
      const run = CS.state.runs.find(r => r.id === id);
      if (run?.projectId) CS.state.projectId = run.projectId;
      if (!run) loadRemoteConversation(id);
    }
    return route;
  };
  CS.navigate = (route, runId) => {
    CS.ui.mobileSidebar = false;
    CS.ui.userMenu = false;
    if (!allowedRoutes.includes(route)) route = 'home';
    const id = route === 'chat' ? (runId || CS.state.currentRunId || null) : null;
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
      const segs = [
        `<span class="sys-seg sys-os" title="${CS.escape(s.os)}">${CS.escape(s.os)}</span>`,
        `<span class="sys-seg" title="${CS.escape(s.cpu.model)}">CPU ${s.cpu.cores}核 ${sysBar(s.cpu.usage)} ${Math.round(s.cpu.usage)}%</span>`,
        `<span class="sys-seg" title="内存占用">内存 ${s.memory.used_gb}/${s.memory.total_gb}GB ${sysBar(s.memory.percent)}</span>`,
        ...((s.disks || [s.disk]).map((d, i) =>
          `<span class="sys-seg" title="磁盘占用 (${CS.escape(d.path)})">${i ? CS.escape(d.path) : '磁盘'} ${d.used_gb}/${d.total_gb}GB ${sysBar(d.percent)}</span>`)),
        `<span class="sys-seg" title="网速">网速 ↑${fmtBps(s.net.up_bps)} ↓${fmtBps(s.net.down_bps)}</span>`,
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
    _origRender();
    // 工具设置的参数编辑框需要按内容自适应高度, 在每次渲染后同步
    CS.sizeSchemaEditors();
    const el = document.getElementById('sys-stats');
    if (el && _sysStatsHtml) el.innerHTML = _sysStatsHtml;
    if (hadConv) { const fresh = document.querySelector('.conversation'); if (fresh) fresh.scrollTop = savedTop; }
    CS.syncAnchorRail();
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
    document.title = 'SigmaFlow Science · ' + ({ home: '科研工作空间', chat: 'Agent 对话', data: '数据集', projects: '项目', workflows: '工作流', results: '分析结果', literature: '文献', tools: '生物工具', tasks: '任务队列', settings: '设置', help: '帮助' }[CS.ui.route] || '工作空间');
  });

  const loadRemoteConversation = async id => {
    const fetchContent = () => CS.api.modelCall('conversation.content', 'GET', `/conversations/${encodeURIComponent(id)}/content`);
    try {
      let data;
      try { data = await fetchContent(); }
      catch (first) { await new Promise(r => setTimeout(r, 800)); data = await fetchContent(); }  // WS抖动重试一次
      if (!data.content?.length) { CS.toast('该会话在服务端没有同步到消息内容。', 'error'); return; }
      const meta = CS.ui.conversations.find(c => c.id === id) || {};
      const run = { id, kind: 'chat', title: meta.title || data.title || '会话', projectId: data.projectId, prompt: '', datasetIds: [], config: {},
              messages: data.content.map(m => {
                const msg = { role: m.role, content: m.content, at: m.at || new Date().toISOString(), ...(m.reasoning ? { reasoning: m.reasoning } : {}), ...(m.tools?.length ? { tools: m.tools } : {}), ...(m.asks?.length ? { asks: m.asks } : {}), ...(m.deliverables?.length ? { deliverables: m.deliverables } : {}), ...(m.error ? { error: m.error } : {}), ...(m.tokens ? { tokens: m.tokens, promptTokens: m.promptTokens, elapsed: m.elapsed } : {}) };
                // 旧格式记录压平了时间线, 加载时重建为 think/tool/text 块以便按时间线展示
                if (msg.role === 'assistant' && (msg.reasoning || msg.tools?.length || msg.asks?.length || msg.deliverables?.length)) {
                  const blocks = [];
                  if (msg.reasoning) blocks.push({ type: 'think', text: msg.reasoning });
                  for (const t of msg.tools || []) blocks.push({ type: 'tool', name: t.name, args: t.args, result: t.result });
                  for (const a of msg.asks || []) blocks.push({ type: 'ask', id: a.id, questions: a.questions, answered: !!a.answered, result: a.result, answers: Array.isArray(a.answers) ? a.answers : null, stale: !a.answered });
                  if (msg.content) blocks.push({ type: 'text', text: msg.content });
                  if (msg.deliverables?.length) blocks.push({ type: 'deliverables', files: msg.deliverables });
                  msg.blocks = blocks;
                }
                return msg;
              }),
              steps: [], createdAt: meta.createdAt ? new Date(meta.createdAt).toISOString() : new Date().toISOString(), status: 'complete', progress: 0, transport: 'chat', isDemo: false };
      CS.state.runs.push(run);
      if (data.projectId) CS.state.projectId = data.projectId;
      if (CS.state.currentRunId !== id) { CS.state.currentRunId = id; CS.save(); CS.navigate('chat', id); }
      else CS.save();
      CS.render();
      CS.toast('已从服务端加载该会话内容。');
    } catch (error) { CS.toast('加载会话内容失败：' + CS.api.friendlyError(error), 'error'); }
  };
  const startChat = prompt => {
    const run = {
      id: CS.uid('run'), kind: 'chat', title: prompt.slice(0, 24) || '新会话',
      projectId: CS.state.projectId, prompt, datasetIds: [...CS.ui.attachments], config: {},
      messages: [], steps: [], createdAt: new Date().toISOString(), status: 'complete',
      progress: 0, transport: 'chat', isDemo: false,
    };
    CS.state.runs.push(run); CS.state.currentRunId = run.id; CS.save();
    CS.agent.registerConversation(run);
    CS.ui.composer = ''; CS.ui.attachments = []; CS.ui.expandedLogs.clear();
    CS.navigate('chat', run.id);
    sendChatMessage(run, prompt, run.datasetIds);
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
    if (CS.ui.systemPrompt) return;
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
    const payload = {
      id: run.id, title: run.title, projectId: run.projectId,
      pinned: !!conv?.pinned, archived: !!conv?.archived,
      content: run.messages.filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content, at: m.at, ...(m.model ? { model: m.model } : {}), ...(m.reasoning ? { reasoning: m.reasoning } : {}), ...(m.tools?.length ? { tools: m.tools } : {}), ...(m.asks?.length ? { asks: m.asks } : {}), ...(m.deliverables?.length ? { deliverables: m.deliverables } : {}), ...(m.error ? { error: m.error } : {}), ...(m.tokens ? { tokens: m.tokens, promptTokens: m.promptTokens, elapsed: m.elapsed } : {}) })),
    };
    try { await CS.api.modelCall('conversation.save', 'POST', '/conversations', payload); }
    catch { if (retry) setTimeout(() => syncConversation(run, false), 3000); }
  };
  // ---- @file 引用(dsh file-reference 思路的轻量版) ----
  // 输入 @ 弹出项目目录补全菜单(独立 DOM, 不进 render 流, 避免重渲染丢焦点);
  // 发送时把 @路径 解析成文件内容附加进当轮上下文, 仅发送侧注入不回显。
  CS.fileRef = { open: false, items: [], active: 0, start: 0, token: '', query: '' };
  const _fsTreeCache = {};
  const _fsListDir = async path => {
    const pid = CS.state.projectId;
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
    if (!ta || !CS.state.projectId) { _closeFileRef(); return; }
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
    Object.assign(CS.fileRef, { open: items.length > 0, items, active: 0, start, token: '@' + token, query: token, dir });
    _renderFileRefMenu();
  };
  const _renderFileRefMenu = () => {
    const fr = CS.fileRef;
    const ta = document.getElementById('composer-text');
    let el = document.getElementById('fileref-menu');
    if (!fr.open || !ta) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'fileref-menu'; el.className = 'fileref-menu'; document.body.appendChild(el); }
    const r = ta.getBoundingClientRect();
    el.style.left = Math.max(8, r.left) + 'px';
    el.style.top = Math.max(8, r.top - Math.min(320, 40 + fr.items.length * 36)) + 'px';
    el.style.minWidth = Math.max(240, Math.min(430, r.width * 0.6)) + 'px';
    el.innerHTML = '<div class="fileref-head">引用项目文件 · ↑↓ 选择 · Enter 确认</div>' + fr.items.map((it, idx) =>
      `<button type="button" class="fileref-item${idx === fr.active ? ' active' : ''}" data-action="pick-fileref" data-path="${e(it.path)}" data-isdir="${it.type === 'dir' ? 1 : ''}">${i(it.type === 'dir' ? 'folder' : 'file', '', 14)}<span class="fileref-name">${e(it.name)}</span>${it.type === 'dir' ? '<span class="tiny muted">目录</span>' : ''}</button>`
    ).join('');
  };
  const _applyFileRefPick = (path, isDir) => {
    const ta = document.getElementById('composer-text'); const fr = CS.fileRef;
    if (!ta) return;
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

  const sendChatMessage = async (run, text, datasetIds) => {
    run.messages.push({ role: 'user', content: text, datasetIds: [...datasetIds], at: new Date().toISOString() });
    // @file 引用注入: @路径 在项目目录下读出文件内容, 作为 refContext 附在发送侧
    // (展示仍用原文; 刷新后 refContext 不持久, 模型可再用 read 工具读文件)
    const _lastUser = run.messages[run.messages.length - 1];
    if (_lastUser.role === 'user' && /@[\w][\w./-]*/.test(text)) {
      try {
        const pid = run.projectId || CS.state.projectId;
        if (pid) {
          const tokens = [...new Set((text.match(/@[\w][\w./-]*/g) || []).map(t => t.slice(1)))].slice(0, 5);
          const parts = [];
          for (const t of tokens) {
            try {
              const data = await CS.api.request('/fs/file?projectId=' + encodeURIComponent(pid) + '&path=' + encodeURIComponent(t), { method: 'GET' });
              if (data && !data.binary && typeof data.content === 'string' && data.content.trim()) {
                parts.push('<file path="' + t + '">\n' + data.content.slice(0, 16000) + (data.content.length > 16000 ? '\n…(内容过长已截断)' : '') + '\n</file>');
              }
            } catch {}
          }
          if (parts.length) _lastUser.refContext = '<referenced-files>\n用户在消息中引用了以下项目文件, 内容如下:\n' + parts.join('\n') + '\n</referenced-files>';
        }
      } catch {}
    }
    // blocks: 按到达顺序的时间线段(think/tool/text), loop 会话里多轮交替不会互相覆盖;
    // content/reasoning/tools 是从 blocks 汇出的镜像, 兼容历史/持久化/复制等旧读方
    const mirror = () => {
      reply.content = reply.blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      reply.reasoning = reply.blocks.filter(b => b.type === 'think').map(b => b.text).join('');
      reply.tools = reply.blocks.filter(b => b.type === 'tool').map(b => ({ name: b.name, args: b.args, result: b.result }));
      reply.asks = reply.blocks.filter(b => b.type === 'ask').map(b => ({ id: b.id, questions: b.questions, answered: !!b.answered, result: b.result || '', ...(b.answers ? { answers: b.answers } : {}) }));
      reply.deliverables = reply.blocks.filter(b => b.type === 'deliverables').flatMap(b => b.files || []);
    };
    const lastBlock = () => reply.blocks[reply.blocks.length - 1];
    const pushThink = think => {
      const last = lastBlock();
      if (last && last.type === 'think') last.text += think;
      else reply.blocks.push({ type: 'think', text: think });
    };
    const pushDelta = delta => {
      const last = lastBlock();
      if (last && last.type === 'text') last.text += delta;
      else reply.blocks.push({ type: 'text', text: delta });
    };
    const pushTool = (t, reqId) => {
      // pi 式压缩: 服务器把头几轮替换为摘要; 前端丢弃对应轮次并置入摘要卡,
      // 会话列表变短后随 reply 结束的同步一起持久化, 下轮请求上下文即已压缩
      if (t.kind === 'compact' && t.text) {
        const dropped = Math.max(0, Math.floor(Number(t.removed) || 0));
        const card = { id: 'cmp-' + Math.random().toString(36).slice(2, 8), role: 'user', compact: true, content: String(t.text), at: new Date().toISOString() };
        if (dropped) run.messages.splice(0, dropped);
        run.messages.unshift(card);
        CS.save(); CS.render();
        return;
      }
      // 产出文件行(dsh deliverables 思路): 后到的事件携带全量清单, 移除旧块重挂尾部
      if (t.kind === 'deliverables' && Array.isArray(t.files)) {
        reply.blocks = reply.blocks.filter(b => b.type !== 'deliverables');
        if (t.files.length) reply.blocks.push({ type: 'deliverables', files: t.files });
        return;
      }
      // 每次工具调用独立成块, 不再合并进之前的工具列表
      if (t.kind === 'call') {
        // ask 的通用工具卡跳过: 问题卡片由专门的 ask 事件负责
        if (t.isAsk) return;
        reply.blocks.push({ type: 'tool', name: t.name, args: t.args, result: null });
      } else if (t.kind === 'ask') {
        reply.blocks.push({ type: 'ask', id: t.id, requestId: reqId, questions: Array.isArray(t.questions) ? t.questions : [], answered: false });
      } else {
        if (t.isAsk) {
          const ab = [...reply.blocks].reverse().find(b => b.type === 'ask' && !b.answered);
          if (ab) { ab.answered = true; if (!ab.result) ab.result = t.result; return; }
        }
        const ent = [...reply.blocks].reverse().find(b => b.type === 'tool' && b.name === t.name && b.result == null);
        if (ent) ent.result = t.result;
        else reply.blocks.push({ type: 'tool', name: t.name, result: t.result });
      }
    };
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
      const history = run.messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.role === 'user' && m.refContext ? m.content + '\n\n' + m.refContext : m.content }));
      timerInterval = setInterval(() => {
        if (!reply.streaming) { clearInterval(timerInterval); return; }
        // 流式期间上下文占用也在增长, 顺带同步圆环显示
        CS.updateContextRing();
        // 只匹配本轮的活跃计时元素(完成标签是 elapsed-done, 无 data-start)
        const el = document.querySelector('.elapsed-timer[data-start="' + CSS.escape(reply.at) + '"]');
        if (el) el.textContent = CS.elapsed(el.dataset.start);
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
        const follow = nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false;
        CS.render();
        if (follow) scrollToLatest();
      };
      // 模型请求失败进入重试: 在等待指示处显示第 N/3 次失败与原因
      const retryEvent = r => {
        if (!r || !r.attempt) return;
        CS.ui.chatRetry = { runId: run.id, attempt: r.attempt, total: r.total || 3, error: r.error || '' };
        CS.render();
      };
      const done = await CS.api.chat(history, delta => {
        if (CS.ui.chatRetry) CS.ui.chatRetry = null;
        pushDelta(delta);
        mirror();
        reply.tokens = (reply.tokens || 0) + estTokens(delta);
        const now = Date.now();
        if (now - _chatRenderAt > 120) { _chatRenderAt = now; const follow = nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false; if (!updateStreamingDom(reply)) CS.render(); if (follow) scrollToLatest(); }
      }, think => {
        if (CS.ui.chatRetry) CS.ui.chatRetry = null;
        pushThink(think);
        mirror();
        reply.tokens = (reply.tokens || 0) + estTokens(think);
        CS.ui.thinkingText = reply.reasoning;
        const now = Date.now();
        if (now - _chatRenderAt > 120) { _chatRenderAt = now; const follow = nearBottom() && !CS.ui.followLock && CS.state.settings.autoScroll !== false; if (!updateStreamingDom(reply)) CS.render(); if (follow) scrollToLatest(); }
      }, toolEvent, retryEvent);
      // 正文以流式时间线为准(保留各轮文本); 服务端最终内容仅在本地没收到任何文本时兑底
      if (!reply.content && typeof done.content === 'string' && done.content) {
        reply.content = done.content;
        // WS 断线后走 HTTP 同步接口的场景没有流式回调, blocks 里不会有文本段;
        // 兑底内容必须同时转成 text 块, 否则渲染出空消息
        if (!reply.blocks.some(b => b.type === 'text')) reply.blocks.push({ type: 'text', text: done.content });
      }
      if (done.tokens) reply.tokens = done.tokens;  // 真实 usage(含思考 token), 覆盖流式粗估
      if (done.promptTokens) reply.promptTokens = done.promptTokens;
      CS.audio.playDone();  // 回复完成提示音; 出错分支不播放
    } catch (error) {
      // 失败不再伪装成正文追在 content 里, 而是挂到 error 字段,
      // 由红色错误块呈现(可展开看详情), 已流出的部分正文保持原样
      const msg = CS.api.friendlyError(error);
      reply.error = { message: msg, detail: error?.stack ? (msg + '\n\n' + error.stack) : msg };
    }
    finishTimer();
    reply.blocks = reply.blocks.filter(b => b.type === 'tool' || b.type === 'ask' || b.type === 'deliverables' || !!b.text);  // 丢弃中途产生的空段
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
      body = modal.binary
        ? `<div class="modal-pad"><p class="small muted">二进制文件（${CS.formatBytes(modal.size)}），不支持预览。</p></div>`
        : `<div class="modal-pad"><div class="row-between mb-20"><span class="small muted mono">${e(modal.path || '')}</span><span class="small muted">${CS.formatBytes(modal.size)}</span></div><pre style="max-height:62vh;overflow:auto;margin:0">${e(modal.content || '')}</pre>${modal.truncated ? '<p class="small muted mt-12">内容过大，仅显示前 512 KB。</p>' : ''}</div>`;
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
    'fs-refresh': () => {
      const st = CS.ui.fs; if (!st) return;
      st.children = {}; st.git = {}; st.loading = true;
      const keep = [...st.expanded];
      st.expanded = new Set(keep);
      CS.agent.loadFsDir('');
      CS.render();
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
      _applyFileRefPick(el.dataset.path || '', el.dataset.isdir === '1');
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
      navigator.clipboard?.writeText(m.content).then(() => CS.toast('已复制到剪贴板。')).catch(() => CS.toast('复制失败。', 'error'));
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
    'toggle-error': (id, el) => _toggleAnchored(el, () => {
      // 展开状态按 消息键 存储: 点哪条只开哪条, 不再全局串开
      const k = el?.dataset?.errkey;
      if (!k) return;
      const set = CS.ui.errorOpenSet || (CS.ui.errorOpenSet = new Set());
      if (set.has(k)) set.delete(k); else set.add(k);
    }),
    'jump-latest': () => { CS.ui.canJumpLatest = false; CS.render(); scrollToLatest(); },
    'open-conversation': id => {
      if (!CS.state.runs.some(r => r.id === id) && !CS.ui.conversations.some(c => c.id === id)) { CS.toast('该会话不存在。', 'error'); return; }
      CS.expandProject((CS.ui.conversations.find(c => c.id === id) || {}).projectId);
      CS.navigate('chat', id);
    },
    'connect-project': () => { CS.ui.projectMenu = false; CS.showModal('remote-project'); },
    'submit-remote-project': () => {},
    'settings-tab': id => { CS.ui.settingsTab = id; CS.render(); if (id === 'tools') { CS.loadAgentTools(); CS.loadAgentTokens(); } if (id === 'skills') CS.loadAgentSkills(); if (id === 'mcp') CS.loadAgentMcp(); if (id === 'keys') CS.loadAgentTokens(); if (id === 'sysprompt') CS.loadSystemPrompt(); if (id === 'context') CS.loadAgentCompaction(); if (id === 'usage') CS.loadUsage(); },
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
    'add-attachment': () => chooseFiles('attachment'),
    'import-data': () => { uploadContext='data'; CS.showModal('import'); },
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
  document.addEventListener('click', async event => {
    if (CS.ui.userMenu && !event.target.closest('.workspace-chip')) { CS.ui.userMenu = false; CS.render(); }
    if (CS.ui.modelMenu && !event.target.closest('.model-select')) { CS.ui.modelMenu = false; CS.render(); }
    if (CS.ui.contextMenu && !event.target.closest('.ctx-use')) { CS.ui.contextMenu = false; CS.render(); }
    if (CS.ui.projectMenu && !event.target.closest('.composer-project')) { CS.ui.projectMenu = false; CS.render(); }
    if (CS.ui.projectSettingsMenu && !event.target.closest('.project-link')) { CS.ui.projectSettingsMenu = null; CS.render(); }
    if (CS.ui.dropdown && !event.target.closest('.dd-wrap')) { CS.ui.dropdown = null; CS.render(); }
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      if (nav.dataset.nav==='home') { CS.state.currentRunId=null; CS.ui.composer=''; CS.ui.attachments=[]; CS.save(); }
      CS.navigate(nav.dataset.nav); return;
    }
    if (event.target.classList.contains('modal-backdrop')) { CS.closeModal(); return; }
    if (CS.fileRef.open && !event.target.closest?.('#fileref-menu') && event.target.id !== 'composer-text') _closeFileRef();
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
      const prompt=CS.ui.composer.trim(); if(!prompt) return;
      const active=CS.currentRun();
      if(CS.ui.route==='chat' && active?.kind === 'chat') {
        CS.ui.composer=''; CS.ui.attachments=[]; CS.save();
        sendChatMessage(active,prompt,[]);
      } else if(CS.ui.route==='chat' && active) {
        const run=active; run.messages.push({role:'user',content:prompt,datasetIds:[...CS.ui.attachments],at:new Date().toISOString()});
        run.messages.push({role:'assistant',content:'这是演示对话，不是模型生成的科研解释。当前任务的输入、计划和步骤都可在上方查看；结果中的点云与表达值为合成示例。要获取真实分析，请通过服务端接入模型与经过验证的分析工作流。',at:new Date().toISOString()});
        CS.ui.composer=''; CS.ui.attachments=[]; CS.save(); CS.render(); setTimeout(()=>document.querySelector('.chat-composer')?.scrollIntoView({block:'end'}),20);
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
    if(id==='composer-text') {CS.ui.composer=target.value; const send=document.querySelector('.send-button');if(send)send.disabled=!target.value.trim();CS.updateContextRing();_fileRefPing();}
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
    if(event.key==='Escape'){if(CS.ui.modal)CS.closeModal();else if(CS.ui.userMenu){CS.ui.userMenu=false;CS.render();}else if(CS.ui.modelMenu){CS.ui.modelMenu=false;CS.render();}else if(CS.ui.contextMenu){CS.ui.contextMenu=false;CS.render();}else if(CS.ui.mobileSidebar){CS.ui.mobileSidebar=false;CS.render();}return;}
    if(event.altKey && event.key.toLowerCase()==='n'){event.preventDefault();CS.state.currentRunId=null;CS.ui.composer='';CS.ui.attachments=[];CS.save();CS.navigate('home');return;}
    // @file 补全菜单: 打开时接管方向键/Enter/Tab/Esc, 不触发发送
    if(CS.fileRef.open && (event.target.id==='composer-text')) {
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
      const cur = CS.ui.fs; if (cur && cur.projectId === st.projectId) { cur.loading = false; if (!path && !Array.isArray(cur.root)) { cur.root = []; cur.error = (error && error.message) || ''; } }
      CS.emit('render');
    }
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
