# 瘟疫公司网页移植 · 阶段 1(模拟引擎 + 世界地图 + 主循环)

宿主机: `http://127.0.0.1:4119/` (plague-web.service, 静态白名单服务 plague_server.py)
沙箱副本: 本目录 (与宿主机 /data/mkk/plague/web 同步)

## 目录

```
index.html            入口(开始界面/HUD/地图/进化树/新闻流)
css/style.css         暗底红调主题
js/engine/            核心引擎(node 可跑, 浏览器与测试共用)
  rng.js              mulberry32 可序列化随机数(存档精确续跑)
  model.js            性状聚合(纯数据驱动) + 前置判定(and/or)
  engine.js           模拟主循环: SI 动力学/跨国传播/政府/解药/DNA/胜负/存档
  loader.js           node(fs)/浏览器(fetch) 双模式数据加载
js/ui/                界面层(l10n/map/tree/main)
js/tests/run_tests.js node 断言套件 (44 条, `node js/tests/run_tests.js`)
tools/browser_test.js Playwright 断言套件 (20 条, 宿主机跑)
data/                 阶段0 提取的 JSON (见下)
assets/map|icons/     地图与图标
```

## 机制 → 数据表对应

| 机制 | 数据源 | 引擎位置 |
|---|---|---|
| 传染性/严重度/致命性 | diseases/bacteria.json `global` 块 + 节点 `change_to_*` 累加 | model.js traitsFromGlobal/applyNode |
| 国家修正(富裕/贫困/城市/农村/炎热/寒冷/潮湿/干旱) | countries.json 0/1 标志 × 病毒性状系数(基础+节点加成) | model.js attributeMultiplier = 1+Σ flag×trait |
| 医疗压制 | countries.json `medical_capacity`×`medical_budget` | engine.js betaFor (检出后生效) |
| 死亡率 | 致命性点数^1.05 × 医疗挽救折扣 | engine.js mortalityFor |
| 空路/海路 | routes.json `air_routes`(52)/`ocean_routes`(69) 权重 | engine.js routeFlow |
| 陆路 | `land_routes_mult`×0.001 × land_adjacency.json(由 country_fill_indexed.png 4-邻域扫描派生, 85 对) | engine.js landRoutes |
| 机场/港口开关 | govactions.json `change_air/sea/land_borders`=-1 | runGovernment |
| 政府行为触发 | `condition_local_infected_percent`/`condition_population_dead`/`condition_disease_severity`/`condition_has_airport` 等字段, `trigger_local_priority` 排序, `condition_random`×ramp 概率门 | govActionEligible |
| 解药研究 | Σ国家 `medical_budget`×富裕加权×(健康+0.35×感染)产能×(基线+`change_research_allocation` 叠加) × 警觉度 | cureResearchPerDay |
| 解药工作量 | CURE_WORK × (1+Σ`change_to_cure_base_multiplier`) ÷ (1+Σ`change_to_research_inefficiency_multiplier`) | cureWorkRequired |
| 进化成本 | 节点 `cost` 绝对值 + 3%/已进化节点膨胀(校准) | nodeCost |
| 前置解锁 | `tech_requirement_and`(318 处字符串)/`tech_requirement_or`(9 处) 逗号节点 id 列表 | model.js nodeAvailable |
| 症状变异 | `mutation` 性状(基础 0.5) 每日概率 | mutationStep |
| 新闻 | govactions `news_content`(%s=国名)+ events.json 抽样(经 data/news_flavor.json 校验过的 l10n 键) | pushNews |
| 中文 | l10n_zh.json(键=英文原文): 国家名/节点名/描述/新闻模板 | ui/l10n.js |

## 校准常数(非数据来源, engine.js CAL, 均有注释)

SPREAD_RATE 0.035 / BASE_SEED 4 / DEATH_SCALE 0.0014 / ROUTE_K 0.06 /
CURE_WORK 9000 / DNA_PER_INFECT 1.6e-8 / COST_INFLATION 0.03 等。

## 平衡实测(node, 沙箱)

- 挂机不进化: 第 ~400 天解药完成 → 败
- 激进策略(传播→重排/硬化→症状): 第 700-920 天灭绝人类 → 胜, 解药停在 49-69%
- 浏览器作弊快进(每 2 DNA/天): 第 ~310-350 天灭绝 → 胜

## 阶段 2 交接

- 引擎 API: `new PlagueEng.Engine(data, {patientZero, seed})`, `tick()/evolve(id)/devolve(id)/save()/load()`
- 测试钩子: 浏览器 `window.__PLAGUE__` (state/ff/buyNode/giveDna/countryPanel...)
- 未做(按任务范围): 音效、特殊瘟疫差异化、场景、基因 UI
- 其余 14 棵疾病树数据已在 data/diseases/(阶段0 tar), 本阶段只带 bacteria.json
