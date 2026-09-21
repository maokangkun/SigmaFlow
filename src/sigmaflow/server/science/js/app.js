/* Application controller: routing, accessible dialogs and real UI interactions. */
(() => {
  'use strict';
  const e = CS.escape, i = CS.icon, H = CS.viewHelpers;
  const allowedRoutes = Object.keys(CS.views).filter(x => !['sidebar','topbar','composer','inspector','scatterPanel','reportDocument','sequenceTool'].includes(x));
  let uploadContext = 'data', modalReturnFocus = null;
  const readRoute = () => {
    const value = location.hash.replace(/^#\/?/, '').split('?')[0];
    return allowedRoutes.includes(value) ? value : 'home';
  };
  CS.navigate = route => {
    CS.ui.mobileSidebar = false;
    if (!allowedRoutes.includes(route)) route = 'home';
    if (readRoute() === route && CS.ui.route === route) CS.render();
    else location.hash = '/' + route;
  };
  CS.render = () => {
    const active = document.activeElement;
    const focus = active?.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
    const x = window.scrollX, y = window.scrollY;
    const sidebarScroll = document.querySelector('.sidebar-scroll')?.scrollTop || 0;
    const conversationScroll = document.querySelector('.conversation')?.scrollTop || 0;
    const inspectorScroll = document.querySelector('.inspector')?.scrollTop || 0;
    document.documentElement.dataset.contrast = CS.state.settings.contrast ? 'high' : 'normal';
    document.documentElement.dataset.motion = CS.state.settings.reducedMotion ? 'reduced' : 'normal';
    const page = CS.views[CS.ui.route] || CS.views.home;
    document.getElementById('app').innerHTML = `<div class="app-shell">${CS.views.sidebar()}<main id="main" class="main-shell" tabindex="-1">${CS.views.topbar()}${page()}</main></div>`;
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
  };
  CS.bus.addEventListener('render', () => CS.render());
  window.addEventListener('hashchange', () => {
    CS.ui.route = readRoute(); CS.ui.mobileSidebar = false; CS.closeModal(); CS.render(); window.scrollTo(0, 0);
    document.title = 'SigmaFlow Science · ' + ({ home: '科研工作空间', chat: 'Agent 对话', data: '数据集', projects: '项目', workflows: '工作流', results: '分析结果', literature: '文献', tools: '生物工具', tasks: '任务队列', settings: '设置', help: '帮助' }[CS.ui.route] || '工作空间');
  });

  const openNewTask = (prompt, workflowId = 'singlecell', ids = []) => {
    CS.agent.create(prompt, workflowId, ids, { organism: CS.ui.organism, minGenes: Number(CS.ui.minGenes), maxMito: Number(CS.ui.maxMito), synthetic: true });
    CS.ui.composer = ''; CS.ui.attachments = []; CS.ui.expandedLogs.clear();
    CS.closeModal(); CS.navigate('chat');
  };
  const inferWorkflow = prompt => /文献|论文|综述|literature|paper/i.test(prompt) ? 'literature' : /格式|质控|缺失|quality/i.test(prompt) ? 'quality' : /拟南芥|转录组|rnaseq|RNA-seq/i.test(prompt) && !/单细胞/.test(prompt) ? 'rnaseq' : 'singlecell';
  const copyText = async text => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.left = '-9999px'; document.body.append(t); t.select(); const ok = document.execCommand('copy'); t.remove(); if (!ok) throw new Error('浏览器阻止复制，请改用文件导出。'); }
    CS.toast('已复制到剪贴板。');
  };
  const citation = p => `${p.authors} (${p.year}). ${p.title}. ${p.journal}. https://doi.org/${p.doi}`;
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
    if (modal.type === 'import') {
      title = '添加研究数据';
      body = `<div class="dropzone" id="dropzone" data-dropzone><div class="upload-mark">${i('upload','',24)}</div><p>拖拽文件到这里，或${H.btn('pick-files','选择本地文件','','small-btn flat')}</p><span class="sub">CSV / TSV / FASTA / H5AD / FASTQ / MTX / JSON</span></div><div class="mt-20">${H.notice('导入仅在本地登记。文本预览最多读取 64 KB；不解压、不执行文件。二进制数据仅查看元信息。')}</div>${modal.imported?.length ? `<div class="mt-20 stack">${modal.imported.map(d => `<div class="row">${H.tile('file','green')}<div class="grow"><h3>${e(d.name)}</h3><span class="small muted">${CS.formatBytes(d.size)} · 已在本地登记</span></div>${i('checkcircle','',17)}</div>`).join('')}</div>` : ''}`;
      footer = H.btn('close-modal','完成','check','primary');
    } else if (modal.type === 'dataset-picker') {
      title = '将数据加入研究上下文';
      body = `<p class="small muted mb-20">选择数据记录，附加到当前问题。演示执行不上传原始文件。</p>${CS.state.datasets.map(d => `<button class="dataset-picker-row" data-action="pick-dataset" data-id="${e(d.id)}">${H.tile(d.format === 'H5AD' ? 'cells' : 'file')}<div class="grow"><strong>${e(d.name)}</strong><p>${e(d.format)} · ${d.source === 'demo' ? '合成演示' : '本地导入'}</p></div>${i(CS.ui.attachments.includes(d.id) ? 'checkcircle' : 'plus','',17)}</button>`).join('')}`;
    } else if (modal.type === 'tool-picker') {
      title = '选择研究工具';
      body = `<p class="small muted mb-20">选择后打开对应的本地工具或分析配置。你尚未发送的问题会保留。</p>${CS.data.workflows.map(w => `<button class="dataset-picker-row" data-action="pick-workflow" data-id="${w.id}">${H.tile(w.icon)}<div class="grow"><strong>${e(w.title)}</strong><p>${e(w.sub)} · 演示</p></div>${i('arrow','',16)}</button>`).join('')}<button class="dataset-picker-row" data-action="choose-sequence-tool">${H.tile('dna','green')}<div class="grow"><strong>DNA 基础统计</strong><p>浏览器内真实计算长度与 GC 比例</p></div>${i('arrow','',16)}</button>`;
    } else if (modal.type === 'project') {
      const p = modal.project || {}; title = p.id ? '编辑研究项目' : '新的研究，从这里开始';
      body = `<form id="project-form" data-form="project"><div class="field"><label for="project-name">项目名称</label><input id="project-name" name="name" value="${e(p.name || '')}" placeholder="例如 immune_cell_atlas" maxlength="60" required autocomplete="off"></div><div class="field"><label for="project-description">项目描述</label><textarea id="project-description" name="description" placeholder="这个项目希望回答什么问题？" rows="3" maxlength="240">${e(p.description || '')}</textarea></div><div class="field"><label for="project-tags">标签</label><input id="project-tags" name="tags" value="${e((p.tags || []).join(', '))}" placeholder="单细胞, 文献, 方法" maxlength="100"><span class="hint">用英文或中文逗号分隔，最多 5 个标签。</span></div></form>`;
      footer = `${p.id ? H.btn('archive-project',p.archived ? '恢复项目' : '归档项目','folder','flat',`data-id="${e(p.id)}"`) : ''}${H.btn('close-modal','取消','','flat')}<button class="btn primary" type="submit" form="project-form">${i('check','',15)} 保存项目</button>`;
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
    document.getElementById('modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><h2 id="modal-title">${e(title)}</h2>${H.iconBtn('close-modal','x','关闭对话框')}</header><div class="modal-body">${body}</div>${footer ? `<footer class="modal-footer">${footer}</footer>` : ''}</section></div>`;
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
  const actions = {
    'toggle-sidebar': () => { CS.ui.mobileSidebar = !CS.ui.mobileSidebar; CS.render(); },
    'go-home': () => CS.navigate('home'), 'go-data': () => CS.navigate('data'), 'go-workflows': () => CS.navigate('workflows'),
    'new-project': () => CS.showModal('project'),
    'edit-project': id => CS.showModal('project',{project:CS.state.projects.find(p=>p.id===id)}),
    'open-project': id => {
      const project = CS.state.projects.find(p=>p.id===id); if (!project) return;
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
    'choose-tools': () => CS.showModal('tool-picker'),
    'pick-workflow': id => { CS.ui.workflowId=id; CS.closeModal(); CS.navigate('workflows'); },
    'choose-sequence-tool': () => { CS.ui.activeTool='sequence'; CS.closeModal(); CS.navigate('tools'); },
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
    'export-workspace': () => CS.download('sigmaflow_science_workspace.json',JSON.stringify({...CS.state,exportedAt:new Date().toISOString(),containsOriginalFiles:false},null,2),'application/json'),
    'reset-workspace': () => CS.showModal('confirm',{title:'清空并恢复示例？',message:'将清除本地的项目、对话、笔记、任务和文件记录，恢复初始示例。此操作不可撤销，不影响电脑上的原文件。',confirmAction:'confirm-reset',confirmLabel:'清空并恢复',danger:true}),
    'confirm-reset': () => { CS.state.runs.forEach(r=>{ if(['running','paused','connecting'].includes(r.status)) CS.agent.control(r,'cancel'); }); CS.reset(); CS.closeModal(); CS.navigate('home'); CS.toast('已恢复初始演示工作空间。'); },
    'save-api': () => {
      const mode=document.getElementById('agent-mode').value; const endpoint=document.getElementById('api-endpoint').value.trim();
      if (!endpoint) { CS.toast('接口地址不能为空。','error'); return; }
      const old=CS.state.settings.endpoint; CS.state.settings.endpoint=endpoint;
      try { if(mode==='remote') CS.api.url('/health'); }
      catch(error){CS.state.settings.endpoint=old;CS.toast(error.message,'error');return;}
      CS.state.settings.mode=mode; CS.ui.apiHealth=null; emitRender(); CS.toast('接口配置已保存，新建任务将使用新的运行模式。');
    },
    'test-api': async () => {
      const old=CS.state.settings.endpoint; CS.state.settings.endpoint=document.getElementById('api-endpoint').value.trim();
      try { const data=await CS.api.request('/health'); if(data.status!=='ok') throw new Error('health.status 不为 ok'); CS.ui.apiHealth='连接成功'+(data.demo ? ' · 模拟服务' : ''); CS.toast(CS.ui.apiHealth); }
      catch(error){CS.ui.apiHealth='连接失败';CS.toast('接口不可用：'+error.message,'error');}
      finally{CS.state.settings.endpoint=old;CS.render();}
    }
  };
  document.addEventListener('click', async event => {
    const nav = event.target.closest('[data-nav]');
    if (nav) {
      event.preventDefault();
      if (nav.dataset.nav==='home') { CS.state.currentRunId=null; CS.ui.composer=''; CS.ui.attachments=[]; CS.save(); }
      CS.navigate(nav.dataset.nav); return;
    }
    if (event.target.classList.contains('modal-backdrop')) { CS.closeModal(); return; }
    const target=event.target.closest('[data-action]'); if (!target || target.disabled) return;
    const action=actions[target.dataset.action];
    if (action) { event.preventDefault(); try { await action(target.dataset.id,target); } catch(error) { console.error(error); CS.toast(error.message || '操作失败，请重试。','error'); } }
  });
  document.addEventListener('submit', event => {
    const form=event.target; const type=form.dataset.form; if(!type) return; event.preventDefault();
    if(type==='composer') {
      const prompt=CS.ui.composer.trim(); if(!prompt) return;
      if(CS.ui.route==='chat' && CS.currentRun()) {
        const run=CS.currentRun(); run.messages.push({role:'user',content:prompt,datasetIds:[...CS.ui.attachments],at:new Date().toISOString()});
        run.messages.push({role:'assistant',content:'这是演示对话，不是模型生成的科研解释。当前任务的输入、计划和步骤都可在上方查看；结果中的点云与表达值为合成示例。要获取真实分析，请通过服务端接入模型与经过验证的分析工作流。',at:new Date().toISOString()});
        CS.ui.composer=''; CS.ui.attachments=[]; CS.save(); CS.render(); setTimeout(()=>document.querySelector('.chat-composer')?.scrollIntoView({block:'end'}),20);
      } else openNewTask(prompt,inferWorkflow(prompt),CS.ui.attachments);
    } else if(type==='project') {
      const name=document.getElementById('project-name').value.trim(); const description=document.getElementById('project-description').value.trim(); const tags=document.getElementById('project-tags').value.split(/[,，]/).map(t=>t.trim()).filter(Boolean).slice(0,5);
      if(!name) {CS.toast('项目名称不能为空。','error');return;}
      const id=CS.ui.modal.project?.id;
      if(CS.state.projects.some(p=>p.name.toLowerCase()===name.toLowerCase() && p.id!==id)) {CS.toast('已有同名项目，请换一个名称。','error');return;}
      if(id) Object.assign(CS.state.projects.find(p=>p.id===id),{name,description,tags,updated:CS.today()});
      else { const project={id:CS.uid('pr'),name,description,tags,icon:'folder',created:CS.today(),updated:CS.today(),archived:false};CS.state.projects.push(project);CS.state.projectId=project.id; }
      CS.save();CS.closeModal();CS.navigate('projects');CS.toast('项目已保存。');
    } else if(type==='note') {
      const text=document.getElementById('paper-note-text').value; CS.state.notes[CS.ui.modal.id]=text;CS.save();CS.closeModal();CS.render();CS.toast('阅读笔记已保存。');
    }
  });
  const searchBindings={ 'data-search':'data','project-search':'project','paper-search':'literature','tool-search':'tools' };
  document.addEventListener('input',event=>{
    const target=event.target,id=target.id;
    if(id==='composer-text') {CS.ui.composer=target.value; const send=document.querySelector('.send-button');if(send)send.disabled=!target.value.trim();}
    else if(searchBindings[id]) {CS.ui.filters[searchBindings[id]]=target.value;CS.render();}
    else if(id==='marker-search') {CS.ui.markerSearch=target.value;CS.render();}
    else if(id==='sequence-input') CS.ui.sequence=target.value;
    else if(id==='pubmed-query') CS.ui.pubmedQuery=target.value;
    else if(id==='min-genes') CS.ui.minGenes=target.value;
    else if(id==='max-mito') CS.ui.maxMito=target.value;
  });
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target.id==='file-input'){handleFiles(target.files);}
    else if(target.dataset.checkDataset){const id=target.dataset.checkDataset;target.checked ? CS.ui.datasetSelection.add(id) : CS.ui.datasetSelection.delete(id);CS.render();}
    else if(target.id==='select-all-data'){
      const f=CS.ui.filters;CS.state.datasets.filter(d=>(f.dataTab==='all'||d.source===f.dataTab)&&(d.name+d.format+d.description).toLowerCase().includes(f.data.toLowerCase())).forEach(d=>target.checked?CS.ui.datasetSelection.add(d.id):CS.ui.datasetSelection.delete(d.id));CS.render();
    } else if(target.id==='agent-selector' && target.value==='settings') CS.navigate('settings');
    else if(target.id==='workflow-dataset') CS.ui.datasetId=target.value;
    else if(target.id==='workflow-organism') CS.ui.organism=target.value;
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(CS.ui.modal)CS.closeModal();else if(CS.ui.mobileSidebar){CS.ui.mobileSidebar=false;CS.render();}return;}
    if(event.altKey && event.key.toLowerCase()==='n'){event.preventDefault();CS.state.currentRunId=null;CS.ui.composer='';CS.ui.attachments=[];CS.save();CS.navigate('home');return;}
    if(event.target.id==='composer-text' && event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();event.target.closest('form').requestSubmit();}
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
  CS.ui.route=readRoute();CS.render();
  if(CS.storageUnavailable)CS.toast('浏览器存储不可用，当前仅在内存运行。','error');
})();
