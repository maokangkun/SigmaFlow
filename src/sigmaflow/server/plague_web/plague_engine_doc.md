# 《瘟疫公司》网页版 · 模拟引擎技术文档

对应部署: https://10.140.177.73:8888/plague/ (`/data/mkk/plague/web/`)
源码: `js/engine/{rng,model,genes,loader,engine}.js` + `js/ui/*`(表现层) · 引擎核心共约 1200 行, 无依赖, node/浏览器双端同代码
数据: 阶段0 从 APK 提取的 JSON(58 国 / 15 棵进化树 1059 节点 / 95 基因 / 719 政府行为 / zh-Hans 9199 键)

---

## 0. 设计原则

1. **数据驱动**: 国家/节点/基因/政府行为的**每一个数值**都来自提取 JSON 的原始字段(`countries.txt`/`bacteria.txt`/`genes.txt`/`govactions_*.txt` 导出), 引擎不硬编码任何内容数值
2. **公式是我们的, 常数全集中**: 全局动力学公式为重建(原作公式在 native so 内), 所有校准常数集中在 `CAL` 对象并逐条注释; 标注 `近似` 的条目见 §9
3. **确定性**: mulberry32 种子 PRNG, 状态可序列化; 存档读回后续跑逐日一致(node 断言 A32-A34 验证)
4. **引擎/UI 分离**: 引擎零 DOM 依赖, node 侧可直接跑完整局(平衡测试/断言), 浏览器只做渲染与输入

## 1. 模块组成

| 模块 | 行数 | 职责 |
|---|---|---|
| `rng.js` | 31 | mulberry32 种子随机(可序列化状态, Fisher-Yates 洗牌) |
| `model.js` | 114 | 纯函数层: 性状聚合 / 国家属性乘子 / 进化前置判定 |
| `genes.js` | 91 | 开局 5 基因槽 → 引擎修正量(字段映射见 §7) |
| `engine.js` | 876 | 每日模拟管线 / 政府行为 / 解药 / 突变 / DNA 经济 / 存档 |
| `loader.js` | 135 | 数据加载(node 读文件, 浏览器 fetch) |
| `ui/*` | — | 地图(SVG 国家路径)/进化树/新闻/HUD, 不含模拟逻辑 |

## 2. 状态空间

**全局**: `day` `dna`(整数) `dnaPool`(小数累积) `owned/paid/mutated`(节点三表) `traits`(性状字典) `cure{progress,workRequired,spent}` `globallyAware` `news[≤400]` `stats{totalInfectedEver,peakInfected,daysAware}` `gameOver{win,reason,day}` · v2 扩展: `plagueTypeGui` `difficulty` `gm`(基因修正) `scenarioRules` `autoLethality`(生物武器) `killCodeUses`(纳米) `plagueOwned`(解药方场景的敌方瘟疫)

**每国**: `healthy/infected/dead`(人口三仓) `pop0` `detected` `daysSinceDetect` `airOpen/seaOpen/landOpen`(边境) `localInfMod`(政府压制) `researchAlloc`(拨款) `actions{}` `firstInfectedDay`

**网络**: 航线/海路来自 `routes.json`(`air_routes`/`ocean_routes` 键值对, 121 条); 陆路 85 对 = 阶段0 由国家索引图 4-邻域扫描派生的 `land_adjacency.json` × `land_routes_mult(101)` × `LAND_ROUTE_SCALE(0.001)`

## 3. 每日模拟管线 (`tick()`, 一天一调)

```
1 检出     每国: infected ≥ max(DETECT_MIN=9, pop0×2e-7) → detected, 发新闻;
           任一国检出 → globallyAware(解药开始)
2 本国传播 newInf = β·I·S/N + corpse_transmission×0.02·D·S/N   (β 见 §4.2)
           deaths  = I × mortalityFor()                        (见 §4.3)
3 跨国传播 每条路线双向 routeFlow(); flow<1 时按概率播种 1 例
4 政府     每国每天至多一个动作, 按 trigger_local_priority 阶梯(见 §4.5)
5 解药     power = Σ国家研究力 × awareness ÷ 低效乘子 × 数据乘子(见 §4.6)
5b 生物武器 autoLethality += BIO_RAMP×压缩因子 (见 §4.8)
6 突变     P = MUTATION_RATE × mutation点 × 难度; 命中→随机可进化症状节点免费获得
6b 风味新闻 每 18-40 天从 35 条已校验 l10n 标题抽一条
7 DNA 收入 蓝(时间)+橙(感染)+红(死亡)三流, 小数池累积取整(见 §4.7)
8 终局     灭绝/根除/解药完成/场景条件(见 §4.9)
```

## 4. 核心公式

### 4.1 性状聚合 (model.js, 数据精确)

```
traits₀ ← 疾病 global 块:  global_infectiousness/severity/lethality
         + 17 个 TRAIT_KEYS(poverty/urban/hot/humid/air_transmission/…)
         + cure_research_rate_mult = cure_requirement_base_multipler(保留原拼写错误, 缺省 1)
每拥有节点: traits += 节点 change_to_*(退化则 −), 三主属性 + 17 键全覆盖
基因修正:  traits += gm.traitAdds(见 §7)
```

### 4.2 本国传播率 β (`betaFor`)

```
effInf = max(0.5, BASE_SEED(4) + infectiousness + localInfMod [+解药方 infMod])
att    = clamp(1 + Σ 国家flag×同名列性状, 0.55, 4.0)        ← model.attributeMultiplier
         例: 基础细菌(poverty1/urban1/rural1/humid1/arid1/hot.1/cold.1/wealthy0)
             贫穷+乡村+炎热国 = 1+1+1+0.1 = 3.1× ; 富裕温带国 = 1.0×
med    = 1/(1+w),  w = medical_capacity × budget/10000 × 600 × 难度med × 场景medical
         (仅该国已检出后生效 — 检出前无防疫)
β      = 0.035 × effInf^1.0 × att × med × plagueBetaScale     上限 4.0
plagueBetaScale = 场景spreadMult | 朊毒体慢热×(0.45→1.0, 200天线性) | 零号国基因nexus×1.35
```

### 4.3 死亡率 (`mortalityFor`)

```
pts  = effLethality = 树lethality + autoLethality(生物武器); pts≤0 → 0
save = clamp(medical_capacity/0.002, 0, 1) × 0.45 × 难度med × 场景mult   (≤0.9)
μ    = 0.0014 × pts^1.05 × (1 − save)      每日, 只作用于已检出后的医疗拯救
```

### 4.4 跨国流动 (`routeFlow`, 双向)

```
closed = 任一端该类边境关闭 → flow × borderLeak(默认 0; Suppression 基因=0.5)
frac   = A.infected/(A.healthy+A.infected)
flow   = 0.06 × 路线权重w × routeMult(kind) × frac × B.healthy × leak
routeMult(kind) = clamp(global_*_rate × (1 + 同类传播点×0.012), 0.05, 4.0)
flow < 1 → 以 flow 为概率播种 1 例(首例概率化, 与原作"何时跳出国"的不确定性对应)
端点能力以 routes.txt 为权威: papua port=0 但有真实海路; airport/port 标志只门控政府行为与 UI
```

### 4.5 政府行为 (govactions_standard 43 条, 数据驱动)

资格条件字段(全部来自表): `condition_has_airport/port` `condition_local_infected_percent` `condition_global_infected_percent` `condition_population_dead` `condition_disease_severity`(对 effSeverity) `condition_action_taken/not_taken`(依赖链) `condition_random`(概率门)
- 概率门动作: P = condition_random × ramp, ramp = 1+0.05×daysSinceDetect(≤8, 仅 random_increase_flag)
- 无概率门动作走**优先级阶梯**: 只有排在自己前面(priority 更小)且硬条件满足的动作都已执行, 才允许
- 执行效果: `change_air/sea/land_borders`<0 → 关对应边境; `change_local_infectiousness` → localInfMod; `change_research_allocation` → researchAlloc; `news_flag`+`news_content` → 新闻
- 表可选: 场景可换 `govactions_neurax`(桌游)或整表内嵌(黑死病); 7 标准瘟疫共用 standard 表(原作亦无专属表)
- 洗牌定序用独立 `Rng(0x5eed)`, 不消耗游戏随机流 → 存档回放一致

### 4.6 解药研究 (`cureResearchPerDay`)

```
awareness = clamp(0.5 + effSeverity×0.01 + 全死率×4 + 全染率×1, 0.5, 3.0)
power = Σ_countries [ (budget/10000)×(1+0.5×wealthy) × capacity × (0.2 + researchAlloc) ]
         capacity = (healthy + 0.35×infected)/pop0        ← 疫情摧毁研究力量
power ×= awareness ÷ (1+research_inefficiency_multiplier[数据])
       × cure_research_rate_mult[数据: 朊毒体0.2/生物0.18/纳米1.45]
       × 难度med × (解药方场景: cureBoost×2)
进度 += power / workRequired;  workRequired = 9000 × (1+cure_base_multiplier[数据])
纳米终止码: 清零 progress, workRequired ×1.7^已用次数
里程碑 25/50/75% 新闻; ≥100% → 终局(解药方=胜, 瘟疫方=败)
```

### 4.7 DNA 经济

```
开局: 9 + 基因bonus_dna(ATP Boost +8)
蓝流: 每3天 +1 (+基因blue_bubble_bonus_dna)
橙流: 每新感染 ×1.6e-8 × 基因orangeMult      (小数入 dnaPool 累积)
红流: 每死亡   ×1.1e-8 × 基因redMult
三流同乘难度dna(简单1.25/困难0.8); dnaPool≥1 取整入账
购节点: cost = ⌈|data.cost| × (1+0.03×已进化数)⌉   (Stasis 基因冻结对应类别通胀)
退化:   返还 ⌊实付×0.8⌋ + 基因devolveAdd(Ionised Helix +2); 突变所得节点退还 0
新国家首染: +2 爆发
```

### 4.8 七瘟疫差异化 (★=数据精确, ◆=校准近似)

| 瘟疫 | 机制 | 来源 |
|---|---|---|
| 细菌 | 基线, 无专属机制 | ★global 块 |
| 病毒 | 突变率 ×4 | ★traits.mutation=2 vs 0.5, 62天/突变(校准后) |
| 真菌 | 跨国率≈0(global_*_rate=0.0001); 孢子爆发/喷发链立即感染 N 个新国家 | ★rate + ★change_to_spore_counter |
| 寄生虫 | 症状隐蔽: effSeverity ×0.85(只影响政府感知, 不改数据severity) | ◆+★共生树内 −3/−6/−9 severity |
| 朊毒体 | 解药研究 ×0.2; 慢热: β×(0.45→1.0, 200 天) | ★multipler + ◆慢热曲线 |
| 纳米病毒 | 第 0 天全球知晓(cure_research_rate_mult=1.45); 终止码: 32 DNA 清解药, 每次需求×1.7 | ★ + ◆终止码常数 |
| 生物武器 | 致命性自增: +0.012/天(压缩基因 0/1/2/3 级 ×1/0.62/0.34/0.12), 上限 55 | ◆+★gene_compression_counter |

### 4.9 终局判定

| 结局 | 条件 | 胜负(瘟疫方视角) |
|---|---|---|
| extinction | healthy+infected ≤ 0.5 | 胜(解药方场景=败) |
| eradicated | 曾感染>1 且 infected≤0.5 且 dead>0 | 败 |
| cure_complete | cure.progress ≥ 1 | 败(解药方场景=胜) |
| ubiquity | 场景: 58 国全部 firstInfectedDay≥0 | 胜(桌游, 730 天限期) |
| time_limit | 场景期限到 | 败 |

## 5. 存档/读档 (v2)

序列化: 国家 12 字段缩写 + RNG**流位置**(`rng.getState()`=mulberry32 内部态) + 节点三表 + cure + v2 全部扩展字段 + 新闻尾 60 条。v1 存档缺字段按默认回填仍可玩。node 断言: 逐字段恢复、续跑 60 天与不存档完全一致、v1 兼容。

## 6. 随机性与可复现

mulberry32(种子默认 20260101, UI 用 Date.now()&0xffff); 随机消费点: 跨国首例概率播种 / 政府概率门 / 突变命中与节点抽取 / 孢子目标洗牌 / 风味新闻抽取 / 开局零号国(未指定时)。政府表定序用独立种子流, 不影响回放。

## 7. 基因字段映射 (genes.js, 95 基因 → 5 槽)

| genes.json 字段 | 引擎效果 | 精确性 |
|---|---|---|
| bonus_dna | 开局 DNA +v | ★ |
| blue_bubble_bonus_dna | 蓝流 +v/次 | ★ |
| bonus_arid/humid/rural/urban, bonus_air/land/sea_transfer | 对应性状 +v | ★ |
| mutation_chance | mutation +v(可被 Creationist 压到 0) | ★ |
| change_to_cure_base_multiplier | 解药工作量 +v | ★ |
| orange/red_bubble_mult | 橙/红流 ×(1+0.25v)(Cytochrome Surge 4→×2) | ◆连续流近似 |
| devolve_dna_add | 每次退化 +v(Ionised Helix +2) | ★ |
| s/a/t_cost_increase | 对应类别成本通胀冻结(Stasis) | ◆ |
| closed_borders_spread_enhance | 封锁边境仍泄漏 50% | ◆ |
| nexus_bonus | 零号国 β×1.35 | ◆ |
| t/a_random_mutations | 突变池扩到传播/能力节点 | ★ |
| bubble_autopress / devolve_stop_increase | 本引擎无对应机制(气泡自动收取/退化不涨价), 记录为 no-op | 文档化 |

## 8. 难度与场景

难度 = {医疗效率, DNA 收益, 突变率} 三乘子: 简单 0.75/1.25/0.7 · 普通 1/1/1(恒等, 保证阶段1校准与断言不变) · 困难 1.35/0.8/1.5
场景规则(`scenarioRules`): `medicalMult`(黑死病前现代医疗)、`noGovActions`+`spreadMult 0.03`(桌游: 无防疫+棋盘分销慢)、`cureMode`(反向玩法: 玩家拥有 cure 树, research ×cureBoost×2, 敌方瘟疫每 60 天强制突变一症状)、`winMode:'ubiquity'`+`timeLimitDays:730`

## 9. 近似与差异(如实)

1. 全局动力学常数(SPREAD_RATE/DEATH_SCALE/CURE_WORK/ROUTE_K 等)为校准值, 平衡目标=10 局快进终局天数分布合理; **节点/国家/基因级数值全部数据精确**
2. `cost_change_*` 动态成本未实现 → 统一 3%/节点通胀近似
3. 新闻播报: events.json 无事件→文案机器映射结构, 用 35 条人工挑选(∈events ∧ ∈l10n 双校验)
4. 解药方场景简化(cure.json 多数字段提取为空对象), 研究力 ×2 补偿
5. 桌游胜利=ubiquity+期限(原作为销量模型), 两条场景校准见 §8
6. 橙/红气泡为连续流(原作为离散气泡点击), 基因乘子按 0.25 比例折算
7. 尸体传播系数 0.02、检出阈值(9 例或 2e-7 人口)为校准
8. **勘误(修复记录)**: 终止码 ×1.7 惩罚在 2026-11-16 审计中发现原实现失效——惩罚只写在 launchKillCode 里, 而 tick() 每日以不含该项目的 cureWorkRequired() 覆写 workRequired, 惩罚从未进入进度分母。已修: 惩罚项移入 cureWorkRequired() 本体(`×1.7^已用次数`), launchKillCode 去除重复乘法; 端到端验证 9000→15300(×1.7) 经 10 天重算保持, 两次使用 26010(×1.7²); 回归 99/99

## 10. 验证方法学

- **node 断言 99 条**(js/tests/run_tests.js, 无浏览器依赖): A1-44 基线/扩散守恒/DNA 账本/性状=数据和(如 5 节点传染性 11=11)/解药代数/封锁代数/终局/存档一致性; P1-55 七瘟疫机制代数(如纳米研究力=1.45×细菌、寄生虫 ×0.85、朊毒体 ×0.2 全部精确到表达式)、基因 6 组精确值、难度乘子、场景树节点数=磁盘文件、事件映射全量校验
- **浏览器断言 34 条**: UI 层与引擎联动(树节点数=数据文件、买节点后传染性精确 +4、终止码点击后解药 22.6%→0、快进整局灭绝胜利人口守恒 8,212,708,793)
- **平衡跑 10 局**(tools/balance.js, 定种子无作弊): 7 瘟疫+3 场景全终局, 胜局 144-472 天分布; 三次调参记录: MUTATION_RATE 0.0022→0.008(病毒个性)、CUREMODE_RESEARCH_MULT 3→2(解药方挑战性)、桌游 spreadMult 0.03(期限意义)
- 存档确定性续跑、v1 兼容、1000 天长跑无 NaN

## 11. 数据字段总索引(原始字段 → 引擎行为)

| 数据文件 | 字段 → 行为 |
|---|---|
| countries.json | original_population→pop0; airport/port→政府条件+UI; wealthy/poverty/urban/rural/hot/cold/humid/arid→att 乘子; medical_budget/medical_capacity→防疫 w 与死亡拯救; importance/base_influence→(UI 提示, 未入动力学); country_center→地图渲染 |
| diseases/*.json | global 块→性状基表; 每节点 cost(取绝对值)/change_to_*/tech_requirement_and,or/grid_type/grid_position→进化; change_to_spore_counter→孢子; gene_compression_counter→生物武器; cure_requirement_base_multipler→解药速率 |
| routes.json | air_routes/ocean_routes→航线网络(权重=flow w); land_routes_mult→陆路权重 |
| land_adjacency.json | 阶段0 派生的 85 对邻接 |
| govactions_*.json | condition_*/change_*/trigger_local_priority/news_* → §4.5 |
| genes.json | §7 映射表 |
| events.json + l10n_zh.json | 风味新闻池(35 条双校验)+ 全 UI 译文 |

---
*生成于 2026-11-16 · 数值均取自部署源码引擎实测读取, 非回忆 · 平衡与断言记录见 web/tools/ 与 js/tests/*
