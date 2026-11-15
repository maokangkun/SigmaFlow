/* SFM — SigmaFlow Mod SDK (P3, 设计 §6.7)。
 *
 * UI mod 的宿主接口: 启动时 fetch /api/mods/ui/registry, 逐个 import entry
 * (原生 ES module, 免构建); entry 调 window.SFM.registerView 等注册贡献。
 *
 * 生命周期: mod 重载后 epoch 变化 → 注册表端点返回新 entry URL → SFM
 * 卸载旧贡献(unmount)后重装; 同 id 后注册覆盖前者。
 */
(() => {
  'use strict';
  // SFM 自身的加载地址是推导静态基址的最可靠依据: 页面无论部署在
  // 前缀下(/sigmaflow/science/a/sfm.<hash>.js)还是本地(js/sfm.js),
  // 脚本目录的上一级就是 science 应用根。endpoint 不能用 — 它指向
  // API 根(通常以 /api 结尾), 拼静态路径会多出 /api。
  const SELF_SRC = (document.currentScript && document.currentScript.src) || '';
  const state = { views: {}, cards: {}, settings: {}, order: [], epoch: 0, loaded: [] };

  function scienceRoot() {
    const m = SELF_SRC.match(/^(.*\/science\/)a\/[^/]*\.js$/) || SELF_SRC.match(/^(.*\/science\/)js\/[^/]*\.js$/);
    if (m) return m[1];
    // 兜底: hash 路由下 pathname 恒为 <prefix>/science/(index.html)
    let p = location.pathname.replace(/index\.html$/, '');
    if (!p.endsWith('/')) p += '/';
    return p;
  }

  const SFM = {
    /* 注册侧栏视图: {id, title, icon?, order?, mount(el), unmount?} */
    registerView(v) {
      if (!v || !v.id || typeof v.mount !== 'function') throw new Error('registerView 需要 {id, mount}');
      state.views[v.id] = v;
      if (!state.order.includes(v.id)) state.order.push(v.id);
      if (!CS.views[v.id]) CS.views[v.id] = () => `<section class="page"><div id="sfm-view-${v.id}" class="sfm-view-host"></div></section>`;
      try { CS.render(); } catch (e) { /* 渲染期注册时防递归 */ }
    },
    /* 注册消息卡渲染器: render(el, payload) */
    registerCard(type, renderer) { state.cards[type] = renderer; },
    /* 注册设置页区块: {id, title?, render(el)} — 挂进 Mod 设置 tab */
    registerSetting(s) { if (s && s.id) state.settings[s.id] = s; },
    /* API 调用直通(带鉴权/origin 处理) */
    call(path, opts) { return CS.api.request(path, opts); },
    /* 事件订阅: 'mod.updated' 等 */
    on(event, fn) { (state.listeners ||= {}); (state.listeners[event] ||= []).push(fn); },
    emit(event, data) { (state.listeners?.[event] || []).forEach(fn => { try { fn(data); } catch (e) { console.warn('[sfm]', e); } }); },
    /* 内部: 侧栏导航条目(views.js 消费) */
    navItems() {
      return state.order.slice().sort((a, b) => (state.views[a].order ?? 500) - (state.views[b].order ?? 500))
        .map(id => ({ id, icon: state.views[id].icon || 'grid', title: state.views[id].title || id }));
    },
    settingsSections() { return Object.values(state.settings); },
    cards: state.cards,
    /* views 暴露为只读引用(app.js 渲染钩子按路由查挂载点) */
    views: state.views,

    /* 注册表拉取: 等应用就绪(endpoint/CS.api 由主应用启动期异步加载),
     * 404/异常按 500ms 退避重试至多 20 次 — 固定 300ms 时序会在配置
     * 未就绪时把请求打到 /mods/...(丢 /api 前缀) 并静默失败 */
    async _fetchRegistry() {
      for (let i = 0; i < 20; i++) {
        if (window.CS && CS.api && CS.state && CS.state.settings) {
          try {
            const reg = await CS.api.request('/mods/ui/registry');
            if (reg && Array.isArray(reg.mods)) return reg;
          } catch (e) { /* 配置未就绪或瞬时错误: 退避重试 */ }
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return null;
    },

    /* 启动引导: 拉注册表并装载全部 UI mod(幂等, epoch 变化才重装) */
    async bootstrap() {
      const reg = await this._fetchRegistry();
      if (!reg || reg.epoch === state.epoch) return;
      const stale = state.loaded.filter(m => !(reg.mods || []).some(x => x.id === m.id));
      for (const m of stale) this._unmount(m.id);
      for (const m of reg.mods || []) {
        if (state.loaded.some(x => x.id === m.id && x.path === m.entryPath)) continue;
        this._unmount(m.id);
        // entryPath 形如 "science/m/<id>/entry.js": 相对 science 应用根
        // 解析(基址来自本脚本地址/页面路径, 自动兼容任意部署前缀)
        const rel = m.entryPath.replace(/^science\//, '');
        const url = scienceRoot() + rel + '?v=' + reg.epoch;
        try {
          await import(/* @vite-ignore */ url);
          state.loaded.push({ id: m.id, path: m.entryPath });
          console.info('[sfm] loaded', m.id, m.version);
        } catch (err) {
          console.warn('[sfm] failed to load', m.id, err);
          CS.toast?.(`Mod ${m.id} 装载失败: ${err && err.message || err}`, 'error');
        }
      }
      state.epoch = reg.epoch;
      this.emit('mods.loaded', { epoch: reg.epoch });
    },
    _unmount(id) {
      const idx = state.loaded.findIndex(x => x.id === id);
      if (idx >= 0) state.loaded.splice(idx, 1);
      const v = state.views[id];
      if (v && typeof v.unmount === 'function') { try { v.unmount(); } catch (e) { console.warn('[sfm] unmount', id, e); } }
      delete state.views[id];
      delete CS.views[id];
      state.order = state.order.filter(x => x !== id);
    },
  };
  window.SFM = SFM;
  CS.sfm = SFM;
  /* 启动时机: 主应用首帧后再装(避免阻塞登录/引导) */
  window.addEventListener('DOMContentLoaded', () => setTimeout(() => SFM.bootstrap(), 300));
})();
