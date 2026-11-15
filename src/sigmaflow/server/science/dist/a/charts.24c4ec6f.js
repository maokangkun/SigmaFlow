/* Deterministic, synthetic SVG charts. Native interactive SVG, no chart dependencies. */
(() => {
  const e = CS.escape;
  let seed = 3724;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(random(), 0.00001))) * Math.cos(2 * Math.PI * random());
  CS.points = CS.data.groups.flatMap((group, gi) => Array.from({ length: Math.floor(group.count / 4) }, (_, i) => {
    const x = Math.max(50, Math.min(610, group.center[0] + gaussian() * group.spread[0] * .48));
    const y = Math.max(35, Math.min(355, group.center[1] + gaussian() * group.spread[1] * .48));
    return { x, y, group: gi, id: `${['T', 'B', 'NK', 'MO', 'DC'][gi]}-${String(i + 1).padStart(4, '0')}` };
  }));
  CS.scatter = (compact = false) => {
    const zoom = CS.ui.zoom; const w = 660 / zoom, h = 405 / zoom;
    return `<svg id="umap-chart" class="scatter-chart" viewBox="${(660 - w) / 2} ${(405 - h) / 2} ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="合成单细胞嵌入示意图，共 ${CS.points.length} 个演示点，不是真实 UMAP 计算结果">
      <rect x="0" y="0" width="660" height="405" fill="#f7f8fa"/>
      <path d="M45 350v30h35" fill="none" stroke="#9ca3b1" stroke-width="1.2"/>
      <text x="81" y="384" font-size="10" fill="#858b9a" font-family="sans-serif">UMAP 1</text>
      <text x="37" y="347" transform="rotate(-90 37 347)" font-size="10" fill="#858b9a" font-family="sans-serif">UMAP 2</text>
      ${CS.points.map(p => `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="${compact ? 2.5 : 2.8}" fill="${CS.data.groups[p.group].color}" opacity="${CS.ui.group !== 'all' && CS.ui.group !== String(p.group) ? .1 : .82}" data-action="select-cell" data-id="${p.id}" tabindex="-1"><title>${p.id} · ${CS.data.groups[p.group].name} · 合成示例</title></circle>`).join('')}
      ${CS.data.groups.map((g, i) => `<text x="${g.center[0]}" y="${g.center[1] - g.spread[1] - 10}" text-anchor="middle" fill="#747b8d" font-family="sans-serif" font-size="11" opacity="${CS.ui.group !== 'all' && CS.ui.group !== String(i) ? .35 : 1}">${e(g.name)}</text>`).join('')}
    </svg>`;
  };
  CS.bars = () => `<div class="composition">${CS.data.groups.map((g, i) => `<button type="button" class="composition-row ${CS.ui.group === String(i) ? 'selected' : ''}" data-action="filter-group" data-id="${i}"><span class="bar-label"><i style="background:${g.color}"></i>${e(g.name)}</span><span class="bar-track"><span style="width:${g.count / 980 * 100}%;background:${g.color}"></span></span><span class="bar-value">${g.count.toLocaleString()}</span></button>`).join('')}</div>`;
  CS.heatmap = () => {
    const palette = ['#edf0f3', '#e0e1ec', '#d0cee2', '#b9b4d4', '#a49cc5', '#8a80b2'];
    return `<svg class="heatmap" viewBox="0 0 550 270" role="img" aria-label="合成表达矩阵热图" xmlns="http://www.w3.org/2000/svg"><rect width="550" height="270" fill="#f7f8fa"/>
      ${CS.data.markers.map((m, row) => `<text x="73" y="${34 + row * 26}" text-anchor="end" font-size="11" fill="#747b8d" font-family="sans-serif">${m.gene}</text>${CS.data.groups.map((g, col) => {
        const val = m.group === g.name ? 4 + row % 2 : (row + col * 3) % 3;
        return `<rect x="${90 + col * 81}" y="${17 + row * 26}" width="77" height="23" rx="3" fill="${palette[val]}"><title>${m.gene} / ${g.name} : ${val}（合成值）</title></rect>`;
      }).join('')}`).join('')}
      ${CS.data.groups.map((g, col) => `<text x="${129 + col * 81}" y="245" text-anchor="middle" font-size="10" fill="#747b8d" font-family="sans-serif">${g.name}</text>`).join('')}
    </svg>`;
  };
  CS.dnaArt = () => `<svg class="dna-watermark" viewBox="0 0 380 660" aria-hidden="true" fill="none">
    <path d="M70-35c0 165 240 165 240 330S70 460 70 660M310-35c0 165-240 165-240 330s240 165 240 365" stroke="currentColor" stroke-width="13"/>
    ${Array.from({ length: 21 }, (_, i) => { const y = i * 32 - 8; const offset = Math.cos((y + 35) / 330 * Math.PI) * 120; return `<path d="M${190 - Math.abs(offset)} ${y}H${190 + Math.abs(offset)}" stroke="currentColor" stroke-width="5"/>`; }).join('')}
  </svg>`;
})();
