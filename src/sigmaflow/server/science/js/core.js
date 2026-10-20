/* Shared state and safe local utilities. */
(() => {
  'use strict';
  const key = 'sigmaflow-science.workspace.v1';
  const clone = x => JSON.parse(JSON.stringify(x));
  CS.escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  CS.uid = (prefix = 'id') => prefix + '-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
  CS.formatBytes = bytes => { if (!bytes) return '0 B'; const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; };
  CS.today = () => new Date().toISOString().slice(0, 10);
  CS.time = value => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
CS.elapsedMs = ms => {
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's';
  const h = Math.floor(m / 60);
  return h + 'h' + String(m % 60).padStart(2, '0') + 'm' + String(s % 60).padStart(2, '0') + 's';
};
CS.elapsed = start => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(start).getTime()) / 1000));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's';
  const h = Math.floor(m / 60);
  return h + 'h' + String(m % 60).padStart(2, '0') + 'm' + String(s % 60).padStart(2, '0') + 's';
};
CS.tokRateText = m => {
  if (!m || !m.tokens) return '';
  const seconds = m.streaming ? (Date.now() - new Date(m.at).getTime()) / 1000 : (m.elapsed || 0) / 1000;
  if (seconds <= 0) return '';
  return (m.tokens / seconds).toFixed(1) + ' tok/s';
};
CS.num = tokens => Math.round(tokens || 0).toLocaleString();
// 中文数量级缩写(Token 用量统计卡): 1.2亿 / 45.6万 / 123
// Agent 工具分组键: 内置工具中高频六件套另立"基础"组, 其余内置进"高级"; MCP/Sciverse/arXiv 按各自 origin
CS.BASIC_TOOL_IDS = ['bash', 'edit', 'read', 'write', 'grep', 'ask'];
CS.toolGroupKey = t => ((t && (t.origin || 'builtin')) === 'builtin' && CS.BASIC_TOOL_IDS.includes(t && t.id)) ? 'builtin_basic' : (t && t.origin) || 'builtin';
CS.usageNum = n => {
  n = Math.round(n || 0);
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return n.toLocaleString();
};
// 上下文 token 估算(近似值): 中文≈0.6 token/字, 其他≈1 token/4.6 字符,
// 按真实 glm-5.3 usage 校准过; 服务端另有 sys/tools 的精确口径(/context-info)
CS.estimateTokens = text => {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef)) cjk++;
  }
  return Math.round(cjk * 0.6 + (text.length - cjk) / 4.6);
};
// 无 ~ 前缀的紧凑数(标题栏 usage 行等真实口径展示), 与 kfmt 同一套 M/K 阶梯
CS.knum = n => CS.kfmt(n).slice(1);
// 标题栏 usage 行: 全会话累计的输入/输出/缓存读取(计费口径, 含压缩前历史) + 上下文占比
CS.chatUsage = () => {
  const msgs = CS.currentRun()?.messages || [];
  let tin = 0, tout = 0, tcache = 0;
  msgs.forEach(m => { if (m.role === 'assistant') { tin += m.promptTokens || 0; tout += m.tokens || 0; tcache += m.cacheTokens || 0; } });
  const ctx = CS.contextUsage();
  return { tin, tout, tinCache: tcache, pct: ctx.pct, win: ctx.window };
};
// 会话元数据: 开始时间 / 总耗时 / 消息数 / 工具调用次数(含 ask 卡)
CS.chatMeta = () => {
  const run = CS.currentRun();
  const msgs = run?.messages || [];
  let start = null, end = null, tools = 0, elapsed = 0, hasElapsed = false;
  msgs.forEach(m => {
    const t = m.at ? Date.parse(m.at) : NaN;
    if (!isNaN(t)) { if (start === null || t < start) start = t; if (end === null || t > end) end = t; }
    if (m.role === 'assistant') {
      tools += (m.tools?.length || 0) + (m.asks?.length || 0);
      if (typeof m.elapsed === 'number' && m.elapsed > 0) { elapsed += m.elapsed; hasElapsed = true; }
    }
  });
  // 进行中的本轮回复: 计入实时已过时间, 让总耗时在生成期间跳动
  msgs.forEach(m => {
    if (m.role === 'assistant' && m.streaming && m.at) {
      const t = Date.parse(m.at);
      if (!isNaN(t)) { elapsed += Math.max(0, Date.now() - t); hasElapsed = true; }
    }
  });
  if (start === null) {
    const c = run?.createdAt ? Date.parse(run.createdAt) : NaN;
    if (!isNaN(c)) { start = c; end = c; }
  }
  // 旧存档没有每轮 elapsed: 回退首末时间差口径
  if (!hasElapsed && start !== null) elapsed = Math.max(0, (end || start) - start);
  return { start, end, elapsed: Math.round(elapsed), msgs: msgs.length, tools };
};
// 时长紧凑展示: 45秒 / 12分 / 1时23分 / 2天4时
CS.fmtDur = ms => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  if (s < 60) return s + '秒';
  const m = Math.floor(s / 60), sec = s % 60;
  if (m < 60) return sec ? m + '分' + sec + '秒' : m + '分';
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return h + '时' + String(mm).padStart(2, '0') + '分';
  const d = Math.floor(h / 24), hh = h % 24;
  return d + '天' + hh + '时';
};
// 日期时间紧凑展示: 10-20 14:02; 跨年时带上年份 25-12-03 14:02
CS.fmtDT = ts => {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  const base = p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  return d.getFullYear() === new Date().getFullYear() ? base : String(d.getFullYear() % 100) + '-' + base;
};
// token 数值的紧凑展示: ~850 / ~1.7K / ~67.7K / ~131K; 到 M 用 M 单位(~1M / ~1.2M), 不到的才用 K
CS.kfmt = n => {
  n = Math.round(n || 0);
  if (n < 1000) return '~' + n;
  // 999.5K 起四舍五入会进到 1000K, 一并按 M 口径展示, 避免“1000K”这种写法
  if (n >= 999500) {
    const m = n / 1e6;
    const one = Math.round(m * 10) / 10;
    return '~' + (m >= 100 ? Math.round(m) : (one % 1 ? one : one.toFixed(0))) + 'M';
  }
  const k = n / 1000;
  return '~' + (k < 100 ? Math.round(k * 10) / 10 : Math.round(k)) + 'K';
};
// 当前会话的上下文占用估算: 系统提示词 + 工具定义 + 对话消息(含草稿)
// 对话部分优先用最近一次请求的真实 promptTokens 锚定, 其后新增内容再用启发式估算
// 成本格式化: 大数取整, 小数保留有效位
CS.fmtCost = u => {
  if (!u || u <= 0) return '—';
  if (u >= 100) return '$' + Math.round(u).toLocaleString('en-US');
  if (u >= 1) return '$' + u.toFixed(2);
  if (u >= 0.01) return '$' + u.toFixed(3);
  return '$' + u.toFixed(4);
};
// 压缩契约口径: 最后一张摘要卡(含)之后 + 卡本身 的对话上下文估算。
// 在压缩前后各调用一次, 口径一致才能如实反映压缩收益
CS.contractMsgsEst = () => {
  const all = CS.currentRun()?.messages || [];
  let cardIdx = -1;
  all.forEach((m, i) => { if (String(m.content || '').startsWith('[Conversation compressed')) cardIdx = i; });
  const slice = cardIdx >= 0 ? all.slice(cardIdx) : all;
  const est = slice.reduce((sum, m) => sum + CS.estimateTokens(m.content), 0);
  return est + 9 * slice.length;
};
CS.contextUsage = () => {
  const model = CS.ui.models.find(x => x.id === CS.state.settings.modelId);
  const win = model?.contextWindow || 131072;
  const info = CS.ui.contextInfo || {};
  // 服务端未就绪时的回退值: 与实测(新会话首轮 ≈2780 prompt tokens)校准的常数
  const sysT = info.systemTokens || 183;
  const toolT = info.toolsTokens || 2570;
  // 压缩契约口径: 最后一张摘要卡(含)之后的消息才真正发给模型
  const all = CS.currentRun()?.messages || [];
  let cardIdx = -1;
  all.forEach((m, i) => { if (String(m.content || '').startsWith('[Conversation compressed')) cardIdx = i; });
  const msgs = cardIdx >= 0 ? all.slice(cardIdx) : all;
  let anchorIdx = -1, anchorP = 0;
  msgs.forEach((m, i) => { if (m.role === 'assistant' && m.promptTokens) { anchorIdx = i; anchorP = m.promptTokens; } });
  // 优先用 contextTokens(最后一轮当次 prompt = 真实窗口占用)。老的 promptTokens 是
  // 单次请求内 max_turn 多轮循环的累计值, 不能当窗口占用锚点(旧数据无 contextTokens 时回退)。
  let ctxP = 0;
  msgs.forEach((m, i) => { if (m.role === 'assistant' && m.contextTokens) { if (i >= anchorIdx) { ctxP = m.contextTokens; anchorIdx = i; } } });
  if (ctxP && anchorP && ctxP <= anchorP) { /* 旧数据: contextTokens 缺失 */ }
  const useCtx = ctxP > 0 && ctxP >= anchorP;
  // 锚点只在其含义成立时使用: 锚点应远大于固定开销(sys+tools); 荒谬值(超窗口)不采信, 回退逐条估算
  const winLimit = Math.floor(win * 0.98);
  if (useCtx) anchorP = ctxP;
  if (anchorP > winLimit) { anchorIdx = -1; }
  // 老数据识别: promptTokens 若是 max_turn 多轮循环的累计值, 会远超逐条估算的总和;
  // 超出 25 倍视为口径污染, 回退逐条估算(新数据有 contextTokens, 不走本分支)
  if (!useCtx && anchorIdx >= 0) {
    const estAll = msgs.reduce((a, m) => a + CS.estimateTokens(m.content), 0);
    if (anchorP - sysT - toolT > estAll * 25) anchorIdx = -1;
  }
  let base = 0, after = 0, count = 0;
  if (anchorIdx >= 0 && anchorP > sysT + toolT) {
    base = Math.max(0, anchorP - sysT - toolT);
    for (let j = anchorIdx + 1; j < msgs.length; j++) { after += CS.estimateTokens(msgs[j].content); count++; }
    count++;
  } else {
    anchorIdx = -1;
    msgs.forEach(m => { base += CS.estimateTokens(m.content); count++; });
  }
  const draft = (CS.ui.composer || '').trim();
  if (draft) { after += CS.estimateTokens(draft); count++; }
  const msgsT = Math.max(0, base + after + 9 * count);  // 每条消息约 9 token 模板开销(实测)
  const total = sysT + toolT + msgsT;
  // 一位小数: 工具定义是大头(~28k), 消息压缩的收益在 131k 窗口里不足 1%,
  // 整数百分比会完全吞掉这个变化, 展示小数让压缩效果可见
  const pct = Math.min(100, Math.round(total / win * 1000) / 10);
  return { sysT, toolT, msgsT, total, window: win, pct };
};
CS.tokRateTag = m => {
  const text = CS.tokRateText(m);
  if (!text) return '';
  return `<span class="tok-rate"${m.streaming ? ` data-start="${m.at}"` : ''}>${text}</span>`;
};
  // 文件预览语法着色: json/jsonl 与通用代码共用一个 tokenizer(按 kind 走分部表达),
  // 每个 token 独立转义防 XSS; 分类规则简单但覆盖 md/json/代码类文件的主要场景。
  const FS_KW = new Set(('def class import from return if elif else for while try except finally with as pass break continue in is not and or lambda none true false self yield raise assert async await del global nonlocal ' +
    'function const let var new this typeof instanceof export default extends super null undefined void of case switch do then fi until range dim sub mkdir cd ls cat echo exit local readonly declare shift ' +
    'select insert update delete join on group by order limit create table drop alter index where values set ' +
    'func type struct impl use pub fn match mod crate loop ref mut if let else static enum trait').split(" "));
  const FS_KW_RE = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|#(?!!)[^\n]*|<!--[\s\S]*?-->)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  const FS_JSON_RE = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  CS.fsHighlight = (code, lang) => {
    code = String(code == null ? '' : code);
    const E = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    if (lang === 'json' || lang === 'jsonl') {
      let out = '', last = 0, m;
      FS_JSON_RE.lastIndex = 0;
      while ((m = FS_JSON_RE.exec(code))) {
        out += E(code.slice(last, m.index));
        if (m[1]) out += `<span class="tk-k">${E(m[1])}</span>` + E(m[2] || '');
        else if (m[3]) out += `<span class="tk-s">${E(m[3])}</span>`;
        else if (m[4]) out += `<span class="tk-n">${E(m[4])}</span>`;
        else if (m[5]) out += `<span class="tk-k">${E(m[5])}</span>`;
        last = m.index + m[0].length;
      }
      return out + E(code.slice(last));
    }
    let out = '', last = 0, m;
    FS_KW_RE.lastIndex = 0;
    while ((m = FS_KW_RE.exec(code))) {
      out += E(code.slice(last, m.index));
      if (m[1]) out += `<span class="tk-c">${E(m[1])}</span>`;
      else if (m[2]) out += `<span class="tk-s">${E(m[2])}</span>`;
      else if (m[3]) out += `<span class="tk-n">${E(m[3])}</span>`;
      else if (m[4]) out += FS_KW.has(m[4].toLowerCase()) ? `<span class="tk-k">${E(m[4])}</span>` : E(m[4]);
      last = m.index + m[0].length;
    }
    return out + E(code.slice(last));
  };

CS.datetime = value => {
  const d = new Date(value);
  const date = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};
const _markdownCache = new Map();  // key: 原文, value: 消毒后 HTML; 流式重渲染时命中缓存, 避免整段会话反复解析
CS.markdown = text => {
  const _mdKey = String(text ?? '');
  if (_markdownCache.has(_mdKey)) return _markdownCache.get(_mdKey);
  // DOM 白名单消毒: 只保留安全的标签与属性, 拒绝一切事件属性与 javascript:/data: URL。
  // 相比正则方案, DOM 解析不存在实体编码(如 &#111;nerror)等绕过方式。
  const doc = new DOMParser().parseFromString(marked.parse(String(text ?? ''), { breaks: true }), 'text/html');
  const allowedTags = new Set(['A','B','I','EM','STRONG','U','S','DEL','SUP','SUB','P','BR','UL','OL','LI','BLOCKQUOTE','CODE','PRE','H1','H2','H3','H4','H5','H6','HR','TABLE','THEAD','TBODY','TR','TH','TD','SPAN','DIV','IMG','INPUT']);
  const safeUrl = value => {
    try { const u = new URL(value, location.href); return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null; }
    catch { return null; }
  };
  doc.body.querySelectorAll('*').forEach(el => {
    if (!allowedTags.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      let keep = false;
      if (el.tagName === 'A' && name === 'href') keep = true;
      if (el.tagName === 'IMG' && (name === 'src' || name === 'alt')) keep = true;
      if (el.tagName === 'INPUT' && ['checked', 'disabled', 'type'].includes(name)) keep = true;
      if (!keep) { el.removeAttribute(attr.name); return; }
      if (name === 'href' || name === 'src') {
        const safe = safeUrl(attr.value);
        if (safe === null) el.removeAttribute(attr.name);
        else el.setAttribute(name, safe);
      }
    });
  });
  const html = doc.body.innerHTML;
  if (_markdownCache.size > 500) _markdownCache.clear();  // 上限保护, 防止超长会话内存膨胀
  _markdownCache.set(_mdKey, html);
  return html;
};
  CS.date = value => new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  CS.relative = value => { const delta = Math.max(0, Date.now() - new Date(value).getTime()); return delta < 60000 ? '刚刚' : delta < 3600000 ? `${Math.floor(delta / 60000)} 分钟前` : delta < 86400000 ? `${Math.floor(delta / 3600000)} 小时前` : CS.date(value); };
  CS.download = (name, body, type = 'text/plain;charset=utf-8') => {
    const blob = body instanceof Blob ? body : new Blob([body], { type });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };
  CS.csvCell = value => {
    let str = String(value ?? '');
    // Prevent spreadsheet formula interpretation when exporting user-provided values.
    if (/^[=+@\-\t\r]/.test(str)) str = "'" + str;
    return '"' + str.replace(/"/g, '""') + '"';
  };
  CS.parseCSV = (text, delimiter = ',', maxRows = 101) => {
    const rows = []; let row = [], field = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (c === delimiter && !quoted) { row.push(field); field = ''; }
      else if ((c === '\n' || c === '\r') && !quoted) {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); if (row.some(v => v.trim() !== '')) rows.push(row); row = []; field = '';
        if (rows.length >= maxRows) return { rows, limited: true };
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return { rows, limited: false, incompleteQuote: quoted };
  };
  CS.sequenceStats = text => {
    if (!text.trim()) throw new Error('请先输入 DNA 序列或 FASTA 文本。');
    if (text.length > 1000000) throw new Error('本地工具最多处理 1 MB 文本，请使用后端处理大文件。');
    let entries = [], current = { name: 'sequence_1', sequence: '' };
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (line.startsWith('>')) { if (current.sequence) entries.push(current); current = { name: line.slice(1).trim() || 'unnamed', sequence: '' }; }
      else current.sequence += line.replace(/\s/g, '').toUpperCase();
    }
    if (current.sequence) entries.push(current);
    if (!entries.length) throw new Error('未找到序列正文。');
    entries = entries.map(entry => {
      if (/[^ACGTRYSWKMBDHVN]/.test(entry.sequence)) throw new Error('仅接受 DNA IUPAC 字符 A/C/G/T/R/Y/S/W/K/M/B/D/H/V/N；请检查非序列文本。');
      const counts = Object.fromEntries(['A', 'C', 'G', 'T', 'N'].map(base => [base, entry.sequence.split(base).length - 1]));
      const canonical = counts.A + counts.C + counts.G + counts.T;
      return { name: entry.name, length: entry.sequence.length, counts, ambiguous: entry.sequence.length - canonical, gc: canonical ? ((counts.G + counts.C) / canonical * 100).toFixed(2) : null };
    });
    return entries;
  };
  CS.defaults = () => ({
    version: 1, projects: clone(CS.data.projects), datasets: clone(CS.data.datasets), runs: [],
    bookmarks: [], notes: {}, projectId: 'pr-pbmc', currentRunId: null,
    settings: { persist: true, contrast: false, reducedMotion: false, mode: 'local', endpoint: '/sigmaflow/api', inspector: true, model: 'openrouter/free', modelId: null, apiKey: '', lastTest: null, notifySound: true, soundVolume: 1, enterSend: true, autoScroll: true, toolGroupsOpen: {}, uiScale: 100, terminalTheme: 'monokai' },
    username: '',
    me: null
  });
  let stored;
  try { stored = JSON.parse(localStorage.getItem(key) || 'null'); } catch { CS.storageUnavailable = true; }
  CS.state = CS.defaults();
  if (stored?.version === 1) {
    for (const field of ['projects', 'datasets', 'runs', 'bookmarks']) if (Array.isArray(stored[field])) CS.state[field] = stored[field];
    if (stored.settings && typeof stored.settings === 'object') Object.assign(CS.state.settings, stored.settings);
    if (stored.notes && typeof stored.notes === 'object') CS.state.notes = stored.notes;
    CS.state.projectId = stored.projectId || 'pr-pbmc'; CS.state.currentRunId = stored.currentRunId || null;
  }
  try { if (localStorage.getItem(key + '.persist') === 'false') CS.state.settings.persist = false; } catch {}
  // A browser refresh must not silently restart an execution.
  CS.state.runs.forEach(run => { if (['running', 'connecting'].includes(run.status)) { run.status = run.transport === 'remote' ? 'error' : 'paused'; run.reloaded = true; if (run.transport === 'remote') run.error = '页面已重新加载；服务端任务可能继续运行。请重连以同步状态。'; } });
  // 清除刷新前残留的流式标记: 消息以 streaming:true 落盘后, 若中途刷新页面,
  // 没有对应的生成循环来清除它, 会让 favicon/绿点永远误判为"生成中";
  // 工具调用的 running 标记同样属于页面内存态, 刷新后一并清除。
  // 未回答的 ask 也一并标记失效: 服务端已随断开取消了等待者。
  CS.state.runs.forEach(run => (run.messages || []).forEach(m => { delete m.streaming; (m.tools || []).forEach(t => { delete t.running; }); (m.blocks || []).forEach(b => { if (b.type === 'ask' && !b.answered) b.stale = true; }); }));
  // 压缩等待消息若因刷新中断, 直接丢弃(id 无主的占位卡没有意义)
  CS.state.runs.forEach(run => { (run.messages || []).forEach(m => { if (m.compactPending) { (run.messages || []).splice(run.messages.indexOf(m), 1); } }); });
  CS.ui = {
    route: 'home', mobileSidebar: false, composer: '', attachments: [],
    filters: { data: '', dataTab: 'all', project: '', projectTab: 'active', literature: '', paperTab: 'all', tools: '', toolTab: 'all' },
    datasetSelection: new Set(), resultTab: 'overview', markerSearch: '', group: 'all', zoom: 1,
    workflowId: 'singlecell', workflowCategory: 'all', datasetId: 'ds-pbmc', organism: 'Homo sapiens', advanced: false,
    minGenes: 200, maxMito: 20, activeTool: 'sequence', sequence: CS.data.sampleFASTA, sequenceResult: null,
    modal: null, expandedLogs: new Set(), selectedCell: null, note: '', apiHealth: null,
    userMenu: false, authTab: 'login', modelMenu: false, projectMenu: false, projectSettingsMenu: null, expandedProjects: new Set(), conversations: [], settingsTab: 'general', models: [], providers: [], edit: null, providerModels: null, draftModelName: '', draftProviderId: null, dropdown: null, pendingDelete: null, modelsLoaded: false, thinkingOpen: false, thinkingText: '', toolsOpen: false, blockOpen: {}, askOpen: {}, planMode: false, canJumpLatest: false, contextInfo: null, contextMenu: false, agentTools: null, toolDraft: null,  agentSkills: null, skillDraft: null, mcpServers: null, mcpDraft: null, systemPrompt: null, syspromptDraft: null, tokens: null, tokensDraft: null, fsCollapsed: false, fs: null, terminal: { open: false, cols: 0, rows: 0 }, compactCollapsedSet: new Set()
  };
  // 侧栏项目折叠状态持久化: 记录用户显式展开的项目, 刷新后保持一致。
  try { const fold = JSON.parse(localStorage.getItem(key + '.fold') || 'null'); if (Array.isArray(fold)) CS.ui.expandedProjects = new Set(fold.map(String)); } catch {}
  CS.persistFold = () => { try { localStorage.setItem(key + '.fold', JSON.stringify([...CS.ui.expandedProjects])); } catch {} };
  CS.expandProject = id => { if (id && !CS.ui.expandedProjects.has(id)) { CS.ui.expandedProjects.add(id); CS.persistFold(); } };
  // 侧栏「项目」大类的整体折叠: 隐藏全部项目行与会话列表, 新建入口保留。
  try {
    CS.ui.projectsCollapsed = localStorage.getItem(key + '.foldProj') === '1';
    CS.ui.unassignedCollapsed = localStorage.getItem(key + '.foldLoose') === '1';
  } catch {}
  CS.persistFoldSection = () => { try { localStorage.setItem(key + '.foldProj', CS.ui.projectsCollapsed ? '1' : '0'); } catch {} };
  CS.persistFoldLoose = () => { try { localStorage.setItem(key + '.foldLoose', CS.ui.unassignedCollapsed ? '1' : '0'); } catch {} };
  CS.ui.fsCollapsed = localStorage.getItem(key + '.foldFs') === '1';
  CS.ui.terminal.width = Number(localStorage.getItem(key + '.termW')) || 480;
  CS.persistTermWidth = () => { try { localStorage.setItem(key + '.termW', String(CS.ui.terminal.width)); } catch {} };
  CS.persistFoldFs = () => { try { localStorage.setItem(key + '.foldFs', CS.ui.fsCollapsed ? '1' : '0'); } catch {} };
  CS.files = new Map(); // File objects only live in memory; raw file bytes never enter localStorage.
  CS.save = () => {
    try {
      localStorage.setItem(key + '.persist', String(CS.state.settings.persist));
      if (!CS.state.settings.persist) { localStorage.removeItem(key); return; }
      const state = { ...CS.state, runs: CS.state.runs.slice(-40) };
      localStorage.setItem(key, JSON.stringify(state));
    } catch { CS.storageUnavailable = true; }
  };
  CS.reset = () => { try { localStorage.removeItem(key); localStorage.removeItem(key + '.persist'); } catch {} CS.state = CS.defaults(); CS.files.clear(); CS.ui.attachments = []; CS.ui.datasetSelection.clear(); CS.save(); };
  CS.currentRun = () => CS.state.runs.find(r => r.id === CS.state.currentRunId);
  CS.currentProject = () => CS.state.projects.find(p => p.id === CS.state.projectId) || CS.state.projects[0];
  CS.workflow = id => CS.data.workflows.find(w => w.id === id) || CS.data.workflows[0];
  CS.statusLabel = status => ({ awaiting: '等待确认', running: '执行中', paused: '已暂停', cancelled: '已取消', complete: '已完成', error: '连接异常', connecting: '连接中' }[status] || status);
  CS.bus = new EventTarget();
  CS.emit = type => CS.bus.dispatchEvent(new Event(type));
  CS.toast = (message, type = 'success') => {
    const node = document.createElement('div'); node.className = 'toast ' + type;
    node.innerHTML = CS.icon(type === 'error' ? 'info' : 'checkcircle') + `<span>${CS.escape(message)}</span>`;
    document.getElementById('toast-root').append(node); setTimeout(() => node.remove(), 4200);
  };
  CS.report = run => {
    const project = CS.state.projects.find(p => p.id === (run?.projectId || CS.state.projectId));
    return `# SigmaFlow Science · 演示分析记录\n\n> 本报告是界面演示，不是真实生物学分析结果。所有图表与分析指标均为合成示例。\n\n## 项目\n${project?.name || '未指定'}\n\n## 研究问题\n${run?.prompt || 'PBMC 单细胞图谱交互演示'}\n\n## 执行状态\n${run ? CS.statusLabel(run.status) : '示例预览'}\n\n## 输入记录\n${(run?.datasetIds || ['ds-pbmc']).map(id => '- ' + (CS.state.datasets.find(d => d.id === id)?.name || id)).join('\n')}\n\n## 流程\n${(run?.steps || CS.workflow('singlecell').steps.map(s => ({title:s[0]}))).map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n\n## 参数\n\`\`\`json\n${JSON.stringify(run?.config || {}, null, 2)}\n\`\`\`\n\n## 说明与限制\n- 没有对上传文件执行单细胞、差异表达或任何模型推理。\n- 图表为固定种子生成的合成数据，不支持科研或临床结论。\n- 本地序列统计是独立的真实浏览器计算，与演示分析流程不同。\n- 原始文件仅保留在当前页面内存，不会由演示流程上传。\n\n生成时间：${new Date().toISOString()}\n`;
  };
})();
