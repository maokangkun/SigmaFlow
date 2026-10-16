import pathlib
p = pathlib.Path('js/app.js')
s = p.read_text()
target = '''  CS.fitUsageHeatmap = () => {
    const box = document.querySelector('.usage-heatmap');
    if (!box) return;
    const inner = box.clientWidth - 24 - 16 - 3 - 1;  // 排除 padding、星期标签列与其 flex 间隙, 留 1px 缓冲
    const weeks = Math.max(18, Math.min(53, Math.floor((inner + 2) / 14)));
    const gap = Math.min(5, Math.max(2, (inner - weeks * 12) / Math.max(1, weeks - 1)));
    // 列数或间隙变化都要重渲染; 重渲染后再次调用时两者均稳定, 不会循环
    const changed = weeks !== CS.ui.usageHeatCols || Math.abs((CS.ui.usageHeatGap || 2) - gap) > 0.05;
    CS.ui.usageHeatGap = Math.round(gap * 10) / 10;
    if (changed) { CS.ui.usageHeatCols = weeks; CS.render(); }
  };'''
new = '''  CS.fitUsageHeatmap = () => {
    const compute = () => {
      const box = document.querySelector('.usage-heatmap');
      if (!box) return;
      const inner = box.clientWidth - 24 - 16 - 3 - 1;  // 排除 padding、星期标签列与其 flex 间隙, 留 1px 缓冲
      const weeks = Math.max(18, Math.min(53, Math.floor((inner + 2) / 14)));
      const gap = Math.min(5, Math.max(2, (inner - weeks * 12) / Math.max(1, weeks - 1)));
      // 列数或间隙变化都要重渲染; 重渲染收敛后两者稳定, 不会循环
      const changed = weeks !== CS.ui.usageHeatCols || Math.abs((CS.ui.usageHeatGap || 2) - gap) > 0.05;
      CS.ui.usageHeatGap = Math.round(gap * 10) / 10;
      if (changed) { CS.ui.usageHeatCols = weeks; CS.render(); }
    };
    // 推迟到布局稳定(双重 rAF)后再测量, 避免滚动条出现/消失导致宽度漂移
    requestAnimationFrame(() => requestAnimationFrame(compute));
  };'''
assert s.count(target) == 1, s.count(target)
p.write_text(s.replace(target, new))
print('ok')
