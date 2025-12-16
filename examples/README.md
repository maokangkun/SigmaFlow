### Demo

Running example:
```bash
sigmaflow -p example/demo_pipeline.py -i example/demo_data.json -m async
```

or using python:
```bash
python example/demo.py
```

demo pipeline flow diagram:
```mermaid
graph TD
    %% ========================
    %% Nodes definition section
    %% ========================
    计算BMI[/"计算BMI"/]
    是否确诊{"是否确诊"}
    推断最有可能疾病["推断最有可能疾病"]
    身高(["身高"])
    年龄(["年龄"])
    提取症状["提取症状"]
    患者信息(["患者信息"])
    疾病列表(["疾病列表"])
    获取出生日期["获取出生日期"]
    治疗建议(["治疗建议"])
    计算年龄[/"计算年龄"/]
    体重(["体重"])
    诊断["诊断"]
    治疗推荐["治疗推荐"]
    获取身高体重["获取身高体重"]
    出生日期(["出生日期"])
    exit[["exit"]]
    症状(["症状"])
    疾病(["疾病"])
    BMI(["BMI"])
    搜索疾病列表("搜索疾病列表")

    %% ========================
    %% Links definition section
    %% ========================
    症状 --> 每个症状
    出生日期 ==> 计算年龄 ==> 年龄
    治疗建议 ==o|total: 6.26s| exit
    患者信息 ==> 提取症状 ==>|1.02s| 症状
    患者信息 ==> 获取出生日期 ==>|1.05s| 出生日期
    症状 ==> 搜索疾病列表 ==>|1.02s| 疾病列表
    患者信息 ==> 诊断 ==>|1.01s| 疾病
    身高 & 体重 ==> 计算BMI ==> BMI
    患者信息 ==> 获取身高体重 ==>|1.06s| 身高 & 体重
    疾病 ==>|1.02s| 是否确诊
    患者信息 & 疾病列表 ==> 推断最有可能疾病 ==>|1.02s| 疾病
    是否确诊 ==>|无法确定| 提取症状 & 获取出生日期 & 获取身高体重
    患者信息 & 疾病 & 年龄 & BMI ==> 治疗推荐 ==>|1.02s| 治疗建议

    %% ================
    %% Subgraph section
    %% ================
    subgraph 每个症状
        搜索疾病列表
    end

    %% ========================
    %% Style definition section
    %% ========================
    classDef LLMNODE fill:#ECE4E2,color:black
    class 获取出生日期,诊断,治疗推荐,提取症状,获取身高体重,推断最有可能疾病 LLMNODE
    classDef DATA fill:#9BCFB8,color:black
    class 疾病,症状,出生日期,BMI,体重,年龄,治疗建议,患者信息,身高,疾病列表 DATA
    classDef BRANCHNODE fill:#445760,color:white
    class 是否确诊 BRANCHNODE
    classDef CODENODE fill:#FFFFAD,color:black
    class 计算BMI,计算年龄 CODENODE
    classDef LOOPNODE fill:none,stroke:#CC8A4D,stroke-dasharray:5 5,stroke-width:2px
    class 每个症状 LOOPNODE
    classDef RAGNODE fill:#FE929F,color:black
    class 搜索疾病列表 RAGNODE
    classDef EXITNODE fill:#3D3E3F,color:white
    class exit EXITNODE
    classDef INPUTDATA fill:#D64747,color:black
    class 患者信息 INPUTDATA
    linkStyle 0 fill:none,stroke:#CC8A4D,stroke-dasharray:5 5,stroke-width:2px
```

demo pipeline performance:
```mermaid
gantt
title Task Timeline
dateFormat  x
axisFormat  %M:%S.%L
section coroutine
诊断: 0, 1021ms
是否确诊: 13, 2033ms
提取症状: 2047, 1026ms
获取出生日期: 2057, 1062ms
计算年龄: 2080, 1045ms
获取身高体重: 2067, 1072ms
计算BMI: 2083, 1059ms
搜索疾病列表: 3073, 1017ms
搜索疾病列表: 3078, 1020ms
搜索疾病列表: 3084, 1023ms
搜索疾病列表: 3089, 1027ms
搜索疾病列表: 3095, 1030ms
搜索疾病列表: 3100, 1033ms
搜索疾病列表: 3106, 1037ms
每个症状: 2077, 2068ms
治疗推荐: -3, 4168ms
推断最有可能疾病: 2086, 3082ms
是否确诊: 2089, 4103ms
exit: 10, 6242ms
```