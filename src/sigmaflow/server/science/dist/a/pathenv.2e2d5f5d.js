/* ================= 虚拟病原体 · AI 面板(环境桥 + 对话面板) =================
 * 与 patenv.js 的患者面板同协议(session/poll/result/chat/answer)与同一套
 * .pai 样式; 体征条/消息/工具卡的数据源换成本环境的引擎状态。
 * 会话首轮由服务端建档到侧栏项目「虚拟病原体」(pr-pathogen-env)。
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const P = {
    sessionId: '', conversationId: '', projectId: '', open: false, busy: false,
    pollStop: false, messages: [], advancing: false, el: {},
  };
  window.__PathAI = P;
  const rich = s => CS.escape(String(s)).replace(/&lt;(\/?b)&gt;/g, '<$1>');
  const H = () => window.PathoHost;
  const Pop = () => window.PathoPop;

  // ---------------- 体征条(面板开着时轮询刷新) ----------------
  function renderVitals() {
    if (!P.el.vitals) return;
    const s = H() && H().state();
    if (!s) { P.el.vitals.innerHTML = '<span>未载入场景</span>'; return; }
    const L = Math.log10(Math.max(1e-2, H().load()));
    const tot = s.N + s.Nr;
    const rfrac = tot > 1 ? s.Nr / tot : 0;
    const warn = L > 7 || s.host.temp > 38.5;
    P.el.vitals.innerHTML = [
      `<span>${CS.escape(s.entry.zh)}</span>`,
      `<span class="${warn ? 'warn' : ''}">t ${s.t.toFixed(1)}d</span>`,
      `<span class="${L > 7 ? 'crit' : ''}">载量 10^${L.toFixed(1)}</span>`,
      `<span class="${s.host.temp > 38.5 ? 'warn' : ''}">体温 ${s.host.temp.toFixed(1)}°C</span>`,
      s.isVirus ? `<span>Ab ${s.imm.ab.toFixed(2)}</span>` : `<span class="${rfrac > 0.05 ? 'warn' : ''}">耐药 ${(rfrac * 100).toFixed(1)}%</span>`,
      Pop() && Pop().state() ? `<span>群体 ${Pop().state().t.toFixed(0)}d</span>` : '',
      s.host.severe ? '<span class="crit">⚠ 严重进程</span>' : '',
    ].filter(Boolean).join('');
  }

  // ---------------- 消息渲染(与患者面板同构) ----------------
  function md(t) {
    return (t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/&lt;(\/?b)&gt;/g, '<$1>');
  }
  function render() {
    if (!P.el.body) return;
    P.el.body.innerHTML = P.messages.map(m => {
      if (m.role === 'note') return `<div class="pai-note">${md(m.text)}</div>`;
      if (m.role === 'error') return `<div class="pai-err">${md(m.text)}</div>`;
      const tools = (m.tools || []).map(t => `
        <details class="pai-tool">
          <summary>🔧 ${CS.escape(t.name)} <i>${t.status || 'ok'}</i></summary>
          <div class="pai-tool-args">${md(JSON.stringify(t.args || {}, null, 1))}</div>
          <div class="pai-tool-res">${md(String(t.result || '').slice(0, 900))}</div>
        </details>`).join('');
      const think = m.think ? `<div class="pai-think">${md(m.think)}</div>` : '';
      const txt = (m.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&lt;(\/?b)&gt;/g, '<$1>').replace(/\n/g, '<br>');
      return `<div class="pai-m pai-${m.role}">${think}${tools}${txt ? `<div class="pai-text">${txt}</div>` : ''}</div>`;
    }).join('');
    P.el.body.scrollTop = P.el.body.scrollHeight;
  }

  // ---------------- 对话(SSE) ----------------
  async function send(text) {
    if (P.busy || !text) return;
    if (!P.sessionId) { P.messages.push({ role: 'error', text: '环境会话未就绪 —— 重新打开面板试试。' }); render(); return; }
    P.busy = true;
    const reply = { role: 'assistant', text: '', think: '', tools: [] };
    P.messages.push({ role: 'user', text }, reply);
    render();
    try {
      const resp = await fetch(CS.api.url('/pathenv/chat'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: P.conversationId || '', text, sessionId: P.sessionId }),
      });
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const evl = (frame.match(/event: (.*)/) || [])[1] || '';
          const dl = (frame.match(/data: (.*)/) || [])[1] || '';
          if (!dl) continue;
          let d; try { d = JSON.parse(dl); } catch (e) { continue; }
          if (evl === 'delta') { reply.text += d.text || ''; }
          else if (evl === 'think') { reply.think += d.text || ''; }
          else if (evl === 'tool') {
            const kind = d.kind || 'call';
            if (kind === 'call') reply.tools.push({ name: d.name, args: d.args || {}, status: 'ok', result: '' });
            else if (kind === 'result') { const t = reply.tools[reply.tools.length - 1]; if (t) { t.result = d.result || ''; t.status = 'ok'; } }
          } else if (evl === 'done') {
            if (d.conversationId && !P.conversationId) P.conversationId = d.conversationId;
            reply.tokens = d.tokens;
            if (!reply.text) reply.text = '';
            archive();
          } else if (evl === 'error') {
            reply.text += `\n[错误] ${d.detail || ''}`;
          }
          render();
        }
      }
    } catch (err) {
      reply.text += `\n[连接异常] ${err && err.message ? err.message : err}`;
    }
    P.busy = false;
    render();
  }

  function archive() {
    // 与患者面板同契约: {id, title, projectId, content} —— 字段名必须是
    // content(ConversationIn), 用 messages 会被静默丢弃; projectId 若为空
    // 还会把服务端已归好的项目冲掉(upsert 无条件覆盖 projectId)。
    if (!P.conversationId) return;
    const rows = P.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
      role: m.role,
      content: m.text || '',
      tools: (m.tools || []).map(t2 => ({ name: t2.name, args: t2.args, result: String(t2.result || '').slice(0, 4000) })),
    }));
    if (!rows.length) return;
    const title = (rows.find(r => r.role === 'user') || {}).content || '病原体实验';
    fetch(CS.api.url('/conversations'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: P.conversationId, title: String(title).slice(0, 60), projectId: P.projectId || 'pr-pathogen-env', content: rows }),
    }).catch(() => {});
  }

  // ---------------- 面板 ----------------
  function panelHTML() {
    return `<div id="pathAI" class="pai">
      <div class="pai-head">
        <span class="pai-dot" id="p2AIDot"></span>
        <b>病原体实验 AI</b>
        <span class="pai-case" id="p2AICase">环境待命</span>
        <button type="button" class="pai-x" id="p2AIClose" title="关闭">✕</button>
      </div>
      <div class="pai-vitals" id="p2AIVitals"></div>
      <div class="pai-body" id="p2AIBody"></div>
      <div class="pai-input">
        <textarea id="p2AIInput" rows="2" placeholder="给智能体指令，如「用 E_coli 设计一个亚治疗浓度实验，判断耐药风险」…"></textarea>
        <button type="button" id="p2AISend">发送</button>
      </div>
    </div>`;
  }

  function mount() {
    if ($('pathAI')) return;
    const root = $('pathogen-root');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', panelHTML());
    P.el = {
      box: $('pathAI'), body: $('p2AIBody'), input: $('p2AIInput'), send: $('p2AISend'),
      dot: $('p2AIDot'), vitals: $('p2AIVitals'), caseName: $('p2AICase'),
    };
    $('p2AIClose').addEventListener('click', close);
    P.el.send.addEventListener('click', () => send(P.el.input.value));
    P.el.input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(P.el.input.value); }
    });
  }

  async function open() {
    const root = $('pathogen-root');
    if (!root) { CS.toast && CS.toast('先进入虚拟病原体页', 'error'); return; }
    mount();
    P.el.box.classList.add('on');
    P.open = true;
    renderVitals();
    // 复用页面挂载时注册的环境会话(PathoBridge 在 mount 即注册并保持长轮询)——
    // 面板不重复注册: 同一用户每注册一次就会顶掉旧会话, 双注册会让 MCP 的
    // 轮询循环挂在死掉的 sessionId 上。
    if (!P.sessionId && window.__PathoBridge && window.__PathoBridge.sessionId) {
      P.sessionId = window.__PathoBridge.sessionId;
      P.messages.push({ role: 'note', text: '环境就绪 · 工具直接驱动本页引擎, 操作会同步到曲线/事件记录/试验台 · 会话将存入项目「虚拟病原体」。' });
      render();
    } else if (!P.sessionId) {
      P.messages.push({ role: 'error', text: '环境会话未就绪(页面桥未启动) —— 刷新页面后重试。' });
      render();
    }
  }

  function close() {
    P.open = false;
    if (P.el.box) P.el.box.classList.remove('on');
  }

  window.openPathAI = () => { if (P.open) close(); else open(); };
  window.PathAI = { open, close, send, state: P, refresh: renderVitals };
  setInterval(() => { if (P.open && $('pathogen-root')) renderVitals(); }, 800);
})();
