/* Human-in-the-loop demo state machine + transport adapter.
 * Prefers a WebSocket connection (/api/ws) and falls back to HTTP + SSE.
 * No LLM, bioinformatics binary, shell command or uploaded file is executed here.
 */
(() => {
  'use strict';
  const activeSources = new Map();

  // ---------------------------------------------------------------- transport

  CS.api = {
    url(path) {
      const base = CS.state.settings.endpoint.trim().replace(/\/$/, '');
      if (base.startsWith('/') && !base.startsWith('//')) {
        if (location.protocol === 'file:') throw new Error('接口模式请通过 npm run dev 打开网页，而非 file://');
        return base + path;
      }
      const parsed = new URL(base);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('接口地址必须是无账号密码、查询参数的 HTTP(S) 地址');
      if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('非本机接口必须使用 HTTPS');
      return base + path;
    },
    wsUrl() {
      const base = CS.state.settings.endpoint.trim().replace(/\/$/, '');
      if (base.startsWith('/') && !base.startsWith('//')) {
        if (location.protocol === 'file:') throw new Error('接口模式请通过 npm run dev 打开网页，而非 file://');
        return (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + base + '/ws';
      }
      const parsed = new URL(base);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('接口地址必须是无账号密码、查询参数的 HTTP(S) 地址');
      if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) throw new Error('非本机接口必须使用 HTTPS');
      return parsed.protocol.replace('https', 'wss').replace('http', 'ws') + '//' + parsed.host + parsed.pathname + '/ws';
    },
    async request(path, options = {}) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), options.timeout || 15000);
      try {
        const response = await fetch(CS.api.url(path), { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers }, signal: controller.signal });
        if (!response.ok) {
          let detail = `HTTP ${response.status}`;
          try { const body = await response.json(); if (body?.detail) detail = String(body.detail); } catch {}
          // 登录过期/未登录时统一唤起登录浮层
          if (response.status === 401 && path !== '/auth/me' && typeof CS.handleAuthLoss === 'function') setTimeout(() => { try { CS.handleAuthLoss(); } catch {} }, 0);
          throw new Error(detail);
        }
        return await response.json();
      } finally { clearTimeout(timer); }
    }
  };

  // Model-config operations prefer the WebSocket channel (immune to CORS
  // preflight failures); HTTP fetch is the fallback when WS is unavailable.
  CS.api.modelCall = async (wsAction, httpMethod, httpPath, body) => {
    if (await CS.api.ws.connect()) {
      // GET 路径参数(如 /conversations/{id}/content)转成 WS payload, 后端按 data 取用
      const payload = { ...(body || {}) };
      if (httpMethod === 'GET') {
        const m = httpPath.match(/^\/conversations\/([^/]+)\/content$/);
        if (m) payload.id = decodeURIComponent(m[1]);
      }
      return CS.api.ws.send(wsAction, payload);
    }
    return CS.api.request(httpPath, { method: httpMethod, body: body ? JSON.stringify(body) : undefined });
  };
  CS.api.chat = async (messages, onDelta, onThink, onTool, onRetry) => {
    // 会话所属项目随请求下发: 服务端把项目工作目录绑定为本次对话的工具执行目录;
    // 优先取当前会话自身绑定的 projectId(全局 state 可能停留在无项目状态)
    const run = CS.state.runs.find(x => x.id === CS.state.currentRunId);
    const payload = { modelId: CS.state.settings.modelId, projectId: run?.projectId ?? CS.state.projectId, runId: CS.state.currentRunId, messages };
    if (await CS.api.ws.connect()) {
      const data = await CS.api.ws.chat(payload, onDelta, onThink, onTool, onRetry);
      return { content: data.content, tokens: data.tokens || 0, promptTokens: data.promptTokens || 0 };
    }
    const data = await CS.api.request('/chat', { method: 'POST', timeout: 600000, body: JSON.stringify(payload) });
    return { content: data.content, tokens: data.tokens || 0, promptTokens: data.promptTokens || 0 };
  };
  CS.api.friendlyError = error => /fetch/i.test(error.message)
    ? '无法连接服务器：请确认 sigmaflow serve 已启动、接口地址与页面同源（如 /api），并已重启到最新代码。'
    : error.message;

  // WebSocket transport: one long-lived connection, request/reply matched by
  // requestId, interleaved with pushed "state" snapshots for subscribed runs.
  CS.api.ws = {
    socket: null, state: 'closed', seq: 0, connecting: null, failedAt: 0,
    pending: new Map(), onState: new Map(), activeChats: new Set(),
    open() { return this.socket && this.socket.readyState === 1; },
    connect(timeout = 3500) {
      if (this.open()) return Promise.resolve(true);
      if (this.connecting) return this.connecting;
      if (Date.now() - this.failedAt < 30000) return Promise.resolve(false);
      this.connecting = new Promise(resolve => {
        let settled = false;
        const finish = ok => { if (!settled) { settled = true; this.connecting = null; if (!ok) this.failedAt = Date.now(); resolve(ok); } };
        let socket;
        try { socket = new WebSocket(CS.api.wsUrl()); }
        catch { return finish(false); }
        const timer = setTimeout(() => finish(false), timeout);
        socket.onopen = () => { clearTimeout(timer); this.socket = socket; this.state = 'open'; this.failedAt = 0; finish(true); };
        socket.onmessage = event => {
          if (event.data instanceof Blob) { event.data.arrayBuffer().then(ab => CS.agent.pty?.feed(new Uint8Array(ab))); return; }
          if (event.data instanceof ArrayBuffer) { CS.agent.pty?.feed(new Uint8Array(event.data)); return; }
          let message;
          try { message = JSON.parse(event.data); } catch { return; }
          if (message.event === 'pty.closed') { CS.agent.pty?.markDead(); if (message.requestId && CS.api.ws.pending.has(message.requestId)) CS.api.ws.pending.get(message.requestId).resolve?.({}); return; }
          if (message.event === 'state' && message.data?.id) {
            const handler = CS.api.ws.onState.get(message.data.id);
            if (handler) handler(message.data);
          } else if (message.requestId && CS.api.ws.pending.has(message.requestId)) {
            const entry = CS.api.ws.pending.get(message.requestId);
            // 长推理场景下生成可持续很久: 每收到新分片就重置空闲计时,
            // 只在连续无活动超过阈值时才判定超时
            if (message.event === 'chat.delta' || message.event === 'chat.think' || message.event === 'chat.tool') entry.resetTimer && entry.resetTimer();
            if (message.event === 'chat.stop.ack') { return; }  // 停止确认不是聊天回复, 等真正的 chat.done
            if (message.event === 'chat.think' && entry.onThink) { entry.onThink(message.data?.delta || ''); return; }
            if (message.event === 'chat.tool' && entry.onTool) { entry.onTool(message.data?.tool || {}, message.requestId); return; }
            if (message.event === 'chat.retry') { entry.onRetry && entry.onRetry(message.data?.retry || {}); return; }
            if (message.event === 'chat.delta' && entry.onDelta) { entry.onDelta(message.data?.delta || ''); return; }
            CS.api.ws.pending.delete(message.requestId);
            CS.api.ws.activeChats.delete(message.requestId);
            clearTimeout(entry.timer);
            message.event === 'error' ? entry.reject(new Error(message.data?.error || '接口返回错误')) : entry.resolve(message.data);
          }
        };
        socket.onclose = (ev) => {
          // 记录关闭码便于排查: 1006 表示异常断开(网络中断/被中间层掐断), 1000 为正常关闭
          try { console.warn('[ws] connection closed', { code: ev && ev.code, reason: ev && ev.reason, hadChat: this.activeChats && this.activeChats.size > 0 }); } catch {}
          if (this.socket === socket) { this.socket = null; this.state = 'closed'; }
          const code = ev && ev.code;
          const hint = code === 1006 ? 'WebSocket 异常断开（可能因网络中断或链路长时间无数据被回收）。当前回复已中断，可发送“继续”让模型接着此前内容重来。' : 'WebSocket 连接已关闭。';
          CS.api.ws._fail(new Error(hint));
        };
        socket.onerror = () => { clearTimeout(timer); finish(false); };
      });
      return this.connecting;
    },
    _fail(reason) {
      for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(reason); }
      this.pending.clear();
      this.activeChats.clear();
      for (const handler of this.onState.values()) handler(null, reason);
    },
    send(action, payload = {}, timeout = 10000) {
      if (!this.open()) return Promise.reject(new Error('WebSocket 未连接。'));
      const requestId = String(++this.seq);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { CS.api.ws.pending.delete(requestId); reject(new Error('WebSocket 响应超时。')); }, timeout);
        this.pending.set(requestId, { resolve, reject, timer });
        this.socket.send(JSON.stringify({ action, requestId, ...payload }));
      });
    },
    chat(payload, onDelta, onThink, onTool, onRetry) {
      if (!this.open()) return Promise.reject(new Error('WebSocket 未连接。'));
      const requestId = String(++this.seq);
      this.activeChats.add(requestId);
      const ws = this;  // Promise executor 内 this 不指向 CS.api.ws
      return new Promise((resolve, reject) => {
        // 空闲超时而非总时长上限: 只要模型还在持续产出就不误杀,
        // 只折断真正卡死的连接
        const idleMs = ws.chatIdleTimeout || 180000;
        const fail = () => { CS.api.ws.pending.delete(requestId); CS.api.ws.activeChats.delete(requestId); reject(new Error('模型响应超时。')); };
        const entry = { resolve, reject, timer: null, resetTimer: null, onDelta, onThink, onTool, onRetry };
        entry.timer = setTimeout(fail, idleMs);
        entry.resetTimer = () => { clearTimeout(entry.timer); entry.timer = setTimeout(fail, idleMs); };
        CS.api.ws.pending.set(requestId, entry);
        ws.socket.send(JSON.stringify({ action: 'chat.send', requestId, ...payload }));
      });
    },
    // 停止所有进行中的生成: 服务端以已生成内容收尾并下发 chat.done
    stopChats() {
      if (!this.socket || this.state !== 'open') return;
      for (const requestId of this.activeChats) {
        try { this.socket.send(JSON.stringify({ action: 'chat.stop', requestId })); } catch { /* 连接已断时忽略 */ }
      }
    },
    bind(run) {
      if (!run?.remoteId) return;
      this.onState.set(run.remoteId, (data, error) => error ? CS.agent.disconnect(run, error) : CS.agent.applyState(run, data));
    }
  };

  // ---------------------------------------------------------------- agent

  CS.agent = {
    create(prompt, workflowId = 'singlecell', datasetIds = [], config = {}) {
      const workflow = CS.workflow(workflowId);
      const run = {
        id: CS.uid('run'), title: workflow.title, projectId: CS.state.projectId,
        prompt, workflowId: workflow.id, datasetIds: [...datasetIds], config,
        createdAt: new Date().toISOString(), status: 'awaiting', progress: 0,
        transport: CS.state.settings.mode, isDemo: true, messages: [],
        steps: workflow.steps.map((s, i) => ({ title: s[0], description: s[1], tool: s[2], output: s[3], progress: 0, status: 'waiting', index: i }))
      };
      CS.state.runs.push(run); CS.state.currentRunId = run.id; CS.save(); return run;
    },
    applyState(run, data) {
      if (!['running', 'paused', 'complete', 'cancelled', 'error'].includes(data.status)) throw new Error('Invalid task status');
      if (!Array.isArray(data.steps) || data.steps.length !== run.steps.length) throw new Error('Invalid step count');
      run.status = data.status;
      run.progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
      data.steps.forEach((step, i) => {
        run.steps[i].progress = Math.max(0, Math.min(100, Number(step.progress) || 0));
        run.steps[i].status = ['waiting','running','complete'].includes(step.status) ? step.status : 'waiting';
        if (typeof step.output === 'string') run.steps[i].output = step.output.slice(0, 5000);
      });
      if (['complete', 'cancelled', 'error'].includes(run.status)) {
        activeSources.get(run.id)?.close(); activeSources.delete(run.id);
        if (run.remoteId) CS.api.ws.onState.delete(run.remoteId);
      }
      CS.save(); CS.emit('render');
    },
    disconnect(run, error) {
      if (!['complete', 'cancelled', 'error'].includes(run.status)) {
        run.status = 'error'; run.error = error?.message || '事件连接中断，请重试。'; CS.save(); CS.emit('render');
      }
    },
    async approve(run) {
      if (!run || !['awaiting', 'paused', 'error'].includes(run.status)) return;
      run.reloaded = false;
      if (run.transport === 'remote') {
        run.status = 'connecting';        CS.emit('render');
        if (await CS.api.ws.connect()) {
          run.channel = 'ws';
          try {
            if (!run.remoteId) {
              const created = await CS.api.ws.send('run.create', { prompt: run.prompt, workflowId: run.workflowId, projectId: run.projectId, datasetIds: run.datasetIds, config: run.config, steps: run.steps.map(({ title, description, tool }) => ({ title, description, tool })) });
              run.remoteId = created.id;
            } else {
              const snapshot = await CS.api.ws.send('run.get', { id: run.remoteId });
              if (!['complete', 'cancelled'].includes(snapshot.status)) await CS.api.ws.send('run.control', { id: run.remoteId, control: 'resume' });
              CS.agent.applyState(run, snapshot);
            }
            CS.api.ws.bind(run);
            CS.api.ws.send('run.subscribe', { id: run.remoteId }).catch(() => {});
          } catch (error) { run.status = 'error'; run.error = error.message; CS.toast('Agent 接口连接失败：' + error.message, 'error'); }
        } else {
          run.channel = 'sse';
          try {
            if (!run.remoteId) {
              const response = await CS.api.request('/runs', { method: 'POST', body: JSON.stringify({ prompt: run.prompt, workflowId: run.workflowId, projectId: run.projectId, datasetIds: run.datasetIds, config: run.config, steps: run.steps.map(({ title, description, tool }) => ({ title, description, tool })) }) });
              if (!response.id) throw new Error('服务响应缺少任务 id');
              run.remoteId = response.id;
            } else {
              const snapshot = await CS.api.request(`/runs/${encodeURIComponent(run.remoteId)}`);
              if (!['complete', 'cancelled'].includes(snapshot.status)) await CS.api.request(`/runs/${encodeURIComponent(run.remoteId)}/control`, { method: 'POST', body: JSON.stringify({ action: 'resume' }) });
            }
            CS.agent.listen(run);
          } catch (error) { run.status = 'error'; run.error = error.message; CS.toast('Agent 接口连接失败：' + error.message, 'error'); }
        }
      } else run.status = 'running';
      CS.save(); CS.emit('render');
    },
    listen(run) {
      activeSources.get(run.id)?.close();
      const source = new EventSource(CS.api.url(`/runs/${encodeURIComponent(run.remoteId)}/events`), { withCredentials: true });
      activeSources.set(run.id, source);
      source.addEventListener('state', event => {
        try {
          CS.agent.applyState(run, JSON.parse(event.data));
          if (['complete', 'cancelled', 'error'].includes(run.status)) { source.close(); activeSources.delete(run.id); }
        } catch (error) { source.close(); run.status = 'error'; run.error = '无法解析事件：' + error.message; CS.save(); CS.emit('render'); }
      });
      source.onerror = () => { source.close(); activeSources.delete(run.id); if (run.status !== 'complete') { run.status = 'error'; run.error = '事件连接中断，请重试。'; CS.save(); CS.emit('render'); } };
    },
    async control(run, action) {
      if (!run) return;
      try {
        if (run.transport === 'remote' && run.remoteId) {
          if (run.channel === 'ws' && CS.api.ws.open()) await CS.api.ws.send('run.control', { id: run.remoteId, control: action });
          else await CS.api.request(`/runs/${encodeURIComponent(run.remoteId)}/control`, { method: 'POST', body: JSON.stringify({ action }) });
        }
        run.status = { pause: 'paused', resume: 'running', cancel: 'cancelled' }[action];
        if (action === 'cancel') {
          if (run.channel === 'ws') CS.api.ws.onState.delete(run.remoteId);
          activeSources.get(run.id)?.close(); activeSources.delete(run.id);
        }
      } catch (error) { CS.toast(error.message, 'error'); }
      CS.save(); CS.emit('render');
    },
    tick() {
      let changed = false;
      for (const run of CS.state.runs) {
        if (run.status !== 'running' || run.transport === 'remote') continue;
        const step = run.steps.find(s => s.status !== 'complete');
        if (!step) { run.status = 'complete'; run.progress = 100; changed = true; continue; }
        step.status = 'running'; step.progress = Math.min(100, step.progress + 25);
        if (step.progress === 100) step.status = 'complete';
        run.progress = Math.round(run.steps.reduce((n, s) => n + s.progress, 0) / run.steps.length);
        if (run.steps.every(s => s.status === 'complete')) { run.status = 'complete'; run.completedAt = new Date().toISOString(); CS.toast('演示任务已完成，可查看图表与报告。'); }
        changed = true;
      }
      if (changed) { CS.save(); CS.emit('render'); }
    }
  };
  setInterval(() => CS.agent.tick(), 700);
})();

// ===== 交互终端(xterm.js + PTY): 与服务端共享持久会话, 断开重连回放缓冲 =====
CS.agent.pty = {
  term: null, fit: null, attached: null, dead: false, resizing: 0,

  ensure() {
    if (typeof Terminal === 'undefined') return false;
    if (!this.term) {
      const t = new Terminal({
        fontSize: 12, fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
        cursorBlink: true, scrollback: 5000,
        theme: { background: '#1d2135', foreground: '#e6e9f5', cursor: '#8b88d6', cursorAccent: '#1d2135', selectionBackground: '#3d405e' },
      });
      const fit = new FitAddon.FitAddon();
      t.loadAddon(fit);
      t.onData(text => this.input(text));
      t.onResize(size => {
        if (this.attached && size.cols > 0 && size.rows > 0) this.resize(size.cols, size.rows);
      });
      this.term = t; this.fit = fit;
    }
    return true;
  },

  mount() {
    const host = document.getElementById('term-xhost');
    if (!host || !CS.ui.terminal?.open || !this.ensure()) return;
    if (!this.term.element) {
      this.term.open(host);
    } else if (this.term.element.parentNode !== host) {
      host.appendChild(this.term.element);
      try { this.term.refresh(0, this.term.rows - 1); } catch { /* 搬迁后强制重绘 */ }
    }
    requestAnimationFrame(() => this.fit && this.fitNow());
    const project = CS.state.projectId;
    if (project && this.attached !== project) this.attach(project);
  },

  fitNow() {
    if (!this.fit || !this.term.element || !CS.ui.terminal?.open) return;
    try {
      const before = this.term.cols + 'x' + this.term.rows;
      this.fit.fit();
      const after = this.term.cols + 'x' + this.term.rows;
      if (before !== after && this.attached) this.resize(this.term.cols, this.term.rows);
    } catch { /* 容器不可见时忽略 */ }
  },

  async attach(projectId) {
    this.attached = projectId;
    this.dead = false;
    try { this.term.reset(); } catch { /* 清屏以便回放 */ }
    try {
      const { cols, rows } = this.fit ? this.fit.proposeDimensions() : { cols: 90, rows: 28 };
      CS.ui.terminal.cols = cols; CS.ui.terminal.rows = rows;
      await CS.api.ws.send('pty.open', { projectId, cols, rows });
      if (this.attached === projectId) requestAnimationFrame(() => { this.fitNow(); this.focus(); });
    } catch { /* attach 失败解除标记, 允许输入/挂载时重试 */ if (this.attached === projectId) this.attached = null; }
  },

  input(text) {
    if (!this.attached) { this.attach(CS.state.projectId); return; }
    if (this.dead) { this.attach(this.attached); return; } // 进程退出后按 Enter 重开
    CS.api.ws.send('pty.input', { projectId: this.attached, data: text }).catch(() => {});
  },

  // 连续拖拽会触发密集的 SIGWINCH, bash readline 每次都重绘提示符, 留下一串
  // 重复 PS1 行; 这里做 200ms 去抖, 停稳后只发送一次最终尺寸。
  resize(cols, rows) {
    if (!this.attached) return;
    this.pending = { cols, rows };
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.flushResize(), 200);
  },

  flushResize() {
    if (this.resizeTimer) { clearTimeout(this.resizeTimer); this.resizeTimer = null; }
    if (this.pending && this.attached) {
      CS.api.ws.send('pty.resize', { projectId: this.attached, ...this.pending }).catch(() => {});
      this.pending = null;
    }
  },

  feed(bytes) {
    if (!this.term || !this.attached) return;
    this.term.write(bytes);
  },

  markDead() {
    if (!this.term || !this.attached) return;
    this.dead = true;
    this.term.write('\r\n\x1b[33m── 进程已退出，按回车重新打开终端 ──\x1b[0m\r\n');
    this.attached = null;
  },

  clear() {
    try { this.term ? this.term.clear() : null; } catch { /* 忽略 */ }
    if (this.dead === true) { this.dead = false; this.attach(CS.state.projectId); }
    this.focus();
  },

  focus() { try { if (CS.ui.terminal.open) this.term?.focus(); } catch { /* 忽略 */ } },
};
