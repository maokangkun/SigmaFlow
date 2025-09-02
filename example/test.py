from sigmaflow.manager import PipelineManager
from dotenv import load_dotenv
load_dotenv()

data = {
        "患者信息": "患者女性，1980年3月4日出生，身高176cm，体重69kg。因自幼夜盲、视力差、易摔跤来首都医科大学附属北京同仁医院北京同仁眼科中心就诊。既往病史：患者为足月顺产，无吸氧史，出生体重正常，1岁时学会说话和行走。自幼身材矮小，12岁时身高仅为130 cm（12岁女童身高参考值140~155 cm），但智力发育正常。患者16岁时仍未来月经，到当地医院检查发现卵巢和子宫发育异常，被诊断为“幼稚子宫”，进行了激素替代治疗后来月经并长高，药物持续使用半年，停药后月经停止，此后未规律使用药物。家族史：患者哥哥无异常，父母之间无血缘关系。"
    }
pm = PipelineManager(llm_type='lmdeploy', pipes_dir='example')
r, info = pm.pipes['test_pipeline'].run(data, save_perf=False)
