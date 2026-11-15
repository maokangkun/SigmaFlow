/* 示例 UI mod 入口 — SFM SDK 用法模板(原生 ES module, 免构建)。
 *
 * 可用 API 见 js/sfm.js: registerView / registerCard / registerSetting /
 * call(path, opts) / on(event, fn)。
 */
const state = { note: '未加载' };

async function renderOverview(el) {
  el.innerHTML = '<h1>Mod 速览</h1><p class="small muted mb-20">本视图由 example-ui mod 在运行时注入(未参与前端构建)。</p><div class="panel" id="sfm-demo-list">加载中…</div>';
  try {
    const d = await SFM.call('/mods');
    const rows = (d.mods || []).map(m =>
      `<div class="setting-row compact"><div><h3>${m.name} <span class="tiny muted">v${m.version} · ${m.id}</span></h3><p class="tiny muted">${m.state}${m.stateReason ? ' · ' + m.stateReason : ''}</p></div></div>`).join('');
    const list = el.querySelector('#sfm-demo-list');
    if (list) list.innerHTML = `<p class="small muted mb-20">epoch ${d.epoch} · 共 ${d.mods.length} 个</p>${rows}`;
  } catch (err) {
    const list = el.querySelector('#sfm-demo-list');
    if (list) list.innerHTML = `<p class="small">加载失败: ${err && err.message || err}</p>`;
  }
}

SFM.registerView({
  id: 'example-ui-overview',
  title: 'Mod 速览',
  icon: 'grid',
  order: 600,
  mount: renderOverview,
  unmount() { state.note = '已卸载'; },
});

SFM.registerSetting({
  id: 'example-ui-note',
  render(el) {
    el.innerHTML = '<h3>示例 UI Mod</h3><p class="small muted">这个设置区块同样来自运行时注入的 example-ui。它演示 SFM.registerSetting: 任何 UI mod 都能在 Mod 管理页贡献自己的配置界面。</p>';
  },
});
