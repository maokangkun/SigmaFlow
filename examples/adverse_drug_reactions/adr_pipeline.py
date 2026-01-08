import os

def rag(*args, **kwargs):
    ...

pipeline = {
    "CONFIG": {
        "llm": "openai",
        "model": "gpt-3.5-turbo",
        "rag": rag,
    },
    'extract_adr_drug': {
        'prompt': 'extract_adr_drug_prompt',
        'format': {'adr': list, 'drug': list},
        'inp': ['inp'],
        'out': ['adr', 'drug'],
        'next': ['drug_search', 'loop_adr'],
    },
    'drug_search': {
        'rag_param': {
            'kb_id': os.getenv("DRUG_KB_ID"),
            'top_k': 1, 
            'threshold': 0.9,
        },
        'inp': ['drug'],
        'out': 'drug_info',
    },
    'loop_adr': {
        'inp': ['adr'],
        'pipe_in_loop': ['CTCAE_search', 'extract_adr_std', 'doc_search', 'lab_search', 'adr_eval', 'adr_grading'],
        'next': ['exit'],
    },
    'CTCAE_search': {
        'rag_param': {
            'kb_id': os.getenv("CTCAE_KB_ID"),
            'top_k': 1, 
            'threshold': 0.7,
        },
        'inp': ['adr'],
        'out': 'CTCAE_info',
        # 'return_key': '[0]["metadata"]["段落"]',
    },
    'extract_adr_std': {
        'prompt': 'extract_adr_std_prompt',
        'format': {'adr_standard': str, 'supplementary_info': str},
        'inp': ['adr', 'CTCAE_info'],
        'out': ['adr_standard', 'supplementary_info'],
    },
    'doc_search': {
        'rag_param': {
            'kb_id': os.getenv("DOC_KB_ID"),
            'top_k': 2, 
            'threshold': 0.9,
        },
        'inp': ['supplementary_info'],
        'out': 'doc_list',
    },
    'lab_search': {
        'rag_param': {
            'kb_id': os.getenv("LAB_KB_ID"),
            'top_k': 2, 
            'threshold': 0.88,
        },
        'inp': ['supplementary_info'],
        'out': 'lab_list',
    },
    'adr_eval': {
        'prompt': 'judge_adr_eval_prompt',
        'format': {'Five-Point Evaluation of ADR': str, "Two-Point Evaluation of ADR": str},
        'inp': ['inp', 'adr_standard', 'drug_info'],
        'out': 'adr_eval_result',
    },
    'adr_grading': {
        'prompt': 'judge_adr_grading_prompt',
        'format': {'CTCAE Grading': str},
        'inp': [
            'inp',
            'adr_standard',
            {
                '参考CTCAE指南文档': 'CTCAE_info', 
                '参考医学知识关键词': 'supplementary_info', 
                '参考医学知识1': 'doc_list',
                '参考医学知识2': 'lab_list',
            }
        ],
        'out': 'adr_grading_result',
        'next': ['exit'],
    },
    'exit': {
        'drug_info': 'drug_info',
        'adr_info': [{
            'adr': 'adr', 
            'adr_eval': 'adr_eval_result', 
            'adr_grading': 'adr_grading_result'
        }]
    }
}
