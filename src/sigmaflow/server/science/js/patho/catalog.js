/* ================= 虚拟病原体 · 目录与原型动力学(静态数据) =================
 * 目录 = 原型动力学(ARCH, ~24 组参数) + 条目静态特征(CAT, WHO 人类病原体
 * 全集量级)。条目不携带各自的微分方程: 动力学一律继承原型, 再由静态字段
 * (传播途径/潜伏期/宿主/媒介)做量级覆盖。每条标注保真度 tier:
 *   A = 精调参数(核心病种, 传播/病程/药物字段逐条核过教科书量级)
 *   B = 原型继承 + 量级校正(常见病原, 潜伏期/严重度/药物已对)
 *   C = 目录信息 + 定性行为(罕见病原, 动力学只到原型级)
 * 字段数值均为"教科书量级", 用于教学/训练与相对比较, 不是临床或流行病学
 * 预测 —— 页面顶部有常驻声明, 智能体工具输出也会携带 tier。
 *
 * 行字段(索引):
 *  0 id | 1 中文名 | 2 原型 ARCH key | 3 潜伏期[天min,max] | 4 严重度1-5
 *  5 BSL 生物安全等级 | 6 传播途径(| 分隔) | 7 R0 范围[lo,hi] 或 null
 *  8 储存宿主(动物/环境) | 9 媒介 | 10 治疗类别(rx key, | 分隔)
 *  11 疫苗平台 | 12 tier
 */
(() => {
  const _ = null;

  // ---------------- 原型(动力学参数族) ----------------
  // k 大类, g 基因组类型, s 基因组 kb 范围, gn 典型基因数(伪基因组图式),
  // mu 每位点每代突变供给, r 宿主内对数期复制速率(/天), pyro 致热源强度。
  const ARCH = {
    // 病毒
    v_ssRNA_p:   { k: 'virus', g: '+ssRNA',       s: [7.2, 13.5], gn: 11, mu: 3e-5, r: 1.3, pyro: 2.4 },
    v_ssRNA_n:   { k: 'virus', g: '-ssRNA',       s: [11, 16], gn: 8, mu: 9e-6, r: 1.1, pyro: 2.2 },
    v_ssRNA_seg: { k: 'virus', g: '-ssRNA 分段',  s: [10, 14], gn: 14, mu: 4e-5, r: 1.5, pyro: 3.0 },
    v_dsRNA:     { k: 'virus', g: '分段 dsRNA',   s: [16, 19], gn: 12, mu: 1e-6, r: 1.4, pyro: 2.8 },
    v_ssDNA:     { k: 'virus', g: 'ssDNA',        s: [4, 5.6], gn: 3, mu: 1e-7, r: 0.8, pyro: 1.6 },
    v_dsDNA:     { k: 'virus', g: 'dsDNA',        s: [30, 240], gn: 90, mu: 6e-8, r: 0.9, pyro: 1.8 },
    v_rtDNA:     { k: 'virus', g: 'dsDNA-RT',     s: [3.2, 3.4], gn: 4, mu: 2e-5, r: 0.35, pyro: 1.0 },
    v_rtna:      { k: 'virus', g: 'ssRNA-RT',     s: [9.2, 9.7], gn: 9, mu: 3e-5, r: 0.9, pyro: 0.8 },
    // 细菌
    b_gp:        { k: 'bacterium', g: '革兰阳性 dsDNA', s: [2.0, 3.2], gn: 2600, mu: 2e-10, r: 1.9, pyro: 2.6 },
    b_gn:        { k: 'bacterium', g: '革兰阴性 dsDNA', s: [3.2, 5.9], gn: 4200, mu: 2e-10, r: 2.1, pyro: 3.2 },
    b_cocci:     { k: 'bacterium', g: '革兰阳性球菌 dsDNA', s: [1.6, 3.6], gn: 2100, mu: 2e-10, r: 1.8, pyro: 2.2 },
    b_cocciGn:   { k: 'bacterium', g: '革兰阴性双球菌 dsDNA', s: [2.1, 2.3], gn: 2100, mu: 3e-10, r: 1.7, pyro: 2.8 },
    b_intra:     { k: 'bacterium', g: '胞内寄生 dsDNA', s: [1.0, 2.4], gn: 900, mu: 5e-10, r: 0.8, pyro: 2.0 },
    b_tb:        { k: 'bacterium', g: '胞内 分枝杆菌 dsDNA', s: [4.4, 4.4], gn: 4200, mu: 4e-10, r: 0.16, pyro: 2.0 },
    b_anaero:    { k: 'bacterium', g: '芽孢/厌氧 dsDNA', s: [2.5, 4.1], gn: 3200, mu: 9e-11, r: 1.3, pyro: 2.4 },
    b_spiro:     { k: 'bacterium', g: '螺旋体 dsDNA', s: [1.1, 1.5], gn: 1500, mu: 4e-10, r: 0.7, pyro: 1.5 },
    // 真菌
    f_yeast:     { k: 'fungus', g: '酵母 真核基因组', s: [12, 14], gn: 6000, mu: 3e-10, r: 0.9, pyro: 1.8 },
    f_mold:      { k: 'fungus', g: '丝状真菌 真核基因组', s: [29, 37], gn: 10000, mu: 3e-10, r: 1.1, pyro: 2.0 },
    f_dimorphic: { k: 'fungus', g: '双相真菌 真核基因组', s: [27, 33], gn: 9000, mu: 3e-10, r: 0.8, pyro: 2.4 },
    // 原虫
    p_apicomplexa: { k: 'protozoan', g: '顶复门 真核基因组', s: [23, 34], gn: 5400, mu: 6e-10, r: 0.85, pyro: 2.6 },
    p_flagellate:  { k: 'protozoan', g: '鞭毛虫 真核基因组', s: [28, 36], gn: 8600, mu: 6e-10, r: 0.7, pyro: 1.6 },
    p_amoeba:      { k: 'protozoan', g: '阿米巴 真核基因组', s: [12, 40], gn: 8000, mu: 6e-10, r: 0.6, pyro: 2.4 },
    p_microspora:  { k: 'protozoan', g: '微孢子虫 压缩真核基因组', s: [2.3, 25], gn: 2600, mu: 6e-10, r: 0.9, pyro: 1.4 },
    // 蠕虫
    h_nema:      { k: 'helminth', g: '线虫 真核基因组', s: [42, 90], gn: 12000, mu: 9e-10, r: 0.06, pyro: 1.2 },
    h_cestode:   { k: 'helminth', g: '绦虫 真核基因组', s: [104, 165], gn: 13000, mu: 9e-10, r: 0.05, pyro: 1.1 },
    h_trema:     { k: 'helminth', g: '吸虫 真核基因组', s: [800, 1000], gn: 14000, mu: 9e-10, r: 0.07, pyro: 1.4 },
    // 朊粒(无核酸)
    prion:       { k: 'prion', g: '蛋白质构象(无基因组)', s: [0, 0], gn: 0, mu: 0, r: 0.05, pyro: 0.6 },
  };

  // ---------------- 药物类别 ----------------
  const RX = {
    // 抗病毒
    nai: '神经氨酸酶抑制剂', m2: 'M2 离子通道抑制剂', rdrp: '聚合酶抑制剂(RdRp)',
    pol: 'DNA 聚合酶抑制剂', rt: '逆转录酶抑制剂', pi: '蛋白酶抑制剂', inst: '整合酶抑制剂',
    fus: '融合抑制剂', ifn: '干扰素', ns5: 'NS5A/NS5B 直接抗病毒', rib: '利巴韦林',
    tec: '正痘病毒抑制剂(Tecovirimat 类)', mab: '单克隆抗体', antitox: '抗毒素/抗血清',
    ivig: '免疫球蛋白', vita: '维生素A 辅助', cort: '糖皮质激素辅助(重症)',
    support: '支持治疗',
    // 抗菌
    bl: 'β-内酰胺类', blsi: 'β-内酰胺+酶抑制剂', car: '碳青霉烯类', gly: '糖肽/脂糖肽类',
    oxa: '恶唑烷酮类', mac: '大环内酯类', tet: '四环素类', ag: '氨基糖苷类', fq: '氟喹诺酮类',
    sul: '磺胺/甲氧苄啶', chl: '氯霉素', linc: '林可酰胺类', dap: '环脂肽类', str: '链阳菌素类',
    col: '多黏菌素类', mnz: '硝基咪唑类(甲硝唑)', rif: '利福霉素类', inh: '异烟肼', pza: '吡嗪酰胺',
    emb: '乙胺丁醇', tgc: '替加环素',
    // 抗真菌
    ampho: '两性霉素B(脂质体)', azole: '三唑类', echino: '棘白菌素类', flucyt: '氟胞嘧啶',
    // 抗原虫
    art: '青蒿素类(ACT)', cq: '氯喹类', mfq: '甲氟喹', pq: '伯氨喹/他非诺喹(抗复发)',
    atov: '阿托伐醌/氯胍', parom: '巴龙霉素', pent: '戊烷脒', eflor: '依氟鸟氨酸',
    suram: '苏拉明', melar: '砷剂(美拉胂醇)', nifurt: '硝呋替莫', nitaz: '硝唑尼特',
    // 抗蠕虫
    bzd: '苯并咪唑类(阿苯达唑)', praz: '吡喹酮', iver: '伊维菌素', pyr: '噻嘧啶',
    dec: '乙胺嗪(DEC)', tcbz: '三氯苯达唑',
    // 特殊
    vacx: '疫苗/暴露后预防(狂犬)', ors: '口服补液+液体管理',
    dap: '氨苯砜', clof: '氯法齐明', sb: '锑剂(葡萄糖酸锑钠)',
  };

  // ---------------- 条目 ----------------
  const CAT = [
    // ===== 病毒 · 呼吸道与冠状病毒 =====
    ['InfluenzaA', '甲型流感病毒', 'v_ssRNA_seg', [1, 4], 2, 2, 'resp', [1.2, 1.6], '水禽/猪', _, 'nai|m2', '亚单位(灭活裂解)', 'A'],
    ['InfluenzaB', '乙型流感病毒', 'v_ssRNA_seg', [1, 4], 2, 2, 'resp', [1.1, 1.4], _, _, 'nai', '亚单位(灭活裂解)', 'A'],
    ['SARS_CoV_2', '新型冠状病毒(SARS-CoV-2, 含变异株谱系)', 'v_ssRNA_p', [2, 14], 3, 3, 'resp|contact', [2.5, 8.0], '蝙蝠(中华菊头蝠)', _, 'rdrp|mab|cort(重症)', 'mRNA/灭活/重组载体', 'A'],
    ['H5N1', '高病原性禽流感 A/H5N1(溢出监控)', 'v_ssRNA_seg', [2, 9], 5, 3, 'resp|animal', _, '水禽/家禽', _, 'nai', '储备疫苗(灭活)', 'C'],
    ['H7N9', '禽流感 A/H7N9(活禽市场溢出)', 'v_ssRNA_seg', [2, 10], 4, 3, 'resp|animal', _, '家禽(活禽市场)', _, 'nai', '储备疫苗(灭活)', 'C'],
    ['Rhinovirus', '鼻病毒(普通感冒)', 'v_ssRNA_p', [0.5, 2], 1, 1, 'resp|contact', [1.4, 2.0], _, _, 'support', _, 'B'],
    ['Adenovirus', '腺病毒', 'v_dsDNA', [2, 14], 2, 2, 'resp|fecal|contact|water', _, _, _, 'support', '军口服活疫苗(4/7型)', 'B'],
    ['RSV', '呼吸道合胞病毒', 'v_ssRNA_n', [2, 8], 3, 2, 'resp|contact', [0.9, 1.5], _, _, 'mab|support', '亚单位(融合前F蛋白)', 'A'],
    ['hMPV', '人偏肺病毒', 'v_ssRNA_n', [3, 9], 2, 2, 'resp|contact', [1.0, 1.5], _, _, 'support', _, 'B'],
    ['Parainfluenza', '副流感病毒(1-4型)', 'v_ssRNA_n', [2, 7], 2, 2, 'resp|contact', _, _, _, 'support', _, 'B'],
    ['SeasonalCorona', '季节性冠状病毒(229E/NL63/OC43/HKU1)', 'v_ssRNA_p', [2, 10], 1, 2, 'resp', _, _, _, 'support', _, 'B'],
    ['MERS_CoV', '中东呼吸综合征冠状病毒', 'v_ssRNA_p', [2, 14], 4, 3, 'resp|animal', _, '单峰骆驼', _, 'rdrp|support', _, 'B'],
    ['SARS_CoV', 'SARS 冠状病毒(2002, 已无人间流行)', 'v_ssRNA_p', [2, 10], 4, 3, 'resp|contact', [2, 4], '蝙蝠', '果子狸(中间)', 'rdrp|support', _, 'C'],
    ['Bat_CoV_wild', '蝙蝠冠状病毒 RaTG13/相关(溢出风险监控)', 'v_ssRNA_p', [2, 14], 4, 3, 'animal', _, '中华菊头蝠', _, 'rdrp|support', _, 'C'],
    // ===== 病毒 · 疱疹与DNA =====
    ['HSV1', '1型单纯疱疹病毒', 'v_dsDNA', [2, 12], 2, 2, 'contact|sexual|resp', _, _, _, 'pol', '亚单位(临床开发中)', 'A'],
    ['HSV2', '2型单纯疱疹病毒', 'v_dsDNA', [2, 12], 2, 2, 'sexual|contact', _, _, _, 'pol', _, 'B'],
    ['VZV', '水痘-带状疱疹病毒', 'v_dsDNA', [10, 21], 2, 2, 'resp|contact', [3.5, 5.0], _, _, 'pol|ivig', '减毒活疫苗+重组带状疱疹亚单位', 'A'],
    ['CMV', '巨细胞病毒', 'v_dsDNA', [28, 60], 3, 2, 'blood|sexual|vertical|contact', _, _, _, 'pol|ivig', _, 'B'],
    ['EBV', 'EB 病毒(传染性单核细胞增多症)', 'v_dsDNA', [30, 50], 2, 2, 'contact|saliva', _, _, _, 'support', _, 'B'],
    ['HHV6', '人疱疹病毒6型(幼儿急疹)', 'v_dsDNA', [5, 15], 1, 2, 'resp|contact', _, _, _, 'support', _, 'B'],
    ['HHV8', '人疱疹病毒8型(Kaposi 肉瘤相关)', 'v_dsDNA', [1000, 3650], 3, 2, 'sexual|blood', _, _, _, 'support', _, 'C'],
    ['ParvoB19', '细小病毒 B19(传染性红斑)', 'v_ssDNA', [4, 21], 2, 2, 'resp|vertical|blood', _, _, _, 'support|ivig', _, 'B'],
    ['BKV', 'BK 多瘤病毒(移植后肾病)', 'v_dsDNA', [30, 1825], 3, 2, 'resp|blood|vertical(潜伏再激活)', _, _, _, 'support(降低免疫抑制)', _, 'C'],
    ['JCV', 'JC 多瘤病毒(进行性多灶性白质脑病)', 'v_dsDNA', [730, 7300], 5, 2, 'resp(潜伏再激活)', _, _, _, 'support', _, 'C'],
    // ===== 病毒 · 肠道与肝炎 =====
    ['Rotavirus', '轮状病毒', 'v_dsRNA', [1, 3], 2, 2, 'fecal', [2, 4], _, _, 'ors|support', '口服减毒活疫苗', 'A'],
    ['Norovirus', '诺如病毒', 'v_ssRNA_p', [0.5, 2], 1, 2, 'fecal|food|water', [1.3, 3.7], _, _, 'ors|support', _, 'A'],
    ['Astrovirus', '星状病毒', 'v_ssRNA_p', [1, 4], 1, 2, 'fecal', _, _, _, 'ors|support', _, 'C'],
    ['Sapovirus', '札如病毒', 'v_ssRNA_p', [1, 4], 1, 2, 'fecal', _, _, _, 'ors|support', _, 'C'],
    ['HAV', '甲型肝炎病毒', 'v_ssRNA_p', [15, 50], 2, 2, 'fecal|food|water', [1.5, 2.5], '人类/非人灵长类', _, 'support', '灭活疫苗', 'A'],
    ['HEV', '戊型肝炎病毒', 'v_ssRNA_p', [15, 60], 2, 2, 'fecal|food(猪肉/野味)', _, '猪/鹿', _, 'rib', '重组亚单位(益可宁)', 'B'],
    ['HBV', '乙型肝炎病毒', 'v_rtDNA', [60, 150], 4, 2, 'blood|sexual|vertical|iatro', [1.5, 3.5], _, _, 'rt|ifn', '重组亚单位', 'A'],
    ['HCV', '丙型肝炎病毒', 'v_ssRNA_p', [14, 84], 4, 2, 'blood|iatro', [1.5, 2.5], _, _, 'ns5', '无疫苗(直接抗病毒可治愈)', 'A'],
    ['HDV', '丁型肝炎病毒(依赖HBV)', 'v_ssRNA_p', [40, 180], 5, 2, 'blood|sexual', _, _, _, 'ifn', '借 HBV 疫苗共防', 'B'],
    // ===== 病毒 · 虫媒与出血热 =====
    ['Dengue', '登革病毒(1-4血清型)', 'v_ssRNA_p', [4, 10], 4, 2, 'vector', _, '猴(森林循环)', '伊蚊(埃及/白纹)', 'support|ors', _, 'A'],
    ['Zika', '寨卡病毒', 'v_ssRNA_p', [3, 14], 2, 2, 'vector|sexual|vertical', _, '非人灵长类', '伊蚊', 'support', _, 'B'],
    ['Chikungunya', '基孔肯雅病毒', 'v_ssRNA_p', [1, 12], 2, 2, 'vector', _, '非人灵长类', '伊蚊', 'support', _, 'B'],
    ['YellowFever', '黄热病毒', 'v_ssRNA_p', [3, 6], 4, 3, 'vector', _, '猴(森林循环)', '伊蚊(趋血蚊)', 'support', '减毒活疫苗(17D)', 'A'],
    ['JEV', '乙型脑炎病毒', 'v_ssRNA_p', [5, 15], 4, 2, 'vector', _, '猪/水鸟(扩增宿主)', '库蚊(三带喙)', 'support', '灭活+减毒(SA14-14-2)', 'A'],
    ['WNV', '西尼罗病毒', 'v_ssRNA_p', [2, 14], 3, 2, 'vector|blood', _, '鸟类(扩增)', '库蚊', 'support', _, 'B'],
    ['TBEV', '蜱传脑炎病毒', 'v_ssRNA_p', [7, 14], 4, 3, 'vector', _, '啮齿类/鹿', '硬蜱(篦子硬蜱)', 'support', '灭活疫苗', 'A'],
    ['Powassan', '波瓦生病毒(北美蜱传脑炎)', 'v_ssRNA_p', [7, 34], 4, 3, 'vector', _, '啮齿类', '硬蜱(肩突硬蜱)', 'support', _, 'C'],
    ['SLEV', '圣路易脑炎病毒', 'v_ssRNA_p', [4, 21], 3, 3, 'vector', _, '鸟类', '库蚊', 'support', _, 'C'],
    ['LaCrosse', '拉克罗斯脑炎病毒', 'v_ssRNA_n', [5, 15], 2, 3, 'vector', _, '花栗鼠/啮齿类', '伊蚊(三列伊蚊)', 'support', _, 'C'],
    ['CCHFV', '克里米亚-刚果出血热病毒', 'v_ssRNA_n', [1, 9], 5, 4, 'vector|contact|blood', _, '反刍类(羊/牛)', '璃眼蜱', 'rib', _, 'C'],
    ['RVFV', '裂谷热病毒', 'v_ssRNA_seg', [2, 6], 4, 3, 'vector|contact|food', _, '反刍类(牛/羊)', '伊蚊/库蠓', 'rib', '兽用疫苗(人用研发中)', 'C'],
    ['Oropouche', '奥罗普切病毒', 'v_ssRNA_seg', [3, 8], 2, 2, 'vector', _, '树懒/猴', '库蠓/蚋', 'support', _, 'C'],
    ['HeartlandV', '哈特兰病毒(Heartland, 蜱传)', 'v_ssRNA_seg', [1, 14], 3, 3, 'vector', _, '白尾鹿/浣熊', '孤星蜱', 'support', _, 'C'],
    ['Ebola', '扎伊尔埃博拉病毒', 'v_ssRNA_n', [2, 21], 5, 4, 'contact|blood|iatro', [1.5, 2.5], '果蝠', _, 'mab|support|ors', 'rVSV-ZEBOV 减毒活载体', 'A'],
    ['Marburg', '马尔堡病毒', 'v_ssRNA_n', [2, 21], 5, 4, 'contact|blood', _, '果蝠(埃及果蝠)', _, 'support', _, 'C'],
    ['Lassa', '拉沙病毒', 'v_ssRNA_seg', [6, 21], 4, 4, 'contact|food(污染谷物)', [1.2, 2.0], '多乳鼠', _, 'rib', _, 'B'],
    ['Junin', '胡宁病毒(阿根廷出血热)', 'v_ssRNA_n', [7, 16], 4, 4, 'contact|food', _, '玉米鼠', _, 'ivig(免疫血浆)|rib', '减毒活疫苗(Candid#1, 地方性)', 'C'],
    ['Machupo', '马丘波病毒(玻利维亚出血热)', 'v_ssRNA_n', [7, 14], 4, 4, 'contact|food', _, '大鼻草原鼠', _, '免疫血浆|support', _, 'C'],
    ['Hanta_HFRS', '汉滩/汉城病毒(肾综合征出血热)', 'v_ssRNA_n', [14, 42], 3, 3, 'aerosol|contact(鼠排泄物)', _, '黑线姬鼠/褐家鼠', _, 'support|ors', '灭活疫苗(韩/中)', 'B'],
    ['Hanta_PSN', '辛诺柏病毒(汉坦病毒肺综合征)', 'v_ssRNA_n', [9, 33], 5, 3, 'aerosol|contact', _, '鹿鼠(白足鹿鼠)', _, 'support', _, 'C'],
    ['AndesVirus', '安第斯病毒(汉坦肺综合征, 唯一人传人汉坦)', 'v_ssRNA_n', [7, 39], 5, 3, 'aerosol|contact', _, '长尾矮鼠', _, 'mab(试验)|support', _, 'C'],
    ['Nipah', '尼帕病毒', 'v_ssRNA_n', [4, 14], 5, 4, 'contact|food(椰枣汁)|resp', _, '狐蝠(狐蝠属)', '猪(扩增宿主)', 'rib|support', _, 'A'],
    ['Hendra', '亨德拉病毒', 'v_ssRNA_n', [5, 21], 5, 4, 'contact(马→人)', _, '狐蝠', '马(中间)', 'mab(试验)|support', _, 'C'],
    ['Rabies', '狂犬病毒', 'v_ssRNA_n', [30, 90], 5, 2, 'animal(咬伤)|contact', _, '犬(亚洲/非洲)/蝙蝠', _, 'vacx|mab(RIG)', '暴露前/后疫苗+免疫球蛋白', 'A'],
    // ===== 病毒 · 疫苗可预防经典 =====
    ['MeaslesVirus', '麻疹病毒', 'v_ssRNA_n', [7, 21], 3, 2, 'resp|airborne', [12, 18], _, _, 'vita|support', '减毒活疫苗(麻腮风)', 'A'],
    ['RubellaVirus', '风疹病毒', 'v_ssRNA_p', [14, 21], 2, 2, 'resp|vertical', [6, 7], _, _, 'support', '减毒活疫苗(RA27/3)', 'A'],
    ['MumpsVirus', '腮腺炎病毒', 'v_ssRNA_n', [12, 25], 2, 2, 'resp|contact', [4, 7], _, _, 'support', '减毒活疫苗(Jeryl Lynn)', 'A'],
    ['Poliovirus', '脊髓灰质炎病毒(1-3型)', 'v_ssRNA_p', [3, 35], 3, 2, 'fecal|resp|water', [2, 12], _, _, 'support', 'IPV+OPV 序贯', 'A'],
    ['CoxsackieVirus', '柯萨奇病毒(A/B型)', 'v_ssRNA_p', [2, 10], 2, 2, 'fecal|resp|contact', _, _, _, 'support', _, 'B'],
    ['Echovirus', '埃可病毒', 'v_ssRNA_p', [2, 10], 2, 2, 'fecal|resp', _, _, _, 'support', _, 'C'],
    ['EV71', '肠道病毒71型(手足口重症病原)', 'v_ssRNA_p', [3, 7], 3, 2, 'fecal|resp|contact', [0.9, 1.6], _, _, 'support', '灭活疫苗(Vero细胞)', 'B'],
    ['EnterovirusD68', '肠道病毒 D68(急性无力脊髓炎相关)', 'v_ssRNA_p', [1, 10], 2, 2, 'resp', _, _, _, 'support', _, 'C'],
    ['Smallpox', '天花病毒(已消灭·实验室封存)', 'v_dsDNA', [7, 17], 5, 4, 'resp|contact', [3.5, 6], _, _, 'tec|mab|antitox', '活疫苗(ACAM2000/复制缺陷 Jynneos)', 'C'],
    ['MpoxVirus', '猴痘病毒(分支I/II)', 'v_dsDNA', [5, 21], 3, 3, 'contact|animal|sexual', [1.0, 1.8], '啮齿类/猴', _, 'tec|mab|support', '复制缺陷活载体', 'B'],
    // ===== 病毒 · 逆转录 =====
    ['HIV1', '1型人类免疫缺陷病毒', 'v_rtna', [14, 28], 5, 2, 'sexual|blood|vertical|iatro', [1.5, 4.0], _, _, 'rt|pi|inst|fus', _, 'A'],
    ['HTLV1', '人嗜T淋巴细胞病毒1型(成人T细胞白血病/热带痉挛性截瘫)', 'v_rtna', [730, 10950], 3, 2, 'sexual|blood|vertical|母乳', _, _, _, 'ifn(试验性)+support', _, 'C'],
    // ===== 细菌 · 革兰阳性 =====
    ['S_pneumoniae', '肺炎链球菌', 'b_gp', [1, 3], 3, 2, 'resp|contact(携带)', [1.2, 1.8], '人类(鼻咽携带)', _, 'bl|mac|gly|fq', '多糖结合疫苗(PCV13)+PPSV23', 'A'],
    ['S_pyogenes', 'A群链球菌(猩红热/坏死性筋膜炎)', 'b_gp', [1, 3], 3, 2, 'resp|contact', [2, 3], '人类', _, 'bl', _, 'A'],
    ['S_agalactiae', 'B群链球菌(新生儿败血症)', 'b_gp', [0.5, 2], 4, 2, 'vertical|contact|sexual', _, '人类(阴道/肠道携带)', _, 'bl', '产时抗生素预防(IAP)+候选结合疫苗', 'B'],
    ['S_viridans', '草绿色链球菌群(亚急性心内膜炎)', 'b_gp', [1, 7], 3, 2, '自身菌群(口腔)', _, _, _, 'bl+ag', _, 'B'],
    ['S_bovis', '牛链球菌群(结肠病变相关心内膜炎)', 'b_gp', [1, 14], 3, 2, '自身菌群(肠道)', _, _, _, 'bl', _, 'C'],
    ['S_suis', '猪链球菌(养殖人员脑膜炎/败血症)', 'b_gp', [0.2, 3], 4, 2, 'animal|contact|food', _, '猪', _, 'bl|cort(重症)', '兽用疫苗', 'C'],
    ['S_aureus', '金黄色葡萄球菌(含 MRSA)', 'b_gp', [0.3, 7], 4, 2, 'contact|iatro|food|resp', [1, 2], '人类(前鼻孔携带)', _, 'blsi|gly|dap|oxa|tgc', '_? — 候选疫苗多失败, 无上市疫苗', 'A'],
    ['S_epidermidis', '表皮葡萄球菌(异物/导管相关感染)', 'b_gp', [2, 30], 2, 2, 'iatro|自身菌群', _, _, _, 'gly|rif+bl', _, 'B'],
    ['E_faecalis', '粪肠球菌', 'b_gp', [1, 7], 3, 2, '自身菌群|iatro', _, _, _, 'bl+ag|gly', _, 'B'],
    ['E_faecium', '屎肠球菌(VRE 代表)', 'b_gp', [1, 7], 3, 2, 'iatro|自身菌群', [0.9, 1.6], _, _, 'oxa|dap|str', _, 'A'],
    ['C_diphtheriae', '白喉棒状杆菌', 'b_gp', [1, 10], 4, 2, 'resp|contact|food', [2, 6], '人类', _, 'antitox|mac|bl', '类毒素疫苗(DTaP)', 'A'],
    ['Nocardia', '诺卡菌属(星形诺卡菌等)', 'b_gp', [7, 90], 3, 2, 'soil|resp|iatro', _, '土壤', _, 'sul|car', _, 'C'],
    // ===== 细菌 · 革兰阴性 =====
    ['E_coli', '大肠杆菌(肠外感染: 尿路/腹腔/血流)', 'b_gn', [0.5, 3], 3, 2, '自身菌群|iatro|food', _, '人类菌群/环境', _, 'bl|blsi|fq|car(ESBL后)', _, 'A'],
    ['E_coli_EHEC', '肠出血性大肠杆菌(O157:H7 等, STEC)', 'b_gn', [1, 10], 3, 2, 'food|water|contact', [1.5, 3.0], '反刍类(牛)', _, 'support(禁用抗生素)', _, 'A'],
    ['E_coli_ETEC', '产肠毒素大肠杆菌(旅行者腹泻)', 'b_gn', [0.5, 2], 1, 2, 'food|water', _, _, _, 'mac|fq|ors', '口服灭活全菌+LT-B 亚单位(部分批准)', 'B'],
    ['K_pneumoniae', '肺炎克雷伯菌(含 CRE/KPC)', 'b_gn', [0.5, 3], 4, 2, '自身菌群|resp|iatro', _, '人类/环境', _, 'bl|blsi|car|col', _, 'A'],
    ['P_aeruginosa', '铜绿假单胞菌', 'b_gn', [0.5, 5], 4, 2, 'hospital|water|contact', _, '环境(水/土壤, 医院水龙头)', _, 'blsi|car|ag|col|fq', '_', 'A'],
    ['A_baumannii', '鲍曼不动杆菌(CRAB)', 'b_gn', [0.5, 5], 4, 2, 'hospital|contact|env', [0.9, 1.7], '环境(医疗表面)', _, 'car|col+tgc|sul', _, 'A'],
    ['B_cepacia', '洋葱伯克霍尔德复合群(囊性纤维化肺)', 'b_gn', [1, 7], 3, 2, 'hospital|env', _, '土壤/水', _, 'sul|car|chl', _, 'C'],
    ['B_pseudomallei', '类鼻疽伯克霍尔德菌', 'b_gn', [1, 21], 5, 3, 'soil|water|contact(雨季)', _, '土壤/积水(地方性)', _, 'car(静脉)→sul(维持)', _, 'B'],
    ['S_maltophilia', '嗜麦芽窄食单胞菌', 'b_gn', [2, 7], 3, 2, 'hospital', _, '环境/水', _, 'sul|fq(部分)', _, 'C'],
    ['Serratia', '沙雷菌属(医院获得性)', 'b_gn', [1, 7], 3, 2, 'hospital', _, '环境/水', _, 'car|fq|blsi', _, 'C'],
    ['Proteus_mirabilis', '奇异变形杆菌', 'b_gn', [1, 7], 2, 2, '自身菌群|iatro', _, '环境/土壤', _, 'bl|blsi', _, 'C'],
    ['Salmonella_Typhi', '伤寒沙门菌', 'b_gn', [6, 30], 4, 2, 'food|water|fecal', [0.2, 1.0], '人类(慢性带菌者)', _, 'fq|bl(耐药后用 car)', '伤寒结合疫苗+口服 Ty21a', 'A'],
    ['Salmonella_NTS', '非伤寒沙门菌', 'b_gn', [0.25, 3], 2, 2, 'food|animal|reptile', _, '家禽/蛋/爬行类', _, 'support|mac(重危人群)', _, 'A'],
    ['Shigella', '志贺菌属(细菌性痢疾)', 'b_gn', [1, 3], 3, 2, 'fecal|contact|food|water', [1.6, 3.2], '人类', _, 'mac|fq|sul', '_', 'A'],
    ['Campylobacter', '空肠弯曲菌(禽源肠炎, GBS 诱因)', 'b_gn', [1, 7], 2, 2, 'food|water|animal', _, '家禽/野生鸟类', _, 'mac|fq', _, 'A'],
    ['H_pylori', '幽门螺杆菌', 'b_gn', [30, 7300], 3, 2, 'fecal|oral|家庭内', _, '人类', _, 'bl+mac(bismuth 四联)', _, 'A'],
    ['V_cholerae', '霍乱弧菌 O1/O139', 'b_gn', [0.1, 5], 4, 2, 'water|food|fecal', [1.0, 2.7], '水生(浮游生物黏附)', _, 'ors+mac|fq', '口服全菌灭活+重组亚单位', 'A'],
    ['V_vulnificus', '创伤弧菌(生蚝/海水伤口, 重症致死高)', 'b_gn', [0.2, 3], 5, 2, 'food(生蚝)|water(伤口)', _, '近岸海水/贝类', _, 'bl(三代头孢)+tet|cort', _, 'B'],
    ['V_parahaemolyticus', '副溶血弧菌(生海鲜肠炎)', 'b_gn', [0.2, 2], 2, 2, 'food(海鲜)', _, '近岸海/贝类', _, 'ors|support', _, 'B'],
    ['Aeromonas', '嗜水气单胞菌', 'b_gn', [0.2, 3], 2, 2, 'water|food', _, '淡水/鱼', _, 'fq|blsi', _, 'C'],
    ['Y_pestis', '鼠疫耶尔森菌(腺型/肺型)', 'b_gn', [1, 7], 5, 3, 'vector|contact|resp', [1, 3], '啮齿类(旱獭/鼠)', '蚤', 'ag|tet|fq', '灭活疫苗(高风险地区装备)', 'A'],
    ['Y_enterocolitica', '小肠结肠炎耶尔森菌', 'b_gn', [1, 11], 2, 2, 'food(猪肉)|水', _, '猪', _, 'support|fq', _, 'C'],
    ['F_tularensis', '土拉弗朗西斯菌(土拉热)', 'b_gn', [1, 14], 4, 3, 'animal|vector|aerosol(处理尸体)', _, '兔/啮齿类', '蜱/虻', 'ag(链霉素)|tet|fq', '减毒活疫苗(LVS, 有限使用)', 'B'],
    ['Brucella', '布鲁菌属(波状热)', 'b_gn', [5, 60], 4, 3, 'animal|food(生乳/奶酪)|接触', _, '牛/羊/猪/犬', _, 'tet+rif(多西环素+利福平)', '兽用疫苗(人用 S19 有限)', 'B'],
    ['C_burnetii', '贝纳柯克斯体(Q热)', 'b_intra', [14, 21], 3, 3, 'aerosol(分娩气溶胶)|生乳', _, '反刍类(牛/羊)', _, 'tet+tet(多西环素)|fq(慢性)', '灭活疫苗(Q-Vax, 澳大利亚)', 'B'],
    ['L_pneumophila', '嗜肺军团菌(冷却塔/水管气溶胶)', 'b_gn', [2, 10], 4, 2, 'water aerosol', _, '人工水系统/自由生活阿米巴', _, 'mac|fq|tet', '_', 'A'],
    ['N_meningitidis', '脑膜炎奈瑟菌(A/B/C/W/Y)', 'b_cocciGn', [1, 10], 5, 2, 'resp|contact', [1.2, 1.7], '人类(鼻咽携带)', _, 'bl(青霉素/三代头孢)+sul(密切接触预防)', '四价多糖结合+B 群蛋白疫苗', 'A'],
    ['N_gonorrhoeae', '淋病奈瑟菌', 'b_cocciGn', [1, 14], 3, 2, 'sexual', [1, 2], '人类', _, 'bl(三代头孢)+mac(双药, 耐药严峻)', _, 'A'],
    ['H_influenzae_b', 'b型流感嗜血杆菌(脑膜炎/会厌炎)', 'b_cocciGn', [1, 4], 4, 2, 'resp|contact', _, '人类', _, 'bl(三代)|sul(预防)', 'Hib 结合疫苗', 'A'],
    ['Moraxella', '卡他莫拉菌', 'b_cocciGn', [2, 7], 1, 2, 'resp(自身携带)', _, '人类', _, 'mac|blsi(产酶率高)', _, 'B'],
    ['B_pertussis', '百日咳鲍特菌', 'b_gn', [5, 21], 3, 2, 'resp', [12, 17], '人类', _, 'mac(阿奇霉素)', '无细胞亚单位(DTaP/Tdap)', 'A'],
    ['B_parapertussis', '副百日咳鲍特菌', 'b_gn', [7, 14], 2, 2, 'resp', [3, 7], '人类', _, 'mac', _, 'C'],
    ['Capnocytophaga', '犬咬二氧化碳嗜纤维菌(犬咬败血症)', 'b_gn', [0.5, 7], 4, 2, 'animal(犬/猫咬)', _, '犬/猫口腔菌群', _, 'bl(青霉素)|blsi', _, 'C'],
    ['Pasteurella', '多杀巴氏杆菌', 'b_gn', [0.1, 3], 2, 2, 'animal(咬/抓)', _, '犬/猫口腔', _, 'bl(阿莫西林克拉维酸)', _, 'B'],
    ['HACEK', 'HACEK 菌群(口咽, 心内膜炎)', 'b_gn', [7, 60], 3, 2, '自身菌群(口咽)', _, _, _, 'bl(三代头孢)', _, 'C'],
    // ===== 细菌 · 厌氧/胞内/螺旋体/分枝杆菌 =====
    ['C_difficile', '艰难梭菌(抗生素相关腹泻)', 'b_anaero', [0.4, 10], 4, 2, 'fecal|孢子(环境)|iatro', [1, 2], '环境孢子/人类菌群', _, 'gly(口服)|fidaxomicin|mab(贝洛托珠单抗)', _, 'A'],
    ['C_perfringens', '产气荚膜梭菌(气性坏疽/食源)', 'b_anaero', [0.2, 1.5], 3, 2, 'food|soil(伤口)|iatro', _, '土壤/肠道菌群', _, 'bl+antitox|cort(外科)', _, 'B'],
    ['C_tetani', '破伤风梭菌', 'b_anaero', [3, 21], 5, 2, 'soil(污染伤口)', _, '土壤/动物粪便', _, 'antitox(TIG)|mnz', '类毒素疫苗', 'A'],
    ['C_botulinum', '肉毒梭菌(食物/婴儿/伤口型)', 'b_anaero', [0.2, 3], 5, 2, 'food|伤口|肠道(婴儿蜂蜜)|iatro', _, '土壤', _, 'antitox(马血清三价)', _, 'A'],
    ['Bacteroides', '脆弱拟杆菌群(腹腔/盆腔感染)', 'b_anaero', [1, 7], 3, 2, '自身菌群|fecal|iatro(术后)', _, '肠道菌群', _, 'mnz+blsi', _, 'B'],
    ['Fusobacterium', '坏死梭杆菌(Lemierre 综合征)', 'b_anaero', [2, 14], 3, 2, '自身菌群(口咽)', _, _, _, 'bl+mnz', _, 'C'],
    ['Actinomyces', '以色列放线菌(面颈部放线菌病)', 'b_anaero', [14, 180], 3, 2, '自身菌群(口腔)', _, _, _, 'bl(长程)|tet', _, 'C'],
    ['B_anthracis', '炭疽芽孢杆菌', 'b_anaero', [1, 7], 5, 3, 'animal|contact|aerosol|food', _, '食草动物/土壤芽孢', _, 'fq|tet|bl(静脉)+mab(Raxibacumab)', '亚单位疫苗', 'B'],
    ['M_tuberculosis', '结核分枝杆菌', 'b_tb', [30, 3650], 5, 3, 'resp|contact', [1, 4], '人类(牛型: 牛)', _, 'inh+ Rif + pza+emb±fq(耐药)', 'BCG(儿童重症保护)', 'A'],
    ['M_leprae', '麻风分枝杆菌', 'b_tb', [180, 3650], 4, 2, 'contact(长期)|droplet', _, '人类/犰狳', _, 'dap+rif+clof(联合化疗)', _, 'B'],
    ['M_avium', '鸟胞内分枝杆菌复合群(MAC)', 'b_tb', [30, 1095], 3, 2, 'env(水/土壤)|resp(免疫低下)', _, '环境', _, 'mac+ Rif +emb', '_', 'B'],
    ['M_abscessus', '脓肿分枝杆菌(快速生长, 高耐药)', 'b_tb', [7, 90], 3, 2, 'env water|iatro', _, '环境/水系统', _, 'ag+mac+tgc(药敏指导)', _, 'C'],
    ['C_trachomatis', '沙眼衣原体(A-K, 含 LGV)', 'b_intra', [7, 21], 3, 2, 'sexual|contact|vertical', [1, 2], '人类', _, 'mac|tet', '_', 'A'],
    ['C_pneumoniae', '肺炎衣原体', 'b_intra', [7, 28], 2, 2, 'resp', _, '人类', _, 'mac|tet', _, 'B'],
    ['C_psittaci', '鹦鹉热衣原体', 'b_intra', [5, 19], 3, 2, 'animal(鸟类气溶胶)', _, '鹦鹉/鸽/家禽', _, 'tet|mac', '_', 'B'],
    ['M_pneumoniae', '肺炎支原体(非典型肺炎)', 'b_intra', [10, 28], 2, 2, 'resp', [1, 3], '人类', _, 'mac|tet|fq', _, 'A'],
    ['Ureaplasma', '解脲脲原体', 'b_intra', [7, 28], 1, 2, 'sexual|vertical', _, '人类', _, 'mac|tet', _, 'C'],
    ['R_rickettsii', '立氏立克次体(落基山斑点热)', 'b_intra', [2, 14], 5, 3, 'vector', _, '啮齿类/犬', '硬蜱(变异革蜱)', 'tet', '_', 'A'],
    ['R_typhi', '斑疹伤寒立克次体(鼠型斑疹伤寒)', 'b_intra', [6, 14], 3, 3, 'vector', _, '鼠类', '印鼠客蚤', 'tet', _, 'B'],
    ['O_tsutsugamushi', '恙虫东方体(恙虫病)', 'b_intra', [6, 21], 4, 3, 'vector', _, '啮齿类', '恙螨(纤恙螨)', 'tet', _, 'B'],
    ['E_chaffeensis', '查菲埃立克体(单核细胞埃立克体病)', 'b_intra', [1, 21], 3, 2, 'vector', _, '白尾鹿/犬', '肩突硬蜱', 'tet', _, 'C'],
    ['A_phagocytophilum', '嗜吞噬细胞无形体(HGA)', 'b_intra', [1, 14], 2, 2, 'vector', _, '啮齿类/鹿', '硬蜱', 'tet', _, 'C'],
    ['B_henselae', '汉赛巴通体(猫抓病/杆菌性血管瘤)', 'b_intra', [3, 14], 2, 2, 'animal(猫抓)|vector(蚤)', _, '猫', '猫蚤', 'mac|support', _, 'B'],
    ['B_bacilliformis', '杆状巴通体(Oroya 热/秘鲁疣)', 'b_intra', [14, 120], 3, 2, 'vector', _, '人类(储存)', '白蛉(罗蛉)', 'bl+ag', _, 'C'],
    ['T_pallidum', '苍白密螺旋体(梅毒)', 'b_spiro', [10, 90], 4, 2, 'sexual|vertical|contact', [1, 2], '人类', _, 'bl(苄星青霉素)', '_', 'A'],
    ['T_pertenue', '极细密螺旋体(雅司/地方性梅毒)', 'b_spiro', [14, 120], 2, 2, 'contact(皮肤)', _, '人类(热带潮湿)', _, 'bl(阿奇霉素方案)', _, 'C'],
    ['B_burgdorferi_sl', '伯氏疏螺旋体 sensu lato(莱姆病)', 'b_spiro', [3, 30], 3, 2, 'vector', _, '白足鼠/鹿(储存/喂养)', '硬蜱(肩突)', 'tet(多西)|bl(阿莫)', '历史上 OspA 疫苗已退市, 新候选在研发', 'A'],
    ['B_miyamotoi', '宫本疏螺旋体(蜱传回归热样)', 'b_spiro', [7, 21], 2, 2, 'vector', _, '啮齿类', '硬蜱', 'tet', _, 'C'],
    ['B_recurrentis', '回归热疏螺旋体(虱传回归热)', 'b_spiro', [2, 18], 3, 2, 'contact(体虱流行时)', _, '人类', '体虱', 'tet(警惕 Jarisch-Herxheimer)', _, 'C'],
    ['Leptospira', '钩端螺旋体属', 'b_spiro', [2, 29], 4, 2, 'water|soil|animal(洪水后)', _, '鼠/犬/牛(尿液)', _, 'bl|tet|mac', '兽用疫苗(人用有限)', 'A'],
    // ===== 真菌 =====
    ['Candida_albicans', '白念珠菌', 'f_yeast', [2, 60], 3, 2, '自身菌群|iatro|contact', _, '人类菌群', _, 'azole|ampho|echino', '_', 'A'],
    ['Candida_auris', '耳念珠菌(多重耐药·院感)', 'f_yeast', [2, 60], 4, 2, 'hospital|contact|env surface', [1, 2], '环境(医疗表面/医疗水)', _, 'echino±ampho(药敏)', _, 'A'],
    ['Candida_other', '非白念珠菌(光滑/近平滑/热带)', 'f_yeast', [2, 60], 3, 2, '自身菌群|iatro', _, _, _, 'echino|azole(光滑常耐药)', _, 'C'],
    ['Cryptococcus', '隐球菌(新型/格特)', 'f_yeast', [7, 120], 4, 2, 'inh(环境)', _, '土壤/鸽粪/桉树', _, 'ampho+flucyt→azole 维持', _, 'A'],
    ['Aspergillus', '烟曲霉复合群(侵袭性肺曲霉病)', 'f_mold', [1, 14], 4, 2, 'inh(分生孢子)', _, '环境(腐烂有机物)', _, 'azole|ampho|echino', '_', 'A'],
    ['Mucorales', '毛霉目(根霉/毛霉/犁头霉)', 'f_mold', [1, 30], 5, 2, 'inh|外伤(土壤)', _, '环境(土壤/腐物)', _, 'ampho(脂质体)+外科清创', _, 'B'],
    ['Scedosporium', '赛多孢/足放线病菌', 'f_mold', [2, 30], 4, 2, 'inh|env(污水/溺水后)', _, '环境', _, 'azole(伏立康唑)+外科', _, 'C'],
    ['Fusarium', '镰刀菌属', 'f_mold', [2, 30], 4, 2, 'inh|contact|水系统', _, '环境中(植物/水)', _, 'ampho|azole(耐药普遍)', _, 'C'],
    ['Dermatophytes', '皮肤癣菌(毛癣菌/小孢子菌/表皮癣菌)', 'f_mold', [7, 60], 1, 1, 'contact|fomites|animal', [1, 2], '人类/犬猫/土壤', _, 'azole(口服)+外用', _, 'B'],
    ['Histoplasma', '组织胞浆菌', 'f_dimorphic', [3, 17], 3, 3, 'inh(分生孢子)', _, '蝙蝠/鸟粪污染土壤', _, 'azole|ampho(重症)', _, 'B'],
    ['Coccidioides', '粗球孢子菌(山谷热)', 'f_dimorphic', [7, 28], 3, 3, 'inh(关节孢子)', _, '干旱碱性土壤(西南美)', _, 'azole|ampho', '_', 'B'],
    ['Blastomyces', '皮炎芽生菌', 'f_dimorphic', [30, 90], 3, 3, 'inh', _, '潮湿土壤/朽木(河谷)', _, 'azole|ampho', _, 'C'],
    ['Paracoccidioides', '巴西副球孢子菌', 'f_dimorphic', [30, 1800], 3, 3, 'inh(慢性)', _, '土壤(拉美)', _, 'azole|sul', _, 'C'],
    ['Talaromyces', '马尔尼菲篮状菌(竹鼠相关, HIV 者重症)', 'f_dimorphic', [7, 90], 4, 3, 'inh|animal(竹鼠)', _, '土壤/竹鼠', _, 'ampho→azole 维持', _, 'C'],
    ['Sporothrix', '申克孢子丝菌(孢子丝菌病)', 'f_dimorphic', [7, 90], 2, 2, 'contact(玫瑰刺/外伤)|animal(猫)', _, '土壤/植物', _, 'azole(伊曲康)|ampho', _, 'C'],
    ['Pneumocystis', '耶氏肺孢子虫(PJP)', 'f_yeast', [7, 60], 4, 2, 'inh(人际)', _, '人类(携带)', _, 'sul|pent|cort', '_', 'A'],
    // ===== 原虫 =====
    ['P_falciparum', '恶性疟原虫', 'p_apicomplexa', [9, 30], 5, 2, 'vector|blood(输血)', _, '人类(蚊-人循环)', '按蚊', 'art', 'RTS,S/R21(部分保护)', 'A'],
    ['P_vivax', '间日疟原虫(肝内休眠子复发)', 'p_apicomplexa', [12, 180], 3, 2, 'vector|blood', _, '人类', '按蚊', 'cq(敏感区)|art+pq(抗复发)', _, 'A'],
    ['P_malariae', '三日疟原虫(低 parasitaemia 慢性)', 'p_apicomplexa', [18, 40], 2, 2, 'vector|blood', _, '人类', '按蚊', 'cq|pq', '_', 'B'],
    ['P_ovale', '卵形疟原虫(休眠子复发)', 'p_apicomplexa', [12, 180], 2, 2, 'vector|blood', _, '人类', '按蚊', 'cq+pq', _, 'B'],
    ['P_knowlesi', '诺氏疟原虫(猴疟, 溢出感染)', 'p_apicomplexa', [9, 14], 3, 2, 'vector|zoonotic', _, '猕猴/叶猴', '白踝按蚊', 'art', _, 'B'],
    ['Babesia', '微小巴贝虫(输血/蜱传)', 'p_apicomplexa', [7, 28], 2, 2, 'vector|blood', _, '白足鼠', '肩突硬蜱', 'atov+mac(阿奇)|fq+bl?(用quinine+clinda 重症)', _, 'C'],
    ['Toxoplasma', '刚地弓形虫', 'p_apicomplexa', [7, 25], 3, 2, 'food(含包囊肉/菜)|vertical|animal(猫粪卵囊)', _, '猫科(终末)/温血动物', '_', 'sul+pyrimethamine(乙胺嘧啶)', '_? 候选疫苗无上市', 'A'],
    ['Cryptosporidium', '隐孢子虫', 'p_apicomplexa', [2, 10], 2, 2, 'water|fecal|swim(泳池)', [1.5, 2.8], '牛/人类', _, 'nitaz|support(AIDS 患者靠 ART)', _, 'B'],
    ['Cystoisospora', '环孢子虫/等孢球虫', 'p_apicomplexa', [2, 14], 2, 2, 'food(生鲜农产)|water', _, '人类/产地污染', _, 'sul|nitaz', _, 'C'],
    ['Leishmania_visc', '内脏利什曼原虫(杜氏/婴儿利什曼, 黑热病)', 'p_flagellate', [30, 180], 5, 2, 'vector', _, '犬/野生动物/人类', '白蛉', 'ampho(脂质体)|miltefosine', '_', 'A'],
    ['Leishmania_cut', '皮肤利什曼原虫(热带/硕大/墨西哥利什曼)', 'p_flagellate', [14, 90], 2, 2, 'vector', _, '沙鼠/野生动物/人类', '白蛉', 'sb(局部/全身)|support(热疗)', _, 'B'],
    ['T_brucei', '布罗氏锥虫病 非洲昏睡病(T. b. gambiense/rhodesiense)', 'p_flagellate', [7, 60], 5, 2, 'vector', _, '人类(gambiense)/羚羊牛(rhodesiense)', '采采蝇(舌蝇)', 'suram(血期)|eflor·melar(脑期)', '_', 'B'],
    ['T_cruzi', '克氏锥虫(查加斯病)', 'p_flagellate', [7, 3650], 4, 2, 'vector|blood|vertical|food(果汁)', _, '犬/负鼠/啮齿(森林循环)', '锥蝽(猎蝽)', 'benznidazole|nifurt(硝呋替莫)', '_', 'B'],
    ['Giardia', '兰氏贾第鞭毛虫', 'p_flagellate', [7, 25], 2, 2, 'water|fecal|backcountry', [1.5, 2.5], '海狸/犬/人类', _, 'mnz(甲硝唑)|nitaz', '_', 'A'],
    ['Dientamoeba', '脆双核阿米巴', 'p_flagellate', [1, 60], 1, 2, 'fecal(可能与蛲虫共传播)', _, '人类', _, 'mnz|parom', _, 'C'],
    ['Trichomonas', '阴道毛滴虫', 'p_flagellate', [4, 28], 1, 2, 'sexual', [1, 2], '人类', _, 'mnz|替硝唑', _, 'A'],
    ['E_histolytica', '溶组织内阿米巴(阿米巴痢疾/肝脓肿)', 'p_amoeba', [7, 28], 3, 2, 'water|food|fecal', _, '人类', _, 'mnz+parom(腔内清除)', '_', 'A'],
    ['Naegleria', '福氏耐格里阿米巴(原发性阿米巴脑膜脑炎)', 'p_amoeba', [1, 7], 5, 2, 'water(淡水鼻侵入)', _, '温水湖泊/土壤/热水系统', _, 'ampho+mnz+支持(试验性)', _, 'C'],
    ['Acanthamoeba', '棘阿米巴(角膜炎/肉芽肿性脑炎)', 'p_amoeba', [7, 90], 3, 2, 'water|contact(隐形眼镜)', _, '环境(土壤/自来水)', _, 'support(氯己定+丙脒局部)', _, 'C'],
    ['Blastocystis', '人芽囊原虫(致病性有争议)', 'p_amoeba', [1, 14], 1, 2, 'fecal|water|food', _, '人类/动物', _, 'mnz(症状性时)', _, 'C'],
    ['Microsporidia', '微孢子虫(肠脑炎微孢子虫属)', 'p_microspora', [7, 30], 3, 2, 'fecal|food|water|吸入', _, '动物/环境', _, 'bzd|fumagillin', _, 'C'],
    // ===== 蠕虫 =====
    ['Ascaris', '似蚓蛔线虫(蛔虫)', 'h_nema', [60, 70], 1, 2, 'fecal|food(土壤储存卵)', [1.2, 1.8], '人类(土壤存卵多年)', _, 'bzd|pyr', '_', 'A'],
    ['Hookworm', '钩虫(十二指肠钩虫/美洲钩虫)', 'h_nema', [28, 70], 2, 2, 'soil(丝状蚴穿皮)|fecal', _, '人类/土壤', _, 'bzd|pyr', _, 'A'],
    ['Trichuris', '毛首鞭形线虫(鞭虫)', 'h_nema', [30, 90], 2, 2, 'fecal|soil|food', _, '人类', _, 'bzd|iver', '_', 'B'],
    ['Enterobius', '蠕形住肠线虫(蛲虫)', 'h_nema', [10, 21], 1, 2, 'fecal(虫卵)|fomites|自身感染', [1.5, 3.0], '人类', _, 'bzd|pyr|iver(全家同治)', _, 'A'],
    ['Strongyloides', '粪类圆线虫(可自身感染·免疫抑制时超感染)', 'h_nema', [14, 60], 3, 2, 'soil(穿皮)|自身感染', _, '人类/土壤/犬', _, 'iver(首选)|bzd', '_', 'B'],
    ['Trichinella', '旋毛形线虫(旋毛虫病)', 'h_nema', [1, 21], 3, 2, 'food(未熟猪肉/野味)', _, '猪/野猪/熊(肌肉包囊)', _, 'bzd+cort(重症)', _, 'B'],
    ['Toxocara', '犬/猫弓首线虫(幼虫移行症 VLM/OLM)', 'h_nema', [14, 90], 2, 2, 'soil(食入卵)|animal', _, '犬/猫(肠道)', _, 'bzd+cort(眼型)', _, 'B'],
    ['Angiostrongylus', '广州管圆线虫(嗜酸性脑膜脑炎)', 'h_nema', [7, 35], 3, 2, 'food(螺/蜗牛/虾/蛞蝓汁)', _, '鼠(终末)/螺蛳(中间)', _, 'support(腰穿减压)±bzd', _, 'B'],
    ['Gnathostoma', '棘颚口线虫(皮肤/内脏幼虫移行)', 'h_nema', [7, 30], 2, 2, 'food(生鱼/蛙/蛇)', _, '犬猫(终末)/桡足类(中间)', _, 'bzd±外科', _, 'C'],
    ['Anisakis', '简单异尖线虫(生鱼片胃/肠蛔蚴病)', 'h_nema', [0.04, 7], 1, 2, 'food(生海鱼/鱿鱼)', _, '鲸豚(终末)/海鱼(第三期幼虫)', _, '内镜取出±bzd', _, 'C'],
    ['Dirofilaria', '犬恶丝虫(人皮下/肺结节, 偶发)', 'h_nema', [60, 180], 1, 2, 'vector(蚊)', _, '犬(终末)', '蚊(库蚊/伊蚊)', 'support(手术摘除)', _, 'C'],
    ['Dracunculus', '麦地那龙线虫(几内亚蠕虫, 濒临消灭)', 'h_nema', [350, 400], 2, 2, 'water(剑水蚤)', _, '人类(唯一循环宿主)', '剑水蚤(桡足类)', 'support(逐日缠绕取虫)', '清零计划(WHO 认证监测)', 'C'],
    ['Wuchereria', '班氏吴策线虫(淋巴丝虫病/象皮肿)', 'h_nema', [90, 240], 3, 2, 'vector', _, '人类', '库蚊/按蚊', 'dec+bzd或单独|tet(多西, Wolbachia 方案)', '_', 'A'],
    ['Brugia', '马来布鲁线虫(淋巴丝虫病, 东南亚)', 'h_nema', [90, 240], 2, 2, 'vector', _, '人类/猫猴(动物储存)', '曼蚊', 'dec|tet', _, 'C'],
    ['Onchocerca', '旋盘尾线虫(河盲症)', 'h_nema', [90, 540], 3, 2, 'vector', _, '人类', '蚋(Simulium)', 'iver(微丝蚴)+tet(Wolbachia 清除)', '_', 'A'],
    ['Loa_loa', '罗阿罗阿丝虫(非洲眼虫)', 'h_nema', [90, 365], 2, 2, 'vector', _, '人类', '斑虻', 'dec(注意高微丝蚴血症脑病风险)', _, 'C'],
    ['Taenia_solium', '猪带绦虫(绦虫病/囊尾蚴病)', 'h_cestode', [56, 3650], 3, 2, 'food(含囊尾蚴猪肉)|fecal(食入虫卵→囊虫)', _, '猪(中间)/人(终末)', _, 'praz(肠道)|bzd+cort(囊虫)', '_', 'A'],
    ['Taenia_saginata', '牛带绦虫', 'h_cestode', [56, 90], 1, 2, 'food(未熟牛肉)', _, '牛(中间)/人(终末)', _, 'praz', _, 'B'],
    ['Hymenolepis', '短膜壳绦虫(H. nana)', 'h_cestode', [14, 28], 1, 2, 'fecal|fomites|自身感染', _, '人类/鼠', _, 'praz', _, 'C'],
    ['Diphyllobothrium', '阔节裂头绦虫(鱼绦虫, B12 缺乏)', 'h_cestode', [21, 56], 1, 2, 'food(生淡水鱼)', _, '鱼类/人·熊·鸥(终末)', _, 'praz+vitB12', _, 'C'],
    ['Spirometra', '曼氏迭宫绦虫(裂头蚴病)', 'h_cestode', [30, 730], 2, 2, 'food(蛙蛇/生水剑水蚤)|外敷偏方', _, '犬猫(终末)/蛙蛇(裂头蚴)', '剑水蚤', 'praz(肠)/手术(裂头蚴)', _, 'C'],
    ['E_granulosus', '细粒棘球绦虫(囊型包虫病)', 'h_cestode', [180, 3650], 3, 2, 'animal(犬粪虫卵)|food 污染', _, '犬(终末)/羊(中间)', _, 'bzd(长程)+PAIR 或手术', '_', 'A'],
    ['Echinococcus_m', '多房棘球绦虫(泡型包虫病, "恶性"肝侵犯)', 'h_cestode', [365, 7300], 4, 2, 'animal(狐粪)|食物污染浆果', _, '狐(终末)/啮齿(中间)', _, 'bzd(常终身)+扩大切除', _, 'B'],
    ['S_mansoni', '曼氏血吸虫(肠道血吸虫病)', 'h_trema', [40, 70], 3, 2, 'water(尾蚴穿皮)', _, '螺/人类', '淡水螺(中间宿主)', 'praz', '候选疫苗(Sh28GST)', 'A'],
    ['S_haematobium', '埃及血吸虫(尿路血吸虫病, 膀胱癌相关)', 'h_trema', [40, 70], 3, 2, 'water', _, '螺/人类', '小泡螺', 'praz', '_', 'A'],
    ['S_japonicum', '日本血吸虫(亚洲血吸虫病, 动物储存强)', 'h_trema', [40, 70], 3, 2, 'water(钉螺疫水)', _, '钉螺/人·牛·鼠', '钉螺(Oncomelania)', 'praz', '_', 'A'],
    ['Clonorchis', '华支睾吸虫(肝吸虫, 胆管癌相关)', 'h_trema', [30, 1800], 2, 2, 'food(生淡水鱼)', _, '淡水鱼/螺·人犬猫', '豆螺(第一中间)', 'praz', _, 'B'],
    ['Opisthorchis', '猫/麝猫后睾吸虫', 'h_trema', [30, 1800], 2, 2, 'food(生淡水鱼)', _, '螺/鲤科鱼/人犬猫', '螺', 'praz', _, 'C'],
    ['Fasciola', '肝片形吸虫', 'h_trema', [60, 90], 2, 2, 'food(水芹/水生植物附着)', _, '螺/反刍动物(羊牛)', '螺', 'tcbz', '_', 'C'],
    ['Paragonimus', '卫氏并殖吸虫(肺吸虫)', 'h_trema', [65, 90], 2, 2, 'food(生蟹/蝲蛄)', _, '蟹蝲蛄(中间)·人猫犬虎(终末)', '螺', 'praz', _, 'B'],
    ['Fasciolopsis', '布氏姜片吸虫', 'h_trema', [30, 90], 1, 2, 'food(水生植物:菱角/茭白)', _, '螺/猪·人', '螺', 'praz', _, 'C'],
    // ===== 朊粒 =====
    ['Prion_sCJD', '朊粒(散发性克雅氏病)', 'prion', [365, 1825], 5, 3, '散发(85%)/iatro/遗传(PRNP)', _, '人类', _, 'support(无根治)', _, 'B'],
    ['Prion_vCJD', '变异型克雅氏病(BSE 污染牛肉→人)', 'prion', [3650, 7300], 5, 3, 'food(污染牛肉)|blood(输血)', _, '牛(BSE)→人类', _, 'support', _, 'C'],
    ['Prion_kuru', '库鲁(食人葬俗传播, 已近消灭)', 'prion', [1825, 25550], 5, 3, 'contact(葬礼食脑, 史上)', _, '人类(福尔部落)', _, 'support', _, 'C'],
  ];
  // 个别行里 vaccine 字段误用下划线占位打成了 '_' 等, 统一归一为 null
  for (const row of CAT) { if (row[11] === '_' || row[11] === '') row[11] = _; }

  window.PathoCatalog = {
    arch: ARCH,
    rx: RX,
    raw: CAT,
    fields: ['id', 'zh', 'arch', 'inc', 'sev', 'bsl', 'tx', 'r0', 'reservoir', 'vector', 'rx', 'vaccine', 'tier'],
    normalize(row) {
      return {
        id: row[0], zh: row[1], arch: row[2],
        incMin: row[3][0], incMax: row[3][1],
        sev: row[4], bsl: typeof row[5] === 'number' ? row[5] : parseInt(row[5], 10) || 0,
        tx: String(row[6] || '').split('|').filter(Boolean),
        r0: Array.isArray(row[7]) ? { lo: row[7][0], hi: row[7][1] } : null,
        reservoir: row[8] || null, vector: row[9] || null,
        rx: String(row[10] || '').split('|').filter(Boolean),
        // 干净的药物类 key: 拆 '+'/'±'/'→', 去掉括号注释 —— P1 的 PK/PD
        // 引擎按类(不是按别名)匹配; 注释保留在 rxNotes 里供展示。
        rxCls() {
          const out = [];
          for (const tok of this.rx) {
            for (const part of tok.split(/[+±→/]/)) {
              const k = part.replace(/[（(].*$/, '').replace(/[?？]/g, '').trim().toLowerCase();
              if (k && RX[k] && !out.includes(k)) out.push(k);
            }
          }
          return out;
        },
        rxNotes() {
          const out = [];
          for (const tok of this.rx) for (const m of tok.matchAll(/[（(]([^）)]+)[）)]/g)) out.push(m[1]);
          return out;
        },
        rxZh(list) { return (list || this.rx).map(k => RX[k] || k); },
        vaccine: row[11] || null, tier: row[12] || 'C',
        kind: (ARCH[row[2]] || {}).k || '?',
        genomeType: (ARCH[row[2]] || {}).g || '',
        mu: (ARCH[row[2]] || {}).mu || 0,
        rHost: (ARCH[row[2]] || {}).r || 0,
      };
    },
    all() { return CAT.map(r => this.normalize(r)); },
    get(id) { const row = CAT.find(r => r[0] === id); return row ? this.normalize(row) : null; },
    byKind(k) { return this.all().filter(e => e.kind === k); },
    kinds() { const out = {}; for (const e of this.all()) out[e.kind] = (out[e.kind] || 0) + 1; return out; },
    search(q, kind) {
      const s = String(q || '').trim().toLowerCase();
      return this.all().filter(e =>
        (!kind || kind === 'any' || e.kind === kind) &&
        (!s || e.id.toLowerCase().includes(s) || e.zh.includes(s) || e.genomeType.toLowerCase().includes(s)));
    },
  };
})();
