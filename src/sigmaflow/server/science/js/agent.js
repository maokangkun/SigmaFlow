/* Human-in-the-loop demo state machine + optional HTTP/SSE adapter.
 * No LLM, bioinformatics binary, shell command or uploaded file is executed here.
 */
(() => {
  'use strict';
  const activeSources = new Map();
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
    async approve(run) {
      if (!run || !['awaiting', 'paused', 'error'].includes(run.status)) return;
      run.reloaded = false;
      if (run.transport === 'remote') {
        run.status = 'connecting'; CS.emit('render');
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
      } else run.status = 'running';
      CS.save(); CS.emit('render');
    },
    listen(run) {
      activeSources.get(run.id)?.close();
      const source = new EventSource(CS.api.url(`/runs/${encodeURIComponent(run.remoteId)}/events`), { withCredentials: true });
      activeSources.set(run.id, source);
      source.addEventListener('state', event => {
        try {
          const data = JSON.parse(event.data);
          if (!['running', 'paused', 'complete', 'cancelled', 'error'].includes(data.status)) throw new Error('Invalid task status');
          if (!Array.isArray(data.steps) || data.steps.length !== run.steps.length) throw new Error('Invalid step count');
          run.status = data.status;
          run.progress = Math.max(0, Math.min(100, Number(data.progress) || 0));
          data.steps.forEach((step, i) => {
            run.steps[i].progress = Math.max(0, Math.min(100, Number(step.progress) || 0));
            run.steps[i].status = ['waiting','running','complete'].includes(step.status) ? step.status : 'waiting';
            if (typeof step.output === 'string') run.steps[i].output = step.output.slice(0, 5000);
          });
          if (['complete', 'cancelled', 'error'].includes(run.status)) { source.close(); activeSources.delete(run.id); }
          CS.save(); CS.emit('render');
        } catch (error) { source.close(); run.status = 'error'; run.error = '无法解析事件：' + error.message; CS.save(); CS.emit('render'); }
      });
      source.onerror = () => { source.close(); activeSources.delete(run.id); if (run.status !== 'complete') { run.status = 'error'; run.error = '事件连接中断，请重试。'; CS.save(); CS.emit('render'); } };
    },
    async control(run, action) {
      if (!run) return;
      try {
        if (run.transport === 'remote' && run.remoteId) await CS.api.request(`/runs/${encodeURIComponent(run.remoteId)}/control`, { method: 'POST', body: JSON.stringify({ action }) });
        run.status = { pause: 'paused', resume: 'running', cancel: 'cancelled' }[action];
        if (action === 'cancel') { activeSources.get(run.id)?.close(); activeSources.delete(run.id); }
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
    async request(path, options = {}) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(CS.api.url(path), { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers }, signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally { clearTimeout(timer); }
    }
  };
  setInterval(() => CS.agent.tick(), 700);
})();
