/* 虚拟患者环境宿主 + AI 观察面板.
 *
 * 生理引擎只存在于本页(js/patient.js), 所以"虚拟患者环境"由页面自己当宿主:
 *   1) 向服务端注册一个环境会话;
 *   2) 长轮询领取智能体的工具调用(mcp: patient_*);
 *   3) 在实时引擎上执行(与手点按钮走同一套函数), 因此心电/血压/事件记录
 *      和智能体看到的是同一份状态;
 *   4) 把结果文本回传, 智能体据此继续决策。
 * 面板本身是精简聊天: 用户消息 / 智能体正文 / 工具调用卡 / ask 卡片,
 * 会话落在侧栏「虚拟患者」项目里(服务端 /api/patenv/session 负责建档)。
 */
(() => {
  'use strict';
  const ESC = CS.escape;
  const P = {
    sessionId: '',
    conversationId: '',
    projectId: '',
    open: false,
    busy: false,
    pollStop: false,
    messages: [],      // {role, text, tools:[{name,args,result,status}], think, error}
    advancing: false,
    el: {},
  };
  window.__PATAI = P;   // 端到端验收可读

  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------- 状态快照
  const n1 = v => (Number.isFinite(+v) ? (+v).toFixed(1) : '--');
  const n0 = v => (Number.isFinite(+v) ? String(Math.round(+v)) : '--');

  function goalsText() {
    if (!CASEC.active && !CASEC.result) return '（未在挑战中）';
    const src = CASEC.active ? CASEC.goals : (CASEC.result.goals || []);
    return src.map((g, i) => {
      const hold = g.hold_t ? ` [${(g.hold || 0).toFixed(0)}/${g.hold_t}s]` : '';
      return `${i + 1}. ${g.done ? '✔' : '✘'} ${g.txt}${g.done ? '' : hold}`;
    }).join('\n');
  }

  function caseLine() {
    if (CASEC.result) {
      const r = CASEC.result;
      return `已结束：${r.won ? '胜利' : '失败'}（用时 ${fmtT(r.time || 0)} · 操作 ${r.ops || 0}${r.stars ? ' · 评级 ' + '★'.repeat(r.stars) : ''}${r.reason ? ' · ' + r.reason : ''}）`;
    }
    if (!CASEC.active) return '未开始（自由模式）';
    return `${CASEC.active.name} · 已用 ${fmtT(CASEC.clock)} / 限时 ${fmtT(CASEC.active.limit)} · 操作 ${CASEC.ops}`;
  }

  function condsText() {
    let conds = [];
    try { conds = collectConds() || []; } catch (e) { conds = []; }
    if (!conds.length) return '无活动病理';
    return conds.map(c => c.n + (c.c2 ? '(危急)' : '')).join(' · ');
  }

  function drugText() {
    const rows = Object.entries(S.blood || {}).filter(([, v]) => v > 0.02)
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([k, v]) => `${zhOf(k)} ${(v * 100).toFixed(0)}%`);
    if (S.infuse && Object.keys(S.infuse).length) rows.push('输注中: ' + Object.keys(S.infuse).map(zhOf).join('、'));
    if (S.bac > 0.03) rows.push(`BAC ${S.bac.toFixed(2)}‰`);
    return rows.length ? rows.join(' · ') : '无';
  }

  function eventTail(limit) {
    const ev = (typeof EVENTS !== 'undefined' ? EVENTS : []).slice(-limit);
    if (!ev.length) return '（无事件）';
    return ev.map(e => `${fmtT(e.t)} ${String(e.msg).replace(/<[^>]+>/g, '')}`).join('\n');
  }

  function obsText() {
    if (!S) return '引擎未就绪';
    const lines = [
      `# 时间 ${fmtT(S.t)}${S.paused ? '（已暂停）' : ''}${S.dead ? ' · 患者已死亡：' + (S.deathCause || '') : ''}`,
      `# 病例 ${caseLine()}`,
      `生命体征 HR ${n0(S.hr)} bpm · MAP ${n0(S.map)} mmHg · SpO₂ ${n0(S.spo2)}% · RR ${n0(S.rr)}/min · T ${n1(S.temp)}℃ · GCS ${n0(S.gcs)}/15 · 血糖 ${n1(S.glucose)} mmol/L`,
      `心律 ${rhythmName(S.rhythm)}${S.cpr ? ' · CPR 进行中' : ''}${S.pace ? ' · 起搏' + n0(S.paceRate) + 'bpm' : ''}`,
      `血气/电解质 pH ${(S.ph || 0).toFixed(2)} · PaCO₂ ${n0(S.paco2)} · PaO₂ ${n0(S.po2 || 0)} · HCO₃ ${n0(S.hco3 || 0)} · K⁺ ${n1(S.k)} · Na⁺ ${n0(S.na)} · Ca²⁺ ${n1(S.ca)} · Hb ${n1(S.hb)} g/dL · 肌酐 ${n0(S.creat)} μmol/L`,
      `通气 FiO₂ ${Math.round((S.fio2 || 0.21) * 100)}%${S.vent ? ` · 机械通气 A/C RR${S.ventRR} Vt${S.ventVt} PEEP${S.ventPeep}` : ''}`,
      `容量 血容量 ${(S.fluid || 1).toFixed(2)}× · 拟交感 ${(S.sympath || 0).toFixed(2)}`,
      `病理 ${condsText()}`,
      `血药 ${drugText()}`,
      `目标\n${goalsText()}`,
      `近况\n${eventTail(6)}`,
    ];
    return lines.join('\n');
  }

  function labText() {
    const vals = labValues();
    const rows = Object.keys(LAB_REF).map(k => {
      const ref = LAB_REF[k], v = vals[k], f = labFlag(v, ref);
      const flag = f === 'hi' ? ' ↑' : f === 'lo' ? ' ↓' : '';
      return `${LAB_NAME[k]} ${v.toFixed(LAB_DEC[k])}${flag} (${ref[0]}~${ref[1]} ${LAB_UNIT[k]})`;
    });
    let sex = '';
    try {
      const sv = sexValues();
      if (sv) sex = '\n性激素 ' + Object.keys(sv).map(k => `${SEX_NAME[k]} ${sv[k].toFixed(SEX_DEC[k])}`).join(' · ');
    } catch (e) { /* 无周期数据 */ }
    return `# 化验 ${fmtT(S.t)}\n` + rows.join('\n') + sex;
  }

  function casesText() {
    return CASES.map((c, i) => `C${i + 1} ${c.id} · ${c.name} · 难度 ${'★'.repeat(c.diff)} · 限时 ${fmtT(c.limit)}\n   ${c.desc}`).join('\n');
  }

  // ---------------------------------------------------------------- 工具执行
  function setChem(name) {
    const sel = $('chemSel');
    if (!sel) return false;
    const want = String(name || '').trim();
    let hit = [...sel.options].find(o => o.value === want);
    if (!hit) hit = [...sel.options].find(o => (o.textContent || '').includes(want));
    if (!hit) hit = [...sel.options].find(o => zhOf(o.value) === want);
    if (!hit) return false;
    sel.value = hit.value;
    return true;
  }

  const EXEC = {
    patient_observe: () => ({ ok: true, text: obsText() }),

    patient_list_cases: () => ({ ok: true, text: casesText() }),

    patient_case_start: a => {
      const id = String(a.case_id || '').trim();
      if (caseIdxOf(id) < 0) return { ok: false, text: `没有 id 为 ${id} 的病例。可用: ${CASES.map(c => c.id).join(', ')}` };
      startCase(id);
      return { ok: true, text: '病例已载入并开始计时。\n' + caseLine() + '\n' + obsText() };
    },

    patient_case_status: () => ({
      ok: true,
      text: `${caseLine()}\n目标：\n${goalsText()}`,
    }),

    patient_administer: a => {
      const chem = String(a.chemical || '').trim();
      if (!chem) return { ok: false, text: '缺 chemical 参数' };
      const dose = Number(a.dose || 1);
      const route = String(a.route || 'IVPush');
      const routeSel = $('routeSel'), doseIn = $('doseIn');
      if (!setChem(chem)) return { ok: false, text: `药典里找不到「${chem}」。用英文 chemical id 或中文名(如 肾上腺素 / Epinephrine)。` };
      if (routeSel) {
        if (![...routeSel.options].some(o => o.value === route)) return { ok: false, text: `不支持的途径 ${route}` };
        routeSel.value = route;
      }
      if (doseIn) doseIn.value = String(Math.max(0.1, dose));
      administer();
      return { ok: true, text: `已给药 ${zhOf($('chemSel').value)} ×${dose}（${route}）。` };
    },

    patient_shock: a => {
      const j = Number(a.joules || 200);
      if (![120, 200, 300, 360].includes(j)) return { ok: false, text: '能量只能是 120/200/300/360 J' };
      if (S.rhythm === 'sinus') {
        return { ok: false, text: '当前是窦性心律：非同步电击会诱发心室颤动（R-on-T），已拒绝执行。室颤/无脉室速才除颤。' };
      }
      S.defibJ = j;
      applyShock(false);
      return { ok: true, text: `${j}J 电击已释放，当前心律 ${rhythmName(S.rhythm)}。` };
    },

    patient_ventilate: a => {
      const on = a.on !== false;
      if (S.vent !== on) {
        const cb = $('ventOn');
        if (cb) { cb.checked = on; ventToggle(cb); } else { S.vent = on; }
      }
      const clampInt = (v, lo, hi, cur) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : cur);
      if (a.rr !== undefined) S.ventRR = clampInt(a.rr, 6, 40, S.ventRR);
      if (a.vt !== undefined) S.ventVt = clampInt(a.vt, 200, 800, S.ventVt);
      if (a.peep !== undefined) S.ventPeep = clampInt(a.peep, 0, 15, S.ventPeep);
      if (a.fio2 !== undefined) S.fio2 = clampInt(a.fio2, 21, 100, Math.round((S.fio2 || .21) * 100)) / 100;
      if (typeof ventSet === 'function') ventSet();
      return {
        ok: true,
        text: `机械通气 ${S.vent ? '已开启' : '已关闭'}：RR ${S.ventRR} · Vt ${S.ventVt} · PEEP ${S.ventPeep} · FiO₂ ${Math.round((S.fio2 || .21) * 100)}%。`,
      };
    },

    patient_oxygen: a => {
      const fio2 = Number(a.fio2);
      if (!Number.isFinite(fio2) || fio2 < 21 || fio2 > 100) return { ok: false, text: 'FiO₂ 必须是 21–100 的整数(%)' };
      S.fio2 = fio2 / 100;
      const btn = $('btnO2');
      if (btn) btn.classList.toggle('on', fio2 > 21);
      log(`🅾 吸氧 FiO₂ ${fio2}%`);
      return { ok: true, text: `FiO₂ 已设为 ${fio2}%。` };
    },

    patient_cpr: a => {
      const on = a.on !== false;
      if (S.cpr !== on) {
        const btn = $('btnCPR');
        if (btn) doCPR(btn); else S.cpr = on;
      }
      return { ok: true, text: `胸外按压 ${S.cpr ? '进行中' : '已停止'}。` };
    },

    patient_fluid: a => {
      const ml = Number(a.ml);
      if (!Number.isFinite(ml) || ml === 0) return { ok: false, text: 'ml 必须是非零整数（正值补液，负值放血）' };
      const steps = Math.max(1, Math.round(Math.abs(ml) / 500));
      for (let i = 0; i < Math.min(steps, 4); i++) (ml > 0 ? doFluid() : doBleed());
      return { ok: true, text: `已${ml > 0 ? '补液' : '放血'} ${steps * 500}ml（血容量 ${(S.fluid || 1).toFixed(2)}×）。` };
    },

    patient_lab: () => {
      drawBlood();
      const box = $('labBox');
      if (box) box.style.display = 'none';   // 面板里给文本, 不抢屏幕
      return { ok: true, text: labText() };
    },

    patient_advance: a => {
      const seconds = Math.min(120, Math.max(1, Number(a.seconds || 10)));
      const step = 0.25;
      const wasSound = S.soundOn;
      S.soundOn = false;              // 快进期静音: 否则几百个心音会同时排播成爆音
      P.advancing = true;
      try {
        for (let i = 0, n = Math.round(seconds / step); i < n; i++) tick(step);
      } finally {
        S.soundOn = wasSound;
        P.advancing = false;
      }
      if (typeof waveFrame === 'function') waveFrame(0.05);
      if (typeof uiFrame === 'function') uiFrame();
      return { ok: true, text: `已推进 ${seconds}s。` + (CASEC.result ? `\n病例${CASEC.result.won ? '胜利' : '失败'}：${CASEC.result.reason || ''}` : '') };
    },

    patient_log: a => {
      const limit = Math.min(80, Math.max(5, Math.round(Number(a.limit || 20))));
      return { ok: true, text: eventTail(limit) };
    },

    patient_reset: () => {
      resetSim();
      return { ok: true, text: '患者已复位到健康基线，病例已清除。' };
    },
  };

  // ---------------------------------------------------------------- 桥接
  async function bridgeLoop() {
    while (!P.pollStop) {
      try {
        const r = await fetch(CS.api.url(`/patenv/poll?sessionId=${encodeURIComponent(P.sessionId)}&wait=20`), {
          credentials: 'include',
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        const call = data && data.call;
        if (call) await runCall(call);
      } catch (err) {
        if (P.pollStop) return;
        markBridge(false);
        await new Promise(res => setTimeout(res, 3000));
      }
    }
  }

  async function runCall(call) {
    const fn = EXEC[call.tool];
    let out;
    if (!fn) out = { ok: false, text: `未知工具 ${call.tool}` };
    else {
      try { out = fn(call.args || {}) || { ok: true, text: '' }; }
      catch (err) { out = { ok: false, text: '执行异常：' + (err && err.message ? err.message : err) }; }
    }
    // 页面上留痕: 用户能直接看到智能体刚做了什么
    try { log(`🤖 <b>${ESC(call.tool.replace(/^patient_/, ''))}</b> ${ESC(String(out.text || '').split('\n')[0]).slice(0, 120)}`, out.ok ? '' : 'crit'); } catch (e) { /* 引擎未就绪 */ }
    markBridge(true);
    try {
      await fetch(CS.api.url('/patenv/result'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: P.sessionId, id: call.id, ok: !!out.ok, text: String(out.text || '') }),
      });
    } catch (e) { /* 回传失败: 服务端会超时, 面板可见 */ }
  }

  function markBridge(ok) {
    const dot = P.el.dot;
    if (dot) dot.className = 'pai-dot' + (ok ? ' on' : '');
  }

  // ---------------------------------------------------------------- 面板
  function panelHTML() {
    return `<div id="patAI" class="pai">
      <div class="pai-head">
        <span class="pai-dot" id="paiDot"></span>
        <b>病例挑战 AI</b>
        <span class="pai-case" id="paiCase">自由模式</span>
        <button type="button" class="pai-x" id="paiClose" title="关闭">✕</button>
      </div>
      <div class="pai-vitals" id="paiVitals"></div>
      <div class="pai-body" id="paiBody"></div>
      <div class="pai-input">
        <textarea id="paiInput" rows="2" placeholder="给智能体指令，或直接说「开始 sca 病例」…"></textarea>
        <button type="button" id="paiSend">发送</button>
      </div>
    </div>`;
  }

  function mount() {
    if ($('patAI')) return;
    const root = $('patient-root');
    if (!root) return;
    root.insertAdjacentHTML('beforeend', panelHTML());
    P.el = {
      box: $('patAI'), body: $('paiBody'), input: $('paiInput'), send: $('paiSend'),
      dot: $('paiDot'), vitals: $('paiVitals'), caseName: $('paiCase'),
    };
    $('paiClose').addEventListener('click', close);
    P.el.send.addEventListener('click', () => send(P.el.input.value));
    P.el.input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); send(P.el.input.value); }
    });
  }

  function renderVitals() {
    if (!P.el.vitals || !S) return;
    const crit = /vf|vt|arrest/.test(S.rhythm) || S.map < 65 || S.spo2 < 90 || S.k > 5.6;
    P.el.vitals.innerHTML =
      `<span class="${S.map < 65 ? 'warn' : ''}">MAP ${n0(S.map)}</span>` +
      `<span class="${S.hr > 110 || S.hr < 50 ? 'warn' : ''}">HR ${n0(S.hr)}</span>` +
      `<span class="${S.spo2 < 93 ? 'warn' : ''}">SpO₂ ${n0(S.spo2)}</span>` +
      `<span class="${S.k > 5.6 || S.k < 3.2 ? 'warn' : ''}">K⁺ ${n1(S.k)}</span>` +
      `<span class="${S.ph < 7.32 || S.ph > 7.48 ? 'warn' : ''}">pH ${(S.ph || 0).toFixed(2)}</span>` +
      `<span class="rhy ${crit ? 'crit' : ''}">${rhythmName(S.rhythm)}</span>`;
    if (P.el.caseName) {
      P.el.caseName.textContent = CASEC.result ? (CASEC.result.won ? '病例胜利' : '病例失败')
        : (CASEC.active ? `${CASEC.active.name} ${fmtT(CASEC.clock)}` : '自由模式');
    }
  }

  function msgHTML(m, idx) {
    if (m.role === 'user') return `<div class="pai-m pai-u">${ESC(m.text)}</div>`;
    if (m.role === 'error') return `<div class="pai-m pai-e">${ESC(m.text)}</div>`;
    if (m.role === 'note') return `<div class="pai-m pai-n">${ESC(m.text)}</div>`;
    const parts = [];
    if (m.think) parts.push(`<details class="pai-think"><summary>思考</summary>${ESC(m.think)}</details>`);
    (m.tools || []).forEach(t => {
      parts.push(`<div class="pai-tool ${t.status === 'error' ? 'bad' : t.status === 'running' ? 'run' : ''}">
        <div class="pai-tool-h"><code>${ESC(t.name)}</code>${t.args && Object.keys(t.args).length ? `<span>${ESC(JSON.stringify(t.args))}</span>` : ''}</div>
        ${t.result ? `<pre>${ESC(t.result)}</pre>` : (t.status === 'running' ? '<pre>执行中…</pre>' : '')}
      </div>`);
    });
    (m.asks || []).forEach(a => {
      parts.push(`<div class="pai-ask" data-ask="${ESC(a.id)}">${a.questions.map((q, qi) => `
        <div class="pai-q">${ESC(q.question || q.text || '')}</div>
        <div class="pai-opts">${(q.options || []).map(o => `<button type="button" data-askid="${ESC(a.id)}" data-opt="${ESC(typeof o === 'string' ? o : o.label || o.value || '')}" data-qi="${qi}">${ESC(typeof o === 'string' ? o : o.label || o.value || '')}</button>`).join('')}</div>`).join('')}
      </div>`);
    });
    if (m.text || !parts.length) parts.push(`<div class="pai-text">${CS.markdown(m.text || '')}</div>`);
    return `<div class="pai-m pai-a" data-idx="${idx}">${parts.join('')}</div>`;
  }

  let rafPending = false;
  function render() {
    if (!P.el.body) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const box = P.el.body;
      const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
      box.innerHTML = P.messages.map((m, i) => msgHTML(m, i)).join('') || '<div class="pai-empty">问一句「开始 sca 病例，你来抢救」，智能体会自己观测、处置、推进时间。</div>';
      box.querySelectorAll('button[data-askid]').forEach(btn => {
        btn.addEventListener('click', () => answerAsk(btn.getAttribute('data-askid'), btn.getAttribute('data-opt')));
      });
      if (atBottom) box.scrollTop = box.scrollHeight;
    });
  }

  async function answerAsk(id, opt) {
    try {
      await fetch(CS.api.url('/patenv/answer'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, answers: [{ id, selected: [opt], custom: '' }] }),
      });
      P.messages.push({ role: 'note', text: '已回答：' + opt });
      render();
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- 对话
  async function send(text) {
    const body = String(text || '').trim();
    if (!body || P.busy) return;
    P.el.input.value = '';
    P.messages.push({ role: 'user', text: body });
    const reply = { role: 'assistant', text: '', tools: [], think: '', asks: [] };
    P.messages.push(reply);
    render();
    P.busy = true;
    P.el.send.disabled = true;
    P.el.send.textContent = '思考中…';
    try {
      const resp = await fetch(CS.api.url('/patenv/chat'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ conversationId: P.conversationId, text: body }),
      });
      if (!resp.ok || !resp.body) throw new Error('HTTP ' + resp.status);
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut;
        while ((cut = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const ev = /^event: (\S+)/m.exec(raw);
          const dt = /^data: ([\s\S]*)$/m.exec(raw);
          if (!ev || !dt) continue;
          let payload = {};
          try { payload = JSON.parse(dt[1]); } catch (e) { continue; }
          applyEvent(ev[1], payload, reply);
          render();
        }
      }
      archive();
    } catch (err) {
      reply.role = 'error';
      reply.text = '对话失败：' + (err && err.message ? err.message : err);
      render();
    } finally {
      P.busy = false;
      if (P.el.send) { P.el.send.disabled = false; P.el.send.textContent = '发送'; }
    }
  }

  function applyEvent(kind, payload, reply) {
    if (kind === 'delta') { reply.text += payload.text || ''; return; }
    if (kind === 'think') { reply.think += payload.text || ''; return; }
    if (kind === 'tool') {
      const ev = payload || {};
      if (ev.kind === 'call') {
        reply.tools.push({ name: ev.name || '?', args: ev.args || {}, status: 'running', result: '' });
      } else if (ev.kind === 'result') {
        const name = ev.name || '?';
        let card = [...reply.tools].reverse().find(t => t.name === name && t.status === 'running');
        if (!card) { card = { name, args: ev.args || {}, status: 'running', result: '' }; reply.tools.push(card); }
        card.status = ev.error ? 'error' : 'ok';
        card.result = String(ev.result == null ? '' : (typeof ev.result === 'string' ? ev.result : JSON.stringify(ev.result)));
        if (card.result.length > 4000) card.result = card.result.slice(0, 4000) + ' …';
      } else if (ev.kind === 'ask' && ev.id) {
        reply.asks.push({ id: ev.id, questions: ev.questions || [] });
      }
      return;
    }
    if (kind === 'error') {
      P.messages.push({ role: 'error', text: '模型/工具错误：' + (payload.detail || '') });
      return;
    }
    if (kind === 'done') {
      if (payload.conversationId && !P.conversationId) P.conversationId = payload.conversationId;
      if (payload.tokens) reply.tokens = payload.tokens;
      if (payload.askIds && payload.askIds.length) reply.askIds = payload.askIds;
    }
  }

  function archive() {
    const rows = [];
    P.messages.forEach(m => {
      if (m.role === 'user') rows.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant' && (m.text || (m.tools || []).length)) {
        rows.push({
          role: 'assistant',
          content: m.text || '',
          reasoning: m.think || undefined,
          tools: (m.tools || []).map(t => ({ name: t.name, args: t.args || {}, result: t.result || '' })),
        });
      }
    });
    if (!rows.length) return;
    const title = (rows.find(r => r.role === 'user') || {}).content || '病例挑战';
    fetch(CS.api.url('/conversations'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: P.conversationId, title: String(title).slice(0, 60), projectId: P.projectId, content: rows }),
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- 生命周期
  async function open() {
    const root = $('patient-root');
    if (!root) { CS.toast && CS.toast('先进入虚拟患者页', 'error'); return; }
    mount();
    P.el.box.classList.add('on');
    P.open = true;
    renderVitals();
    if (!P.sessionId) {
      try {
        const r = await fetch(CS.api.url('/patenv/session'), {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: P.conversationId || '' }),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        P.sessionId = data.sessionId;
        P.conversationId = data.conversationId;
        P.projectId = data.projectId;
        if (Array.isArray(data.messages) && data.messages.length) {
          P.messages = data.messages.map(m => ({
            role: m.role,
            text: m.content,
            tools: (m.tools || []).map(t => ({ name: t.name, args: t.args || {}, status: 'ok', result: t.result || '' })),
          }));
        } else {
          P.messages.push({ role: 'note', text: `环境就绪 · 会话已存入项目「${data.projectName}」· 工具 ${data.tools.length} 个。` });
        }
        render();
        if (!P.pollStop) bridgeLoop();
      } catch (err) {
        P.messages.push({ role: 'error', text: '环境会话建立失败：' + (err && err.message ? err.message : err) });
        render();
      }
    }
  }

  function close() {
    P.open = false;
    if (P.el.box) P.el.box.classList.remove('on');
  }

  window.openPatAI = () => {
    if (P.open) { close(); return; }
    open();
  };
  window.PatAI = { open, close, send, exec: runCall, state: P, obsText, labText };

  // 面板开着时刷新体征条与病例计时
  setInterval(() => { if (P.open && $('patient-root')) renderVitals(); }, 800);
  // 离开患者页时面板自然消失, 但桥接继续(引擎定时器已停, 工具会返回首页状态)
})();
