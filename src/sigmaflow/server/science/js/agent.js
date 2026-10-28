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
      // 单体路径(删除/更新项目与会话等): path 里的 id 同样要走 WS 的 data.id, 否则后端取空报不存在
      const one = httpPath.match(/^\/(projects|conversations)\/([^/]+)\/?$/);
      if (one) payload.id = decodeURIComponent(one[2]);
      if (httpMethod === 'GET') {
        const m = httpPath.match(/^\/conversations\/([^/]+)\/content$/);
        if (m) payload.id = decodeURIComponent(m[1]);
      }
      return CS.api.ws.send(wsAction, payload);
    }
    return CS.api.request(httpPath, { method: httpMethod, body: body ? JSON.stringify(body) : undefined });
  };
  // 第 7/8 参: onProgress(长工具心跳"已运行 Xs") / onSystem(实发 system 提示词)
  CS.api.chat = async (messages, onDelta, onThink, onTool, onRetry, onUsage, onProgress, onSystem) => {
    // 会话所属项目随请求下发: 服务端把项目工作目录绑定为本次对话的工具执行目录;
    // 优先取当前会话自身绑定的 projectId(全局 state 可能停留在无项目状态)
    const run = CS.state.runs.find(x => x.id === CS.state.currentRunId);
    const payload = { modelId: CS.state.settings.modelId, projectId: run?.projectId ?? CS.state.projectId, runId: CS.state.currentRunId, messages, planMode: !!CS.ui.planMode };
    if (await CS.api.ws.connect()) {
      const data = await CS.api.ws.chat(payload, onDelta, onThink, onTool, onRetry, onUsage, onProgress, onSystem);
      if (data.system && typeof data.system === 'string' && onSystem) onSystem(data.system);
      // 透传 contextTokens/cacheTokens: 标题栏 usage 行与存档回放的数据源头
      return { content: data.content, tokens: data.tokens || 0, promptTokens: data.promptTokens || 0,
        contextTokens: data.contextTokens || 0, cacheTokens: data.cacheTokens || 0 };
    }
    const data = await CS.api.request('/chat', { method: 'POST', timeout: 600000, body: JSON.stringify(payload) });
    return { content: data.content, tokens: data.tokens || 0, promptTokens: data.promptTokens || 0,
      contextTokens: data.contextTokens || 0, cacheTokens: data.cacheTokens || 0, compaction: data.compaction };
  };
  CS.api.friendlyError = error => /fetch/i.test(error.message)
    ? '无法连接服务器：请确认 sigmaflow serve 已启动、接口地址与页面同源（如 /api），并已重启到最新代码。'
    : error.message;

  // WebSocket transport: one long-lived connection, request/reply matched by
  // requestId, interleaved with pushed "state" snapshots for subscribed runs.
  CS.api.ws = {
    socket: null, state: 'closed', seq: 0, connecting: null, failedAt: 0,
    pending: new Map(), onState: new Map(), activeChats: new Set(), suspended: new Map(),
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
            // journal 续播游标: 记录最后收到的 seq, 断线重连后从它无损续播
            if (typeof message.seq === 'number') entry.lastSeq = message.seq;
            // 长推理场景下生成可持续很久: 每收到新分片就重置空闲计时,
            // 只在连续无活动超过阈值时才判定超时
            if (message.event === 'chat.progress') { entry.resetTimer && entry.resetTimer(); if (entry.onProgress) entry.onProgress(message.data || {}); return; }
            if (message.event === 'chat.delta' || message.event === 'chat.think' || message.event === 'chat.tool' || message.event === 'chat.usage') {
              // ask 问题卡挂起后进入等待用户回答的静默期, 可能远超常规空闲阈值:
              // 此时暂停空闲计时改用长兜底, 否则用户思考超过阈值会把回复误判为超时,
              // 后续分片因 pending 条目被删而全部丢失; 回答后的新分片经 resetTimer 恢复常规判定
              const tool = message.data?.tool;
              if (message.event === 'chat.tool' && tool && tool.kind === 'ask') entry.pauseIdle && entry.pauseIdle();
              else entry.resetTimer && entry.resetTimer();
            }
            if (message.event === 'chat.stop.ack') { return; }  // 停止确认不是聊天回复, 等真正的 chat.done
            if (message.event === 'chat.think' && entry.onThink) { entry.onThink(message.data?.delta || ''); return; }
            if (message.event === 'chat.tool' && entry.onTool) { entry.onTool(message.data?.tool || {}, message.requestId); return; }
            if (message.event === 'chat.usage') { entry.onUsage && entry.onUsage(message.data || {}); return; }
            if (message.event === 'chat.system') { entry.onSystem && entry.onSystem(message.data?.content || ''); return; }
            if (message.event === 'chat.retry') { entry.onRetry && entry.onRetry(message.data?.retry || {}); return; }
            if (message.event === 'chat.delta' && entry.onDelta) { entry.onDelta(message.data?.delta || ''); return; }
            CS.api.ws.suspended.delete(message.requestId);
            CS.api.ws.pending.delete(message.requestId);
            CS.api.ws.activeChats.forEach(x => { if (x && x.requestId === message.requestId) CS.api.ws.activeChats.delete(x); });
            clearTimeout(entry.timer);
            try { entry.onFinishOnce && entry.onFinishOnce(); entry.onFinishOnce = null; } catch {}
            message.event === 'error' ? entry.reject(new Error(message.data?.error || '接口返回错误')) : entry.resolve(message.data);
          }
        };
        socket.onclose = (ev) => {
          // 记录关闭码便于排查: 1006 表示异常断开(网络中断/被中间层掐断), 1000 为正常关闭
          try { console.warn('[ws] connection closed', { code: ev && ev.code, reason: ev && ev.reason, hadChat: this.activeChats && this.activeChats.size > 0 }); } catch {}
          if (this.socket === socket) { this.socket = null; this.state = 'closed'; }
          const code = ev && ev.code;
          // 断线时正在执行的对话: 服务端 work() 继续跑完并兜底归档,
          // 这里自动重连(无需刷新页面), 成功后按 runId 拉会话存档合并终态
          const _interrupted = [...this.activeChats].map(x => (x && x.runId) || '').filter(Boolean);
          const hadChat = _interrupted.length > 0;
          const hint = code === 1006
            ? 'WebSocket 异常断开（网络不稳或链路被回收）。任务已在服务端后台继续执行，恢复连接后自动同步。'
            : 'WebSocket 连接已关闭。任务已在服务端后台继续执行，恢复连接后自动同步。';
          if (hadChat) {
            CS.api.ws._suspend(hint);
            this._autoReconnect(_interrupted);
          } else {
            CS.api.ws._fail(new Error(hint));
          }
        };
        socket.onerror = () => { clearTimeout(timer); finish(false); };
      });
      return this.connecting;
    },
    // 挂起: 断线时不终止进行中的对话请求——任务在服务端后台继续执行,
    // entry 连同流式回调转入 suspended, 自动重连成功后 chat.replay 按
    // seq 续播, 中间缺失的消息无损补齐; startChat 的 promise 保持未决,
    // 页面呈现"恢复中"而非失败
    _suspend(reason) {
      const chatIds = new Set([...this.activeChats].map(x => x && x.requestId).filter(Boolean));
      for (const [rid, entry] of this.pending) {
        if (chatIds.has(rid)) {
          entry.pauseIdle && entry.pauseIdle();  // 断线窗口不计常规空闲, 挂长兜底
          const runId = ([...this.activeChats].find(x => x && x.requestId === rid) || {}).runId || '';
          this.suspended.set(rid, { entry, runId, reason });
        } else {
          clearTimeout(entry.timer);
          entry.reject(new Error(reason));
        }
      }
      this.pending.clear();
      this.activeChats.clear();
      for (const handler of this.onState.values()) handler(null, new Error(reason));
    },
    // 重连成功: 逐个把挂起请求重挂 pending 并向服务端申请 journal 续播;
    // 服务端任务无论仍在跑还是早已跑完都按 seq 补齐并继续, 回调即恢复渲染
    _resumeSuspended() {
      if (!this.open() || this.suspended.size === 0) return;
      for (const [rid, info] of [...this.suspended]) {
        this.suspended.delete(rid);
        try {
          this.pending.set(rid, info.entry);
          info.entry.resetTimer && info.entry.resetTimer();
          this.activeChats.add({ requestId: rid, runId: info.runId || '' });
          this.socket.send(JSON.stringify({ action: 'chat.replay', requestId: rid, lastSeq: typeof info.entry.lastSeq === 'number' ? info.entry.lastSeq : -1 }));
        } catch { try { info.entry.reject(new Error('恢复连接失败。任务仍在后台执行，稍后重开会话可同步。')); } catch {} }
      }
    },
    // 深度离线看门狗: 三档退避都失败后, 每 15s 探测连接直到恢复;
    // 服务端 journal 无期限保留(容量上限内), 无论断多久都能无损续播
    async _offlineWatchdog() {
      while (this.suspended.size > 0) {
        await new Promise(r => setTimeout(r, 15000));
        if (this.suspended.size === 0) return;
        this.failedAt = 0;
        try { const ok = await this.connect(4000); if (ok) { this._resumeSuspended(); return; } } catch {}
      }
    },
    // 断线自动重连: 2.5s / 8s / 20s 三档退避; 成功后续播挂起请求并通知
    // app 层; 三档全失败转离线看门狗, 网络恢复后照样续播, 用户零操作
    async _autoReconnect(runIds, attempt = 0) {
      const delays = [2500, 8000, 20000];
      if (attempt >= delays.length) { this._offlineWatchdog(); return; }
      await new Promise(r => setTimeout(r, delays[attempt]));
      if (this.suspended.size === 0) return;
      if (this.open()) { this._resumeSuspended(); if (CS.agent._afterWsRestored) { try { await CS.agent._afterWsRestored(runIds); } catch {} } return; }
      this.failedAt = 0;  // 绕过 30s 连接冷却, 尽快恢复
      let ok = false;
      try { ok = await this.connect(4000); } catch {}
      if (ok) {
        this._resumeSuspended();
        if (CS.agent._afterWsRestored) { try { await CS.agent._afterWsRestored(runIds); } catch {} }
      } else this._autoReconnect(runIds, attempt + 1);
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
    chat(payload, onDelta, onThink, onTool, onRetry, onUsage, onProgress, onSystem) {
      if (!this.open()) return Promise.reject(new Error('WebSocket 未连接。'));
      const requestId = String(++this.seq);
      // runId 随请求记录: 断线自动重连后按 runId 拉取会话存档合并终态
      this.activeChats.add({ requestId, runId: payload.runId || '' });
      const ws = this;  // Promise executor 内 this 不指向 CS.api.ws
      return new Promise((resolve, reject) => {
        // 空闲超时而非总时长上限: 只要模型还在持续产出就不误杀,
        // 只折断真正卡死的连接
        const idleMs = ws.chatIdleTimeout || 180000;
        const fail = () => { CS.api.ws.pending.delete(requestId); CS.api.ws.activeChats.forEach(x => { if (x && x.requestId === requestId) CS.api.ws.activeChats.delete(x); }); reject(new Error('模型响应超时。')); };
        const entry = { resolve, reject, timer: null, resetTimer: null, onDelta, onThink, onTool, onRetry, onUsage, onProgress, onSystem };
        entry.timer = setTimeout(fail, idleMs);
        entry.resetTimer = () => { clearTimeout(entry.timer); entry.timer = setTimeout(fail, idleMs); };
        // ask 等待期不计常规空闲: 服务端 ask 超时为 1 小时, 前端以 2 小时兜底防永久挂起
        entry.pauseIdle = () => { clearTimeout(entry.timer); entry.timer = setTimeout(fail, 2 * 60 * 60 * 1000); };
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
      for (const requestId of this.suspended.keys()) {
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
