/* eslint-disable */
/* =============================================================================
 * SigmaFlow Science · 虚拟患者生理模拟引擎(自 /data/mkk/smlife/web 移植)
 * 上游: 《生命 LIFE》网页版生理引擎(smlife), 常量经临床手册校准。移植要点:
 *   1) 数据层 GAMEDATA/CAL 原样保留; 引擎保持全局函数形态(inline onclick 直调)。
 *   2) 原"页面尾 IIFE 常驻启动"改为 window.PatientSim.mount()/unmount() 生命周期,
 *      由 science 应用的 CS.mountPatientPage() 在进入页面时调用。
 *   3) 素材路径 assets/* → patient/*(本站 assets/patient, build 拷入 dist/patient);
 *      three.js 不再走 importmap, 3D 器官视图改用 window.CellViewer(虚拟细胞页
 *      同源的 vendor 内核, 见 window.PatientViewer)。
 *   4) 病例进度 localStorage 键沿用 smlife_cases_v1。
 * =========================================================================== */
const GAMEDATA = {"enums":{"ChemicalType":["Null","O2","N2","N2O","CO2","H2O2","Urea","Sodium","Chloride","Potassium","Calcium","Iron","Iodine","Magnesium","Phosphate","Ammonia","AminoAcid","Amylose","Protein","Glucose","Glycogen","Glutamine","Glutamate","Triglyceride","TriglycerideHydrophilic","Monoglyceride","PhosphoLipid","PhosphoLipidHydrophilic","CholesterolEster","Cholesterol","CholesterolEsterHydrophilic","Fructose","Lactose","LacticAcid","Maltose","Sucrose","Galactose","Urobilin","Urobilinogen","Bilirubin","BilirubinConjugated","Stercobilin","Plasma","HCl","Peptite","FattyAcid","HCO3","Glycerol","CRP","Ethanol","Ethanal","NADH","Heparin","Warfarin","Amlodipine","Amiodarone","Labetalol","Lisinopril","AceticAcid","Endorphin","Fentanyl","Heroin","Morphine","Codeine","Oxycodone","Hydrocodone","Naloxone","Doxapram","Cyproheptadine","Cocaine","Amphetamine","Methamphetamine","MDMA","Psilocybin","Psilocin","LSD","Mescaline","DMT","THC","CBD","Caffeine","Nicotine","Irbesartan","Valsartan","ArachidonicAcid","Aspirin","Ibuprofen","Naproxen","Atropine","Succinylcholine","Ephedrine","Isoprenaline","Dobutamine","Propranolol","Metoprolol","Diazepam","Lorazepam","Chlorpromazine","Clozapine","Nifedipine","Captopril","Enalapril","Losartan","Famotidine","Proglumide","Salbutamol","Diphenhydramine","Chlorpheniramine","Loratadine","Cetirizine","Levonorgestrel","Phenobarbital","Barbital","Meclizine","Omeprazole","Nitroglycerin","Metformin","Atenolol","Olmesartan","Salmeterol","Albuterol","Acetaminophen","Dextromethorphan","Dexmedetomidine","Creatinine","Troponin"],"ReceptorsType":["α1Adrenoceptor","α2Adrenoceptor","β1Adrenoceptor","β2Adrenoceptor","M1","M2","M3","M4","M5","MineralocorticoidReceptor","AGTReceptor","Vasopressin1","Vasopressin2","MelatoninReceptor","CCK1","CCK2","SS","H1","H2","EP2","EP1","EP3","IP","FP","SecretinReceptor","NPY","TKR","GlucagonReceptor","A1","A2","A3","CRH1","ACTHReceptor","ANPReceptor","GCR","TRHR","TSHR","TR","PTHR","VDR","B1","B2","μR","κR","δR","DAT","SERT","GAT","EAAT","TAAR","NET","SerotoninReceptor1A","SerotoninReceptor2A","SerotoninReceptor2C","D1","D2","D3","D4","D5","CB1","CB2","nAChR","GnRHR","ER","FSHR","LHR","PR","TP","CYSLTR1","CYSLTR2","GABAA","NMDAReceptor"],"HormoneType":["Dopamine","Epinephrine","Adenosine","Norepinephrine","Melatonin","Triiodothyronine","ProstaglandinI2","ProstaglandinD2","ProstaglandinE2","ProstaglandinF2a","LeukotrieneC4","LeukotrieneD4","LeukotrieneE4","Bradykinin","ThromboxaneA2","ThromboxaneB2","Acetylcholine","Aldosterone","AngiotensinI","AngiotensinII","Angiotensinogen","Vasopressin","Calcitonin","Gastrin","Ghrelin","Glucagon","Cortisol","Somatostatin","Histamine","Secretin","Cholecystokinin","PYY","Neurotensin","GIP","Insulin","CRH","ACTH","ANP","Estrone","Estradiol","Estriol","Androstenolone","Androstadienone","Testosterone","Progesterone","Progestin","Oxytocin","Prolactin","TRH","TSH","T4","T3","PTH","FSH","LH","GnRH","Calcitriol","Serotonin","Anandamide","Dexamethasone","Amylin"],"ConditionType":["Null","MyocardialInfarction","CardiacArrest","Hypoxemia","Hypoxia","Hypokalemia","Hyperkalemia","Tachycardia","Hypovolemia","Bradycardia","Hypertension","Hypotension","HeartBlock","Hyponatremia","Hypercalcaemia","Hypocalcaemia","Hypercapnia","SupraventricularTachycardia","VentricularTachycardia","AtrialFibrillation","VentricularFibrillation","Hypoglycemia","Hyperglycemia","Delirium","Coma","SinusRhythm","Acidosis","Hyperthyroidism","Hypothyroidism","BrainDeath","Bradypnea","Apnea","Euphoria","Dysphoria","Drowsiness","HemorrhagicStroke","Alertness","Anorexia","Empathy","IschemicStroke","PulmonaryEmbolism","DeepVeinThrombosis","Vomitting","Nausea","Hallucination","Depression","Fever","Hyperthermia","Hypothermia","Hyperpyrexia","InternalHemorrhage","Hemorrhage","Sleep","Asthma","CardiacTamponade","Dizziness","Pain","AVS","VSD"],"FoodType":["Chyle","Water","SmallWater","Milk","Chicken","Apple","Banana","Rice","Coke","Pork","Beer","Wine","Vodka","Soup","Pizza","Drug","Coffee","Egg","Bread","Salmon","Nut","Chocolate","EnergyDrink","OrangeJuice"],"CellType":["Erythrocytes","ErythrocytesO2","ErythrocytesCO2","Platelet","Leukocytes","Thrombocytes","Neutrophils","Lymphocytes","Basophils","Granulocytes","Eosinophils","Macrophage","MastCell","Clot","Monocyte","BCell","DendriticCell","EColi","Rhinovirus","Influenza","Coronavirus","Adenovirus","HIV","HPV","RSV","Rotavirus","VZV","Norovirus","MeaslesVIrus","RubellaVirus","HAV","HBV","HCV","HDV","CTetani","CDiphtheriae","BPertussis"],"EnzymeType":["Renin","ACE","Pepsinogen","Pepsin","Bile","SalivaryAmylase","PancreaticAmylase","PancreaticLipase","PLA2","CholesterolEsterHydrolase","Lactase","Maltase","Sucrase","Trypsinogen","Trypsin","GastricLipase","COX1","COX2"],"BlockerType":["CCB","PCB","SCB","Null","BetaBlocker","ACEInhibitor","NSAID","GABAInducer","PPI","Nitrates","APAP"],"AdministrationType":["Muscle","ContinuousInfusion","Oral","IVPush","Inhale"]},"name_map":{"Brain":"人脑","Thyroid":"甲状腺","Lung":"肺","Heart":"心脏","Liver":"肝脏","Stomach":"胃","Pancreas":"胰脏也称胰腺","Spleen":"脾脏","Small Intestine":"小肠","Large Intestine":"大肠","Gallbladder":"胆囊","Urinary Bladder":"膀胱","Kidney":"肾","Adrenal Gland":"肾上腺","Female Reproductive System":"女性生殖系统","Male Reproductive System":"男性生殖系统","Urine Output":"尿量","Bile":"胆汁","EEG":"脑电图","Autonomic Nervous System":"自主神经系统","Partial pressure":"气体分压","Red blood cells":"红细胞","Blood urea nitrogen":"尿素氮","Creatinine":"肌酸酐","FFP":"新鲜冷冻血浆","Histamine":"组胺","Serotonin":"血清素","T3":"三碘甲状腺原氨酸","PGD2":"前列腺素D2","Leukotriene D4":"白三烯D4","Leukotriene E4":"白三烯E4","Bradykinin":"缓激肽","Angiotensin":"血管紧张素","Vasopressin":"抗利尿激素","Gastrin":"胃泌素","Secretin":"促胰液素","Somatostatin":"体抑素","Cholecystokinin":"胆囊收缩素","Atrial natriuretic peptide":"心房钠尿肽","Adrenocorticotropic hormone":"促肾上腺皮质激素","Oxytocin":"催产素","Prolactin":"催乳素","Parathyroid hormone":"副甲状腺素","Calcitonin":"降钙素","Follicle-stimulating hormone":"促卵泡激素","Luteinizing hormone":"黄体化激素","Neurotensin":"神经降压素","Aldosterone":"醛固酮","Dexamethasone":"地塞米松","Estriol":"雌三醇","Estradiol":"雌二醇","Testosterone":"睾酮","rogestin":"黄体制剂","Acetylcholine":"乙酰胆碱","Adenosine":"腺苷","Platelet":"血小板","Eosinophil granulocyte":"嗜酸性粒细胞","Monocyte":"单核细胞","Lymphocyte":"淋巴细胞","Macrophage":"巨噬细胞","Mast cell":"肥大细胞","Escherichia coli":"大肠杆菌","Rhinovirus":"鼻病毒","Hepatitis A":"甲型肝炎","Hepatitis B virus":"乙型肝炎病毒","Human immunodeficiency virus":"人类免疫缺乏病毒","Norovirus":"诺如病毒","Rotavirus":"轮状病毒","Blood Plasma":"血浆","Glutamic acid":"谷氨酸","Oxygen":"氧","Carbon dioxide":"二氧化碳","Sodium":"钠","Potassium":"钾","Calcium":"钙","Magnesium":"镁","iPhosphate":"磷","C6H12O6":"果糖","Triglyceride":"甘油三酸酯","Bilirubin":"胆红素","Famotidine":"法莫替丁","Omeprazole":"奥美拉唑","Heparin":"肝素","Warfarin":"华法林","Diphenhydramine":"苯海拉明","Meclizine":"美克洛嗪","Cyproheptadine":"赛庚啶","loratadine":"氯雷他定","Nifedipine":"硝苯地平","Irbesartan":"厄贝沙坦","Amiodarone":"胺碘酮","Propranolol":"普萘洛尔","Metoprolol":"美托洛尔","Atenolol":"阿替洛尔","Captopril":"卡托普利","Lorazepam":"劳拉西泮","Diazepam":"地西泮","Barbital":"巴比妥","Dexmedetomidine":"右美托咪定","Dextromethorphan":"右美沙芬","Acetaminophen":"对乙酰氨基酚","Aspirin":"阿司匹林","Ibuprofen":"布洛芬","Atropine":"阿托品","Succinylcholine":"琥珀胆碱","Dobutamine":"多保他命","Salbutamol":"沙丁胺醇","Levonorgestrel":"左炔诺孕酮","Doxapram":"多沙普仑","Endorphin":"内啡肽","Codeine":"可待因","Hydrocodone":"氢可酮","Morphine":"吗啡","Oxycodone":"羟考酮","Fentanyl":"芬太尼","Naloxone":"纳洛酮","Nitroglycerin":"硝酸甘油","Metformin":"二甲双胍","Caffeine":"咖啡因","Nicotine":"尼古丁","Amphetamine":"安非他命","Methamphetamine":"甲基苯丙胺或甲基安非他命","Cocaine":"可卡因","Chlorpromazine":"氯丙嗪","Clozapine":"氯氮平","Psilocybin":"赛洛西宾","Psilocin":"脱磷酸裸盖菇素","Lysergic acid diethylamide":"麦角酸二乙酰胺","Mescaline":"麦司卡林","Tetrahydrocannabinol":"四氢大麻酚","Cannabidiol":"大麻二酚","Pepsin":"胃蛋白酶","Renin":"肾素","Angiotensin-converting enzyme":"血管紧张肽I转化酶","Pancrelipases":"胰脂肪酶","Cardiac arrest":"心脏停止","Hypoxia":"缺氧","Hypokalemia":"低钾血症","Hyperkalemia":"高钾血症","Bradycardia":"心跳过慢","Hypertension":"高血压","Heart Block":"房室传导阻滞","Hyponatremia":"低血钠症","Hypercalcaemia":"高血钙","Hypocalcaemia":"低钙血症或低血钙症","Hypercapnia":"高碳酸血症","DVT":"深静脉血栓","Pulmonary Embolism":"肺栓塞","Apoplexy":"内出血","Supraventricular tachycardia":"室上性心搏过速","Ventricular tachycardia":"心室性心搏过速","Atrial fibrillation":"心房颤动","Ventricular fibrillation":"心室颤动","Hyperglycemia":"高血糖","Delirium":"晕厥","Coma":"昏迷","Acidosis":"酸中毒","Hyperthyroidism":"甲状腺功能亢进症","Hypothyroidism":"甲状腺机能低下症","Brain death":"脑死亡","Bradypnea":"呼吸过缓","Anorexia nervosa":"神经性厌食症","Fever":"发烧","Hyperthermia":"高热","Hypothermia":"失温症","Hemorrhage":"出血","Asthma":"哮喘","Cardiac tamponade":"心包填塞","Apnea":"呼吸中止、呼吸暂停","Euphoria":"欣快","Dysphoria":"烦躁","Somnolence":"昏睡","Alertness":"清醒","Hallucination":"幻觉","Depression":"抑郁","Sleep":"睡眠","Vertigo":"眩晕","pain":"身体的疼痛","Angiotensin receptors":"血管紧张素受体","Melatonin Receptor":"褪黑素受体","Glucagon Receptor":"胰高血糖素受体","Secretin Receptor":"促胰液素受体","Vasopressin 1 R":"抗利尿激素受体1","Vasopressin 2 R":"抗利尿激素受体2","Adrenergic receptors":"肾上腺素能受体","Thyrotropin receptor":"促甲状腺激素受体","Dopamine transporter":"多巴胺转运体","Dopamine":"多巴胺","Epinephrine":"肾上腺素","Norepinephrine":"去甲肾上腺素","Insulin":"胰岛素","Glucagon":"胰高血糖素","Cortisol":"皮质醇","AngiotensinII":"血管紧张素II","T4":"甲状腺素","Isoprenaline":"异丙肾上腺素","Ephedrine":"麻黄碱","Salmeterol":"沙美特罗","Amlodipine":"氨氯地平","Labetalol":"拉贝洛尔","Lisinopril":"赖诺普利","Enalapril":"依那普利","Losartan":"氯沙坦","Olmesartan":"奥美沙坦","Valsartan":"缬沙坦","Phenobarbital":"苯巴比妥","Ethanol":"乙醇","Heroin":"海洛因","Naproxen":"萘普生","Chlorpheniramine":"氯苯那敏","Loratadine":"氯雷他定","Cetirizine":"西替利嗪","Troponin":"肌钙蛋白","Urea":"尿素","Cholesterol":"胆固醇","Glucose":"葡萄糖","Glycogen":"糖原","LacticAcid":"乳酸","Ethanal":"乙醛"},"encyc":{"人脑":"人脑（Brain）由大脑、小脑、间脑、脑干组成。其中：大脑是中枢神经系统的最高级部分，也是脑的主要部分。分为左右两个大脑半球，二者由神经纤维构成的胼胝体相连。","甲状腺":"甲状腺（Thyroid）是脊椎动物非常重要的腺体，属于内分泌器官。在哺乳动物它位于颈部甲状软骨下方，气管两旁。人类的甲状腺形似蝴蝶，犹如盾甲，故名。甲状腺控制使用能量的速度、制造蛋白质、调节身体对其他荷尔蒙的敏感性。","肺":"肺（Lung）是很多進行空氣呼吸的動物的呼吸系統中重要的一個器官，大部分四足類動物、一些魚類和蝸牛都有肺。哺乳動物和其他身體結構較為複雜的動物則擁有兩個肺，其位於胸腔中靠近脊柱，並分別位於心臟的左右兩側。肺的主要功能是將氧氣從空氣運輸到血液中，並將二氧化碳從血液中排出至大氣中。","心脏":"心脏（Heart）是一种在人类和其他动物都有的肌造器官，它的功用是推动循环系统中血管的血液。血液提供身体氧气以及养分，同时也协助身体移除代谢废弃物。","肝脏":"肝脏（Liver）为脊椎动物体内的一种器官，以代谢功能为主，并扮演着除去毒素，储存醣原（肝醣），分泌性蛋白质合成等重要角色。","胃":"胃（Stomach）是人和脊椎動物消化系統的一部分，是貯藏和消化食物的器官。胃上接食道，下接十二指腸。位置大約位於人體的左上腹，肋骨以下。胃主要將大塊食物研磨成小塊，將食物中的大分子降解成較小的分子，以便進一步吸收。","胰脏也称胰腺":"胰脏也称胰腺（Pancreas），旧称膵、脺，脊椎动物具有外、内分泌功能的腺体；外分泌由腺泡、连通肠腔的导管组成，腺泡分泌多种消化酶，导管上皮细胞分泌碳酸氢盐、钠、钾、氯等离子和水，合称胰液。","脾脏":"脾脏（Spleen）是脊椎动物的一种外周淋巴器官。脾是人类成体最大的淋巴器官。在成体内的主要功能为储存免疫细胞、滤血以及储血。","小肠":"小肠（Small Intestine）是消化系统的一部分，从在胃部后面一直延伸至大肠，是进行食物消化与吸收的主要器官。","大肠":"大肠（Large Intestine）是脊椎动物消化系统的最后一部分。大肠的作用是从肠道内剩余的可消化物质中吸取水分与电解质，将剩余的无用部分形成粪便并作暂时储存以及最终排出粪便。","胆囊":"胆囊（Gallbladder），是位于右方肋骨下肝脏后方的梨形囊袋构造，有浓缩和储存胆汁之用。","膀胱":"膀胱（Urinary Bladder）是哺乳動物貯尿的囊狀器官，功能是暫存和排泄小便。經腎臟過濾之後的含有代謝產物的體液流入膀胱，形成尿液","肾":"肾（Kidney）是脊椎动物体内的一种器官，属于泌尿系统的一部分，负责过滤血液中的杂质、维持体液和电解质的平衡，最后产生尿液经由后续管道排出体外。","肾上腺":"肾上腺（Adrenal Gland）是呈三角形的内分泌腺体，位于肾脏上方，因而得名。其主要功能为通过合成皮质类甾醇和邻苯二酚胺（例如皮质醇和肾上腺素）来调控身体对压力产生的反应。","女性生殖系统":"女性生殖系统（Female Reproductive System）是由人类女性的生殖器官组成的系统。可分成内生殖器官和外生殖器官，分别指生殖系统在体内不可见的部分和体外可见的部分。人类女性的生殖系统在出生时尚未发育成熟，一直到青春期才发育成熟，可以产生配子（卵子），并且让胎儿在体内成长（妊娠）。 ","男性生殖系统":"男性生殖系统（Male Reproductive System）是由男性许多生殖器官或组织组成。男性主要的性器官是制造精子的睾丸，以及分泌精液的阴茎，在和女性性交，精子可以使女性体内的卵细胞受精，受精卵会发展成为胎儿。","心电描记术":"心电描记术（心电图 ECG | EKG）是一种经胸腔的以时间为单位记录心脏的电生理活动，并通过皮肤上的电极捕捉并记录下来的诊疗技术。","胆汁":"胆汁（Bile）是由肝细胞分泌出的一种汁液，存放于胆囊内，然后在进食时把胆汁经胆总管释放入小肠帮助消化。胆汁的主要作用是乳化脂质。","脑电图":"脑电图（EEG）是透过医学仪器脑电图描记仪，将人体脑部自身产生的微弱生物电于头皮处收集，并放大记录而得到的曲线图。","自主神经系统":"自主神经系统（Autonomic Nervous System，ANS），与躯体神经系统共同组成脊椎动物的周围神经系统。未受训练的人无法靠意识控制该部分神经的活动。自主神经系统控制体内各器官系统的平滑肌、心肌、腺体等组织的功能,如心脏搏动、呼吸、血压、消化和新陈代谢。","气体分压":"气体分压（Partial pressure）指的是当气体混合物中的某一种组分在相同的温度下占据气体混合物相同的体积时，该组分所形成的压力。氧气可以少量溶于血液中之后为血红蛋白结合，故血液中的氧分压随之成为血气分析的一个重要指标。","红细胞":"红细胞（Red blood cells, RBCs），又称为红血球或血红细胞，是血液中数量最多的一种血球，同时也是脊椎动物体内通过血液将氧气从肺或鳃运送到身体各个组织的最主要的媒介。","尿素氮":"尿素氮（Blood urea nitrogen，縮寫：BUN），是蛋白質經過消化作用分解後所產生的代謝產物經過尿素循環在肝臟中轉換為尿素。","肌酸酐":"肌酸酐（Creatinine）又稱肌酐，是肌酸和磷酸肌酸代謝的終產物，它主要由肌肉中磷酸肌酸的非酶促反應生成。","血液酒精浓度":"血液酒精浓度（缩写：BAC）是用于法律或医学目的度量酒精中毒的指标。通常的度量单位为：单位体积血液中的酒精质量或体积的百分比。","新鲜冷冻血浆":"新鲜冷冻血浆（FFP）为一从全血制备而成的血液制品，一般是在采集全血后八小时内分离制备，用于治疗体内凝血因子过低（INR>1.5）或是血浆蛋白过少之患者，也做为血浆置换的置换液，通常会建议（但非必要）使用ABO血型相符的血浆。","肾上腺素":"肾上腺素（Epinephrine或Adrenaline）, 是肾上腺髓质分泌的激素及神经传导物质，也是一种药物。肾上腺素被应用于治疗多项疾病，包含全身性过敏反应、心搏停止，以及表面出血等等，吸入式的肾上腺素有时会被用于改善义膜性喉炎的症状。","去甲肾上腺素":"去甲肾上腺素（Norepinephrine、nor-epinephrine，NE或NA），旧称正肾上腺素，是肾上腺素去掉 N-甲基后形成的物质，在化学结构上也属于儿茶酚胺。","组胺":"组胺（Histamine），是一种有机含氮化合物。它参与局部免疫反应和炎症反应，并具有作为瘙痒介体中心和调节肠道生理功能的作用。它还被用作神经递质。组胺由嗜碱性球和附近结缔组织肥大细胞产生。","血清素":"血清素（Serotonin, 簡稱為5-HT）為單胺型神經遞質，由色氨酸經色氨酸羥化酶轉化為5-羥色氨酸，再經5-羥色氨酸脫羧酶在中樞神經元及消化道之腸嗜鉻細胞中合成。","褪黑素":"褪黑素（Melatonin)，是一種在動物、植物、真菌和細菌中皆有發現的物質。褪黑素是一種調節生物鐘的激素，可以用來幫助入睡和治療睡眠障礙。","三碘甲状腺原氨酸":"三碘甲状腺原氨酸（T3）是一种甲状腺激素，几乎对所有生理过程都产生影响，包括生长和发育，代谢，体温，和心率。","前列腺素D2":"前列腺素D2（PGD2）是前列腺素的一種。哺乳動物體內，大量的前列腺素只存在於腦部和肥大細胞中，其會影響過敏性疾病如哮喘等的發展。","前列腺素E2":"前列腺素E2（prostaglandin E2 (PGE2)），亦稱地諾前列酮（dinoprostone），是前列腺素的一種，主要用於分娩時軟化子宮頸、引發子宮收縮、引產。此外也可以用作墮胎藥、刺激造骨細胞。","前列环素":"前列环素（英语：Prostacyclin，简称为PGI2）是脂类中类花生酸家族中的一个成员，分子中有一个次级五元环，其前体是花生四烯酸或其他二十碳不饱和脂肪酸。","白三烯D4":"白三烯D4（Leukotriene D4）是白三烯的一種，在體內具有支氣管收縮、血管收縮、平滑肌收縮、增加血管通透性等功能。","白三烯E4":"白三烯E4（Leukotriene E4）是一種與炎症反應有關的半胱氨酰白三烯類物質，由幾種白細胞產生，包括嗜酸性粒細胞、肥大細胞、巨噬細胞和嗜鹼性粒細胞，最近還發現了有血小板粘附的中性粒細胞也能產生白三烯E4。","血管紧张素":"血管紧张素（Angiotensin），亦称血管收缩素、血管张力素，是一种寡肽类激素，是肾素-血管收缩素系统（renin-angiotensin system）的重要组成部分。","抗利尿激素":"抗利尿激素（Vasopressin，也稱為 antidiuretic hormone，簡稱 ADH），又稱精氨酸血管加壓素（Arginine Vasopressin, AVP）、血管升壓素、血管加壓素等，是一種多肽激素，在人體中的主要作用是控制尿排出的水量。","胃泌素":"胃泌素（Gastrin）是胃部分泌的一種勝肽荷爾蒙，主要功能為刺激胃壁細胞分泌胃酸，以利消化酵素胃蛋白酶激活，並進行分解蛋白質作用。","促胰液素":"促胰液素（Secretin）為史上首個被發現的激素。是由十二指腸分泌的含27個氨基酸的激素。它的產生可由多種因素刺激，其中最強的刺激信號是胃酸中的鹽酸。","胆囊收缩素":"胆囊收缩素（Cholecystokinin，简称CCK或CCK-PZ）是一种消化系统当中的肽类激素，可以促进脂肪与蛋白质的消化。","心房钠尿肽":"心房钠尿肽（Atrial natriuretic peptide），心房钠尿肽是一种肽荷尔蒙，主要由心房的心肌细胞生产、储存和分泌。","胰高血糖素":"胰高血糖素（拉丁語：Glucagon）又稱升糖素，是一種由胰臟胰島α-細胞分泌的激素。","促肾上腺皮质激素":"促肾上腺皮质激素（Adrenocorticotropic hormone, ACTH）是一种多肽激素，生产并分泌于脑垂体，是下丘脑-脑垂体-肾上腺皮质轴（hypothalamic-pituitary-adrenal axis）中的重要化学物质。","催产素":"催产素（Oxytocin，又称缩宫素，简称为OT）是一种哺乳动物激素，是肽类激素也是神经肽，一般是由下丘脑产生，由垂体后叶分泌。","催乳素":"催乳素（Prolactin，簡稱PRL，又叫促乳素或催乳激素）是一種由垂體前葉腺嗜酸細胞分泌的蛋白質激素。","甲状腺促素释素简称甲释素":"甲状腺促素释素简称甲释素（Thyrotropin releasing hormone、TRH），是由下视丘（Hypothalamus）所制造的肽类激素（Peptide Hormone），能够调节脑下垂体前叶分泌促甲状腺激素（甲促素，thyroid stimulating hormone、TSH）与催乳素。","副甲状腺素":"副甲状腺素（Parathyroid hormone，简称为PTH），是一种由颈部的副甲状腺分泌，具有84个胺基酸的多肽类激素。","降钙素":"降钙素（Calcitonin，又译为抑钙激素）是一种含有32个胺基酸的直线型多肽类激素，在人体里是由甲状腺的滤泡旁细胞（parafollicular cells，又称C细胞）制造。","促性腺素释素":"促性腺素释素（Gonadotropin-Releasing Hormone，简称为GnRH），在下丘脑中合成，是一种多肽荷尔蒙，它的主要功能是使垂体释放卵泡刺激素（FSH）和黄体化激素（LH）。","促卵泡激素":"促卵泡激素（Follicle-stimulating hormone, FSH，亦稱為卵泡刺激素）是一種由腦垂體合成並分泌的激素，屬於糖基化蛋白質激素，因最早發現其對女性卵泡成熟的刺激作用而得名。","黄体化激素":"黄体化激素（Luteinizing hormone，LH），是一种在脑下垂体前叶合成的荷尔蒙。它的形成是受到促性腺激素释放激素(GnRH)的控制。","神经降压素":"神经降压素（Neurotensin，NT）又名神经降压肽，因其具有明显的降压作用且存在于神经组织而得名。","骨化三醇":"骨化三醇（英語：Calcitriol）是維生素D的活性形式，也是體內的一種激素，在調節血鈣與血磷濃度方面有著重要作用。","皮质醇":"皮质醇（法语：cortisol），又译成可体松，属于肾上腺分泌的肾上腺皮质激素之中的糖皮质激素，在应付压力中扮演重要角色，故又被称为“压力荷尔蒙”。","醛固酮":"醛固酮（Aldosterone）是一種類固醇類激素（鹽皮質激素家族），由腎上腺皮質所產生，主要作用於腎臟，進行鈉離子及水份的再吸收，以維持血壓的穩定。","地塞米松":"地塞米松（Dexamethasone，簡稱DXMS）是一種人工合成的皮質類固醇，可用於治療多種症狀，包含風濕性疾病，某些皮膚病、嚴重過敏、哮喘、慢性阻塞性肺病、義膜性喉炎、腦水腫，也可能與抗生素合併用於結核病患者。","雌酮":"雌酮（Estrone或estrone，E1，或譯為雌酚酮、雌激素酮）是一種較弱的雌性甾體性激素，是三種主要的內源性雌激素之一，另外兩種為雌二醇和雌三醇。","雌三醇":"雌三醇（Estriol ， oestriol， E3）是人類三種主要的雌激素之一。","睾酮":"睾酮（Testosterone）（又称睾固酮、睾丸素、睾丸酮或睾甾酮、睾脂酮）是类固醇激素，由男性的睾丸或女性的卵巢分泌，肾上腺亦分泌少量睾酮。","孕酮":"孕酮（Progesterone)，是一種內源性類固醇和孕激素性激素，也是在體內的主要孕激素，由女性的卵巢分泌。","乙酰胆碱":"乙酰胆碱（Acetylcholine, ACh）为中枢及周边神经系统中常见的神经传导物质，于自主神经系统及体运动神经系统中参与神经传导。","腺苷":"腺苷（Adenosine）是核苷的一種，由核糖（呋喃核糖）與腺嘌呤的一部分組成，腺苷在生物化學上扮演重要角色，包括以腺苷三磷酸（ATP）或腺苷雙磷酸（ADP）形式轉移能量，或是以環狀腺苷單磷酸（cAMP）進行信號傳遞等。此外腺苷也是一種抑制性神經傳導物，可能會促進睡眠。","血小板":"血小板（Platelet），也稱血栓細胞，為血液的一個組成部分，可與凝血因子一起，借由結塊作用，對血管受傷而出血的部位進行反應，進而形成凝塊。","嗜酸性粒细胞":"嗜酸性粒细胞（Eosinophil granulocyte）是粒细胞中含有嗜酸性颗粒的一种，其他两种是中性粒细胞和嗜碱性粒细胞。","中性粒细胞":"中性粒细胞（Neutrophil或 Neutrophil granulocyte）是血液白细胞的一种，也是哺乳动物血液中最主要的一种白细胞。","淋巴细胞":"淋巴细胞（Lymphocyte），也称淋巴球，为白细胞中体积最小的一种，直径6—8微米；在人体约占白细胞的20—30%，圆形细胞核，细胞质很少。","巨噬细胞":"巨噬细胞（Macrophage）是一种位于组织内的白血球，源自单核球，而单核球又来源于骨髓中的前体细胞。","肥大细胞":"肥大细胞（Mast cell），可分两种，黏膜肥大细胞（mucosal mast cell）与结缔组织肥大细胞（connective tissue mast cell），其中黏膜肥大细胞（MMC）必需依赖T细胞才能增殖。","嗜碱性球或嗜碱性粒细胞":"嗜碱性球或嗜碱性粒细胞（Basophil granulocyte、basophils）是一种最少见的粒细胞，约占循环系统中白血球的0.01%至0.3%。","大肠杆菌":"大肠杆菌（Escherichia coli，E. coli）是人和动物肠道中著名的一种细菌，主要寄生于大肠内，约占肠道菌中的0.1%。","鼻病毒":"鼻病毒（Rhinovirus）是最常造成一般感冒的病毒（其次為冠狀病毒），因為它會感染鼻子引起發炎而命名的。","甲型肝炎":"甲型肝炎（Hepatitis A），香港、澳門、馬新譯作甲型肝炎，台灣譯作A型肝炎，在中國大陸常簡稱甲肝，是一種發生於肝臟的急性感染疾病，起因於A型肝炎病毒（hepatitis A virus, HAV）。","人类免疫缺乏病毒":"人类免疫缺乏病毒（Human immunodeficiency virus，缩写为HIV）是一种感染人类免疫系统细胞的慢病毒，属反转录病毒的一种。","诺如病毒":"诺如病毒（Norovirus，NV），又称为诺罗病毒、诺沃克病毒或脓融病毒，是一种引起非细菌性急性胃肠炎的病毒。","轮状病毒":"轮状病毒（Rotavirus，简称RV）是一种双链核糖核酸病毒，属于呼肠孤病毒科。","谷氨酸":"谷氨酸（Glutamic acid）是α-氨基戊二酸是組成生物體內各種蛋白質的20種氨基酸之一。","氨":"氨（Ammonia), 分子式為NH3, 是無色氣體，有強烈刺激氣味（尿味），極易溶於水。","二氧化碳":"二氧化碳（Carbon dioxide，分子式：CO2）是空氣中常見的化合物，由兩個氧原子與一個碳原子通過共價鍵連接而成。","乙醇":"乙醇（英語：Ethanol，結構簡式：CH3CH2OH）是醇類的一種，是酒的主要成份，所以也俗稱酒精，有些地方俗稱火酒，呈中性。","烟酰胺腺嘌呤二核苷酸":"烟酰胺腺嘌呤二核苷酸（Nicotinamide adenine dinucleotide，NAD+），是一种转递质子（更准确来说是氢离子）的辅酶，它出现在细胞很多代谢反应中。","钠":"钠（Sodium，化学符号：Na）是一种化学元素，它的原子序数是11，相对原子质量为23。","镁":"镁（Magnesium,  化学符号：Mg）是一种化学元素，它的原子序数是12，是一种银白色的碱土金属。","蛋白质":"蛋白质（英语：protein）是大型生物分子，或高分子，它由一个或多个由α-氨基酸残基组成的长链条组成。","淀粉":"淀粉（英语：starch, amylum）是由通过糖苷键连接的大量葡萄糖单元组成的聚合碳水化合物，属于一种多醣。","麦芽糖":"麦芽糖（英语：Maltose）又名胶饴，其色紫凝如深琥珀色，色白而枯者，为饧糖不入药用。","乳糖":"乳糖（英語：Lactose）是一種雙醣，由一分子β-D-半乳糖和一分子β-D-葡萄糖在β-1，4-位形成糖苷鍵相連。","葡萄糖":"葡萄糖（Glucose；又稱血糖、玉米葡糖、玉蜀黍糖）是自然界分布最廣、且最為重要的一種單醣。","果糖":"果糖（C6H12O6，Jmol 立體圖）是一種簡單的糖（單糖），極易溶於水，在許多食品中存在，和葡萄糖、半乳糖一起構成了血糖的三種主要成份，可在如蜂蜜、樹上的水果、漿果、瓜類以及一些根類蔬菜如甜菜、地瓜、歐洲蘿蔔、洋蔥等中找到；通常與蔗糖和葡萄糖形成化合物。","糖原":"糖原（英語：glycogen，又稱肝糖、動物澱粉）是人類等動物和真菌儲存糖類的主要形式；是多糖的一種，由葡萄糖失水(脫水)縮合作用而成。","甘油三酸酯":"甘油三酸酯（Triglyceride, TG, triacylglycerol, TAG, or triacylglyceride），亦作三酸甘油酯，常稱為油脂，為動物性油脂與植物性油脂的主要成分，一種由一個甘油分子和三個脂肪酸分子組成的酯類有機化合物，可以透過日常飲食攝取。","法莫替丁":"法莫替丁（Famotidine），商品名稱為Pepcid，是一種組胺H2受體阻抗劑，主要用於抑制胃酸的分泌，並用於治療消化性潰瘍和胃食道逆流。","肝素":"肝素（Heparin），也稱為普通肝素，是一種天然糖胺聚糖抗凝血劑，可用來治療及預防深靜脈血栓、肺栓塞、動脈栓塞，也可用於治療心肌梗塞以及不穩定型心絞痛。","华法林":"华法林（Warfarin）是一种只可口服的抗凝血素，学名为苄丙酮香豆素，一般都以苄丙酮香豆素钠来储存及处方。","苯海拉明":"苯海拉明（Diphenhydramine）是一種抗組胺藥，主要用於治療過敏症，也可以用於治療失眠、感冒症狀、帕金森氏症震顫和噁心。","赛庚啶":"赛庚啶（Cyproheptadine）为抗过敏药，对抗体内组胺对血管、支气管平滑肌的作用，从而消除过敏症状。","氯雷他定":"氯雷他定（loratadine），中英文商品名：開瑞坦/克敏能/Claritin/樂敏錠(Lomidine)，是第二代的抗組織胺藥，常用於治療過敏症狀。","硝苯地平":"硝苯地平（Nifedipine），商品名拜新同（Adalat），是一種二氫吡啶（Dihydropyridines）類鈣離子通道阻滯劑，主要阻斷L-型鈣離子通道。","厄贝沙坦":"厄贝沙坦（Irbesartan）是一种血管紧张素II受体拮抗剂，主要用于高血压的治疗。","胺碘酮":"胺碘酮（Amiodarone）為一種抗心律失常藥，可用於預防或治療數種心律不整，包含心室頻脈（Ventricular tachycardia）、心室顫動（VF）、寬QRS復合波心搏過速、心房顫動，以及陣發性上心室心搏過速。","普萘洛尔":"普萘洛尔（Propranolol）属于一种非选择性Β受体阻断药，常用于治疗高血压、多种心律不整、甲状腺功能亢进症、微血管瘤、表演焦虑症，以及本态性颤抖等。","阿替洛尔":"阿替洛尔（Atenolol）是一种选择性的β1肾上腺素受体拮抗剂，β-受体阻滞药的一种，用于治疗心血管疾病。","卡托普利":"卡托普利（Captopril）是一種血管緊張素轉化酶抑制劑（ACE inhibitor或ACEI），被應用於治療高血壓和某些類型的充血性心力衰竭。","缬沙坦":"缬沙坦（英语：Valsartan），是一款血管紧张素II受体拮抗剂抗高血压类药物，该药物是起到使血管紧张素Ⅱ的I型(AT1)受体封闭，血管紧张素Ⅱ血浆水平升高，刺激未封闭的AT2受体，同时抗衡AT1受体的作用，从而达到扩张血管降低血压的效果。","奥美沙坦":"奥美沙坦（Olmesartan) 是一款血管紧张素II受体拮抗剂药物，用于治疗高血压症。","劳拉西泮":"劳拉西泮（Lorazepam），商品名罗拉、安定文锭或阿提凡（Ativan）是苯二氮䓬类（BZD）药物。可用来治疗焦虑症、失眠、包括癫痫重积状态在内的积极癫痫发作、酒精戒断症候群、化疗引起的噁心和呕吐，也用在手术中的保护性失忆，以及机械式呼吸辅助患者的镇静剂。","地西泮":"地西泮（Diazepam），另有中文譯名地西畔、戴阿劑盤、安定、苯甲二氮䓬，著名商品名稱有「Valium」，化學式C16H13ClN2O，屬於苯二氮䓬類藥物 。","巴比妥":"巴比妥（Barbital），商品名為佛羅拿（Veronal），又叫做巴比通（barbitone），是第一個商品化的巴比妥類藥物。","苯巴比妥":"苯巴比妥（Phenobarbital或Phenobarbitone），也稱為魯米那（Luminal），是一種巴比妥類的鎮靜劑及安眠藥。","右美沙芬":"右美沙芬（Dextromethorphan），又名右甲嗎喃，英文簡稱DM或DXM，是一種鎮咳藥物，它的氫溴酸鹽（Dextromethorphan hydrobromide）常用於藥品中。","对乙酰氨基酚":"对乙酰氨基酚（Acetaminophen），又称乙醯胺酚或扑热息痛（Paracetamol），简称APAP。是一种广泛使用的非处方止痛及退烧药。可用于缓解轻度至中度的疼痛，本品对于孩童的退烧效果仍未有决定性结论。本品常与多种感冒药合并使用。","阿司匹林":"阿司匹林（Aspirin），也稱乙酰水楊酸（Acetylsalicylic acid），是水楊酸類藥物，通常用作止痛劑、解熱藥和消炎藥，亦能用於治療某些特定的發炎性疾病，例如川崎氏病、心包炎，以及風濕熱等等。","布洛芬":"布洛芬（Ibuprofen，商品名：芬必得），是一種非類固醇消炎藥（NSAID），用來止痛，退燒和消炎。","萘普生":"萘普生（Naproxen、INN），是一種非類固醇消炎藥（NSAID），用於緩解普通或嚴重的疼痛、發熱、發炎，以及由風濕性關節炎、類風濕性關節炎、銀屑病關節炎、痛風、強直性脊柱炎、經痛、肌腱炎、滑囊炎等病症引發的強直性反應，對月經失調也有治療效果。","阿托品":"阿托品（Atropine），又稱阿托平。是一種用來治療神經毒氣或殺蟲劑中毒的藥物，也用在某些心跳過緩，與手術時減少唾液分泌用。","琥珀胆碱":"琥珀胆碱（Succinylcholine）是一种烟碱型乙酰胆碱受体（英语：Nicotinic acetylcholine receptor）阻断剂。它属于去极化肌肉松弛剂，被用于全身麻醉及破伤风等。","多保他命":"多保他命（Dobutamine）是一種擬交感神經性藥物，用於心臟衰竭及心因性休克的治療。","沙丁胺醇":"沙丁胺醇（Salbutamol），常見商品名泛得林（Ventolin），為一種用於擴張肺部大型及中型氣管的藥物。","多沙普仑":"多沙普仑（Doxapram）能直接兴奋延髓呼吸中枢与血管运动中枢，作用原理是可通过颈动脉化学感受器、兴奋呼吸中枢、其特点是作用快，维持时间短。临床用于麻醉药、中枢抑制药引起的中枢抑制。","内啡肽":"内啡肽（Endorphin），亦称脑内啡、脑内吗啡或音译安多酚，是可于动物体内自行生成的类吗啡生物化学合成物，是由脊椎动物的脑下垂体和丘脑下部所分泌的氨基化合物（肽）。","可待因":"可待因（Codeine），化學式為C18H21NO3，是一種鴉片類藥物（opioid），有止痛、止咳和止瀉的藥效，它的硫酸鹽或磷酸鹽常用於藥品中。","氢可酮":"氢可酮（Hydrocodone）是一种半合成自可待因（一种发现与罂粟中的鸦片类生物碱）的鸦片类镇痛药。","吗啡":"吗啡（Morphine）为一种鸦片类止痛剂，会直接作用于中枢神经系统，改变人体对疼痛的感觉。","海洛因":"海洛因（Heroin)，即二乙酰嗎啡；又譯海洛英，屬於一種鴉片類藥物，為因為會有欣快感而廣泛作為娛樂性藥物使用。","羟考酮":"羟考酮（Oxycodone）是从生物碱蒂巴因（thebaine）中提取的半合成阿片类药物，作为强效镇痛药在临床上应用已有80多年的历史。由于羟考酮生物利用度高，给药途径多，因而在临床上应用广泛。","纳洛酮":"纳洛酮（Naloxone），又常以商品名“Narcan”贩售。该药物可以缓解摄入过量鸦片类药物所造成的影响。","硝酸甘油":"硝酸甘油（Nitroglycerin） 又被稱作三硝基甘油酯，臨床上可以用來治療心臟衰竭、高血壓，也被用來處理及預防心絞痛，這包括因心肌梗死、服用可卡因或其他原因造成的心臟供血不足產生的心絞痛。","二甲双胍":"二甲双胍（Metformin），常见商品名格华止、库鲁化（Glucophage），为治疗2型糖尿病的一线药物，特别是针对超重的患者。","咖啡因":"咖啡因（Caffeine）是一種中樞神經興奮劑，能暫時的驅走睡意並恢復精力，所以人們在從事思考、閱讀、會議等腦力勞動時，會有一定機會選擇攝入咖啡因來提神。","尼古丁":"尼古丁（Nicotine），俗稱煙鹼，是一種發現於茄科植物的強效擬副交感神經生物鹼，是香煙的主要化學成分和主要致癮成分，屬於興奮劑的一種。","安非他命":"安非他命（Amphetamine）為一種中樞神經刺激劑，用來治療注意力不足過動症、嗜睡症、和肥胖症。","甲基苯丙胺或甲基安非他命":"甲基苯丙胺或甲基安非他命（Methamphetamine）是強效的中樞神經系統刺激劑，主要被用於娛樂用途，較少被用於治療注意力不足過動症和肥胖症，即便有也被當成第二線療法。","亚甲二氧甲基苯丙胺":"亚甲二氧甲基苯丙胺（3,4-亚甲二氧甲基苯丙胺，简称MDMA），MDMA属于苯丙胺类兴奋剂，是一种精神药物，常用作娱乐性药物。预期效应有增加同理心及欣快感，也会有感觉增强的效果。","氯丙嗪":"氯丙嗪（Chlorpromazine），常見商標名 Thorazine 或 Largactil ，為一種精神科藥物。","氯氮平":"氯氮平（Clozapine），常見商標名Clozaril，為一種非典型抗精神病藥物。主要用於治療其他精神科藥物治療無效的精神分裂症。","赛洛西宾":"赛洛西宾（Psilocybin）是致幻剂脱磷酸裸盖菇素的前药，后者是裸盖菇素的活性代谢物和其全部精神作用的产生源。","脱磷酸裸盖菇素":"脱磷酸裸盖菇素（Psilocin）是一种致幻性蘑菇生物碱，与磷酸化的裸盖菇素共见于多数迷幻蘑菇中。","麦角酸二乙酰胺":"麦角酸二乙酰胺（Lysergic acid diethylamide，德文 Lyserg-Säure-Diäthylamid），常简称为LSD，是一种强烈的半人工启灵药。","麦司卡林":"麦司卡林（Mescaline），学名三甲氧苯乙胺，俗称仙人掌毒碱，属于苯乙胺的衍生物。","四氢大麻酚":"四氢大麻酚（Tetrahydrocannabinol），简称THC，），是大麻中的主要精神活性物质。","大麻二酚":"大麻二酚（Cannabidiol，CBD）是大麻百多只有效成分中最具醫療價值的一種，有保護神經、改善皮膚發炎、抗氧化、舒緩皮膚敏感泛紅、為皮膚表層建立保護屏障、改善皮膚自我修復力；對恢復皮膚健康、舒緩皮膚問題的能力，可以治療濕疹等病。","胃蛋白酶":"胃蛋白酶（Pepsin）是一種消化性蛋白酶，由胃部中的胃粘膜主細胞（gastric chief cell）所分泌，功能是將食物中的蛋白質分解為小的肽片段。","血管紧张肽I转化酶":"血管紧张肽I转化酶（Angiotensin-converting enzyme，又称为血管紧张素转化酶，简称为ACE）是一种外肽酶。","胰脂肪酶":"胰脂肪酶（Pancrelipases），特別是它的緩釋劑型(例如： Creon,  Pancreaze,  Pertzye,  Ultresa,  Zenpep) 是豬源性胰澱粉酶的商用混合物(作用於澱粉水解酶)，胰脂肪酶和胰凝乳蛋白酶（一種蛋白酶），其治療目的是為了給那些沒有足夠胰腺酶的嬰兒、小孩、成人在食物消化上的改善，因為它們會影響胰腺，如囊性纖維化、慢性胰腺炎或在胰腺和腸之間的通道堵塞等作用。","心肌梗死":"心肌梗死（Myocardial infarction簡稱MI、Acute myocardial infarction簡稱AMI），舊稱心肌梗塞，是一種急性及嚴重的心臟狀態。","心脏停止":"心脏停止（Cardiac arrest）或称为心搏停止，是心脏因不能够有效收缩，而导致血液循环停止的现象，症状包含丧失意识、呼吸异常或中止，有些患者在心搏骤止前还会胸痛、呼吸困难，以及恶心等症状心搏停止后若无获得治疗，一般会在数分钟内死亡。","心跳过速":"心跳过速（Tachycardia、tachyarrhythmia），也称心动过速、心跳过快。","心跳过慢":"心跳过慢（Bradycardia）也称心动过缓、心跳过缓、心动徐缓、徐脉。是指心脏跳动速度低于正常水平，达到每分钟50次以下的现象。","高血压":"高血压（Hypertension），全称动脉高血压（Arterial hypertension），是一种动脉血压升高的慢性病。血压的升高使心脏推动血液在血管内循环时的负担增大。","房室传导阻滞":"房室传导阻滞（Heart Block），为心脏电激动传导过程中，发生在心房和心室之间的电激动传导异常，可导致心律失常，使心脏不能正常收缩和泵血。","低血钠症":"低血钠症（Hyponatremia）是人体内血液中的钠含量过低时，所引起的临床病征。","低钙血症或低血钙症":"低钙血症或低血钙症（Hypocalcaemia）系指血清中的钙离子浓度过低的状况。","高碳酸血症":"高碳酸血症（Hypercapnia）是血液中二氧化碳(CO2)水平異常升高的情況。","肺栓塞":"肺栓塞（Pulmonary Embolism）是在醫學中，是一種臨床表現，由於病人的血管在的肺循環的部分，因為身體其他部位的血塊、腫瘤、脂肪、空氣、組織碎片或其他異物，導致部份肺血管阻塞的現象。","室上性心搏过速":"室上性心搏过速（Supraventricular tachycardia），简称SVT，是因为心脏电传导系统异常造成的心跳过速。主要可分四型：心房颤动、阵发性室上性心搏过速（PVST）、心房扑动、沃夫巴金森怀特症候群。症状包括心悸、头晕、盗汗、呼吸困难及胸痛等。","心室性心搏过速":"心室性心搏过速（Ventricular tachycardia，又被称作心室频脉）是一种因心室的电气活动异常造成的心跳过速。","心房颤动":"心房颤动（Atrial fibrillation，简称：Af 或 A-fib），又称为心房微颤、房颤、心房纤维性颤动、心房纤颤、房性纤颤等，是心脏不正常节律/心律不整的一种，特色是心脏快速而不规则的跳动。","心室颤动":"心室颤动（Ventricular fibrillation），简称V-fib或VF，中文简称为室颤，是指心脏因为心室的心脏电传导系统问题，造成心脏无效颤动，无法输送血液的情形，是心律不整的一种。","低血糖":"低血糖（Hypoglycemia、low blood sugar）是指血液中的葡萄糖濃度（血糖），特別是血漿中的，低於正常水平的現象，一般是治療糖尿病時的併發症，也可能是由多種原因所引起的，並導致一系列臨床的綜合症狀。","晕厥":"晕厥（Delirium）指的是大脑一时性缺血而导致短时间内丧失自主行动意识的表现。","窦性心律":"窦性心律（英文：sinus rhythm）是指，在一周期的心脏律动中，心肌的去极化从窦房结开始。","酸中毒":"酸中毒（Acidosis）是指血液中或其他身體組織中酸度升高的現象（即氫離子濃度升高）。","甲状腺功能亢进症":"甲状腺功能亢进症（Hyperthyroidism），又称甲状腺机能亢进症，简称甲状腺亢进、甲亢，是一种由于体内过量的三碘甲腺原氨酸（T3）和 四碘甲腺原氨酸（T4，也即甲状腺素）造成的临床症状。","甲状腺机能低下症":"甲状腺机能低下症（Hypothyroidism），又称作甲状腺功能减退症，简称甲减，是一种常见的由甲状腺分泌的甲状腺素不足导致内分泌疾病。","脑死亡":"脑死亡（Brain death），作为死亡判定的准则之一，通常指包括脑干在内的全脑部功能丧失的不可逆转的状态。","呼吸过缓":"呼吸过缓（Bradypnea）指即呼吸节律整齐但频率小于10次/分，常见于生命终末期或呼吸暂停前。","神经性厌食症":"神经性厌食症（Anorexia nervosa），一般称为厌食症（Anorexia）是一种进食障碍。","发烧":"发烧（Fever），又称作发热（英语：pyrexia）或发烧反应，其定义为：体温在调节时超过了平常体温。","高热":"高热（Hyperthermia），亦称体温过高是指由于体温调节失衡而导致的体温升高的症状。","失温症":"失温症（Hypothermia），又称低温症、低体温症。描述当人体核心温度低于35.0 °C（95.0 °F）时的现象。","哮喘":"哮喘（Asthma，又稱氣喘）是常見的氣道慢性炎症疾病，主要特徵是多變和復發的症狀、可逆性氣流阻塞，和支氣管痙攣。","心包填塞":"心包填塞（Cardiac tamponade）是指心包（包圍心臟的雙層膜囊）累積大量液體，並且壓迫心臟的情形。","烦躁":"烦躁（Dysphoria），一种正常的人类内在情绪，心中烦闷不安，急躁易怒，甚则手足动作及行为举止躁动不宁的表现。","昏睡":"昏睡（Somnolence）也稱為想睡，是有強烈想要睡眠的慾望，或是睡眠的時間異常的長（嗜睡症）。","清醒":"清醒（Alertness）指的是人腦和意識所處的一種狀態，在此期間個人能夠保持意識，完成一系列的認知任務，並對外界的刺激有所反應，如交流、步行、進食、交配等。","同理心":"同理心（英語：empathy）或稱做換位思考、神入或共情，是一種將自己置於他人的位置、並能夠理解或感受他人在其框架內所經歷的事物的能力。","幻觉":"幻觉（Hallucination）是指在没有客观刺激作用于相应感官的条件下，而感觉到的一种真实的、生动的知觉。","抑郁":"抑郁（Depression）是情绪低落、厌恶活动的一种状态，对人的思想、行为、感觉和身体健康都有一定影响。","睡眠":"睡眠（Sleep）又俗稱睡覺，是一種在哺乳動物、鳥類和魚類等生物中普遍存在的自然休息狀態，此外，在無脊椎動物，例如果蠅中也有這種現象。","血管紧张素受体":"血管紧张素受体（Angiotensin receptors）是以血管紧张素作为配体的G蛋白偶联受体。","GABAA受体":"GABAA受体（又称作γ-氨基丁酸A型受体）是一种离子型受体，而且是一类配体门控型离子通道。此通道的内源性配体是一种被称为GABA的神经递质。","肾上腺素能受体":"肾上腺素能受体（Adrenergic receptors，或称为肾上腺素受体）是一类接受儿茶酚胺类物质刺激的代谢型G蛋白偶联受体，所接受的儿茶酚胺类主要是去甲肾上腺素以及肾上腺素。","促卵泡激素受体":"促卵泡激素受体（Follicle-stimulating hormone receptor，FSH receptor，FSHR）是一种在卵巢、子宫和睾丸中发现的G蛋白偶联受体（GPCR），其激活是在繁殖期间的荷尔蒙运作所需的。","孕酮受体":"孕酮受体（英语：progesterone receptor，缩写PR，也被称为NR3C3 ，nuclear receptor subfamily 3, group C, member 3，即核受体第三亚族C组成员3）是一种细胞内蛋白质，由甾体激素孕酮激活。","促甲状腺激素释放激素受体":"促甲状腺激素释放激素受体（Thyrotropin-releasing hormone receptor，TRHR）是一种与三肽促甲状腺激素释放激素结合的G蛋白偶联受体。","促甲状腺激素受体":"促甲状腺激素受体（Thyrotropin receptor，TSH receptor，TSHR）是一种接受促甲状腺激素（thyrotropin）信号，刺激细胞生成甲状腺激素（T4）和三碘甲状腺激素（T3）的跨膜受体。","多巴胺转运体":"多巴胺转运体（Dopamine transporter，DAT）是负责将神经递质从突触运输回细胞质基质的跨膜蛋白。","去甲肾上腺素转运体":"去甲肾上腺素转运体（Norepinephrine_transporter，NET），是由SLC6A2基因编码的蛋白质。","痕量胺相关受体":"痕量胺相关受体（Trace amine-associated receptors，简称TAAR，有时也称trace amine receptors）是一种G蛋白偶联受体，于2001年发现。","人腦":"人腦（Brain）由大腦、小腦、間腦、腦幹組成。其中：大腦是中樞神經系統的最高級部分，也是腦的主要部分。分為左右兩個大腦半球，二者由神經纖維構成的胼胝體相連。","甲狀腺":"甲狀腺（Thyroid）是脊椎動物非常重要的腺體，屬於內分泌器官。在哺乳動物它位於頸部甲狀軟骨下方，氣管兩旁。人類的甲狀腺形似蝴蝶，猶如盾甲，故名。甲狀腺控制使用能量的速度、製造蛋白質、調節身體對其他荷爾蒙的敏感性。","心臟":"心臟（Heart）是一種在人類和其他動物都有的肌造器官，它的功用是推動循環系統中血管的血液。血液提供身體氧氣以及養分，同時也協助身體移除代謝廢棄物。","肝臟":"肝臟（Liver）為脊椎動物體內的一種器官，以代謝功能為主，並扮演著除去毒素，儲存醣原（肝醣），分泌性蛋白質合成等重要角色。","胰臟也稱胰腺":"胰臟也稱胰腺（Pancreas），舊稱膵、脺，脊椎動物具有外、內分泌功能的腺體；外分泌由腺泡、連通腸腔的導管組成，腺泡分泌多種消化酶，導管上皮細胞分泌碳酸氫鹽、鈉、鉀、氯等離子和水，合稱胰液。","脾臟":"脾臟（Spleen）是脊椎動物的一種外周淋巴器官。脾是人類成體最大的淋巴器官。在成體內的主要功能為儲存免疫細胞、濾血以及儲血。","小腸":"小腸（Small Intestine）是消化系統的一部分，從在胃部後面一直延伸至大腸，是進行食物消化與吸收的主要器官。","大腸":"大腸（Large Intestine）是脊椎動物消化系統的最後一部分。大腸的作用是從腸道內剩餘的可消化物質中吸取水分與電解質[1]，將剩餘的無用部分形成糞便並作暫時儲存以及最終排出糞便。","膽囊":"膽囊（Gallbladder），是位於右方肋骨下肝臟後方的梨形囊袋構造，有濃縮和儲存膽汁之用。","腎":"腎（Kidney）是脊椎動物體內的一種器官，屬於泌尿系統的一部分，負責過濾血液中的雜質、維持體液和電解質的平衡，最後產生尿液經由後續管道排出體外。","腎上腺":"腎上腺（Adrenal Gland）是呈三角形的內分泌腺體，位於腎臟上方，因而得名。其主要功能為通過合成皮質類甾醇和鄰苯二酚胺（例如皮質醇和腎上腺素）來調控身體對壓力產生的反應。","女性生殖系統":"女性生殖系統（Female Reproductive System）是由人類女性的生殖器官組成的系統。可分成內生殖器官和外生殖器官，分別指生殖系統在體內不可見的部分和體外可見的部分。人類女性的生殖系統在出生時尚未發育成熟，一直到青春期才發育成熟，可以產生配子（卵子），並且讓胎兒在體內成長（妊娠）。 ","男性生殖系統":"男性生殖系統（Male Reproductive System）是由男性許多生殖器官或組織組成。男性主要的性器官是製造精子的睪丸，以及分泌精液的陰莖，在和女性性交，精子可以使女性體內的卵細胞受精，受精卵會發展成為胎兒。","心電描記術":"心電描記術（心電圖 ECG | EKG）是一種經胸腔的以時間為單位記錄心臟的電生理活動，並通過皮膚上的電極捕捉並記錄下來的診療技術。","膽汁":"膽汁（Bile）是由肝細胞分泌出的一種汁液，存放於膽囊內，然後在進食時把膽汁經膽總管釋放入小腸幫助消化。膽汁的主要作用是乳化脂質。","腦電圖":"腦電圖（EEG）是透過醫學儀器腦電圖描記儀，將人體腦部自身產生的微弱生物電於頭皮處收集，並放大記錄而得到的曲線圖。","自主神經系統":"自主神經系統（Autonomic Nervous System，ANS），與軀體神經系統共同組成脊椎動物的周圍神經系統。未受訓練的人無法靠意識控制該部分神經的活動。自主神經系統控制體內各器官系統的平滑肌、心肌、腺體等組織的功能,如心臟搏動、呼吸、血壓、消化和新陳代謝。","氣體分壓":"氣體分壓（Partial pressure）指的是當氣體混合物中的某一種組分在相同的溫度下佔據氣體混合物相同的體積時，該組分所形成的壓力。氧氣可以少量溶於血液中之後為血紅蛋白結合，故血液中的氧分壓隨之成為血氣分析的一個重要指標。","紅細胞":"紅細胞（Red blood cells, RBCs），又稱為紅血球或血紅細胞，是血液中數量最多的一種血球，同時也是脊椎動物體內通過血液將氧氣從肺或鰓運送到身體各個組織的最主要的媒介。","血液酒精濃度":"血液酒精濃度（縮寫：BAC）是用於法律或醫學目的度量酒精中毒的指標。通常的度量單位為：單位體積血液中的酒精質量或體積的百分比。","新鮮冷凍血漿":"新鮮冷凍血漿（FFP）為一從全血制備而成的血液製品，一般是在採集全血後八小時內分離制備，用於治療體內凝血因子過低（INR>1.5）或是血漿蛋白過少之患者，也做為血漿置換的置換液，通常會建議（但非必要）使用ABO血型相符的血漿。","腎上腺素":"腎上腺素（Epinephrine或Adrenaline）, 是腎上腺髓質分泌的激素及神經傳導物質，也是一種藥物。腎上腺素被應用於治療多項疾病，包含全身性過敏反應、心搏停止，以及表面出血等等，吸入式的腎上腺素有時會被用於改善義膜性喉炎的症狀。","去甲腎上腺素":"去甲腎上腺素（Norepinephrine、nor-epinephrine，NE或NA），舊稱正腎上腺素，是腎上腺素去掉 N-甲基後形成的物質，在化學結構上也屬於兒茶酚胺。","組胺":"組胺（Histamine），是一種有機含氮化合物。它參與局部免疫反應和炎症反應，並具有作為瘙癢介體中心和調節腸道生理功能的作用。它還被用作神經遞質。組胺由嗜鹼性球和附近結締組織肥大細胞產生。","三碘甲狀腺原氨酸":"三碘甲狀腺原氨酸（T3）是一種甲狀腺激素，幾乎對所有生理過程都產生影響，包括生長和發育，代謝，體溫，和心率。","前列環素":"前列環素（英語：Prostacyclin，簡稱為PGI2）是脂類中類花生酸家族中的一個成員，分子中有一個次級五元環，其前體是花生四烯酸或其他二十碳不飽和脂肪酸。","血管緊張素":"血管緊張素（Angiotensin），亦稱血管收縮素、血管張力素，是一種寡肽類激素，是腎素-血管收縮素系統（renin-angiotensin system）的重要組成部分。","膽囊收縮素":"膽囊收縮素（Cholecystokinin，簡稱CCK或CCK-PZ）是一種消化系統當中的肽類激素，可以促進脂肪與蛋白質的消化。","心房鈉尿肽":"心房鈉尿肽（Atrial natriuretic peptide），心房鈉尿肽是一種肽荷爾蒙，主要由心房的心肌細胞生產、儲存和分泌。","促腎上腺皮質激素":"促腎上腺皮質激素（Adrenocorticotropic hormone, ACTH）是一種多肽激素，生產並分泌於腦垂體，是下丘腦-腦垂體-腎上腺皮質軸（hypothalamic-pituitary-adrenal axis）中的重要化學物質。","催產素":"催產素（Oxytocin，又稱縮宮素，簡稱為OT）是一種哺乳動物激素，是肽類激素也是神經肽，一般是由下丘腦產生，由垂體後葉分泌。","甲狀腺促素釋素簡稱甲釋素":"甲狀腺促素釋素簡稱甲釋素（Thyrotropin releasing hormone、TRH），是由下視丘（Hypothalamus）所製造的肽類激素（Peptide Hormone），能夠調節腦下垂體前葉分泌促甲狀腺激素（甲促素，thyroid stimulating hormone、TSH）與催乳素。","副甲狀腺素":"副甲狀腺素（Parathyroid hormone，簡稱為PTH），是一種由頸部的副甲狀腺分泌，具有84個胺基酸的多肽類激素。","降鈣素":"降鈣素（Calcitonin，又譯為抑鈣激素）是一種含有32個胺基酸的直線型多肽類激素，在人體里是由甲狀腺的濾泡旁細胞（parafollicular cells，又稱C細胞）製造。","促性腺素釋素":"促性腺素釋素（Gonadotropin-Releasing Hormone，簡稱為GnRH），在下丘腦中合成，是一種多肽荷爾蒙，它的主要功能是使垂體釋放卵泡刺激素（FSH）和黃體化激素（LH）。","黃體化激素":"黃體化激素（Luteinizing hormone，LH），是一種在腦下垂體前葉合成的荷爾蒙。它的形成是受到促性腺激素釋放激素(GnRH)的控制。","神經降壓素":"神經降壓素（Neurotensin，NT）又名神經降壓肽，因其具有明顯的降壓作用且存在於神經組織而得名。","皮質醇":"皮質醇（法語：cortisol），又譯成可體松，屬於腎上腺分泌的腎上腺皮質激素之中的糖皮質激素，在應付壓力中扮演重要角色，故又被稱為「壓力荷爾蒙」。","睪酮":"睪酮（Testosterone）（又稱睪固酮、睪丸素、睪丸酮或睪甾酮、睪脂酮）是類固醇激素，由男性的睪丸或女性的卵巢分泌，腎上腺亦分泌少量睪酮。","乙酰膽鹼":"乙酰膽鹼（Acetylcholine, ACh）為中樞及周邊神經系統中常見的神經傳導物質，於自主神經系統及體運動神經系統中參與神經傳導。","嗜酸性粒細胞":"嗜酸性粒細胞（Eosinophil granulocyte）是粒細胞中含有嗜酸性顆粒的一種，其他兩種是中性粒細胞和嗜鹼性粒細胞。","中性粒細胞":"中性粒細胞（Neutrophil或 Neutrophil granulocyte）是血液白細胞的一種，也是哺乳動物血液中最主要的一種白細胞。","淋巴細胞":"淋巴細胞（Lymphocyte），也稱淋巴球，為白細胞中體積最小的一種，直徑6—8微米；在人體約佔白細胞的20—30%，圓形細胞核，細胞質很少。","巨噬細胞":"巨噬細胞（Macrophage）是一種位於組織內的白血球，源自單核球，而單核球又來源於骨髓中的前體細胞。","肥大細胞":"肥大細胞（Mast cell），可分兩種，黏膜肥大細胞（mucosal mast cell）與結締組織肥大細胞（connective tissue mast cell），其中黏膜肥大細胞（MMC）必需依賴T細胞才能增殖。","嗜鹼性球或嗜鹼性粒細胞":"嗜鹼性球或嗜鹼性粒細胞（Basophil granulocyte、basophils）是一種最少見的粒細胞，約佔循環系統中白血球的0.01%至0.3%。","大腸桿菌":"大腸桿菌（Escherichia coli，E. coli）是人和動物腸道中著名的一種細菌，主要寄生於大腸內，約佔腸道菌中的0.1%。","人類免疫缺乏病毒":"人類免疫缺乏病毒（Human immunodeficiency virus，縮寫為HIV）是一種感染人類免疫系統細胞的慢病毒，屬反轉錄病毒的一種。","諾如病毒":"諾如病毒（Norovirus，NV），又稱為諾羅病毒、諾沃克病毒或膿融病毒，是一種引起非細菌性急性胃腸炎的病毒。","輪狀病毒":"輪狀病毒（Rotavirus，簡稱RV）是一種雙鏈核糖核酸病毒，屬於呼腸孤病毒科。","煙酰胺腺嘌呤二核苷酸":"煙酰胺腺嘌呤二核苷酸（Nicotinamide adenine dinucleotide，NAD+），是一種轉遞質子（更準確來說是氫離子）的輔酶，它出現在細胞很多代謝反應中。","鈉":"鈉（Sodium，化學符號：Na）是一種化學元素，它的原子序數是11，相對原子質量為23。","鎂":"鎂（Magnesium,  化學符號：Mg）是一種化學元素，它的原子序數是12，是一種銀白色的鹼土金屬。","蛋白質":"蛋白質（英語：protein）是大型生物分子，或高分子，它由一個或多個由α-氨基酸殘基組成的長鏈條組成。","澱粉":"澱粉（英語：starch, amylum）是由通過糖苷鍵連接的大量葡萄糖單元組成的聚合碳水化合物，屬於一種多醣。","麥芽糖":"麥芽糖（英語：Maltose）又名膠飴，其色紫凝如深琥珀色，色白而枯者，為餳糖不入藥用。","華法林":"華法林（Warfarin）是一種只可口服的抗凝血素，學名為苄丙酮香豆素，一般都以苄丙酮香豆素鈉來儲存及處方。","賽庚啶":"賽庚啶（Cyproheptadine）為抗過敏藥，對抗體內組胺對血管、支氣管平滑肌的作用，從而消除過敏症狀。","厄貝沙坦":"厄貝沙坦（Irbesartan）是一種血管緊張素II受體拮抗劑，主要用於高血壓的治療。","普萘洛爾":"普萘洛爾（Propranolol）屬於一種非選擇性Β受體阻斷藥，常用於治療高血壓、多種心律不整、甲狀腺功能亢進症、微血管瘤、表演焦慮症，以及本態性顫抖等。","阿替洛爾":"阿替洛爾（Atenolol）是一種選擇性的β1腎上腺素受體拮抗劑，β-受體阻滯藥的一種，用於治療心血管疾病。","纈沙坦":"纈沙坦（英語：Valsartan），是一款血管緊張素II受體拮抗劑抗高血壓類藥物，該藥物是起到使血管緊張素Ⅱ的I型(AT1)受體封閉，血管緊張素Ⅱ血漿水平升高，刺激未封閉的AT2受體，同時抗衡AT1受體的作用，從而達到擴張血管降低血壓的效果。","奧美沙坦":"奧美沙坦（Olmesartan) 是一款血管緊張素II受體拮抗劑藥物，用於治療高血壓症。","勞拉西泮":"勞拉西泮（Lorazepam），商品名羅拉、安定文錠或阿提凡（Ativan）是苯二氮䓬類（BZD）藥物。可用來治療焦慮症、失眠、包括癲癇重積狀態在內的積極癲癇發作、酒精戒斷症候群、化療引起的噁心和嘔吐，也用在手術中的保護性失憶，以及機械式呼吸輔助患者的鎮靜劑。","對乙酰氨基酚":"對乙酰氨基酚（Acetaminophen），又稱乙醯胺酚或撲熱息痛（Paracetamol），簡稱APAP。是一種廣泛使用的非處方止痛及退燒藥。可用於緩解輕度至中度的疼痛，本品對於孩童的退燒效果仍未有決定性結論。本品常與多種感冒藥合併使用。","琥珀膽鹼":"琥珀膽鹼（Succinylcholine）是一種煙鹼型乙酰膽鹼受體（英語：Nicotinic acetylcholine receptor）阻斷劑。它屬於去極化肌肉鬆弛劑，被用於全身麻醉及破傷風等。","多沙普侖":"多沙普侖（Doxapram）能直接興奮延髓呼吸中樞與血管運動中樞，作用原理是可通過頸動脈化學感受器、興奮呼吸中樞、其特點是作用快，維持時間短。臨床用於麻醉藥、中樞抑制藥引起的中樞抑制。","內啡肽":"內啡肽（Endorphin），亦稱腦內啡、腦內嗎啡或音譯安多酚，是可於動物體內自行生成的類嗎啡生物化學合成物，是由脊椎動物的腦下垂體和丘腦下部所分泌的氨基化合物（肽）。","氫可酮":"氫可酮（Hydrocodone）是一種半合成自可待因（一種發現與罌粟中的鴉片類生物鹼）的鴉片類鎮痛藥。","嗎啡":"嗎啡（Morphine）為一種鴉片類止痛劑，會直接作用於中樞神經系統，改變人體對疼痛的感覺。","羥考酮":"羥考酮（Oxycodone）是從生物鹼蒂巴因（thebaine）中提取的半合成阿片類藥物，作為強效鎮痛藥在臨床上應用已有80多年的歷史。由於羥考酮生物利用度高，給藥途徑多，因而在臨床上應用廣泛。","納洛酮":"納洛酮（Naloxone），又常以商品名「Narcan」販售。該藥物可以緩解攝入過量鴉片類藥物所造成的影響。","二甲雙胍":"二甲雙胍（Metformin），常見商品名格華止、庫魯化（Glucophage），為治療2型糖尿病的一線藥物，特別是針對超重的患者。","亞甲二氧甲基苯丙胺":"亞甲二氧甲基苯丙胺（3,4-亞甲二氧甲基苯丙胺，簡稱MDMA），MDMA屬於苯丙胺類興奮劑，是一種精神藥物，常用作娛樂性藥物。預期效應有增加同理心及欣快感，也會有感覺增強的效果。","賽洛西賓":"賽洛西賓（Psilocybin）是致幻劑脫磷酸裸蓋菇素的前藥，後者是裸蓋菇素的活性代謝物和其全部精神作用的產生源。","脫磷酸裸蓋菇素":"脫磷酸裸蓋菇素（Psilocin）是一種致幻性蘑菇生物鹼，與磷酸化的裸蓋菇素共見於多數迷幻蘑菇中。","麥角酸二乙酰胺":"麥角酸二乙酰胺（Lysergic acid diethylamide，德文 Lyserg-Säure-Diäthylamid），常簡稱為LSD，是一種強烈的半人工啓靈藥。","麥司卡林":"麥司卡林（Mescaline），學名三甲氧苯乙胺，俗稱仙人掌毒鹼，屬於苯乙胺的衍生物。","四氫大麻酚":"四氫大麻酚（Tetrahydrocannabinol），簡稱THC，），是大麻中的主要精神活性物質。","血管緊張肽I轉化酶":"血管緊張肽I轉化酶（Angiotensin-converting enzyme，又稱為血管緊張素轉化酶，簡稱為ACE）是一種外肽酶。","心臟停止":"心臟停止（Cardiac arrest）或稱為心搏停止，是心臟因不能夠有效收縮，而導致血液循環停止的現象，症狀包含喪失意識、呼吸異常或中止，有些患者在心搏驟止前還會胸痛、呼吸困難，以及惡心等症狀心搏停止後若無獲得治療，一般會在數分鐘內死亡。","心跳過速":"心跳過速（Tachycardia、tachyarrhythmia），也稱心動過速、心跳過快。","心跳過慢":"心跳過慢（Bradycardia）也稱心動過緩、心跳過緩、心動徐緩、徐脈。是指心臟跳動速度低於正常水平，達到每分鐘50次以下的現象。","高血壓":"高血壓（Hypertension），全稱動脈高血壓（Arterial hypertension），是一種動脈血壓升高的慢性病。血壓的升高使心臟推動血液在血管內循環時的負擔增大。","房室傳導阻滯":"房室傳導阻滯（Heart Block），為心臟電激動傳導過程中，發生在心房和心室之間的電激動傳導異常，可導致心律失常，使心臟不能正常收縮和泵血。","低血鈉症":"低血鈉症（Hyponatremia）是人體內血液中的鈉含量過低時，所引起的臨床病徵。","低鈣血症或低血鈣症":"低鈣血症或低血鈣症（Hypocalcaemia）系指血清中的鈣離子濃度過低的狀況。","室上性心搏過速":"室上性心搏過速（Supraventricular tachycardia），簡稱SVT，是因為心臟電傳導系統異常造成的心跳過速。主要可分四型：心房顫動、陣發性室上性心搏過速（PVST）、心房撲動、沃夫巴金森懷特症候群。症狀包括心悸、頭暈、盜汗、呼吸困難及胸痛等。","心室性心搏過速":"心室性心搏過速（Ventricular tachycardia，又被稱作心室頻脈）是一種因心室的電氣活動異常造成的心跳過速。","心房顫動":"心房顫動（Atrial fibrillation，簡稱：Af 或 A-fib），又稱為心房微顫、房顫、心房纖維性顫動、心房纖顫、房性纖顫等，是心臟不正常節律/心律不整的一種，特色是心臟快速而不規則的跳動。","心室顫動":"心室顫動（Ventricular fibrillation），簡稱V-fib或VF，中文簡稱為室顫，是指心臟因為心室的心臟電傳導系統問題，造成心臟無效顫動，無法輸送血液的情形，是心律不整的一種。","暈厥":"暈厥（Delirium）指的是大腦一時性缺血而導致短時間內喪失自主行動意識的表現。","竇性心律":"竇性心律（英文：sinus rhythm）是指，在一週期的心臟律動中，心肌的去極化從竇房結開始。","甲狀腺功能亢進症":"甲狀腺功能亢進症（Hyperthyroidism），又稱甲狀腺機能亢進症，簡稱甲狀腺亢進、甲亢，是一種由於體內過量的三碘甲腺原氨酸（T3）和 四碘甲腺原氨酸（T4，也即甲狀腺素）造成的臨床症狀。","甲狀腺機能低下症":"甲狀腺機能低下症（Hypothyroidism），又稱作甲狀腺功能減退症，簡稱甲減，是一種常見的由甲狀腺分泌的甲狀腺素不足導致內分泌疾病。","腦死亡":"腦死亡（Brain death），作為死亡判定的准則之一，通常指包括腦幹在內的全腦部功能喪失的不可逆轉的狀態。","呼吸過緩":"呼吸過緩（Bradypnea）指即呼吸節律整齊但頻率小於10次/分，常見於生命終末期或呼吸暫停前。","神經性厭食症":"神經性厭食症（Anorexia nervosa），一般稱為厭食症（Anorexia）是一種進食障礙。","發燒":"發燒（Fever），又稱作發熱（英語：pyrexia）或發燒反應，其定義為：體溫在調節時超過了平常體溫。","高熱":"高熱（Hyperthermia），亦稱體溫過高是指由於體溫調節失衡而導致的體溫升高的症狀。","失溫症":"失溫症（Hypothermia），又稱低溫症、低體溫症。描述當人體核心溫度低於35.0 °C（95.0 °F）時的現象。","煩躁":"煩躁（Dysphoria），一種正常的人類內在情緒，心中煩悶不安，急躁易怒，甚則手足動作及行為舉止躁動不寧的表現。","幻覺":"幻覺（Hallucination）是指在沒有客觀刺激作用於相應感官的條件下，而感覺到的一種真實的、生動的知覺。","抑鬱":"抑鬱（Depression）是情緒低落、厭惡活動的一種狀態，對人的思想、行為、感覺和身體健康都有一定影響。","血管緊張素受體":"血管緊張素受體（Angiotensin receptors）是以血管緊張素作為配體的G蛋白偶聯受體。","GABAA受體":"GABAA受體（又稱作γ-氨基丁酸A型受體）是一種離子型受體，而且是一類配體門控型離子通道。此通道的內源性配體是一種被稱為GABA的神經遞質。","腎上腺素能受體":"腎上腺素能受體（Adrenergic receptors，或稱為腎上腺素受體）是一類接受兒茶酚胺類物質刺激的代謝型G蛋白偶聯受體，所接受的兒茶酚胺類主要是去甲腎上腺素以及腎上腺素。","促卵泡激素受體":"促卵泡激素受體（Follicle-stimulating hormone receptor，FSH receptor，FSHR）是一種在卵巢、子宮和睪丸中發現的G蛋白偶聯受體（GPCR），其激活是在繁殖期間的荷爾蒙運作所需的。","孕酮受體":"孕酮受體（英語：progesterone receptor，縮寫PR，也被稱為NR3C3 ，nuclear receptor subfamily 3, group C, member 3，即核受體第三亞族C組成員3）是一種細胞內蛋白質，由甾體激素孕酮激活。","促甲狀腺激素釋放激素受體":"促甲狀腺激素釋放激素受體（Thyrotropin-releasing hormone receptor，TRHR）是一種與三肽促甲狀腺激素釋放激素結合的G蛋白偶聯受體。","促甲狀腺激素受體":"促甲狀腺激素受體（Thyrotropin receptor，TSH receptor，TSHR）是一種接受促甲狀腺激素（thyrotropin）信號，刺激細胞生成甲狀腺激素（T4）和三碘甲狀腺激素（T3）的跨膜受體。","多巴胺轉運體":"多巴胺轉運體（Dopamine transporter，DAT）是負責將神經遞質從突觸運輸回細胞質基質的跨膜蛋白。","去甲腎上腺素轉運體":"去甲腎上腺素轉運體（Norepinephrine_transporter，NET），是由SLC6A2基因編碼的蛋白質。","痕量胺相關受體":"痕量胺相關受體（Trace amine-associated receptors，簡稱TAAR，有時也稱trace amine receptors）是一種G蛋白偶聯受體，於2001年發現。"}};
const CAL = {"_meta":{"source":"校准常量表 (生理模型)","notes":"字段=生理模型常量; 置信度 high=语义明确, med=上下文推断"},"heart":{"sa_node_rate_bpm":60,"av_node_rate_bpm":40,"epi_max_rate_mult":3,"beta1_max_effect":0.6,"symp_gain":0.02,"vagal_gain":0.1,"baroreceptor_strain_range":2.1,"baroreceptor_slope":7,"volume_receptor_thresh_mmhg":80,"volume_receptor_gain":0.03,"ef_ventricula":0.68,"atrial_pump_frac":0.35,"myo_depola_set":[0.02,0.1,0.01,0.05,-0.3,1.3],"compress_front":0.8,"cpr_effectiveness":0.4,"tamponade_rate":0.3},"vascular":{"_units":"LMVascular 血管动作效应(相对流量/阻力增量)","alpha1_flow":-20,"beta1_flow":20,"beta2_dilate":35,"ep2_dilate":35,"angiotensin2":-20,"vasopressin":-20,"gcr":20,"anp":15,"h1":10,"iprostanoid":10,"thromboxane":-20,"symp_vasomotor":-0.2,"tkr_sensitivity":1000,"glucagon":400,"circ_fractions":{"aorta_compliance":0.86,"arteriole":0.14,"capillary":0.1,"venous":0.06,"blood_volume_ml":3000}},"respiration":{"co2_gain":3.5,"co2_drive_gain":0.035,"resp_gain_mult":[10,4],"central_chemo":{"gain":5,"co2_baseline":2000,"rate_mult":3},"peripheral_chemo":{"spo2_knee":[7,8,2,10,3]},"airway":{"beta2":-0.1,"h1":-0.2,"cysltr1":-0.95,"ep2":0.25},"vent_eff":[1000,4000],"tidal_norm":0.5},"kidney":{"gfr_base_mlmin":60,"filtration_coef":1.45,"alpha1_rbf":-30,"d1_rbf":3,"aldosterone_retention":[0.05,0.15,0.2,0.3],"vasopressin_water":[0.2,0.3],"anp_excrete":0.3,"renin_response":0.4,"granular_gain":0.012},"endocrine":{"pancreas_beta_gain":-0.006,"pancreas_beta_span":1000,"pancreas_alpha_gain":0.004,"glucagon_span":1000,"thyroid_tsh":1,"thyroid_t3_rate":0.088,"thyroid_span":100,"liver_insulin_storage":1e-05,"adrenal_acth":50,"hpa_crh":5},"cns":{"mu_resp_depression":-0.8,"mu_euphoria":-0.5,"mu_mu3":0.25,"delta_reward":[3,-5],"kappa":[-3,0.5],"gaba_cns":-1.5,"nmda_cns":-1.5,"alpha2_cns":-0.5,"cb1_apetite":0.15,"cb1_cns":-0.5,"nachr_alert":3,"nachr_gain":0.15,"d2_gain":2.5,"d4_gain":8.5,"dr_x":-0.5,"dat_reuptake":10,"dat_affinity":0.01,"sert_reuptake":10,"taar":[10,-0.5],"bbb_pass":0.08,"thermo_setpoint":37,"fever_thresholds":[35,38,40]},"blood":{"svo2_base":0.98,"po2_frac":0.02,"hct":0.3,"erythrocyte_ul":5800000.0,"leukocyte":3500000.0,"platelet":300000000.0,"plasma_ml":5000000,"spleen_storage_frac":[0.15,0.15,0.98,0.02],"oxycurve":[0.9,-0.9,0.4,0.1,0.6,0.8,-0.8,0.15,0.1,0.45]},"receptors":{"assoc_rate":0.01,"dissoc_pool":60,"partial_efficacy":0.5,"ligand_scale":500000,"agonist_default":50},"medication":{"route_scalar":[50,40,10,1,0.002]}};

// ================= 数据层 =================
const ENUMS = GAMEDATA.enums, ZH = GAMEDATA.name_map, ENCYC = GAMEDATA.encyc;
const CHEMS = ENUMS.ChemicalType, ROUTES = ENUMS.AdministrationType, HORMONES = ENUMS.HormoneType;
const zhOf = n => ZH[n] || n;

const PHARM = {
  Epinephrine:{a:[['α1Adrenoceptor',1,1.2],['β1Adrenoceptor',1,1.1],['β2Adrenoceptor',1,.7]]},
  Norepinephrine:{a:[['α1Adrenoceptor',1,1.4],['β1Adrenoceptor',1,.6]]},
  Dopamine:{a:[['D1',1,.8],['β1Adrenoceptor',1,.7],['α1Adrenoceptor',1,.4]]},
  Dobutamine:{a:[['β1Adrenoceptor',1,1.3],['α1Adrenoceptor',1,.2]]},
  Isoprenaline:{a:[['β1Adrenoceptor',1,1.2],['β2Adrenoceptor',1,1.2]]},
  Ephedrine:{a:[['α1Adrenoceptor',1,.5],['β1Adrenoceptor',1,.5]]},
  Atropine:{a:[['M2',-1,1.3]]},
  Salbutamol:{a:[['β2Adrenoceptor',1,1.3]]}, Albuterol:{a:[['β2Adrenoceptor',1,1.3]]},
  Salmeterol:{a:[[' β2Adrenoceptor'.trim(),1,.9]],d:{}},
  Amlodipine:{d:{ccb:1}}, Nifedipine:{d:{ccb:1}},
  Propranolol:{a:[['β1Adrenoceptor',-1,1.2],['β2Adrenoceptor',-1,.9]]},
  Metoprolol:{a:[['β1Adrenoceptor',-1,1.3]]}, Atenolol:{a:[['β1Adrenoceptor',-1,1.2]]},
  Labetalol:{a:[['β1Adrenoceptor',-1,1.1],['α1Adrenoceptor',-1,.8]]},
  Lisinopril:{d:{acei:1}}, Captopril:{d:{acei:1}}, Enalapril:{d:{acei:1}},
  Losartan:{d:{arb:1}}, Olmesartan:{d:{arb:1}}, Irbesartan:{d:{arb:1}}, Valsartan:{d:{arb:1}},
  Nitroglycerin:{d:{svrD:2.4}},
  Amiodarone:{a:[['β1Adrenoceptor',-.3,.5]],d:{amio:1}},
  Adenosine:{a:[['A1',1,2.0]],d:{short:1}},
  Morphine:{a:[['μR',1,1.2]],d:{cnsD:.9}}, Fentanyl:{a:[['μR',1,1.6]],d:{cnsD:.9}},
  Heroin:{a:[['μR',1,1.8]],d:{cnsD:1.1}}, Codeine:{a:[['μR',1,.35]],d:{cnsD:.4}},
  Oxycodone:{a:[['μR',1,.9]],d:{cnsD:.8}}, Hydrocodone:{a:[['μR',1,.8]],d:{cnsD:.8}},
  Endorphin:{a:[['μR',1,.7]],d:{cnsD:.4}}, Naloxone:{a:[['μR',-1,2.5]]},
  Diazepam:{a:[['GABAA',1,1.1]],d:{cnsD:.8}}, Lorazepam:{a:[['GABAA',1,1.2]],d:{cnsD:.8}},
  Phenobarbital:{a:[['GABAA',1,.8]],d:{cnsD:1.0,long:1}}, Barbital:{a:[['GABAA',1,.6]],d:{cnsD:.9,long:1}},
  Dexmedetomidine:{a:[['α2Adrenoceptor',1,1.2]],d:{cnsD:.5}},
  Chlorpromazine:{a:[['D2',-1,.8],['α1Adrenoceptor',-.3,.5]],d:{cnsD:.4}},
  Clozapine:{a:[['D2',-1,.4],['SerotoninReceptor2A',-1,.5]],d:{cnsD:.3}},
  Caffeine:{a:[['A1',-1,1.0]],d:{cnsE:.8,vlong:1}},   // vlong: t½≈5h 腺苷受体竞争→提神
  Nicotine:{a:[['nAChR',1,.9]],d:{hrE:.3}},
  Cocaine:{a:[['DAT',-1,1.5],['α1Adrenoceptor',1,.7]],d:{cnsE:1.4}},
  Amphetamine:{a:[['DAT',-1,1.2],['NET',-1,1.1]],d:{cnsE:1.3}},
  Methamphetamine:{a:[['DAT',-1,1.5],['NET',-1,1.3]],d:{cnsE:1.6}},
  MDMA:{a:[['SERT',-1,1.4],['DAT',-1,.5]],d:{cnsE:1.2,temp:.5}},
  LSD:{a:[['SerotoninReceptor2A',1,1.4]],d:{haluc:1}},
  Psilocybin:{a:[['SerotoninReceptor2A',1,1.0]],d:{haluc:.8}},
  DMT:{a:[['SerotoninReceptor2A',1,1.1]],d:{haluc:.9}},
  THC:{a:[['CB1',1,1.3]],d:{cnsD:.5,hrE:.2,haluc:.4}},
  CBD:{a:[['CB1',-.4,.7]],d:{cnsD:.2}},
  Ethanol:{a:[['GABAA',1,.5],['NMDAReceptor',-1,.4]],d:{cnsD:.7,hrE:.15}},
  Diphenhydramine:{a:[['H1',-1,1.2]],d:{cnsD:.5}},
  Chlorpheniramine:{a:[['H1',-1,1.1]],d:{cnsD:.4}},
  Loratadine:{a:[['H1',-1,1.0]],d:{cnsD:.06}},
  Cetirizine:{a:[['H1',-1,1.1]],d:{cnsD:.1}},
  Cyproheptadine:{a:[['H1',-1,.9],['SerotoninReceptor2A',-1,.4]],d:{cnsD:.3}},
  Famotidine:{a:[['H2',-1,1.2]]},
  Insulin:{d:{insulin:1.6}}, Glucagon:{a:[['GlucagonReceptor',1,1.2]]},
  Glucose:{d:{glucoseRise:1}}, Omeprazole:{d:{ppi:1}},
  Aspirin:{a:[['COX1',-1,1.3]],d:{tempD:.6}}, Ibuprofen:{a:[['COX1',-1,.9],['COX2',-1,.9]],d:{tempD:.5}},
  Naproxen:{a:[['COX1',-1,1.0],['COX2',-1,1.0]],d:{tempD:.5}}, Acetaminophen:{a:[['COX2',-1,.6]],d:{tempD:.5}},
  Heparin:{d:{antiCoag:1}}, Warfarin:{d:{antiCoag:.8,long:1}},
  Potassium:{d:{kRise:1}}, Calcium:{d:{caRise:1}}, Sodium:{d:{naRise:0.5}}, HCO3:{d:{buffer:1}}, Plasma:{d:{fluid:1}},
  Magnesium:{d:{mg:1}},   // 阶段5: 硫酸镁膜稳定—ChemicalType 第 13 项(既有化学物, 补受体/药效映射): 抑制心肌/血管平滑肌兴奋性
  Metformin:{d:{gluLower:.3,long:1}}, Succinylcholine:{a:[['nAChR',1,1.5]],d:{paralyze:1}},
  O2:{d:{o2:1}}, N2O:{d:{o2:.4,cnsE:.3}},
  Levonorgestrel:{a:[['PR',1,1.0]]}, Doxapram:{d:{respE:1.5}}, H2O2:{d:{toxin:.5}},
  Cortisol:{a:[['GCR',1,1.2]]}, Dexamethasone:{a:[['GCR',1,1.4]]},
  Aldosterone:{a:[['MineralocorticoidReceptor',1,1.3]]},
  AngiotensinII:{a:[['AGTReceptor',1,1.5]]}, Vasopressin:{a:[['Vasopressin1',1,1.4]]},
  Acetylcholine:{a:[['M2',1,1.2],['nAChR',1,.5]]},
  Histamine:{a:[['H1',1,1.5],['H2',1,1.0]]},
  Serotonin:{a:[['SerotoninReceptor2A',1,.5],['SerotoninReceptor1A',1,.4]]},
  T3:{a:[['TR',1,.8]]}, T4:{a:[['TR',1,.4]]}, TSH:{a:[['TSHR',1,.9]]},
  ANP:{a:[['ANPReceptor',1,1.2]]}, Melatonin:{a:[['MelatoninReceptor',1,1.0]],d:{cnsD:.3}},
  Oxytocin:{d:{}}, Testosterone:{d:{}}
};
const CATS = {
  '血管活性-肾上腺素能':['Epinephrine','Norepinephrine','Dopamine','Dobutamine','Isoprenaline','Ephedrine'],
  '降压药':['Amlodipine','Nifedipine','Labetalol','Propranolol','Metoprolol','Atenolol','Lisinopril','Captopril','Enalapril','Losartan','Olmesartan','Irbesartan','Valsartan','Nitroglycerin'],
  '抗心律失常':['Amiodarone','Adenosine','Atropine','Succinylcholine'],
  '呼吸系统':['Salbutamol','Albuterol','Salmeterol','O2','N2O','Doxapram'],
  '血液-电解质':['Heparin','Warfarin','Aspirin','Ibuprofen','Naproxen','Acetaminophen','Plasma','HCO3','Potassium','Calcium','Iron'],
  '代谢内分泌':['Insulin','Glucagon','Glucose','Metformin','Levonorgestrel'],
  '阿片类':['Morphine','Fentanyl','Heroin','Codeine','Oxycodone','Hydrocodone','Endorphin','Naloxone'],
  '镇静精神':['Diazepam','Lorazepam','Phenobarbital','Barbital','Chlorpromazine','Clozapine','Dexmedetomidine','Caffeine','Nicotine'],
  '娱乐性药物':['Ethanol','Cocaine','Amphetamine','Methamphetamine','MDMA','LSD','Psilocybin','DMT','THC','CBD'],
  '抗过敏':['Diphenhydramine','Chlorpheniramine','Loratadine','Cetirizine','Cyproheptadine','Famotidine','Histamine'],
  '消化系统':['Omeprazole','HCl2','Urea'],
  '内源性激素/介质':['Epinephrine','Norepinephrine','Dopamine','Adenosine','Acetylcholine','Serotonin','Insulin','Glucagon','Cortisol','Dexamethasone','Aldosterone','AngiotensinII','Vasopressin','ANP','T3','T4','TSH','Melatonin','Oxytocin','Testosterone'],
  '营养与其他':['Sodium','Chloride','Glucose','Protein','Triglyceride','Cholesterol','H2O2','CRP','Troponin','Iron','Iodine','Magnesium']
};
// ============ 生理引擎（校准常量） ============
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// ============ LMFRS 女性生殖周期（阶段3 · 复刻 LMFRS.MenstrualPhase/UterusPhase） ============
// 来源命名: dump.cs LMFRS{MenstrualPhase Follicular/Ovulation/Luteal · UPhase Menstruation/Proliferative/Secretory
//          · FollicleMaturation/LutealMaturation/Proliferation/Menstruation · GnRH→FSH/LH 轴}
// 激素名: webdata.json HormoneType FSH/Estradiol(雌二醇 E2)/Progesterone(孕酮 P4)/LH/GnRH/ProstaglandinF2α
// 时间标度: 本页 tick 为 1 实秒=1 模拟秒 —— 取 1 周期天=60 模拟秒 → 28 天周期 ≈ 28 分钟正常游玩可见
const FRSC={DAY:60,LEN:28,MENS_TAIL:5,OV:[13,14],DAY0:305};   // 开局定位于周期第 6 天(增殖期), 避开月经窗
ZH['FSH']='促卵泡激素';
// === 补充百科: 无游戏词条的药/内源介质(键=ChemicalType, 建表后映射为中文名并入 ENCYC) ===
const CHEM_ENCYC_PART1={
O2:'呼吸底物，经肺泡入血与血红蛋白结合运输；SpO₂ 反映携氧饱和度，低氧经外周化学感受器驱动呼吸增速，组织缺氧是大多数死亡通路的最终共同环节。',
N2:'惰性气体，约占大气 78%；不参与代谢，仅在高压环境大量溶于体液（减压病相关）。',
N2O:'一氧化二氮（笑气），吸入性麻醉镇痛剂，温和抑制 NMDA 受体并促内源性阿片释放；本引擎不单独建模。',
CO2:'细胞有氧代谢终产物，经肺排出；PaCO₂（正常 35–45 mmHg）是呼吸中枢的主要驱动力，潴留致呼吸性酸中毒并舒张脑血管。',
H2O2:'过氧化氢，氧化应激产生的活性氧；低浓度用于创面消毒，高浓度直接损伤组织。',
Chloride:'主要细胞外阴离子，与 Na⁺ 共同维持电中性与渗透压；胃酸的主要成分，与 HCO₃⁻ 存在跨细胞转移。',
Potassium:'细胞内主要阳离子，决定心肌与神经的静息膜电位。血钾 >6.8 mmol/L 可诱发室速/室颤（本引擎高钾通路），肾排钾为小时级慢调节。',
Iron:'血红蛋白合成的必需微量元素，缺铁致小细胞低色素性贫血；经十二指肠吸收，由转铁蛋白转运。',
Iodine:'甲状腺激素（T3/T4）合成的必需原料，甲状腺滤泡主动浓集；缺碘致甲状腺肿大，过量可诱发甲亢。',
Phosphate:'细胞内主要阴离子，参与 ATP、核酸与骨盐构成，与血钙代谢联动。',
Ammonia:'蛋白质代谢含氮废物，经肝尿素循环解毒；肝衰时血氨升高致肝性脑病（本引擎未单独建模，由肝功能驱动）。',
AminoAcid:'蛋白质的水解终产物，经小肠吸收；用于组织蛋白合成、糖异生或脱氨氧化供能。',
Amylose:'淀粉（多糖），经胰淀粉酶逐级水解为寡糖→麦芽糖→葡萄糖后吸收，是最主要的升糖碳水来源。',
Protein:'三大营养素之一，消化为氨基酸后吸收；为血浆胶体渗透压、酶、抗体与组织修复提供原料。',
Glutamine:'条件必需氨基酸，肠上皮细胞与免疫细胞的首选燃料，参与氨转运。',
Glutamate:'中枢最主要的兴奋性神经递质（作用于 NMDA/AMPA 受体）；大量释放可致兴奋性毒性损伤。',
TriglycerideHydrophilic:'水相甘油三酯（乳糜微粒/VLDL 携带），脂蛋白脂肪酶水解为甘油与游离脂肪酸后入组织。',
Monoglyceride:'甘油三酯部分水解产物，与脂肪酸共同形成混合微胶粒被小肠吸收后重组为甘油三酯。',
PhosphoLipid:'细胞膜主要脂质成分，消化后乳化吸收；也是胆汁与表面活性物质的来源。',
PhosphoLipidHydrophilic:'水相磷脂，参与脂质乳化与脂蛋白组装。',
CholesterolEster:'胆固醇的酯化储存形式，由 LCAT 催化生成，随脂蛋白运输至组织。',
Cholesterol:'细胞膜流动性与类固醇激素、胆汁酸、维生素 D 的合成前体；过高与动脉粥样硬化相关。',
CholesterolEsterHydrophilic:'水相胆固醇酯，随脂蛋白核心运输。',
Fructose:'果糖（水果糖），近乎不刺激胰岛素分泌，经肝代谢绕过糖酵解限速步骤而更易转为脂肪。',
Lactose:'乳糖（乳制品的双糖），经乳糖酶分解为葡萄糖+半乳糖；乳糖酶缺乏者腹胀腹泻。',
LacticAcid:'无氧糖酵解产物，休克/缺氧时堆积致乳酸酸中毒；重要组织灌注指标。',
Maltose:'麦芽糖（淀粉中间产物双糖），经麦芽糖酶水解为两分子葡萄糖。',
Sucrose:'蔗糖（食糖双糖），经蔗糖酶分解为葡萄糖+果糖，是日常饮食主要甜味来源。',
Galactose:'半乳糖（单糖），乳糖的分解产物之一；经肝转化为葡萄糖-1-磷酸进入糖代谢。',};
Object.assign(ENCYC,CHEM_ENCYC_PART1);
const CHEM_ENCYC_PART2={
Urobilin:'尿胆素，胆红素在结肠被细菌还原为尿胆原后的氧化产物，是粪便颜色的来源。',
Urobilinogen:'尿胆原，胆红素的肠道还原产物，部分经肠肝循环回肝、部分入尿；溶血或肝功能异常时尿中增多。',
Bilirubin:'未结合（间接）胆红素，衰老红细胞血红蛋白的降解产物；脂溶性，入血后与白蛋白结合，过多沉积皮肤巩膜致黄染。',
BilirubinConjugated:'结合（直接）胆红素，经肝葡萄糖醛酸化后的水溶形式，随胆汁排入肠腔；梗阻性黄疸时血中锐增。',
Stercobilin:'粪胆素，尿胆原在结肠的氧化终产物，赋予粪便正常棕黄色。',
Plasma:'血浆，血液的液体基质（约占血量 55%），承载水、电解质、蛋白、激素与所有本引擎药代房室的运输。',
HCl:'盐酸，胃壁细胞分泌；提供胃蛋白酶最优 pH 并杀灭多数病原，吸收过少或过多分别影响消化与黏膜。',
Peptite:'胃蛋白酶原活化产物，蛋白水解酶，在 pH<5 环境下降解食糜蛋白为肽段。本引擎按胃酸环境联动抑酸。',
FattyAcid:'游离脂肪酸，脂解主要产物；经 β-氧化供能（心肌首选燃料），在肝内亦可合成酮体与 VLDL。',
HCO3:'碳酸氢根，血中最重要的缓冲碱；肺排出 CO₂、肾回吸收/再生 HCO₃⁻ 共同维持 pH 7.35–7.45。',
Glycerol:'甘油，脂肪水解的三碳骨架，经肝糖异生转为葡萄糖。',
CRP:'C 反应蛋白，急性期反应物，肝在 IL-6 驱动下大量合成；感染/炎症数小时内数十倍升高（本引擎按炎症负荷联动升高）。',
Ethanal:'乙醛，乙醇经乙醇脱氢氧化的中间产物；毒性极高（潮红、心率加速），乙醛脱氢酶将其续氧化为乙酸。',
NADH:'还原型烟酰胺腺嘌呤二核苷酸，能量代谢的核心氢载体；乙醇代谢大量消耗 NAD⁺，间接干扰糖异生（酒后低血糖机制之一）。',
Labetalol:'拉贝洛尔——α1 与非选择性 β 双重阻滞剂，妊娠期高血压常用；降压同时不反射性心动过速。本引擎按 α1 血管+β1 心脏双向占据建模。',
Lisinopril:'赖诺普利——ACE 抑制剂，阻断血管紧张素Ⅰ→Ⅱ 转换，降低 SVR 与醛固酮；首剂低血压与干咳为典型副作用。',
AceticAcid:'乙酸，乙醇代谢终产物，进入三羧酸循环彻底氧化；也是醋的主要成分。',
Fentanyl:'芬太尼——合成强阿片（效价约吗啡 100 倍），μ 受体激动：镇痛强、呼吸抑制重、起效快半衰期短；纳洛酮可竞争逆转。',
Cocaine:'可卡因——阻断单胺再摄取（DAT/NET/SERT），交感风暴致血压骤升、冠脉痉挛与心律失常；本引擎以 DAT/NET 占据+体温+0.5 通路建模。',
MDMA:'MDMA（摇头丸），促 5-HT 释放+体温上调通路（temp:+0.5），表现为高热、脱水、情绪与感知改变。',
LSD:'LSD——5-HT2A 受体激动，强致幻剂；剂量极小即可改变感知，心血管作用轻微。',
DMT:'二甲基色胺——速效强致幻色胺，5-HT 受体激动；本引擎不单独建模精神效应。',
THC:'四氢大麻酚——CB1 受体部分激动，食欲↑（cb1_apetite）、心率↑、认知时间感知改变。',
CBD:'大麻二酚——非致幻大麻素，CB1 拮抗/负变构，抗焦虑倾向；本引擎按 CB1 拮抗语义。',
ArachidonicAcid:'花生四烯酸，膜磷脂释放的多不饱和脂肪酸；经 COX/LOX 两条通路生成前列腺素、白三烯与血栓素家族。',
Ephedrine:'麻黄碱——混合作用拟交感药：直接 β/α 激动+促进内源去甲释放，升压强于肾上腺素而作用更持久；可口服。',
Metoprolol:'美托洛尔——选择性 β1 阻断剂，降心率与心肌耗氧；心衰与心梗二级预防基石，过量致心动过缓。',
Enalapril:'依那普利——ACE 抑制剂（前体药），机制同赖诺普利，伴醛固酮下降与钾潴留倾向。',
Losartan:'氯沙坦——AT1 受体拮抗剂（ARB），在受体水平阻断血管紧张素Ⅱ；不引起 ACEI 类干咳。',
Proglumide:'丙谷胺——胆囊收缩素（CCK）受体拮抗剂，原用于消化性溃疡；本引擎按 CCK 抑制语义建模。',
Chlorpheniramine:'氯苯那敏（扑尔敏）——第一代 H1 抗组胺药，中枢穿透强（嗜睡），抵抗组胺气道痉挛与血管扩张。',
Cetirizine:'西替利嗪——第二代 H1 抗组胺药，中枢穿透弱（少嗜睡），长效控制过敏症状。',
Meclizine:'美克洛嗪——H1/毒蕈碱双重作用的前庭抑制药，用于晕动病与眩晕；伴口干嗜睡。',
Omeprazole:'奥美拉唑——质子泵抑制剂，不可逆抑制 H⁺/K⁺-ATP 酶抑酸；胃溃疡与反流一线，长期用影响 B12/铁吸收。',
Salmeterol:'沙美特罗——长效 β2 激动剂（12h），支气管扩张维持用药；起效慢不用于急性发作。',
Albuterol:'沙丁胺醇——短效高选择性 β2 激动剂，应急缓解气道痉挛；大剂量心动过速（β1 溢出）。',
Dexmedetomidine:'右美托咪定——高选择性 α2 激动剂，镇静镇痛而不抑呼吸；交感出口抑制，常用于 ICU 机械通气镇静。',
Troponin:'心肌肌钙蛋白（cTnI/cTnT），心肌细胞损伤后释放入血的标志物；本引擎 cTnI>0.04 ng/mL 提示心肌梗死。',
Melatonin:'褪黑素，松果体在暗时相分泌的激素，调节昼夜节律；本引擎按睡眠倾向增强语义（Sleep 图标联动）。',
Triiodothyronine:'三碘甲状腺原氨酸（T3），甲状腺激素活性形式：提高基础代谢、产热（TR 变时 +30）与生长发育。',
ProstaglandinI2:'前列环素（PGI2）——血管内皮合成的强力扩血管+抗血小板介质（EP2/IPv 受体）。',
ProstaglandinD2:'前列腺素 D2——主要由肥大细胞产生，参与睡眠调节与过敏反应；本引擎按血管舒张+睡眠语义。',
ProstaglandinE2:'前列腺素 E2——发热介质（PGE2 上移下丘脑体温调定点）、扩血管与致痛敏感化。',
ProstaglandinF2a:'前列腺素 F2α——子宫平滑肌强收缩剂，参与月经痛经；NSAIDs 通过 COX 抑制其生成而镇痛（本引擎痛经通路）。',
LeukotrieneC4:'白三烯 C4——5-脂氧合酶产物（半胱氨酰白三烯家族之首），气道最强收缩介质之一（CYSLTR1 −0.95 通道）。',
LeukotrieneD4:'白三烯 D4——LTC4 水解产物，哮喘迟发相的核心介质，气道水肿与黏液分泌。',
LeukotrieneE4:'白三烯 E4——cysteinyl 白三烯代谢终产物，作用同族但更持久。',
Bradykinin:'缓激肽——激肽释放酶系统九肽，强力血管扩张+血管通透性↑+致痛；ACEI 干咳的机制（缓激肽降解受阻）。',
ThromboxaneA2:'血栓素 A2——血小板合成的强缩血管+聚集介质；与前列环素生理平衡，阿司匹林不可逆抑制其合成。',
ThromboxaneB2:'血栓素 B2，TXA2 的稳定水解产物（半衰期 ~30s），临床以尿中浓度反映血小板活化。',
AngiotensinI:'血管紧张素Ⅰ——肾素级联十肽，本身活性弱；经 ACE 转换为活性强大的 AngⅡ。',
Angiotensinogen:'血管紧张素原——肝合成的 α2 球蛋白，肾素底物；RAAS 系统的起点。',
Ghrelin:'饥饿素，胃底细胞分泌的生长激素释放肽，作用于下丘脑促食欲（餐前↑餐后↓）；本引擎影响食欲/血糖行为偏好。',
Somatostatin:'生长抑素（体抑素），下丘脑与胰岛 δ 细胞分泌，广泛抑制 GH/胰岛素/胰高血糖素与胃肠分泌。',
PYY:'肽 YY，回肠与结肠 L 细胞餐后分泌，抑制胃排空与胰分泌（饱食信号「回肠刹车」）。',
GIP:'抑胃肽（葡萄糖依赖性促胰岛素多肽），K 细胞进食脂肪/碳水后分泌——「肠促胰素」之一，促 β 细胞分泌胰岛素。',
Insulin:'胰岛素——胰岛 β 细胞分泌的储能激素：促细胞摄取葡萄糖、糖原/脂肪合成，抑制糖异生与脂肪分解。外源胰岛素过量致低血糖（本引擎降糖 EXACT 通路，钾亦随 INSULIN 内移）。',
CRH:'促肾上腺皮质激素释放激素，下丘脑室旁核分泌，启动 HPA 应激轴（CRH→ACTH→皮质醇）。',
ACTH:'促肾上腺皮质激素，垂体前叶分泌，驱动肾上腺皮质合成皮质醇；昼夜节律与应激峰值。',
ANP:'心房利钠肽，心房牵张（容量超负荷）时释放：促钠排泄、扩血管、抑制 RAAS——本引擎按容量感受器联动（阈值 80 mmHg）。',
Estrone:'雌酮，绝经后女性体内主要雌激素（肾上腺雄激素外周芳香化）。',
Estradiol:'雌二醇（E2）——最强生理雌激素，卵泡期渐升；≥170 pg/mL 正反馈触发 LH 峰排卵（本引擎 LMFRS 通路），并维持骨密度与血管内皮功能。',
Androstenolone:'雄烯醇（脱氢表雄酮相关代谢物），肾上腺源弱雄激素，芳香化后可作为绝经后雌激素来源。',
Androstadienone:'雄甾二烯酮，人体信息素类类固醇，对情绪/注意有微妙心理效应（本引擎不建模）。',
Progestin:'孕激素（合成孕酮类），维持分泌期子宫内膜、静息子宫平滑肌；本引擎 LMFRS 黄体期 P4 通路。',
TRH:'促甲状腺激素释放激素，下丘脑三肽，刺激垂体 TSH 分泌。',
TSH:'促甲状腺激素（TSH），垂体前叶糖蛋白，驱动甲状腺滤泡合成与释放 T3/T4；负反馈敏感（本引擎甲状腺轴）。',
PTH:'甲状旁腺激素，血钙降低时分泌：促骨钙动员、肾远曲管钙重吸收与活性维生素 D 合成。',
LH:'黄体生成素（LH）——垂体促性腺激素；LH 峰（≈55 IU/L）触发排卵与黄体形成（本引擎 LMFRS 排卵通路），男性刺激睾丸间质细胞睾酮生成。',
GnRH:'促性腺激素释放素，下丘脑脉冲式分泌，驱动 FSH/LH；脉冲频率决定 FSH/LH 比例。',
Calcitriol:'骨化三醇（1,25-(OH)₂D₃）——活性维生素 D，促肠钙磷吸收与骨矿化；由肾 1α-羟化酶生成，受 PTH 上调。',
Anandamide:'花生四烯乙醇胺（AEA），内源性大麻素，CB1/CB2 受体激动——食欲、镇痛与情绪的瞬态调节。',
Amylin:'胰淀素，β 细胞与胰岛素共分泌的肽类：延缓胃排空、抑制胰高血糖素、增强饱感。'}
Object.keys(CHEM_ENCYC_PART2).concat(Object.keys(CHEM_ENCYC_PART1)).forEach(k=>{const z=zhOf(k);if(z!==k&&!ENCYC[z])ENCYC[z]=CHEM_ENCYC_PART1[k]||CHEM_ENCYC_PART2[k];});
Object.assign(ENCYC, CHEM_ENCYC_PART1, CHEM_ENCYC_PART2);ZH['LH']='黄体生成素';ZH['Progesterone']='孕酮';ZH['GnRH']='促性腺素释放素';ZH['ProstaglandinF2a']='前列腺素F2α';
function frsInit(){return{
  clock:FRSC.DAY0, mp:'Follicular', up:'Proliferative',        // LMFRS.Phase / UPhase（游戏相位枚举名）
  fsh:5.8, lh:5.2, e2:60, p4:0.4, flow:0,                       // FSH/LH IU/L · E2 pg/mL · P4 ng/mL · 经量 0..1
  frozen:false,
  seen:{Follicular:0,Ovulation:0,Luteal:0,Menstruation:0,Proliferative:0,Secretory:0}
};}
function uterusPresent(){return !(S&&S.ect&&S.ect.uterus);}
function frsDay(f){return Math.floor(f.clock/FRSC.DAY)%FRSC.LEN+1;}   // 1..28
function frsMensDay(f){const d=frsDay(f);return d<=FRSC.MENS_TAIL?d:0;} // 出血窗口: 第 1~5 天(4-5 天)
function frsPhaseOfDay(day){   // LMFRS 相位机（第 1-5 天出血=月经期早卵泡 / 13-14 排卵 / 15+ 黄体）
  const mp=(day>=FRSC.OV[0]&&day<=FRSC.OV[1])?'Ovulation':(day>=15?'Luteal':'Follicular');
  const up=(day<=FRSC.MENS_TAIL)?'Menstruation':(mp==='Luteal'?'Secretory':'Proliferative');
  return{mp,up};
}
function frsStage(){            // 化验"动态参考范围"的相位段
  const f=S.frs;if(!f)return null;
  if(S.ect&&S.ect.uterus)return 'stopped';
  const d=frsDay(f);
  if(d<=FRSC.MENS_TAIL)return 'early';                       // 月经/早卵泡
  if(d>=FRSC.OV[0]&&d<=FRSC.OV[1])return 'ov';               // 排卵（LH 峰）
  if(d>=27)return 'lutlate';                                 // 黄体溶解（激素撤退 → 月经将潮）
  if(d>=15)return 'lut';
  return 'fol';
}
function frsTargets(f){        // 相位目标激素曲线（GnRH 脉冲→FSH/LH · 颗粒细胞 E2 · 黄体 P4）
  const d=frsDay(f);let t={fsh:5.5,lh:5,e2:60,p4:0.4};
  if(d<=5){t.fsh=3.8+d*0.28;t.lh=4.5;t.e2=36;t.p4=0.35;}                              // 月经/早卵泡: FSH 起始招募
  else if(d<=12){const k=(d-6)/6;t.fsh=5.5+3.4*k;t.lh=5+3.5*k;t.e2=62+115*k;t.p4=0.5;}// 卵泡期: FSH↑ 卵泡发育 → E2 渐升
  else if(d<=14){t.e2=290;t.fsh=6;t.lh=(f.e2>170)?55:8;t.p4=1.0;}                     // E2 峰正反馈 → LH 峰（排卵窗）
  else if(d<=26){const u=(d-21)/2.6;t.fsh=2.2;t.lh=3.5;t.e2=115+65*Math.exp(-u*u);    // 黄体期: P4↑ E2 中高
    t.p4=3.8+9.2*Math.exp(-Math.pow((d-21)/3.2,2));}
  else {t.fsh=3.4;t.lh=4.6;t.e2=42;t.p4=0.6;}                                         // 第 27-28 天: 黄体溶解
  return t;
}
function mfrsStep(dt){
  const f=S.frs;if(!f)return;
  if(S.ect&&S.ect.uterus){    // 子宫切除（LMFRS 移除）→ 周期停摆: E2/P4 失驱动, FSH/LH 失负反馈抑制（绝经样）
    f.fsh+=(19-f.fsh)*dt*.02;f.lh+=(27-f.lh)*dt*.02;
    f.e2+=(12-f.e2)*dt*.008;f.p4+=(0.2-f.p4)*dt*.008;
    f.flow=0;f.frozen=true;
    if(!f.stopLogged){f.stopLogged=true;log('⚠ <b>生殖周期停摆</b>：子宫已切除（LMFRS 移除）——E2/P4 失去周期驱动低平，FSH/LH 失去负反馈抑制而升高（绝经样内分泌状态）','crit');}
    return;
  }
  const prevUp=f.up,prevMp=f.mp;
  f.clock+=dt;                                 // 周期日历推进（1 天=60 模拟秒）
  const d=frsDay(f);
  const ph=frsPhaseOfDay(d);
  f.mp=ph.mp;f.up=ph.up;
  f.seen[f.mp]=(f.seen[f.mp]||0)+1;f.seen[f.up]=(f.seen[f.up]||0)+1;
  const T=frsTargets(f);
  f.fsh+=(T.fsh-f.fsh)*dt*.08;f.lh+=(T.lh-f.lh)*dt*.15;     // LH 速率最快 → 峰形尖锐
  f.e2+=(T.e2-f.e2)*dt*.05;f.p4+=(T.p4-f.p4)*dt*.04;
  // 月经出血: 前列腺素(PGF2α)介导子宫收缩/内膜脱落——4-5 天窗口, 经量先少后多再收尾; NSAIDs(COX 抑制)缓解痛经
  let flowT=0;
  if(f.up==='Menstruation')flowT=({1:0.55,2:1.0,3:0.95,4:0.6,5:0.25})[d]||0;
  f.flow+=(flowT-f.flow)*dt*.12;
  if(f.flow>0.01&&uterusPresent()){                          // 经血 → Hb/血容量缓慢下降（生理性失铁）
    S.hb=Math.max(3,(S.hb||15)-0.0013*f.flow*dt);
    S.fluid=Math.max(.2,S.fluid-0.00035*f.flow*dt);
  }
  if(f.up!==prevUp){                                         // UterusPhase 切换事件
    if(f.up==='Menstruation')log('🩸 <b>月经来潮</b>：周期第 '+d+' 天——雌/孕激素撤退，前列腺素(PGF2α)介导子宫收缩、功能层内膜脱落出血（约 4-5 天）。痛经首选 NSAIDs（布洛芬/萘普生——抑制前列腺素合成）','crit');
    else if(f.up==='Proliferative')log('子宫内膜增殖期开始：卵泡发育 · E2 渐升 → 内膜修复增厚（LMFRS.UterusPhase.Proliferative）');
    else if(f.up==='Secretary'||f.up==='Secretory')log('黄体期：排卵后黄体分泌孕酮(P4)/雌二醇(E2)——子宫内膜转向分泌期（LMFRS.UterusPhase.Secretory）');
  }
  if(f.mp!==prevMp&&f.mp==='Ovulation')log('⛰ <b>LH 峰</b>：卵泡晚期 E2 峰(≥170 pg/mL)正反馈触发（LMFRS.MenstrualPhase.Ovulation）——LH 峰后 ~24-36h 排卵（受孕窗）');
}
function frsStageText(){       // 提示条文案（"月经第 2 天（量中）"式）
  const f=S.frs;if(!f)return '';
  if(S.ect&&S.ect.uterus)return '停摆（子宫切除术后 · LMFRS 移除——FSH/LH 失抑制↑ E2/P4 低平）';
  const d=frsDay(f),st=frsStage();
  if(st==='early'){const q=({1:'量少',2:'量中',3:'量多',4:'量中',5:'量少，收尾'})[d];return '月经第 '+d+' 天（'+q+'）· 出血窗口 4-5 天 · 痛经可用 NSAIDs';}
  if(st==='fol')return '卵泡期 第 '+d+' 天 · FSH↑ 卵泡发育 · E2 渐升（增殖期）';
  if(st==='ov')return '排卵期 第 '+d+' 天（'+(f.lh>20?'LH 峰进行中':'LH 峰酝酿')+' · E2 峰正反馈）';
  if(st==='lut')return '黄体期 第 '+d+' 天（P4↑ 分泌期 · 基础体温相）';
  return '黄体晚期 第 '+d+' 天 · 黄体溶解 → 激素撤退 → 月经将潮';
}
function baseState(){return{
  t:0,paused:false,dead:false,deathCause:'',soundOn:true,
  frs:frsInit(),            // LMFRS 生殖周期（子宫=女性生殖系统在场即启用）
  HX:[],                    // 死亡归因采样（死前 ~80s 窗口，每 2s 一帧）
  withdrawn:false,          // LIDeath.MachineWithdrawal：撤除生命维持宣告路径
  deathInfo:null,           // LIDeath 死亡报告（直接死因链/基础病变/存活时长/时间线）
  // 起搏系统（LMPacemaker: SA 60 / AV 40）
  saRate:CAL.heart.sa_node_rate_bpm, hr:72,
  map:93, svr:1.0, contract:1.0, co:5.0, fluid:1.0,
  spo2:98, paco2:40, rr:14, o2drive:1, airwayR:1.0, fio2:0.21, vent:false, ventRR:12,
  ventVt:500, ventPeep:5, ventMode:'',
  glucose:5.3, k:4.2, na:140, ph:7.40, temp:36.8, gcs:15,
  ca:2.35, hb:15,           // 化验扩展: 离子钙 mmol/L / 血红蛋白 g/dL
  rhythm:'sinus', arrestT:0, miT:0, defibJ:200, paced:false,
  miLoad:0, ctni:0.01,      // 心肌损伤负荷(0..3) → cTnI 峰值-衰减 (ng/mL)
  sympath:0.2, vagal:0.2, renin:0, cortisolEndo:0, epiEndo:0, insulinEndo:1.2,
  blood:{}, gut:{}, gutSpd:{}, infuse:{},
  ect:{},                    // 器官切除（LMOrganBase.OrganEctomy 语义·不可逆）: {spleen:true,...}
  bac:0, alcGut:0, _alcSeen:false,  // 乙醇房室: BAC‰ / 胃肠待吸收 / 曾饮酒标记（零级氧化 0.15‰/h）
  kidFrac:1, kidComp:0, creat:80,   // 肾功能: 肾单位分数 / 对侧代偿 / 肌酐 μmol/L
  plt:250, testo:1, cholFatT:0,     // 血小板 ×10⁹/L / 睾酮轴 / 胆囊切除脂餐不适计时
  pace:false, paceRate:CAL.heart.sa_node_rate_bpm, cpr:false,
  inoOn:false,
  // ---- 阶段5: 新病例机制状态 ----
  tamponade:0, drainT:0,     // 心包积液压迫系数(0..1, LMHeart tamponade) / 心包穿刺引流剩余时间
  svt:false, svtRate:188,    // 房室结折返性 SVT 折返驱动(腺苷 A1 阻断终止)
  stormT:0,                  // 甲状腺风暴持续驱动(内源性儿茶酚胺激增+产热; β阻滞部分抑制)
  cohb:0, coSrc:false,       // 碳氧血红蛋白分数(COHb) / 持续 CO 暴露源(脱离+高流量氧疗终止)
  mhSus:false, mhDrive:0,    // 恶性高热易感(琥珀胆碱触发·钙释放失控) / 当前高代谢驱动 0..1
  kWasting:false,            // 慢性利尿剂肾性丢钾(噻嗪类)——低钾持续存在(洋地黄中毒病例背景)
  cooling:false,             // 物理降温(冰毯/冰袋)
  beatPhase:0, pulseT:0,
  // ---- 阶段6: 病原体/免疫/症状状态(病毒系统) ----
  pathogens:{},            // {Influenza:{load,tropism,dmg}} —— S.pathogens 通道(接种接口见 给药面板'病原体'组)
  imm:{lymph:1,neut:1,act:0,supp:0},   // 免疫: 淋巴细胞/中性粒细胞相对量·动员度·免疫抑制
  sym:{coughT:8,sneezeT:12,vomitT:-1,coughAt:-99,sneezeAt:-99,vomitAt:-99,coughN:0,sneezeN:0,vomitN:0,coughing:0,sneezing:0,vomiting:0,flip:0},   // 症状状态机(咳/喷嚏/呕吐事件→音频+粒子同帧)
  bleedPulse:0,            // 出血事件脉冲(PFX 流量源)
  seizT:0                  // 高热惊厥累积(sys 感染·核心>41℃ 持续)
}}

var S= baseState();

function receptorActivity(){
  const act={}; ENUMS.ReceptorsType.forEach(r=>act[r]=0);
  for(const[c,conc]of Object.entries(S.blood)){
    const p=PHARM[c]; if(!p||!p.a)continue;
    for(const[rec,dir,pot]of p.a){
      if(!rec||!act.hasOwnProperty(rec))continue;
      const occ=conc*pot/(1+conc*pot);
      act[rec]+=dir*occ;
    }
  }
  return new Proxy(act,{get:(t,k)=>{const v=t[k];return(typeof v==='number')?v:0;}});
}
function dOf(k){let v=0;for(const[c,conc]of Object.entries(S.blood)){const p=PHARM[c];if(p&&p.d&&p.d[k])v=Math.max(v,Math.min(p.d[k]*conc,p.d[k]*2));}return v||0;}
function totalDose(k){let v=0;for(const[c,conc]of Object.entries(S.blood)){const p=PHARM[c];if(p&&p.d&&p.d[k])v+=p.d[k]*conc;}return v;}

function tick(dt){
  if(!S.paused&&typeof vfxStep==='function')vfxStep(dt);   // 阶段5: VFX 参数层置顶——死亡灰阶需在 dead 后继续渐变
  if(S.dead||S.paused)return;
  S.t+=dt;
  const H=CAL.heart, V=CAL.vascular, R=CAL.respiration, KD=CAL.kidney, C=CAL.cns;
  // -- 药代（LMReceptors: assoc 0.01/dissoc; 路径标定 LMMedication）
  // 肠腔吸收: 默认 0.15/s；食物可带 gutSpd 速率（液体糖快/淀粉慢）；
  // 胃切除术后(LMStomach 缺失) 口服吸收速率 ×0.35 —— 药物与食物同受影响
  for(const[chem,amt]of Object.entries(S.gut)){
    let spd=(S.gutSpd&&S.gutSpd[chem])||0.15;
    if(S.ect&&S.ect.stomach)spd*=0.35;
    const ab=amt*Math.min(spd,1)*dt;S.gut[chem]-=ab;S.blood[chem]=(S.blood[chem]||0)+ab*0.6;
    if(S.gut[chem]<1e-4){delete S.gut[chem];if(S.gutSpd)delete S.gutSpd[chem];}
  }
  for(const[chem,rate]of Object.entries(S.infuse))S.blood[chem]=(S.blood[chem]||0)+rate*dt;
  for(const chem of Object.keys(S.blood)){
    if(chem==='Ethanol'&&S._alcSeen)continue;   // 乙醇由 BAC 房室统一驱动（零级氧化，见下）
    const p=PHARM[chem]||{}; const hl=(p.d&&p.d.short)?45:(p.d&&p.d.long)?1800:(p.d&&p.d.vlong)?18000:420;
    S.blood[chem]*=Math.exp(-Math.log(2)/hl*dt);
    if(S.blood[chem]<1e-3)delete S.blood[chem];
  }
  // -- 乙醇房室（LMChemical Ethanol=49 / ENCYC「血液酒精浓度」）：
  //    胃肠吸收→BAC(‰, Widmark 70kg·r≈0.68)→乙醇脱氢酶零级氧化 ~0.15‰/h；
  //    血中 Ethanol 浓度 = BAC/1.5，接既有 GABAA/NMDA 受体占位与 cnsD 镇静机制
  if(S.alcGut>0){const ab=Math.min(S.alcGut,(S.alcGut*0.08+0.012)*dt);S.alcGut-=ab;S.bac+=ab;S._alcSeen=true;}
  S.bac=Math.max(0,S.bac-0.15/3600*dt);
  if(S._alcSeen){
    if(S.bac>0.01)S.blood['Ethanol']=S.bac/1.5;
    else{const e=S.blood['Ethanol']||0;if(e>1e-3)S.blood['Ethanol']=e*Math.exp(-dt/240);else delete S.blood['Ethanol'];}
  }
  const rA=receptorActivity();
  // 阶段6: 病原体-免疫动力学 + PFX 粒子状态机(纯数据层; window.PFX 供 three.js 模块消费)
  if(typeof pathogenStep==='function')pathogenStep(dt);
  if(typeof pfxStep==='function')pfxStep(dt);
  // -- 压力反射（LMBaroreceptor: 张力±2.1 斜率7 → 归一化）
  const bpN=(S.map-93)/93;
  S.sympath=clamp(S.sympath+(-bpN*2.1*0.9- S.sympath)*dt*.4, 0, 1.5);
  S.vagal  =clamp(S.vagal  +( bpN*2.1*0.9 - S.vagal)*dt*.4, 0, 1.5);
  // -- 起搏与心率（SA 60 × 肾上腺素能最大3倍）
  let saTarget = H.sa_node_rate_bpm*(1 + rA['β1Adrenoceptor']*2.0)      // epi → 最高 3× = 180bpm (SANodeEpinephrineAction ×3)
    + 12 + S.sympath*20 - S.vagal*30 + rA['M2']*-30
    - (rA['M2']<0? -rA['M2']*45:0) + rA['nAChR']*12 + (dOf('hrE')?totalDose('hrE')*25:0) + rA['TR']*30
    - rA['A1']*40                                             // 阶段5: 腺苷 A1 激动→SA/AV 结负性频率(腺苷复律; 咖啡因 A1 拮抗→轻度兴奋)
    + Math.max(0,S.temp-37.5)*2.2                             // 阶段5: 体温每 ↑1℃ 窦率 +2.2bpm(Q10 效应)——甲亢风暴/发热心率来源
    + (S.stormT>0?18:0)                                       // 阶段5: 甲状腺风暴——内源性儿茶酚胺激增(交感风暴成分)
    -((S.ect&&S.ect.thyroid)?7:0);   // 甲状腺切除→甲状腺激素缺失→窦率/代谢下降
  if(S.inoOn) saTarget = Math.max(saTarget, 110);
  if(S.svt) saTarget = Math.max(saTarget, S.svtRate);         // 阶段5: SVT 折返环路驱动——快于一切自主节律
  if(S.svt&&rA['A1']>0.4){S.svt=false;log('💊 腺苷阻断房室结 → 折返环终止，<b>SVT 复律为窦性</b>','crit');}   // A1 占位>0.4 → 打断 AVNRT
  const intrinsicSA = saTarget;                                   // 固有窦率(未起搏)
  if(S.pace) saTarget = Math.max(saTarget, S.paceRate);           // LIPacerPacing: 起搏接管心动过缓/高度传导阻滞
  S.paced = S.pace && intrinsicSA < S.paceRate;                   // 标记 paced 状态
  S.saRate += (clamp(saTarget,25,200)-S.saRate)*dt*.5;
  S.hr=S.saRate; if(S.rhythm==='afib')S.hr+= (Math.random()-.5)*10;
  if(S.rhythm==='vt')S.hr=165+Math.random()*15;
  if(S.rhythm==='vf')S.hr=0; if(S.rhythm==='arrest')S.hr=0;
  if(S.rhythm==='vt')S.hr=160;
  // -- 血管阻力（LMVascular: α1-20/β2+35/AGT-20 …取阻力反号×0.028）
  const vasK=0.028;
  const vasDeltaFlow = V.alpha1_flow*rA['α1Adrenoceptor']
    + V.beta2_dilate*rA['β2Adrenoceptor'] + V.ep2_dilate*rA['EP2']
    + V.angiotensin2*rA['AGTReceptor'] + V.vasopressin*rA['Vasopressin1']
    + V.anp*rA['ANPReceptor'] + V.h1*rA['H1'] + V.thromboxane*rA['TP'] + V.gcr*rA['GCR'];
  let svrT = 1 - vasDeltaFlow*vasK + S.sympath*0.18 - (dOf('ccb')?dOf('ccb')*1.1:0) - (S.pathSvr||0)
    - (dOf('svrD')?dOf('svrD')*.55:0) - (dOf('acei')||dOf('arb')?.35:0) - rA['ANPReceptor']*.2
    + rA['AGTReceptor']*.35 + rA['Vasopressin1']*.3;
  if(rA['α2Adrenoceptor']>0.5) svrT*=.94;
  S.svr += (clamp(svrT,.1,3.5)-S.svr)*dt*.4;
  // -- 心肌收缩（EF 0.68 基线）
  const betaBlock = rA['β1Adrenoceptor']<0?-rA['β1Adrenoceptor']:0;
  S.contract += (clamp(1.0 + rA['β1Adrenoceptor']*.45 - betaBlock*.4 - (S.miT>0?.3:0) - Math.max(0,S.k-6)*.15, .05, 2.2)-S.contract)*dt*.5;
  S.co=clamp(S.hr*S.contract*0.071*(S.rhythm==='arrest'||S.rhythm==='vf'?0:1)*(S.svt?0.24:1)*(1-S.tamponade*0.75),0,12);   // SVT 舒张充盈锐减 / 心包填塞限制回流(LMHeart tamponade)
  const mapT=S.co*S.svr*18*S.fluid - (S.vent?Math.max(0,S.ventPeep-5)*1.2:0); // 高PEEP降低静脉回流
  S.map += (clamp(mapT,0,250)-S.map)*dt*.5;
  if(S.drainT>0){                                // 阶段5: 心包穿刺引流中——约 6s 解除压迫
    const prevTam=S.tamponade;
    S.drainT=Math.max(0,S.drainT-dt);
    S.tamponade=Math.max(0,S.tamponade-dt/6);
    if(prevTam>0&&S.tamponade===0)log('🩹 心包穿刺引流完成——心包压塞解除（Beck 三联征消退, 回心血量恢复）');
  }
  if(S.cpr&&(S.rhythm==='arrest'||S.rhythm==='vf')){
    // 胸外按压前向血流: cpr_effectiveness=0.4 → MAP 目标 40×0.4+19=35mmHg, 按压波幅 25×0.4=10 (25~45 区间)
    const cprT = 40*H.cpr_effectiveness+19 + Math.sin(S.t*6.28)*25*H.cpr_effectiveness;
    S.map=Math.max(S.map,cprT);
  }
  // -- 气道（LMLung: β2 -0.1/H1 -0.2/CYSLTR1 -0.95/EP2 0.25）
  let airT=1 - (0.1*rA['β2Adrenoceptor']+0.25*rA['EP2'])*2 + (0.2*Math.max(0,rA['H1'])+0.95*0)*2 + (S.pathAirway||0);   // 阶段6: 病原气道水肿(URT/LRT)
  S.airwayR += (clamp(airT,.05,1.6)-S.airwayR)*dt*.5;
  // -- 呼吸中枢（LMRespiratoryCentre: CO₂增益3.5 / 驱动0.035）
  let rrT=14 + Math.max(0,S.paco2-40)*(R.co2_gain/10) + Math.max(0,(92-S.spo2))*.5;
  rrT*= clamp(1 - (-C.mu_resp_depression)*Math.max(0,rA['μR'])*0.85, .08, 3);   // μR -0.8 → 呼吸抑制
  rrT*= (dOf('respE')?1.6:1)*clamp(1-Math.max(0,rA['GABAA']-.9)*.5,.1,1)*clamp(1-(S.pathRespFat||0),.55,1);   // 阶段6: 重症肺炎呼吸驱动钝化(通气代偿受限)
  // 乙醇呼吸抑制: BAC>0.5‰ 起呼吸中枢对 CO₂ 敏感性钝化（叠加 GABAA 易化，LIFRS/LMRespiratoryCentre 语义）
  rrT*= clamp(1-Math.max(0,S.bac-0.5)*0.13-Math.max(0,rA['GABAA']-0.2)*0.25, 0.25, 1);
  if(S.vent){ // 呼吸机 A/C: 呼吸暂停/停搏/驱动<4 → 控制通气(rr=设定值); 自主呼吸存在 → 保证最低频率辅助
    const drive=clamp(rrT,0,44);
    const apnea=(S.rhythm==='arrest'||drive<4||dOf('paralyze')>0.05);
    rrT = apnea ? S.ventRR : Math.max(drive,S.ventRR);
    S.ventMode = apnea?'CV 控制通气':'A/C 辅助';
  }
  if(dOf('paralyze')>0.05&&!S.vent)rrT=Math.min(rrT,2);
  S.rr += (clamp(rrT,0,44)-S.rr)*dt*.3;
  const ventGain=S.vent?clamp(S.ventVt/500,.3,1.6)*1.5:1;   // 潮气量 500ml=基准,机械供气×1.5(LIVentilator)
  // 肺切除(LMOrgan 肺切除术): 单肺→有效通气×0.55, 双肺→×0.08(需机械通气否则致死性低氧)
  const lungFrac=clamp(1-0.45*((S.ect&&S.ect.lungL)?1:0)-0.45*((S.ect&&S.ect.lungR)?1:0),0.08,1);
  const ventEff=Math.max(.1,S.rr*S.airwayR*ventGain*0.055*lungFrac*(1-0.55*(S.pathVent||0)));   // 阶段6: 病毒性肺炎通气-血流失衡
  const fio2=clamp(S.fio2+(dOf('o2')?dOf('o2')*.5:0),.21,1);
  // 阶段5: 一氧化碳中毒通道(LMChemical 无 CO 项·以 COHb 分数承载)——
  //   脉搏血氧仪假性正常(SpO₂ 不降), 组织缺氧走 GCS/酸中毒; 持续暴露(coSrc)在 FiO₂≥80% 时终止(脱离现场+面罩)
  if(S.coSrc&&fio2>=0.8){S.coSrc=false;log('🚒 已脱离暴露环境——高流量氧疗下 CO 吸入终止');}
  if(S.cohb>0.001||S.coSrc){
    S.cohb=clamp(S.cohb+((S.coSrc?0.0045:0)-S.cohb*(0.006+(fio2-0.21)*0.05))*dt,0,0.85);
    if(S.cohb<0.001)S.cohb=0;
  }
  const co2prod=4.2*clamp(S.co/5,.2,2)+clamp(S.sympath,0,1)*1.2+Math.max(0,S.temp-37.2)*.8;
  const co2T=clamp(40*(co2prod/4.2)/(ventEff/0.77),10,120);
  S.paco2 += (co2T-S.paco2)*dt*.25;
  const f=clamp(ventEff/0.77,0,3);
  let spoT=98-(f<1?(1-f)*55:0)+(fio2-0.21)*35;
  if(S.vent&&S.ventPeep>0)spoT+=Math.min(S.ventPeep,8)*0.5;   // PEEP 肺泡复张改善氧合
  if(S.map<50)spoT-=8;
  if(S.temp>39)spoT-=4;
  S.spo2 += (clamp(spoT,10,100)-S.spo2)*dt*.3;
  // -- 代谢（血糖 mg/dL 尺度: 100=5.5mmol; LMPancreas β -0.006×1000）
  const insBase=(S.ect&&S.ect.pancreas)?0.10:1;   // 胰切除→β细胞功能×0.10（胰脏切除术）
  const insOcc=(dOf('insulin')+S.insulinEndo*0.06)*insBase;
  const effGlu=S.glucose*18;
  S.insulinEndo += (clamp((effGlu-100)*0.036,1.2,30)*insBase-S.insulinEndo)*dt*.05;
  const glucR=rA['GlucagonReceptor']+clamp(S.sympath-.4,0,1)*.6;
  let gluT=5.3+(dOf('glucoseRise')?(S.blood['Glucose']||0)*3:0)-(dOf('gluLower')?.8:0)
    +(glucR>insOcc?(glucR-insOcc)*6:0)-insOcc*5.5+rA['GCR']*2.2
    +clamp(S.sympath,0,1)*.2+(S.temp>38?(S.temp-38)*.6:0)
    +((S.ect&&S.ect.pancreas)?1.4:0)     // 胰源性糖尿病: 胰高血糖素缺乏拮抗→基础高血糖
    -((S.ect&&S.ect.liver)?1.5:0)        // 肝切除→糖异生/糖原分解缺失→低血糖倾向（肝脏切除术）
    -(S.pathLiver||0)*0.9;               // 阶段6: 肝炎病毒→肝损伤糖异生↓
  S.glucose += (clamp(gluT,.1,40)-S.glucose)*dt*.08;
  // K⁺（LMKidney: 醛固酮排钠保钾反转, α1 肾血流-30→GFR↓）
  const gfrFrac=clamp(1-Math.max(0,rA['α1Adrenoceptor'])*0.3+rA['D1']*0.1+(S.map<70?(70-S.map)*.012:0),.2,1.3);
  // 阶段5: 恶性高热驱动(琥珀胆碱触发·易感者肌浆网钙释放失控→高代谢: 产热/CO₂/横纹肌溶钾; 停诱因+降温逆转)
  const mhDrive=(S.mhSus&&(S.blood['Succinylcholine']||0)>0.12)?(1-Math.min(1,dOf('mhBlock')*1.5)):0;
  S.mhDrive=mhDrive;
  let kT=4.2+(dOf('kRise')?(S.blood['Potassium']||0)*4.4:0)-insOcc*1.1-rA['MineralocorticoidReceptor']*.9+(S.map<55?.6:0)+(S.temp>39?.4:0)
    +(1-S.kidFrac)*2.4+mhDrive*1.2-(S.kWasting?1.9:0)-(S.pathK||0);   // 阶段6: 吐泻失钾(GI 病原→低钾)   // 肾单位不足→钾潴留（双肾切除→kT≈6.6 → 高钾心律失常）; 横纹肌溶解→钾释放; 慢性利尿剂→肾性丢钾
  S.k += (kT-S.k)*dt*(0.05*gfrFrac*S.kidFrac+0.008);
  // -- 肾功能（LMKidney GFR / 肾脏切除术）: 肾单位分数 0.5 起 → 对侧代偿性肥大曲线渐进回升至 ~0.72；
  //    肌酐 ∝ 1/kidFrac^1.3; 肾排水使血容量回稳——单肾时对容量负荷更敏感
  const nkid=((S.ect&&S.ect.kidneyL)?0:1)+((S.ect&&S.ect.kidneyR)?0:1);
  if(nkid===1)S.kidComp=clamp(S.kidComp+dt/900*(1-S.kidComp),0,1);   // 代偿曲线 τ≈15min（仿真压缩时程）
  const kidTarget=nkid===2?1:(nkid===1?0.5+0.22*S.kidComp:0.04);
  S.kidFrac += (kidTarget-S.kidFrac)*dt*0.01;
  S.creat += (clamp(80/Math.pow(Math.max(S.kidFrac,0.02),1.3),60,1800)-S.creat)*dt*0.01;
  S.fluid += (1-S.fluid)*dt*0.004*S.kidFrac;
  // pH
  const respAcid=clamp((S.paco2-40)*.008,-.2,.35);
  const metAcid=clamp((S.glucose>16?(S.glucose-16)*.01:0)+(S.map<45?.06:0)+(dOf('toxin')?(S.blood['H2O2']||0)*.1:0)+mhDrive*0.25+Math.max(0,S.cohb-0.2)*0.5+(S.pathLiver||0)*0.10+(S.pathSepsis||0)*0.08,0,.4);   // 阶段6: 肝损伤解毒↓/脓毒症灌注↓
  S.ph=clamp(7.42-respAcid-metAcid+(dOf('buffer')?(S.blood['HCO3']||0)*.09:0),6.6,7.7);
  // -- 化验扩展: Na(血液浓缩/高血糖失水→浓缩, 含盐食物→肠吸收钠负荷), 离子Ca(酸↑碱↓, 钙剂↑)
  const naT=140*Math.pow(clamp(S.fluid,.2,1.6),-0.06)+Math.max(0,S.glucose-16)*0.12
    +(dOf('naRise')?(S.blood['Sodium']||0)*8:0);   // 摄入钠: LMFood Content Sodium → LMSmallIntestine 吸收
  S.na+=(clamp(naT,110,180)-S.na)*dt*.02;
  const caT=2.35+(7.40-S.ph)*0.40-Math.max(0,S.fluid-1)*0.05+Math.min(1.2,dOf('caRise')*0.45);
  S.ca+=(clamp(caT,0.5,6.0)-S.ca)*dt*.05;
  // -- 心肌损伤→cTnI (dump.cs LMHeart 缺血损伤/Chemical Troponin=125; ConditionType MyocardialInfarction)
  //    心梗(miT)或持续心肌缺氧(低SpO₂+低灌注)累积 miLoad → cTnI 峰值-衰减曲线(τ≈29s 上升, miLoad 缓慢消退)
  const miIsch=Math.max(0,78-S.spo2)*0.0035+Math.max(0,55-S.map)*0.006;
  const miDrive=(S.miT>0?0.10:0)+miIsch;
  S.miLoad=clamp(S.miLoad+(miDrive-(miDrive<0.01?0.004:0.0004))*dt,0,3);
  S.ctni+=((0.01+S.miLoad*1.9)-S.ctni)*dt*0.035;
  // 体温（LMHypothalamus 设定点37; LMDiagnosis 阈值 35/38/40）
  let tempT=36.8+(dOf('temp')?(S.blood['MDMA']||0)*.8:0)-(dOf('tempD')?.8:0)+Math.max(0,rA['β1Adrenoceptor'])*.15
    +(S.sympath>.9?.3:0)-(S.map<40?.5:0)+rA['TR']*.2
    +(3.4+Math.min(2.8,S.t*0.012))*mhDrive         // 阶段5: 恶性高热失控产热(钙释放↑→代谢率↑, 未干预持续攀升)
    +(S.stormT>0?2.45*(1-0.45*Math.min(1,Math.max(0,-rA['β1Adrenoceptor']))):0)   // 阶段5: 甲状腺风暴产热(T₃ 解耦产热; β 阻滞部分抑制)
    -(S.cooling?0.55:0)                            // 阶段5: 物理降温(冰毯/冰袋)
    +(S.pathFever||0)                               // 阶段6: 感染性发热(致热源·免疫应答产物, 接 ConditionType Fever 既有温度通道)
    -((S.ect&&S.ect.thyroid)?0.45:0);   // 甲减性低体温倾向（甲状腺切除术）
  S.temp += (clamp(tempT,32,44)-S.temp)*dt*.02;
  // 意识（LMBrain: μ -0.8, GABAA -1.5, DAT10 …）
  // μ 阿片激动剂的镇静由上方 μR 净占位项计算（纳洛酮竞争占位可逆转）——剂量项仅计非阿片镇静药, 避免双计
  const _opAgon=c=>{const p=PHARM[c];return !!(p&&p.a&&p.d&&p.d.cnsD&&p.a.some(x=>x[0]==='μR'&&x[1]>0));};
  let _sedOther=0;for(const[_sc,_sv]of Object.entries(S.blood)){const _sp=PHARM[_sc];if(_sp&&_sp.d&&_sp.d.cnsD&&!_opAgon(_sc))_sedOther+=_sp.d.cnsD*_sv;}
  const cnsDep=Math.max(0,rA['GABAA'])*1.5+Math.max(0,rA['μR'])*0.8+_sedOther*.55+Math.max(0,rA['α2Adrenoceptor'])*.4+Math.max(0,rA['CB1'])*.4;
  const cnsEx=totalDose('cnsE')*.3+Math.max(0,rA['nAChR'])*.5;
  let gcsT=15-clamp(cnsDep*2.2+cnsEx*.8+Math.max(0,(75-S.spo2))*.12+Math.max(0,(S.paco2-75))*.08+Math.max(0,(50-S.map))*.12+Math.max(0,(S.glucose-25))*.1
    +Math.max(0,2.8-S.glucose)*4.0                                // 阶段5: 低血糖脑能量衰竭(<2.8 起意识进行性下降,<1.0 昏迷)
    +Math.max(0,S.cohb-0.18)*26,0,12)                             // 阶段5: COHb 组织缺氧
    -Math.min(6.5,(S.seizT||0)*0.30);                              // 阶段6: 高热惊厥(sys 感染>41℃ 持续→意识进行性下降)(脉搏血氧读数假性正常的陷阱)
  S.gcs=clamp(S.gcs+((clamp(gcsT,3,15))-S.gcs)*dt*.25,3,15);   // 连续演化(显示时取整)——轻中度镇静可见
  // 内源激素
  S.epiEndo=clamp((S.map<75?(75-S.map)*.02:0)+(S.spo2<90?.15:0)+(S.gcs<10?.1:0),0,.8);
  S.cortisolEndo=clamp(S.cortisolEndo+((S.map<70||S.spo2<85||S.temp>39?.4:0)-S.cortisolEndo)*dt*.01,0,1);
  // ---- 术后器官动力学（阶段2: 器官切除）----
  S.plt += (((S.ect&&S.ect.spleen)?460:250)-S.plt)*dt*0.002;      // 脾切除: 储存池丢失(15%/15%血小板储于脾)→反应性血小板增多→血栓风险↑
  S.testo += (((S.ect&&S.ect.testis)?0.08:1)-S.testo)*dt*0.003;   // 睾丸切除: 睾酮轴衰竭(LMMRS TesteroneGland 失效), 负反馈消失→FSH/LH↑
  if(S.cholFatT>0)S.cholFatT-=dt;                                 // 胆囊切除术后脂餐不适窗口（CCK 无囊可缩）
  mfrsStep(dt);                                                  // 阶段3: LMFRS 生殖周期（相位/激素/月经出血）
  // 阶段3: 死亡归因采样窗（死前 60s+ 主导病理推断 → LIDeath 死亡报告）
  if(!S.HX.length||S.t-S.HX[S.HX.length-1].t>=2){
    S.HX.push({t:S.t,rhythm:S.rhythm,k:S.k,spo2:S.spo2,map:S.map,ph:S.ph,glu:S.glucose,
      creat:S.creat,temp:S.temp,hb:S.hb||15,gcs:S.gcs,vent:!!S.vent});
    if(S.HX.length>40)S.HX.shift();
  }
  // 心律状态机
  updateRhythm(rA,dt);
  // 死亡判定
  if(S.rhythm==='arrest'){S.arrestT+=dt;
    if(S.arrestT>(S.cpr?600:240))die(S.cpr?'心搏骤停复苏失败':'心搏骤停未获救治');}
  if(S.map<15){if((S.lowMapT=(S.lowMapT||0)+dt)>180)die('循环衰竭');}else S.lowMapT=0;
  if(S.spo2<35){if((S.lowO2T=(S.lowO2T||0)+dt)>120)die('严重缺氧脑衰竭');}else S.lowO2T=0;
  if(S.glucose<1.0){if((S.lowGT=(S.lowGT||0)+dt)>90)die('低血糖脑病');}else S.lowGT=0;
  if(S.ph<6.75){if((S.lowPHT=(S.lowPHT||0)+dt)>150)die('严重酸中毒');}else S.lowPHT=0;
  if(S.temp>43){if((S.hiTT=(S.hiTT||0)+dt)>240)die('恶性高热');}else S.hiTT=0;
  if(S.creat>1500)die(S.ect&&S.ect.kidneyL&&S.ect.kidneyR?'双侧肾切除·尿毒症':'肾功能衰竭尿毒症');
  // 心搏相位（3D心脏同步）
  const _pbAV=S.beatPhase, _prAV=((Math.max(0,S.t-dt)*S.rr/60)%1+1)%1;
  if(S.hr>0){S.beatPhase=(S.beatPhase+S.hr/60*dt)%1;}
  // 阶段4收尾: 相位同步游戏原声(心音/呼吸音/呼吸机循环) + 病例目标轮询
  if(typeof sfxPhaseAudio==='function')sfxPhaseAudio(_pbAV,_prAV,dt);
  if(typeof caseTick==='function')caseTick(dt);
}
function updateRhythm(R,dt){
  const prev=S.rhythm;
  const caGate=(S.ca>2.6?0.22:1);   // 阶段5: 高钾心律失常阈值——钙剂稳膜后诱颤概率降至 ~22%(膜电位梯度恢复)
  if(S.rhythm==='sinus'||S.rhythm==='afib'){
    if(S.k>6.8&&Math.random()<dt*.05*(S.k-6.5)*caGate)setRhythm('vt');
    if(S.k>7.4&&Math.random()<dt*.08*caGate)setRhythm('vf');
    if(S.map<25&&Math.random()<dt*.04)setRhythm('arrest');
    if(S.miT>0&&Math.random()<dt*.012)setRhythm('vf');
    if(S.hr>195&&Math.random()<dt*.015)setRhythm('vt');
    if(S.hr<20&&!S.pace&&!S.cpr)setRhythm('arrest');
  }else if(S.rhythm==='vt'){
    if(Math.random()<dt*.02)setRhythm('vf');
    if(((S.k>3.2&&S.k<5.5)||(S.blood['Magnesium']||0)>0.25)&&Math.random()<dt*.05)setRhythm('sinus');   // 阶段5: 顽固性低钾(洋地黄中毒样)不转复; 补镁提升膜稳定性→自发性转复
  }else if(S.rhythm==='vf'){
    if(Math.random()<dt*.003)setRhythm('arrest');
  }
  if(S.rhythm==='sinus'&&!S.svt&&(adrenalineStorm())&&Math.random()<dt*.004)setRhythm('afib');   // SVT 为折返环路, 窦性极速化路径不适用
  if(prev!==S.rhythm)log(`心律转为 <b>${rhythmName(S.rhythm)}</b>`,'crit');
}
function adrenalineStorm(){return S.hr>150;}
function setRhythm(r){S.rhythm=r;S.arrestT=0;}
function rhythmName(r){return{sinus:'窦性',afib:'房颤',vt:'室速',vf:'室颤',arrest:'停搏'}[r];}
// ============ LIDeath 死亡报告（阶段3）: 直接死因链 + 基础病变 + 存活时长 + 时间线摘要 ============
function die(cause){
  if(S.dead)return;
  S.dead=true;S.deathCause=cause;
  S.deathInfo=buildDeathReport(cause);
  log('💀 死亡：'+cause+'——【直接死因】'+S.deathInfo.direct,'crit');
  if(typeof renderDeathCard==='function')renderDeathCard();
  document.getElementById('death').style.display='flex';
  const bw=document.getElementById('btnWithdraw');if(bw)bw.style.display='none';
  playTone(880,.6,3);
  if(typeof sfx==='function')sfx('Vital-Zero',{gain:.85});
  if(typeof caseFail==='function'&&typeof CASEC!=='undefined'&&CASEC&&CASEC.active)caseFail('患者死亡：'+cause);
}
function getDeathReport(){return S.deathInfo||buildDeathReport(S.deathCause||'未知');}
function buildDeathReport(cause){
  const rep={direct:cause,chain:[],basis:[],dur:fmtT(S.t),timeline:[],withdrawn:null};
  const W=S.HX||[];
  const frac=f=>W.length?W.filter(f).length/W.length:0;
  const avg=f=>W.length?W.reduce((s,w)=>s+f(w),0)/W.length:0;
  const kAvg=avg(w=>w.k),spoAvg=avg(w=>w.spo2),mapAvg=avg(w=>w.map),phAvg=avg(w=>w.ph),
        gluAvg=avg(w=>w.glu),tempMax=W.length?Math.max(...W.map(w=>w.temp)):0,
        hbMin=W.length?Math.min(...W.map(w=>w.hb)):15,creatLast=W.length?W[W.length-1].creat:(S.creat||80);
  if(S.withdrawn){   // 撤除生命维持宣告路径（LIDeath.MachineWithdrawal）
    rep.direct='已撤除生命维持，宣告临床死亡';
    rep.chain.push('撤除路径：呼吸机 / 起搏 / CPR 终止（LIDeath.MachineWithdrawal）','宣告时 MAP '+Math.round(S.map)+' mmHg · SpO₂ '+Math.round(S.spo2)+'% · GCS '+Math.round(S.gcs));
  }else if(frac(w=>w.rhythm==='vf')>=0.25){
    rep.direct='心室颤动 → 心源性猝死';
    rep.chain.push('死前窗口 '+Math.round(frac(w=>w.rhythm==='vf')*100)+'% 采样为室颤——有效循环终止，未除颤/除颤失败');
  }else if(frac(w=>w.rhythm==='vt')>=0.4){
    rep.direct='室性心动过速 → 心源性猝死';
    rep.chain.push('死前窗口持续室速（'+Math.round(frac(w=>w.rhythm==='vt')*100)+'%）——每搏量骤降并倾向恶化');
  }else if(kAvg>6.5){
    rep.direct='高钾血症 → 恶性心律失常（心搏骤停）';
    rep.chain.push('死前血钾均值 '+kAvg.toFixed(1)+' mmol/L——膜电位上移致除极异常（>6.8 极易室速/室颤）');
  }else if(spoAvg<62&&!frac(w=>w.vent)&&hbMin>9){
    rep.direct='低氧血症 → 呼吸衰竭';
    rep.chain.push('死前 SpO₂ 均值 '+Math.round(spoAvg)+'%（未通气支持）——肺泡通气/换气衰竭 → 缺氧脑死亡');
  }else if(mapAvg<38&&hbMin<9){
    rep.direct='低血容量 → 失血性休克';
    rep.chain.push('死前 MAP 均值 '+Math.round(mapAvg)+' mmHg · Hb 最低 '+hbMin.toFixed(1)+' g/dL——失血/容量不足致灌注崩溃');
  }else if(creatLast>1200){
    rep.direct='肾功能衰竭 → 尿毒症';
    rep.chain.push('死前肌酐 '+Math.round(creatLast)+' μmol/L——氮质血症/电解质紊乱终末相');
  }else if(gluAvg<1.6){
    rep.direct='低血糖 → 脑功能衰竭';
    rep.chain.push('死前血糖均值 '+gluAvg.toFixed(1)+' mmol/L——脑能量底物耗竭');
  }else if(phAvg<6.9){
    rep.direct='严重代谢性酸中毒';
    rep.chain.push('死前 pH 均值 '+phAvg.toFixed(2)+'——心肌收缩力与酶系统失代偿');
  }else if(tempMax>42.8){
    rep.direct='恶性高热';
    rep.chain.push('死前体温峰值 '+tempMax.toFixed(1)+'℃——蛋白变性/多器官衰竭');
  }else if(frac(w=>w.rhythm==='arrest')>=0.6){
    rep.direct=(S.cpr?'心搏骤停（心肺复苏失败）':'心搏骤停（未获救治）');
  }else if(spoAvg<62){
    rep.direct='低氧血症 → 呼吸衰竭（机械通气下氧合失败）';
  }
  // 死前活跃的次要病理（次要死因链）
  const secs=[];
  if(kAvg>5.6)secs.push('高钾血症 '+kAvg.toFixed(1));
  if(spoAvg<90)secs.push('低氧血症 SpO₂ '+Math.round(spoAvg)+'%');
  if(mapAvg<65)secs.push('低灌注 MAP '+Math.round(mapAvg));
  if(phAvg<7.25)secs.push('酸中毒 pH '+phAvg.toFixed(2));
  if(creatLast>150)secs.push('肾功能不全 肌酐 '+Math.round(creatLast));
  if(gluAvg>20)secs.push('高血糖 '+gluAvg.toFixed(1));else if(gluAvg<3&&gluAvg>0)secs.push('低血糖 '+gluAvg.toFixed(1));
  if(tempMax>39.5)secs.push('高热 '+tempMax.toFixed(1));
  if(hbMin<9)secs.push('贫血 Hb '+hbMin.toFixed(1));
  if(secs.length&&!S.withdrawn)rep.chain.push('死前活跃病理：'+secs.join(' · '));
  rep.basis=deathBasis();
  // 全局时间线摘要（本局关键事件 log 摘录：危急事件优先 + 末尾近况）
  const ev=(typeof EVENTS!=='undefined'&&EVENTS)?EVENTS.slice():[];
  rep.timeline=ev.filter(e=>e.cls==='crit').slice(-12);
  for(const e of ev.slice(-5))if(!rep.timeline.includes(e)&&e.msg.indexOf('死亡：')!==0)rep.timeline.push(e);
  rep.timeline.sort((a,b)=>a.t-b.t);
  return rep;
}
function deathBasis(){        // 基础病变: 本局做过的操作 + 持续治疗 + 中毒药物 + 慢性化改变
  const b=[];
  const ets=Object.keys(S.ect||{});
  if(ets.length)b.push('器官切除：'+ets.map(id=>(typeof ECT_LIB!=='undefined'&&ECT_LIB[id])?ECT_LIB[id].op:id).join('、')+'（本局手术·不可逆）');
  const inf=Object.keys(S.infuse||{});
  if(inf.length)b.push('持续输注维持：'+inf.map(c=>zhOf(c)).join('、'));
  if(S.bac>0.5)b.push('急性酒精中毒（死前 BAC '+S.bac.toFixed(2)+'‰）');
  const OD=['Morphine','Heroin','Fentanyl','Codeine','Oxycodone','Hydrocodone','Cocaine','Amphetamine','Methamphetamine','MDMA','LSD','THC'];
  const od=OD.filter(c=>(S.blood[c]||0)>0.5).map(c=>zhOf(c));
  if(od.length)b.push('中毒药物在血：'+od.join('、'));
  if(S.miT>0||S.miLoad>0.5)b.push('急性心肌梗死（本局病程 · 心肌损伤负荷 '+S.miLoad.toFixed(2)+'）');
  if((S.creat||80)>150)b.push('肾功能不全（肌酐 '+Math.round(S.creat)+' μmol/L'+(S.ect&&(S.ect.kidneyL||S.ect.kidneyR)?'·肾切除术后':'')+'）');
  if((S.testo||1)<0.5)b.push('性腺功能减退（睾丸切除术后·睾酮轴衰竭）');
  if(S.frs&&S.ect&&S.ect.uterus)b.push('生殖周期停摆（子宫切除术后·LMFRS 移除）');
  if(!b.length)b.push('本局未行器官手术、无持续输注与中毒药物记录');
  return b;
}

// ============ 医嘱与干预 ============
function administer(){
  const chem=document.getElementById('chemSel').value;
  const route=document.getElementById('routeSel').value;
  const dose=parseFloat(document.getElementById('doseIn').value)||1;
  if(!chem||chem==='Null'||chem==='HCl2'&&route!=='Oral')return;
  const doseAdj=dose/10, logN=zhOf(chem);
  if(typeof PATH_LIB!=='undefined'&&PATH_LIB[chem]){pathInoculate(chem,dose);return;}   // 阶段6: 病原体接种通道(剂量=接种量)
  if(chem==='ImmunGlobulin'&&route!=='Inhale')log('🧪 <b>免疫球蛋白</b>（免疫系统支持制剂）: 被动免疫支持, 病原清除率↑（不属抗病毒药, 游戏治疗哲学=支持疗法+免疫系统自身）');
  switch(route){
    case'Oral':S.gut[chem]=(S.gut[chem]||0)+doseAdj;break;
    case'IVPush':S.blood[chem]=(S.blood[chem]||0)+doseAdj*1.6;break;
    case'Muscle':S.gut[chem]=(S.gut[chem]||0)+doseAdj*0.8;break;
    case'ContinuousInfusion':S.infuse[chem]=(S.infuse[chem]||0)+doseAdj*0.05;setTimeout(()=>delete S.infuse[chem],60000);break;
    case'Inhale':if(chem==='O2'){S.fio2=Math.min(1,S.fio2+0.4);break;}S.blood[chem]=(S.blood[chem]||0)+doseAdj*1.2;break;
  }
  log(`给药：<b>${logN}</b> ×${dose}（${{Oral:'口服',IVPush:'静推',Muscle:'肌注',ContinuousInfusion:'持续输注',Inhale:'吸入'}[route]}）`);
  if(chem==='Histamine'&&dose>=8){log('⚠ 组胺大量入血——过敏样反应','crit');}
  if(chem==='Adenosine'&&S.rhythm==='vt'){log('腺苷对室速无效（教学保留点）','crit');}
  if(typeof sfx==='function'&&(route==='IVPush'||route==='ContinuousInfusion'))sfx('IVBag',{gain:.5});   // 阶段4: 输注开始原声
}
function clearDrug(){S.blood={};S.gut={};S.gutSpd={};S.infuse={};S.bac=0;S.alcGut=0;S._alcSeen=false;log('代谢清除（教学快捷方式·含酒精）');}
function doDefib(){doShock();}   // 旧入口/回归测试兼容
function setEnergy(btn,j){
  S.defibJ=j;
  document.querySelectorAll('.enBtn').forEach(b=>b.classList.toggle('sel',b===btn));
  const t=document.getElementById('enNow');if(t)t.textContent=j;
  log('⚡ 除颤能量选择 '+j+'J');
}
function doShock(){
  if(typeof sfx==='function')sfx('Defibrillator',{gain:.6});   // 阶段4: 除颤充电原声
  if(S.rhythm==='sinus'){ // 窦性节律电击会诱发室颤(真实行为) → 弹窗确认
    showConfirm('当前为<b>窦性心律</b>。此节律下放电为非同步电击，将诱发<b>心室颤动</b>（真实行为，教学演示）。确认电击？',()=>applyShock(true));
    return;
  }
  applyShock(false);
}
function applyShock(onSinus){
  playTone(60,.3,40);
  if(typeof vfxShockFlash==='function')vfxShockFlash();   // 阶段5: 除颤电击→全场景白闪 150ms(VFX)
  if(typeof sfx==='function')sfx('Defibrillator-Shock',{gain:.85});   // 阶段4: 放电原声
  const j=S.defibJ;
  if(onSinus){setRhythm('vf');log('⚠ 窦性心律电击 → 诱发<b>心室颤动</b>（R-on-T）','crit');return;}
  const p=clamp(.5+(j-120)/240*.4,.1,.95);   // 能量→转复概率: 120J≈50% … 360J≈90%
  if(S.rhythm==='vf'||S.rhythm==='vt'){
    if(Math.random()<p){setRhythm('sinus');if(typeof sfx==='function')sfx('Vital-Pulse',{gain:.5});
      log('⚡ '+j+'J 除颤成功，恢复窦性'+(S.cpr?' · <b>ROSC 自主循环恢复</b>，可逐步停止按压':''));
    }else log('⚡ '+j+'J 未转复，维持'+rhythmName(S.rhythm)+'（p='+(p*100).toFixed(0)+'%）','crit');
  }else if(S.rhythm==='afib'){
    if(Math.random()<p*.8){setRhythm('sinus');log('⚡ '+j+'J 同步电复律成功（房颤→窦性）');}
    else log('⚡ '+j+'J 电复律失败','crit');
  }else log('⚡ 非除颤指征（'+rhythmName(S.rhythm)+'）','crit');
}
let confirmCb=null;
function showConfirm(msg,cb){
  document.getElementById('confirmMsg').innerHTML=msg;
  document.getElementById('confirmBox').style.display='flex';
  confirmCb=cb;
}
function okConfirm(){document.getElementById('confirmBox').style.display='none';if(confirmCb){const cb=confirmCb;confirmCb=null;cb();}}
function cancelConfirm(){document.getElementById('confirmBox').style.display='none';confirmCb=null;}
function paceToggle(cb){
  S.pace=cb.checked;
  const r=document.getElementById('paceRate');if(r&&r.value)S.paceRate=parseInt(r.value)||CAL.heart.sa_node_rate_bpm;
  const v=document.getElementById('paceRateV');if(v)v.textContent=S.paceRate;
  log(S.pace?('🩺 起搏开启 '+S.paceRate+'bpm（心动过缓/传导阻滞时接管心率）'):'🩺 起搏关闭');
}
function doPace(btn){S.pace=!S.pace;const cb=document.getElementById('paceOn');if(cb)cb.checked=S.pace;if(btn&&btn.classList)btn.classList.toggle('on',S.pace);if(typeof sfx==='function')sfx('Electric',{gain:.45});log(S.pace?'🩺 起搏开启':'🩺 起搏关闭');}
function paceSet(r){S.paceRate=parseInt(r.value);const v=document.getElementById('paceRateV');if(v)v.textContent=r.value;}
function ventToggle(cb){
  S.vent=cb.checked;
  const b=document.getElementById('btnVent');if(b&&b.classList)b.classList.toggle('on',S.vent);
  log(S.vent?('💨 呼吸机启动（RR '+S.ventRR+'/min · Vt '+S.ventVt+'ml · PEEP '+S.ventPeep+' · FiO₂ '+Math.round(S.fio2*100)+'% · A/C）'):'💨 呼吸机撤机');
}
function doVent(btn){S.vent=!S.vent;const cb=document.getElementById('ventOn');if(cb)cb.checked=S.vent;if(btn&&btn.classList)btn.classList.toggle('on',S.vent);log(S.vent?'💨 机械通气':'💨 撤机');}
function ventSet(){
  S.ventRR=parseInt(document.getElementById('ventRR').value);
  S.ventVt=parseInt(document.getElementById('ventVt').value);
  S.ventPeep=parseInt(document.getElementById('ventPeep').value);
  S.fio2=parseInt(document.getElementById('ventFi').value)/100;
  const w=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  w('ventRRv',S.ventRR);w('ventVtv',S.ventVt);w('ventPeepv',S.ventPeep);w('ventFiv',Math.round(S.fio2*100));
}
function doO2(btn){if(S.fio2<.95){S.fio2=S.vent?1.0:.85;btn.classList.add('on');log('🅾 吸氧高浓度');}else{S.fio2=0.21;btn.classList.remove('on');log('🅾 停止吸氧');}}
function doCPR(btn){
  S.cpr=!S.cpr;
  if(btn&&btn.classList)btn.classList.toggle('on',S.cpr);
  const other=document.getElementById(btn&&btn.id==='cprBtn'?'btnCPR':'cprBtn');
  if(other&&other.classList&&other!==btn)other.classList.toggle('on',S.cpr);
  log(S.cpr?'🫀 CPR 开始（前向血流维持冠脉灌注）':'🫀 CPR 停止');
}
function doFluid(){S.fluid=clamp(S.fluid+.08,.3,1.6);S.k*=.985;S.hb=Math.max(3,(S.hb||15)*0.985);log('💧 补液 500ml');if(typeof sfx==='function')sfx('IVBag',{gain:.45});}
function doTransfuse(){S.hb=Math.min(18,(S.hb||15)+1.1);S.fluid=clamp(S.fluid+.06,.3,1.6);log('🩸 输血 400ml（全血 · 库血 Hb 回升）');if(typeof sfx==='function')sfx('IVBag',{gain:.5});}
function doBleed(){S.fluid=clamp(S.fluid-.09,.2,1.6);S.sympath=Math.min(1.5,S.sympath+.3);S.hb=Math.max(3,(S.hb||15)-0.9);S.bleedPulse=1;log('🩸 放血 500ml');if(typeof pfxEmitBleed==='function')pfxEmitBleed(46,0);}   // 阶段6: 出血事件→PFX 粒子喷发
// ---- 阶段5: 新病例干预操作 ----
function doPericardial(){                     // 心包穿刺 pericardiocentesis(剑突入路·引流减压)
  if(S.dead){log('患者已死亡，操作无意义');return;}
  if(S.drainT>0){log('🩹 心包穿刺引流进行中…');return;}
  if(S.tamponade<=0.02){log('🩹 无心包积液压迫证据——心包穿刺不予执行（教学保守原则）');return;}
  S.drainT=6;
  log('🩹 <b>心包穿刺</b>开始：剑突下入路引流心包积液（约 6s 完成减压）','crit');
  if(typeof sfx==='function')sfx('IVBag',{gain:.5});
}
function doCooling(btn){                      // 物理降温(冰毯/冰袋·对流蒸发)
  S.cooling=!S.cooling;
  if(btn&&btn.classList)btn.classList.toggle('on',S.cooling);
  log(S.cooling?'❄ 物理降温开启（冰毯/冰袋——目标核心温度回落）':'❄ 停止物理降温');
}
function toggleAdm(){S.inoOn=!S.inoOn;document.getElementById('btnAdm').classList.toggle('on',S.inoOn);log(S.inoOn?'🤖 拟交感滴注开（最小心率110）':'🤖 拟交感支持关');}
function togglePause(){S.paused=!S.paused;document.getElementById('pauseBtn').textContent=S.paused?'▶ 继续':'⏸ 暂停';}
// ============ LIDeath 死亡卡片渲染 + 撤除生命维持（阶段3） ============
function renderDeathCard(){
  const rep=getDeathReport();
  const card=document.getElementById('deathCard');if(!card)return;
  const dt=new Date();const hm=('0'+dt.getHours()).slice(-2)+':'+('0'+dt.getMinutes()).slice(-2);
  let h='<div class="drow"><span class="dlabel">直接死因</span><span class="dval"><b>'+rep.direct+'</b>'+
    (rep.chain.length?'<div class="dchain">'+rep.chain.join('<br>')+'</div>':'')+'</span></div>';
  h+='<div class="drow"><span class="dlabel">基础病变</span><span class="dval">'+rep.basis.map(x=>'· '+x).join('<br>')+'</span></div>';
  h+='<div class="drow"><span class="dlabel">存活时长</span><span class="dval"><b>'+rep.dur+'</b>（宣布 '+hm+'，LIDeath.DeathTime）</span></div>';
  h+='<div class="dtl"><h5>时间线摘要 · 本局关键事件</h5>'+
    (rep.timeline.length?rep.timeline.map(e=>'<div class="dline'+(e.cls==='crit'?' crit':'')+'">['+fmtT(e.t)+'] '+e.msg+'</div>').join(''):'<div class="dline">（无关键事件记录）</div>')+'</div>';
  card.innerHTML=h;
  const dc=document.getElementById('deathCause');if(dc)dc.textContent=rep.direct;   // 兼容旧节点
  const bd=document.getElementById('btnWithdrawD');
  if(bd)bd.style.display=(S.vent||S.pace||S.cpr)?'inline-block':'none';
}
function withdrawLifeAsk(){
  showConfirm('确认 <b>撤除生命维持</b>？<br>呼吸机 / 起搏 / CPR 将全部终止，随即正式<span style="color:#b3121c;font-weight:700">宣告临床死亡</span>（LIDeath.MachineWithdrawal）。此操作不可逆。',
    withdrawLifeSupport);
}
function withdrawLifeSupport(){
  S.vent=false;S.cpr=false;S.pace=false;S.withdrawn=true;
  const cb=document.getElementById('ventOn');if(cb)cb.checked=false;
  const po=document.getElementById('paceOn');if(po)po.checked=false;
  document.querySelectorAll('#pumpGrid button').forEach(b=>{if(b.classList&&typeof b.classList.remove==='function')b.classList.remove('on');});
  const msg='已撤除生命维持，宣告临床死亡';
  if(!S.dead){die(msg);}
  else{
    if(S.deathInfo){S.deathInfo.direct=msg;S.deathInfo.withdrawn=msg;S.deathInfo.chain.unshift('撤除路径（补宣告）：呼吸机 / 起搏 / CPR 终止（LIDeath.MachineWithdrawal）');}
    log('🚫 '+msg+'（LIDeath.MachineWithdrawal）','crit');
    renderDeathCard();
  }
}
function resetSim(){S=baseState();if(typeof LABH!=='undefined')LABH.length=0;if(typeof EVENTS!=='undefined')EVENTS.length=0;document.getElementById('death').style.display='none';document.querySelectorAll('#pumpGrid button').forEach(b=>b.classList.remove('on'));
  const cbtn=document.getElementById('cprBtn');if(cbtn&&cbtn.classList)cbtn.classList.remove('on');
  const po=document.getElementById('paceOn');if(po)po.checked=false;
  const vo=document.getElementById('ventOn');if(vo)vo.checked=false;
  if(typeof renderOrganStrip==='function')renderOrganStrip();   // 器官切除状态随重置还原
  if(typeof vfxReset==='function')vfxReset();   // 阶段5: VFX 表现层状态复位(死亡渐变/闪烁计数归零)
  if(typeof pfxReset==='function')pfxReset();   // 阶段6: PFX 粒子层复位
  if(typeof CASEC!=='undefined'&&CASEC&&CASEC.active&&typeof caseAbort==='function')caseAbort();   // 阶段4: 复苏重置=中止进行中的病例
  log('复苏重置，监护重新开始');}
// ============ 音效（WebAudio） ============
let ac=null,noiseNode=null;
function playTone(freq,dur,gain=1){
  if(!S.soundOn)return;
  try{
    ac=ac||new(window.AudioContext||window.webkitAudioContext)();
    const o=ac.createOscillator(),g=ac.createGain();
    o.frequency.value=freq;o.type='sine';
    g.gain.setValueAtTime(gain*0.08,ac.currentTime);
    g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+dur);
    o.connect(g).connect(ac.destination);o.start();o.stop(ac.currentTime+dur);
  }catch(e){}
}
function toggleSound(){S.soundOn=!S.soundOn;document.getElementById('sndBtn').textContent=S.soundOn?'🔊 音效开':'🔇 静音';}
// ============ 波形渲染（三通道扫掠） ============
function mkSweep(cv,color,speed=100){ // speed px/s
  const ctx=cv.getContext('2d');
  let x=0,lastY=null;
  function resize(){cv.width=cv.clientWidth*2;cv.height=cv.clientHeight*2;ctx.font='20px Consolas';x=0;}
  // 深色监护屏配色(拟物机身内): 写头擦除列=屏幕底色, 网格=暗蓝刻度
  function clearCol(px){ctx.fillStyle='#0c1220';ctx.fillRect(px,0,14*2,cv.height);
    ctx.strokeStyle='#223454';ctx.lineWidth=1;
    for(let gy=0;gy<cv.height;gy+=40){ctx.beginPath();ctx.moveTo(px,gy+.5);ctx.lineTo(px+28,gy+.5);ctx.stroke();}}
  return{resize,draw(fn,dt){
    const w=cv.width,h=cv.height,step=Math.max(2,Math.round(speed*dt*2));
    for(let i=0;i<step;i++){
      const px=Math.round(x);
      if(px+26>w){x=0;lastY=null;continue;}
      clearCol(px);
      const y=fn(h,i/step/step+x/w);
      if(lastY!==null){
        ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();
        ctx.moveTo(px-2,lastY);ctx.lineTo(px+2,y);ctx.stroke();
      }
      lastY=y;x+=1;
    }
  }};
}
let ecgSw,plSw,co2Sw;
// ECG 波形（校准的时相模型）
function ecgY(h,t){
  const mid=h*0.55;
  const P=(x,c,w,a)=>a*Math.exp(-((x-c)**2)/(2*w));
  let v=0;
  const phase=S.beatPhase;
  if(S.rhythm==='sinus'){
    v+=P(phase,.10,.010,.10);
  }
  if(S.rhythm==='sinus'||S.rhythm==='afib'){
    v+=P(phase,.24,.004,-.06)+P(phase,.28,.006,.7)+P(phase,.32,.004,-.14);
    v+=P(phase,.52,.05,S.k>6?.5:S.k<3?.03:.22);
    if(S.rhythm==='afib')v+=(Math.random()-.5)*.04;
  }else if(S.rhythm==='vt'){v=Math.sin((S.t*9)%6.28)*.55;}
  else if(S.rhythm==='vf'){v=(Math.random()-.5)*.8*Math.sin(S.t*31+Math.random()*9);}
  else{v=P(.5,.2,.02,.01)+(Math.random()-.5)*.008;}
  // 呼吸漂移
  v+=Math.sin(S.t*.9)*.02;
  return mid - v*h*0.42;
}
// 脉搏容积波（双峰切迹）
function plethY(h){
  const mid=h*0.62;
  if(S.rhythm==='arrest'||S.rhythm==='vf'||S.hr<=0)return mid;
  const p=S.beatPhase;
  const up=Math.exp(-Math.pow((p-0.18)/0.055,2));
  const dn=Math.exp(-Math.pow((p-0.30)/0.09,2));
  const dic=Math.exp(-Math.pow((p-0.52)/0.055,2))*0.35;
  const v=(up-dn*0.72)*S.contract*0.9+dic;
  const amp=clamp(S.map/95,.15,1.6);
  return mid-v*h*0.34*amp;
}
// 二氧化碳波形（capnography方波+平台）
function co2Y(h){
  const mid=h*0.8;
  if(S.rhythm==='arrest'||S.rr<=0.5)return mid;
  const cyc=((S.t*S.rr/60)%1);
  const etco2=clamp(S.paco2*0.7,5,70);
  let fr;
  if(cyc<0.12)fr=cyc/0.12;             // 吸气基线快速升
  else if(cyc<0.62)fr=1-(Math.exp(-((cyc-0.12)/0.05)))*0.0; // 平台
  else if(cyc<0.75)fr=1-((cyc-0.62)/0.13)*0.85;             // 呼气下降
  else fr=0.15;
  return mid-(0.15+fr*0.8)*h*(etco2/70)*0.9;
}
// 心跳同步音
let lastBeatSec=-1;
function waveFrame(dt){
  if(document.hidden)return;
  if(typeof vfxUi==='function')vfxUi(dt);   // 阶段5: 除颤白闪等 VFX DOM 表现(50ms 刷新)
  ecgSw.draw(ecgY,dt);plSw.draw(plethY,dt);co2Sw.draw(co2Y,dt);
  if(S.hr>0&&S.rhythm!=='arrest'){
    const beatNow=Math.floor(S.t*S.hr/60);
    if(beatNow!==lastBeatSec){lastBeatSec=beatNow;playTone(660+clamp(S.spo2,60,100)*4,.075,.6);}
  }
}
// ============ 3D 心脏（canvas 软件渲染） ============
var MESH=null;
var BW={sel:null};
// 肺/肾左右两叶在器官条折叠为一枚(组键): 3D 高亮/压暗经 selHits 换算
var ORGAN_GROUP={lungL:'lung',lungR:'lung',kidneyL:'kidney',kidneyR:'kidney',adrenalL:'adrenal',adrenalR:'adrenal'};
function selHits(id){if(!BW.sel)return false;if(BW.sel===id)return true;var g=ORGAN_GROUP[id];return !!g&&BW.sel===g;}
var ORGANS=[];
var SPREAD=1.45;
var ORGAN_ICONS={heart:'Blood',lungL:'Lung',lungR:'Lung',liver:'Liver',spleen:'Spleen',thyroid:'Thyroid',pancreas:'Pancreas',gallbladder:'Gallbladder',kidneyL:'Kidney',kidneyR:'Kidney',stomach:'Stomach'};
// 手绘内联 SVG 图标: 覆盖无游戏素材的器官(按解剖特征+器官色绘制, 24×24)
var ORGAN_SVG={
 brain:'<path d="M12 3c-2.5 0-3.4 1.2-4 2-1.8-.2-3.4 1.2-3.2 3C3 9 2.6 11 3.6 12.4c-.8 1.8.4 3.8 2.2 4.1.3 1.9 2.3 3 4 2.3.9 1 3.6 1 4.5 0 1.7.8 3.7-.3 4-2.2 1.8-.3 3-2.3 2.2-4.1 1-1.5.6-3.4-1.2-4.4.2-1.8-1.4-3.2-3.2-3C15.4 4.2 14.5 3 12 3z" fill="#b6809e"/><path d="M12 5.5v12M8.3 7.5c1 1 1 2.2 0 3.2M15.7 8c-1 1-1 2.2 0 3.2" stroke="#8a5a75" stroke-width="1.1" fill="none"/>',
 airway:'<path d="M12 3v7M12 10c0 4-6 4-7 10M12 10c0 4 6 4 7 10" fill="none" stroke="#9fb7c9" stroke-width="2.2" stroke-linecap="round"/>',
 sintestine:'<path d="M6 5c8-2 12 1 12 3.6 0 2-2 3-4 3s-3-1-3-2.6M6 19c8 2 12-1 12-3.6 0-2-2-3-4-3s-3 1-3 2.6" fill="none" stroke="#e0a08a" stroke-width="2" stroke-linecap="round"/>',
 lintestine:'<path d="M7 4h10a4 4 0 0 1 3.6 5.6c-1.6 5.6-4.2 9.4-9.6 9.4H8.4a2.9 2.9 0 0 1 0-5.8h2.8" fill="none" stroke="#d98f70" stroke-width="2.2" stroke-linecap="round"/>',
 adrenal:'<path d="M6.5 13.5C6.5 9 9 6.5 12 6.5s5.5 2.5 5.5 7z" fill="#d9b23f"/><ellipse cx="12" cy="16.4" rx="6.2" ry="3.1" fill="#b9853f"/>',
 bladder:'<ellipse cx="12" cy="11" rx="7.2" ry="6" fill="#e3c46a"/><path d="M12 17v4" stroke="#b79a3f" stroke-width="2.2" stroke-linecap="round"/>',
 prostate:'<path d="M12 5.5c4.8 0 7.8 3.2 7.8 6.8S16.8 19 12 19 4.2 15.9 4.2 12.3 7.2 5.5 12 5.5z" fill="#c98a8f"/><path d="M12 7.5v9" stroke="#a4646b" stroke-width="1.2"/>',
 uterus:'<path d="M12 6.5c3 0 4.4 2 4.4 4.8 0 3-2 5.8-4.4 7.7-2.4-1.9-4.4-4.7-4.4-7.7C7.6 8.5 9 6.5 12 6.5z" fill="#d1688e"/><path d="M7.6 8.4C5 8.2 3.2 10 3.2 11.8M16.4 8.4c2.6-.2 4.4 1.6 4.4 3.4" stroke="#d1688e" stroke-width="1.5" fill="none"/><circle cx="3.4" cy="12.8" r="1.7" fill="#d1688e"/><circle cx="20.6" cy="12.8" r="1.7" fill="#d1688e"/>',
 testis:'<circle cx="9" cy="14.5" r="4.1" fill="#d8a08a"/><circle cx="15" cy="14.5" r="4.1" fill="#d8a08a"/><path d="M8 6.5c1-2 2.8-3 4-3s3 1 4 3" stroke="#b9853f" stroke-width="2" fill="none" stroke-linecap="round"/>',
 artery:'<path d="M12 21V8M12 12c-3 0-5-1.8-7-6M12 12c3 0 5-1.8 7-6M12 17h-5M12 17h5" fill="none" stroke="#c22032" stroke-width="2.2" stroke-linecap="round"/>',
 vein:'<path d="M12 21V8M12 12c-3 0-5-1.8-7-6M12 12c3 0 5-1.8 7-6M12 17h-5M12 17h5" fill="none" stroke="#2e4fb0" stroke-width="2.2" stroke-linecap="round"/>'
};
function organSvgIco(id){return ORGAN_SVG[id]?('<span class="svgIco"><svg viewBox="0 0 24 24">'+ORGAN_SVG[id]+'</svg></span>'):null;}
function renderOrganStrip(){
  const strips=[document.getElementById('organStrip'),document.getElementById('organStripBig')].filter(s=>s);
  if(!strips.length||!ORGANS.length)return;
  strips.forEach(strip=>strip.innerHTML='');
  // 展示条目: 左右肺/肾按 ORGAN_GROUP 折叠为一枚 "肺"/"肾"; 组的全部成员切除才显示"已切除"
  const seen={},entries=[];
  OrgansLoop: for(const o of ORGANS){
    const g=ORGAN_GROUP[o.id],key=g||o.id;
    let e=seen[key];
    if(!e){const gzh={lung:'肺',kidney:'肾',adrenal:'肾上腺'};e=seen[key]={key,ids:[],zh:g?gzh[g]:o.zh,ic:ORGAN_ICONS[o.id],color:o.color};entries.push(e);}
    e.ids.push(o.id);
    const rm=!!(S.ect&&S.ect[o.id]);
    e.removed=(e.removed===undefined)?rm:(e.removed&&rm);
  }
  entries.forEach(e=>{
    const b=document.createElement('button');
    const rm=!!e.removed;
    const dotC='rgb('+Math.round(e.color[0]*255)+','+Math.round(e.color[1]*255)+','+Math.round(e.color[2]*255)+')';
    b.innerHTML=(rm?'<span class="ectTag">已切除</span>':'')+(e.ic?('<img src="patient/'+e.ic+'.png"'+(e.key==='heart'?' class="bloodTint"':'')+'>'):(organSvgIco(e.key)||organSvgIco(e.ids[0])||('<span class="dot" style="background:'+dotC+'"></span>')))+'<span class="zhName">'+e.zh+'</span>';
    if(BW.sel===e.key&&!rm)b.classList.add('sel');
    if(rm)b.classList.add('removed');
    strips.forEach(strip=>strip.appendChild(b.cloneNode(true)));
  });
  strips.forEach(strip=>{
    strip.querySelectorAll('button').forEach(b=>{
      b.onclick=()=>{
        const e=entries.find(x=>x.zh===b.querySelector('.zhName').textContent);
        if(!e)return;
        const allRm=e.ids.every(id=>S.ect&&S.ect[id]);
        if(allRm){BW.sel=null;renderOrganStrip();return;}   // 组内全部已切除: 不可再选中
        BW.sel=(BW.sel===e.key?null:e.key);renderOrganStrip();
      };
    });
    // 滚轮=横向滚动: 悬浮条隐藏了滚动条但仍要可达
    if(!strip.dataset.wheelBound){
      strip.dataset.wheelBound='1';
      strip.addEventListener('wheel',ev=>{
        if(Math.abs(ev.deltaY)>Math.abs(ev.deltaX)){strip.scrollLeft+=ev.deltaY;ev.preventDefault();}
      },{passive:false});
    }
  });
}
function toggleSpread(){
  SPREAD=(SPREAD>1.05?1.0:1.45);
  document.getElementById('btnSpread').classList.toggle('on',SPREAD>1.05);
}
function toggleBig3d(){
  const el=document.getElementById('big3d');
  const cv=document.getElementById('h3d');
  const open=el.style.display!=='flex';
  el.style.display=open?'flex':'none';
  if(open){document.getElementById('glSlot').appendChild(cv);}else{document.getElementById('heartBox').appendChild(cv);}
}
function renderHeart(dt){}
async function loadHeart(){}

// ============ 数值与报警 ============
window.simSnapshot=function(){return S;}
const ICON_MAP={Pain:'Pain',Bleed:'Bleed',Apnea:'Apnea',Anaphylaxis:'Allergy',Coma:'Sleep',Stupor:'Sleep',Inflame:'Inflame',Fever:'Action-Hot',Hypothermia:'Action-Cold',Anxiety:'Anxiety',Depress:'Depress',Fright:'Fright',Vertigo:'Vertigo',Hypoxemia:'Apnea',Infect:'Infect',Relax:'Relax',Menstruation:'Bleed'};
function uiFrame(){
  if(S.paused||S.dead)return;
  const set=(id,val,warn,crit,txt)=>{const el=document.getElementById(id);el.className=el.className.replace(/ (warn|crit)/g,'')+(crit?' crit':warn?' warn':'');el.querySelector('.val').textContent=txt;};
  set('n-hr',S.hr,S.hr>110||S.hr<50,S.hr>160||S.hr<35,Math.round(S.hr));
  set('n-spo2',S.spo2,S.spo2<93,S.spo2<85,Math.round(S.spo2));
  set('n-rr',S.rr,S.rr>26||S.rr<8,S.rr>42||S.rr<4,Math.round(S.rr));
  document.getElementById('etco2v').textContent='etCO₂ '+Math.round(clamp(S.paco2*0.7,5,70));
  document.getElementById('n-rr').querySelector('.unit').textContent='bpm';
  set('t-map',S.map,S.map<68||S.map>110,S.map<50||S.map>140,Math.round(S.map));
  set('t-temp',S.temp,S.temp>37.8||S.temp<35.8,S.temp>40||S.temp<33,S.temp.toFixed(1));
  set('t-glu',S.glucose,S.glucose<3.5||S.glucose>11,S.glucose<2.2||S.glucose>25,S.glucose.toFixed(1));
  set('t-k',S.k,S.k<3.3||S.k>5.6,S.k<2.5||S.k>6.8,S.k.toFixed(1));
  set('t-ph',S.ph,S.ph<7.32||S.ph>7.48,S.ph<7.15||S.ph>7.6,S.ph.toFixed(3));
  set('t-paco2',S.paco2,S.paco2>48||S.paco2<32,S.paco2>68||S.paco2<22,Math.round(S.paco2));
  set('t-gcs',S.gcs,S.gcs<13,S.gcs<=8,Math.round(S.gcs));
  document.getElementById('t-rhy').querySelector('.val').textContent=rhythmName(S.rhythm);
  if(S.rhythm==='afib'||S.rhythm==='vt'||S.rhythm==='vf'||S.rhythm==='arrest')document.getElementById('t-rhy').className='numTile crit';
  else document.getElementById('t-rhy').className='numTile';
  // 事件钟
  document.getElementById('clock').textContent=fmtT(S.t);
  // 报警横幅
  const conds=collectConds();
  const crit=conds.some(c=>c.c2);const warn=conds.length>0;
  const banner=document.getElementById('alarmBanner');
  banner.textContent=S.dead?'死亡':crit?'⚠ '+conds.filter(c=>c.c2).map(c=>c.n).join(' · '):warn?conds.map(c=>c.n).join(' · '):
    (S.vent?'[通气] ':'')+(S.pace?(S.paced?'[起搏✓夺获] ':'[起搏] '):'')+(S.cpr?'[CPR] ':'')+(S.fio2>0.3?'[O₂] ':'')+'监护中';
  banner.className='alarmBanner'+(crit?' crit':warn?' warn':'');
  // 阶段4收尾: 床旁报警器游戏原声（Vital-Warning 间隙循环 / Vital-Zero / GoodCondition）
  if(typeof sfxAlarms==='function')sfxAlarms(conds);
  // 状态图标
  const strip=document.getElementById('statusStrip');strip.innerHTML='';
  const shown=new Set();
  if(!conds.length)strip.innerHTML='';   // 健康态无图标, 条随 :empty 收起(3D 拿回空间)
  conds.forEach(c=>{const ic=ICON_MAP[c.id];if(!ic||shown.has(ic))return;shown.add(ic);
    const img=document.createElement('img');img.src='patient/'+ic+'.png';img.title=c.n;strip.appendChild(img);});
  // 病理清单: 与报警横幅同源的 collectConds 实时列到屏幕右侧列(临界标红)
  const pl=document.getElementById('pathList');
  if(pl)pl.innerHTML=conds.length?conds.map(c=>'<div class="pathItem'+(c.c2?' crit':'')+'">'+c.n+'</div>').join(''):'<div class="pathNone">无活动病理 · 引擎监测 20+ 项</div>';
  // 床旁机构音
  document.getElementById('patTag').textContent='SIM-PATIENT · 成人 · '+(S.rhythm==='arrest'?'⚠ 已停搏':'监护中');
  // 急救台: 冠脉灌注线(CPP≈主动脉舒张压-右房压)
  const perf=document.getElementById('cprPerf');
  if(perf){
    if(S.cpr){
      const cpp=clamp(Math.max(0,S.map-18)*.55,0,45);
      const active=(S.rhythm==='arrest'||S.rhythm==='vf');
      perf.textContent='冠脉灌注线 CPP≈'+cpp.toFixed(1)+' mmHg · MAP '+Math.round(S.map)+(active?'（按压有效）':'（心律不适合按压）');
      const bar=document.getElementById('cprBar');if(bar)bar.style.width=clamp(cpp/25*100,0,100)+'%';
    }else{perf.textContent='冠脉灌注线 —';const bar=document.getElementById('cprBar');if(bar)bar.style.width='0%';}
  }
  // 呼吸机状态行
  const vi=document.getElementById('ventInfo');
  if(vi)vi.textContent=S.vent?(S.ventMode+' · RR'+S.ventRR+' · Vt'+S.ventVt+'ml · PEEP'+S.ventPeep+' · FiO₂'+Math.round(S.fio2*100)+'%'):'待机';
  // 血药
  const dl=document.getElementById('drugList');dl.innerHTML='';
  const items=Object.entries(S.blood).filter(([k,v])=>v>0.01).sort((a,b)=>b[1]-a[1]).slice(0,8);
  // 内源激素行: 胰岛素放最前(位于"无"行正下方), 皮质醇/肾上腺素随后
  const extras=[['胰岛素(内源)',Math.min(1,S.insulinEndo/8)],['皮质醇',S.cortisolEndo],['肾上腺素(内源)',S.epiEndo]];
  if(!items.length){const d=document.createElement('div');d.className='row none';d.style.gridColumn='1/-1';d.textContent='无';dl.appendChild(d);}
  items.forEach(([k,v])=>{const d=document.createElement('div');d.className='row';d.innerHTML=`<span>${zhOf(k)}</span><span>${(v*100).toFixed(0)}%</span>`;
    d.style.color=v>.8?'#ff8d99':v>.3?'#f6c46a':'#7ce2a0';dl.appendChild(d);});
  extras.forEach(([n,v])=>{if(v>0.03){const d=document.createElement('div');d.className='row';d.innerHTML=`<span>${n}</span><span>${(v*100).toFixed(0)}%</span>`;
    d.style.color='#8fa0f0';d.style.gridColumn='1/-1';dl.appendChild(d);}});   // 内源激素整行(避免窄格折行)
  // 阶段2: BAC 数值展示（血液酒精浓度 ‰）；食物摄入窗口
  const foodWin=document.getElementById('foodInfo');
  if(foodWin&&document.getElementById('foodZone')&&foodWin.innerHTML.indexOf('当前 BAC')>=0)foodHint();
  if(S.bac>0.03||S.alcGut>0){const d=document.createElement('div');d.className='row';
    d.innerHTML=`<span>BAC 血液酒精(‰)</span><span>${S.bac.toFixed(2)}${S.alcGut>0.01?' ↗':''}</span>`;
    d.style.color=S.bac>=1.0?'#ff8d99':S.bac>=0.5?'#f6c46a':'#e0905a';d.style.gridColumn='1/-1';dl.appendChild(d);}
  // 阶段3: LMFRS 生殖周期提示条（"月经第 2 天（量中）"式相位文案）
  const fi=document.getElementById('frsInfo');
  if(fi){if(!S.frs)fi.style.display='none';else{fi.style.display='block';fi.innerHTML=frsStageText();}}
  // 阶段3: 撤除生命维持按钮——呼吸机/CPR/起搏任一在用时显示（LIDeath.MachineWithdrawal 宣告入口）
  const bw=document.getElementById('btnWithdraw');
  if(bw)bw.style.display=((S.vent||S.pace||S.cpr)&&!S.dead)?'block':'none';
  if(typeof renderCaseHUD==='function')renderCaseHUD();   // 阶段4: 病例目标 HUD
}
function collectConds(){
  const c=[];
  const add=(id,n,c2)=>c.push({id,n,c2});
  if(S.spo2<90)add('Hypoxemia','低氧血症',S.spo2<80);
  if(S.hr>110)add('Tachy','心动过速',S.hr>160);if(S.hr<50)add('Brady','心动过缓',S.hr<35);
  if(S.k<3.2)add('Hypokalemia','低钾',S.k<2.5);if(S.k>5.6)add('Hyperkalemia','高钾',S.k>6.8);
  if(S.glucose<3)add('Hypoglycemia','低血糖',S.glucose<2);if(S.glucose>11)add('Hyperglycemia','高血糖',S.glucose>20);
  if(S.paco2>50&&S.ph<7.35)add('RespAcid','呼酸',S.ph<7.15);
  if(S.ph<7.32)add('MetAcid','代酸',S.ph<7.1);
  if(S.temp>CAL.cns.fever_thresholds[1])add('Fever','发热',S.temp>CAL.cns.fever_thresholds[2]);
  if(S.temp<CAL.cns.fever_thresholds[0])add('Hypothermia','低温',S.temp<33);
  if(S.gcs<=8)add('Coma','昏迷',true);else if(S.gcs<13)add('Stupor','意识模糊',S.gcs<10);
  if({afib:1,vt:1,vf:1}.hasOwnProperty(S.rhythm))add('rhy',rhythmName(S.rhythm),true);
  if(S.rhythm==='arrest')add('Arrest','心搏骤停',true);
  if(S.map<65)add('Hypotension','低血压',S.map<45);if(S.map>115)add('Hypertension','高血压',S.map>150);
  if(S.miT>0)add('MI','心梗',true);
  if(S.vent){ // 呼吸机报警: 通气不足/过度/氧合不佳
    if(S.paco2>50)add('VentHypo','通气不足',S.paco2>60);
    else if(S.paco2<30)add('VentHyper','通气过度',S.paco2<22);
    if(S.spo2<90)add('VentO2','机械通气氧合不佳',S.spo2<80);
  }
  if(Math.max(0,...Object.entries(S.blood).filter(([k])=>k==='Histamine').map(([,v])=>v))>0.5&&S.airwayR>1.05)add('Anaphylaxis','过敏样反应',true);
  // ---- 阶段5: 新病例机制病理键 ----
  if(S.tamponade>0.35)add('Tamponade','心包填塞(tamponade)',S.tamponade>0.6);
  if(S.svt)add('SVT','室上性心动过速',S.hr>165);
  if(S.cohb>0.2)add('COPoison','一氧化碳中毒·COHb '+Math.round(S.cohb*100)+'%(SpO₂假性正常)',S.cohb>0.4);
  if((S.mhDrive||0)>0.25)add('MalignantHyper','恶性高热(肌浆网钙释放失控)',true);
  // 阶段2: 术后状态 / 酒精中毒
  if(S.ect&&S.ect.spleen)add('PostSplenectomy','脾切除术后(免疫低下·血小板增多)',false);
  if(S.cholFatT>0)add('CholeFat','脂餐不耐受(胆囊切除术后)',false);
  if(S.bac>0.5)add('Alcohol','急性酒精中毒',S.bac>2.5);
  if((S.creat||80)>150)add('RenalInsuff',(S.ect&&(S.ect.kidneyL||S.ect.kidneyR))?'肾功能不全(肾切除术后)':'肾功能不全',(S.creat||80)>400);
  // 阶段3: 月经状态（LMFRS.UterusPhase.Menstruation 出血窗口 4-5 天）——NSAIDs 在血时提示镇痛缓解
  if(S.frs&&!(S.ect&&S.ect.uterus)&&S.frs.up==='Menstruation'&&S.frs.flow>0.05){
    const md=frsMensDay(S.frs);
    const nsaid=((S.blood['Ibuprofen']||0)+(S.blood['Naproxen']||0)+(S.blood['Aspirin']||0)+(S.blood['Acetaminophen']||0))>0.15;
    const q=({1:'量少',2:'量中',3:'量多',4:'量中',5:'量少'})[md]||'量少';
    add('Menstruation','月经第'+md+'天('+q+(nsaid?'·NSAID镇痛中':' ·痛经NSAIDs可用')+')',false);
  }
  if(typeof collectPathConds==='function')collectPathConds(add);   // 阶段6: 病原体/症状病理键
  return c;
}
function fmtT(t){const m=Math.floor(t/60),s=Math.floor(t%60);return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
var EVENTS=[];   // 全局时间线（阶段3: 死亡报告"时间线摘要"数据源; resetSim 清空=按"本局"计）
function log(msg,cls){
  const box=document.getElementById('logBox');const d=document.createElement('div');
  d.className='ev '+(cls||'');d.innerHTML=`<span style="color:#4a5f8a">${fmtT(S.t)}</span> ${msg}`;
  box.prepend(d);while(box.children.length>60)box.lastChild.remove();
  EVENTS.push({t:S.t,msg:String(msg),cls:cls||''});
  if(EVENTS.length>300)EVENTS.shift();
  if(typeof CASEC!=='undefined'&&CASEC&&CASEC.active)CASEC.ops++;   // 阶段4: 病例操作计数
}
// ============ 饮食摄入（阶段2: LIFood / LMFood 24 种 FoodType） ============
// 每份营养按合理生理值折算入 S.gut 肠腔房室（LMFood.Content → LMSmallIntestine.AbsorptionRate）：
//   碳水→Glucose(接胰岛素轴) / 钠盐→Sodium(接化验 Na) / 钾→Potassium(接化验 K) / 蛋脂→Protein/Triglyceride
//   酒精→专属 BAC 房室(零级氧化 0.15‰/h) → 血 Ethanol → 既有 GABAA/NMDA 受体机制
//   咖啡因→Caffeine(腺苷 A1 受体竞争, t½≈5h)   spd: 吸收速率（液体快/淀粉慢）
const FOODS={
  Chyle:{zh:'食糜',ic:'🥣',gut:{Glucose:0.4,Protein:0.3,Triglyceride:0.2},desc:'半消化食糜直接入肠'},
  Water:{zh:'水',ic:'💧',water:1.45,desc:'清水 500ml → 补液'},
  SmallWater:{zh:'小杯水',ic:'💧',water:0.72,desc:'清水 250ml → 少量补液'},
  Milk:{zh:'牛奶',ic:'🥛',gut:{Glucose:0.5,Potassium:0.09,Sodium:0.06,Triglyceride:0.25},fat:0.25,desc:'乳糖+蛋白+脂肪'},
  Chicken:{zh:'鸡肉',ic:'🍗',gut:{Protein:0.9,Triglyceride:0.2},fat:0.2,desc:'高蛋白低脂'},
  Apple:{zh:'苹果',ic:'🍎',gut:{Glucose:0.7,Potassium:0.06},water:0.3,desc:'果糖/葡萄糖+钾'},
  Banana:{zh:'香蕉',ic:'🍌',gut:{Glucose:0.5,Potassium:0.24},desc:'富钾水果（含盐食物的钾对侧）'},
  Rice:{zh:'米饭',ic:'🍚',gut:{Glucose:1.1},spd:{Glucose:0.07},desc:'淀粉缓释→血糖平缓上升'},
  Coke:{zh:'可乐',ic:'🥤',gut:{Glucose:2.1},spd:{Glucose:0.35},caff:0.06,desc:'高糖液体→血糖骤升'},
  Pork:{zh:'猪肉',ic:'🥓',gut:{Protein:0.7,Triglyceride:0.8,Sodium:0.10},fat:0.8,desc:'高脂蛋白+钠'},
  Beer:{zh:'啤酒',ic:'🍺',alc:0.42,gut:{Glucose:0.2},water:0.9,desc:'500ml·5%vol → 乙醇~20g'},
  Wine:{zh:'红酒',ic:'🍷',alc:0.33,water:0.3,desc:'150ml·13%vol → 乙醇~15g'},
  Vodka:{zh:'伏特加',ic:'🥃',alc:0.34,desc:'50ml·40%vol → 乙醇~16g'},
  Soup:{zh:'汤',ic:'🍲',gut:{Sodium:0.5,Potassium:0.05},water:0.9,desc:'含盐汤→钠负荷'},
  Pizza:{zh:'比萨',ic:'🍕',gut:{Glucose:0.9,Sodium:0.42,Triglyceride:0.6},fat:0.6,desc:'碳水+脂肪+高钠'},
  Drug:{zh:'不明药丸',ic:'💊',gut:{Acetaminophen:0.3},desc:'成分不明（按对乙酰氨基酚模拟）'},
  Coffee:{zh:'咖啡',ic:'☕',caff:0.55,water:0.3,desc:'咖啡因~90mg → 腺苷A1受体竞争'},
  Egg:{zh:'鸡蛋',ic:'🥚',gut:{Protein:0.6,Triglyceride:0.25},fat:0.25,desc:'优质蛋白+脂'},
  Bread:{zh:'面包',ic:'🍞',gut:{Glucose:0.9,Sodium:0.14},spd:{Glucose:0.10},desc:'淀粉+钠'},
  Salmon:{zh:'三文鱼',ic:'🐟',gut:{Protein:0.8,Triglyceride:0.5},fat:0.5,desc:'蛋白+ω-3脂肪'},
  Nut:{zh:'坚果',ic:'🥜',gut:{Triglyceride:0.6,Potassium:0.08},fat:0.6,desc:'高脂富钾'},
  Chocolate:{zh:'巧克力',ic:'🍫',gut:{Glucose:0.9,Triglyceride:0.25},caff:0.12,fat:0.35,desc:'糖+脂肪+少量咖啡因'},
  EnergyDrink:{zh:'能量饮料',ic:'⚡',gut:{Glucose:1.5},spd:{Glucose:0.35},caff:0.40,desc:'高糖+咖啡因→骤升+提神'},
  OrangeJuice:{zh:'橙汁',ic:'🍊',gut:{Glucose:0.8,Potassium:0.18},spd:{Glucose:0.30},water:0.6,desc:'富钾果汁'}
};
function zhFood(k){return FOODS[k]?(FOODS[k].ic+' '+FOODS[k].zh):k;}
function foodComp(F,p){   // 营养构成文案
  const parts=[];
  if(F.gut){for(const[c,v]of Object.entries(F.gut))parts.push(c==='Glucose'?'碳水':c==='Sodium'?'盐(钠)':c==='Potassium'?'钾':zhOf(c)+' '+Math.round(v*p*100)/100);}
  if(F.alc)parts.push('乙醇约'+Math.round(F.alc*p*47.6)+'g(BAC+'+(F.alc*p).toFixed(2)+'‰)');
  if(F.caff)parts.push('咖啡因 '+F.caff);
  if(F.fat)parts.push('脂肪 '+F.fat);
  if(F.water&&!F.gut&&!F.alc)parts.push('补液');
  return parts.join(' · ');
}
function eatFood(){
  const ft=document.getElementById('foodSel').value;
  const p=parseFloat(document.getElementById('foodPortion').value)||1;
  const F=FOODS[ft];if(!F)return;
  const stMul=(S.ect&&S.ect.stomach)?0.6:1;   // 胃切除→营养产出 ×0.6
  for(const[c,amt]of Object.entries(F.gut||{})){
    S.gut[c]=(S.gut[c]||0)+amt*p*stMul;
    S.gutSpd[c]=(F.spd&&F.spd[c])?F.spd[c]:0.15;
  }
  if(F.caff){S.gut['Caffeine']=(S.gut['Caffeine']||0)+F.caff*p*stMul;S.gutSpd['Caffeine']=0.10;}
  if(F.alc)S.alcGut=(S.alcGut||0)+F.alc*p;
  if(F.water)S.fluid=clamp(S.fluid+F.water*p*0.055,.3,1.6);
  log('🍽 摄入：<b>'+zhFood(ft)+'</b> ×'+p+'份'+(foodComp(F,p)?'（'+foodComp(F,p)+'）':'')+(stMul<1?' · <b>胃已切除: 营养产出×0.6</b>':''));
  if(typeof sfx==='function')sfx((F.water&&!(F.fat>0.3))?'Devour-liquid':'Devour-food',{gain:.5});   // 阶段4: 进食原声
  if(S.ect&&S.ect.gallbladder&&(F.fat||0)*p>=0.5){
    S.cholFatT=180;
    log('⚠ <b>胆囊已切除</b>——脂餐后腹胀/脂泻提示：胆汁无囊可存，脂质乳化不足（Cholecystokinin 无靶器官）','crit');
  }
  foodHint();
}
function foodHint(){
  const sel=document.getElementById('foodSel'),info=document.getElementById('foodInfo');
  if(!sel||!info)return;
  const F=FOODS[sel.value];if(!F)return;
  const p=parseFloat(document.getElementById('foodPortion').value)||1;
  let tips=F.ic+' <b>'+F.zh+'</b> ×'+p+'份：'+(F.desc||'')+'<br>'+foodComp(F,p||1||1);
  tips+='<br>当前 BAC '+S.bac.toFixed(2)+'‰'+((S.blood&&S.blood['Caffeine'])?(' · 咖啡因血浓度 '+(S.blood['Caffeine']*100).toFixed(0)+'%(t½≈5h)'):'');
  if(S.ect&&S.ect.stomach)tips+='<br>⚠ 胃切除术后：营养产出×0.6、吸收速率×0.35';
  if(S.ect&&S.ect.gallbladder&&F.fat)tips+='<br>⚠ 胆囊切除术后：脂肪餐将触发不耐受提示';
  tips+='<br>乙醇氧化 ~0.15‰/h(零级) · 咖啡因 t½≈5h';
  info.innerHTML=tips;
}
// ============ 采血化验面板（复刻 LIBloodwork: 名称/数值/参考范围 Range/超限 Warning） ============
const LAB_REF={ph:[7.35,7.45],po2:[80,100],pco2:[35,45],hco3:[22,26],hb:[12,16],k:[3.5,5.1],na:[135,145],ca:[2.1,2.6],glu:[3.9,7.8],ctni:[0.0,0.04]};
const LAB_NAME={ph:'pH 酸碱度',po2:'pO₂ 氧分压',pco2:'pCO₂ 二氧化碳分压',hco3:'HCO₃⁻ 碳酸氢根',hb:'Hb 血红蛋白(携氧)',k:'K⁺ 血钾',na:'Na⁺ 血钠',ca:'Ca²⁺ 离子钙',glu:'GLU 血糖',ctni:'cTnI 肌钙蛋白I'};
const LAB_UNIT={ph:'',po2:'mmHg',pco2:'mmHg',hco3:'mmol/L',hb:'g/dL',k:'mmol/L',na:'mmol/L',ca:'mmol/L',glu:'mmol/L',ctni:'ng/mL'};
const LAB_DEC={ph:3,po2:0,pco2:0,hco3:1,hb:1,k:2,na:0,ca:2,glu:1,ctni:2};
const LAB_COLOR={ok:'#0b7a45',hi:'#b3121c',lo:'#d97400'};   // 超上限红 / 低于下限橙 / 正常绿
const LAB_ARROW={ok:'',hi:' ↑',lo:' ↓'};
var LABH=[];   // 采血历史 [{t, vals}]（保留最近12次）
// PaO₂ 由 SpO₂ 按氧解离曲线反推 + FiO₂ 校正（calibration.json blood.oxycurve 思路）
function paO2Of(){
  const s=clamp(S.spo2,10,100);
  const T=[[70,36],[75,41],[80,45],[85,52],[88,56],[90,61],[92,66],[94,73],[95,77],[96,82],[97,89],[98,95],[99,104],[100,120]];
  let p=120;
  if(s<=70)p=36-(70-s)*0.45;
  else for(let i=1;i<T.length;i++)if(s<=T[i][0]){const[s0,p0]=T[i-1],[s1,p1]=T[i];p=p0+(p1-p0)*(s-s0)/(s1-s0);break;}
  const fio2=clamp(S.fio2+(dOf('o2')?dOf('o2')*.5:0),.21,1);
  if(fio2>0.22)p*=fio2/0.21*0.85;
  return clamp(p,10,600);
}
function hco3Of(){return clamp(0.03*S.paco2*Math.pow(10,S.ph-6.1),4,48);} // Henderson-Hasselbalch
function labValues(){
  return {ph:S.ph,po2:paO2Of(),pco2:S.paco2,hco3:hco3Of(),hb:(S.hb||15)*((typeof hbConcentration==='function')?hbConcentration():1),k:S.k,na:S.na,ca:S.ca||2.35,glu:S.glucose,ctni:S.ctni||0.01};   // 阶段6: hb 计入脱水浓缩/补液稀释因子
}
function labFlag(v,ref){const[lo,hi]=ref;return v<lo?'lo':v>hi?'hi':'ok';}
function labAbnCount(vals){return Object.keys(LAB_REF).filter(k=>labFlag(vals[k],LAB_REF[k])!=='ok').length;}
// ================= 影像检查: 胸部X光 / 心脏超声 / 胸部CT —— 由当前生理状态即时生成影像学报告 =================
function imagingSfx(){
 playTone(520,.12,.8);
 if(typeof sfx==='function')sfx('Bop_2',{gain:.5});
}
function lungInflamLoad(){
 // 肺部炎性负荷: 汇总趋向于呼吸道(urt/lrt)病原的载量
 let s=0,n=0;
 for(const k in S.pathogens){const P=PATH_LIB[k];const p=S.pathogens[k];if(P&&['lrt','urt'].includes(P.trop)&&p&&p.load>0){s+=p.load;n++;}}
 return {load:s,germs:n};
}
function doXray(){
 if(S.dead){log('患者已死亡，影像检查无意义');return;}
 imagingSfx();
 const f=[];
 const lung=lungInflamLoad();
 if(S.ardsT>10)f.push('双肺弥漫磨玻璃影伴外周分布（符合 ARDS 表现）');
 else if(lung.load>0.5)f.push('大片实变影，累及'+(lung.germs>1?'多叶':'单叶')+'（重症渗出）');
 else if(lung.load>0.2)f.push('双肺多发斑片状渗出影（炎性浸润）');
 else if(lung.load>0.02)f.push('双肺纹理增粗（轻度支气管周围炎）');
 if(S.contract<0.75&&S.fluid>1.05)f.push('心影扩大+双肺门蝶翼样阴影（静水压性肺水肿）');
 if(S.miT>0&&S.miLoad>0.3)f.push('心影轻度扩大（左心功能减退）');
 if(S.airwayR>1.3)f.push('双肺透亮度增高、膈肌低平（过度充气，提示阻塞性通气障碍）');
 if(!f.length)f.push('心肺膈未见明显异常');
 log('📷 <b>胸部 X 光</b>（DR 立位）：'+f.join('；')+'。');
}
function doEcho(){
 if(S.dead){log('患者已死亡，影像检查无意义');return;}
 imagingSfx();
 const ef=Math.round(clamp(68*S.contract,5,88));
 const f=[];
 if(S.tamponade>0.02)f.push('心包积液（液性暗区约 '+Math.round(S.tamponade*14)+'mm）'+(S.tamponade>0.25?'，右室舒张期塌陷——填塞征象':''));
 if(S.miT>0&&S.miLoad>0.3)f.push('前壁节段性运动减低（收缩期增厚率下降）');
 if(S.svt)f.push('二尖瓣舒张期频谱单峰（舒张充盈时间缩短）');
 if(S.contract<0.7&&!S.miT)f.push('整体室壁运动弥漫减低');
 f.push('左室收缩功能估算 EF≈'+ef+'%');
 log('🩻 <b>心脏超声</b>（床旁 POCUS）：'+f.join('；')+'。');
}
function doChestCT(){
 if(S.dead){log('患者已死亡，影像检查无意义');return;}
 imagingSfx();
 const f=[];
 const lung=lungInflamLoad();
 const pct=Math.round(clamp(lung.load*92,0,95));
 if(S.ardsT>10)f.push('双肺广泛磨玻璃影伴实变，累及约 '+Math.max(60,pct)+'% 肺野（CT 评分重度——ARDS）');
 else if(lung.load>0.02)f.push((lung.germs>1?'两肺多发病灶':'肺野单发病变')+'——磨玻璃影与实变混合，累及约 '+pct+'% 肺野');
 if(S.contract<0.75&&S.fluid>1.05)f.push('肺门血管影增宽、小叶间隔增厚（间质性肺水肿）；双侧胸腔少量积液');
 if(S.airwayR>1.3)f.push('支气管壁增厚+马赛克征（空气滞留）');
 if(S.miT>0&&S.miLoad>0.3)f.push('冠状动脉走行区高密度影（钙化灶）');
 if(S.tamponade>0.02)f.push('心包腔环形液性密度影');
 if(!f.length)f.push('双肺野清晰，纵隔窗未见增大淋巴结，心包无积液');
 log('🖥 <b>胸部 CT</b>（平扫 5mm 层厚）：'+f.join('；')+'。');
}
function drawBlood(){
  playTone(440,.12,1);
  if(typeof sfx==='function')sfx('Bop_2',{gain:.5});   // 阶段4: 采血 UI 原声
  const vals=labValues();
  LABH.push({t:S.t,vals});
  if(LABH.length>12)LABH.shift();
  const n=labAbnCount(vals);
  log('💉 采血送检（'+fmtT(S.t)+'）'+(n?'<b>出 '+n+' 项超参考范围</b>':'全部项目在参考范围内'));
  renderLab();
  document.getElementById('labBox').style.display='flex';
  return vals;
}
function closeLab(){document.getElementById('labBox').style.display='none';}
function labRowHTML(key,vals){
  const ref=LAB_REF[key],v=vals[key],f=labFlag(v,ref);
  return '<div class="labRow"><span class="labN">'+LAB_NAME[key]+'</span>'+
    '<span id="lab-'+key+'" style="color:'+LAB_COLOR[f]+';font-weight:700'+(f!=='ok'?';font-size:14px':'')+'">'+v.toFixed(LAB_DEC[key])+LAB_ARROW[f]+'</span>'+
    '<span class="labR">'+ref[0]+' ~ '+ref[1]+'</span><span class="labU">'+LAB_UNIT[key]+'</span></div>';
}
// ============ 性激素化验组（阶段3: LMFRS 生殖周期 · FSH/LH/E2/P4） ============
// 激素命名对 webdata.json HormoneType: FSH / LH / Estradiol(雌二醇 E2) / Progesterone(孕酮 P4)
const SEX_NAME={fsh:'FSH 促卵泡激素',lh:'LH 黄体生成素',e2:'E2 雌二醇',p4:'P4 孕酮'};
const SEX_UNIT={fsh:'IU/L',lh:'IU/L',e2:'pg/mL',p4:'ng/mL'};
const SEX_DEC={fsh:1,lh:1,e2:0,p4:1};
// 参考范围随相位动态判定（月经/早卵泡 → 卵泡 → 排卵 → 黄体 → 黄体溶解; 停摆后沿用卵泡期参考令异常显形）
const SEX_REF={
  early:{fsh:[3,10],lh:[2,10],e2:[25,120],p4:[0.1,1.0]},
  fol:{fsh:[3,10],lh:[2,10],e2:[50,200],p4:[0.1,1.0]},
  ov:{fsh:[3,22],lh:[15,80],e2:[120,350],p4:[0.3,4]},
  lut:{fsh:[1,8],lh:[1,10],e2:[60,250],p4:[3,20]},
  lutlate:{fsh:[2,12],lh:[2,15],e2:[25,120],p4:[0.3,8]},
  stopped:{fsh:[1,10],lh:[1,10],e2:[30,200],p4:[0.1,20]}
};
function sexValues(){const f=S.frs;if(!f)return null;return{fsh:f.fsh,lh:f.lh,e2:f.e2,p4:f.p4};}
function sexRef(k){const st=frsStage()||'fol';return SEX_REF[st][k];}
function sexSectHTML(){
  const sv=sexValues();if(!sv)return '';
  const st=frsStage()||'fol';
  const head=(st==='stopped')?'# 性激素 · LMFRS（周期停摆 · 子宫切除术后——沿用卵泡期参考, 高 FSH/LH · 低 E2/P4 显形为异常）'
    :'# 性激素 · LMFRS 生殖周期（当前相位：'+frsStageText()+' —— 参考范围随相位动态判定）';
  let h='<div class="labSect">'+head+'</div>';
  for(const k of['fsh','lh','e2','p4']){
    const ref=sexRef(k),v=sv[k],f=labFlag(v,ref);
    h+='<div class="labRow"><span class="labN">'+SEX_NAME[k]+'</span>'+
      '<span id="lab-sex-'+k+'" style="color:'+LAB_COLOR[f]+';font-weight:700'+(f!=='ok'?';font-size:14px':'')+'">'+v.toFixed(SEX_DEC[k])+LAB_ARROW[f]+'</span>'+
      '<span class="labR">'+ref[0]+' ~ '+ref[1]+'</span><span class="labU">'+SEX_UNIT[k]+'</span></div>';
  }
  return h;
}
function renderLab(){
  const card=document.getElementById('labCard');
  const vals=LABH.length?LABH[LABH.length-1].vals:labValues();
  const sect=(t,keys)=>'<div class="labSect">'+t+'</div>'+keys.map(k=>labRowHTML(k,vals)).join('');
  let html='<div class="rhead"><h4>🧪 化验报告 · LIBloodwork</h4><span class="rt">采样 '+fmtT(S.t)+' · SIM-PATIENT 成人</span><button onclick="closeLab()">✕ 关闭</button></div>';
  html+=sect('# 血气分析',['ph','po2','pco2','hco3']);
  html+=sect('# 血气 · 携氧',['hb']);
  html+=sect('# 电解质',['k','na','ca']);
  html+=sect('# 血糖',['glu']);
  html+=sect('# 心肌损伤标志物 · 峰值-衰减动力学',['ctni']);
  html+=sexSectHTML();   // 阶段3: 性激素组（相位动态参考范围）
  const n=labAbnCount(vals);
  html+=n?'<div class="labAbn">⚠ '+n+' 项超参考范围：<b>红=高于上限</b> / <b>橙=低于下限</b>（LIBloodwork GetWarning）</div>':'<div class="labAbn" style="background:#e8f5ec;border-color:#9bd4b3;color:#137a44">全部项目在参考范围内</div>';
  // 连续趋势: 最近 3 次采样（时间戳 mm:ss）
  const hist=LABH.slice(-3);
  if(hist.length>1){
    html+='<div class="labSect"># 连续趋势（最近 '+hist.length+' 次采样）</div><table class="labTb"><tr><th>项目</th>'+hist.map(h=>'<th>'+fmtT(h.t)+'</th>').join('')+'</tr>';
    for(const key of Object.keys(LAB_REF)){
      html+='<tr><td>'+key.toUpperCase()+'</td>'+hist.map(h=>{const f=labFlag(h.vals[key],LAB_REF[key]);
        return '<td style="color:'+LAB_COLOR[f]+';font-weight:700">'+h.vals[key].toFixed(LAB_DEC[key])+LAB_ARROW[f]+'</td>';}).join('')+'</tr>';
    }
    html+='</table>';
  }
  card.innerHTML=html;
}
// ============ 诊断面板（复刻 LIDiagnosis: 条件列表 Add/Remove + GoodCondition 基线） ============
// 覆盖 collectConds() 全部病理键; g 字段 = 游戏 ConditionType 对应项
const DIAG_LIB={
  Hypoxemia:{n:'低氧血症',g:'Hypoxemia/Hypoxia',m:'SpO₂<90%，肺泡通气或换气障碍，组织缺氧，脑/心最先受累。',a:'提高吸入氧浓度（吸氧/机械通气 FiO₂），解除气道痉挛与呼吸抑制因素，复查血气。'},
  Tachy:{n:'心动过速',g:'Tachycardia',m:'心率>110bpm，交感兴奋、药物（肾上腺素类）或低血容量代偿，舒张期充盈时间缩短。',a:'识别并移除诱因（停拟交感药、补液、降温）；必要时β受体阻滞剂控制心室率。'},
  Brady:{n:'心动过缓',g:'Bradycardia',m:'SA结节律<50bpm，迷走亢进或药物（β阻滞剂/强心苷）抑制起搏与传导。',a:'阿托品静推提升心率；无效或伴低血压时经皮起搏（急救台-起搏）。'},
  Hypokalemia:{n:'低钾血症',g:'Hypokalemia',m:'血钾<3.2 mmol/L，膜电位超极化，心肌/骨骼肌兴奋性下降，乏力与心律失常风险。',a:'氯化钾补钾（输注工作站），纠正镁缺乏；避免洋地黄类。'},
  Hyperkalemia:{n:'高钾血症',g:'Hyperkalemia',m:'血钾>5.6 mmol/L 使静息膜电位上移，心肌除极异常，>6.8 极易诱发室速/室颤。',a:'胰岛素+葡萄糖促钾内移、钙剂（静推 Calcium）稳定心肌膜、必要时除颤/透析。'},
  Hypoglycemia:{n:'低血糖',g:'Hypoglycemia',m:'血糖<3 mmol/L，脑能量代谢底物不足，交感兴奋后转入抑制甚至昏迷。',a:'立即静推葡萄糖（Glucose IVPush），复查血糖，警惕胰岛素过量。'},
  Hyperglycemia:{n:'高血糖',g:'Hyperglycemia',m:'血糖>11 mmol/L，胰岛素不足或应激升糖激素过多，渗透性利尿加重失水。',a:'胰岛素降糖；补液纠正失水；胰岛素促钾内移，需同步监测血钾。'},
  RespAcid:{n:'呼吸性酸中毒',g:'Acidosis/Hypercapnia',m:'通气不足 → CO₂潴留（pCO₂>50）→ pH<7.35，高碳酸血症抑制意识。',a:'增加分钟通气量（机械通气上调 RR/Vt），畅通气道，必要时气管插管。'},
  MetAcid:{n:'代谢性酸中毒',g:'Acidosis',m:'固定酸蓄积或低灌注无氧代谢，pH<7.32，HCO₃⁻ 被消耗，心肌收缩力下降。',a:'改善循环灌注（补液/升压），纠正病因，极重时补碱（HCO3）。'},
  Fever:{n:'发热',g:'Fever/Hyperthermia',m:'体温调定点上移，代谢与心率增加，高热>40℃ 蛋白变性风险。',a:'物理降温、解热药物，寻找并处理感染源；高热时复测电解质。'},
  Hypothermia:{n:'低体温',g:'Hypothermia',m:'核心温度<35.8℃，酶活性与心肌兴奋性下降，易激惹性心律失常。',a:'主动复温（保温/加温输液），复温过程持续心电监护。'},
  Coma:{n:'昏迷',g:'Coma',m:'GCS≤8，皮层/脑干功能严重受抑，气道保护反射丧失。',a:'保护气道（插管指征），查找病因（缺氧/代谢/药物），维持脑灌注。'},
  Stupor:{n:'意识模糊',g:'Delirium/Drowsiness',m:'GCS<13，轻度全脑功能抑制，多为缺氧、CO₂潴留或药物性中枢抑制。',a:'持续观察意识轨迹，纠正缺氧/低血糖/酸碱紊乱等代谢因素。'},
  'rhy:afib':{n:'心房颤动',g:'AtrialFibrillation',m:'心房除极紊乱（>350bpm 细颤），房室传导不等，附壁血栓与栓塞风险。',a:'控制心室率（β阻滞剂），同步电复律（急救台），评估抗凝。'},
  'rhy:vt':{n:'室性心动过速',g:'VentricularTachycardia',m:'心室异位起搏 160-180bpm，心输出量骤降，24h 内易恶化为室颤。',a:'胺碘酮类药物转复；血流动力学不稳时紧急同步电复律/除颤。'},
  'rhy:vf':{n:'心室颤动',g:'VentricularFibrillation',m:'心室肌无效快速颤动，循环停止，属无脉搏性心搏骤停。',a:'立即非同步除颤（360J）+ 高质量 CPR，肾上腺素 1mg，纠正诱因（高钾/缺血）。'},
  Arrest:{n:'心搏骤停',g:'CardiacArrest',m:'有效循环停止，冠脉灌注与脑灌注中断，每延后 1 分钟存活率显著下降。',a:'立即 CPR（急救台-按压），按节律除颤，肾上腺素，寻找可逆病因。'},
  Hypotension:{n:'低血压（休克）',g:'Hypotension/Hypovolemia',m:'MAP<65mmHg，器官灌注不足；失血/过敏性/心源性机制不同。',a:'补液扩容（补液500ml）+ 血管活性药（肾上腺素/去甲肾上腺素），控制出血源。'},
  Hypertension:{n:'高血压',g:'Hypertension',m:'MAP>115mmHg，后负荷过高，心做功与卒中风险增加。',a:'扩血管（CCB/ACEI 类）降压，β阻滞剂控制心率，排查拟交感药物。'},
  MI:{n:'急性心肌梗死',g:'MyocardialInfarction',m:'冠脉闭塞 → 心肌缺血坏死：收缩力下降、cTnI 峰值-衰减曲线、随时可恶化为室颤。',a:'采血查 cTnI 确认峰值轨迹，再灌注（溶栓/PCI），镇痛、备除颤，β阻滞剂慎用。'},
  VentHypo:{n:'机械通气不足',g:'Hypercapnia',m:'当前通气设置下 pCO₂>50mmHg，分钟通气量相对不足 → 呼吸性酸中毒。',a:'上调呼吸机 RR 或 Vt，复查血气确认 pCO₂ 回落。'},
  VentHyper:{n:'机械通气过度',g:'Apnea/Bradypnea',m:'机械通气下 pCO₂<30mmHg，过度通气 → 呼吸性碱中毒，脑血流下降。',a:'下调呼吸机 RR 或 Vt，允许 pCO₂ 回升到生理区间。'},
  VentO2:{n:'机械通气氧合不佳',g:'Hypoxemia',m:'机械通气中 SpO₂<90%，FiO₂ 不足以维持氧合（通气-血流失调/低灌注）。',a:'上调 FiO₂、优化 PEEP 肺泡复张，检查气道与循环灌注。'},
  Anaphylaxis:{n:'过敏样反应',g:'',m:'组胺大量入血 → 气道痉挛（airwayR↑）+ 血管扩张性低血压。',a:'肾上腺素肌注为一线，抗组胺药（Diphenhydramine）、激素，畅通气道。'},
  // ---- 阶段2: 术后/摄入新增病理键 ----
  PostSplenectomy:{n:'脾切除术后',g:'(LMOrgan.OperationEctomy·Spleen)',m:'脾滤血与免疫监视缺失：荚膜菌(肺炎链球菌等)易感风险终生升高；血小板储存池丢失致反应性血小板增多（可达 400-600×10⁹/L），静脉血栓风险上升。',a:'接种肺炎链球菌/脑膜炎球菌/流感嗜血杆菌疫苗；血小板>500×10⁹/L 时评估血栓预防。'},
  CholeFat:{n:'脂餐不耐受(胆囊切除术后)',g:'(LMOrgan.OperationEctomy·Gallbladder)',m:'胆囊储存/浓缩胆汁功能缺失，CCK 无囊可收缩；胆汁由肝持续低流量排入小肠，脂餐时乳化不足 → 腹胀、脂肪消化吸收不良、脂泻。',a:'低脂分餐；症状多在数月内随胆管代偿性扩张缓解；补充中链甘油三酯。'},
  Alcohol:{n:'急性酒精中毒',g:'',m:'乙醇增强 GABAA、拮抗 NMDA → 镇静/共济失调；BAC>0.5‰ 呼吸中枢对 CO₂ 敏感性钝化 → 通气不足、高碳酸血症；>2.5‰ 可致呼吸循环衰竭。',a:'保持气道通畅、侧卧防误吸，监测 SpO₂/PaCO₂；通气不足时机械通气支持；乙醇氧化为零级动力学(~0.15‰/h)，无解毒药。'},
  RenalInsuff:{n:'肾功能不全(肾切除术后)',g:'(LMOrgan.OperationEctomy·Kidney·GFR)',m:'肾单位分数下降：GFR 先降至对侧肾代偿水平(单肾约 50%→渐进回升至 ~70%)，肌酐按 1/GFR^1.3 上移；排钾/排水能力下降 → 高钾与容量敏感。',a:'限制钾/钠负荷与液体入量，监测肌酐与 K⁺；双肾切除为不可存活状态（透析替代）。'},
  // ---- 阶段3: LMFRS 生殖周期新增病理键 ----
  Menstruation:{n:'月经期',g:'(LMFRS.UterusPhase.Menstruation)',m:'黄体溶解 → 雌/孕激素撤退 → 前列腺素(PGF2α)介导子宫收缩与血管挛缩 → 功能层内膜脱落出血（4-5 天，量先少后多再收尾）。前列腺素过高致子宫缺血性痉挛为原发痛经机制；经期 Hb 缓慢下降伴铁流失。',a:'痛经与经量过多：NSAIDs（布洛芬 Ibuprofen / 萘普生 Naproxen——抑制 COX 减少前列腺素合成）为一线；必要时加用对乙酰氨基酚；周期第 13-14 天为 LH 峰/排卵窗（受孕期）。'},
  // ---- 阶段5: 新病例机制病理键 ----
  Tamponade:{n:'心包填塞',g:'(LMHeart.tamponade·tamponade_rate 0.3 标定)',m:'心包积液急性积聚使心包腔内压超过心腔充盈压 → 舒张期充盈受限 → 心排量骤降（Beck 三联征：低血压/心音遥远/颈静脉怒张）。升压药只能部分代偿，液体耐受限降低。',a:'心包穿刺引流是确定性治疗（急救台-心包穿刺）；穿刺减压前可用去甲肾上腺素桥接；禁盲目大量补液。'},
  SVT:{n:'室上性心动过速',g:'SupraventricularTachycardia(AVNRT)',m:'房室结折返性心动过速：折返环路驱动心室率 ~188bpm，舒张期充盈锐减 → 心排量降至 ~1/4，血压不稳；久拖可致心肌缺血。',a:'腺苷（Adenosine 静推）瞬时阻断房室结、打断折返——给药后数秒内复律；复律失败可重复或改同步电复律；备好除颤。'},
  COPoison:{n:'一氧化碳中毒',g:'Carboxyhemoglobinemia(LMChemical 无 CO 项·COHb 通道承载)',m:'CO 与血红蛋白亲和力约为 O₂ 的 240 倍：COHb 携氧能力丧失而脉搏血氧仪读数"假性正常"（仅识别氧合/还原 Hb）；组织缺氧表现为意识障碍与代谢性酸中毒，皮肤黏膜樱桃红为紫绀判断的例外。',a:'立即脱离暴露环境并高流量氧疗（FiO₂ ≥80%）：半衰期由室内空气 ~4-5h 缩至 <1h（仿真压缩）；重度/持续神经症状考虑高压氧；意识与 COHb 双目标监测。'},
  MalignantHyper:{n:'恶性高热',g:'MalignantHyperthermia(琥珀胆碱触发·钙释放失控)',m:'易感者肌浆网 Ryanodine 受体异常：麻醉触发后钙释放失控 → 骨骼肌持续强直收缩的高代谢危象——体温以每分钟 ~0.5℃ 攀升、CO₂ 生成激增（呼末 CO₂ 骤升为首发征兆）、横纹肌溶解 → 高钾 + 代谢性酸中毒。',a:'立即停用触发药物（代谢清除），丹曲林为特效药（本引擎以"停诱因+积极降温"路径教学）；物理降温 + 解热药、纠酸、处理高钾；持续监护心律。'}
};
function diagItems(){
  const conds=collectConds();const items=[];
  for(const c of conds){
    const key=c.id==='rhy'?('rhy:'+S.rhythm):c.id;
    const d=DIAG_LIB[key];if(!d)continue;
    items.push({key,name:d.n,g:d.g,mech:d.m,act:d.a,crit:!!c.c2});
  }
  return items;
}
function showDiagnosis(){
  renderDiag();
  document.getElementById('diagBox').style.display='flex';
  playTone(660,.1,1);
}
function closeDiag(){document.getElementById('diagBox').style.display='none';}
function renderDiag(){
  const card=document.getElementById('diagCard');
  const items=diagItems();
  let html='<div class="rhead"><h4>🩺 诊断 · 病理判定</h4><span class="rt">'+fmtT(S.t)+' · 监测 '+Object.keys(DIAG_LIB).length+' 项</span><button onclick="closeDiag()">✕ 关闭</button></div>';
  if(!items.length){
    html+='<div class="diagNone">目前未见异常 —— LIDiagnosis GoodCondition'+LAB_ARROW.ok+'<div class="sub">HR '+Math.round(S.hr)+' bpm · MAP '+Math.round(S.map)+' mmHg · SpO₂ '+Math.round(S.spo2)+'% · GCS '+S.gcs+'；引擎未检出活动性病理状态。</div></div>';
  }else{
    items.forEach(d=>{html+='<div class="diagItem'+(d.crit?' crit':'')+'"><div class="dname">【'+d.name+'】'+(d.crit?'<span class="dcrit">危急</span>':'')+'</div><div class="dmech">机制：'+d.mech+'</div><div class="dact">处理：'+d.act+'</div></div>';});
    html+='<div class="diagNone" style="color:#8395a8;font-size:11px">共 '+items.length+' 项活动性病理判定 —— 危急项优先处理；采样化疗可证实（cTnI/电解质/血气）。</div>';
  }
  card.innerHTML=html;
}
// ============ 百科 + 器官手术（阶段2: LMOrgan.OperationEctomy） ============
// 可切除器官按游戏术式文案（string_literals: 肾脏/胃/胆囊/胰脏/肺/肝脏/甲状腺/脾脏切除术; 模型另有 testis/prostate 节点）
const ECT_LIB={
  spleen:{op:'脾脏切除术',desc:'脾滤血/免疫储存器官。术后: 荚膜菌免疫低下 + 反应性血小板增多(血栓风险)。'},
  kidneyL:{op:'肾脏切除术',desc:'左肾切除。术后: 肾单位分数降至 ~50%，对侧肾代偿性肥大 → GFR 渐进回升至 ~70%；肌酐上移。'},
  kidneyR:{op:'肾脏切除术',desc:'右肾切除。术后: 同左肾——GFR 50%→~70% 代偿曲线；排钾/排水能力下降，容量负荷更敏感。'},
  gallbladder:{op:'胆囊切除术',desc:'胆囊储存/浓缩胆汁功能缺失 → 胆汁持续低流量入肠 → 脂肪餐后腹胀/脂泻(可代偿)。'},
  stomach:{op:'胃切除术',desc:'胃研磨/储存功能缺失 → 口服(药物与食物)吸收速率 ×0.35、营养产出 ×0.6。'},
  pancreas:{op:'胰脏切除术',desc:'内外分泌俱失: β细胞功能 ×0.10 → 胰源性糖尿病；消化酶缺乏。'},
  liver:{op:'肝脏切除术',desc:'糖异生/糖原分解缺失 → 顽固低血糖倾向(不可代偿)。'},
  lungL:{op:'肺切除术',desc:'左肺切除 → 有效通气 ×0.55 → 低氧/高碳酸倾向，需氧疗或机械通气。'},
  lungR:{op:'肺切除术',desc:'右肺切除 → 有效通气 ×0.55 → 低氧/高碳酸倾向，需氧疗或机械通气。'},
  thyroid:{op:'甲状腺切除术',desc:'T3/T4 缺失 → 窦率 -7bpm、基础代谢与体温下降(甲减样状态)。'},
  testis:{op:'睾丸切除术',desc:'LMMRS TesteroneGland 失效 → 睾酮轴衰竭；垂体负反馈消失 → FSH/LH 上升。'},
  prostate:{op:'前列腺切除术',desc:'前列腺切除(TURP 语义) → 下尿路梗阻解除，排尿通畅。'},
  uterus:{op:'子宫切除术',desc:'LMFRS（女性生殖系统）整体移除：生殖周期即刻停摆——E2/P4 失去周期驱动而低平，FSH/LH 失去性腺负反馈抑制而升高（绝经样内分泌状态）；月经终止，生育力不可逆丧失。'}
};
function organIdByZh(zh){const o=(ORGANS||[]).find(o=>o.zh===zh);return o?o.id:null;}
function ectStatus(id){   // 术后状态实时读数（弹窗内展示）
  switch(id){
    case'spleen':return '血小板 '+Math.round(S.plt)+'×10⁹/L（正常 250，反应性增多中→随访 460）· 荚膜菌疫苗 + 血栓风险随访';
    case'kidneyL':case'kidneyR':return '肾单位分数 '+Math.round(S.kidFrac*100)+'%（对侧代偿 '+Math.round(S.kidComp*100)+'%，渐进回升至 ~72%）· 肌酐 '+Math.round(S.creat)+' μmol/L · 排钾/排水能力↓';
    case'gallbladder':return '胆汁由肝持续低流量排入小肠 · 脂餐(猪/比萨/三文鱼等)后腹胀/脂泻提示 · 胆管可逐步代偿';
    case'stomach':return '口服吸收速率 ×0.35（药物与食物）· 营养产出 ×0.6 · 需少量多餐+肌注替代给药';
    case'pancreas':return '内源胰岛素分泌 ×0.10（血糖 '+S.glucose.toFixed(1)+' mmol/L，胰源性糖尿病）· 需外源胰岛素+胰酶替代';
    case'liver':return '血糖 '+S.glucose.toFixed(1)+' mmol/L（糖异生缺失→低血糖倾向，需持续糖供给）';
    case'lungL':case'lungR':return '有效通气 ×0.55 → SpO₂ '+Math.round(S.spo2)+'% · 建议吸氧/机械通气支持';
    case'thyroid':return '心率 '+Math.round(S.hr)+'bpm · 体温 '+S.temp.toFixed(1)+'°C（甲减样：代谢率下降）· 需左甲状腺素替代';
    case'testis':return '睾酮轴指数 '+S.testo.toFixed(2)+'（→0.08）· 垂体负反馈消失: FSH/LH 上升 · 骨密度/肌量/生精不可逆受累';
    case'prostate':return '下尿路梗阻已解除 · 排尿通畅（术后一过性尿路刺激症状常见）';
    case'uterus':if(S.frs)return '周期停摆：FSH '+S.frs.fsh.toFixed(1)+' / LH '+S.frs.lh.toFixed(1)+' IU/L（失抑制升高）· E2 '+S.frs.e2.toFixed(0)+' pg/mL / P4 '+S.frs.p4.toFixed(1)+' ng/mL（低平）——LMFRS 移除·绝经样状态';return '';
  }
  return '';
}
function showEnc(name){
  const q=name.replace(/[左右]/g,'');
  let t=ENCYC[q];
  if(!t){const k=Object.keys(ENCYC).find(k=>k.includes(q)||q.includes(k));if(k)t=ENCYC[k];}
  const id=organIdByZh(name);
  if(id&&ECT_LIB[id]){openOrganModal(id,name,t||('暂无「'+name+'」词条'));return;}
  openModal(name,t||('暂无「'+name+'」词条'));
}
function openOrganModal(id,name,text){
  document.getElementById('modal').style.display='flex';
  document.getElementById('modalTitle').textContent=name+((S.ect&&S.ect[id])?'（已切除·不可逆）':' · 器官面板');
  document.getElementById('encSearch').style.display='none';
  let html='<div style="font-size:13px;line-height:1.7;color:#1c2b3a">'+(text||'')+'</div>';
  if(S.ect&&S.ect[id]){
    html+='<div class="ectDone">✂ 已行<b>'+ECT_LIB[id].op+'</b>（LMOrganBase.OrganEctomy · 不可逆）<br>'+ectStatus(id)+'</div>';
  }else{
    html+='<div class="ectInfo">🔧 术式：<b>'+ECT_LIB[id].op+'</b> · '+ECT_LIB[id].desc+'</div>';
    html+='<button class="ectBtn" onclick="ectAsk(\''+id+'\')">🔪 行'+ECT_LIB[id].op+'（不可逆）</button>';
  }
  document.getElementById('modalBody').innerHTML=html;
}
function ectAsk(id){
  showConfirm('确认行 <b>'+ECT_LIB[id].op+'</b>？<br>术后改变<b style="color:#b3121c">不可逆</b>（器官切除语义——无法移植回植）。',()=>doEctomy(id));
}
function doEctomy(id){
  if(!id||!ECT_LIB[id]||(S.ect&&S.ect[id]))return;
  S.ect[id]=true;
  const e=ECT_LIB[id];
  let extra='';
  if(id==='spleen')extra='血小板储存池丢失 → 反应性血小板增多(→~460×10⁹/L)；肺炎链球菌等荚膜菌感染风险终生升高（术后需疫苗接种）';
  else if((id==='kidneyL'&&S.ect.kidneyR)||(id==='kidneyR'&&S.ect.kidneyL))extra='⚠ 双侧肾切除：无尿·尿毒症不可逆进展（肌酐/血钾将持续攀升）';
  else if(id==='kidneyL'||id==='kidneyR')extra='GFR 即刻降至 ~50%，对侧肾代偿性肥大启动（渐进回升至 ~70%）；肌酐开始上移，容量/钾负荷更敏感';
  else if(id==='gallbladder')extra='胆汁改由肝持续低流量排入小肠——脂餐后将出现腹胀/脂泻提示';
  else if(id==='stomach')extra='口服(药物+食物)吸收速率 ×0.35，营养产出 ×0.6';
  else if(id==='pancreas')extra='β细胞 ×0.10 → 胰源性糖尿病；外分泌酶缺乏';
  else if(id==='liver')extra='糖异生缺失 → 低血糖倾向，需持续葡萄糖供给';
  else if(id==='lungL'||id==='lungR')extra='有效通气 ×0.55，即刻出现低氧倾向';
  else if(id==='thyroid')extra='甲状腺激素缺失 → 心率/代谢/体温下降（甲减样状态）';
  else if(id==='testis')extra='睾酮轴衰竭：垂体负反馈消失 → FSH/LH 上升，第二性征/生精不可逆受累';
  else if(id==='uterus')extra='生殖周期即刻停摆：FSH/LH 失抑制升高、E2/P4 低平（LMFRS 移除·绝经样内分泌状态），经期出血终止';
  else if(id==='prostate')extra='下尿路梗阻解除，排尿通畅';
  log('🔪 行<b>'+e.op+'</b>（不可逆）'+(extra?'：'+extra:''),'crit');
  if(typeof sfx==='function')sfx('Ectomy',{gain:.55});   // 阶段4: 器官切除原声
  BW.sel=null;                                        // 已切除器官不再保持选中
  if(typeof renderOrganStrip==='function')renderOrganStrip();
  openOrganModal(id,document.getElementById('modalTitle').textContent.split(' · ')[0],null);
}
function openEncyclopedia(){openModal('医学百科（'+Object.keys(ENCYC).length+' 条）','');renderEncList();}
function openChemPicker(){
 openModal('药典 · 全部药物','');document.getElementById('encSearch').style.display='none';
 const body=document.getElementById('modalBody');body.style.whiteSpace='normal';
 body.innerHTML='<input id="chemQ" type="text" placeholder="搜索 中文名 / 英文名…" style="width:100%;box-sizing:border-box;padding:7px 10px;border-radius:9px;border:none;background:var(--surface);box-shadow:var(--shadow-inset);font-size:12.5px;margin-bottom:6px" oninput="renderChemPicker()"><div id="chemListBody"></div>';
 renderChemPicker();
}
// 分类色板:八组循环(浅底色/分类标题色)
const CHEM_PAL=[['#eef5fb','#2a6db5'],['#ecf7ef','#2e8b57'],['#fdf3e7','#b3121c'],['#f4eefb','#7a4fc9'],
  ['#eefafA','#128090'],['#fbf0f4','#b03a6e'],['#f5f1ea','#8a6d3b'],['#eff1f4','#5b6b7d']];
function encOfChem(c){
 const zh=zhOf(c);
 for(const k of [c,zh]){if(ENCYC[k])return {k,t:ENCYC[k]};}
 const hit=Object.keys(ENCYC).find(k=>k.includes(zh)||zh.includes(k));
 return hit?{k:hit,t:ENCYC[hit]}:null;
}
function renderChemPicker(){
 const list=document.getElementById('chemListBody');if(!list)return;
 const q=(document.getElementById('chemQ')||{value:''}).value.trim().toLowerCase();
 const cur=document.getElementById('chemSel').value;
 const used=new Set();
 const chip=(c,pi)=>{
   const enc=encOfChem(c);
   const pal=CHEM_PAL[pi%CHEM_PAL.length];
   let st='text-align:left;padding:7px 10px;border-radius:9px;border:none;background:'+pal[0]+';font-size:11.5px;cursor:pointer;color:'+pal[1]+'';
   if(c===cur)st+=';box-shadow:var(--shadow-inset);outline:2px solid '+pal[1]+'55;font-weight:650';
   else st+=';box-shadow:var(--shadow-small)';
   const tip=enc?(enc.k+'·'+enc.t).slice(0,240):'「'+zhOf(c)+'（'+c+'）」暂无百科词条';
   return '<button type="button" data-enc="'+tip+'" style="'+st+'" onclick="pickChem(\''+c+'\')"><b>'+zhOf(c)+'</b> <span style="opacity:.6;font-size:10px">'+c+'</span></button>';
 };
 let html='',pi=0;
 Object.entries(CATS).forEach(([cat,arr])=>{
   const items=arr.filter(c=>(CHEMS.includes(c)||HORMONES.includes(c))&&!used.has(c)&&(!q||c.toLowerCase().includes(q)||zhOf(c).includes(q)||zhOf(c).toLowerCase().includes(q)));
   if(!items.length)return;
   items.forEach(c=>used.add(c));
   const pal=CHEM_PAL[pi%CHEM_PAL.length];
   html+='<div style="font-size:10.5px;letter-spacing:1.5px;color:'+pal[1]+';margin:14px 0 6px;padding-left:2px">'+cat+'<span style="color:var(--faint);letter-spacing:0">('+items.length+')</span></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:8px">'+items.map(c=>chip(c,pi)).join('')+'</div>';
   pi++;
 });
 const rest=CHEMS.filter(c=>c!=='Null'&&!used.has(c)&&(!q||c.toLowerCase().includes(q)||zhOf(c).includes(q)));
 if(rest.length){html+='<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--faint);margin:14px 0 6px">其他（全量）('+rest.length+')</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(152px,1fr));gap:8px">'+rest.map(c=>chip(c,pi)).join('')+'</div>';}
 list.innerHTML=html||'<div style="color:var(--faint);padding:8px 0">无匹配药物</div>';
}
// 悬浮百科卡: 事件委托, chip data-enc 展示于光标附近
document.addEventListener('mouseover',e=>{
 const b=e.target.closest&&e.target.closest('#modalBody button[data-enc]');
 const tip=document.getElementById('tipCard');
 if(!tip)return;
 if(!b){tip.style.display='none';return;}
 tip.textContent='';
 const i=b.getAttribute('data-enc').indexOf('·');
 const k=b.getAttribute('data-enc').slice(0,i),t2=b.getAttribute('data-enc').slice(i+1);
 tip.innerHTML='<b style="color:#0e7490">'+k+'</b><br>'+t2;
 tip.style.display='block';
 const r=b.getBoundingClientRect();
 tip.style.left=Math.min(window.innerWidth-352,r.right+8)+'px';
 tip.style.top=Math.max(8,r.top)+ 'px';
});
document.addEventListener('mouseout',e=>{const tip=document.getElementById('tipCard');if(tip&&!e.relatedTarget||e.relatedTarget&&!(e.relatedTarget.closest&&e.relatedTarget.closest('#modalBody button[data-enc]')))tip.style.display='none';});
function pickChem(c){
 const sel=document.getElementById('chemSel');
 const o=[...sel.options].find(o=>o.value===c);
 if(o)sel.value=c;
 closeModal();
 log('🧪 药典选择：<b>'+zhOf(c)+'</b>（'+c+'）');
}
function showEngineDoc(){
const H='<div style="font-size:12.5px;line-height:1.8;color:#33404f;max-height:62vh;overflow-y:auto;padding-right:6px">'
+'<h4 style="margin:2px 0 4px;color:#0e7490;font-size:13.5px">① 引擎概览</h4>'
+'<p style="margin:4px 0">虚拟患者引擎是一个<b>纯函数、单文件</b>的人体生理拟真器。数据层为两张构建期内联表：<b>GAMEDATA</b>（442 个枚举词条、147 个中文译名、304 条百科）与 <b>CAL</b>——按临床生理学基线校准的数值常量库（引擎以字段名引用，重新校准只换表不动逻辑）。<b>层间解耦</b>：数据 / 模型 / 表现三层互不依赖。</p>'
+'<p style="margin:4px 0">模拟时钟：<code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">生理 tick 250ms · 波形 50ms · UI 300ms · 3D 60ms</code>。所有子系统用一阶指数逼近 <code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">x += (target−x)·dt·k</code>，保证大步长不发散——2000 步连续长跑实测无 NaN。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">② 生理模型</h4>'
+'<p style="margin:4px 0"><b>起搏与心率</b>——SA 结固有 60 bpm，肾上腺素经 β1 占据最高 ×3（180 bpm），叠加紧张性 +12、交感·20 / 迷走·30、胆碱能 M2 与阿托品（去抑制 +45）、烟碱 +12、甲状腺激素变时 +30；<code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">MAP = CO·SVR·18·fluid</code>，<code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">CO = hr·contract·0.071</code>（EF 0.68、每搏 0.35 房缩分量）。</p>'
+'<p style="margin:4px 0"><b>压力反射</b>——感受器应变 ±2.1、斜率 ×7：低血压→交感兴奋、高血压→迷走兴奋，时间常数 ≈2.5s。<b>血管树</b>按受体占据折算阻力：α1 −20 / β2 +35 / EP2 +35 / 血管紧张素 −20 / 加压素 −20 / ANP +15 / H1 +10 / 糖皮质 +20 / 胰高血糖素 +400，系数 ×0.028 反号进入 SVR；高剂量肾上腺素时 α1 主导缩管（升压以肌力与心排间接放大）。</p>'
+'<p style="margin:4px 0"><b>受体药理</b>——占据模型 <code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">occ = c·pot/(1+c·pot)</code>（结合速率 0.01、解离池 60、部分激动剂效能 0.5）；拮抗剂与激动剂按占据相减实现<b>竞争逆转</b>；单胺类以转运体占据语义再摄取（DAT/NET/SERT=10）。</p>'
+'<p style="margin:4px 0"><b>呼吸</b>——气道阻力：β2/EP2 舒张、H1 组胺痉挛（CYSLTR1 −0.95 最强收缩）；通气驱动 <code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">rrT = 14 + ΔPaCO2·0.35 + SpO2 拐点(92) 驱动·0.5</code>；μ 阿片 −0.8 呼吸抑制（核心校准值），GABA 增敏、肌松 ≤2、机械通气直接覆盖 RR；<b>etCO₂ = PaCO₂·0.7</b>。</p>'
+'<p style="margin:4px 0"><b>肾脏与内环境</b>——GFR 基线 60 ml/min × 滤过系数 1.45；K⁺ 慢动态（小时级，肾排钾生理）；<b>pH</b> = 7.42 − 呼吸酸(0.008/mmHg) − 代酸 + HCO₃ 缓冲。</p>'
+'<p style="margin:4px 0"><b>代谢内分泌</b>——mg/dL 尺度（血糖 100 = 5.5 mmol/L，×18 换算）：胰岛 β 细胞增益 −0.006×1000 → 胰岛素 <code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">clamp((血糖mg −100)·0.036, 1.2, 30)</code>；α 细胞 +0.004 胰升糖素；肝糖原 1e−05；<b>体温</b>设定点 37°C（阈值 35/38/40），≈50 s/°C。</p>'
+'<p style="margin:4px 0"><b>中枢神经</b>——<code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">cnsDep = 1.5·GABAA + 0.8·μ + 0.55·ΣcnsD + 0.4·α2 + 0.4·CB1</code> 折入 GCS（缺氧/高 CO₂/低灌注/高糖另有扣分）；血脑屏障通透 0.08 已在药表折减。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">③ 心律状态机与死亡判定</h4>'
+'<table style="width:100%;border-collapse:collapse;font-size:11.5px"><tr style="color:#5b6b7d;text-align:left"><th style="padding:2px 6px 4px">转移</th><th style="padding:2px 6px 4px">触发</th></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">窦律 ⇄ 房颤</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">心率风暴 (>150) 概率 0.004/s</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">→ 室速</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">K&gt;6.8 渐进、K&gt;7.4 直接室颤、hr&gt;195、心梗源 0.012/s</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">室速 → 室颤 → 停搏</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">0.02/s、0.003/s；心率&lt;20 未起搏立即停搏</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">除颤</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">室颤/室速成功率 0.83（急救台 120–360J）</td></tr></table>'
+'<p style="margin:4px 0">死亡为<b>多通道窗口判定</b>：停搏未复苏 240s（按压中 600s）｜ MAP&lt;15 ×180s ｜ SpO₂&lt;35 ×120s ｜ 血糖&lt;1.0 ×90s ｜ pH&lt;6.75 ×150s ｜ T&gt;43 ×240s。宣告后弹死亡报告：<b>直接死因</b>（死前 80s 病理窗主导推断）＋<b>基础病变</b>＋<b>存活时长</b>＋<b>时间线摘要</b>；「↺ 复苏重置」恢复，呼吸机/CPR/起搏在用时可「撤除生命维持 · 宣告临床死亡」（需确认）。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">④ LMFRS 生殖周期</h4>'
+'<p style="margin:4px 0">28 天五相位闭环：<b>月经(1–5)→卵泡(6–12)→排卵(13–14)→黄体(15–26)→黄体溶解(27–28)</b>。HPO 轴四激素（FSH/LH/E2/P4）按相位目标一阶趋近：卵泡期 FSH↑ 卵泡发育、E2 渐升；<b>E2≥170 pg/mL 正反馈触发 LH 峰（≈55 IU/L）</b>；黄体期 P4↑ 分泌期。化验「性激素」组的参考范围<b>随相位动态判定</b>（同一 LH 值在排卵期正常、卵泡期偏高）。周期第 1–5 天出血窗口（经量曲线 0.25→1→收尾），Hb/血容量生理流失并入内环境，痛经提示 NSAIDs（布洛芬/萘普生 COX 抑制）；子宫切除后周期<b>停摆</b>——日历冻结、FSH/LH 失负反馈抑制（化验标红）、E2/P4 低平、3D 子宫节点灰阶。时间标度：1 周期天 = 60 模拟秒，28 分钟完整玩一轮。相位实时显示在监护屏侧列。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">⑤ 监护表现层</h4>'
+'<table style="width:100%;border-collapse:collapse;font-size:11.5px"><tr style="color:#5b6b7d;text-align:left"><th style="padding:2px 6px 4px">通道</th><th style="padding:2px 6px 4px">合成模型</th></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">ECG Ⅱ（绿）</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">高斯波元 P/Q/R/S/T 叠加，传导时序=除极间隔组；T 波形态随血钾（高钾尖峰、低钾低平）</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">PLETH（青）</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">双高斯+重搏切迹，波幅 ∝ MAP/95（心肺偶联）</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">etCO₂（黄）</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">四段方波：快速上升→平台→吸气下降，平台 ∝ PaCO₂</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">扫掠</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">逐列清除 14px 前瞻带（真实监护仪「写头」效果），导联丢失显示平线</td></tr>'
+'<tr><td style="border-top:1px solid #e3ebf2;padding:3px 6px">心搏音</td><td style="border-top:1px solid #e3ebf2;padding:3px 6px">QRS 同步 880+4·SpO₂ Hz 短音（血氧越低音调越低——真实监护仪行为）</td></tr></table>'
+'<p style="margin:4px 0"><b>报警双阈（warn / crit）</b>：HR &lt;50/&gt;110（&lt;35/&gt;160）｜ SpO₂ &lt;93/&lt;85 ｜ RR &lt;8/&gt;26 ｜ MAP &lt;68/&gt;110（&lt;50/&gt;140）｜ 体温 &gt;37.8/&gt;40、&lt;35.8/&lt;33 ｜ K &lt;3.3/&gt;5.6（&gt;6.8 临界）｜ pH &lt;7.32/7.15 ｜ GCS &lt;13/≤8 ｜ 血糖 &lt;3.5/&gt;11（&lt;2.2/&gt;25）。横幅与数字块同步闪烁；状态图标条使用内置 80×80 素材（窒息/发热/出血/过敏/炎症/感染/昏迷…）。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">⑥ 3D 全身器官预览</h4>'
+'<p style="margin:4px 0">23 个解剖器官组（脑 6 区、心脏四腔、消化链、生殖系、动静脉树等 46 个网格部件，全量三角网格）经 three.js + Draco 渲染（GLB 仅 0.46 MB），PBR 材质 = 器官图集 × 器官区隔色，RoomEnvironment 环境光 + ACES 色调映射。<b>生理联动</b>：心脏收缩缩放 <code style="background:#e7eef4;padding:0 4px;border-radius:5px;font-size:11.5px">1+0.10·e^(−8φ)·contract</code>（与波形/心搏音同相位）；双肺呼吸缩放 ±0.035·sin（机械通气同源 RR）；<b>昏迷时脑模型变暗</b>（0.35+0.75·GCS/15）；肾低灌注（MAP&lt;65）去饱和；病理粒子特效沿 8 个器官锚点喷射。「⇔ 分离」按质心方向 1.45× 外扩；<b>点击器官弹出该器官的百科词条</b>（医学百科 304 条）。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">⑦ 病例与教学系统</h4>'
+'<p style="margin:4px 0">内置 <b>22 个预设病例</b>（急性心梗、过敏性休克、糖尿病酮症、高钾血症以及 LMFRS 周期与妇科病例等），「📋 病例」选择、进度存 localStorage。治疗区覆盖 160+ 药物词条（途径吸收系数 输注50/静推40/肌注10/口服1/贴敷0.002）、24 种饮食摄入（经口入肠腔房室吸收）、采血化验面板（含随生理状态动态判定的参考范围）。所有干预写入<b>事件记录</b>时间线，死亡报告直接引用。</p>'
+'<h4 style="margin:12px 0 4px;color:#0e7490;font-size:13.5px">⑧ 常数与验证</h4>'
+'<p style="margin:4px 0">CAL 全部常量按<b>生理学基线校准</b>（置信度分高/中两级，模型差异处按生理学方向校验）。验证矩阵：Node harness 全基线（静息 72/92；肾上腺素 SA×3+压力反射；μ 抑制 RR 14→11；纳洛酮竞争逆转；高钾 8.0→室颤→除颤复律；β 细胞分泌与外源胰岛素降糖；1000s 稳定长跑），加上服务端 77 项回归与浏览器端到端挂接测试（病理判定、死亡报告、周期相位、监护像素）。本页面向<b>医学教育与急救模拟</b>用途：死亡是终点，但随时可以复苏重来。</p>';
 openModal('虚拟患者引擎 · 说明文档','');
 document.getElementById('modalBody').innerHTML=H;
}
function renderEncList(){
  const q=document.getElementById('encSearch').value.trim();
  const body=document.getElementById('modalBody');
  const keys=Object.keys(ENCYC).filter(k=>!q||k.includes(q)||ENCYC[k].includes(q)).slice(0,400);
  if(!q||titleNotEncList()){if(!q){body.innerHTML='输入关键词搜索，或直接浏览：';keys.slice(0,12).forEach(k=>{const d=document.createElement('div');d.style.cssText='padding:6px 0;border-bottom:1px dashed #dfe7ee;cursor:pointer';d.innerHTML='<b style="color:#0e7490">'+k+'</b>：'+(ENCYC[k]||'').slice(0,100)+'…';d.onclick=()=>openModal(k,ENCYC[k]);body.appendChild(d);});}return;}
  body.innerHTML='';
  keys.forEach(k=>{const d=document.createElement('div');d.style.cssText='padding:6px 0;border-bottom:1px dashed #dfe7ee;cursor:pointer';
    d.innerHTML='<b style="color:#0e7490">'+k+'</b>：'+ENCYC[k].slice(0,120)+'…';d.onclick=()=>openModal(k,ENCYC[k]);body.appendChild(d);});
}
function titleNotEncList(){const t=document.getElementById('modalTitle').textContent;return !t.startsWith('医学百科');}
function openModal(title,content){document.getElementById('modal').style.display='flex';document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').textContent=content!=''&&content!==undefined?content:title;
  document.getElementById('encSearch').style.display=title.startsWith('医学百科')?'block':'none';
  if(title.startsWith('医学百科')){document.getElementById('modalBody').textContent='';renderEncList();}}
function closeModal(){document.getElementById('modal').style.display='none';}
// ============ 阶段5: 危机体征 → 3D 表现层（VFX 数值层, 供 three.js 模块消费） ============
// 设计: 表现参数/颜色全部在经典脚本以纯函数计算(可在 Node 断言), ES module 只做"参数→材质/节点"映射。
// 采样口: window.__ORG(per-organ 材质/节点) + window.VFX(参数) + #shockFlash(div opacity) —— 不依赖截图。
// 优先级(乘法叠加, 后算者胜): ①器官自身病理 tint(脑GCS变暗/肾缺血) ②心梗/气道特例 ③紫绀/苍白(全器官)
//   ④死亡灰阶(终段覆盖, 1s 渐入)。同一材质多效果以乘法组合, 不互相冲刷。
var VFX={deadRamp:0,paceFlashT:99,paceFlashCount:0,lastBN:0,lastBeat:0,jitAmp:0,jitHz:7.5,shockT:-1e9};
function vfxReset(){VFX.deadRamp=0;VFX.paceFlashT=99;VFX.paceFlashCount=0;VFX.lastBN=0;VFX.lastBeat=0;VFX.jitAmp=0;VFX.jitHz=7.5;VFX.shockT=-1e9;}
// 由引擎 tick() 每步驱动: 死亡灰阶渐入 / 起搏夺获闪烁计数 / 室颤抖动参数 / CPR 按压相位
function vfxStep(dt){
  VFX.deadRamp=clamp(VFX.deadRamp+(S.dead?1:-2)*dt,0,1);   // 死亡后 1s 线性渐满(灰阶渐变), 复苏后 0.5s 淡出
  if(S.paced&&S.hr>0&&S.hr<=140&&S.beatPhase<VFX.lastBeat){VFX.paceFlashT=0;VFX.paceFlashCount++;}   // beatPhase 回绕=一个起搏夺获心搏 → 短促闪
  VFX.lastBeat=S.beatPhase;
  VFX.paceFlashT+=dt;
  if(S.rhythm==='vf'){VFX.jitAmp=0.016+Math.random()*0.03;VFX.jitHz=6+Math.random()*3;}   // 室颤: 6-9Hz 无规律振幅
  else if(VFX.paceFlashT>0.1)VFX.jitAmp=0;
}
// 表现参数快照(渲染循环每帧取用; 亦可 Node 直接断言数值)
function vfxState(){
  const cy=(S.spo2<90)?clamp((90-S.spo2)/15,0,1):0;                       // 紫绀强度: (90-SpO₂)/15 截断[0,1]
  const pal=(S.hb<9)?clamp((9-(S.hb||15))/6,0,1):0;                       // 苍白(贫血/失血)
  const fev=(S.temp>38.5)?clamp((S.temp-38.5)/2.5,0,1):0;                 // 发热暖红
  const ch=(S.cohb>0.18)?clamp((S.cohb-0.15)/0.5,0,1):0;                  // COHb 樱桃红(紫绀例外: SpO₂ 假性正常)
  const mi=(S.miT>0)?clamp(S.miT,0,1):0;                                  // 心梗/心肌缺氧
  const ana=((S.blood['Histamine']||0)>0.5&&S.airwayR>1.05)?1:0;          // 过敏样反应(气道肿胀)
  const se=S.t-VFX.shockT;
  return {cyan:cy,pale:pal,fever:fev,cherry:ch,mi:mi,anaphy:ana,
    vf:(S.rhythm==='vf')?1:0,arrest:(S.rhythm==='arrest')?1:0,dead:VFX.deadRamp,
    paced:S.paced?1:0,paceFlash:Math.max(0,1-VFX.paceFlashT/0.22),paceFlashCount:VFX.paceFlashCount,
    jitAmp:(S.rhythm==='vf')?VFX.jitAmp:0,jitHz:VFX.jitHz,
    cprComp:(S.cpr&&(S.rhythm==='arrest'||S.rhythm==='vf'))?(Math.sin(S.t*Math.PI*2*1.9)*0.5+0.5):0,  // 按压相 ~114/min
    shockActive:(se>=0&&se<=0.15)?1:0,shockElapsed:se};
}
// per-organ 最终颜色(纯函数): 入参器官 id + 基色 RGB, 出参 [r,g,b](0..1)。含既有先例(脑GCS变暗/肾缺血变暗)。
function vfxOrganColor(id,r,g,b,fx){
  fx=fx||vfxState();
  const cl=v=>clamp(v,0,1);
  // ① 器官自身病理 tint(紫绀叠加优先级低于器官自身病理色——先算保留下层主导色)
  if(id==='brain'){const d=clamp(0.35+S.gcs/15*0.75,0.35,1.1);r*=d;g*=d;b*=d;}
  if((id==='kidneyL'||id==='kidneyR')&&S.map<65){r*=0.7;g*=0.55;b*=0.55;}   // 肾缺血先例
  // ② 心梗/骤停/气道特例
  if(id==='heart'){
    if(fx.mi>0){const m=fx.mi;r=r*(1-m)+0.36*m;g=g*(1-m)+0.10*m;b=b*(1-m)+0.30*m;}   // 心肌缺氧: 暗红→紫
    if(fx.arrest){const gr=(r+g+b)/3*0.5;r=gr;g=gr;b=gr*1.04;}                        // 骤停: 石墨灰
  }
  if(id==='airway'&&fx.anaphy>0){const a=fx.anaphy;r=r*(1-a)+0.72*a;g=g*(1-a)+0.12*a;b=b*(1-a)+0.12*a;}  // 气道红肿
  // ③ 常规 tint: 发热(暖红+亮度↑)
  if(fx.fever>0){r*=1+0.16*fx.fever;g*=1+0.04*fx.fever;b*=1-0.27*fx.fever;const br=1+0.06*fx.fever;r*=br;g*=br;b*=br;}
  // ④ 全器官: 紫绀 / 苍白 / CO 樱桃红
  if(fx.cyan>0){r*=1-0.5*fx.cyan;g*=1-0.22*fx.cyan;b*=1+0.30*fx.cyan;}   // hue 向青紫偏移
  if(fx.cherry>0){r*=1+0.3*fx.cherry;g*=1-0.12*fx.cherry;b*=1-0.12*fx.cherry;}   // CO: 皮肤樱桃红例外(压过紫绀向红)
  if(fx.pale>0){const q=fx.pale;const lum=(r*0.3+g*0.6+b*0.1);r=r*(1-q)+lum*0.58*q;g=g*(1-q)+lum*0.58*q;b=b*(1-q)+lum*0.58*q;}  // 亮度降→灰白(去饱和+变暗)
  // ⑤ 死亡灰阶(最高优先级, 终段覆盖)
  if(fx.dead>0){const gr=(r*0.30+g*0.59+b*0.11)*0.86;r=r*(1-fx.dead)+gr*fx.dead;g=g*(1-fx.dead)+gr*fx.dead;b=b*(1-fx.dead)+gr*fx.dead;}
  return [cl(r),cl(g),cl(b)];
}
// 心脏 emissive 强度(心尖区缺血脉动 + 起搏夺获闪): 0=无发光
function vfxHeartGlow(fx){
  fx=fx||vfxState();
  let e=0;
  if(fx.mi>0)e+=fx.mi*(0.32+0.28*Math.sin(S.t*10));   // 心梗: 心尖区暗红发光随搏动脉动
  if(fx.paceFlash>0)e+=fx.paceFlash*0.9*(fx.paceFlashCount>0?1:1);   // 起搏夺获: 每个起搏心搏短促亮闪
  return Math.max(0,e);
}
// 除颤电击 → 全场景白闪 150ms(#shockFlash 全屏 div, 由 waveFrame→vfxUi 做 opacity 动画)
function vfxShockFlash(){
  VFX.shockT=S.t;
  const d=(typeof document!=='undefined')?document.getElementById('shockFlash'):null;
  if(d)d.style.opacity='0.85';
  VFX.lastShockAt=S.t;
}
// 由 waveFrame(50ms)驱动: 白闪 opacity 按时序衰减(0.85 → 0, 150ms 内)
function vfxUi(){
  const d=(typeof document!=='undefined')?document.getElementById('shockFlash'):null;
  if(!d)return;
  const st=vfxState();
  d.style.opacity=st.shockActive?String(0.85*(1-st.shockElapsed/0.15)):'0';
}
// ============ 初始化 ============
function patientEngineInit(){

  const sel=document.getElementById('chemSel');const seen=new Set();
  Object.entries(CATS).forEach(([cat,arr])=>{
    const g=document.createElement('optgroup');g.label=cat;
    arr.forEach(c=>{if((CHEMS.includes(c)||HORMONES.includes(c))&&!seen.has(c)){seen.add(c);
      const o=document.createElement('option');o.value=c;o.textContent=zhOf(c)+'（'+c+'）';g.appendChild(o);}});
    sel.appendChild(g);
  });
  const g=document.createElement('optgroup');g.label='其他（全量）';
  CHEMS.forEach(c=>{if(c!=='Null'&&!seen.has(c)){const o=document.createElement('option');o.value=c;o.textContent=zhOf(c)+'（'+c+'）';g.appendChild(o);}});
  sel.appendChild(g);
  sel.value='Epinephrine';
  // 阶段2: 饮食选择器（24 种 FoodType）
  const fs=document.getElementById('foodSel');
  if(fs){ENUMS.FoodType.forEach(f=>{const F=FOODS[f];const o=document.createElement('option');o.value=f;
    o.textContent=(F?F.ic+' '+F.zh+'（'+f+'）':f);fs.appendChild(o);});fs.value='Water';foodHint();}
  const rs=document.getElementById('routeSel');
  ROUTES.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent={Muscle:'肌注',ContinuousInfusion:'持续输注',Oral:'口服',IVPush:'静推',Inhale:'吸入'}[r]||r;rs.appendChild(o);});
  rs.value='IVPush';
  document.querySelectorAll('#waves .lane canvas').forEach(c=>c.dataset.r=1);
  ecgSw=mkSweep(document.getElementById('ecgCv'),'#22e07e');plSw=mkSweep(document.getElementById('plethCv'),'#4fc3ff');co2Sw=mkSweep(document.getElementById('co2Cv'),'#ffd15e');
  try { ecgSw.resize(); plSw.resize(); co2Sw.resize(); } catch (e) {}
  loadHeart();
  patientRegisterPathogens();
  if (!window.PatientSim.booted) {
    log('床旁监护就绪。数值模型经生理学常数校准（SA起搏60/AV40 · 血管反应按 LMVascular 系数）。');
    log('场景：肾上腺素静推 → 血压心率；高钾 → 恶性心律 → 除颤；μ 阿片 → 呼吸抑制(-0.8) → 纳洛酮。');
    log('生殖周期已启用（LMFRS）：28 天周期按 1 周期天=60s 压缩（全程约 28 分钟）——FSH/LH/E2/P4 见采血化验"性激素"组，周期结束触发月经（NSAIDs 可缓解痛经）。');
  }
}


// ================= 阶段4收尾: 29 条游戏原声音效（Unity AudioClip 提取 .wav） + 病例/关卡玩法 =================
// 音源: /data/mkk/smlife/ext/patient/bin/Data AudioClip 子集 → patient/audio/*.wav（UnityPy 解码 44.1kHz PCM）
// 静音策略: 沿用既有 toggleSound/S.soundOn 总开关; 心音/呼吸轻音量, 报警明显; 自动播放政策: AudioContext 首次用户点击后 resume
const AUD_FILES={
  'Heart-Lub':'Heart-Lub','Heart-Dub':'Heart-Dub','Inhale':'Inhale','Exhale':'Exhale','Inhalation':'Inhalation',
  'Ventilator':'Ventilator','Defibrillator':'Defibrillator','Defibrillator-Shock':'Defibrillator-Shock','Electric':'Electric',
  'IVBag':'IVBag','Devour-food':'Devour-food','Devour-liquid':'Devour-liquid','Stomach-Growling':'Stomach_Growling','Urinate':'Urinate',
  'Cough-male':'Cough-male','Cough-female':'Cough-female','Sneeze-male':'Sneeze-male','Sneeze-female':'Sneeze-female',
  'Vomit-male':'Vomit-male','Vomit-female':'Vomit-female','Vomit':'Vomit','Ectomy':'Ectomy',
  'Vital-Pulse':'Vital-Pulse','Vital-Warning':'Vital-Warning','Vital-Zero':'Vital-Zero','GoodCondition':'GoodCondition',
  'Life':'Life','Bop_2':'Bop_2','Bop_3':'Bop_3'
};
var AUDSTATS={counts:{},files:{},loops:{},ac:null,master:null,ventOn:false,inhFlip:false,uiFlip:false,lastWarn:-99,lastZero:-99,prevCondN:0,goodT:0,dubPend:false};
if(typeof window!=='undefined')window.AUDSTATS=AUDSTATS;
function audAC(){
  if(AUDSTATS.ac)return AUDSTATS.ac;
  const AC=(typeof window!=='undefined')?(window.AudioContext||window.webkitAudioContext):null;
  if(!AC)return null;
  try{
    AUDSTATS.ac=new AC();
    const g=AUDSTATS.ac.createGain();g.gain.value=0.9;g.connect(AUDSTATS.ac.destination);AUDSTATS.master=g;
  }catch(e){AUDSTATS.ac=null;}
  return AUDSTATS.ac;
}
function audResume(){const a=audAC();if(a&&a.state==='suspended'&&a.resume){try{a.resume().catch(()=>{});}catch(e){}}}
function sfx(name,opt){                      // opt:{gain 0..1, loop}
  opt=opt||{};
  if(typeof S!=='undefined'&&S&&!S.soundOn)return false;    // 总开关: toggleSound
  if(!AUD_FILES[name]&&!/\.wav$/.test(name))return false;
  AUDSTATS.counts[name]=(AUDSTATS.counts[name]||0)+1;       // 统计(测试断言接线/静音用)
  const a=audAC();if(!a)return false;
  const fn=AUD_FILES[name]||name.replace(/\.wav$/,'');
  const buf=AUDSTATS.files[name];
  if(buf==='loading')return true;                           // 首次请求在途——本次跳过(下一拍重试)
  if(buf){_audPlay(a,buf,name,opt);return true;}
  AUDSTATS.files[name]='loading';
  try{
    fetch('patient/audio/'+fn+'.wav').then(function(r){if(!r.ok)throw new Error('http');return r.arrayBuffer();})
      .then(function(b){return a.decodeAudioData(b);})
      .then(function(b2){AUDSTATS.files[name]=b2;if(opt.loop)_audPlay(a,b2,name,opt);})
      .catch(function(){AUDSTATS.files[name]=null;});
  }catch(e){AUDSTATS.files[name]=null;}
  return true;
}
function _audPlay(a,buf,name,opt){
  const src=a.createBufferSource();src.buffer=buf;
  const g=a.createGain();g.gain.value=(opt.gain!==undefined?opt.gain:0.5);
  try{src.connect(g);g.connect(AUDSTATS.master||a.destination);}catch(e){}
  if(opt.loop){
    src.loop=true;
    if(AUDSTATS.loops[name]){try{AUDSTATS.loops[name].stop();}catch(e){}}
    AUDSTATS.loops[name]=src;
  }
  try{src.start();}catch(e){}
  return src;
}
function sfxStopLoop(name){if(AUDSTATS.loops[name]){try{AUDSTATS.loops[name].stop();}catch(e){}delete AUDSTATS.loops[name];}}
function sfxPhaseAudio(prevBeat,prevResp,dt){  // 由 tick() 每拍调用: 相位同步心音/呼吸音
  if(!S||S.dead||!S.soundOn)return;
  // 心音: 收缩始(Lub)/舒张始(Dub), 频率自然跟随 S.hr —— 展开相位网格法, 大步长(dt×hr)不漏拍
  if((S.rhythm==='sinus'||S.rhythm==='afib')&&S.hr>20){
    let adv=(S.beatPhase-prevBeat)%1;if(adv<0)adv+=1;
    const u1=prevBeat,u2=u1+adv;
    if(u2>u1+1e-4){
      const nLub=Math.floor(u2)-Math.floor(u1);                       // 跨越整数(搏动开始)
      const nDub=Math.floor(u2-0.5)-Math.floor(u1-0.5);               // 跨越半整数(舒张始)
      let seq=[];
      if(nLub&&nDub)seq=(u1<0.5)?['Heart-Dub','Heart-Lub']:['Heart-Lub','Heart-Dub'];
      else if(nLub)seq=['Heart-Lub'];else if(nDub)seq=['Heart-Dub'];
      for(const nm of seq)sfx(nm,{gain:nm==='Heart-Lub'?.32:.26});
    }
  }else AUDSTATS.dubPend=false;
  // 呼吸音: 自主呼吸吸气/呼气相位; 机械通气时由呼吸机循环音像代表(不叠自主呼吸音)
  if(!S.vent&&S.rr>=4&&S.rr<=30){
    const rp=((S.t*S.rr/60)%1+1)%1;
    if(prevResp>rp){sfx(AUDSTATS.inhFlip?'Inhale':'Inhalation',{gain:.30});AUDSTATS.inhFlip=!AUDSTATS.inhFlip;}
    if(prevResp<0.5&&rp>=0.5)sfx('Exhale',{gain:.24});
  }
  if(S.vent){AUDSTATS.ventOn=true;sfx('Ventilator',{loop:true,gain:.45});}
  else{if(AUDSTATS.ventOn)sfxStopLoop('Ventilator');AUDSTATS.ventOn=false;}
}
function sfxAlarms(conds){                     // 由 uiFrame() 调用: 报警循环(带间隙)/停搏音/完全恢复一次性
  if(!S||S.dead||!S.soundOn){AUDSTATS.prevCondN=0;return;}
  const mid=(S.rhythm==='arrest'||S.rhythm==='vf');
  if(mid){if(S.t-AUDSTATS.lastZero>4){AUDSTATS.lastZero=S.t;sfx('Vital-Zero',{gain:.8});}AUDSTATS.goodT=0;}
  else if(conds&&conds.length){
    if(conds.length&&!AUDSTATS.prevCondN)AUDSTATS.goodT=0;    // 新报警出现 → 重新武装 GoodCondition
    if(S.t-AUDSTATS.lastWarn>5.5){AUDSTATS.lastWarn=S.t;sfx('Vital-Warning',{gain:.7});}
  }else{
    if(AUDSTATS.prevCondN>0&&!AUDSTATS.goodT){AUDSTATS.goodT=S.t;sfx('GoodCondition',{gain:.6});}
  }
  AUDSTATS.prevCondN=(conds&&conds.length)?conds.length:0;
}
// 自动播放政策 + UI 点击音(Bop 2/3 交替)
if(typeof document!=='undefined'&&document.addEventListener){
  document.addEventListener('pointerdown',function(e){
    audResume();                                  // 首次用户点击后 resume AudioContext
    const t=e.target;
    const b=(t&&t.closest)?t.closest('button'):null;
    if(b){AUDSTATS.uiFlip=!AUDSTATS.uiFlip;sfx(AUDSTATS.uiFlip?'Bop_3':'Bop_2',{gain:.35});}
  },true);
}
// ============ 病例/关卡玩法 ============
const CASE_STORE='smlife_cases_v1';
function caseProgress(){
  let p=null;
  try{p=JSON.parse((typeof localStorage!=='undefined')?localStorage.getItem(CASE_STORE):null);}catch(e){}
  if(!p||typeof p!=='object')p={};
  if(!p.unlocked||p.unlocked<1)p.unlocked=1;      // 第 1 个默认解锁
  if(!p.results)p.results={};
  return p;
}
function caseSave(p){try{if(typeof localStorage!=='undefined')localStorage.setItem(CASE_STORE,JSON.stringify(p));}catch(e){}}
var CASEC={active:null,idx:-1,clock:0,ops:0,goals:[],result:null};
const CASES=[
 {id:'sca',name:'心源性猝死',diff:4,limit:420,
  desc:'肾功能恶化继发高钾血症(K⁺ 6.9)，已诱发心室颤动。胰岛素+葡萄糖促钾内移，除颤转复，维持灌注。',
  apply:function(){S.blood['Potassium']=0.62;S.k=6.9;setRhythm('vf');},
  goals:[
    {txt:'电除颤/复律 → 窦性心律',hold:10,test:function(){return S.rhythm==='sinus';}},
    {txt:'血钾回落至 <5.6 mmol/L',hold:10,test:function(){return S.k<5.6;}},
    {txt:'MAP ≥ 60 mmHg 维持 60s',hold:60,test:function(){return S.map>=60;}}]},
 {id:'opioid',name:'阿片过量',diff:2,limit:360,
  desc:'芬太尼静推后 μ 受体介导呼吸中枢抑制(-0.8)：呼吸频率与 SpO₂ 崩落、意识受抑。纳洛酮竞争性逆转。',
  apply:function(){S.blood['Fentanyl']=1.8;S.paco2=48;},
  goals:[
    {txt:'呼吸频率恢复 ≥ 8 /min',hold:30,test:function(){return S.rr>=8;}},
    {txt:'意识恢复 GCS ≥ 14',hold:30,test:function(){return S.gcs>=14;}}]},
 {id:'anaphylaxis',name:'过敏性休克',diff:3,limit:360,
  desc:'组胺爆发(H1 介导)：血管扩张+气道痉挛+皮疹样过敏状态。肾上腺素 + 液体 + 抗组胺。',
  apply:function(){S.blood['Histamine']=1.3;S.fluid=0.9;},
  goals:[
    {txt:'MAP ≥ 65 mmHg 维持 20s',hold:20,test:function(){return S.map>=65;}},
    {txt:'过敏样反应状态消退',hold:20,test:function(){return !collectConds().some(function(c){return c.id==='Anaphylaxis';});}}]},
 {id:'apnea',name:'窒息抢救',diff:3,limit:300,
  desc:'肌松剂(琥珀胆碱)残留 → 呼吸暂停。开放机械通气 A/C 正确接管，避免低氧死亡。',
  apply:function(){S.blood['Succinylcholine']=1.2;S.rr=2;S.spo2=92;},
  goals:[
    {txt:'开启机械通气',hold:5,test:function(){return !!S.vent;}},
    {txt:'SpO₂ ≥ 95% 维持 60s',hold:60,test:function(){return S.spo2>=95;}},
    {txt:'PaCO₂ 回到 35-50',hold:10,test:function(){return S.paco2>=35&&S.paco2<=50;}}]},
 {id:'dka',name:'糖尿病急症',diff:5,limit:480,
  desc:'酮症酸中毒：血糖 32 mmol/L、pH<7.2、低容量。胰岛素滴定降糖至 8-12 并纠酸——谨防低血糖(<3.0 判负)。',
  apply:function(){S.glucose=32;S.blood['Glucose']=5.5;S.paco2=50;S.fluid=0.5;S.ph=7.12;S.map=48;},
  failIf:function(){return S.glucose<3.0?('低血糖发作：血糖 '+S.glucose.toFixed(1)+' mmol/L'):null;},
  goals:[
    {txt:'血糖滴定至 8~12 mmol/L',hold:20,test:function(){return S.glucose>=8&&S.glucose<=12;}},
    {txt:'酸中毒纠正 pH ≥ 7.35',hold:20,test:function(){return S.ph>=7.35;}}]},
 {id:'hemorrhage',name:'失血性休克',diff:3,limit:420,
  desc:'消化道大出血：Hb 6.5 g/dL、低容量、代偿性心动过速。晶体温补 + 全血输注两条路径。',
  apply:function(){S.fluid=0.62;S.hb=6.5;S.sympath=1.1;S.map=52;},
  goals:[
    {txt:'MAP ≥ 65 mmHg 维持 30s',hold:30,test:function(){return S.map>=65;}},
    {txt:'血红蛋白回升 Hb ≥ 9 g/dL',hold:10,test:function(){return S.hb>=9;}}]},
 {id:'asthma',name:'支气管哮喘',diff:2,limit:300,
  desc:'组胺介质驱动的支气管痉挛(气道阻力↑)。β2 激动剂开通气道，通气/氧合恢复。',
  apply:function(){S.blood['Histamine']=1.4;S.airwayR=1.28;},
  goals:[
    {txt:'气道阻力回落 ≤1.15',hold:15,test:function(){return S.airwayR<=1.15;}},
    {txt:'SpO₂ ≥ 94% 且呼吸频率 8~24',hold:15,test:function(){return S.spo2>=94&&S.rr>=8&&S.rr<=24;}}]},
 {id:'multi',name:'实战综合',diff:5,limit:480,
  desc:'多病理叠加：高钾 + 阿片呼吸抑制 + 低容量低血压。全指标回到正常范围才能收队。',
  apply:function(){S.blood['Potassium']=0.55;S.blood['Fentanyl']=1.6;S.k=6.6;S.fluid=0.68;S.map=56;},
  goals:[
    {txt:'窦性心律',hold:10,test:function(){return S.rhythm==='sinus';}},
    {txt:'血钾 3.5~5.8 mmol/L',hold:10,test:function(){return S.k>=3.5&&S.k<=5.8;}},
    {txt:'SpO₂ ≥ 94%',hold:10,test:function(){return S.spo2>=94;}},
    {txt:'MAP 65~110 mmHg',hold:10,test:function(){return S.map>=65&&S.map<=110;}},
    {txt:'MAP 65~110 mmHg',hold:10,test:function(){return S.map>=65&&S.map<=110;}},
    {txt:'意识 GCS ≥ 14',hold:10,test:function(){return S.gcs>=14;}}]},
 // ==== 阶段5: 新增病例 9~16 (只设计引擎现有/本阶段补充机制可真实驱动的病例) ====
 {id:'tamponade',name:'心包填塞',diff:4,limit:300,
  desc:'心包积液急性积聚压迫舒张期充盈(LMHeart tamponade·tamponade_rate 0.3 标定)：Beck 三联征——低血压、心音遥远、颈静脉怒张。升压药只能部分代偿，心包穿刺引流是确定性治疗。',
  apply:function(){S.tamponade=0.85;S.map=58;S.sympath=1.15;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):null;},
  goals:[
    {txt:'心包穿刺减压完成（心包压塞解除）',hold:5,test:function(){return S.tamponade<0.1;}},
    {txt:'MAP ≥ 65 mmHg 维持 20s',hold:20,test:function(){return S.map>=65;}},
    {txt:'代偿性心动过速消退（HR 50~115）',hold:10,test:function(){return S.hr>50&&S.hr<115;}}]},
 {id:'svt',name:'室上性心动过速',diff:3,limit:300,
  desc:'房室结折返性 SVT ~188bpm：舒张充盈锐减 → 心排量骤降、血压不稳。腺苷（Adenosine 静推）瞬时阻断房室结、打断折返——数秒内复律；备好除颤。',
  apply:function(){S.svt=true;S.map=68;},
  goals:[
    {txt:'腺苷复律 → 心率回落 <120 bpm',hold:10,test:function(){return !S.svt&&S.hr<120;}},
    {txt:'恢复窦性心律',hold:10,test:function(){return S.rhythm==='sinus';}},
    {txt:'MAP ≥ 65 mmHg 维持 15s',hold:15,test:function(){return S.map>=65;}}]},
 {id:'hypogly',name:'严重低血糖昏迷',diff:3,limit:270,
  desc:'胰岛素过量：血糖崩落至 1.8 mmol/L → 脑能量衰竭、意识进行性丧失（GCS 崩落）。血糖 <1.0 持续 90s 即脑死亡。静推葡萄糖即刻逆转——并在胰岛素残留期内维持。',
  apply:function(){S.blood['Insulin']=1.6;S.glucose=1.8;S.gcs=9;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):null;},
  goals:[
    {txt:'血糖回升 ≥ 3.5 mmol/L',hold:10,test:function(){return S.glucose>=3.5;}},
    {txt:'意识恢复 GCS ≥ 14',hold:20,test:function(){return S.gcs>=14;}}]},
 {id:'mh',name:'恶性高热',diff:4,limit:360,
  desc:'琥珀胆碱触发的肌浆网钙释放失控：高代谢危象——体温飙升 41.5℃ 且持续攀升、CO₂ 激增、横纹肌溶解→高钾酸中毒。第一步永远是停用诱因(代谢清除)，随后物理降温+解热药。',
  apply:function(){S.mhSus=true;S.blood['Succinylcholine']=1.3;S.temp=41.5;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):(S.temp>42.5?'恶性高热失控：核心温度 '+S.temp.toFixed(1)+'℃ — 未及时停诱因/降温':null);},
  goals:[
    {txt:'体温降至 ≤38.5℃ 维持 15s',hold:15,test:function(){return S.temp<=38.5;}},
    {txt:'酸中毒纠正 pH ≥ 7.32',hold:10,test:function(){return S.ph>=7.32;}},
    {txt:'无恶性心律失常（窦性）',hold:10,test:function(){return S.rhythm==='sinus';}}]},
 {id:'storm',name:'甲状腺风暴',diff:5,limit:420,
  desc:'甲亢危象：T₃ 风暴(TR 持续激动+内源性儿茶酚胺激增)——窦率 95+bpm、高血压急症(MAP 120+)、高热 39.4℃ 产热失控。β 受体阻滞剂滴定控率(过量→心动过缓判负风险) + 解热/物理降温，渡过危象期。',
  apply:function(){S.blood['T3']=2.5;S.stormT=1;S.sympath=1.35;S.temp=39.8;},
  goals:[
    {txt:'心率控制 60~110 bpm 维持 15s',hold:15,test:function(){return S.hr>=60&&S.hr<=110;}},
    {txt:'体温 ≤38.5℃ 维持 15s',hold:15,test:function(){return S.temp<=38.5;}},
    {txt:'MAP 65~110 mmHg',hold:10,test:function(){return S.map>=65&&S.map<=110;}}]},
 {id:'digoxin',name:'洋地黄中毒',diff:5,limit:420,
  desc:'长期强心苷+利尿剂致低钾（K⁺ 2.6）：室性心动过速 + 收缩力受抑。引擎无洋地黄/抗体通道——教学路径：停药(代谢清除)+补钾+补镁稳膜，恶化时随时除颤。',
  apply:function(){S.kWasting=true;S.k=2.6;S.rhythm='vt';S.map=62;S.contract=0.55;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):null;},
  goals:[
    {txt:'转复窦性心律',hold:10,test:function(){return S.rhythm==='sinus';}},
    {txt:'血钾回升 3.5~5.2 mmol/L',hold:10,test:function(){return S.k>=3.5&&S.k<=5.2;}},
    {txt:'MAP ≥ 65 mmHg 维持 15s',hold:15,test:function(){return S.map>=65;}}]},
 {id:'cohb',name:'一氧化碳中毒',diff:4,limit:360,
  desc:'密闭空间持续吸入 CO：脉搏血氧仪读数"正常"的陷阱——COHb 42% 组织缺氧（昏迷+酸中毒），皮肤樱桃红（紫绀判断例外）。脱离暴露+高流量氧疗加速 COHb 清除；不干预则 COHb 攀向 60% 死亡线。',
  apply:function(){S.cohb=0.42;S.coSrc=true;S.gcs=8;},
  failIf:function(){return (S.cohb>=0.6)?('COHb ≥60%：组织缺氧不可逆死亡'):null;},
  goals:[
    {txt:'脱离暴露 + 高流量氧疗 FiO₂ ≥80%',hold:10,test:function(){return S.fio2>=0.8&&!(S.coSrc>0);}},
    {txt:'COHb 清除至 <10%',hold:15,test:function(){return S.cohb<0.10;}},
    {txt:'意识恢复 GCS ≥ 14',hold:15,test:function(){return S.gcs>=14;}}]},
 {id:'crush',name:'挤压伤高钾',diff:5,limit:420,
  desc:'坍塌挤压伤：横纹肌溶解钾负荷 + 急性肾损伤排钾无力 → K⁺ 持续攀升逼近致死阈值。胰岛素+葡萄糖促钾内移、钙剂稳膜，为肾功能代偿争取时间（引擎无透析——维持期目标代替）。',
  apply:function(){S.kidFrac=0.22;S.k=6.7;S.map=58;S.creat=260;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):null;},
  goals:[
    {txt:'钙剂稳膜给药（离子钙 ≥2.4）',hold:5,test:function(){return S.ca>=2.4;}},
    {txt:'血钾 3.8~6.4 mmol/L 维持 90s',hold:90,test:function(){return S.k>=3.8&&S.k<=6.4;}},
    {txt:'无恶性心律失常（窦性）',hold:30,test:function(){return S.rhythm==='sinus';}}]}
];
function caseIdxOf(id){for(let i=0;i<CASES.length;i++)if(CASES[i].id===id)return i;return -1;}
function startCase(id){
  const idx=caseIdxOf(id);
  const p=caseProgress();
  if(idx<0){log('病例不存在');return;}   // 全部病例开放挑战(无解锁门槛)
  closeCaseSelect();
  resetSim();                                  // 初始化复位: 病例进行前预设状态
  const c=CASES[idx];
  CASEC.active=c;CASEC.idx=idx;CASEC.clock=0;CASEC.ops=0;CASEC.result=null;
  CASEC.goals=c.goals.map(function(g){return {txt:g.txt,hold_t:g.hold,hold:0,done:false,test:g.test};});
  c.apply(S);
  log('📋 <b>病例开始：'+c.name+'</b>（难度 '+'★'.repeat(c.diff)+' · 限时 '+fmtT(c.limit)+'）—— '+c.desc,'crit');
  const hud=document.getElementById('caseHUD');if(hud)hud.style.display='block';
  renderCaseHUD();
}
function caseTick(dt){                          // 病例激活时由引擎 tick 轮询判定
  const c=CASEC.active;
  if(!c||CASEC.result)return;
  CASEC.clock+=dt;
  if(c.failIf){
    const fr=c.failIf();
    if(fr)return caseFail(fr);
  }
  let all=true;
  for(const g of CASEC.goals){
    if(g.done)continue;
    let ok=false;
    try{ok=!!g.test();}catch(e){}
    if(ok){g.hold+=dt;if(g.hold>=g.hold_t)g.done=true;}
    else g.hold=Math.max(0,g.hold-dt*2);        // 断续不达标 → 维持进度回退
    if(!g.done)all=false;
  }
  if(all)return caseWin();
  if(CASEC.clock>=c.limit)return caseFail('超时('+fmtT(c.limit)+')——目标未全部达成');
}
function caseWin(){
  const c=CASEC.active;
  const elapsed=CASEC.clock;
  const stars=elapsed<=c.limit*0.4?3:(elapsed<=c.limit*0.7?2:1);
  const p=caseProgress();
  const prev=p.results[c.id];
  const isNewBest=!prev||elapsed<prev.best;
  p.results[c.id]={best:isNewBest?Math.round(elapsed):prev.best,stars:Math.max(stars,prev?prev.stars:0)};
  const next=CASEC.idx+2;                       // 胜利自动解锁下一病例(1-based)
  if(next>p.unlocked&&CASEC.idx+1<CASES.length)p.unlocked=next;
  caseSave(p);
  CASEC.result={won:true,time:Math.round(elapsed),ops:CASEC.ops,stars:stars,newBest:isNewBest,goals:CASEC.goals.map(function(g){return {txt:g.txt,done:true};})};
  CASEC.active=null;
  log('🏆 <b>病例胜利：'+c.name+'</b> —— 用时 '+fmtT(elapsed)+' · 操作 '+CASEC.ops+' · 评级 '+'★'.repeat(stars)+'☆'.repeat(3-stars),'');
  if(typeof sfx==='function'){sfx('GoodCondition',{gain:.7});sfx('Life',{gain:.7});}   // 患者获救 → "Life"
  showCaseEnd();
}
function caseFail(reason){
  const c=CASEC.active;
  if(!c||CASEC.result)return;
  CASEC.result={won:false,time:Math.round(CASEC.clock),ops:CASEC.ops,reason:reason||'失败',goals:CASEC.goals.map(function(g){return {txt:g.txt,done:g.done};})};
  CASEC.active=null;
  log('💀 <b>病例失败：'+c.name+'</b> —— '+(reason||''),'crit');
  if(typeof sfx==='function')sfx('Vital-Zero',{gain:.8});
  showCaseEnd();
}
function caseAbort(){                           // 复苏重置/手动退出 → 中止病例(不计成绩)
  CASEC.active=null;CASEC.result=null;CASEC.goals=[];
  const hud=document.getElementById('caseHUD');if(hud)hud.style.display='none';
  const eb=document.getElementById('caseEndBox');if(eb)eb.style.display='none';
}
function caseQuit(){caseAbort();resetSim();}
function showCaseEnd(){
  const r=CASEC.result;if(!r)return;
  const c=CASES[CASEC.idx];
  const won=r.won;
  const card=document.getElementById('caseEndCard');if(!card)return;
  let h='<h2>'+(won?'🏆 抢救成功':'💀 病例失败')+'</h2>';
  h+='<div style="font-size:13px;color:#44576b">'+c.name+' · 难度 '+'★'.repeat(c.diff)+'</div>';
  if(won){
    h+='<div class="stars">'+'★'.repeat(r.stars)+'☆'.repeat(3-r.stars)+'</div>';
    h+='<div class="row2"><span>用时 <b>'+fmtT(r.time)+'</b>'+(r.newBest?'（新纪录 ✔）':'')+'</span><span>操作/事件 <b>'+r.ops+'</b></span></div>';
  }else{
    h+='<div style="font-size:13px;color:#b3121c;margin:4px 0">'+r.reason+'</div>';
    h+='<div class="row2"><span>已耗时 <b>'+fmtT(r.time)+'</b></span><span>操作/事件 <b>'+r.ops+'</b></span></div>';
  }
  h+='<div id="caseGoalList"><b>目标复盘：</b><br>';
  (won?CASEC.result.goals||[]:r.goals||[]).forEach(function(g){h+='<span class="'+(g.done||won?'ok':'no')+'">'+(g.done||won?'✔':'✘')+' '+g.txt+'</span><br>';});
  if(won)if(CASEC.idx+1<CASES.length)h+='<span class="ok">✔ 已解锁下一病例：'+CASES[CASEC.idx+1].name+'</span><br>';
  h+='</div>';
  h+='<button class="pri" onclick="caseQuit()">返回自由模式</button>'+(won?'':'<button onclick="startCase(\''+c.id+'\')">重试本病例</button>');
  card.className=won?'win':'lose';
  card.innerHTML=h;
  const eb=document.getElementById('caseEndBox');if(eb)eb.style.display='flex';
  const hud=document.getElementById('caseHUD');if(hud)hud.style.display='none';
}
function closeCaseSelect(){const b=document.getElementById('caseBox');if(b)b.style.display='none';}
function openCaseSelect(){
  const p=caseProgress();
  const grid=document.getElementById('caseGrid');
  if(grid){
    let h='';
    CASES.forEach(function(c,i){
      const locked=false;   // 全部病例开放挑战
      const res=p.results[c.id];
      h+='<div class="caseCard'+(locked?' lock':'')+'" '+(locked?'':'onclick="startCase(\''+c.id+'\')"')+
        '><h5>'+(locked?'🔒 ':'')+'C'+(i+1)+' '+c.name+'</h5>'+
        '<div class="diff">'+'★'.repeat(c.diff)+'☆'.repeat(5-c.diff)+'</div>'+
        '<div class="meta">'+(res?('✔ 已完成 · 最佳用时 <span class="best">'+fmtT(res.best)+'</span> · 评级 '+'★'.repeat(res.stars)):'未完成 · 待挑战')+'</div>'+
        '<div class="desc">'+c.desc+'</div></div>';
    });
    grid.innerHTML=h;
  }
  const b=document.getElementById('caseBox');if(b)b.style.display='flex';
}
function renderCaseHUD(){
  const hud=document.getElementById('caseHUD');
  if(!hud)return;
  if(!CASEC.active||CASEC.result){if(!CASEC.result)hud.style.display='none';return;}
  hud.style.display='block';
  const c=CASEC.active;
  document.getElementById('caseHudName').textContent='📋 '+c.name;
  const rem=Math.max(0,c.limit-CASEC.clock);
  const te=document.getElementById('caseHudTime');
  te.textContent='⏱ '+fmtT(CASEC.clock)+' / 剩余 '+fmtT(rem);
  te.style.color=rem<c.limit*0.2?'#b3121c':'#44576b';
  let h='';
  CASEC.goals.forEach(function(g){
    const pct=g.done?100:Math.min(100,g.hold/g.hold_t*100);
    h+='<div class="goalItem'+(g.done?' done':'')+'"><span class="gz">'+(g.done?'✅':(pct>0?'⏳':'⬜'))+'</span>'+
      '<span class="gtxt" style="flex:1">'+g.txt+(g.done?'':' <span style="color:#8aa">'+Math.ceil(g.hold_t-g.hold)+'s</span>')+'</span>'+
      '<span class="gbar"><span class="gfill" style="width:'+pct+'%"></span></span></div>';
  });
  document.getElementById('caseHudGoals').innerHTML=h;
  document.getElementById('caseHudHint').textContent='操作 '+CASEC.ops+' · 目标需持续满足维持时长';
}

// ================= 阶段6: 病毒/病原体系统(游戏沙盒语义: 注入病原体·免疫对抗·支持疗法) + 病理粒子特效层 PFX =================
// 架构沿用 VFX 先例: 经典脚本维护纯数据状态(S.pathogens / PFX.parts 数组, MAX 上限防性能), three.js 模块只做"数据→材质"渲染。
// 免疫球蛋白(ImmunGlobulin)为新增制剂——非游戏原生 ChemicalType, 构建期新增, 游戏语义=被动免疫支持(提升病原清除率), 不属抗病毒药。
// 病毒动力学速率为玩法压缩时标(分钟级可见全程), 免疫应答≈分钟级动员——与引擎 1s=1 模拟秒一致。
// ---- 病原体库: CellType 病原体全量(病毒16种+细菌4种), 无抗病毒药: 治疗哲学=支持疗法+免疫系统自身 ----
const TROP_ZH={urt:'上呼吸道',lrt:'下呼吸道',gi:'消化道',sys:'全身系统',liver:'肝脏',sepsis:'血流播散(败血症样)'};
const PATH_LIB={
  Rhinovirus:{zh:'鼻病毒',kind:'virus',trop:'urt',r:0.030,cap:0.35,pyro:1.2,col:[0.35,0.62,0.32]},
  Adenovirus:{zh:'腺病毒',kind:'virus',trop:'urt',r:0.034,cap:0.50,pyro:1.5,col:[0.88,0.64,0.22]},
  Influenza:{zh:'流感病毒',kind:'virus',trop:'lrt',r:0.042,cap:0.85,pyro:5.0,col:[0.88,0.25,0.32]},
  Coronavirus:{zh:'冠状病毒',kind:'virus',trop:'lrt',r:0.036,cap:0.95,pyro:6.5,col:[0.76,0.20,0.14],res:0.25},
  RSV:{zh:'呼吸道合胞病毒',kind:'virus',trop:'lrt',r:0.038,cap:0.70,pyro:4.0,col:[0.55,0.27,0.66]},
  Rotavirus:{zh:'轮状病毒',kind:'virus',trop:'gi',r:0.050,cap:0.80,pyro:3.0,col:[0.09,0.63,0.55]},
  Norovirus:{zh:'诺如病毒',kind:'virus',trop:'gi',r:0.055,cap:0.85,pyro:3.5,col:[0.15,0.68,0.29]},
  HIV:{zh:'人类免疫缺陷病毒',kind:'virus',trop:'sys',r:0.010,cap:0.50,pyro:1.0,col:[0.61,0.35,0.74],res:0.97},
  HPV:{zh:'人乳头瘤病毒',kind:'virus',trop:'sys',r:0.012,cap:0.20,pyro:0.8,col:[0.90,0.55,0.62],res:0.9},
  VZV:{zh:'水痘-带状疱疹病毒',kind:'virus',trop:'sys',r:0.020,cap:0.30,pyro:3.0,col:[0.85,0.45,0.30]},
  MeaslesVIrus:{zh:'麻疹病毒',kind:'virus',trop:'sys',r:0.050,cap:1.00,pyro:8.0,col:[0.90,0.49,0.11],res:0.65},
  RubellaVirus:{zh:'风疹病毒',kind:'virus',trop:'sys',r:0.038,cap:0.60,pyro:3.5,col:[0.95,0.62,0.18]},
  HAV:{zh:'甲型肝炎病毒',kind:'virus',trop:'liver',r:0.022,cap:0.60,pyro:3.0,col:[0.80,0.62,0.15]},
  HBV:{zh:'乙型肝炎病毒',kind:'virus',trop:'liver',r:0.014,cap:0.70,pyro:2.5,col:[0.72,0.55,0.20],res:0.55},
  HCV:{zh:'丙型肝炎病毒',kind:'virus',trop:'liver',r:0.012,cap:0.60,pyro:2.0,col:[0.62,0.48,0.24],res:0.6},
  HDV:{zh:'丁型肝炎病毒',kind:'virus',trop:'liver',r:0.015,cap:0.50,pyro:2.5,col:[0.55,0.42,0.30]},
  EColi:{zh:'大肠杆菌',kind:'bacterium',trop:'gi',r:0.055,cap:0.90,pyro:3.5,col:[0.28,0.52,0.75],sepsis:true,res:0.30},
  CTetani:{zh:'破伤风梭菌',kind:'bacterium',trop:'sys',r:0.030,cap:0.60,pyro:3.0,col:[0.42,0.36,0.80]},
  CDiphtheriae:{zh:'白喉棒状杆菌',kind:'bacterium',trop:'urt',r:0.028,cap:0.60,pyro:3.5,col:[0.63,0.61,0.97]},
  BPertussis:{zh:'百日咳鲍特菌',kind:'bacterium',trop:'urt',r:0.026,cap:0.70,pyro:3.0,col:[0.45,0.72,0.97],spasmodic:true}
};
// 接种接口(给药面板'病原体'组 → 化学面板选择病原体 + 剂量=接种量)
function pathInoculate(key,dose){
  const L=PATH_LIB[key];if(!L)return;
  if(!S.pathogens)S.pathogens={};
  const p=S.pathogens[key]||(S.pathogens[key]={load:0,tropism:L.trop,dmg:0});
  const inc=clamp((dose||1)/10*0.02,0.002,0.12);
  p.load=Math.min(L.cap*1.15,p.load+inc);
  log('🦠 <b>接种病原体：'+L.zh+'（'+key+'）</b> ×'+dose+' → 病原负荷 '+p.load.toFixed(3)+' · 组织趋向：'+TROP_ZH[L.trop]+' · 免疫系统将自主应答（治疗哲学=支持疗法）','crit');
}
function pathTot(){let t=0;if(!S.pathogens)return 0;for(const k in S.pathogens)t+=S.pathogens[k].load;return t;}
function pathFrac(key){const p=S.pathogens&&S.pathogens[key],L=PATH_LIB[key];return (p&&L)?p.load/L.cap:0;}
function pathTop(){let bk=null,bl=0;if(S.pathogens)for(const k in S.pathogens){if(S.pathogens[k].load>bl){bl=S.pathogens[k].load;bk=k;}}return bk;}
function pathPeaked(key){const p=S.pathogens&&S.pathogens[key],L=PATH_LIB[key];return !!(p&&L&&(p.peak||0)>L.cap*0.18);}   // 病原已确立感染(峰值>18% 容量)——清除/退热目标的有效性门控
// ---- 免疫-病原体动力学(每 tick): 指数复制→致热/免疫动员→清除 ∝ 免疫强度×(1-免疫抑制) ----
function pathogenStep(dt){
  if(!S.pathogens)S.pathogens={};
  if(!S.imm)S.imm={lymph:1,neut:1,act:0,supp:0,seenT:0,mem:0};
  if(!S.sym)S.sym={coughT:8,sneezeT:12,vomitT:-1,coughAt:-99,sneezeAt:-99,vomitAt:-99,coughN:0,sneezeN:0,vomitN:0,coughing:0,sneezing:0,vomiting:0,flip:0};
  const ig=clamp((S.blood['ImmunGlobulin']||0)*0.35,0,1.2);   // 免疫球蛋白: 被动免疫提升清除率(新增非原生制剂)
  const del=[];
  let tot=0,urt=0,lrt=0,gi=0,sysD=0,liv=0,sep=0,topK=null,topL=0;
  for(const k in S.pathogens){
    const e=S.pathogens[k],L=PATH_LIB[k];if(!L){del.push(k);continue;}
    const opp=1+(S.imm.supp||0)*4.0;                                        // 免疫抑制 → 机会性感染复制加速(机会性感染窗口)
    const clear=(0.02+0.06*(S.imm.mem||0)+0.55*Math.max(0,(S.imm.act||0)-0.35)*(S.imm.lymph||1)*(1-(S.imm.supp||0)))*(1+1.6*ig)*(1-(L.res||0));   // 效应阈值 0.35: 静默期不启动适应性清除→对数期扩增; mem: 免疫记忆基线清除(初次应答成熟后防复发 blip); res=慢性病原清除抗性
    e.load+=(e.load*L.r*(1-e.load/L.cap)*opp-clear*e.load)*dt;
    if(e.load<0)e.load=0;
    e.dmg=clamp(e.load/L.cap,0,1);
    e.peak=Math.max(e.peak||0,e.load);   // 本局峰值负荷(目标门控: 感染需先确立再清除, 防"接种即胜利")
    if(e.load<1e-4){del.push(k);continue;}
    tot+=e.load;
    if(L.trop==='urt')urt=Math.max(urt,e.dmg);
    if(L.trop==='lrt')lrt=Math.max(lrt,e.dmg);
    if(L.trop==='gi')gi=Math.max(gi,e.dmg);
    if(L.trop==='sys')sysD=Math.max(sysD,e.dmg);
    if(L.trop==='liver')liv=Math.max(liv,e.dmg);
    if(L.sepsis||L.trop==='sepsis')sep=Math.max(sep,e.dmg);
    if(e.load>topL){topL=e.load;topK=k;}
  }
  for(const k of del)delete S.pathogens[k];
  // 免疫动员: 抗原检出(>0.10)后 seenT 累积 → 初次应答成熟度 mat(克隆扩增 ~90s) → act 依病原负荷上行
  // 抗原检出带迟滞: 首检 0.10; 已动员(act>0.15)后降至 0.015 以下才解除武装 → 防止在检出阈值处振荡"慢性平台"
  const detect=tot>0.10||((S.imm.act||0)>0.15&&tot>0.015);
  if(detect)S.imm.seenT=(S.imm.seenT||0)+dt;else S.imm.seenT=Math.max(0,(S.imm.seenT||0)-dt*0.3);
  if((S.imm.seenT||0)>100)S.imm.mem=1;   // 初次应答完成 → 记忆性免疫建立(本局持久): 低载量残留不再复发成峰
  // 初次应答成熟曲线: 检出后 60s 静默期(固有免疫不足以清除对数期病原) → 克隆扩增 60~120s → 效应全量; 免疫抑制钝化动员
  const mat=(0.25+0.75*clamp(((S.imm.seenT||0)-90)/90,0,1))*(1-(S.imm.supp||0)*0.6);
  const actT=detect?mat*clamp(0.75+(tot-0.02)*2.4,0.75,1.5):0;   // 成熟效应: 检出即强应答(峰值后骤降, 不到阈值不解除武装)
  S.imm.act+=(actT-S.imm.act)*Math.min(1,dt/26);
  const hiv=S.pathogens['HIV']?S.pathogens['HIV'].load:0;
  let lymphT=(1+0.55*S.imm.act*clamp(1-hiv*1.8,0,1))*clamp(1-hiv*1.5,0.18,1);   // HIV: 动员功能受损+CD4⁺ 池进行性耗竭
  if(hiv>0.05&&!S._hivNoted){S._hivNoted=true;log('🛡 <b>HIV 感染淋巴细胞(CD4⁺)——进行性免疫耗竭</b>，机会性感染清除能力下降','crit');}
  if(S.ect&&S.ect.spleen)lymphT*=0.8;
  S.imm.lymph+=(clamp(lymphT,0.15,2)-S.imm.lymph)*Math.min(1,dt/40);
  const suppT=hiv>0.02?clamp(0.22+hiv*1.15,0,0.78):((S.ect&&S.ect.spleen)?0.15:0);
  S.imm.supp+=(suppT-S.imm.supp)*Math.min(1,dt/60);
  S.imm.neut+=((1+0.8*S.imm.act)-S.imm.neut)*Math.min(1,dt/20);
  if(tot>0.05&&!S._icNoted){S._icNoted=true;log('🛡 <b>免疫应答启动</b>：淋巴细胞/中性粒细胞动员（清除率 ∝ 免疫强度×(1-免疫抑制)）· 发热为免疫应答产物');}
  if(tot===0)S._icNoted=false;
  // ---- 组织趋向损伤输出(供引擎既有通道消费, 均带 ||0 兜底) ----
  S.pathAirway=clamp(urt*0.14+lrt*0.32,0,0.46);          // 上感黏膜/肺炎性气道水肿 → airwayR↑(哮鸣口径收窄)
  S.pathVent=clamp(lrt*1.25,0,0.98);                     // 肺实质炎症 → 有效通气↓ → SpO₂↓(重症未支持即失代偿)
  S.pathRespFat=clamp(lrt*0.50,0,0.50);                  // 重症肺炎呼吸驱动钝化(通气代偿受限 → SpO₂ 崩落)
  S.pathK=gi>0?clamp(1.95*gi,0,2.2):0;                   // 吐泻失钾 → 低钾
  S.pathSvr=sep>0?clamp(1.15*sep,0,0.95):0;              // 革兰阴性菌播散 → 感染性血管扩张(脓毒症 MAP 崩落)
  const pyroOn=tot>0.02&&((S.imm.act||0)>0.03||(S.imm.seenT||0)>20);   // 致热源: 固有免疫识别(seenT>20)即释放, 不待克隆扩增
  let feverDrive=0;if(pyroOn)for(const k in S.pathogens){const e=S.pathogens[k],L=PATH_LIB[k];if(L)feverDrive+=(e.load/L.cap)*L.pyro;}
  S.pathFever=pyroOn?clamp(feverDrive,0,3.8):0;   // 发热驱动 = Σ(病原负荷分数×per-病原致热源强度)——麻疹 8.0 最高, HIV 1.0 低热  // 致热源: 免疫应答后发热(麻疹/风疹 sys 权重最高)
  S.pathFluid=(gi*0.0028+S.pathFever*0.00035);           // 吐泻失水 + 发热不显性失水 → 血液浓缩(Hb↑)
  S.pathLiver=liv;
  S.pathSepsis=sep;
  if(S.pathFluid>0)S.fluid=clamp(S.fluid-S.pathFluid*dt,0.18,1.6);
  // 高热惊厥(麻疹系 sys 感染≥0.3): 核心>41℃ 持续 → 意识进行性下降(防惊厥=控温)
  if(sysD>0.25&&S.temp>39.6)S.seizT=(S.seizT||0)+dt;else S.seizT=Math.max(0,(S.seizT||0)-dt*0.5);   // 热性惊厥: 系统性病毒血症(麻疹系)+核心>39.6 持续 → 意识进行性下降
  if(lrt>0.30&&S.spo2<90)S.ardsT=(S.ardsT||0)+dt;else S.ardsT=Math.max(0,(S.ardsT||0)-dt*0.5);       // ARDS: 重症肺炎顽固性低氧(未建立呼吸支持)
  if(sep>0.20&&S.map<50)S.shkT=(S.shkT||0)+dt;else S.shkT=Math.max(0,(S.shkT||0)-dt*0.5);           // 脓毒性休克: MAP<50 持续(未液体复苏/血管活性药)
  if((S.seizT||0)>4&&!S._szNoted){S._szNoted=true;log('⚠ <b>高热惊厥风险</b>：核心温度 >41℃ 持续，意识水平下降——立即降温','crit');}
  if((S.seizT||0)<1)S._szNoted=false;
  // ---- 症状状态机: 咳/喷嚏/呕吐事件(音频+粒子同帧) ----
  const sym=S.sym,now=S.t;
  const coughDrive=(urt+lrt)>0.12;
  const sneezeDrive=urt>0.12;
  const vomitDrive=gi>0.12;
  sym.coughT-=dt;
  if(coughDrive&&sym.coughT<=0){
    sym.coughT=6+Math.random()*(lrt>0.3?5:8);            // 下呼吸道更频繁
    sym.coughN++;sym.coughAt=now;sym.coughing=1;
    if(typeof sfx==='function')sfx(sym.flip?'Cough-female':'Cough-male',{gain:.6});
    if(typeof pfxBurst==='function')pfxBurst('cough');
    if(sym.coughN===1||sym.coughN%5===0)log('😷 <b>咳嗽</b>（病原 '+TROP_ZH[(PATH_LIB[pathTop()]||{}).trop||'urt']+'刺激气道 · 飞沫传染源 · 累计 '+sym.coughN+' 次）');
  }
  sym.sneezeT-=dt;
  if(sneezeDrive&&sym.sneezeT<=0){
    sym.sneezeT=9+Math.random()*8;
    sym.sneezeN++;sym.sneezeAt=now;sym.sneezing=1;
    if(typeof sfx==='function')sfx(sym.flip?'Sneeze-female':'Sneeze-male',{gain:.6});
    if(typeof pfxBurst==='function')pfxBurst('sneeze');
    sym.flip=1-sym.flip;
    if(sym.sneezeN===1||sym.sneezeN%6===0)log('💨 <b>喷嚏</b>（上呼吸道刺激 · 高速飞沫播散）');
  }
  if(sym.vomitT<0&&vomitDrive)sym.vomitT=8;               // 首次呕吐在达到阈值后 ~8s
  if(vomitDrive&&sym.vomitT>0){
    sym.vomitT-=dt;
    if(sym.vomitT<=0){
      sym.vomitT=13+Math.random()*11;
      sym.vomitN++;sym.vomitAt=now;sym.vomiting=1;
      S.fluid=clamp(S.fluid-0.030,0.18,1.6);
      if(typeof sfx==='function')sfx(sym.vomitN%2?'Vomit':'Vomit-male',{gain:.65});
      if(typeof pfxBurst==='function')pfxBurst('vomit');
      log('🤮 <b>呕吐</b>（消化道病原刺激 · 体液丢失 → 失水/低钾风险）','crit');
    }
  }else if(!vomitDrive)sym.vomitT=-1;
  sym.coughing=Math.max(0,sym.coughing-dt/2.2);
  sym.sneezing=Math.max(0,sym.sneezing-dt/2.2);
  sym.vomiting=Math.max(0,sym.vomiting-dt/3);
}
// ---- 病理条件键(collectConds 尾部钩子调用) ----
function collectPathConds(add){
  if(!S.pathogens)return;
  const top=pathTop();
  let urt=0,lrt=0,gi=0,sysD=0,liv=0,sep=0,totFrac=0;
  for(const k in S.pathogens){
    const e=S.pathogens[k],L=PATH_LIB[k];if(!L)continue;
    totFrac=Math.max(totFrac,e.dmg);
    if(L.trop==='urt')urt=Math.max(urt,e.dmg);
    if(L.trop==='lrt')lrt=Math.max(lrt,e.dmg);
    if(L.trop==='gi')gi=Math.max(gi,e.dmg);
    if(L.trop==='sys')sysD=Math.max(sysD,e.dmg);
    if(L.trop==='liver')liv=Math.max(liv,e.dmg);
    if(L.sepsis)sep=Math.max(sep,e.dmg);
  }
  if(top&&PATH_LIB[top]&&S.pathogens[top].load>0.10){
    const L=PATH_LIB[top];
    let nm=L.zh+'感染·病原负荷 '+Math.round(totFrac*100)+'%';
    if(top==='MeaslesVIrus'||top==='RubellaVirus')nm=L.zh+'感染·病毒血症·皮疹期(离心性红色斑丘疹)';
    if(top==='HIV')nm='HIV 感染·病毒血症(CD4⁺ 淋巴细胞进行性耗竭)';
    add('ViralInfection',nm,totFrac>0.55);
  }
  if(lrt>0.25)add('LRTI','下呼吸道感染·病毒性肺炎(气道水肿+通气↓)',lrt>0.6);
  if(gi>0.15)add('Gastroenteritis','急性胃肠炎(呕吐/腹泻 → 失水·低钾·Hb 浓缩)',gi>0.5);
  if(liv>0.15)add('LiverInjury','急性肝损伤(凝血因子合成↓·糖异生↓·解毒↓)',liv>0.6);
  if(sep>0.2)add('Sepsis','脓毒症(病原播散·感染性血管扩张性低血压)',sep>0.55);
  if(urt>0.15&&!(lrt>0.25))add('URTI','上呼吸道感染(鼻咽黏膜炎症·咳嗽/喷嚏)',false);
  if((S.imm&&S.imm.supp||0)>0.35)add('Immunosuppressed','免疫抑制(淋巴细胞耗竭·机会性感染风险)',false);
  const sym=S.sym;
  if(sym&&sym.coughing>0)add('Coughing','咳嗽中(飞沫传染源·疾病传播载体)',false);
  if(sym&&sym.sneezing>0)add('Sneezing','喷嚏中(高速飞沫播散)',false);
  if(sym&&sym.vomiting>0)add('Vomiting','呕吐中(体液/电解质丢失)',false);
}
// ---- 诊断目录/图标映射注册(DIAG_LIB·ICON_LIB 运行期挂载) ----
if(typeof DIAG_LIB!=='undefined'){
  Object.assign(DIAG_LIB,{
    ViralInfection:{n:'病毒感染(病原血症)',g:'',m:'病原体接种后指数复制,经组织趋向播散;免疫应答(淋巴细胞/中性粒细胞动员)产生致热源→发热,清除率 ∝ 免疫强度×(1-免疫抑制)。',a:'游戏治疗哲学=支持疗法:退热(对乙酰氨基酚/物理降温)、补液、氧疗;免疫球蛋白(新增非原生制剂)提供被动免疫支持提升清除率;免疫低下者(ponents HIV/脾切除)清除 slower——防机会性感染。'},
    LRTI:{n:'下呼吸道感染(病毒性肺炎)',g:'',m:'肺实质炎症:气道水肿(airwayR↑)+通气-血流失衡 → SpO₂ 下降、呼吸驱动代偿受限;重症需呼吸支持。',a:'氧疗:高流量吸氧;重症机械通气(FiO₂+PEEP 肺泡复张);退热;哮鸣可闻时 β2 激动剂缓解气道痉挛——等待免疫清除,无抗病毒药。'},
    URTI:{n:'上呼吸道感染',g:'',m:'鼻咽黏膜炎症:咳嗽/喷嚏为飞沫排出机制(传染载体);自限性病程,免疫清除后症状消退。',a:'对症:镇咳/退热;飞沫隔离(口罩)阻断传播;无需特异性治疗。'},
    Gastroenteritis:{n:'急性胃肠炎(吐泻)',g:'',m:'肠黏膜炎症→分泌性腹泻+呕吐:大量等渗液丢失 → 低血容量、Hb 浓缩、失钾(低钾血症)。',a:'核心=补液:口服补液(水/电解质)或静脉补液,目标纠正浓缩与血钾;吐泻期自限,支持度过免疫清除期。'},
    LiverInjury:{n:'急性肝损伤(肝炎)',g:'',m:'肝细胞损伤:凝血因子合成↓(出血倾向)、糖异生↓(低血糖倾向)、解毒能力↓(代谢性酸中毒倾向)。',a:'支持疗法:维持血糖(葡萄糖供给)、监测凝血,避免肝毒性药物;甲肝多为自限性,免疫清除后肝功能恢复。'},
    Sepsis:{n:'脓毒症(感染性)',g:'',m:'病原播散入血:内毒素样效应 → 血管扩张性低血压(SVR↓)+高热+多器官灌注不足。',a:'器官支持:液体复苏+血管活性药(去甲肾上腺素)维持 MAP≥65;免疫球蛋白(新增非原生)被动免疫助清除;纠正电解质(补钾);体温管理。'},
    ImmunOsuppressed:{n:'免疫抑制(淋巴细胞耗竭)',g:'',m:'HIV 感染淋巴细胞:CD4⁺ 池进行性耗竭 → 病原清除率下降、机会性感染复制加速,轻症病原体亦可致重症。',a:'免疫球蛋白被动支持;严格防机会性感染;病原接种后需更积极的支持疗法与更长观察期。'},
    Immunosuppressed:{n:'免疫抑制(淋巴细胞耗竭)',g:'',m:'HIV 感染淋巴细胞:CD4⁺ 池进行性耗竭 → 病原清除率下降、机会性感染复制加速,轻症病原体亦可致重症。',a:'免疫球蛋白被动支持;严格防机会性感染;病原接种后需更积极的支持疗法与更长观察期。'},
    Coughing:{n:'咳嗽(进行中)',g:'',m:'气流高速冲出携带病原飞沫——呼吸道传染病核心传播机制(可视化为口鼻锥形白色粒子团)。',a:'飞沫隔离;对症镇咳(右美沙芬 Dextromethorphan);治疗 underlying 感染靠免疫清除。'},
    Sneezing:{n:'喷嚏(进行中)',g:'',m:'上呼吸道刺激反射:气流>30m/s 播散飞沫核——传染性气溶胶主要来源。',a:'飞沫隔离(口罩/负压);对症处理鼻咽刺激源。'},
    Vomiting:{n:'呕吐(进行中)',g:'ConditionType Vomitting(病理键对齐既有枚举)',m:'消化道病原刺激呕吐中枢/胃黏膜→胃内容物排出:体液与电解质急性丢失。',a:'停止经口进食、防误吸;少量多次补液;频发时止吐(组胺 H1/D2 类,本引擎 Diphenhydramine 可用)。'}
  });
}
if(typeof ICON_MAP!=='undefined')Object.assign(ICON_MAP,{ViralInfection:'Infect',LRTI:'Apnea',URTI:'Inflame',Gastroenteritis:'Pain',LiverInjury:'Pain',Sepsis:'Fright',Immunosuppressed:'Infect',ImmunOsuppressed:'Infect',Coughing:'Infect',Sneezing:'Infect',Vomiting:'Pain'});
// ---- Hb 浓缩系数(化验 hb 显示 = 实际 Hb × 浓缩因子: 脱水浓缩/补液稀释可逆) ----
function hbConcentration(){return clamp(Math.sqrt(1/clamp(S&&S.fluid||1,0.2,1.6)),0.75,1.36);}
// ================= 病理粒子特效层 PFX(经典脚本纯数据状态机 → window.PFX → three.js 模块渲染) =================
// 设计沿用 VFX: 粒子={k 类型,p 位置,v 速度,a 年龄,l 寿命,c 颜色,s 尺寸,o 不透明度} 纯数据数组;
//   MAX 硬上限防性能; 浅色主题器官色系半透明; 渲染端单 THREE.Points + 自定义 shader(逐粒子 alpha)。
// 可测采样口: window.PFX.params —— bleed{n,rate} / wheeze{active,width,n} / burst{type,n,t,count} /
//   infection{target,pathogenN,immuneN,ratio} / fever{active,n} + PFX.parts(位置可数值断言)。
var PFX={
  MAX:2600,parts:[],
  anchors:{heart:[0.02,0.18,0],airway:[0,0.34,0],airwayAxis:[0,-1,0],mouth:[0,0.46,0.07],
           stomach:[-0.05,0.06,0.02],lung:[0.06,0.22,0],liver:[-0.07,0.14,0],spleen:[0.06,0.03,0]},
  anchorReal:false,
  params:{bleed:{n:0,rate:0},wheeze:{active:false,width:0,n:0},burst:{type:'',n:0,t:-99,count:0},
          infection:{target:'',pathogenN:0,immuneN:0,ratio:0},fever:{active:false,n:0}},
  burstLog:[],lastCprComp:-1,frameN:0,fps:0,fpsJit:0
};
function pfxSetAnchors(map){if(!map)return;for(const k in map)if(map[k])PFX.anchors[k]=map[k];PFX.anchorReal=true;}
if(typeof window!=='undefined')window.PFX=PFX;
function pfxReset(){PFX.parts.length=0;PFX.params={bleed:{n:0,rate:0},wheeze:{active:false,width:0,n:0},burst:{type:'',n:0,t:-99,count:0},infection:{target:'',pathogenN:0,immuneN:0,ratio:0},fever:{active:false,n:0}};PFX.burstLog.length=0;PFX.lastCprComp=-1;}
function pfxSpawn(k,p,v,life,c,size,alpha,extra){
  if(PFX.parts.length>=PFX.MAX)return null;
  const q={k:k,p:[p[0],p[1],p[2]],v:[v[0],v[1],v[2]],a:0,l:life,c:c,s:size,o:alpha};
  if(extra)for(const x in extra)q[x]=extra[x];
  PFX.parts.push(q);return q;
}
// 咳嗽/喷嚏/呕吐爆发: 口鼻方向锥形粒子团(疾病传染机制的视觉载体), n=30~60
function pfxBurst(type){
  const m=PFX.anchors.mouth;
  let n,dir,spread,spd,life,col,sz,g;
  if(type==='cough'||type==='sneeze'){
    n=30+Math.floor(Math.random()*31);
    dir=[0.06,type==='sneeze'?0.28:0.16,1];
    spread=type==='sneeze'?0.52:0.38;
    spd=type==='sneeze'?0.34:0.30;
    life=[1.1,1.7];col=[0.92,0.94,0.97];sz=0.011;g=0.22;
  }else{                                    // vomit: 上消化道涌出
    n=42+Math.floor(Math.random()*28);
    dir=[0.12,0.62,0.55];
    spread=0.42;spd=0.34;life=[1.4,2.1];col=[0.76,0.71,0.30];sz=0.014;g=0.85;
  }
  const dl=Math.hypot(dir[0],dir[1],dir[2]);dir=[dir[0]/dl,dir[1]/dl,dir[2]/dl];
  for(let i=0;i<n;i++){
    const th=Math.random()*Math.PI*2,ph=Math.random()*spread;
    const u=Math.cos(th)*Math.sin(ph),w=Math.sin(th)*Math.sin(ph),y=Math.cos(ph);
    const sp=spd*(0.7+Math.random()*0.6);
    const org=type==='vomit'?PFX.anchors.stomach:m;
    pfxSpawn(type,[org[0]+(Math.random()-.5)*0.02,org[1],org[2]],
      [dir[0]*sp+u*sp*0.6,dir[1]*sp+y*sp*0.45,dir[2]*sp+w*sp*0.6],
      life[0]+Math.random()*(life[1]-life[0]),col,sz,0.62,{g:g,drag:0.55});
  }
  PFX.params.burst={type:type,n:n,t:S.t,count:PFX.params.burst.count+1};
  PFX.burstLog.push({type:type,n:n,t:S.t});
  if(PFX.burstLog.length>40)PFX.burstLog.shift();
  return n;
}
// 出血飞溅: 心脏区域喷发(初速球面扇形+重力下坠+地面消失), 流量随失血速率
function pfxEmitBleed(n,rate){
  const h=PFX.anchors.heart;
  for(let i=0;i<n;i++){
    const th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*0.62;   // 偏上球面扇形
    const sp=0.24+Math.random()*0.34;
    pfxSpawn('bleed',[h[0]+(Math.random()-.5)*0.03,h[1]+(Math.random()-.5)*0.03,h[2]+(Math.random()-.5)*0.03],
      [Math.cos(th)*Math.sin(ph)*sp,Math.cos(ph)*sp*0.9+0.10,Math.sin(th)*Math.sin(ph)*sp],
      2.6,[0.80,0.13,0.16],0.013,0.62,{g:1.1,drag:0.06});
  }
  if(rate)S.bleedPulse=Math.max(S.bleedPulse||0,rate);
}
// 出血流量(0..1): 事件脉冲(放血/外伤) + 活动性出血状态(重度贫血+低容量)
function pfxBleedRate(){
  let r=S.bleedPulse||0;
  if((S.hb||15)<7.5&&S.fluid<0.86)r=Math.max(r,0.5);   // 外伤/消化道活动性出血状态
  return r;
}
const PFX_FLOOR=-0.52;
// 感染灶目标锚点(按组织趋向)
function pfxTropAnchor(trop,sepsis){
  const A=PFX.anchors;
  if(sepsis)return A.heart;   // 菌血症心腔播散灶
  return trop==='urt'?A.airway:trop==='lrt'?A.lung:trop==='gi'?A.stomach:
         trop==='liver'?A.liver:trop==='sys'?A.heart:A.heart;
}
// PFX 状态机主步进(由引擎 tick 每步驱动; 无渲染端也可在 Node 数值断言)
function pfxStep(dt){
  S.bleedPulse=Math.max(0,(S.bleedPulse||0)-dt*0.16);
  const A=PFX.anchors;
  // ---- 出血发射器 ----
  const br=pfxBleedRate();
  PFX.params.bleed.rate=br;
  if(br>0.02){
    const emit=Math.min(14,br*26)*dt;
    let n=Math.floor(emit)+(Math.random()<emit%1?1:0);
    while(n-->0&&PFX.parts.length<PFX.MAX){
      const h=A.heart,th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI*0.62;
      const sp=0.22+Math.random()*0.30;
      pfxSpawn('bleed',[h[0]+(Math.random()-.5)*0.03,h[1]+(Math.random()-.5)*0.03,h[2]+(Math.random()-.5)*0.03],
        [Math.cos(th)*Math.sin(ph)*sp,Math.cos(ph)*sp*0.9+0.08,Math.sin(th)*Math.sin(ph)*sp],
        2.6,[0.80,0.13,0.16],0.013,0.62,{g:1.1,drag:0.06});
    }
  }
  // CPR 按压血涌: 按压上升相且存在出血流 → 每次按压涌出小股
  const cprC=(S.cpr&&(S.rhythm==='arrest'||S.rhythm==='vf'))?(Math.sin(S.t*Math.PI*2*1.9)*0.5+0.5):0;
  if(br>0.15&&cprC>0.5&&PFX.lastCprComp<=0.5&&PFX.parts.length<PFX.MAX-8){
    pfxEmitBleed(7,0);
  }
  PFX.lastCprComp=cprC;
  // ---- 哮鸣环带发射器: 气道阻力↑(哮喘/肺炎性水肿) → 气道节点周围青色环状粒子沿轴线缓流, 口径收窄宽度变窄 ----
  const wheezeOn=(S.airwayR>1.06&&!S.dead);
  const wWidth=wheezeOn?clamp(0.30*(1-(S.airwayR-1.0)/0.65),0.035,0.30):0;   // 口径显著收窄(R=1.65)时帯宽→0.035 最窄
  PFX.params.wheeze.active=wheezeOn;PFX.params.wheeze.width=wWidth;
  let wN=0;
  if(wheezeOn){
    const want=54;
    for(const q of PFX.parts)if(q.k==='wheeze')wN++;
    let spawn=want-wN;
    while(spawn-->0&&PFX.parts.length<PFX.MAX)
      pfxSpawn('wheeze',[0,-9,0],[0,0,0],7,[0.16,0.66,0.78],0.010,0.55,{ang:Math.random()*Math.PI*2,off:Math.random()*0.24,rad:0});
  }
  // ---- 发热汗雾(可选): 体表微弱暖色升腾 ----
  const feverOn=S.temp>38.6&&!S.dead;
  PFX.params.fever.active=feverOn;
  if(feverOn){
    const rate=Math.min(11,(S.temp-38.6)*7);
    const emit=rate*dt;let n=Math.floor(emit)+(Math.random()<emit%1?1:0);
    while(n-->0&&PFX.parts.length<PFX.MAX){
      const base=Math.random()<0.5?A.lung:A.stomach;
      pfxSpawn('sweat',[base[0]+(Math.random()-.5)*0.30,base[1]+(Math.random()-.5)*0.12,base[2]+0.05],
        [(Math.random()-.5)*0.012,0.028+Math.random()*0.015,(Math.random()-.5)*0.012],
        2.4+Math.random()*1.6,[0.96,0.72,0.42],0.008,0.20,{g:-0.004});
    }
  }
  // ---- 感染灶: 病原粒子云(病毒色) + 免疫粒子(白色小点)向感染灶趋化聚集 ----
  const top=pathTop();
  let pN=0,iN=0;
  const topLoad=top?(S.pathogens[top].load||0):0;
  const cloudOn=!!(top&&PATH_LIB[top]&&(topLoad>0.08||((S.imm.act||0)>0.2&&topLoad>0.03)));   // 感染灶云迟滞: 免疫动员期降至 3% 才熄灭(可视化清除战役全程)
  if(cloudOn){
    const L=PATH_LIB[top],frac=S.pathogens[top].dmg;
    const focus=pfxTropAnchor(L.trop,L.sepsis);
    const pT=Math.round(18+170*frac);   // 病原云密度(感染灶粒子随负荷)
    const iT=Math.round(clamp(S.imm.act*S.imm.act*S.imm.lymph*820*(1+(S.blood['ImmunGlobulin']||0)*0.4),0,1100));   // 免疫粒子数 ∝ act²(早期劣势→动员后克隆扩增反超, 比例反转=免疫胜利视觉)
    for(let i=PFX.parts.length-1;i>=0;i--){const q=PFX.parts[i];
      if(q.k==='patho'){pN++;if(pN>pT){PFX.parts.splice(i,1);pN--;}}
      else if(q.k==='immune'){iN++;if(iN>iT){PFX.parts.splice(i,1);iN--;}}}
    while(pN<pT&&PFX.parts.length<PFX.MAX){
      const th=Math.random()*Math.PI*2,ph=Math.random()*Math.PI;
      const rr=0.05+Math.random()*0.09;
      pfxSpawn('patho',[focus[0]+Math.cos(th)*Math.sin(ph)*rr,focus[1]+Math.cos(ph)*rr,focus[2]+Math.sin(th)*Math.sin(ph)*rr],
        [0,0,0],3+Math.random()*3,L.col,0.011,0.55,{mo:1});
      pN++;
    }
    while(iN<iT&&PFX.parts.length<PFX.MAX){
      const src=A.spleen;   // 淋巴起源
      pfxSpawn('immune',[src[0]+(Math.random()-.5)*0.22,src[1]+(Math.random()-.5)*0.18,src[2]+(Math.random()-.5)*0.18],
        [0,0,0],4+Math.random()*4,[0.95,0.96,1.0],0.007,0.80,{tgt:[focus[0],focus[1],focus[2]]});
      iN++;
    }
    PFX.params.infection={target:L.zh+'→'+(TROP_ZH[L.trop]||L.trop),pathogenN:pN,immuneN:iN,
      ratio:iN/Math.max(1,pN)};
  }else PFX.params.infection={target:'',pathogenN:0,immuneN:0,ratio:0};
  // ---- 积分器: 位置/速度/年龄/寿命; 类型特化(重力/阻力/趋化/环形) ----
  for(let i=PFX.parts.length-1;i>=0;i--){
    const q=PFX.parts[i];
    q.a+=dt;
    let kill=q.a>q.l;
    if(!kill){
      if(q.k==='bleed'||q.k==='vomit'||q.k==='cough'||q.k==='sneeze'){
        q.v[1]-=(q.g||0)*dt;
        if(q.drag){q.v[0]*=Math.exp(-q.drag*dt);q.v[2]*=Math.exp(-q.drag*dt);}
        q.p[0]+=q.v[0]*dt;q.p[1]+=q.v[1]*dt;q.p[2]+=q.v[2]*dt;
        if(q.p[1]<PFX_FLOOR)kill=true;
      }else if(q.k==='wheeze'){
        q.off=(q.off||0)+0.016*dt;
        if(q.off>0.26)q.off=0;
        const rr=wWidth*(0.85+0.3*Math.sin(q.a*3+q.ang));
        const ax=A.airway;
        q.p=[ax[0]+Math.cos(q.ang)*rr,ax[1]+(A.airwayAxis[1])*q.off,ax[2]+Math.sin(q.ang)*rr];
      }else if(q.k==='sweat'){
        q.v[1]-=(q.g||0)*dt;
        q.p[0]+=q.v[0]*dt;q.p[1]+=q.v[1]*dt;q.p[2]+=q.v[2]*dt;
        q.o=0.2*Math.max(0,1-q.a/q.l);
      }else if(q.k==='patho'){
        q.p[0]+=(Math.random()-.5)*0.0035;q.p[1]+=(Math.random()-.5)*0.0035;q.p[2]+=(Math.random()-.5)*0.0035;  // 病灶内布朗游走
      }else if(q.k==='immune'){
        const t=q.tgt,sp=0.055;
        let dx=t[0]-q.p[0],dy=t[1]-q.p[1],dz=t[2]-q.p[2];
        const dl=Math.hypot(dx,dy,dz)||1;
        if(dl>0.055){const m=sp*dt/dl;q.p[0]+=dx*m+((Math.random()-.5)*0.002);q.p[1]+=dy*m+((Math.random()-.5)*0.002);q.p[2]+=dz*m+((Math.random()-.5)*0.002);}   // 趋化(chemotaxis)
        else{q.p[0]+=(Math.random()-.5)*0.001;q.p[1]+=(Math.random()-.5)*0.001;q.p[2]+=(Math.random()-.5)*0.001;}
      }
    }
    if(kill)PFX.parts.splice(i,1);
  }
  // ---- 计数参数(采样口) ----
  PFX.params.bleed.n=PFX.parts.reduce((n,q)=>n+(q.k==='bleed'),0);
  let wn=0,fn=0;for(const q of PFX.parts){if(q.k==='wheeze')wn++;else if(q.k==='sweat')fn++;}
  PFX.params.wheeze.n=wn;PFX.params.fever.n=fn;
  if(cloudOn){let pn=0,inn=0;
    for(const q of PFX.parts){if(q.k==='patho')pn++;else if(q.k==='immune')inn++;}
    PFX.params.infection.pathogenN=pn;PFX.params.infection.immuneN=inn;PFX.params.infection.ratio=inn/Math.max(1,pn);}
  PFX.frameN++;
}
// ================= 给药面板注册: 病原体组(CellType 全病原 20 种) + 免疫支持组(免疫球蛋白·新增非原生制剂) =================
if(typeof PHARM!=='undefined'&&!PHARM.ImmunGlobulin)PHARM.ImmunGlobulin={d:{long:1}};   // t½ 1800s(被动免疫持续)
function patientRegisterPathogens(){
  const sel=(typeof document!=='undefined')?document.getElementById('chemSel'):null;
  if(!sel)return;
  const mk=(label,entries)=>{const g=document.createElement('optgroup');g.label=label;
    entries.forEach(([v,txt])=>{const o=document.createElement('option');o.value=v;o.textContent=txt;g.appendChild(o);});sel.appendChild(g);};
  const VIRUS=Object.keys(PATH_LIB).filter(k=>PATH_LIB[k].kind==='virus');
  const BACT=Object.keys(PATH_LIB).filter(k=>PATH_LIB[k].kind==='bacterium');
  mk('病原体接种·病毒（CellType '+VIRUS.length+' 种·剂量=接种量）',VIRUS.map(k=>[k,'🦠 '+PATH_LIB[k].zh+'（'+k+'）·'+TROP_ZH[PATH_LIB[k].trop]]));
  mk('病原体接种·细菌（CellType '+BACT.length+' 种）',BACT.map(k=>[k,'🧫 '+PATH_LIB[k].zh+'（'+k+'）·'+TROP_ZH[PATH_LIB[k].trop]]));
  mk('免疫支持（新增制剂）',[['ImmunGlobulin','🧪 免疫球蛋白（ImmunGlobulin）·被动免疫支持——免疫支持疗法;不属抗病毒药']]);
}

// ================= 阶段6 新病例 17~22(全部可玩赢: 支持疗法+时机; 胜利路径入断言) =================
CASES.push(
 {id:'cov19',name:'新冠重症肺炎',diff:5,limit:600,
  desc:'冠状病毒高剂量接种→下呼吸道:肺实质炎症(气道水肿+通气↓)→SpO₂ 崩落+高热。无抗病毒药——氧疗+机械通气(FiO₂/PEEP 肺泡复张)+退热撑过免疫清除期。',
  apply:function(){pathInoculate('Coronavirus',26);S.pathogens['Coronavirus'].load=0.52;S.imm.act=0.05;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):((S.ardsT||0)>60?('ARDS 顽固性低氧：SpO₂<90% 持续 '+Math.round(S.ardsT)+'s——未及早建立氧疗/机械通气(PEEP 肺泡复张)'):null);},
  goals:[
    {txt:'呼吸支持达标: SpO₂ ≥93% 维持 90s',hold:90,test:function(){return pathPeaked('Coronavirus')&&S.spo2>=93;}},
    {txt:'退热: 体温 ≤38.5℃ 维持 15s',hold:15,test:function(){return pathPeaked('Coronavirus')&&S.temp<=38.5;}},
    {txt:'病毒清除: 冠状病毒负荷 <10%(峰值后)',hold:10,test:function(){return pathPeaked('Coronavirus')&&pathFrac('Coronavirus')<0.10;}}]},
 {id:'flu',name:'流感居家',diff:2,limit:520,
  desc:'流感病毒中等剂量→高热+咳嗽(飞沫)。居家处置:退热+补水(发热不显失水→Hb 浓缩可经化验见)。免疫自然清除,熬过感染期即胜利。',
  apply:function(){pathInoculate('Influenza',18);},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):null;},
  goals:[
    {txt:'退热: 体温 <38.5℃ 维持 15s',hold:15,test:function(){return pathPeaked('Influenza')&&S.temp<38.5;}},
    {txt:'补水纠正浓缩: 血容量恢复(fluid≥0.95)且 Hb ≤16',hold:10,test:function(){return pathPeaked('Influenza')&&S.fluid>=0.95&&labValues().hb<=16;}},
    {txt:'熬过感染期: 流感病毒负荷 <10%(峰值后)',hold:10,test:function(){return pathPeaked('Influenza')&&pathFrac('Influenza')<0.10;}}]},
 {id:'gastro',name:'急性胃肠炎',diff:3,limit:520,
  desc:'诺如病毒→呕吐/腹泻风暴:体液大量丢失→血液浓缩+失钾(低钾血症)+低血容量。没有人死于诺如——但会死于不补液。口服/静脉补液+补钾度过后程。',
  apply:function(){pathInoculate('Norovirus',14);S.fluid=0.96;S.k=4.0;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause+'——死于脱水/电解质紊乱而非病毒本身'):null;},
  goals:[
    {txt:'血容量恢复: fluid ≥0.93 维持 10s',hold:10,test:function(){return pathPeaked('Norovirus')&&S.fluid>=0.93;}},
    {txt:'血钾纠正: 3.5~5.2 mmol/L',hold:10,test:function(){return pathPeaked('Norovirus')&&S.k>=3.5&&S.k<=5.2;}},
    {txt:'病毒清除: 诺如病毒负荷 <10%(峰值后)',hold:10,test:function(){return pathPeaked('Norovirus')&&pathFrac('Norovirus')<0.10;}}]},
 {id:'hivadeno',name:'免疫防线',diff:4,limit:600,
  desc:'HIV 慢性期(CD4⁺ 耗竭·免疫低下 preset)接种腺病毒——本是轻症自限病毒,对免疫低下者却可致命。免疫球蛋白(被动免疫·新增非原生制剂)+支持撑过病毒峰。',
  apply:function(){S.pathogens['HIV']={load:0.42,tropism:'sys',dmg:0.84};S.imm.supp=0.72;S.imm.lymph=0.35;pathInoculate('Adenovirus',15);S.temp=37.2;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):null;},
  goals:[
    {txt:'被动免疫支持: 免疫球蛋白给药(血浓度>0.2)',hold:5,test:function(){return (S.blood['ImmunGlobulin']||0)>0.2;}},
    {txt:'控制病毒峰: 体温 ≤38.5℃ 维持 15s',hold:15,test:function(){return pathPeaked('Adenovirus')&&S.temp<=38.5;}},
    {txt:'机会性感染清除: 腺病毒负荷 <10%(峰值后)',hold:10,test:function(){return pathPeaked('Adenovirus')&&pathFrac('Adenovirus')<0.10;}}]},
 {id:'measles',name:'麻疹高热',diff:4,limit:600,
  desc:'麻疹病毒→超高热(可达 40.5℃)+病毒血症皮疹期。核心>41℃ 持续将触发热性惊厥(意识崩落判负)。物理降温+退热药压住温度曲线,保护中枢直至免疫清除。',
  apply:function(){pathInoculate('MeaslesVIrus',16);S.temp=38.4;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):(S.gcs<9?('热性惊厥：核心温度 '+S.temp.toFixed(1)+'℃ 持续→意识崩落(GCS '+Math.round(S.gcs)+')'):null);},
  goals:[
    {txt:'压住温度曲线: 核心 ≤39.5℃ 维持 15s',hold:15,test:function(){return pathPeaked('MeaslesVIrus')&&S.temp<=39.5;}},
    {txt:'中枢保护: GCS ≥12 持续',hold:20,test:function(){return pathPeaked('MeaslesVIrus')&&S.gcs>=12;}},
    {txt:'免疫清除: 麻疹病毒负荷 <10%(峰值后)',hold:10,test:function(){return pathPeaked('MeaslesVIrus')&&pathFrac('MeaslesVIrus')<0.10;}}]},
 {id:'sepsis',name:'混合感染·脓毒症',diff:5,limit:540,
  desc:'大肠杆菌播散入血:感染性血管扩张性低血压(MAP 崩)+高热+吐泻失钾(K⁺ 2.9)。当前时代无抗生素可用——液体复苏+去甲肾上腺素+被动免疫+补钾的器官支持组合拳。',
  apply:function(){pathInoculate('EColi',18);S.pathogens['EColi'].load=0.55;S.k=2.9;S.imm.act=0.1;},
  failIf:function(){return S.dead?('患者死亡：'+S.deathCause):((S.shkT||0)>90?('脓毒性休克失代偿：MAP<50 持续 '+Math.round(S.shkT)+'s——未液体复苏+血管活性药维持灌注'):null);},
  goals:[
    {txt:'灌注恢复: MAP ≥65 mmHg 维持 20s',hold:20,test:function(){return pathPeaked('EColi')&&S.map>=65;}},
    {txt:'体温 ≤38.5℃ 维持 10s',hold:10,test:function(){return pathPeaked('EColi')&&S.temp<=38.5;}},
    {txt:'血钾纠正: 3.5~5.2 mmol/L',hold:10,test:function(){return pathPeaked('EColi')&&S.k>=3.5&&S.k<=5.2;}},
    {txt:'病原清除: 大肠杆菌负荷 <10%(峰值后)',hold:10,test:function(){return pathPeaked('EColi')&&pathFrac('EColi')<0.10;}}]}
);


// ================= 移植层: 页面生命周期 =================
// engine init 与 intervals 由 mount/unmount 管理; 重复 mount(离开页面再回来)时
// 引擎状态 S 保留, 只重建 UI(selects/波形扫掠)与定时器
window.PatientSim = {
  booted: false,
  timers: [],
  mount: function () {
    this.unmount();
    patientEngineInit();
    this.booted = true;
    var last = performance.now();
    var alive = function () { return !!document.getElementById('patient-root'); };
    this.timers.push(setInterval(function () { if (!alive()) return; var now = performance.now(); var dt = Math.min(.5, (now - last) / 1000); last = now; tick(dt); }, 250));
    this.timers.push(setInterval(function () { if (!alive()) return; waveFrame(0.05); }, 50));
    this.timers.push(setInterval(function () { if (!alive()) return; uiFrame(); }, 300));
  },
  unmount: function () {
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (window.PatientViewer && PatientViewer.unmount) PatientViewer.unmount();
  }
};
window.PatientSim_resizeGuard = window.PatientSim_resizeGuard || window.addEventListener('resize', function(){ try { ecgSw && ecgSw.resize(); plSw && plSw.resize(); co2Sw && co2Sw.resize(); } catch (e) {} });
/* ================= 移植层: 3D 全身器官视图(window.PatientViewer) =================
 * 原单页版为独立的 importmap module(three + GLTF/DRACO + OrbitControls); 本站
 * 复用虚拟细胞页的 vendor 内核 window.CellViewer —— 与 hum GLB(body.glb, Draco
 * 压缩)与表现层(心搏/呼吸缩放 · 脑 GCS 变暗 · PFX 病理粒子)一起由 mount/unmount
 * 全生命周期管理, 离开页面即停 rAF 与释放 WebGL 上下文。
 * 器官联动数据: window.simSnapshot() 引擎快照; ORGANS/BW/SPREAD 与器官选择条
 * 归引擎(经典脚本全局), 视图只消费。 */
window.PatientViewer = (function () {
  var v = null;  // 挂载态: {cv,renderer,scene,camera,controls,organs,raf,idleT,lastW,H,clock}

  function unmount() {
    if (!v) return;
    cancelAnimationFrame(v.raf);
    try {
      if (v.scene) {
        v.scene.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
            Object.keys(m).forEach(function (k) { var x = m[k]; if (x && x.isTexture) x.dispose(); });
            m.dispose();
          });
        });
      }
    } catch (e) {}
    try { v.controls && v.controls.dispose(); } catch (e) {}
    try { v.renderer.dispose(); v.renderer.forceContextLoss && v.renderer.forceContextLoss(); } catch (e) {}
    v = null;
    window.__ORG = null;
  }

  function mount(canvasEl) {
    unmount();
    var CV = window.CellViewer;
    if (!CV || !canvasEl) return;
    var THREE = CV.THREE;
    var cv = canvasEl;
    var renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(28, 1, 0.02, 50);
    camera.position.set(0.4, 0.3, 3.0);
    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new CV.RoomEnvironment(), 0.05).texture;
    var key = new THREE.DirectionalLight(0xffffff, 1.9);
    key.position.set(1.5, 2.5, 2.0); scene.add(key);
    var fill = new THREE.DirectionalLight(0xdfeaff, 0.75);
    fill.position.set(-2, -1, -1.5); scene.add(fill);
    var controls = new CV.OrbitControls(camera, cv);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    controls.minDistance = 1.1; controls.maxDistance = 7;
    controls.autoRotate = true; controls.autoRotateSpeed = 1.1;
    var idleT = 0;
    cv.addEventListener('pointerdown', function () { idleT = 0; controls.autoRotate = false; });
    cv.addEventListener('wheel', function () { idleT = 0; controls.autoRotate = false; }, { passive: true });

    var draco = new CV.DRACOLoader();
    // decoder vendor 与虚拟细胞页共用(js/vendor/draco, build 后 dist/vendor/draco)
    draco.setDecoderPath('vendor/draco/');
    var loader = new CV.GLTFLoader();
    loader.setDRACOLoader(draco);

    var organs = {};
    var BODY_C = new THREE.Vector3(0, -0.08, 0);

    loader.load('patient/models/body.glb', function (g) {
      if (!v) { return; }  // 载入期间页面已卸载
      scene.add(g.scene);
      for (var ni = 0; ni < g.scene.children.length; ni++) {
        var node = g.scene.children[ni];
        var id = node.name;
        var mats = [];
        (function collect(ob) {
          for (var ci = 0; ci < ob.children.length; ci++) collect(ob.children[ci]);
          if (ob.isMesh) {
            ob.material = ob.material.clone();
            ob.material.userData.base = ob.material.color.clone();
            mats.push(ob.material);
          }
        })(node);
        organs[id] = {
          node: node, mats: mats,
          anim: (node.userData && node.userData.anim) || '',
          home: node.position.clone(),
          zh: (node.name === 'airway' ? '支气管' : (node.userData && node.userData.zh) || id),
          homeScale: node.scale.clone(),
          id: id
        };
      }
      window.__ORG = organs;
      ORGANS = []; ORGANS = Object.keys(organs).map(function (id2) {
        var o = organs[id2];
        var base = o.mats.length ? o.mats[0].userData.base : null;
        var col;
        if (id2 === 'vein') col = [0.18, 0.31, 0.71];
        else if (id2 === 'artery') col = [0.87, 0.17, 0.14];
        else if (id2 === 'lungL' || id2 === 'lungR') col = [0.79, 0.42, 0.45];
        else if (id2 === 'kidneyL' || id2 === 'kidneyR') col = [0.45, 0.26, 0.31];
        else if (base) col = [base.r, base.g, base.b];
        else col = [0.7, 0.4, 0.4];
        return { id: id2, zh: o.zh, anim: o.anim, color: col };
      });
      renderOrganStrip();
      // PFX 锚点注册(渲染真实器官坐标 → 粒子状态机)
      if (typeof pfxSetAnchors === 'function') {
        var pos = function (id3) { var o = organs[id3]; return o ? [o.node.position.x, o.node.position.y, o.node.position.z] : null; };
        var mid = function (a, b) { return (a && b) ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : (a || b); };
        var air = pos('airway'), lung = mid(pos('lungL'), pos('lungR'));
        pfxSetAnchors({
          heart: pos('heart'), airway: air, lung: lung, stomach: pos('stomach'),
          liver: pos('liver'), spleen: pos('spleen'),
          mouth: air ? [air[0], air[1] + 0.10, air[2] + 0.05] : pos('brain')
        });
      }
    }, undefined, function (err) { console.warn('GLB load fail', err); });

    // ---- PFX 粒子渲染层(单 THREE.Points 自定义 shader 批量绘制) ----
    var PMAX = (window.PFX) ? PFX.MAX : 2600;
    var pfxGeo = new THREE.BufferGeometry();
    var pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pAlp = new Float32Array(PMAX), pSiz = new Float32Array(PMAX);
    pfxGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pfxGeo.setAttribute('aCol', new THREE.BufferAttribute(pCol, 3));
    pfxGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlp, 1));
    pfxGeo.setAttribute('aSize', new THREE.BufferAttribute(pSiz, 1));
    var pfxMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute vec3 aCol;attribute float aAlpha;attribute float aSize;varying vec3 vC;varying float vA;void main(){vC=aCol;vA=aAlpha;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=aSize*(300.0/-mv.z);gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-vec2(0.5));float a=smoothstep(0.5,0.12,d)*vA;if(a<0.012)discard;gl_FragColor=vec4(vC,a);}'
    });
    var pfxPts = new THREE.Points(pfxGeo, pfxMat); pfxPts.frustumCulled = false; scene.add(pfxPts);
    function pfxRenderTick() {
      var P = window.PFX;
      if (!P) return;
      var parts = P.parts, n = 0;
      for (var i = 0; i < parts.length && n < PMAX; i++) {
        var q = parts[i];
        pPos[n * 3] = q.p[0]; pPos[n * 3 + 1] = q.p[1]; pPos[n * 3 + 2] = q.p[2];
        pCol[n * 3] = q.c[0]; pCol[n * 3 + 1] = q.c[1]; pCol[n * 3 + 2] = q.c[2];
        var fade = (q.k === 'patho') ? (0.55 + 0.45 * Math.abs(Math.sin(q.a * 4))) : ((q.k === 'immune') ? (0.55 + 0.45 * Math.abs(Math.sin(q.a * 2.5))) : (1 - q.a / q.l));
        pAlp[n] = q.o * Math.max(0, fade); pSiz[n] = q.s; n++;
      }
      for (var j = n; j < PMAX; j++) pAlp[j] = 0;
      pfxGeo.attributes.position.needsUpdate = true;
      pfxGeo.attributes.aCol.needsUpdate = true;
      pfxGeo.attributes.aAlpha.needsUpdate = true;
      pfxGeo.attributes.aSize.needsUpdate = true;
    }

    var clock = { last: 0 };
    function frame(t) {
      if (!v) return;  // unmount 后彻底停帧
      v.raf = requestAnimationFrame(frame);
      if (!cv.clientWidth || !cv.isConnected) return;
      var w = cv.clientWidth, h = cv.clientHeight;
      if (w !== v.lastW || h !== v.lastH) { v.lastW = w; v.lastH = h; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); }
      var dt = clock.last ? Math.min(0.1, (t - clock.last) / 1000) : 0.016;
      clock.last = t;
      idleT += dt;
      if (idleT > 4) controls.autoRotate = true;
      controls.update();
      var s = (typeof window.simSnapshot === 'function') ? window.simSnapshot() : null;
      var fx = (s && typeof vfxState === 'function') ? vfxState() : null;
      var sp = (typeof SPREAD !== 'undefined') ? SPREAD : 1.45;
      for (var id in organs) {
        var o = organs[id];
        var hp = o.home.clone().sub(BODY_C).multiplyScalar(sp - 1).add(o.home);
        if (!s) { o.node.position.copy(hp); continue; }
        var pulse = 1 + 0.10 * Math.exp(-s.beatPhase * 8) * s.contract;
        var respPh = Math.sin(((s.t * s.rr / 60) % 1) * Math.PI * 2);
        var sc = 1;
        if (o.anim === 'heart') sc = pulse;
        if (o.anim === 'lung') {
          var aspi = (s.rr > 0.5 && !s.dead) ? Math.max(0, respPh) : 0;
          sc = 1 + 0.1032 * aspi;
        }
        if (fx && o.anim === 'heart') {
          if (fx.vf > 0 && fx.jitAmp > 0) {
            var f = fx.jitHz * 6.2832;
            var j = (Math.sin(s.t * f) + Math.sin(s.t * f * 1.37 + 1.3)) * 0.5 * (0.5 + Math.random()) * fx.jitAmp;
            sc = 1 + j * 1.6;
            o.node.position.set(hp.x + (Math.random() - .5) * fx.jitAmp * 0.5, hp.y + (Math.random() - .5) * fx.jitAmp * 0.5, hp.z + (Math.random() - .5) * fx.jitAmp * 0.5);
          } else if (fx.arrest > 0) {
            sc = 1;
            if (fx.cprComp > 0) hp.y -= 0.018 * fx.cprComp;
          }
        }
        if (fx && o.id === 'airway' && fx.anaphy > 0) sc *= 1 - 0.10 * fx.anaphy;
        o.node.scale.copy(o.homeScale).multiplyScalar(sc);
        if (fx && fx.vf > 0 && o.anim === 'heart') o.node.scale.y *= 1 + ((Math.random() - .5) * fx.jitAmp * 1.4);
        if (fx && fx.arrest > 0 && o.anim === 'heart' && fx.cprComp > 0) o.node.scale.y *= 1 - 0.15 * fx.cprComp;
        if (!(fx && fx.vf > 0 && o.anim === 'heart')) o.node.position.copy(hp);
        var removed = (s.ect && s.ect[id]);
        var dimmed = (BW.sel && !selHits(id));
        for (var mi = 0; mi < o.mats.length; mi++) {
          var m = o.mats[mi];
          m.transparent = !!dimmed || !!removed;
          var b = m.userData.base;
          var r = b.r, gg = b.g, bb = b.b;
          if (removed) {
            var gr = (r + gg + bb) / 3 * 0.45;
            r = gr; gg = gr; bb = gr;
            m.opacity = 0.08; m.depthWrite = false;
          } else {
            m.opacity = dimmed ? 0.10 : 1.0;
            m.depthWrite = !dimmed;
            if (fx) { var c = vfxOrganColor(id, b.r, b.g, b.b, fx); r = c[0]; gg = c[1]; bb = c[2]; }
            else {
              if (id === 'brain') { var d = Math.max(0.35, Math.min(1.1, 0.35 + s.gcs / 15 * 0.75)); r *= d; gg *= d; bb *= d; }
              if ((id === 'kidneyL' || id === 'kidneyR') && s.map < 65) { r *= 0.7; gg *= 0.55; bb *= 0.55; }
            }
            if (id === 'heart' && m.emissive) {
              var gl = (fx && typeof vfxHeartGlow === 'function') ? vfxHeartGlow(fx) : 0;
              m.emissive.setRGB(0.72, 0.16, 0.10);
              m.emissiveIntensity = gl;
            }
            if (selHits(id)) { r = Math.min(1, r * 1.35); gg = Math.min(1, gg * 1.15); bb = Math.min(1, bb * 1.15); }
          }
          m.color.setRGB(r, gg, bb);
        }
      }
      pfxRenderTick();
      renderer.render(scene, camera);
    }
    v = {
      cv: cv, renderer: renderer, scene: scene, camera: camera, controls: controls,
      organs: organs, raf: requestAnimationFrame(frame), idleT: 0, lastW: 0, lastH: 0, clock: clock
    };
    return v;
  }

  return {
    mount: mount,
    unmount: unmount,
    attached: function () { return !!v; }
  };
})();
