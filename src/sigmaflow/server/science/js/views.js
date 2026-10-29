/* UI composition. All user-controlled strings pass through CS.escape. */
(() => {
  const e = CS.escape, i = CS.icon;
  // 轻量 UI 片段(app.js 的 H 没有跨模块共享, 这里给空态分支各补一份)
  const H = { notice: t => `<div class="notice">${e(t)}</div>` };
  const btn = (action, label, icon = '', kind = '', extra = '') => `<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${icon ? i(icon, '', 15) : ''}${label ? `<span>${e(label)}</span>` : ''}</button>`;
  const iconBtn = (action, icon, label, extra = '') => `<button type="button" class="icon-btn" data-action="${action}" title="${e(label)}" aria-label="${e(label)}" ${extra}>${i(icon)}</button>`;
  const pill = (label, type = '') => `<span class="pill ${type}">${e(label)}</span>`;
  const status = s => pill(CS.statusLabel(s), ['running','connecting','awaiting'].includes(s) ? 'purple' : s === 'complete' ? 'green' : s === 'error' ? 'red' : '');
  const empty = (icon, title, description = '') => `<div class="empty">${i(icon)}<h3>${e(title)}</h3><p>${e(description)}</p></div>`;
  const header = (eyebrow, title, sub = '', actions = '') => `<header class="page-header"><div><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1>${sub ? `<p>${e(sub)}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</header>`;
  const search = (id, placeholder, value) => `<div class="search-input">${i('search')}<input id="${id}" type="search" aria-label="${e(placeholder)}" placeholder="${e(placeholder)}" value="${e(value)}" autocomplete="off"></div>`;
  const tab = (action, id, title, selected, count) => `<button type="button" class="tab ${selected ? 'active' : ''}" data-action="${action}" data-id="${id}" aria-pressed="${!!selected}">${e(title)}${count !== undefined ? `<span class="count">${count}</span>` : ''}</button>`;
  const tile = (name, color = '') => `<span class="icon-tile ${color}">${i(name, '', 19)}</span>`;
  // Token 用量卡辅助: 会话时长与 SVG 活动图(统计 SigmaFlow 自身会话)
  const usageDur = ms => {
    if (!ms) return '—';
    const min = Math.floor(ms / 60000);
    const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60);
    return d ? `${d} 天 ${h} 小时` : h ? `${h} 小时 ${Math.floor(min % 60)} 分钟` : `${min} 分钟`;
  };
  // GitHub 贡献热力图风格: 列=周, 行=星期, 色阶=当日 token 量; 数据跨度不足 18 周时补空列撑起网格
  const usageHeatmap = days => {
    if (!days?.length) return H.notice('暂无每日用量记录。');
    const byDay = new Map(days.map(d => [d.date, d]));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // 右对齐展示最近 N 周(最多一年 53 列): 列数由容器宽度自适应(CS.fitUsageHeatmap),
    // 放不下就减少周数但格子保持尺寸, 恰好撑满矩形无滚动条; 数据不足左侧补空格
    const weeks = Math.max(1, Math.min(53, CS.ui.usageHeatCols || 53));
    const startAt = new Date(today); startAt.setDate(startAt.getDate() - (weeks - 1) * 7);
    startAt.setDate(startAt.getDate() - ((startAt.getDay() + 6) % 7));  // 对齐周一
    const endAligned = new Date(today); endAligned.setDate(endAligned.getDate() + (6 - ((endAligned.getDay() + 6) % 7)));  // 对齐周日
    const maxTotal = Math.max(...days.map(d => d.totalTokens || 0), 1);
    const levelOf = d => { if (!d) return 0; const t = d.totalTokens || 0; if (!t) return 0; return Math.min(4, 1 + Math.floor((t / maxTotal) * 3.999)); };
    const cells = [];
    const monthLabels = [];  // 每列一个标签(或空)
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const colStart = new Date(startAt); colStart.setDate(colStart.getDate() + w * 7);
      if (colStart.getMonth() !== lastMonth) { monthLabels.push(`<span style="grid-column:${w + 1}">${colStart.getMonth() + 1}月</span>`); lastMonth = colStart.getMonth(); }
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(colStart); d.setDate(d.getDate() + dow);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const data = byDay.get(key);
        const level = levelOf(data);
        cells.push(`<span class="heatmap-cell" data-level="${level}" title="${key}${data ? ` · ${CS.usageNum(data.totalTokens)} tokens${data.sessions ? ` · ${data.sessions} 个会话` : ''}` : ''}"></span>`);
      }
    }
    const dayLabels = ['一', '', '三', '', '五', '', '日'].map(x => `<span>${x}</span>`).join('');
    const g = CS.ui.usageHeatGap || 2;  // 间隙与列数配合填满容器
    return `<div class="usage-heatmap" role="img" aria-label="Token 每日活动热力图"><div class="heatmap-wrap"><div class="heatmap-months" style="grid-auto-columns:${12 + g}px;margin-left:${16 + g}px">${monthLabels.join('')}</div><div class="heatmap-main"><div class="heatmap-day-labels" style="row-gap:${g}px">${dayLabels}</div><div class="heatmap-cells" style="gap:${g}px">${cells.join('')}</div></div><div class="heatmap-legend tiny muted"><span>少</span><span class="heatmap-cell" data-level="0"></span><span class="heatmap-cell" data-level="1"></span><span class="heatmap-cell" data-level="2"></span><span class="heatmap-cell" data-level="3"></span><span class="heatmap-cell" data-level="4"></span><span>多</span><span class="heatmap-legend-total">峰值日 ${e((days.reduce((a, b) => (b.totalTokens > a.totalTokens ? b : a), days[0])).date)}</span></div></div></div>`;
  };
  const usageChart = (days, gran) => {
    if (!days?.length) return H.notice('暂无每日用量记录。');
    // daily: GitHub 风格热力图(usageHeatmap); weekly: 按自然周(周一起)聚合为柱; total: 按日累计折线
    const W = 720, Hh = 150, pad = 8;
    let items;
    if (gran === 'weekly') {
      items = [];
      let acc = null;
      for (const day of days) {
        const dow = (new Date(day.date + 'T00:00:00').getDay() + 6) % 7;  // 0=周一
        if (dow === 0 || !acc) acc = { date: day.date, total: 0, sessions: 0, cost: 0 };
        acc.total += day.totalTokens || 0; acc.sessions += day.sessions || 0; acc.cost += day.costUsd || 0;
        if (dow === 6) { items.push(acc); acc = null; }
      }
      if (acc) items.push(acc);  // 收尾不完整的一周
    } else if (gran === 'total') {
      let run = 0; items = days.map(day => ({ date: day.date, total: (run += day.totalTokens || 0), sessions: day.sessions || 0, cost: day.costUsd || 0 }));
    } else if (gran === 'daily') return usageHeatmap(days);
    else items = days.map(day => ({ date: day.date, total: day.totalTokens || 0, sessions: day.sessions || 0, cost: day.costUsd || 0 }));
    const fmtTitle = it => `${it.date} · ${CS.usageNum(it.total)} tokens${it.cost ? ` · $${it.cost.toFixed(2)}` : ''}`;
    if (gran === 'total') {
      const max = Math.max(...items.map(x => x.total), 1);
      const pts = items.map((x, idx) => `${(pad + idx * (W - pad * 2) / Math.max(1, items.length - 1)).toFixed(1)},${(Hh - pad - (x.total / max) * (Hh - pad * 2)).toFixed(1)}`).join(' ');
      return `<div class="usage-chart" role="img" aria-label="Token 累计曲线"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/><line x1="${pad}" y1="${Hh - pad}" x2="${W - pad}" y2="${Hh - pad}" stroke="var(--line)" stroke-width="1"/></svg><div class="usage-chart-note tiny muted">${e(items[0]?.date || '')} → ${e(items[items.length - 1]?.date || '')} · 累计 ${CS.usageNum(items[items.length - 1]?.total || 0)} tokens</div></div>`;
    }
    const max = Math.max(...items.map(x => x.total), 1);
    const gap = items.length > 90 ? 1 : 2.5;
    const bw = Math.max(2.5, Math.floor((W - pad * 2 - gap * (items.length - 1)) / items.length));
    const bars = items.map((x, idx) => {
      const bh = Math.max(1.5, (x.total / max) * (Hh - pad * 2));
      const bx = pad + idx * (bw + gap);
      return `<rect x="${bx.toFixed(1)}" y="${(Hh - pad - bh).toFixed(1)}" width="${bw}" height="${bh.toFixed(1)}" rx="1.5" fill="var(--accent)" opacity="${items.length > 90 ? 0.75 : 0.9}"><title>${e(fmtTitle(x))}</title></rect>`;
    }).join('');
    return `<div class="usage-chart" role="img" aria-label="Token ${gran === 'weekly' ? '每周' : '每日'}活动"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none">${bars}<line x1="${pad}" y1="${Hh - pad}" x2="${W - pad}" y2="${Hh - pad}" stroke="var(--line)" stroke-width="1"/></svg><div class="usage-chart-note tiny muted">${e(fmtTitle(items.reduce((a, b) => (b.total > a.total ? b : a), items[0])))} · 共 ${items.length} ${gran === 'weekly' ? '周' : '天'}</div></div>`;
  };
  const notice = text => `<div class="notice">${i('info', '', 15)}<span>${e(text)}</span></div>`;
  const renderTable = (columns, rows) => `<div class="table-wrap"><table><thead><tr>${columns.map(c => `<th>${e(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  CS.viewHelpers = { btn, iconBtn, pill, status, empty, header, search, tab, tile, notice, renderTable };

  CS.views = {};
  const V = CS.views;
  // 参数 schema: 格式化展示 + 轻量 JSON 高亮(键/字符串/数字/布尔与 null), 未匹配字符保持原样保证逐字对齐;
  // 仅转义 &<>(保留引号字面量供正则匹配), 结果只用于 pre 文本与无属性 span
  V.prettyJSON = text => { try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text || ''; } };
  V.hlJSON = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/("(?:\\.|[^"\\])*")(\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m, key, colon, str, kw, num) => key ? `<span class="j-key">${key}</span>${colon}` : str ? `<span class="j-str">${str}</span>` : kw ? `<span class="j-kw">${kw}</span>` : num ? `<span class="j-num">${num}</span>` : m);
  // unified diff → GitHub 风格双行号 HTML; 仅在结果长得像 diff 时由工具卡调用
  V.isUnifiedDiff = text => /^--- .+$/m.test(text) && /^\+\+\+ .+$/m.test(text) && /@@ -\d+/.test(text);
  // 工具调用是否报错: 以服务端 isError 标记为准; 老存档无标记时才退回文本启发式,
  // 且启发式要求 Error: 紧跟大写词(如 Error: ValueError) —— 纯文本恰好以 Error: 开头(grep 摘录)不误报
  V.toolIsErr = res => {
    if (res && typeof res === 'object') return !!res.isError;
    const s2 = String(res ?? '').trim();
    if (/^Traceback|^\{"error"|^\{"status"\s*:\s*"error"/.test(s2)) return true;
    return /^Error:\s*[A-Z]/.test(s2);
  };
  const TE_THEMES = [['monokai', 'Monokai Dark'], ['dracula', 'Dracula'], ['solarized-dark', 'Solarized Dark'], ['one-dark', 'One Dark'], ['nord', 'Nord'], ['github-dark', 'GitHub Dark']];
  const bashCmd = args => String((args && typeof args === 'object' ? (args.command ?? args.cmd ?? '') : (args ?? '')) || '').trim();
  const BASH_CMDS = new Set(['cd','ls','cp','mv','rm','mkdir','rmdir','cat','echo','printf','grep','sed','awk','git','pip','pip3','npm','npx','yarn','curl','wget','python','python3','conda','tar','find','chmod','chown','du','df','head','tail','sort','uniq','wc','ln','touch','bash','sh','source','export','env','which','ps','top','kill','docker','rsync','ssh','scp','apt','apt-get','brew','make','cmake','jq','xargs','tee','history','clear','uname','ip','ping','date','sleep','test','sudo','md5sum','sha256sum','base64','openssl']);
  // bash 语法高亮: 原词分扫描分段, 每段独立转义后包 span, 不会再进任何 markdown/终端转义
  V.bashHighlight = cmd => {
    const parts = [];
    let last = 0;
    let expectCmd = true;
    const push = (text, cls) => { if (text) parts.push(cls ? `<span class="${cls}">${e(text)}</span>` : e(text)); };
    const flushWords = text => {
      // 普通词: 空白分隔; 操作符后首词视作命令(词表内用同款命令色, 词表外也按命令重点突出)
      for (const w of text.split(/(\s+)/)) {
        if (!w) continue;
        if (/^\s+$/.test(w)) { push(w); continue; }
        if (expectCmd) { push(w, 'tk-cmd'); expectCmd = false; }
        else push(w);
      }
    };
    // 捕获组: 1字符串(含单双引号) 2变量(含 $(…)) 3注释(含前导空白与行首) 4flag 5操作符 6数字/孤立$
    const re = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\$\{[^}\n]*\}|\$\([^)\n]*\)|\$[A-Za-z_][A-Za-z0-9_]*|\$[?!0-9@#*])|((?:^|\n|\s)#[^\n]*)|(--?[A-Za-z][A-Za-z0-9_-]*)|(&&|\|\||[|;&<>()[\]`{])|(\$|\b\d+(?:\.\d+)?\b)/g;
    cmd.replace(re, (m, str, v, cm, flag, op, num, offset) => {
      if (offset > last) flushWords(cmd.slice(last, offset));
      if (str) { push(m, 'tk-str'); expectCmd = false; }
      else if (v) push(m, 'tk-var');
      else if (cm) {
        // 注释(不确定是行内还是行首): 前导空白原样输出, 注释体用注释色; 若跨行则下一行首重置命令期待
        const lead = m.match(/^\s*/)[0];
        push(lead);
        push(m.slice(lead.length), 'tk-cmt');
        expectCmd = cm.includes('\n');
      }
      else if (flag) push(m, 'tk-flag');
      else if (op) { push(m, 'tk-op'); expectCmd = true; }
      else if (num) push(m, 'tk-num');
      last = offset + m.length;
      return m;
    });
    if (last < cmd.length) flushWords(cmd.slice(last));
    return parts.join('');
  };
  // bash 工具消息的终端仿卡: 主题随设置(默认 Monokai), 命令完整显示并加 “> ” 前缀(带语法高亮), 输出等宽白字
  V.toolTerminal = (name, args, result, live) => {
    const theme = String(CS.state.settings.terminalTheme || 'monokai').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'monokai';
    const cmd = bashCmd(args);
    const out = result != null ? String(result) : '';
    const screen = `${out ? `<pre class="term-out">${e(out.slice(0, 20000))}${out.length > 20000 ? '\n…(输出过长已截断)' : ''}</pre>` : ''}${live && !out ? '<div class="term-runmsg">执行中…</div>' : ''}`;
    return `<div class="term-view term-${e(theme)}"><div class="term-titlebar"><span class="term-dot"></span><span class="term-dot"></span><span class="term-dot"></span><span class="term-name">${e(name)}</span>${live ? '<span class="term-live">运行中</span>' : ''}</div><div class="term-screen">${cmd ? `<div class="term-cmdline"><span class="term-prompt">&gt; </span><span class="term-cmd">${V.bashHighlight(cmd)}</span></div>` : ''}${screen}</div></div>`;
  };
  V.renderUnifiedDiff = text => {
    const esc = CS.escape;
    const lines = text.split('\n');
    const rows = [];
    let oldNo = 0, newNo = 0, inHunk = false;
    let oldFile = '', newFile = '';
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      const hm = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hm) {
        inHunk = true; oldNo = Number(hm[1]); newNo = Number(hm[2]);
        rows.push({ kind: 'hunk', code: line });
      } else if (!inHunk && /^--- /.test(line)) {
        oldFile = line.slice(4);
      } else if (!inHunk && /^\+\+\+ /.test(line)) {
        newFile = line.slice(4);
      } else if (inHunk) {
        const sign = (line[0] === ' ' || line === '') ? ' ' : line[0];
        if (sign === '-') { rows.push({ kind: 'del', o: oldNo++, code: line.slice(1) }); }
        else if (sign === '+') { rows.push({ kind: 'add', n: newNo++, code: line.slice(1) }); }
        else if (line === '\\ No newline at end of file') { rows.push({ kind: 'meta', code: '「此文件末尾没有换行符」' }); }
        else { rows.push({ kind: 'ctx', o: oldNo++, n: newNo++, code: line[0] === ' ' ? line.slice(1) : line }); }
      }
    }
    // 单列行号: - 行取旧号, + 行取新号, 上下文两者相同任取其一
    const row = r => `<div class="diff-row ${r.kind === 'hunk' ? 'hunk' : r.kind}"><span class="diff-ln">${r.o != null ? r.o : (r.n != null ? r.n : '')}</span><span class="diff-code">${esc(r.code)}</span></div>`;
    const baseOld = oldFile.replace(/^old: /, '');
    const baseNew = newFile.replace(/^new: /, '');
    const file = baseOld && baseNew && baseOld === baseNew ? baseNew : `${oldFile} → ${newFile}`;
    return '<div class="diff-view">' + (file.trim() ? `<div class="diff-file">${esc(file)}</div>` : '') + `<div class="diff-body">${rows.map(row).join('')}</div></div>`;
  };
  const schemaDirty = (a, b) => {
    if (a === b) return false;
    try { return JSON.stringify(JSON.parse(a)) !== JSON.stringify(JSON.parse(b)); } catch { return a !== b; }
  };
  // 登录/注册页: 多用户模式未登录时展示完整页面(非浮层)
  // 登录/注册页: 多用户模式未登录时展示的完整页面(极简单卡设计)
  V.auth = () => {
    const tab = CS.ui.authTab === 'register' ? 'register' : 'login';
    const draft = CS.ui.authDraft || {};
    return `<div class="auth-page">
      <div class="auth-glow" aria-hidden="true"></div>
      <section class="auth-wrap">
        <div class="auth-brandmark">${i('dna')}</div>
        <h1 class="auth-title">${tab === 'register' ? '创建你的工作空间' : '欢迎回来'}</h1>
        <p class="auth-sub">${tab === 'register' ? '注册一个账号即可开始，会话与配置按账号隔离保存。' : '登录以访问本机上的科研工作空间。'}</p>
        <div class="auth-tabs" role="tablist">
          <button type="button" class="auth-tab${tab === 'login' ? ' active' : ''}" data-action="auth-tab" data-tab="login" role="tab" aria-selected="${tab === 'login'}">登录</button>
          <button type="button" class="auth-tab${tab === 'register' ? ' active' : ''}" data-action="auth-tab" data-tab="register" role="tab" aria-selected="${tab === 'register'}">注册</button>
        </div>
        <form id="auth-form" data-form="auth" autocomplete="on">
          <div class="field"><label for="auth-username">用户名</label>
            <input id="auth-username" name="username" maxlength="32" required autofocus autocomplete="username" autocapitalize="off" spellcheck="false" value="${e(draft.username || '')}" placeholder="3-32 位字母、数字、- 或 _"></div>
          <div class="field"><label for="auth-password">密码</label>
            <input id="auth-password" name="password" type="password" minlength="6" maxlength="128" required autocomplete="${tab === 'register' ? 'new-password' : 'current-password'}" value="${e(draft.password || '')}" placeholder="至少 6 位"></div>
          ${tab === 'register' ? `<div class="field"><label for="auth-confirm">确认密码</label><input id="auth-confirm" name="confirm" type="password" minlength="6" maxlength="128" required autocomplete="new-password" placeholder="再输入一次"></div>` : ''}
          <button class="auth-submit" type="submit" form="auth-form">${tab === 'register' ? '创建账号并进入' : '登录'}${i('arrowright', '', 15)}</button>
        </form>
        ${CS.state.wechatLogin ? `<div class="auth-or">或</div><button type="button" class="auth-wechat" data-action="wechat-login">${i('wechat', '', 17)}微信扫码登录</button>` : ''}
        <p class="auth-note tiny muted">${tab === 'register' ? '登录凭据以 PBKDF2 存储，不可逆向还原。' : '登录会话在本机保留 7 天。'}</p>
      </section>
      <p class="auth-foot tiny muted">SigmaFlow Science · 多用户模式</p>
    </div>`;
  };

  V.sidebar = () => {
    const active = CS.ui.route;
    const nav = [ ['home','message','新对话'], ['literature','book','文献'], ['data','database','数据集'], ['workflows','workflow','工作流'], ['results','chart','分析结果'], ['tools','grid','生物工具'], ['tasks','queue','任务队列'], ['cell','cells','虚拟细胞'] ];
    const running = CS.state.runs.filter(r => ['running','paused','awaiting','connecting'].includes(r.status)).length;
    const streaming = new Set(CS.state.runs.filter(r => (r.messages || []).some(m => m.streaming)).map(r => r.id));
    return `${CS.ui.mobileSidebar ? '<button class="sidebar-scrim" aria-label="关闭菜单" data-action="toggle-sidebar"></button>' : ''}<aside class="sidebar ${CS.ui.mobileSidebar ? 'open' : ''} ${CS.ui.sidebarFolded ? 'folded' : ''}" aria-label="主导航">
      <div class="brand"><button type="button" class="brand-logo${CS.ui.sidebarFolded ? ' is-folded' : ''}" data-action="toggle-sidebar-fold" aria-label="${CS.ui.sidebarFolded ? '展开侧边栏' : '收起侧边栏'}" title="${CS.ui.sidebarFolded ? '展开侧边栏' : '收起侧边栏，只显示图标'}">${i('dna')}</button><a class="brand-title" href="#/home" aria-label="SigmaFlow Science 首页"><span>SigmaFlow Science</span></a></div>
      <div class="sidebar-scroll"><nav class="nav-list">${nav.map(([route, icon, title]) => `<button type="button" data-nav="${route}" class="nav-item ${active === route || (route === 'home' && (active === 'chat' || active === 'trace')) ? 'active' : ''}" ${active === route ? 'aria-current="page"' : ''} title="${title}">${i(icon)}<span>${title}</span>${route === 'tasks' && running ? `<span class="nav-count">${running}</span>` : ''}</button>`).join('')}</nav>
      <section class="sidebar-section"><div class="sidebar-section-label"><button type="button" class="text-button muted small ${CS.ui.projectsCollapsed ? 'collapsed' : ''}" data-action="toggle-projects-section" aria-expanded="${!CS.ui.projectsCollapsed}" title="${CS.ui.projectsCollapsed ? '展开项目列表' : '折叠项目列表'}"><span>项目</span></button>${iconBtn('new-project','plus','新建项目')}</div>
        ${CS.ui.projectsCollapsed ? '' : CS.state.projects.filter(p => !p.archived).map(p => { const convs = CS.ui.conversations.filter(c => c.projectId === p.id && !c.archived); return `<div class="project-row"><button type="button" class="project-link ${CS.ui.expandedProjects.has(p.id) ? 'expanded' : ''}" data-action="toggle-project" data-id="${e(p.id)}" title="${e(p.name)}">${i(CS.ui.expandedProjects.has(p.id) ? 'chevron' : 'folder')}<span class="project-name">${e(p.name)}</span><span class="project-actions"><span class="icon-btn" role="button" data-action="edit-project" data-id="${e(p.id)}" title="编辑项目">${i('edit','',14)}</span><span class="icon-btn" role="button" data-action="toggle-project-settings" data-id="${e(p.id)}" title="项目设置">${i('settings','',14)}</span></span>${convs.length ? `<span class="nav-count">${convs.length}</span>` : ''}</button>${CS.ui.projectSettingsMenu === p.id ? `<div class="model-menu project-settings-menu"><button type="button" class="model-menu-item" data-action="edit-project" data-id="${e(p.id)}"><span>编辑项目</span></button><button type="button" class="model-menu-item" data-action="archive-project" data-id="${e(p.id)}"><span>归档项目</span></button><div class="menu-divider"></div><button type="button" class="model-menu-item danger" data-action="delete-project" data-id="${e(p.id)}"><span>删除项目</span></button></div>` : ''}</div>${CS.ui.expandedProjects.has(p.id) ? `<div class="conversation-list">${convs.length ? convs.map(c => `<button type="button" class="conversation-link ${CS.state.currentRunId === c.id ? 'selected' : ''}" data-action="open-conversation" data-id="${e(c.id)}" title="${e(c.title)}">${i('message')}<span class="conversation-title">${e(c.title)}</span>${streaming.has(c.id) ? '<span class="conv-dot" title="生成中"></span>' : ''}<span class="conversation-actions${c.pinned ? ' has-pinned' : ''}"><span class="icon-btn" role="button" data-action="toggle-pin-conversation" data-id="${e(c.id)}" title="${c.pinned ? '取消置顶' : '置顶'}">${i(c.pinned ? 'x' : 'up','',12)}</span><span class="icon-btn" role="button" data-action="archive-conversation" data-id="${e(c.id)}" title="归档">${i('archive','',12)}</span></span></button>`).join('') : '<div class="conversation-empty small muted">暂无会话</div>'}</div>` : ''}`; }).join('')}
        ${CS.ui.projectsCollapsed ? '' : `<button type="button" class="project-link" data-nav="projects">${i('more')}<span>查看全部项目</span></button>`}
      </section>
      <section class="sidebar-section"><div class="sidebar-section-label"><button type="button" class="text-button muted small ${CS.ui.unassignedCollapsed ? 'collapsed' : ''}" data-action="toggle-unassigned" aria-expanded="${!CS.ui.unassignedCollapsed}" title="${CS.ui.unassignedCollapsed ? '展开会话列表' : '折叠会话列表'}"><span>会话</span></button></div>
        ${CS.ui.unassignedCollapsed ? '' : (() => { const loose = CS.ui.conversations.filter(c => !c.projectId).slice(0, 8); return loose.length ? loose.filter(c => !c.archived).map(c => `<button type="button" class="conversation-link ${CS.state.currentRunId === c.id ? 'selected' : ''}" data-action="open-conversation" data-id="${e(c.id)}" title="${e(c.title)}">${i('message')}<span class="conversation-title">${e(c.title)}</span>${streaming.has(c.id) ? '<span class="conv-dot" title="生成中"></span>' : ''}<span class="conversation-actions${c.pinned ? ' has-pinned' : ''}"><span class="icon-btn" role="button" data-action="toggle-pin-conversation" data-id="${e(c.id)}" title="${c.pinned ? '取消置顶' : '置顶'}">${i(c.pinned ? 'x' : 'up','',12)}</span><span class="icon-btn" role="button" data-action="archive-conversation" data-id="${e(c.id)}" title="归档">${i('archive','',12)}</span></span></button>`).join('') : '<div class="conversation-empty small muted">暂无未归属项目的会话</div>'; })()}
      </section>
      <section class="sidebar-section"><div class="sidebar-section-label"><button type="button" class="text-button muted small ${CS.ui.fsCollapsed ? 'collapsed' : ''}" data-action="toggle-fs-section" aria-expanded="${!CS.ui.fsCollapsed}" title="${CS.ui.fsCollapsed ? '展开文件' : '折叠文件'}"><span>文件</span></button><span class="fs-actions">${iconBtn('fs-upload','upload','上传文件到项目根目录')}${iconBtn('fs-term','terminal','打开终端')}${iconBtn('fs-refresh','refresh','刷新文件')}</span></div>${CS.ui.fsCollapsed ? '' : V.fsTree()}<input type="file" id="fs-upload-input" multiple hidden aria-hidden="true"></section></div>
      <div class="sidebar-bottom"><div class="workspace-chip" data-action="toggle-user-menu"><div class="workspace-monogram">${((CS.state.me?.user?.name) || CS.state.username || 'CS').slice(0,2).toUpperCase()}</div><div class="grow"><div class="name">${e((CS.state.me?.user?.name) || CS.state.username || '未登录用户')}</div><div class="sub">科研工作空间</div></div>${i('chevron','',12)}${CS.ui.userMenu ? `<div class="user-menu"><button class="menu-item" data-nav="settings">${i('settings','',15)}<span>设置</span><kbd>⌘,</kbd></button><button class="menu-item" data-nav="help">${i('help','',15)}<span>帮助与文档</span></button>${CS.state.me?.mode === 'multi' ? `<div class="menu-divider"></div><button class="menu-item danger" data-action="logout">${i('logout','',15)}<span>退出登录</span></button>` : ''}</div>` : ''}</div></div>
    </aside>`;
  };
  V.topbar = () => `<div class="topbar"><div class="row"><button class="icon-btn mobile-menu" data-action="toggle-sidebar" aria-label="打开菜单">${i('menu')}</button></div></div>`;
  // 上下文用量圆环 + 详情浮层(位于模型选择按钮左侧, 点击圆环展开)
    // 标题栏右侧 usage 行: 图标+数值(开始时间/耗时/消息/工具调用 + 输入↓/输出↑/缓存②/上下文表盘), 右对齐贴水平线
  // 标题栏右侧消息轨迹热力图: 4行方格子, 按聊天气泡可见块一一对应(思考/每个工具/回复各一格),
  // 列内自上而下 / 列间从左往右递增, 整体贴最右生长, 超出 usage 行左侧的旧列因 overflow 被裁剪
  // 虚拟细胞: 4 个模型(动物→植物→神经元→病毒, 默认动物), GLB/JPG 资产在
  // 本站 assets/cell(build 拷入 dist/cell), 3D 内核与 Draco 解码器都在 js/vendor/
  CS.CELL_MODELS = [
    { key: 'animal', name: '动物细胞', en: 'Animal Cell', icon: 'spark',
      img: 'cell/images/animal-cell.jpg', glb: 'cell/models/animal-cell.glb',
      tags: ['细胞核', '线粒体', '内质网', '高尔基体', '溶酶体', '核糖体'],
      facts: [['直径', '10–100 μm'], ['营养方式', '异养（摄取有机物）'], ['代表组织', '上皮 · 肌肉 · 神经'], ['能量来源', '线粒体氧化磷酸化']],
      quick: ['动物细胞与植物细胞有哪些关键区别？', '线粒体如何通过氧化磷酸化供能？', '内膜系统的细胞器之间如何协作？'] },
    { key: 'plant', name: '植物细胞', en: 'Plant Cell', icon: 'leaf',
      img: 'cell/images/plant-cell.jpg', glb: 'cell/models/plant-cell.glb',
      tags: ['细胞壁', '叶绿体', '中央液泡', '细胞核', '内质网'],
      facts: [['直径', '20–100 μm'], ['营养方式', '自养（光合作用）'], ['代表部位', '叶片 · 根 · 茎'], ['特有结构', '细胞壁 · 叶绿体 · 液泡']],
      quick: ['叶绿体的光合作用分为哪两个阶段？', '液泡对植物细胞有什么作用？', '细胞壁的纤维素如何维持细胞形态？'] },
    { key: 'neuron', name: '神经元', en: 'Neuron', icon: 'network',
      img: 'cell/images/neuron.jpg', glb: 'cell/models/neuron.glb',
      tags: ['胞体', '树突', '轴突', '髓鞘', '突触末梢'],
      facts: [['胞体直径', '4–120 μm'], ['轴突长度', '最长 >1 m'], ['传导速度', '0.5–120 m/s'], ['关键机制', '动作电位 · 突触传递']],
      quick: ['动作电位的离子机制是什么？', '髓鞘如何让信号传导更快？', '神经元之间如何通过突触传递信息？'] },
    { key: 'virus', name: '病毒颗粒', en: 'Virus Particle', icon: 'alert',
      img: 'cell/images/virus.jpg', glb: 'cell/models/virus-particle.glb',
      tags: ['衣壳', '刺突蛋白', '核酸基因组', '包膜'],
      facts: [['直径', '20–300 nm'], ['基因组', 'DNA 或 RNA'], ['繁殖方式', '依赖宿主细胞'], ['对抗手段', '疫苗 · 抗病毒药物']],
      quick: ['病毒为什么不被视为完整生命？', '刺突蛋白在病毒入侵中起什么作用？', '抗生素为什么对病毒无效？'] }
  ];
  V.cell = () => {
    const models = CS.CELL_MODELS;
    const cur = models.find(m => m.key === CS.ui.cellModel) || models[0];
    // 标题并入左列列首: 右侧详情卡与 VIRTUAL CELL 那一行同在 grid 首行, 上边缘对齐
    return `<section class="page cell-page">
    <div class="cell-layout">
      <div class="cell-col-left">
        ${header('VIRTUAL CELL', '虚拟细胞', '在可交互的三维模型中观察微观生命结构，右侧随时向 Agent 深入提问。')}
        <div class="panel cell-left">
        <div class="cell-switcher">${models.map(m => `<button type="button" class="cell-switch-card ${m.key === cur.key ? 'selected' : ''}" data-action="cell-pick" data-id="${m.key}" title="切换到${e(m.name)}"><span class="cell-switch-img"><img src="${m.img}" alt="${e(m.name)}预览" loading="lazy"></span><span class="cell-switch-name">${i(m.icon, '', 13)}${e(m.name)}</span></button>`).join('')}</div>
        <div class="cell-stage" id="cell-stage">
          <div class="cell-stage-tools">
            <button type="button" class="icon-btn ${CS.ui.cellAutoRotate ? 'cell-tool-on' : ''}" data-action="cell-rotate" title="${CS.ui.cellAutoRotate ? '关闭自动旋转' : '开启自动旋转'}" aria-pressed="${CS.ui.cellAutoRotate ? 'true' : 'false'}">${i('refresh', '', 14)}</button>
            <button type="button" class="icon-btn" data-action="cell-reset-view" title="重置视角">${i('eye', '', 14)}</button>
          </div>
          <div class="cell-stage-hint">拖拽旋转 · 滚轮缩放</div>
          <div class="cell-load" id="cell-load"><span class="cell-load-dot"></span><span id="cell-load-text">正在加载 ${e(cur.name)} 模型…</span></div>
        </div>
      </div>
      </div>
      <div class="cell-right">
        <div class="panel cell-detail">
          <div class="cell-detail-head"><span class="cell-icon-tile">${i('cells', '', 17)}</span><div><h2>${e(cur.name)}</h2><p class="small muted">${e(cur.en)}</p></div></div>
          <div class="cell-tags">${cur.tags.map(t => `<span class="cell-chip">${e(t)}</span>`).join('')}</div>
          <dl class="cell-stats" id="cell-stats">${cur.facts.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>
        </div>
        <div class="panel cell-ask-panel">
          <h3>对话操作</h3>
          <p class="small muted">关于「${e(cur.name)}」的问题将带着结构要点进入新会话，由 Agent 给出可追溯的解释。</p>
          <div class="cell-quick">${cur.quick.map(q => `<button type="button" class="cell-chip cell-quick-chip" data-action="cell-quick" data-id="${e(q)}">${e(q)}</button>`).join('')}</div>
          <textarea id="cell-ask-text" rows="3" maxlength="6000" placeholder="例如：${e(cur.quick[0])}"></textarea>
          <div class="row-between mt-12"><span class="tiny muted">发送后进入新对话页面</span>${btn('cell-ask', '向 Agent 提问', 'up', 'primary small-btn')}</div>
        </div>
      </div>
    </div></section>`;
  };
  V.runTrack = () => {
    const run = CS.currentRun();
    const all = run?.messages || [];
    // 消息 → 可见块展开: 优先用交错的 blocks 时间线(多段思考/工具/文本一一对应),
    // 旧存档无 blocks 时退回 reasoning/tools 合并展开
    const blocks = [];
    all.forEach((m, mi) => {
      const live = !!m.streaming;
      if (m.role === 'user') { blocks.push({ k: 'user', txt: m.content, live, mi }); return; }
      if (/^\[Conversation compressed/.test(m.content || '')) { blocks.push({ k: 'system', txt: '压缩摘要', live, mi }); return; }
      if (m.role !== 'assistant') { blocks.push({ k: 'system', txt: m.content, live, mi }); return; }
      // 出错的消息: 中断前已执行的思考/工具块是有效历史, 有块轨迹时照常展开,
      // 末尾补一格红色标错; 无块轨迹才压缩成单格红色
      const errMsg = typeof m.error === 'string' ? m.error : ((m.error && m.error.message) || '出错了');
      const hasTimeline = Array.isArray(m.blocks) && m.blocks.length > 0;
      if (m.error && !hasTimeline) { blocks.push({ k: 'error', txt: errMsg, live, mi }); return; }
      const n0 = blocks.length;
      // 活跃块 = 流式消息里最后一个仍在生长的块: 文本流式 / think 在尾部 / 工具未出结果 / ask 未答。
      // 只有它会呼吸, 已完成段(如思考完毕进入工具执行)不再闪烁
      let liveIdx = -1;
      if (live) {
        const arr = Array.isArray(m.blocks) && m.blocks.length ? m.blocks : null;
        if (arr) {
          const last = arr[arr.length - 1];
          if (last && typeof last === 'object') {
            const active = last.type === 'text' || last.type === 'think' ||
              (last.type === 'tool' && last.result == null) || (last.type === 'ask' && !last.answered);
            if (active) liveIdx = arr.length - 1;
          }
        } else {
          // 旧格式合并展开时的活跃段: 有 reasoning 合并时思考在最前, 但文本才是流式生长尾部 → 标 reply 格
          // 先置 -1 作为兑底, 下方按 think/tools/asks/text 顺序重算
          liveIdx = -1;
          const tl = (m.tools || []).length;
          const tk = (m.reasoning || '').trim() ? 1 : 0;
          const as = (m.asks || []).length;
          const hasReply = (m.content || '').trim() ? 1 : 0;
          // 顺序 think/tools/asks/text: 最后一个未完成的工具或尚在文本
          if (hasReply) liveIdx = n0 + tk + tl + as;           // 文本生长中
          else if (as) liveIdx = n0 + tk + tl;                  // ask 等待
          else if (tl) liveIdx = n0 + tk + tl - 1;              // 最后一个工具(合并视图无 result 细分)
        }
      }
      if (Array.isArray(m.blocks) && m.blocks.length) {
        m.blocks.forEach((b, bi) => {
          if (!b || typeof b !== 'object') return;
          const on = live && bi === liveIdx;
          if (b.type === 'think' && (b.text || '').trim()) blocks.push({ k: 'think', txt: b.text, live: on, mi });
          else if (b.type === 'tool') blocks.push({ k: 'tool', txt: (b.name || '工具') + ' ' + (typeof b.result === 'string' ? b.result : ''), live: on, mi });
          else if (b.type === 'present') blocks.push({ k: 'present', txt: '展示 ' + (b.name || b.path || ''), live: on, mi });
          else if (b.type === 'sysnote') blocks.push({ k: 'system', txt: '系统注入', live: on, mi });
          else if (b.type === 'ask') blocks.push({ k: 'tool', txt: 'ask 提问', live: on, mi });
          else if (b.type === 'text' && (b.text || '').trim()) blocks.push({ k: 'reply', txt: b.text, live: on, mi });
        });
      } else {
        if ((m.reasoning || '').trim()) blocks.push({ k: 'think', txt: m.reasoning, live: false, mi });
        (m.tools || []).forEach((t, ti) => blocks.push({ k: 'tool', txt: (t.name || '工具') + ' ' + (typeof t.result === 'string' ? t.result : ''), live: live && n0 + ((m.reasoning || '').trim() ? 1 : 0) + ti === liveIdx, mi }));
        (m.asks || []).forEach(() => blocks.push({ k: 'tool', txt: 'ask 提问', live: false, mi }));
        if ((m.content || '').trim()) blocks.push({ k: 'reply', txt: m.content, live: live && liveIdx === n0 + ((m.reasoning || '').trim() ? 1 : 0) + (m.tools || []).length + (m.asks || []).length, mi });
      }
      if (m.error) blocks.push({ k: 'error', txt: errMsg, live, mi });  // 有块轨迹的错误消息: 块之后标一格红
      if (blocks.length === n0 && live) blocks.push({ k: 'think', txt: '生成中…', live: true, mi });
    });
    if (!blocks.length) return '';
    // 上限只作为超长会话的 DOM 兜底(千级块防渲染爆炸): 常规超长(几百块)
    // 全部渲染, 由视觉层在目录徽章左缘处渐隐截断, 不再程序性丢块
    const MAX_COLS = 300;
    const start = Math.max(0, blocks.length - MAX_COLS * 4);
    const shown = blocks.slice(start);
    // 列内自上而下 4 格一列; 每轮用户消息强制新起一列(回合从列首开始)
    const cols = [];
    let cur = [];
    shown.forEach(b => {
      if (b.k === 'user' && cur.length) { cols.push(cur); cur = []; }
      else if (cur.length >= 4) { cols.push(cur); cur = []; }
      cur.push(b);
    });
    if (cur.length) cols.push(cur);
    const name = { user: '用户', think: '思考', tool: '工具', reply: '回复', system: '系统', error: '错误' };
    const cell = (b, gi) => `<span role="button" class="tr-cell tr-${b.k}${b.live ? ' tr-live' : ''}" data-action="track-jump" data-id="${b.mi}" title="#${start + gi + 1} ${name[b.k]}${b.live ? ' · 生成中' : ''} · ${e(String(b.txt || '').replace(/\s+/g, ' ').slice(0, 80))} · 点击跳转到该消息"></span>`;
    // 超长会话被截掉头部时加渐隐类, 在左缘用 mask 提示“还有更早的”
    return `<div class="run-track${start ? ' tr-trunc' : ''}" aria-hidden="true"${start ? ` title="还有更早的 ${start} 条消息未展示"` : ''} data-blocks="${blocks.length}">${cols.map(c => `<span class="tr-col">${c.map(cell).join('')}</span>`).join('')}</div>`;
  };

  V.runUsage = () => {
    const u = CS.chatUsage();
    const meta = CS.chatMeta();
    const item = (ic, val, tip, raw, cls = '') => `<span class="ru-item${cls ? ' ' + cls : ''}" title="${e(tip)}">${i(ic, '', 13)}<b>${raw ? val : CS.knum(val)}</b></span>`;
    const startTxt = meta.start !== null ? new Date(meta.start).toLocaleString('zh-CN', { hour12: false }) : '—';
    const proj = CS.currentRun() ? CS.state.projects.find(p => p.id === CS.currentRun().projectId) : null;
    const pdir = proj?.dir || '';
    // 消息项可点击: 打开会话 Trace 弹窗(逐条消息的耗时 / 调用 / token 明细), 设计参考 admin 后台 trace 页
    const row = `${pdir ? item('folder', CS.tpath(pdir), '项目目录: ' + pdir, true, 'dir-clamp') : ''}${item('calendar', CS.fmtDT(meta.start), '会话开始: ' + startTxt, true)}${item('clock', CS.fmtDur(meta.elapsed), '累计生成耗时 (每轮回复耗时之和, 不含轮间空闲)', true)}${`<span class="ru-item clickable" role="button" data-action="open-trace" title="消息总数 (含用户与助手) · 点击查看会话 Trace">${i('message', '', 13)}<b>${meta.msgs}</b></span>`}${item('wrench', meta.tools, '工具调用次数 (含 ask)')}${item('up', u.tin, '累计输入 token')}${item('arrowdown', u.tout, '累计输出 token')}${item('database', u.tinCache, '累计缓存读取(模型/网关不支持缓存时为 0, glm-5.3-flash 无缓存上报)')}${`<span class="ru-item" title="上下文占用 / 模型窗口">${i('gauge', '', 13)}<b>${u.pct}% / ${CS.knum(u.win)}</b></span>`}`;
    return `<div class="run-usage-stack">${V.runTrack()}<div class="run-usage mono">${row}</div></div>`;
  };

  // 会话 Trace 弹窗(参考后台 trace 页的时间线 + 行展开详情): 每条消息一行, 相对会话时间轴画耗时条, 行点击展开属性与块序列
  // 弹窗体在 app.js 的 renderModal 里调用, 经 CS.traceBody 桥接(V 是本模块私有命名空间)
  // 会话 Trace 页(route=trace, 主区视图, 保留侧栏; 设计参考 admin 后台 trace 页): 点击 usage 行的消息数进入
  // 共享上下文: 角色归一 / 时间轴原点与跨度 / 逐条消息的行渲染, 供统计条与列表共同使用
  const _traceCtx = () => {
    const run = CS.currentRun();
    // #0 系统条: 会话实发 system 提示词(存档属性 systemPrompt, 在线时由
    // chat.system 事件写入), 合成在最前不进 run.messages, 主对话流不受影响
    const msgs = (run?.systemPrompt
      ? [{ role: 'system', content: run.systemPrompt, at: (run?.messages?.[0]?.at) || '' }]
      : []).concat(run?.messages || []);
    const kindOf = m => m.role === 'user' ? 'user' : m.error ? 'error' : /^\[Conversation compressed/.test(m.content || '') || (m.role !== 'assistant' && m.role !== 'user') ? 'system' : 'reply';
    const prev = (s, n = 70) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return e(t.slice(0, n)) + (t.length > n ? '…' : ''); };
    let tools = 0, tin = 0, tout = 0, tcache = 0;
    msgs.forEach(m => {
      if (m.role === 'assistant') { tin += m.promptTokens || 0; tout += m.tokens || 0; tcache += m.cacheTokens || 0; tools += (m.tools?.length || 0) + (m.asks?.length || 0); }
    });
    return { run, msgs, kindOf, prev, tools, tin, tout, tcache };
  };
  V.traceStats = () => {
    const { msgs, tools, tin, tout, tcache } = _traceCtx();
    return `<div class="trace-stats mono"><span><b>${msgs.length}</b> 条消息</span><span><b>${tools}</b> 次工具调用</span><span>输入 <b>${CS.num(tin)}</b></span><span>输出 <b>${CS.num(tout)}</b></span><span>缓存 <b>${CS.num(tcache)}</b></span><span class="tiny faint">点击任意一行展开该条消息的耗时与调用细节</span></div>`;
  };
  V.traceRows = () => {
    const { msgs, kindOf, prev } = _traceCtx();
    if (!msgs.length) return '';
    const KIND = { user: '用户', reply: '回复', think: '思考', tool: '工具', system: '系统', error: '错误', sysnote: '注入' };
    // 运行耗时占比时间轴: 分母 = 各条消息运行耗时之和(流式实时计入), 消息间空闲时段不占条, 段连续堆叠
    // 行内再分段: 优先块边界时间戳(相邻差), 缺省按文本量等比; 段色随块类型(思考/工具/回复)
    const barSegs = mm => {
      const bs = (Array.isArray(mm.blocks) ? mm.blocks : []).filter(b => b && (b.type === 'think' || b.type === 'tool' || b.type === 'ask' || (b.type === 'text' && (b.text || '').trim())));
      if (bs.length < 2) return null;
      const ds = bs.map((b, i) => {
        const nx = bs[i + 1];
        if (typeof b.at === 'number' && typeof nx?.at === 'number' && nx.at > b.at) return nx.at - b.at;
        if (typeof b.at === 'number' && typeof b.end === 'number' && b.end > b.at) return b.end - b.at;
        const chars = b.type === 'tool' || b.type === 'ask' ? String(b.result || '').length : (b.text || '').length;
        return Math.max(1, chars || 1);
      });
      const dTotal = ds.reduce((s, x) => s + x, 0) || 1;
      return bs.map((b, i) => ({ k: b.type === 'ask' ? 'tool' : b.type === 'text' ? 'reply' : b.type, share: (ds[i] / dTotal) * 100, ms: ds[i] }));
    };
    const times = msgs.map(m => { const t = Date.parse(m.at || ''); return isNaN(t) ? null : t; });
    const rows = msgs.map((m, idx) => {
      const t = times[idx];
      const dur = m.role === 'assistant' ? (m.streaming ? Math.max(0, Date.now() - (t || Date.now())) : (m.elapsed > 0 ? m.elapsed : 0)) : 0;
      return { m, idx, t, dur };
    });
    const totalRun = Math.max(1, rows.reduce((s, r) => s + r.dur, 0));
    let cum = 0;
    const open = CS.ui.traceOpen instanceof Set ? CS.ui.traceOpen : new Set();
    return rows.map(({ m, idx, t, dur }) => {
      const kind = kindOf(m);
      const streaming = !!m.streaming;
      // 占比: 起点 = 前面各行运行时长累计 / 总运行时长; 每条至少 1.2% 可见; 用户消息是瞬时点不占运行时长
      const off = Math.min(99, Math.round((cum / totalRun) * 1000) / 10);
      const segW = dur > 0 ? Math.max(1.2, Math.round((dur / totalRun) * 1000) / 10) : 1;
      const segs = barSegs(m);
      const barHtml = segs ? (() => { let picum = 0; return segs.map(s => { const l = Math.round((off + (picum / 100) * segW) * 10) / 10; const w = Math.max(0.9, Math.round((s.share / 100) * segW * 10) / 10); picum += s.share; return `<span class="trace-seg seg-${s.k}" style="left:${l}%;width:${w}%"></span>`; }).join(''); })() : `<span class="trace-seg seg-${kind}" style="left:${off}%;width:${segW}%"></span>`;
      cum += dur;
      const tok = m.tokens ? `${CS.num(m.promptTokens || 0)}→${CS.num(m.tokens)}` : '';
      const nTools = kind === 'reply' ? (m.tools?.length || 0) + (m.asks?.length || 0)
        : kind === 'error' && Array.isArray(m.blocks) ? m.blocks.filter(b => b && (b.type === 'tool' || b.type === 'ask')).length : 0;
      let blocks = [];
      const errText = typeof m.error === 'object' ? (m.error.message || '出错了') : String(m.error || '出错了');
      // 出错消息带块轨迹时不能只列一行错误: 先展开已执行的思考/工具块, 末尾补错误条目
      const errHasTimeline = kind === 'error' && Array.isArray(m.blocks) && m.blocks.length > 0;
      if (kind === 'user') blocks = [{ k: 'user', t: m.content }];
      else if (kind === 'error' && !errHasTimeline) blocks = [{ k: 'error', t: errText }];
      else if (kind === 'system') blocks = [{ k: 'system', t: m.content }];
      else {
        if (Array.isArray(m.blocks) && m.blocks.length) m.blocks.forEach(b => {
          if (!b || typeof b !== 'object') return;
          if (b.type === 'think' && (b.text || '').trim()) blocks.push({ k: 'think', t: b.text });
          else if (b.type === 'tool') blocks.push({ k: 'tool', t: (b.name || '工具') + (typeof b.result === 'string' && b.result ? ' → ' + b.result : ' (执行中)') });
          else if (b.type === 'ask') blocks.push({ k: 'tool', t: 'ask 提问' });
          else if (b.type === 'text' && (b.text || '').trim()) blocks.push({ k: 'reply', t: b.text });
          else if (b.type === 'sysnote') blocks.push({ k: 'sysnote', t: b.text || '' });
        });
        else {
          if ((m.reasoning || '').trim()) blocks.push({ k: 'think', t: m.reasoning });
          (m.tools || []).forEach(x => blocks.push({ k: 'tool', t: (x.name || '工具') + (typeof x.result === 'string' && x.result ? ' → ' + x.result : '') }));
          if ((m.asks || []).length) blocks.push({ k: 'tool', t: `ask 提问 ×${m.asks.length}` });
          if ((m.content || '').trim()) blocks.push({ k: 'reply', t: m.content });
        }
      }
      if (errHasTimeline) blocks.push({ k: 'error', t: errText });  // 有块轨迹的错误消息在块之后补错误条目
      const props = [
        ['时间', CS.datetime(m.at)],
        ...(m.model ? [['模型', m.model]] : []),
        ...(kind === 'reply' || kind === 'error' ? [
          ['耗时', streaming ? '生成中' : m.elapsed > 0 ? CS.elapsedMs(m.elapsed) : '—'],
          ['输入 token', CS.num(m.promptTokens || 0)],
          ...(m.cacheTokens != null ? [['缓存读取', CS.num(m.cacheTokens)]] : []),
          ['输出 token', CS.num(m.tokens || 0)],
          ...(m.contextTokens != null ? [['上下文占用', CS.kfmt(m.contextTokens)]] : []),
        ] : []),
      ];
    const isOpen = open.has(idx);
    // 块行完整原文: 新管线直接用原始块对象(含工具入参/出参), 旧数据从展示文本兕底
    const blockOpen = CS.ui.traceBlockOpen instanceof Set ? CS.ui.traceBlockOpen : new Set();
    let rawB = Array.isArray(m.blocks) && m.blocks.length ? m.blocks.filter(b => b && (b.type === 'tool' || b.type === 'ask' || (b.text || '').trim())) : null;
    if (Array.isArray(m.blocks) && m.blocks.some(b => b && b.type === 'sysnote')) {
      // 对位表按完整块序列重建: sysnote 与其余块保持同序, 展开原文取全文
      let _pass = [];
      m.blocks.forEach(b => {
        if (!b) return _pass.push(null);
        if (b.type === 'sysnote') { _pass.push(b); return; }
        if (b.type === 'tool' || b.type === 'ask' || (b.text || '').trim()) _pass.push(b); else _pass.push(null);
      });
      rawB = _pass;
    }
    const bFull = b => {
      if (!b) return '';
      if (b.type === 'tool') {
        let args = '';
        try { args = typeof b.args === 'string' ? b.args : JSON.stringify(b.args ?? {}, null, 2); } catch { args = String(b.args ?? ''); }
        const input = args && args !== '{}' ? `输入：\n${args}` : '';
        const out = b.result == null ? '(执行中)' : String(b.result);
        return [input, out ? `输出：\n${out}` : ''].filter(Boolean).join('\n\n');
      }
      if (b.type === 'ask') {
        const q = (b.questions || []).join('\n');
        const a = b.result || (Array.isArray(b.answers) ? b.answers.join('\n') : '') || (b.answered ? '(已答复)' : '未答复');
        return `问题：\n${q}\n\n答复：\n${a}`;
      }
      return b.text || '';
    };
      const detail = isOpen ? `<div class="trace-detail"><div class="trace-props">${props.map(([k, v]) => `<span class="tpair"><span class="tk">${e(k)}</span><span class="tv mono">${e(v)}</span></span>`).join('')}</div>${blocks.length ? `<div class="trace-blocks">${blocks.map((b, ri) => { const ms = segs && segs[ri] ? segs[ri].ms : 0; const raw = rawB ? rawB[ri] : (b.t ? { type: 'text', text: b.t } : null); const bkey = idx + ':' + ri; const bOpen = blockOpen.has(bkey); return `<span class="tb-item clickable${bOpen ? ' open' : ''}" role="button" data-action="toggle-trace-block" data-id="${bkey}" aria-expanded="${bOpen}" title="点击展开完整输入/输出"><span class="tk-${b.k}">${KIND[b.k]}</span><span class="tb-txt" title="${prev(b.t, 240)}">${prev(b.t, 110)}</span>${ms > 0 ? `<span class="tb-dur mono">${CS.elapsedMs(ms)}</span>` : ''}</span>${bOpen ? `<span class="tb-body"><pre>${e(bFull(raw))}</pre></span>` : ''}`; }).join('')}</div>` : ''}</div>` : '';
      return `<div class="trace-row${isOpen ? ' open' : ''}"><button type="button" class="trace-main" data-action="toggle-trace-row" data-id="${idx}" aria-expanded="${isOpen}"><span class="trace-idx mono">#${idx}</span><span class="trace-kind tk-${kind}">${KIND[kind]}${kind === 'reply' && streaming ? ' · 生成中' : ''}</span><span class="trace-preview" title="${prev(kind === 'error' && !(m.content || '').trim() ? errText : m.content, 140)}">${prev(kind === 'error' && !(m.content || '').trim() ? errText : m.content)}</span><span class="trace-tools mono">${nTools || ''}</span><span class="trace-tok mono">${tok}</span><span class="trace-dur mono">${dur > 0 ? CS.elapsedMs(dur) : ''}</span><span class="trace-bar">${barHtml}</span></button>${detail}</div>`;
    }).join('');
  };
  // trace 页面: 主区视图替换聊天视图, 侧栏保留; 返回按钮与标题同一行(页内流), 无会话时给出空态并引导返回
  V.trace = () => {
    const { run, msgs } = _traceCtx();
    const back = `<button type="button" class="icon-btn trace-back" data-action="back-to-chat" aria-label="返回会话" title="返回会话（返回原聊天页）">${i('arrowleft', '', 15)}</button>`;
    if (!run || !msgs.length) return `<section class="page trace-page"><div class="trace-head"><div class="trace-head-row">${back}<h1>会话 Trace</h1></div></div>${H.notice(run ? '当前会话还没有消息。' : '没有打开的会话，请先回到聊天页选择会话。')}</section>`;
    return `<section class="page trace-page"><div class="trace-head"><div class="trace-head-row">${back}<h1>会话 Trace</h1></div><p class="small muted trace-sub text-clip" title="${e(run.title || '')}">${e(run.title || '未命名会话')} <span class="faint">·</span> <span class="mono">${e(run.id || '')}</span></p></div>${V.traceStats()}<div class="trace-list" role="table">${V.traceRows()}</div></section>`;
  };

V.ctxRing = () => {
    if (!CS.ui.modelsLoaded || !CS.ui.models.length) return '';
    const u = CS.contextUsage();
    const level = u.pct >= 90 ? 'danger' : u.pct >= 60 ? 'warn' : 'ok';
    const R = 9, C = 2 * Math.PI * R;
    const on = C * Math.max(u.pct, 2) / 100;  // 至少露出 2% 以便看清环弧
    return `<div class="ctx-use"><button type="button" class="ctx-ring-btn${CS.ui.terminal?.open ? ' compact' : ' '}" data-action="toggle-context-menu" data-level="${level}" aria-label="上下文用量" aria-expanded="${!!CS.ui.contextMenu}" title="上下文已用 ~${u.pct}% · 点击查看详情"><svg class="ctx-ring-svg" viewBox="0 0 22 22" width="18" height="18" aria-hidden="true"><circle class="ctx-track" cx="11" cy="11" r="${R}"/><circle class="ctx-fill" cx="11" cy="11" r="${R}" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C - on).toFixed(2)}" transform="rotate(-90 11 11)"/></svg><span class="ctx-pct">${u.pct}%</span></button>${CS.ui.contextMenu ? (() => {
      const win = u.window;
      const seg = t => t > 0 ? `width:${Math.max(0, Math.min(100, t / win * 100)).toFixed(2)}%;min-width:5px` : 'width:0%;min-width:0';
      return `<div class="ctx-pop" role="dialog" aria-label="上下文用量详情"><div class="ctx-head"><span>上下文已用 <b data-ctx="pct">${u.pct}%</b></span><span class="ctx-head-cap" data-ctx="cap">${CS.kfmt(u.total)} / ${CS.kfmt(win).slice(1)}</span></div><div class="ctx-bar"><span class="ctx-seg sys" data-ctx="w-sys" style="${seg(u.sysT)}"></span><span class="ctx-seg tools" data-ctx="w-tools" style="${seg(u.toolT)}"></span><span class="ctx-seg msgs" data-ctx="w-msgs" style="${seg(u.msgsT)}"></span></div><div class="ctx-rows"><div class="ctx-row"><span class="ctx-dot sys"></span><span class="ctx-label">系统提示词</span><span class="ctx-val" data-ctx="v-sys">${CS.kfmt(u.sysT)}</span></div><div class="ctx-row"><span class="ctx-dot tools"></span><span class="ctx-label">工具定义</span><span class="ctx-val" data-ctx="v-tools">${CS.kfmt(u.toolT)}</span></div><div class="ctx-row"><span class="ctx-dot msgs"></span><span class="ctx-label">对话消息</span><span class="ctx-val" data-ctx="v-msgs">${CS.kfmt(u.msgsT)}</span></div></div><div class="ctx-foot"><button type="button" class="ctx-compact-btn" data-action="ctx-compact" title="把较早的对话压缩成摘要, 保留最近消息原文">${i('minimize2', '', 13)}<span>压缩</span></button></div></div>`;
    })() : ''}</div>`;
  };
  V.fsTree = () => {
    const st = CS.ui.fs;
    const project = CS.state.projects.find(p => p.id === CS.state.projectId);
    if (!project) return '<div class="fs-empty small muted">未关联项目，先在输入框选择项目即可浏览其目录。</div>';
    if (!st || st.projectId !== project.id || (st.loading && !Array.isArray(st.root))) {
      CS.ui.fs = { projectId: project.id, expanded: st?.expanded && st.projectId === project.id ? st.expanded : new Set(), children: {}, git: {}, root: null, loading: true };
      CS.agent?.loadFsDir?.('');
      return '<div class="fs-empty small muted">正在加载目录…</div>';
    }
    const git = st.git || {};
    const row = (entry, depth) => {
      const isDir = entry.type === 'dir';
      const open = isDir && st.expanded.has(entry.path);
      const stx = git[entry.path] || '';
      const badge = stx ? `<span class="fs-st s-${stx}">${stx}</span>` : '';
      const kids = open ? (Array.isArray(st.children[entry.path]) ? st.children[entry.path].map(k => row(k, depth + 1)).join('') : `<div class="fs-row fs-loading" style="padding-left:${12 + (depth + 1) * 13}px"><span class="spinner"></span></div>`) : '';
      const icon = isDir ? `<span class="fs-chevron${open ? ' open' : ''}">${i('chevron', '', 12)}</span>` : `<span class="fs-file-ic">${i('file', '', 13)}</span>`;
      return `<button type="button" class="fs-row${open ? ' open' : ''}" style="padding-left:${6 + depth * 13}px" data-action="${isDir ? 'fs-dir' : 'fs-open'}" data-path="${e(entry.path)}" title="${e(entry.path)}${stx ? ' · git ' + stx : ''}">${icon}<span class="fs-name${stx ? ' st-' + stx.toLowerCase() : ''}">${e(entry.name)}</span>${badge}</button>${kids}`;
    };
    if (!Array.isArray(st.root)) return '<div class="fs-empty small muted">正在加载目录…</div>';
    let treeHtml = st.error
      ? `<div class="fs-empty small muted">${e(st.error)}</div>`
      : '<div class="fs-empty small muted">目录为空，或项目尚未配置本地路径。</div>';
    if (st.root.length) treeHtml = `<div class="fs-tree">${st.root.map(x => row(x, 0)).join('')}</div>`;
    // 右键菜单: 定位在光标处, 动作经 data-action 走既有点击委托
    if (CS.ui.fsCtx && typeof CS.ui.fsCtx.x === 'number') {
      const f = CS.ui.fsCtx;
      const isDir = f.type === 'dir';
      const mi = (action, label) => `<button type="button" class="model-menu-item" data-action="${action}" data-path="${e(f.path)}" data-type="${e(f.type)}">${label}</button>`;
      treeHtml += `<div class="fs-ctx-menu" style="left:${Math.min(f.x, window.innerWidth - 190)}px;top:${Math.min(f.y, window.innerHeight - 260)}px">`
        + (isDir
            ? mi('fs-menu-newfile', '新建文件') + mi('fs-menu-newfolder', '新建文件夹') + '<div class="menu-divider"></div>'
            : '')
        + mi('fs-menu-rename', '重命名')
        + mi('fs-menu-move', '移动到…')
        + mi('fs-menu-copy', isDir ? '复制到…' : '复制到…')
        + mi('fs-menu-copy-path', '复制路径')
        + '<div class="menu-divider"></div>'
        + `<button type="button" class="model-menu-item danger" data-action="fs-menu-delete" data-path="${e(f.path)}" data-type="${e(f.type)}">删除</button>`
        + `</div>`;
    }
    return treeHtml;
  };
  V.terminalDrawer = () => {
    const t = CS.ui.terminal;
    if (!t || !t.open) return '';
    const project = CS.state.projects.find(p => p.id === CS.state.projectId);
    const width = Math.max(320, Math.min(t.width || 480, window.innerWidth - 480));
    return `<div class="term-wrap" style="width:${width}px"><span class="term-resizer" title="拖动调整宽度" aria-hidden="true"></span><aside class="term-panel" role="dialog" aria-label="项目终端"><header class="term-head"><div class="row grow" style="min-width:0">${i('terminal','',15)}<strong>${e(project ? project.name : '终端')}</strong><span class="tiny mono term-sub" style="overflow:hidden;text-overflow:ellipsis" title="${e(project?.dir || '')}">${e(project?.dir ? project.dir : '交互式 PTY 终端')}</span></div>${iconBtn('term-clear','trash','清屏')}${iconBtn('term-close','x','关闭终端')}</header>${project ? '<div class="term-xhost" id="term-xhost"></div>' : '<div class="term-empty small muted">请先在输入框选择项目再打开终端。</div>'}</aside></div>`;
  };
  V.composer = (home = false) => {
    const foldBtn = home ? '' : CS.state.settings.composerCollapsed ? `<button type="button" class="composer-expand" data-action="composer-fold" aria-label="展开输入框" title="展开输入框">${i('dna', '', 20)}</button>` : `<button type="button" class="composer-fold" data-action="composer-fold" aria-label="收起输入框" title="收起输入框，腾出空间浏览会话">${i('minimize2', '', 12)}</button>`;
    const wrap = home ? 'composer-home' : 'chat-composer' + (CS.state.settings.composerCollapsed && !home ? ' composer-collapsed' : '');
    return `<div class="${wrap}">${foldBtn}${!home ? `<button type="button" class="jump-latest" data-action="jump-latest" title="跳到最新消息"${CS.ui.canJumpLatest ? '' : ' hidden'}>${i('down', '', 14)}</button>` : ''}${home ? `<div class="composer-project"><button type="button" class="model-select-btn project-select-btn" data-action="toggle-project-menu" aria-haspopup="listbox" aria-expanded="${!!CS.ui.projectMenu}">${CS.state.projectId ? `<span class="project-icon" data-action="clear-project" title="取消项目关联">${i('folder','',13)}${i('x','',13)}</span>` : i('folder','',13)}<span>${e(CS.state.projects.find(p => p.id === CS.state.projectId)?.name || '选择项目')}</span>${i('down','',13)}</button>${CS.ui.projectMenu ? `<div class="model-menu dd-down" role="menu">${CS.state.projects.filter(p => !p.archived).map(p => `<button type="button" class="model-menu-item" role="menuitem" data-action="pick-project" data-id="${e(p.id)}"><span>${e(p.name)}</span>${CS.state.projectId === p.id ? i('check','',13) : ''}</button>`).join('')}<div class="menu-divider"></div><button type="button" class="model-menu-item" data-action="new-project">${i('plus','',14)}<span>新建项目</span></button><button type="button" class="model-menu-item" data-action="connect-project">${i('external','',14)}<span>连接远程项目</span></button></div>` : ''}</div>` : ''}<form class="composer" data-form="composer">
    ${CS.ui.attachments.length ? `<div class="attachment-list">${CS.ui.attachments.map(id => { const d = CS.state.datasets.find(x => x.id === id); return d ? `<span class="attachment">${i('file')}<span>${e(d.name)}</span>${iconBtn('remove-attachment','x','移除附件',`data-id="${e(id)}"`)}</span>` : ''; }).join('')}</div>` : ''}
    <textarea id="composer-text" aria-label="研究问题" placeholder="${home ? '描述你的科研问题…' : '继续提问，或调整分析计划…'}" rows="3" maxlength="6000">${e(CS.ui.composer)}</textarea>
    <div class="composer-toolbar"><div class="composer-tools${CS.ui.terminal?.open ? ' term-open' : ' '}">${btn('add-attachment','','plus','', 'aria-label="添加附件" title="添加附件"')}${btn('add-attachment','文件','paperclip','', 'aria-label="添加文件附件" title="添加文件附件"')}${btn('choose-dataset','数据集','database','', 'aria-label="选择数据集" title="选择数据集"')}${btn('choose-tools','工具','grid','', 'aria-label="选择工具" title="选择工具"')}${btn('choose-skills','技能','book','', 'aria-label="选择技能" title="选择技能"')}${btn('toggle-plan','计划','workflow', CS.ui.planMode ? 'primary' : '', 'aria-label="计划模式" title="计划模式：开启后先出方案再动手"')}</div><div class="composer-submit">${V.ctxRing()}<div class="model-select"><button type="button" class="model-select-btn" data-action="toggle-model-menu" aria-haspopup="listbox" aria-expanded="${!!CS.ui.modelMenu}">${e(CS.state.settings.model || 'openrouter/free')}${i('down','',13)}</button>${CS.ui.modelMenu ? `<div class="model-menu" role="listbox">${(CS.ui.models.length ? CS.ui.models : [{ id: '', model: CS.state.settings.model || 'openrouter/free' }]).map(m => `<button type="button" class="model-menu-item" role="option" aria-selected="${CS.state.settings.modelId === m.id}" data-action="pick-model" data-id="${e(m.id)}"><span>${e(m.model)}</span>${CS.state.settings.modelId === m.id ? i('check','',13) : ''}</button>`).join('')}<div class="menu-divider"></div><button type="button" class="model-menu-item" data-action="configure-model">${i('settings','',14)}<span>配置模型…</span></button></div>` : ''}</div>${(CS.currentRun()?.kind === 'chat' && CS.currentRun()?.messages?.some(m => m.streaming)) ? `<button type="button" class="send-button send-stop" data-action="stop-generation" aria-label="停止生成" title="停止生成">${i('stop', '', 15)}</button>` : `<button type="submit" class="send-button" aria-label="发送研究问题" title="发送 · Enter" ${!CS.ui.composer.trim() ? 'disabled' : ''}>${i('up', '', 19)}</button>`}</div></div>
    </form>${home ? '' : `<div class="sys-stats" id="sys-stats"><span class="sys-line"><span class="sys-skel" style="flex:5"></span><span class="sys-skel" style="flex:9"></span><span class="sys-skel" style="flex:7"></span><span class="sys-skel" style="flex:6"></span><span class="sys-skel" style="flex:8"></span></span><span class="sys-line"><span class="sys-skel" style="flex:4"></span><span class="sys-skel" style="flex:5"></span><span class="sys-skel" style="flex:5"></span><span class="sys-skel" style="flex:4"></span></span></div>`}</div>`;
  };
  V.home = () => `<section class="home-page">${CS.dnaArt()}<div class="home-content"><div class="home-brand"><div class="kicker">${i('dna','',26)}</div><h1>SigmaFlow <span>Science</span></h1></div>${V.composer(true)}<div class="home-shortcuts">
    <button class="shortcut-card" data-action="demo-start">${i('cells')}<div><h3>单细胞分析</h3><p>体验一段科研工作流</p></div></button>
    <button class="shortcut-card" data-nav="literature">${i('book')}<div><h3>文献研究</h3><p>让证据与思考相连</p></div></button>
    <button class="shortcut-card" data-nav="data">${i('database')}<div><h3>数据探索</h3><p>从一份数据开始</p></div></button>
    <button class="shortcut-card" data-nav="tools">${i('dna')}<div><h3>科研工具</h3><p>轻量、清晰、可追溯</p></div></button>
  </div></div><div class="home-bottom"><span>FROM DATA TO DISCOVERY</span><span>·</span><button class="text-button" data-nav="help">使用指南 ${i('arrow','',12)}</button></div></section>`;

  V.chat = () => {
    const run = CS.currentRun();
    if (!run) {
      // 正在从服务端拉取会话内容: 先渲染页面壳(标题/输入区)与占位动画, 数据到达后重渲染替换, 不再闪现空态提示
      if (CS.state.currentRunId && CS.ui.loadingRunId === CS.state.currentRunId) {
        const meta = CS.ui.conversations.find(c => c.id === CS.state.currentRunId) || {};
        const rows = Array.from({ length: 6 }, (_, i) => i % 3 === 1 ? `<div class="skl-row right"><div class="skl-circle"></div><div class="skl-body"><div class="skl-line" style="width:52%"></div><div class="skl-line" style="width:30%"></div></div></div>` : `<div class="skl-row"><div class="skl-avatar"></div><div class="skl-body"><div class="skl-line wide"></div><div class="skl-line" style="width:${62 - i * 4}%"></div><div class="skl-line thin" style="width:${40 + i * 2}%"></div></div></div>`).join('');
        return `<section class="page chat-page"><div class="chat-layout no-inspector"><div class="chat-main chat-main-chat"><header class="chat-title chat-title-compact"><div><h1>${e(meta.title || '会话')}</h1></div></header><div class="conversation chat-skl">${rows}</div>${V.composer(false)}</div></div></section>`;
      }
      return `<section class="page">${empty('message','开始一个新的科研任务','先在首页描述研究问题，或选择一条演示工作流。')}<div class="center">${btn('go-home','开始对话','plus','primary')}</div></section>`;
    }
    if (run.kind === 'chat') {
      // 压缩摘要卡(pi CompactionEntry): 点击头部折叠/展开
      const V_COMPACT = (m, idxOf) => {
        const c = String(m.content || '');
        const header = c.split('\n')[0] || '上下文已压缩';
        const body = c.split('\n').slice(1).join('\n').trim();
        // 折叠键 = 会话id+消息序号(追加式列表里 idxOf 稳定): 默认展开, 与错误卡同一套内存态机制
        const ckey = `${run.id}|${idxOf}`;
        const collapsed = (CS.ui.compactCollapsedSet || (CS.ui.compactCollapsedSet = new Set())).has(ckey);
        const head = `<button type="button" class="compact-head" data-action="toggle-compact" data-ckey="${e(ckey)}" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? '展开摘要' : '折叠摘要'}"><span class="compact-ico">${i('layers', '', 14)}</span><span class="compact-title">上下文已压缩</span><span class="tiny muted compact-sub">${e(header)}</span></button>`;
        return `<div class="compact-card" data-mi="${idxOf}">${head}${body && !collapsed ? `<div class="compact-body md-body">${CS.markdown(body)}</div>` : ''}</div>`;
      };
      // 压缩摘要作为特殊回复消息: agent 消息外壳(头像/名称) + 内嵌摘要卡;
      // 进行中状态(compactPending)显示"上下文正在压缩中"等待动画
      const isCompactMsg = m => !!(m.compactPending || m.compact || String(m.content || '').startsWith('[Conversation compressed'));
      const V_COMPACT_REPLY = m => {
        const idxOf = run.messages.indexOf(m);  // meta 行的操作按钮需要消息索引
        const pending = !!m.compactPending;
        // 名称行/计时/token 与正常回复一套结构; 进行中在 body 内显示压缩状态行(仿思考行)
        const status = `<div class="compact-status" data-state="${pending ? 'running' : 'ok'}">${i('minimize2', '', 14)}<span class="compact-status-text">${pending ? '上下文正在压缩中' : '已完成上下文压缩'}</span>${pending ? '<span class="compact-dots"><span>.</span><span>.</span><span>.</span></span>' : ''}</div>`;
        const streamBody = pending && m.summaryDelta ? `<div class="compact-card compact-streaming-card"><div class="compact-head"><span class="compact-ico">${i('layers', '', 14)}</span><span class="compact-title">上下文已压缩</span><span class="tiny muted compact-sub">摘要生成中…</span></div><div class="compact-body md-body compact-streaming">${CS.markdown(m.summaryDelta)}</div></div>` : '';
        return `<div class="msg-block agent-block compact-reply-block" data-mi="${idxOf}"><div class="agent-message"><div class="agent-avatar${pending ? ' avatar-pulsing' : ''}">${i('dna', '', 21)}</div><div class="agent-body"><div class="agent-name">SigmaFlow Science${m.streaming ? ` <span class="tok-down" data-start="${m.at}">↓ 0</span> <span class="elapsed-timer" data-start="${m.at}">${CS.elapsed(m.at)}</span>` : (m.elapsed != null ? ` <span class="elapsed-timer elapsed-done">${CS.elapsedMs(m.elapsed)}</span>` : '')}${CS.tokRateTag(m)}</div>${status}${streamBody}${pending ? '' : V_COMPACT(m, idxOf)}${m.streaming ? '' : `<div class="message-meta-row"><span class="message-meta">${CS.datetime(m.at)}</span>${m.tokens ? `<span class="message-meta">${CS.num(m.promptTokens || 0)} in · ${CS.num(m.tokens)} out</span>${CS.tokRateTag(m)}` : ''}<span class="message-actions"><span class="icon-btn" role="button" data-action="copy-message" data-id="${idxOf}" title="复制">${i('copy', '', 13)}</span></span></div>`}</div></div></div>`;
      };
      const bubble = m => {
        // idxOf 上提到分支前: 压缩卡(meta 行/折叠键)与普通消息操作都按消息序号定位
        const idxOf = run.messages.indexOf(m);
        if (m.role === 'assistant' && isCompactMsg(m)) return V_COMPACT_REPLY(m, idxOf);
        if (m.compact || String(m.content || '').startsWith('[Conversation compressed')) return V_COMPACT(m, idxOf);
        return m.role === 'user'
        ? `<div class="msg-block user-block" data-mi="${idxOf}"><div class="user-message">${e(m.content)}${m.datasetIds?.length ? `<div class="attachment-list mt-12">${m.datasetIds.map(id => `<span class="attachment">${i('file')}${e(CS.state.datasets.find(d => d.id === id)?.name || id)}</span>`).join('')}</div>` : ''}</div><div class="message-meta-row"><span class="message-meta">${CS.datetime(m.at)}</span><span class="message-actions"><span class="icon-btn" role="button" data-action="copy-message" data-id="${idxOf}" title="复制">${i('copy','',13)}</span><span class="icon-btn" role="button" data-action="edit-message" data-id="${idxOf}" title="修改">${i('edit','',13)}</span></span></div></div>`
        : (() => {
            const blockMeta = t => t.name === 'bash' ? {icon: 'terminal', label: '终端'} : {icon: 'code', label: '工具'};
            // 块折叠键: 会话id+消息序号+块序号。不能用 m.at —— 完成时会重置 at,
            // 展开状态会随键失效。idxOf 在追加式列表里稳定
            const bkey = bi => `${run.id}|${idxOf}|${bi}`;
            const blockOpen = bi => !!CS.ui.blockOpen[bkey(bi)];
            const blocks = Array.isArray(m.blocks) ? m.blocks : null;
            const lastIdx = blocks ? blocks.length - 1 : -1;
            // 新格式: 按时间线逐块渲染(think/text/tool 各占一块, 按到达顺序排列);
            // 旧格式(压平的 reasoning/tools/content)走原有渲染, 兼容服务端历史会话
            let segments;
            if (!blocks) {
              segments = `${(m.streaming ? (CS.ui.thinkingText || m.reasoning) && CS.ui.thinkingText !== undefined : m.reasoning) ? `
          <div class="think-root${m.streaming && !m.content ? ' think-live' : ''}" data-state="${m.streaming && !m.content ? 'running' : 'ok'}"${CS.ui.thinkingOpen ? ' data-expanded="true"' : ''}>
            <button type="button" class="think-row" data-action="toggle-thinking" aria-expanded="${!!CS.ui.thinkingOpen}">
              <span class="think-leading">${i('spark', '', 14)}<span class="think-chevron">${i('chevron', '', 12)}</span></span>
              <span class="think-title">${m.streaming && !m.content ? '思考中' : '已深度思考'}</span>
              <span class="think-separator" aria-hidden="true"></span>
              <span class="think-summary" data-follow-end="${m.streaming && !m.content ? '' : undefined}"><span class="think-summary-text">${e((m.streaming && !m.content ? (CS.ui.thinkingText || '') : (m.reasoning || '').split('\n').filter(Boolean)[0]) || '')}</span></span>
            </button>
            ${CS.ui.thinkingOpen ? `<div class="think-body">${e(m.streaming ? (CS.ui.thinkingText || m.reasoning || '') : (m.reasoning || ''))}</div>` : ''}
          </div>` : ''}
          ${(m.tools || []).length ? (() => { const meta = blockMeta(m.tools[m.tools.length - 1]); const running = m.tools.some(t => t.running); const last = m.tools[m.tools.length - 1]; const firstBash = m.tools.find(t => t.name === 'bash'); const bashCmdText = firstBash ? bashCmd(firstBash.args) : ''; return `<div class="think-root tool-root${running ? ' think-live' : ''}" data-state="${running ? 'running' : (m.tools.some(t => V.toolIsErr(t.result)) ? 'err' : 'ok')}"${CS.ui.toolsOpen ? ' data-expanded="true"' : ''}><button type="button" class="think-row" data-action="toggle-tools" aria-expanded="${!!CS.ui.toolsOpen}"><span class="think-leading">${i(bashCmdText ? 'terminal' : meta.icon, '', 14)}<span class="think-chevron">${i('chevron', '', 12)}</span></span><span class="think-title">${bashCmdText ? '终端' : meta.label} ${e(last.name)} · ${m.tools.length} 次调用${running ? '（运行中）' : ''}</span><span class="think-separator" aria-hidden="true"></span><span class="think-summary"><span class="think-summary-text">${e(bashCmdText || m.tools.map(t => t.name).join(', '))}</span></span></button>${CS.ui.toolsOpen ? `<div class="tool-list">${m.tools.map(t => t.name === 'bash' ? `<div class="tool-item${t.running ? ' tool-running' : (V.toolIsErr(t.result) ? ' tool-err' : '')}">${V.toolTerminal(t.name, t.args, t.result, !!t.running)}</div>` : `<div class="tool-item${t.running ? ' tool-running' : (V.toolIsErr(t.result) ? ' tool-err' : '')}"><div class="tool-head"><code>${e(t.name)}</code><span class="tool-args">${e(JSON.stringify(t.args || {}).slice(0, 160))}</span>${t.running ? '<span class="tool-status">运行中…</span>' : ''}</div>${t.result != null ? `<pre class="tool-result">${e(String(t.result).slice(0, 600))}${String(t.result).length > 600 ? '\n…' : ''}</pre>` : ''}</div>`).join('')}</div>` : ''}</div>`; })() : ''}          <div class="agent-intro md-body"${m.streaming ? ` data-stream-at="${e(m.at)}"` : ''}>${CS.markdown(m.content)}</div>`;
            } else {
              // 单块渲染: 思考/工具块可折叠(状态存 CS.ui.blockOpen), 正文块渲染 markdown
              const seg = (b, bi) => {
                // 已返回结果的工具块视为完成; 否则等多轮循环的下一批事件时,
                // 尾部工具块会一直显示「运行中」
                const live = m.streaming && bi === lastIdx && b.result == null && b.type !== 'ask';
                if (b.type === 'text') {
                  // 计划卡: <plan>...</plan> 段渲染成可批准的审核卡(dsh plan-mode 思路);
                  // 服务端 content 保留原始 <plan> 标记, 回放时同样渲染这里
                  const t = b.text || '';
                  const pm = t.match(/^([\s\S]*?)<plan>([\s\S]*?)<\/plan>([\s\S]*)$/);
                  if (pm && pm[2].trim()) {
                    // 只有最后一条消息上的计划卡显示操作按钮, 历史 plan 只读
                    const canApprove = !m.streaming && idxOf === run.messages.length - 1;
                    return `${pm[1].trim() ? `<div class="agent-intro md-body">${CS.markdown(pm[1])}</div>` : ''}<div class="plan-card"><div class="plan-head">${i('workflow', '', 15)}<span>计划方案</span><span class="plan-tag">等待你的确认</span></div><div class="plan-body md-body">${CS.markdown(pm[2])}</div>${canApprove ? `<div class="plan-actions"><button type="button" class="btn primary" data-action="approve-plan" data-id="${idxOf}">批准并执行</button><button type="button" class="btn flat" data-action="refine-plan">继续讨论</button></div>` : '<div class="small muted plan-foot-hint">该计划已生成，可继续对话调整或直接下指令。</div>'}</div>${pm[3].trim() ? `<div class="agent-intro md-body">${CS.markdown(pm[3])}</div>` : ''}`;
                  }
                  return `<div class="agent-intro md-body"${live ? ` data-stream-at="${e(m.at)}"` : ''}>${CS.markdown(b.text)}</div>`;
                }
                if (b.type === 'ask') return renderAsk(b, bi);
                if (b.type === 'sysnote') {
                  const _sn = String(b.text || '').replace(/^\[System\]\s*/i, '').replace(/^\[Goal still active\]\s*/i, '');
                  const _tag = /background-results/.test(_sn) ? '后台结果回灌' : '注入提示';
                  return `<div class="sysnote-chip" title="${e(String(b.text || ''))}"><span class="sysnote-tag">${i('info', '', 12)}${_tag}</span><span class="sysnote-txt">${e(_sn.slice(0, 160))}${_sn.length > 160 ? '…' : ''}</span></div>`;
                }
                if (b.type === 'present') {
                  // 模型主动呈现的富媒介文件卡片: 图标按类别, 点击进预览
                  const k = b.klass || 'other';
                  const kicon = { image: 'eye', '3d': 'dna', video: 'play', audio: 'message', pdf: 'file', html: 'globe', text: 'file', archive: 'database', other: 'file' }[k] || 'file';
                  const kb = { image: '图片', '3d': '3D 模型', video: '视频', audio: '音频', pdf: 'PDF', html: 'HTML', text: '文本', archive: '压缩包', other: '文件' }[k] || '文件';
                  return `<div class="present-card" data-action="open-present" data-path="${e(b.path)}" data-klass="${e(b.klass || 'other')}" data-name="${e(b.name || '')}" data-title="${e(b.title || '')}" data-size="${e(String(b.size || 0))}" data-note="${e(b.note || '')}" data-bpid="${e(b.pid || '')}" role="button" tabindex="0" title="点击预览"><div class="present-ic">${i(kicon, '', 17)}</div><div class="present-body"><div class="present-name">${e(b.title || b.name || b.path)}</div><div class="present-sub small muted">${kb}${b.size ? ' · ' + CS.formatBytes(b.size) : ''}${b.note ? ' · ' + e(b.note) : ''}</div></div><span class="present-open small muted">查看</span></div>`;
                }
                if (b.type === 'deliverables') {
                  // 本轮修改文件行(dsh deliverables 思路): 来源只信 edit/write 参数
                  const files = Array.isArray(b.files) ? b.files : [];
                  if (!files.length) return '';
                  return `<div class="deliverables-row"><span class="deliverables-title">${i('file', '', 13)}本轮修改文件</span><div class="deliverables-chips">${files.map(f => `<button type="button" class="deliverable-chip" data-action="open-deliverable" data-path="${e(f.path)}" title="${e(f.path)}"><span class="deliverable-op">${e(f.op === 'write' ? '新建' : '修改')}</span>${e(String(f.path).split('/').pop())}</button>`).join('')}</div></div>`;
                }
                if (b.type === 'think') {
                  const open = blockOpen(bi);
                  return `<div class="think-root${live ? ' think-live' : ''}" data-state="${live ? 'running' : 'ok'}"${live ? ' data-live="1"' : ''}${open ? ' data-expanded="true"' : ''}><button type="button" class="think-row" data-action="toggle-block" data-id="${e(bkey(bi))}" aria-expanded="${open}"><span class="think-leading">${i('spark', '', 14)}<span class="think-chevron">${i('chevron', '', 12)}</span></span><span class="think-title">${live ? '思考中' : '已深度思考'}</span><span class="think-separator" aria-hidden="true"></span><span class="think-summary"${live ? ' data-follow-end=""' : ''}><span class="think-summary-text">${e(live ? b.text : ((b.text || '').split('\n').filter(Boolean)[0] || ''))}</span></span></button>${open ? `<div class="think-body"${live ? ' data-live-think="1"' : ''}>${e(b.text)}</div>` : ''}</div>`;
                }
                const meta = blockMeta(b);
                const open = blockOpen(bi);
                const isBash = b.name === 'bash';
                const bcmd = isBash ? bashCmd(b.args) : '';
                if (isBash) {
                  const summary = bcmd || '（无命令）';
                  return `<div class="think-root tool-root${live ? ' think-live' : ''}" data-state="${live ? 'running' : (V.toolIsErr(b.result) ? 'err' : 'ok')}"${open ? ' data-expanded="true"' : ''}><button type="button" class="think-row" data-action="toggle-block" data-id="${e(bkey(bi))}" aria-expanded="${open}"><span class="think-leading">${i('terminal', '', 14)}<span class="think-chevron">${i('chevron', '', 12)}</span></span><span class="think-title">${meta.label} ${e(b.name)}${live ? '（运行中）' : ''}</span><span class="think-separator" aria-hidden="true"></span><span class="think-summary"><span class="think-summary-text">${e(summary.length > 120 ? summary.slice(0, 120) + '…' : summary)}</span></span></button>${open ? V.toolTerminal(b.name, b.args, b.result, live) : ''}</div>`;
                }
                return `<div class="think-root tool-root${live ? ' think-live' : ''}" data-state="${live ? 'running' : (V.toolIsErr(b.result) ? 'err' : 'ok')}"${open ? ' data-expanded="true"' : ''}><button type="button" class="think-row" data-action="toggle-block" data-id="${e(bkey(bi))}" aria-expanded="${open}"><span class="think-leading">${i(meta.icon, '', 14)}<span class="think-chevron">${i('chevron', '', 12)}</span></span><span class="think-title">${meta.label} ${e(b.name)}${live ? '（运行中）' : ''}</span><span class="think-separator" aria-hidden="true"></span><span class="think-summary"><span class="think-summary-text">${e(JSON.stringify(b.args || {}).slice(0, 160))}</span></span></button>${open ? `<div class="tool-list"><div class="tool-item${live ? ' tool-running' : (V.toolIsErr(b.result) ? ' tool-err' : '')}"><div class="tool-head"><code>${e(b.name)}</code><span class="tool-args">${e(JSON.stringify(b.args || {}).slice(0, 160))}</span>${live ? '<span class="tool-status">运行中…</span>' : ''}</div>${b.result != null ? (V.isUnifiedDiff(String(b.result)) ? V.renderUnifiedDiff(String(b.result).slice(0, 20000)) : `<pre class="tool-result">${e(String(b.result).slice(0, 600))}${String(b.result).length > 600 ? '\n…' : ''}</pre>`) : ''}</div></div>` : ''}</div>`;
              };
              // ask 问题卡: 未回答时可选项+自由输入; 已回答后默认折叠成一行摘要,
              // 点标题行可重新展开查看原问题与所选答案; 失效后回放提示
              const renderAsk = (b, bi) => {
                const key = bkey(bi);
                const qs = b.questions || [];
                const state = b.answered ? 'answered' : (b.stale ? 'stale' : 'pending');
                const title = qs.length > 1 ? `模型向你提出了 ${qs.length} 个问题` : '模型向你提问';
                const sel = (CS.ui.askSel || {})[key] || {};
                // 用户答复按问题 id 索引, 供展开态回放选中项/自定义文本
                const answeredBody = (() => {
                  const ansById = {};
                  for (const a of (b.answers || [])) ansById[String(a.id || '')] = a;
                  return qs.map((q, qi) => {
                    const ans = ansById[String(q.id || '')] || ansById[`q${qi + 1}`] || {};
                    const selectedLabels = (ans.selected || []);
                    const opts = (q.options || []).map(o => `<span class="ask-option${selectedLabels.includes(o.label) ? ' selected' : ''}"${o.description ? ` title="${e(o.description)}"` : ''}><span class="ask-option-label">${e(o.label)}</span>${o.description ? `<span class="ask-option-desc">${e(o.description)}</span>` : ''}</span>`).join('');
                    const custom = String(ans.custom || '').trim();
                    const yourText = selectedLabels.length ? `你的选择：${e(selectedLabels.join('、'))}` : '';
                    return `<div class="ask-q"><div class="ask-q-head">${q.header ? `<span class="ask-q-chip">${e(q.header)}</span>` : ''}<span class="ask-q-text">${e(q.question)}</span></div>${opts ? `<div class="ask-options">${opts}</div>` : ''}${yourText || custom ? `<div class="ask-your-answer">${yourText}${yourText && custom ? ' · ' : ''}${custom ? `补充：<span>${e(custom)}</span>` : ''}</div>` : ''}</div>`;
                  }).join('');
                })();
                if (state === 'answered') {
                  const open = !!(CS.ui.askOpen || {})[key];
                  return `<div class="ask-card ask-answered" data-ask-state="answered"${open ? ' data-expanded="1"' : ''}><button type="button" class="ask-answered-row" data-action="toggle-ask" data-id="${e(key)}" aria-expanded="${open}"><span class="ask-head-icon">${i('help', '', 14)}</span><span class="ask-chevron">${i('chevron', '', 12)}</span><span class="ask-title">${e(title)}</span><span class="ask-answered-text">${e(String(b.result || '').slice(0, 300))}</span></button>${open ? `<div class="ask-answered-body">${answeredBody}</div>` : ''}</div>`;
                }
                const body = qs.map((q, qi) => {
                  const picked = sel[qi] || new Set();
                  const opts = (q.options || []).map((o, oi) => `<button type="button" class="ask-option${picked.has(oi) ? ' selected' : ''}" data-action="ask-pick-option" data-id="${e(key)}" data-qi="${qi}" data-oi="${oi}"${o.description ? ` title="${e(o.description)}"` : ''}><span class="ask-option-label">${e(o.label)}</span>${o.description ? `<span class="ask-option-desc">${e(o.description)}</span>` : ''}</button>`).join('');
                  const draft = ((CS.ui.askDraft || {})[`${key}|${qi}`] || '');
                  return `<div class="ask-q"><div class="ask-q-head">${q.header ? `<span class="ask-q-chip">${e(q.header)}</span>` : ''}<span class="ask-q-text">${e(q.question)}</span></div>${opts ? `<div class="ask-options">${opts}</div>` : ''}${state === 'pending' ? `<input class="ask-custom-input" data-key="${e(key + '|' + qi)}" placeholder="${e(q.multi_select ? '补充说明（可选）' : '自由输入答案（可选）')}" value="${e(draft)}" autocomplete="off">` : ''}</div>`;
                }).join('');
                const footer = state === 'pending' ? `<button type="button" class="btn primary small-btn ask-submit-btn" data-action="ask-submit" data-id="${e(key)}"${b.submitting ? ' disabled' : ''}>${b.submitting ? '发送中…' : '发送回答'}</button>` : `<p class="hint">该问题因页面刷新或停止已失效，无法再回答。</p>`;
                return `<div class="ask-card" data-ask-state="${state}"><div class="ask-head">${i('help', '', 14)}<span class="ask-title">${e(title)}</span><span class="tool-status">${state === 'pending' ? '等待你的回答…' : '已失效'}</span></div>${body}<div class="ask-foot">${footer}</div></div>`;
              };
              const tailText = blocks.length && blocks[lastIdx].type === 'text';
              // 未回答的 ask 挂在尾部时, 等待指示改为「等待你的回答」
              const tailAskPending = m.streaming && blocks.length && blocks[lastIdx].type === 'ask' && !blocks[lastIdx].answered && !blocks[lastIdx].stale;
              // 等待模型响应: 流式中没有正在输出的正文; 典型场景是工具刚返回完,
              // 模型下一轮首字尚未到达, 给出一个轻量等待指示
              const waitingModel = m.streaming && !tailText && !tailAskPending && (!blocks.length || (blocks[lastIdx].type === 'tool' && blocks[lastIdx].result != null) || (blocks[lastIdx].type === 'ask' && (blocks[lastIdx].answered || blocks[lastIdx].stale)));
              const waitHint = (waitingModel || tailAskPending) ? (() => { const rt = CS.ui.chatRetry; const active = rt && rt.runId === run.id; const label = tailAskPending ? '等待你的回答' : active ? `第 ${Math.min(rt.attempt + 1, rt.total)}/${rt.total} 次尝试中` : '等待模型响应'; const tip = active && rt.error ? ` title="${e(rt.error)}"` : ''; return `<div class="model-wait" role="status"${tip}><span class="wait-dots" aria-hidden="true"><span class="wait-dot"></span><span class="wait-dot"></span><span class="wait-dot"></span></span><span>${label}${active && !tailAskPending ? ' · 上次失败' : ''}</span></div>`; })() : '';
              // 流式期间最后一块不是正文时补一个空正文占位, 供增量更新定位与底部跟随
              segments = `${blocks.map(seg).join('')}${m.streaming && !tailText ? `<div class="agent-intro md-body" data-stream-at="${e(m.at)}"></div>${waitHint}` : ''}`;
            }
            const err = m.error ? (typeof m.error === 'string' ? { message: m.error } : m.error || {}) : null;
            return `<div class="msg-block agent-block" data-mi="${idxOf}"><div class="agent-message"><div class="agent-avatar${m.streaming ? ' avatar-pulsing' : ' '}">${i('dna','',21)}</div><div class="agent-body"${blocks ? ` data-block-sig="${e(blocks.map(b => b.type).join(','))}"` : ''}><div class="agent-name">SigmaFlow Science${m.streaming && m.tokens ? ` <span class="tok-down" data-start="${m.at}">↓ ${CS.num(m.tokens)}</span>` : (m.streaming ? ` <span class="tok-down" data-start="${m.at}">↓ 0</span>` : '')}${m.streaming ? ` <span class="elapsed-timer" data-start="${m.at}">${CS.elapsed(m.at)}</span>` : (m.elapsed != null ? ` <span class="elapsed-timer elapsed-done">${CS.elapsedMs(m.elapsed)}</span>` : '')}${CS.tokRateTag(m)}</div>${segments}${err ?(() => { const errKey = (run.id || ['']) + '|' + idxOf; const errOpen = (CS.ui.errorOpenSet || []).has ? CS.ui.errorOpenSet.has(errKey) : false; return `<div class="think-root error-root"${errOpen ? ' data-expanded="true"' : ''}><button type="button" class="think-row" data-action="toggle-error" data-errkey="${e(errKey)}" aria-expanded="${errOpen}"><span class="think-leading">${i('alert', '', 14)}<span class="think-chevron">${i('chevron', '', 12)}</span></span><span class="think-title">请求出错</span><span class="think-separator" aria-hidden="true"></span><span class="think-summary"><span class="think-summary-text">${e(String(err.message || '未知错误').split('\n')[0])}</span></span></button>${errOpen ? `<div class="error-body"><pre class="error-detail">${e(err.detail || err.message || '')}</pre></div>` : ''}</div>`; })() : ''}${m.streaming ? '' : `<div class="message-meta-row"><span class="message-meta">${CS.datetime(m.at)}</span>${m.role === 'assistant' && m.tokens ? `<span class="message-meta">${CS.num(m.contextTokens || m.promptTokens || 0)} in · ${CS.num(m.tokens)} out</span>${CS.tokRateTag(m)}` : ''}<span class="message-actions"><span class="icon-btn${m.feedback && m.feedback.rating === 'up' ? ' rated rated-up' : ''}" role="button" data-action="rate-message" data-id="${idxOf}" data-rating="up" title="点赞">${i('thumbup','',13)}</span><span class="icon-btn${m.feedback && m.feedback.rating === 'down' ? ' rated rated-down' : ''}" role="button" data-action="rate-message" data-id="${idxOf}" data-rating="down" title="点踩">${i('thumbdown','',13)}</span><span class="icon-btn" role="button" data-action="copy-message" data-id="${idxOf}" title="复制">${i('copy','',13)}</span><span class="icon-btn" role="button" data-action="branch-chat" data-id="${idxOf}" title="分支到新聊天">${i('workflow','',13)}</span></span></div>`}</div></div></div>`;
          })(); };
      return `<section class="page chat-page"><div class="chat-layout no-inspector"><div class="chat-main chat-main-chat"><header class="chat-title chat-title-compact"><div><h1 title="${e(run.title)}">${e(run.title)}</h1><p class="small muted">${e(CS.state.projects.find(p => p.id === run.projectId)?.name || '未指定项目')} <span class="faint"> / </span> ${e(CS.state.settings.model || '默认模型')}</p></div>${V.runUsage()}</header>
      <div class="conversation">${run.messages.map(bubble).join('')}</div>
      ${V.composer(false)}</div></div></section>`;
    }
    const waiting = run.status === 'awaiting'; const completed = run.status === 'complete';
    const approveLabel = run.status === 'paused' ? '继续执行' : run.status === 'error' ? '重试连接' : '确认并执行';
    const controls = ['awaiting','paused','error'].includes(run.status) ? btn('approve-run',approveLabel,'play','primary') : run.status === 'running' ? btn('pause-run','暂停','pause','flat') : '';
    const cancel = ['awaiting','running','paused','error'].includes(run.status) ? btn('cancel-run','取消任务','stop','flat') : '';
    return `<section class="page chat-page"><div class="chat-layout ${!CS.state.settings.inspector ? 'no-inspector' : ''}"><div class="chat-main"><header class="chat-title"><div><h1 title="${e(run.title)}">${e(run.title)}</h1><p class="small muted">${e(CS.state.projects.find(p => p.id === run.projectId)?.name || '未指定项目')} <span class="faint"> / </span> 演示任务</p></div>${V.runUsage()}<div class="row">${status(run.status)}${iconBtn('toggle-inspector','panel','显示 / 隐藏任务详情')}</div></header>
      <div class="conversation"><div class="user-message">${e(run.prompt)}${run.datasetIds.length ? `<div class="attachment-list mt-12">${run.datasetIds.map(id => `<span class="attachment">${i('file')}${e(CS.state.datasets.find(d => d.id === id)?.name || '已删除的输入记录')}</span>`).join('')}</div>` : ''}<div class="message-meta">${CS.time(run.createdAt)}</div></div>
      <div class="agent-message"><div class="agent-avatar${run.streaming ? ' avatar-pulsing' : ' '}">${i('dna','',21)}</div><div class="agent-body"><div class="agent-name">SigmaFlow Science <span class="pill small">演示 Agent</span></div><p class="agent-intro">${completed ? '演示流程已完成。下面保留了每一步的状态、输入记录与可导出的结果。' : waiting ? '我已将你的问题整理为以下演示计划。请先检查输入与步骤，确认后再执行。' : '正在按已确认的计划展示任务进度。你可以随时暂停、查看日志，或取消任务。'}所有分析图表均使用预设合成数据，不对上传文件进行生物学分析。</p>
      <div class="run-card" data-phase="${run.status}"><div class="run-card-title"><div class="row">${run.status === 'running' ? '<span class="spinner"></span>' : i(completed ? 'checkcircle' : 'workflow','',17)}<strong>${waiting ? '执行前，确认你的分析计划' : completed ? '演示分析已完成' : 'Agent 任务进度'}</strong></div><span class="small muted">${run.progress}%</span></div><div class="run-progress"><span style="width:${run.progress}%"></span></div><ol class="step-list">
      ${run.steps.map((s, index) => `<li class="step ${s.status}"><span class="step-bullet">${s.status === 'complete' ? i('check') : index + 1}</span><div class="step-title"><span>${e(s.title)}</span>${!waiting ? `<span class="step-progress-mini"><span class="track"><span style="width:${s.progress}%"></span></span>${s.progress}%</span>` : ''}</div><p class="step-description">${e(s.description)}</p>${!waiting ? `<button class="step-log-toggle" data-action="toggle-log" data-id="${index}">${i('chevron', CS.ui.expandedLogs.has(index) ? 'rotate' : '')} ${e(s.tool)} · ${s.status === 'complete' ? '查看日志' : s.status === 'running' ? '运行中' : '等待执行'}</button>${CS.ui.expandedLogs.has(index) ? `<pre class="step-log">${e(`[${s.tool}] ${s.status === 'complete' ? s.output : s.status === 'running' ? 'Simulating… 仅演示进度' : 'Waiting…'}\nSource: synthetic fixture · no uploaded file execution`)}</pre>` : ''}` : ''}</li>`).join('')}
      </ol><div class="run-actions"><span class="run-note">${run.reloaded ? run.transport === 'remote' ? '页面已重载，请重连同步服务端状态。' : '页面曾重新加载，执行已暂停。' : completed ? '执行记录已保存在当前工作空间。' : '仅在确认后执行。演示模式不会产生模型费用。'}</span><div class="row gap-6">${controls}${cancel}${completed ? btn('open-results','查看结果','arrow','primary') : ''}${run.status === 'cancelled' ? btn('restart-run','重新规划','refresh','flat') : ''}</div></div></div>
      ${run.status === 'error' ? `<div class="mt-12">${notice(run.error || '连接中断，请检查接口配置。')}</div>` : ''}
      ${completed ? `<div class="result-file">${tile('file')}<div class="grow"><strong>analysis_record.md</strong><div class="sub">演示记录 · 包含输入、步骤、参数与限制</div></div>${iconBtn('export-report','download','导出报告')}</div>` : ''}
      </div></div>${run.messages.map(m => m.role === 'user' ? `<div class="user-message">${e(m.content)}${m.datasetIds?.length ? `<div class="attachment-list mt-12">${m.datasetIds.map(id => `<span class="attachment">${i('file')}${e(CS.state.datasets.find(d => d.id === id)?.name || id)}</span>`).join('')}</div>` : ''}<div class="message-meta">${CS.time(m.at)}</div></div>` : `<div class="agent-message"><div class="agent-avatar${m.streaming ? ' avatar-pulsing' : ' '}">${i('dna','',21)}</div><div class="agent-body"><div class="agent-name">SigmaFlow Science${m.streaming && m.tokens ? ` <span class="tok-down" data-start="${m.at}">↓ ${CS.num(m.tokens)}</span>` : ''}${m.streaming ? ` <span class="elapsed-timer" data-start="${m.at}">${CS.elapsed(m.at)}</span>` : (m.elapsed != null ? ` <span class="elapsed-timer elapsed-done">${CS.elapsedMs(m.elapsed)}</span>` : '')}${CS.tokRateTag(m)}</div><p class="agent-intro">${e(m.content)}</p></div></div>`).join('')}</div>${V.composer(false)}</div>
      ${V.inspector(run)}</div></section>`;
  };
  V.inspector = run => `<aside class="inspector" aria-label="任务详情"><div class="panel panel-pad"><div class="row-between"><h3>任务详情</h3>${i('panel','muted',15)}</div><div class="section-label">输入上下文</div>${run.datasetIds.length ? run.datasetIds.map(id => `<div class="inspector-file">${i('file')}<span>${e(CS.state.datasets.find(d => d.id === id)?.name || id)}</span></div>`).join('') : '<p class="small muted">无附件 · 使用合成示例</p>'}<hr class="divider"><div class="info-pairs"><span>工作流</span><span>${e(CS.workflow(run.workflowId).category)}</span><span>运行环境</span><span>${run.transport === 'local' ? '浏览器模拟' : (run.channel === 'ws' ? 'WebSocket' : 'HTTP / SSE')}</span><span>输入文件</span><span>${run.datasetIds.length} 份记录</span><span>流程步骤</span><span>${run.steps.length} 步</span><span>创建时间</span><span>${CS.time(run.createdAt)}</span></div><div class="section-label">执行边界</div><p class="small muted">不执行代码，不上传文件，不调用真实模型。结果用于演示交互与页面状态。</p></div><div class="panel panel-pad"><h3>相关资料</h3><a class="inspector-resource" href="https://scanpy.readthedocs.io/" target="_blank" rel="noopener noreferrer"><span>Scanpy 文档</span>${i('external','',12)}</a><a class="inspector-resource" href="https://www.ncbi.nlm.nih.gov/" target="_blank" rel="noopener noreferrer"><span>NCBI 公共资源</span>${i('external','',12)}</a><button class="inspector-resource full" style="background:none" data-nav="literature"><span>项目文献清单</span>${i('arrow','',12)}</button></div>${notice('人工确认 → 可查看的执行日志 → 可追溯的输出。')}</aside>`;

  V.data = () => {
    const f = CS.ui.filters; const rows = CS.state.datasets.filter(d => (f.dataTab === 'all' || d.source === f.dataTab) && (d.name + d.format + d.description).toLowerCase().includes(f.data.toLowerCase()));
    const local = CS.state.datasets.filter(d => d.source === 'local');
    return `<section class="page">${header('DATA LIBRARY','让数据井然有序','导入、预览并组织研究数据。原始文件不会由本地演示上传。',btn('import-data','导入数据','plus','primary'))}
      <div class="data-overview"><div class="panel stat-card">${tile('database')}<div><div class="stat-number">${CS.state.datasets.length}</div><div class="stat-label">数据记录</div></div></div><div class="panel stat-card">${tile('file','blue')}<div><div class="stat-number">${local.length}</div><div class="stat-label">本地导入文件</div></div></div><div class="panel stat-card">${tile('shield','green')}<div><div class="stat-number">本地</div><div class="stat-label">演示模式 · 不上传</div></div></div></div>
      <div class="toolbar"><div class="tabs">${tab('data-tab','all','全部数据',f.dataTab === 'all',CS.state.datasets.length)}${tab('data-tab','local','我的文件',f.dataTab === 'local',local.length)}${tab('data-tab','demo','示例数据',f.dataTab === 'demo',CS.state.datasets.length - local.length)}</div>${search('data-search','搜索名称或文件格式',f.data)}</div>
      ${CS.ui.datasetSelection.size ? `<div class="selection-bar"><span>已选 ${CS.ui.datasetSelection.size} 份记录</span>${btn('export-dataset-metadata','导出元数据','download','small-btn flat')}${btn('delete-datasets','移除记录','trash','small-btn flat danger')}</div>` : ''}
      <div class="panel">${rows.length ? `<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="select-all-data" aria-label="选择当前列表所有文件" ${rows.every(d => CS.ui.datasetSelection.has(d.id)) ? 'checked' : ''}></th><th>名称</th><th>格式</th><th>大小</th><th>来源</th><th>添加时间</th><th class="right">操作</th></tr></thead><tbody>${rows.map(d => `<tr class="row-hover"><td><input type="checkbox" data-check-dataset="${e(d.id)}" aria-label="选择 ${e(d.name)}" ${CS.ui.datasetSelection.has(d.id) ? 'checked' : ''}></td><td><div class="name-cell">${tile(d.format === 'FASTA' ? 'dna' : d.format === 'H5AD' ? 'cells' : 'file',d.source === 'local' ? 'green' : '')}<div><button class="text-button" data-action="preview-data" data-id="${e(d.id)}">${e(d.name)}</button><span class="sub">${e(d.source === 'local' ? CS.files.has(d.id) ? '当前会话可预览' : '仅元信息 · 重新选择可恢复内容' : '示例记录 · 非真实分析数据')}</span></div></div></td><td>${pill(d.format)}</td><td class="muted">${CS.formatBytes(d.size)}</td><td>${pill(d.source === 'local' ? '本地导入' : '演示',d.source === 'local' ? 'green' : '')}</td><td class="muted">${e(d.added)}</td><td class="right">${iconBtn('preview-data','eye','查看文件',`data-id="${e(d.id)}"`)}${iconBtn('attach-dataset','plus','附加到新对话',`data-id="${e(d.id)}"`)}</td></tr>`).join('')}</tbody></table></div>` : empty('database','没有匹配的数据','更换筛选条件，或导入新的研究文件。')}
      <div class="panel-foot row-between"><span>${rows.length} 份记录 · 示例文件大小仅用于界面展示</span>${btn('download-sample','下载示例 CSV','download','small-btn flat')}</div></div><div class="mt-20">${notice('刷新后只保留文件元信息，不保留原始文件内容。CSV / TSV 可在本地预览前 100 行；H5AD 等二进制文件仅登记。')}</div></section>`;
  };
  V.projects = () => {
    const f = CS.ui.filters; const projects = CS.state.projects.filter(p => (!!p.archived === (f.projectTab === 'archived')) && (p.name + p.description).toLowerCase().includes(f.project.toLowerCase()));
    return `<section class="page">${header('PROJECTS','每一个问题，都有自己的空间','把数据、对话与执行记录组织到同一个研究项目。',btn('new-project','新建项目','plus','primary'))}<div class="toolbar"><div class="tabs">${tab('project-tab','active','我的项目',f.projectTab === 'active')}${tab('project-tab','archived','已归档',f.projectTab === 'archived')}</div>${search('project-search','搜索项目',f.project)}</div>
      ${projects.length ? `<div class="project-grid">${projects.map(p => `<article class="panel project-card"><div class="row-between">${tile(p.icon || 'folder')}${iconBtn('edit-project','edit','编辑项目',`data-id="${e(p.id)}"`)}</div><button class="text-button" data-action="open-project" data-id="${e(p.id)}"><h3>${e(p.name)}</h3></button><p>${e(p.description)}</p><div class="row gap-6 wrap">${(p.tags || []).map(t => pill(t)).join('')}</div><div class="project-meta"><span>${CS.state.runs.filter(r => r.projectId === p.id).length} 次任务 · ${CS.state.datasets.filter(d => d.projectId === p.id).length} 份数据</span><button class="text-button" data-action="open-project" data-id="${e(p.id)}">打开 ${i('arrow','',13)}</button></div></article>`).join('')}</div>` : empty('folder','这里还没有项目','创建一个项目，为新的研究留出空间。')}<div class="page-footer">${i('lock','',12)} 项目元信息仅保存在本机浏览器</div></section>`;
  };

  V.workflows = () => {
    const current = CS.workflow(CS.ui.workflowId);
    const list = CS.data.workflows.filter(w => CS.ui.workflowCategory === 'all' || w.category === CS.ui.workflowCategory);
    return `<section class="page">${header('WORKFLOWS','研究目标，变成清晰的步骤','先选择流程与输入，再由你确认执行。所有流程当前为界面演示。')}<div class="workflow-layout"><div><div class="tabs">${['all','单细胞','转录组','文献','通用'].map(id => tab('workflow-category',id,id === 'all' ? '全部' : id,CS.ui.workflowCategory === id)).join('')}</div><div class="workflow-list">${list.map(w => `<button class="workflow-option ${w.id === current.id ? 'selected' : ''}" data-action="select-workflow" data-id="${w.id}">${tile(w.icon)}<div><h3>${e(w.title)}</h3><p>${e(w.sub)}</p><div class="sub">${w.steps.length} 个步骤 <span class="faint"> / </span> ${e(w.time)}</div></div><span class="radio"></span></button>`).join('')}</div><div class="flow-summary"><span>选择输入</span>${i('chevron')}<span>确认计划</span>${i('chevron')}<span>执行与检查</span>${i('chevron')}<span>结果与记录</span></div>${notice('此版本展示真实可交互的任务状态，不运行 Scanpy、差异分析或模型推理。参数会写入任务记录，便于对接后端。')}</div>
      <aside class="panel workflow-config"><h3>配置这次分析</h3><div class="config-inputs"><div class="field"><label for="workflow-dataset">输入数据</label><select id="workflow-dataset">${CS.state.datasets.map(d => `<option value="${e(d.id)}" ${CS.ui.datasetId === d.id ? 'selected' : ''}>${e(d.name)}${d.source === 'demo' ? ' · 演示' : ''}</option>`).join('')}</select><span class="hint">原始文件不会随演示任务上传。</span></div><div class="field"><label for="workflow-organism">物种上下文</label><select id="workflow-organism">${['Homo sapiens','Mus musculus','Arabidopsis thaliana','未指定'].map(s => `<option ${s === CS.ui.organism ? 'selected' : ''}>${s}</option>`).join('')}</select></div><div class="field full-span"><label>运行方式</label><div class="notice">${i('shield','',14)}<span>${CS.state.settings.mode === 'local' ? '浏览器本地演示' : 'WebSocket 优先 · HTTP/SSE 兼容'} · 人工确认后执行</span></div></div><div class="full-span"><button class="text-button" data-action="toggle-advanced">${i('chevron',CS.ui.advanced ? 'rotate' : '',13)}高级参数 ${pill('仅记录')}</button>${CS.ui.advanced ? `<div class="field-row mt-20"><div class="field"><label for="min-genes">min_genes</label><input id="min-genes" type="number" min="1" max="10000" value="${CS.ui.minGenes}"></div><div class="field"><label for="max-mito">max_mito (%)</label><input id="max-mito" type="number" min="0" max="100" value="${CS.ui.maxMito}"></div></div><p class="tiny muted">这些是可编辑的配置示例，不构成实验或分析参数建议。</p>` : ''}</div></div><div class="config-footer"><div class="row-between small muted mb-20"><span>${e(current.title)}</span><span>${current.steps.length} 步</span></div>${btn('start-workflow','生成分析计划','arrow','primary full')}</div></aside></div></section>`;
  };

  V.results = () => {
    const run = CS.currentRun();
    if (run && run.workflowId !== 'singlecell') return `<section class="page">${header('RUN RECORD',run.title,'此工作流只生成演示执行记录，不生成真实科研结论。',btn('export-report','导出记录','download','primary'))}${notice('此演示仅记录输入和步骤。打开单细胞示例可体验合成点云与表达图表。')}<article class="panel report-document"><h2>任务执行记录</h2><p class="mt-8">${e(run.prompt)}</p><h3>执行状态</h3>${status(run.status)}<h3>已配置的步骤</h3><ol>${run.steps.map(s => `<li>${e(s.title)} — ${s.progress}%</li>`).join('')}</ol><h3>配置</h3><pre>${e(JSON.stringify(run.config,null,2))}</pre><div class="mt-20">${btn('open-current-chat','返回对话','back','flat')}${btn('show-sample-results','查看单细胞界面示例','chart','flat')}</div></article></section>`;
    const active = CS.ui.resultTab;
    return `<section class="page">${header('ANALYSIS RESULTS','PBMC 单细胞图谱','让数据可见，让每一个结论都有上下文。',btn('export-chart','导出图表','download','flat') + btn('export-report','导出记录','file','primary'))}
      <div class="result-banner"><div class="row">${i('info','',16)}<span>合成演示数据 · 图表与上传文件无关，不代表实际生物学结果。</span></div>${pill(run ? CS.statusLabel(run.status) : '示例预览')}</div><div class="tabs underline">${tab('result-tab','overview','概览',active === 'overview')}${tab('result-tab','atlas','细胞图谱',active === 'atlas')}${tab('result-tab','markers','表达特征',active === 'markers')}${tab('result-tab','report','分析记录',active === 'report')}</div>
      ${active === 'overview' ? `<div class="result-stats">${[['细胞数','2,680','合成数据集规模'],['基因数','13,714','示例元信息'],['细胞分组','5','人为设定的分组标签'],['图中点数',CS.points.length.toLocaleString(),'约 1/4 的合成细胞']].map(([label,value,detail]) => `<div class="panel result-stat"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div></div>`).join('')}</div><div class="result-grid">${V.scatterPanel()}<div class="stack result-side-stack"><section class="panel"><div class="panel-head"><h3>细胞组成</h3>${pill('合成')}</div>${CS.bars()}</section><section class="panel result-note"><h3 class="row">${i('spark','',16)} 怎样阅读这张图</h3><p>每个点代表一个合成细胞，颜色对应预设分组。点击图例或右侧分组可高亮；点击数据点查看它的示例信息。</p><div class="mt-12">${btn('explain-result','在对话中继续','arrow','small-btn flat')}</div></section></div></div>` : ''}
      ${active === 'atlas' ? `<div class="mt-28">${V.scatterPanel()}</div>` : ''}
      ${active === 'markers' ? `<div class="result-grid mt-28"><section class="panel"><div class="panel-head"><h3>示例表达矩阵</h3>${pill('合成值')}</div><div class="panel-pad">${CS.heatmap()}</div><div class="panel-foot">色深用于示意表达量变化；不是上传数据的分析结果。</div></section><section class="panel result-note"><h3>查看表达特征</h3><p>这里演示分组、特征表与图表联动。所有数值是用于界面开发的固定示例。</p><div class="mt-20">${btn('export-markers','导出示例 CSV','download','small-btn flat')}</div></section></div><div class="panel mt-28"><div class="panel-head"><h3>表达特征表 · 合成</h3>${search('marker-search','筛选基因或分组',CS.ui.markerSearch)}</div>${renderTable(['基因','分组标签','示例表达量','示例检出比例'],CS.data.markers.filter(m => (m.gene+m.group).toLowerCase().includes(CS.ui.markerSearch.toLowerCase())).map(m => `<tr><td class="mono">${m.gene}</td><td>${e(m.group)}</td><td><div class="expression-value"><span style="width:${m.value * 24}px"></span>${m.value.toFixed(2)}</div></td><td>${m.fraction}</td></tr>`).join(''))}</div>` : ''}
      ${active === 'report' ? V.reportDocument(run) : ''}<div class="page-footer">${i('shield','',12)} 所有示例均标注来源与限制 · 固定随机种子 3724</div></section>`;
  };
  V.scatterPanel = () => `<section class="panel chart-panel"><div class="panel-head"><div><h3>细胞嵌入图</h3><span class="tiny muted">合成点云 · UMAP 界面示意</span></div><div class="chart-tools">${iconBtn('zoom-out','minus','缩小')}${iconBtn('zoom-reset','refresh','重置视图')}${iconBtn('zoom-in','plus','放大')}${iconBtn('export-chart','download','导出 SVG')}</div></div><div class="chart-area">${CS.scatter()}</div><div class="chart-legend">${CS.data.groups.map((g, index) => `<button class="legend-item ${CS.ui.group !== 'all' && CS.ui.group !== String(index) ? 'muted-item' : ''}" data-action="filter-group" data-id="${index}" aria-pressed="${CS.ui.group === String(index)}"><i style="background:${g.color}"></i>${e(g.name)}</button>`).join('')}</div><div class="panel-foot row-between"><span>${CS.ui.selectedCell ? e(CS.ui.selectedCell + ' · 合成示例') : '点击分组高亮 · 点击数据点查看'}</span><button class="text-button small" data-action="filter-group" data-id="all">显示全部</button></div></section>`;
  V.reportDocument = run => `<article class="panel report-document"><div class="row-between"><span class="divider-label">RESEARCH RECORD</span>${pill('演示记录')}</div><h2 class="mt-20">PBMC 单细胞图谱 · 分析记录</h2><p>由 SigmaFlow Science 整理 · ${CS.today()}</p><hr class="divider">${notice('以下是界面演示说明，不是真实分析结果。不可用于论文结论、临床决策或实验决策。')}<h3>01 / 研究问题</h3><p>${e(run?.prompt || '体验单细胞数据检查、任务执行与结果交互的完整过程。')}</p><h3>02 / 输入与分析流程</h3><p>界面加载固定种子的合成点云与表达示例。输入的文件名及配置用于演示上下文管理，不代表已处理这些文件。</p><ol>${CS.workflow('singlecell').steps.map(s => `<li>${e(s[0])}</li>`).join('')}</ol><h3>03 / 可复现记录</h3><pre>${e(JSON.stringify({ source: 'synthetic-ui-fixture', seed: 3724, syntheticCells: 2680, displayedPoints: CS.points.length, groups: 5, config: run?.config || {} },null,2))}</pre><h3>04 / 局限与下一步</h3><p>生产部署需接入真实模型、数据解析、计算任务调度与权限控制。此演示不包含这些服务，也不会将模拟输出包装为科学结论。</p><div class="row mt-28">${btn('export-report','导出 Markdown','download','primary')}${btn('export-run-json','导出任务 JSON','code','flat')}</div></article>`;

  V.literature = () => {
    const f = CS.ui.filters; const papers = CS.data.papers.filter(p => (f.paperTab !== 'saved' || CS.state.bookmarks.includes(p.id)) && (p.title+p.authors+p.tags.join(' ')).toLowerCase().includes(f.literature.toLowerCase()));
    return `<section class="page">${header('LITERATURE','研究，不止于一份答案','将文献、阅读笔记与研究上下文放在一起。',btn('export-bibliography','导出文献清单','download','flat'))}<div class="panel query-panel"><label for="pubmed-query">到 PubMed 检索文献</label><div class="row"><input id="pubmed-query" placeholder="例如 single-cell RNA-seq quality control" value="${e(CS.ui.pubmedQuery || '')}" aria-label="PubMed 检索关键词">${btn('search-pubmed','在 PubMed 打开','external','flat')}</div><p class="tiny faint mt-8">点击后打开官方检索页面；下方是预置阅读资料，不是实时搜索结果。</p></div><div class="toolbar"><div class="tabs">${tab('paper-tab','all','文献库',f.paperTab === 'all',CS.data.papers.length)}${tab('paper-tab','saved','已收藏',f.paperTab === 'saved',CS.state.bookmarks.length)}</div>${search('paper-search','筛选本地文献',f.literature)}</div><div class="literature-layout"><div class="stack">${papers.length ? papers.map((p, index) => `<article class="panel paper-card"><span class="paper-index">${String(index + 1).padStart(2,'0')} / ${e(p.journal)} · ${p.year}</span><button class="icon-btn save-paper ${CS.state.bookmarks.includes(p.id) ? 'active' : ''}" data-action="bookmark-paper" data-id="${p.id}" aria-label="${CS.state.bookmarks.includes(p.id) ? '取消收藏' : '收藏文献'}" title="收藏文献">${i('bookmark')}</button><h3>${e(p.title)}</h3><div class="paper-authors">${e(p.authors)}</div><p>${e(p.note)}</p><div class="row gap-6">${p.tags.map(t => pill(t)).join('')}</div><div class="paper-actions"><a href="https://doi.org/${encodeURI(p.doi)}" target="_blank" rel="noopener noreferrer" class="text-button">打开原文 ${i('external','',13)}</a><div class="row gap-16"><button class="text-button" data-action="copy-citation" data-id="${p.id}">${i('copy','',13)} 引用</button><button class="text-button" data-action="paper-note" data-id="${p.id}">${i('edit','',13)} ${CS.state.notes[p.id] ? '查看笔记' : '添加笔记'}</button></div></div></article>`).join('') : empty('book','没有匹配的文献','尝试其他关键词，或打开全部文献。')}</div><aside class="panel reading-panel"><div class="row-between"><h3>我的阅读清单</h3>${pill(String(CS.state.bookmarks.length))}</div>${CS.state.bookmarks.length ? CS.data.papers.filter(p => CS.state.bookmarks.includes(p.id)).map(p => `<div class="reading-item">${e(p.title)}<p>${e(p.journal)} · ${p.year}</p></div>`).join('') : `<div class="empty" style="padding:32px 2px">${i('bookmark')}<p>收藏一篇文献，<br>让值得保留的证据留在这里。</p></div>`}<hr class="divider"><p class="small muted">每条文献保留原文入口。笔记保存在当前浏览器，不自动生成证据结论。</p><div class="mt-20">${btn('literature-plan','创建文献整理任务','arrow','small-btn flat full')}</div></aside></div></section>`;
  };

  V.tools = () => {
    const f = CS.ui.filters; const tools = CS.data.tools.filter(t => (f.toolTab === 'all' || f.toolTab === 'local' && t.local || f.toolTab === 'external' && !t.local) && (t.name + t.description).toLowerCase().includes(f.tools.toLowerCase()));
    return `<section class="page">${header('RESEARCH TOOLS','合适的工具，恰好在手边','轻量本地计算与公共科研资源。不伪装连接状态，不隐藏数据去向。')}<div class="toolbar"><div class="tabs">${tab('tool-tab','all','全部工具',f.toolTab === 'all')}${tab('tool-tab','local','本地计算',f.toolTab === 'local')}${tab('tool-tab','external','公共资源',f.toolTab === 'external')}</div>${search('tool-search','搜索工具或数据库',f.tools)}</div><div class="tools-grid">${tools.map(t => `<button class="tool-card ${CS.ui.activeTool === t.id ? 'selected' : ''}" data-action="open-tool" data-id="${t.id}">${tile(t.icon,t.local ? '' : 'plain')}<h3>${e(t.name)}</h3><p>${e(t.description)}</p><div class="tool-bottom"><span>${t.local ? '浏览器内运行' : '打开官方站点'}</span>${i(t.local ? 'arrow' : 'external','',13)}</div></button>`).join('')}</div>
      ${CS.ui.activeTool === 'sequence' ? V.sequenceTool() : `<section class="panel panel-pad"><div class="row-between"><h3>CSV / TSV 表格预览</h3>${pill('本地')}</div><p class="small muted mt-8">选择文件后，可查看前 100 行。不会上传文件，也不会运行统计推断。</p><div class="mt-20">${btn('preview-csv-import','选择表格文件','upload','primary')}${btn('go-data','打开数据集','database','flat')}</div></section>`}</section>`;
  };
  V.sequenceTool = () => {
    const result = CS.ui.sequenceResult; const total = result?.reduce((n,r) => n+r.length,0) || 0;
    const gcCount = result?.reduce((n,r) => n+r.counts.G+r.counts.C,0) || 0; const acgt = result?.reduce((n,r) => n+r.counts.A+r.counts.G+r.counts.C+r.counts.T,0) || 0;
    return `<section class="panel"><div class="panel-head"><div><h3>序列基础统计</h3><span class="tiny muted">真实本地计算 · DNA / FASTA · 最多 1 MB 文本</span></div>${pill('无需模型','green')}</div><div class="panel-pad tool-workspace"><div><div class="row-between mb-20"><label for="sequence-input">序列输入</label><button class="text-button" data-action="load-sequence-example">加载人工示例</button></div><textarea id="sequence-input" class="tool-editor" aria-label="DNA 序列输入" maxlength="1000000" spellcheck="false">${e(CS.ui.sequence)}</textarea><div class="row-between mt-20"><span class="tiny faint">仅计算长度与碱基组成，不预测生物功能。</span>${btn('compute-sequence','开始计算','play','primary')}</div></div><div><div class="row-between"><h3>计算结果</h3>${result ? btn('export-sequence','导出 JSON','download','small-btn flat') : ''}</div>${result ? `<div class="sequence-summary"><div><strong>${result.length}</strong><span>序列条数</span></div><div><strong>${total.toLocaleString()}</strong><span>总长度 / bp</span></div><div><strong>${acgt ? (gcCount/acgt*100).toFixed(1)+'%' : '—'}</strong><span>GC / ACGT</span></div></div>${renderTable(['序列','长度','GC (%)','N / 模糊碱基'],result.map(r => `<tr><td title="${e(r.name)}">${e(r.name.length > 24 ? r.name.slice(0,24)+'…' : r.name)}</td><td>${r.length}</td><td>${r.gc === null ? '—' : r.gc}</td><td>${r.counts.N} / ${r.ambiguous}</td></tr>`).join(''))}<p class="tiny muted mt-20">GC 分母仅包括 A/C/G/T；N 与其他 IUPAC 模糊碱基单独统计。没有确定碱基时不计算 GC 比例。</p>` : empty('chart','结果将在这里显示','点击“开始计算”，查看这份序列的基本组成。')}</div></div></section>`;
  };

  V.tasks = () => `<section class="page">${header('TASK QUEUE','研究任务，一目了然','任务不会因为切换页面而丢失。本地演示刷新后暂停；接口任务由服务端管理。',btn('go-workflows','创建任务','plus','primary'))}<div class="panel">${CS.state.runs.length ? CS.state.runs.slice().reverse().map(run => `<div class="task-row">${tile(run.status === 'complete' ? 'checkcircle' : 'workflow',run.status === 'complete' ? 'green' : '')}<div class="grow"><button class="text-button" data-action="open-run" data-id="${e(run.id)}"><h3>${e(run.title)}</h3></button><p>${e(CS.state.projects.find(p => p.id === run.projectId)?.name || '未指定')} · ${CS.relative(run.createdAt)} · 演示</p></div><div class="task-progress"><span style="width:${run.progress}%"></span></div>${status(run.status)}<div class="row gap-6">${btn('open-run','查看任务','arrow','small-btn flat',`data-id="${e(run.id)}"`)}</div></div>`).join('') : `<div>${empty('queue','还没有任务在这里等候','从一个研究问题或预设工作流开始。')}<div class="center" style="padding-bottom:35px">${btn('demo-start','体验示例任务','play','primary')}</div></div>`}</div></section>`;

  V.settings = () => {
    const s = CS.state.settings;
    const toggle = (id, label, sub) => `<div class="setting-row"><div><h3>${e(label)}</h3><p>${e(sub)}</p></div><button type="button" role="switch" aria-checked="${!!s[id]}" aria-label="${e(label)}" class="switch" data-action="setting-toggle" data-id="${id}"></button></div>`;
    const tab = CS.ui.settingsTab;
    const nav = [['general','settings','通用'],['appearance','sun','外观与交互'],['usage','chart','Token 用量'],['privacy','shield','数据与隐私'],['agent','bolt','模型配置'],['tools','grid','Agent 工具'],['skills','book','Agent 技能'],['mcp','network','MCP 服务'],['keys','lock','第三方 API Key'],['sysprompt','code','系统提示词'],['context','layers','上下文压缩']];
    const edit = CS.ui.edit;
    const editProvider = edit?.type === 'provider' ? (CS.ui.providers.find(x => x.id === edit.id) || null) : null;
    const editModel = edit?.type === 'model' ? (CS.ui.models.find(x => x.id === edit.id) || null) : null;
    const providerRows = CS.ui.providers.length ? CS.ui.providers.map(p => `<div class="setting-row no-divider compact"><div><h3>${e(p.name)}</h3><p>${e(p.baseUrl)} · 密钥：${p.keyHint ? e(p.keyHint) : '未配置'}</p></div><span class="row gap-6">${iconBtn('test-provider','bolt','测试连接',`data-id="${e(p.id)}"`)}${iconBtn('edit-provider','edit','编辑服务商',`data-id="${e(p.id)}"`)}${iconBtn('delete-provider','trash','删除服务商',`data-id="${e(p.id)}"`)}</span></div>`).join('') : `<div class="setting-row"><div><h3>尚未添加服务商</h3><p>服务商保存接口地址与密钥，可挂多个模型。</p></div>${iconBtn('add-provider','plus','添加服务商')}</div>`;
    const modelMeta = m => {
      const bits = [];
      if (m.priceInUsdPerM != null) bits.push(`输入 $${m.priceInUsdPerM}/M`); else if (m.catalogMatched) bits.push('输入价未公布');
      if (m.priceOutUsdPerM != null) bits.push(`输出 $${m.priceOutUsdPerM}/M`); else if (m.catalogMatched) bits.push('输出价未公布');
      if (m.contextWindow) bits.push(`上下文 ${CS.usageNum(m.contextWindow)}`);
      if (m.maxOutputTokens) bits.push(`最大输出 ${CS.usageNum(m.maxOutputTokens)}`);
      return bits.length ? bits.join(' · ') + (m.catalogMatched ? '' : ' · 上下文按默认') : 'LiteLLM 价格库未收录此模型';
    };
    const modelGroups = CS.ui.models.length ? CS.ui.providers.filter(p => CS.ui.models.some(m => m.providerId === p.id)).map(p => `<div>${CS.ui.models.filter(m => m.providerId === p.id).map(m => `<div class="setting-row compact"><div><h3>${e(m.model)}${m.isDefault ? ' <span class="tiny muted">默认</span>' : ''}</h3><p>${e(m.providerName || p.name)}</p><p class="tiny muted">${modelMeta(m)}</p></div><span class="row gap-6">${m.isDefault ? '' : iconBtn('pick-model','check','设为默认',`data-id="${e(m.id)}"`)}${iconBtn('edit-model','edit','编辑模型',`data-id="${e(m.id)}"`)}${iconBtn('delete-model','trash','删除模型',`data-id="${e(m.id)}"`)}${iconBtn('add-model','plus','在此服务商下添加模型',`data-id="${e(p.id)}"`)}</span></div>`).join('')}</div>`).join('') : `<div class="setting-row"><div><h3>尚未添加模型</h3><p>在服务商下添加模型后，可在此管理。</p></div></div>`;
    const ddProvider = CS.ui.providers.find(x => x.id === (CS.ui.draftProviderId || editModel?.providerId)) || CS.ui.providers[0] || null;
    const ddPickItems = CS.ui.providerModels?.list || [];
    const sections = {
      tools: (() => {
        // Agent 工具设置: 列表懒加载; 未保存的修改存 toolDraft, 重渲染不丢;
        // 按 origin 归组(内置 / 各 MCP 服务器), 组间两栏排布, 组内保持原顺序
        const list = CS.ui.toolDraft || CS.ui.agentTools;
        if (!list) return `<div class="panel settings-section"><h2>Agent 工具</h2><p class="small muted mb-20">正在加载工具列表…</p></div>`;
        if (!list.length) return `<div class="panel settings-section"><h2>Agent 工具</h2><p class="small muted mb-20">当前环境没有可配置的内置工具。</p></div>`;
        // origin 分组: builtin_basic(基础)/builtin(高级) / sciverse / arxiv / MCP 服务器; 内置固定顺序, MCP 按配置顺序
        const GROUP_LABELS = { builtin_basic: '内置工具 · 基础', builtin: '内置工具 · 高级', sciverse: '内置工具 · Sciverse', arxiv: '内置工具 · arXiv' };
        const GROUP_ORDER = { builtin_basic: 0, builtin: 1, sciverse: 2, arxiv: 3 };
        const groups = [];
        for (const t of list) {
          const key = CS.toolGroupKey(t);
          let g = groups.find(x => x.origin === key);
          if (!g) groups.push(g = { origin: key, label: GROUP_LABELS[key] || `MCP · ${key}`, rank: GROUP_ORDER[key] ?? 4, tools: [] });
          g.tools.push(t);
        }
        groups.sort((a, b) => a.rank - b.rank);  // 同 rank 时保持插入顺序(稳定排序)
        // 未配置 Sciverse API Key 时, Sciverse 组开关与行开关锁定(服务端也强制关闭并隔离 payload)
        const sciLocked = Array.isArray(CS.ui.tokens) && !CS.ui.tokens.some(t => t.id === 'sciverse' && t.configured);
        const row = t => {
          const orig = (CS.ui.agentTools || []).find(x => x.id === t.id);
          const dirty = !orig || orig.name !== t.name || orig.description !== t.description || schemaDirty(orig.schema, t.schema) || !!orig.enabled !== !!t.enabled;
          const custom = (t.modified || dirty) ? pill('自定义') : '';
          return `<div class="tool-setting-row" data-idx="${e(t.id)}"><div class="tool-setting-main"><div class="tool-field"><span class="tool-field-label">名称</span><input class="tool-name-input" data-tool-id="${e(t.id)}" data-field="name" value="${e(t.name)}" maxlength="64" spellcheck="false"></div><div class="tool-field"><span class="tool-field-label">描述</span><input class="tool-desc-input" data-tool-id="${e(t.id)}" data-field="description" value="${e(t.description)}" maxlength="2000" spellcheck="false"></div><div class="tool-field tool-field-top"><span class="tool-field-label">参数</span><div class="schema-editor"><pre class="schema-highlight" aria-hidden="true">${V.hlJSON(V.prettyJSON(t.schema))}\n</pre><textarea class="tool-schema-input mono" data-tool-id="${e(t.id)}" data-field="schema" rows="6" spellcheck="false">${e(V.prettyJSON(t.schema))}</textarea></div></div></div><div class="tool-setting-side">${custom}<button type="button" role="switch" aria-checked="${!!t.enabled}" class="switch" data-action="tool-toggle" data-id="${e(t.id)}" aria-label="启用 ${e(t.id)}" ${sciLocked && t.origin === 'sciverse' ? 'disabled title="需先在第三方 API Key 中配置 Sciverse API"' : ''}></button></div></div>`;
        };
        const groupBlocks = groups.map(g => {
          // 语义反转: 记录被展开的组, 缺省(未展开过)一律折叠; 偏好落 settings 随 CS.save 持久化
          const collapsed = !((CS.state.settings || {}).toolGroupsOpen || {})[g.origin];
          const allOn = g.tools.every(t => !!t.enabled);
          return `<div class="tool-group"><div class="tool-group-header"><button type="button" class="tool-group-toggle" data-action="tool-group-toggle" data-id="${e(g.origin)}" aria-expanded="${!collapsed}" aria-label="展开或折叠 ${e(g.label)}"><span class="tool-group-title">${e(g.label)}</span><span class="row gap-6"><span class="tiny muted">${g.tools.length} 个工具</span>${g.origin === 'sciverse' && sciLocked ? pill('未配置 API Key') : ''}${i('down','tool-group-chevron',15)}</span></button><button type="button" role="switch" aria-checked="${allOn}" class="switch tool-group-switch" data-action="tool-group-switch" data-id="${e(g.origin)}" aria-label="整组启用或禁用 ${e(g.label)}" ${g.origin === 'sciverse' && sciLocked ? 'disabled title="需先在第三方 API Key 中配置 Sciverse API"' : 'title="整组启用/禁用"'}></button></div><div class="tool-group-rows ${collapsed ? 'collapsed' : ''}">${g.tools.map(row).join('')}</div></div>`;
        }).join('');
        return `<div class="panel settings-section"><div class="row-between"><h2>Agent 工具</h2>${pill('服务端存储')}</div><p class="small muted mb-20">按来源分组展示 Agent 会话可用的工具(基础/高级/Sciverse/arXiv 与各 MCP 服务器, 点击组标题可折叠): 同一行内两列卡片等高; 启用开关、名称、描述与参数 schema 随下一次请求生效; 禁用的工具不再发给模型, 也不再占用上下文。参数 schema 需为合法 JSON 对象。Sciverse 分组需先在第三方 API Key 中配置密钥, 未配置时整组保持关闭。</p><div class="tool-groups">${groupBlocks}</div><div class="settings-actions row wrap">${btn('save-tools','保存','check','primary')}${btn('reset-tools','恢复默认','refresh','flat')}</div></div>`;
      })(),
      skills: (() => {
        // Agent 技能设置: 与工具设定同构, 未保存的修改存 skillDraft, 重渲染不丢
        const list = CS.ui.skillDraft || CS.ui.agentSkills;
        if (!list) return `<div class="panel settings-section"><h2>Agent 技能</h2><p class="small muted mb-20">正在加载技能列表…</p></div>`;
        if (!list.length) return `<div class="panel settings-section"><h2>Agent 技能</h2><p class="small muted mb-20">当前环境没有可配置的技能。</p></div>`;
        const rows = list.map(s => {
          const orig = (CS.ui.agentSkills || []).find(x => x.id === s.id);
          const dirty = !orig || orig.name !== s.name || orig.description !== s.description || !!orig.enabled !== !!s.enabled;
          const custom = (s.modified || dirty) ? pill('自定义') : '';
          const builtin = s.builtin ? pill('内置', 'green') : '';
          return `<div class="tool-setting-row" data-idx="${e(s.id)}"><div class="tool-setting-main"><div class="tool-field"><span class="tool-field-label">名称</span><input class="skill-name-input" data-skill-id="${e(s.id)}" data-field="name" value="${e(s.name)}" maxlength="64" spellcheck="false"></div><div class="tool-field"><span class="tool-field-label">描述</span><input class="skill-desc-input" data-skill-id="${e(s.id)}" data-field="description" value="${e(s.description)}" maxlength="2000" spellcheck="false"></div></div><div class="tool-setting-side">${custom}${builtin}<button type="button" role="switch" aria-checked="${!!s.enabled}" class="switch" data-action="skill-toggle" data-id="${e(s.id)}" aria-label="启用 ${e(s.id)}"></button></div></div>`;
        }).join('');
        return `<div class="panel settings-section"><div class="row-between"><h2>Agent 技能</h2>${pill('服务端存储')}</div><p class="small muted mb-20">设置 Agent 会话可用的技能: 启用开关、名称与描述随下一次会话生效; 技能清单作为系统提示的一部分发给模型, 禁用的技能不占用上下文。技能正文存放在服务端 skills 目录。</p>${rows}<div class="settings-actions row wrap">${btn('save-skills','保存','check','primary')}${btn('reset-skills','恢复默认','refresh','flat')}</div></div>`;
      })(),
      mcp: (() => {
        // MCP 服务设置: 草稿存 mcpDraft, 每行 key 稳定 (已有行用 id, 新增行用临时 key)
        const list = CS.ui.mcpDraft || CS.ui.mcpServers;
        if (!list) return `<div class="panel settings-section"><h2>MCP 服务</h2><p class="small muted mb-20">正在加载 MCP 配置…</p></div>`;
        const rows = list.map(s => {
          const orig = (CS.ui.mcpServers || []).find(x => x.id === s.id);
          const dirty = !orig || orig.name !== s.name || orig.url !== s.url || !!orig.enabled !== !!s.enabled;
          const custom = (s.modified || dirty || !s.id) ? pill('自定义') : '';
          const builtin = s.builtin ? pill('内置', 'green') : '';
          const locked = !!s.locked;
          const lockPill = locked ? pill('未配置 API Key') : '';
          const swDisabled = locked ? 'disabled title="需先在第三方 API Key 中配置 Anysearch API"' : '';
          return `<div class="tool-setting-row" data-idx="${e(s.key)}"><div class="tool-setting-main"><div class="tool-field"><span class="tool-field-label">名称</span><div class="row gap-6"><input class="mcp-name-input" data-mcp-id="${e(s.key)}" data-field="name" value="${e(s.name)}" maxlength="64" spellcheck="false">${lockPill}</div></div><div class="tool-field"><span class="tool-field-label">地址</span><input class="mcp-url-input" data-mcp-id="${e(s.key)}" data-field="url" value="${e(s.url)}" maxlength="500" spellcheck="false" ${locked ? 'readonly title="配置 Anysearch API 后可用"' : ''}></div></div><div class="tool-setting-side">${custom}${builtin}<div class="row gap-6"><button type="button" class="icon-btn" data-action="mcp-remove" data-id="${e(s.key)}" aria-label="移除 ${e(s.name) || '新服务器'}" title="移除">${i('trash')}</button><button type="button" role="switch" aria-checked="${!!s.enabled}" class="switch" data-action="mcp-toggle" data-id="${e(s.key)}" aria-label="启用 ${e(s.name) || '新服务器'}" ${swDisabled}></button></div></div></div>`;
        }).join('');
        return `<div class="panel settings-section"><div class="row-between"><h2>MCP 服务</h2>${pill('服务端存储')}</div><p class="small muted mb-20">配置 Agent 会话可用的 MCP 服务器: 保存后服务端连接各服务器拉取工具清单, 启用的服务器工具并入“Agent 工具”并占用上下文; 禁用或移除的服务器不参与会话。内置 medical-apis 提供基因、疾病、药物等医学数据查询; 内置 anysearch 的认证头使用 ANYSEARCH_API_KEY 模板, 未在第三方 API Key 中配置密钥时整服保持关闭。</p>${rows}<div class="settings-actions row wrap">${btn('add-mcp','新增服务器','plus','primary')}${btn('save-mcp','保存','check','primary')}${btn('reset-mcp','恢复默认','refresh','flat')}</div></div>`;
      })(),
      keys: (() => {
        // 第三方 API Key 设置: 懒加载; 密钥不回显, 仅保存/清除; 保存后同步 Sciverse 工具与 anysearch MCP 的启用状态
        if (!CS.ui.tokens) return `<div class="panel settings-section"><h2>第三方 API Key</h2><p class="small muted mb-20">正在加载 Token 配置…</p></div>`;
        const rows = CS.ui.tokens.map(t => {
          const draft = (CS.ui.tokensDraft || {})[t.id] ?? '';
          const status = t.configured ? pill('已配置', 'green') : pill('未配置');
          const placeholder = t.saved ? '留空保持不变' : t.fromEnv ? '来自环境变量，输入后覆盖' : '输入 API Key…';
          return `<div class="tool-setting-row" data-idx="token-${e(t.id)}"><div class="tool-setting-main"><div class="tool-field"><span class="tool-field-label">服务</span><div class="row gap-6"><span class="small">${e(t.label)}</span>${status}${t.fromEnv ? '<span class="tiny muted">来自环境变量</span>' : ''}${t.keyHint ? `<span class="tiny muted mono">密钥：${e(t.keyHint)}</span>` : ''}</div></div><div class="tool-field"><span class="tool-field-label">API Key</span><input id="token-${e(t.id)}" class="token-input" type="password" value="${e(draft)}" placeholder="${placeholder}" spellcheck="false" autocomplete="off"></div>${t.saved ? `<span class="tiny muted">已保存的密钥仅显示掩码，输入后保存可覆盖。</span>` : ''}</div><div class="tool-setting-side">${t.saved ? `<button type="button" class="icon-btn" data-action="token-clear" data-id="${e(t.id)}" aria-label="清除 ${e(t.label)}" title="清除已保存密钥">${i('trash')}</button>` : ''}</div></div>`;
        }).join('');
        const missingHints = (CS.ui.tokens || []).filter(t => !t.configured).map(t => `<p class="small muted">${e(t.label)} 未配置: ${t.id === 'sciverse' ? 'Sciverse 工具' : t.id === 'anysearch' ? 'anysearch MCP 服务' : '相关功能'}保持关闭, 配置并保存后自动启用。</p>`).join('');
        return `<div class="panel settings-section"><div class="row-between"><h2>第三方 API Key</h2>${pill('服务端存储')}</div><p class="small muted mb-20">配置第三方服务的访问密钥: Sciverse 工具与 anysearch MCP 服务依赖对应密钥, 未配置时保持关闭, 配置后自动启用; 也可在各自设置页单独控制。页面仅显示掩码, 不回传完整密钥。</p>${rows}${missingHints}<div class="settings-actions row wrap">${btn('save-tokens','保存','check','primary')}</div></div>`;
      })(),
      usage: (() => {
        // Token 用量卡: 服务端聚合 SigmaFlow 自身会话记录, 统计卡 + 每日/每周/累计活动图 + 两张明细表
        const u = CS.ui.usage;
        if (u?.error) return `<div class="panel settings-section"><div class="row-between"><h2>Token 用量</h2>${pill('本地统计')}</div><p class="small muted mb-20">统计 SigmaFlow 对话的 token 消耗（服务端聚合本机会话记录）。</p>${H.notice('无法聚合用量数据：' + u.error)}</div>`;
        if (!u?.totalTokens && !u?.days) return `<div class="panel settings-section"><h2>Token 用量</h2><p class="small muted mb-20">${u?.loading !== false ? '正在加载用量数据…' : '暂无用量数据。'}</p></div>`;
        const peakTitle = u.peakDay?.date ? `峰值日 ${u.peakDay.date}` : '';
        const stats = [[CS.usageNum(u.totalTokens), '累计 Token 数', `输入 ${CS.usageNum(u.totalInputTokens)} · 输出 ${CS.usageNum(u.totalOutputTokens)}`], [CS.usageNum(u.peakDay?.totalTokens || 0), '峰值 Token 数', peakTitle], [usageDur(u.longestSessionMs), '最长聊天时长', `${CS.num(u.totalSessions)} 个会话`], [`${u.currentStreakDays || 0} 天`, '当前连续天数', `数据截至 ${u.generatedAt ? e(u.generatedAt.slice(0, 10)) : '—'}`], [`${u.longestStreakDays || 0} 天`, '最长连续天数', `共 ${(u.days || []).length} 天有用量`], [CS.fmtCost(u.totalCostUsd), '总成本（估算）', '基于 LiteLLM 价格库 · 未收录模型不计成本']];
        const gran = CS.ui.usageGran || 'daily';
        const models = [...(u.models || [])].sort((x, y2) => (y2.totalTokens || 0) - (x.totalTokens || 0));
        const sessions = [...(u.sessions || [])].sort((x, y2) => (y2.endMs || 0) - (x.endMs || 0)).slice(0, 30);
        return `<div class="panel settings-section"><div class="row-between"><h2>Token 用量</h2><span class="row gap-6">${pill('本地统计')}${iconBtn('reload-usage','refresh','重新拉取')}</span></div><p class="small muted mb-20">统计 SigmaFlow 对话的 token 消耗与聊天时长，由服务端实时聚合本机会话记录；模型明细与模型名从新会话开始记录。</p><div class="usage-stats">${stats.map(([v, l, t]) => `<div class="usage-stat" ${t ? `title="${e(t)}"` : ''}><div class="usage-stat-value">${v}</div><div class="usage-stat-label">${e(l)}</div></div>`).join('')}</div><div class="panel-head" style="margin-top:20px"><h3 style="margin:0">Token 活动</h3><div class="row gap-6">${['daily','weekly','total'].map(g => `<button type="button" class="tab-label ${gran === g ? 'usage-gran-active' : ''}" data-action="usage-gran" data-id="${g}">${{ daily: '每日', weekly: '每周', total: '累计' }[g]}</button>`).join('')}</div></div>${usageChart(u.days || [], gran)}<div class="panel-head" style="margin-top:20px"><h3 style="margin:0">模型明细</h3><span class="tiny muted">${models.length} 个模型 · 成本按 LiteLLM 价格库估算，未收录模型不计</span></div>${models.length ? `<div class="table-wrap"><table><thead><tr><th>模型</th><th class="num">输入</th><th class="num">输出</th><th class="num">合计 ↓</th><th class="num">成本</th><th class="num">会话</th></tr></thead><tbody>${models.map(m => `<tr><td title="${e(m.model)}">${e(m.model)}</td><td class="num">${CS.num(m.inputTokens)}</td><td class="num">${CS.num(m.outputTokens)}</td><td class="num"><strong>${CS.num(m.totalTokens)}</strong></td><td class="num">${CS.fmtCost(m.costUsd)}</td><td class="num">${CS.num(m.sessions)}</td></tr>`).join('')}</tbody></table></div>` : H.notice('暂无模型用量记录。')}
        <div class="panel-head" style="margin-top:20px"><h3 style="margin:0">最近会话</h3><span class="tiny muted">最近 30 个</span></div>${sessions.length ? `<div class="table-wrap"><table><thead><tr><th>会话</th><th>开始时间</th><th>时长</th><th class="num">合计</th><th>模型</th></tr></thead><tbody>${sessions.map(sm2 => `<tr><td title="${e(sm2.sessionId || '')}">${e(sm2.title || sm2.sessionId || '—').slice(0, 22)}${(sm2.title || '').length > 22 ? '…' : ''}</td><td>${e(sm2.startMs ? new Date(sm2.startMs).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')}</td><td>${usageDur(sm2.durationMs)}</td><td class="num"><strong>${CS.num(sm2.totalTokens)}</strong></td><td title="${e((sm2.models || []).join(', '))}">${e((sm2.models || []).slice(0, 2).join(', ')) || '—'}${(sm2.models || []).length > 2 ? ' …' : ''}</td></tr>`).join('')}</tbody></table></div>` : H.notice('暂无会话记录。')}</div>`;
      })(),
      sysprompt: (() => {
        // 系统提示词设置: draft 含 prompt/enabled; 内置默认供参考, 内联折叠展示
        const sp = CS.ui.syspromptDraft || CS.ui.systemPrompt;
        if (!sp) return `<div class="panel settings-section"><h2>系统提示词</h2><p class="small muted mb-20">正在加载系统提示词配置…</p></div>`;
        const on = !!sp.enabled;
        const builtin = sp.builtin || CS.ui.systemPrompt?.builtin || '';
        const builtinTokens = sp.builtinTokens || CS.ui.systemPrompt?.builtinTokens;
        const chars = (sp.prompt || '').length;
        return `<div class="panel settings-section"><div class="row-between"><h2>系统提示词</h2>${pill('服务端存储')}</div><p class="small muted mb-20">自定义提示词会替换 Agent 内置默认(会改变内置任务/团队等指令, 请谨慎); 技能清单自动附加在末尾, 工具调用说明由 Agent 自动追加。子代理仍使用内置提示词。</p><div class="tool-setting-row"><div class="tool-setting-main"><div class="tool-field"><span class="tool-field-label">开关</span><div class="row gap-6"><button type="button" role="switch" aria-checked="${on}" class="switch" data-action="sysprompt-toggle" aria-label="启用自定义系统提示词"></button><span class="small muted">${on ? '已启用自定义' : '使用内置默认'}</span></div></div><div class="tool-field tool-field-top"><span class="tool-field-label">内容</span><textarea id="sysprompt-textarea" class="sysprompt-textarea mono" rows="12" maxlength="32000" spellcheck="false" placeholder="留空并用内置默认; 触发后这里的内容将作为 Agent 的系统提示词…">${e(sp.prompt || '')}</textarea></div><span class="tiny muted">自定义 ${chars} 字符${builtinTokens ? ` · 内置默认约 ${builtinTokens} tokens` : ''} · 保存后上下文圆环自动重新测量</span></div></div>${builtin ? `<details class="sysprompt-builtin"><summary class="small muted">查看内置默认系统提示词</summary><pre class="sysprompt-builtin-pre mono">${e(builtin)}</pre></details>` : ''}<div class="settings-actions row wrap">${btn('save-sysprompt','保存','check','primary')}${btn('reset-sysprompt','恢复默认','refresh','flat')}</div></div>`;
      })(),
      context: (() => {
        // 上下文压缩设置: draft 含全部压缩参数; 数字输入不触发重渲染避免输入中断
        const cfg = CS.ui.compactionDraft || CS.ui.agentCompaction;
        if (!cfg) return `<div class="panel settings-section"><h2>上下文压缩</h2><p class="small muted mb-20">正在加载压缩参数配置…</p></div>`;
        const on = cfg.enabled !== false;
        const num = (id, label, sub, field, min, max, step) => `<div class="setting-row compact"><div><h3>${e(label)}</h3><p>${e(sub)}</p></div><span class="row gap-6"><input type="number" id="compact-${id}" class="compact-num" min="${min}" max="${max}" step="${step}" value="${e(String(cfg[field] != null ? cfg[field] : ''))}" data-field="${field}" aria-label="${e(label)}"></span></div>`;
        return `<section class="panel settings-section"><div class="row-between"><h2>上下文压缩</h2>${pill('服务端存储')}</div><p class="small muted mb-20">上下文即将占满时, Agent 自动把较早的对话压缩成结构化摘要并保留最近消息原文(pi compaction 思路)。保存后即时对下一次会话生效; 自动压缩关闭时, 手动 /compact 命令仍然可用。</p><div class="setting-row compact"><div><h3>自动压缩</h3><p>仅在上下文占用超过触发阈值时执行摘要压缩。</p></div><button type="button" role="switch" aria-checked="${on}" class="switch" data-action="compaction-toggle" aria-label="自动压缩"></button></div>`
          + num('ratio', '触发阈值', '上下文占用达到该比例时压缩, 例如 0.85 表示 85%。', 'ratio', 0.3, 0.98, 0.01)
          + num('keep', '保留窗口', '最近这一段 token 数的原文保持原样不参与摘要, 以保住近期工作细节(单位 tokens)。', 'keepRecentTokens', 2000, 200000, 1000)
          + num('mindrops', '最少压缩消息数', '被摘要的消息少于此数时跳过本次压缩, 避免频繁摘要小会话(按条计)。', 'minDrops', 2, 50, 1)
          + num('summary', '摘要长度上限', '单次摘要生成允许的最大 token 数。', 'summaryTokens', 512, 16384, 256)
          + num('result', '单条工具结果截断', '喂给摘要模型的工具结果每条最多保留的字符数。', 'resultChars', 200, 20000, 100)
          + num('arg', '单个工具参数截断', '摘要中工具调用参数最多保留的字符数。', 'argChars', 40, 4000, 20)
          + `<div class="settings-actions row wrap">${btn('save-compaction', '保存', 'check', 'primary')}${btn('reset-compaction', '恢复默认', 'refresh', 'flat')}</div></section>`;
      })(),
      general: (() => {
        // 通用卡片: 与具体功能无关的整体偏好; 提示音 / 键位 / 滚动 / 缩放
        const raw = Number(CS.state.settings.soundVolume);
        const pct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
        const scaleRaw = Number(CS.state.settings.uiScale);
        const scale = Number.isFinite(scaleRaw) ? Math.min(125, Math.max(85, Math.round(scaleRaw))) : 100;
        return `<div class="panel settings-section"><h2>通用</h2><p class="small muted mb-20">影响整体体验的通用偏好, 只保存在本机浏览器。</p>${toggle('notifySound','消息回复提示音','模型回复完成或被停止时播放一声短提示音。')}<div class="setting-row"><div><h3>提示音音量</h3><p>拖动后点「试听」确认效果；拖到 0 等效静音。</p></div><div class="row gap-6 sound-volume-row"><input type="range" class="sound-volume-input" min="0" max="100" step="5" value="${pct}" aria-label="提示音音量"><span class="small muted mono sound-volume-label">${pct}%</span>${btn('sound-preview','试听','play','small-btn flat')}</div></div>${toggle('enterSend','按 Enter 直接发送','开启时 Enter 发送、Shift+Enter 换行；关闭后 Enter 换行，需按 Ctrl/Cmd+Enter 发送。')}${toggle('autoScroll','回复时自动滚动','流式输出与回复完成时自动滚到最新内容；关闭后不再自动拽动滚动位置，可点「回到底部」一键跳转。')}<div class="setting-row"><div><h3>界面缩放</h3><p>整体放大或缩小界面（85%–125%），拖动即时生效。</p></div><div class="row gap-6 ui-scale-row"><input type="range" class="ui-scale-input" min="85" max="125" step="5" value="${scale}" aria-label="界面缩放"><span class="small muted mono ui-scale-label">${scale}%</span></div></div><div class="setting-row"><div><h3>终端主题</h3><p>终端工具消息展开内容采用的颜色主题，默认 Monokai Dark。</p></div><select class="terminal-theme-select" aria-label="终端主题">${TE_THEMES.map(([v, label]) => `<option value="${v}" ${(CS.state.settings.terminalTheme || 'monokai') === v ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div>`;
      })(),
      appearance: `<div class="panel settings-section"><h2>外观与交互</h2>${toggle('contrast','增强文字与边界对比','保持浅灰色主题，提高说明文字与控件边界的可读性。')}${toggle('reducedMotion','减少动态效果','关闭过渡与旋转动画，不影响任务状态更新。')}<div class="setting-row"><div><h3>消息轨迹配色</h3><p>标题栏 usage 行上方热力条的配色方案；马卡龙为柔和粉彩色系。</p></div><select class="track-palette-select" aria-label="消息轨迹配色"><option value="macaron" ${(CS.state.settings.trackPalette || 'macaron') === 'macaron' ? 'selected' : ''}>马卡龙</option><option value="classic" ${CS.state.settings.trackPalette === 'classic' ? 'selected' : ''}>经典</option><option value="mono" ${CS.state.settings.trackPalette === 'mono' ? 'selected' : ''}>素雅</option></select></div>${toggle('inspector','显示任务详情侧栏','在宽屏的 Agent 对话中显示输入上下文与执行边界。')}</div>`,
      privacy: `<div class="panel settings-section"><h2>数据与隐私</h2>${toggle('persist','在本机保存工作空间','保存项目、文件名、对话与任务记录；不保存原始文件。共享电脑建议关闭。关闭后删除已有本地保存，当前会话仍保留。')}<div class="setting-row"><div><h3>单次回复轮次预算</h3><p>模型在一次回复内可连续调用工具的最大轮数，默认 100；分析型任务(如多步生信流程)建议保持较高值，耗尽时会保留工具轨迹并提示『继续』。</p></div><div class="row gap-6"><input id="turn-budget-input" class="setting-input-inline" inputmode="numeric" placeholder="100" value="${CS.ui.turnBudget ?? ''}" style="width:96px;text-align:right"><span class="small muted">轮</span>${btn('save-turn-budget','保存','check','small-btn flat')}<button type="button" class="text-button tiny" data-action="reset-turn-budget">恢复默认</button></div></div><div class="setting-row"><div><h3>工具结果入库上限</h3><p>单条工具输出 / 思考 / 回复块随会话存档的字数上限，默认 30000；影响 Trace 展开详情的完整度。</p></div><div class="row gap-6"><input id="tool-limit-input" class="setting-input-inline" inputmode="numeric" placeholder="30000" value="${CS.ui.toolLimit ?? ''}" ${'style="width:96px;text-align:right"'}><span class="small muted">字</span>${btn('save-tool-limit','保存','check','small-btn flat')}<button type="button" class="text-button tiny" data-action="reset-tool-limit">恢复默认</button></div></div><div class="setting-row"><div><h3>导出工作空间</h3><p>导出元信息与任务记录。包含对话内容，分享前请检查隐私。</p></div>${btn('export-workspace','导出 JSON','download','flat')}</div><div class="setting-row"><div><h3>清空并恢复示例</h3><p>移除本机保存的项目、导入记录与对话，恢复初始演示。</p></div>${btn('reset-workspace','重置','trash','flat danger')}</div></div>`,
      agent: `${edit?.type === 'provider' ? `<div class="panel settings-section"><div class="row-between"><h2>${editProvider ? '编辑服务商' : '添加服务商'}</h2>${pill('编辑')}</div><p class="small muted mb-20">服务商保存接口地址与密钥，可挂多个模型。配置保存在服务端，密钥不会回传浏览器。</p><div class="field"><label for="provider-name">服务商名称</label><input id="provider-name" value="${e(editProvider?.name || '')}" placeholder="OpenRouter" spellcheck="false"><span class="hint">仅用于显示，留空则取地址主机名。</span></div><div class="field"><label for="provider-base-url">接口地址（Base URL）</label><input id="provider-base-url" value="${e(editProvider?.baseUrl || '')}" placeholder="https://openrouter.ai/api/v1" spellcheck="false"></div><div class="field"><label for="provider-api-key">API 密钥</label><input id="provider-api-key" type="password" value="" placeholder="${editProvider?.keyHint ? `当前 ${e(editProvider.keyHint)}，留空保持不变` : '保存在服务端，浏览器不保存'}" spellcheck="false" autocomplete="off"><span class="hint">仅保存在服务端；接口只返回掩码，不回传完整密钥。</span></div><div class="row wrap">${btn('save-provider','保存','check','primary')}${btn('cancel-edit','取消','','flat')}</div></div>` : edit?.type === 'model' ? `<div class="panel settings-section"><div class="row-between"><h2>${editModel ? '编辑模型' : '添加模型'}</h2>${pill('编辑')}</div><p class="small muted mb-20">选择模型所属的服务商；模型名称可手填，或从服务商拉取列表后选择。</p><div class="field"><label for="model-provider">所属服务商</label><div class="model-select dd-wrap"><button type="button" class="model-select-btn" data-action="dd-toggle" data-id="provider" aria-haspopup="listbox" aria-expanded="${CS.ui.dropdown === 'provider'}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${e(ddProvider ? ddProvider.name + ' · ' + ddProvider.baseUrl : '— 选择服务商 —')}${i('down','',13)}</button>${CS.ui.dropdown === 'provider' ? `<div class="model-menu dd-down" role="listbox">${CS.ui.providers.length ? CS.ui.providers.map(p => `<button type="button" class="model-menu-item" role="option" data-action="dd-pick-provider" data-id="${e(p.id)}"><span>${e(p.name)} · ${e(p.baseUrl)}</span>${ddProvider && p.id === ddProvider.id ? i('check','',13) : ''} </button>`).join('') : '<span class="model-menu-item">请先添加服务商</span>'}</div>` : ''}</div></div><div class="field"><label for="model-name">模型名称</label><input id="model-name" value="${e(CS.ui.draftModelName ?? editModel?.model ?? '')}" placeholder="openrouter/free" spellcheck="false"><span class="hint">${btn('fetch-provider-models','从服务商获取模型列表','refresh','flat')}</span></div><div class="field"><label for="model-ctx-window">上下文窗口（可选，默认自动）</label><input id="model-ctx-window" inputmode="numeric" value="${e(editModel?.contextWindow || '')}" placeholder="自动读取 LiteLLM 模型库" spellcheck="false"><span class="hint">用于上下文用量圆环与用量成本估算；留空时自动按 LiteLLM 模型库查询。 <span id="model-meta-hint" class="tiny muted">${CS.ui.modelMeta?.matched ? `目录键 ${e(CS.ui.modelMeta.litellmKey ?? String())}` : ''}</span></span></div>${CS.ui.providerModels?.loading ? '<p class="small muted">正在获取模型列表…</p>' : CS.ui.providerModels?.error ? `<p class="small muted">获取失败：${e(CS.ui.providerModels.error)}</p>` : (CS.ui.providerModels?.list?.length ? `<div class="field"><label for="model-pick">从列表选择</label><div class="model-select dd-wrap"><button type="button" class="model-select-btn" data-action="dd-toggle" data-id="pick" aria-haspopup="listbox" aria-expanded="${CS.ui.dropdown === 'pick'}"><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${e(CS.ui.draftModelName || '— 选择模型 —')}${i('down','',13)}</button>${CS.ui.dropdown === 'pick' ? `<div class="model-menu dd-down" role="listbox">${ddPickItems.map(x => `<button type="button" class="model-menu-item" role="option" data-action="dd-pick-model" data-id="${e(x)}"><span>${e(x)}</span>${CS.ui.draftModelName === x ? i('check','',13) : ''} </button>`).join('')}</div>` : ''}</div></div>` : '')}<div class="row wrap">${btn('save-model','保存','check','primary')}${btn('cancel-edit','取消','','flat')}</div></div>` : `<div class="panel settings-section"><div class="row-between"><h2>模型服务商</h2>${pill('服务端存储')}</div><p class="small muted mb-20">每个服务商保存接口地址与密钥，可挂多个模型。服务地址由页面自动探测。</p>${providerRows}<div class="settings-actions row wrap">${btn('add-provider','添加服务商','plus','primary')}</div></div><div class="panel settings-section"><div class="row-between"><h2>模型</h2></div><p class="small muted mb-20">模型挂在服务商下，名称可手动填写，或从服务商接口拉取后选择。</p>${modelGroups}<div class="settings-actions row wrap">${btn('add-model','添加模型','plus','primary')}${btn('test-api','测试连接','bolt','flat')}</div></div>${CS.ui.apiHealth ? `<div class="panel settings-section"><div class="row-between"><h2>连接状态</h2>${pill(CS.ui.apiHealth.split(' ')[0])}</div><p class="small muted">${e(CS.ui.apiHealth)}</p></div>` : ''}`}`
    };
    return `<section class="page fullscreen-page"><div class="settings-layout"><aside class="panel settings-nav" aria-label="设置导航">${nav.map(([id, icon, label]) => `<button type="button" class="settings-nav-item ${tab === id ? 'active' : ''}" data-action="settings-tab" data-id="${id}" ${tab === id ? 'aria-current="page"' : ''}>${i(icon,'',16)}<span>${label}</span></button>`).join('')}</aside><div class="settings-content">${sections[tab]}</div></div><div class="page-footer">SigmaFlow Science / Interface edition 1.0</div></section>`;
  };
  V.help = () => `<section class="page">${header('GUIDE','从问题，到可追溯的过程','这个工作空间怎么用，哪些是真实功能，哪些是演示。')}<div class="help-grid"><article class="panel"><h3>体验一个完整任务</h3><ol><li>首页点击“单细胞分析”，或输入研究问题。</li><li>查看 Agent 计划，点击“确认并执行”。</li><li>观察每一步的状态，尝试暂停、继续与展开日志。</li><li>完成后查看合成图表，导出 SVG 或分析记录。</li></ol><div class="mt-20">${btn('demo-start','开始示例','play','primary')}</div></article><article class="panel"><h3>快捷键</h3><div class="shortcut-list"><div><span>发送问题</span><kbd>Enter</kbd></div><div><span>在问题中换行</span><kbd>Shift + Enter</kbd></div><div><span>开始新对话</span><kbd>Alt + N</kbd></div><div><span>关闭对话框 / 菜单</span><kbd>Esc</kbd></div></div></article><article class="panel"><h3>这些功能可以真实使用</h3><p>本地文件导入和文本预览；DNA 长度与 GC 比例统计；项目增改和归档；文献收藏与笔记；本地搜索、图表交互和文件导出。</p><p class="mt-12">文件始终由你选择后才读取，且不会由演示任务自动上传。</p></article><article class="panel"><h3>这些内容是明确的演示</h3><p>Agent 对话、分析进度、单细胞数据图表、表达量与分析记录均为预设演示。当前版本没有执行真实模型、Scanpy、差异分析或实验操作。</p><p class="mt-12">生产集成说明与接口协议见源码包 README.md 和 API.md。</p></article></div><div class="mt-28">${notice('本工具不提供临床结论。科研分析必须使用经过验证的数据、方法与真实执行环境，并进行人工复核。')}</div></section>`;
})();
