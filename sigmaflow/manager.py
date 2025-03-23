import sys
from pathlib import Path
from .log import log
from .prompt import Prompt
from .utils import importpath
from .pipeline import Pipeline

class PromptManager:
    def __init__(self, prompts_dir=None):
        log.debug('Setup PromptManager')
        self.buildin_prompts_dir = Path(__file__).parent / 'build_in_prompts'
        if prompts_dir is None:
            log.debug('PromptManager dir is None, set to current dir.')
            self.prompts_dir = Path('.')
        else:
            self.prompts_dir = Path(prompts_dir)
        self.prompts = {}
        self.load_prompts()

    def load_prompts(self):
        self.prompts = {}
        prompts_dirs = [self.buildin_prompts_dir, self.prompts_dir]
        log.debug(f'Start load prompts: {prompts_dirs}')

        for pdir in prompts_dirs:
            prompt_files = list(pdir.glob('*_prompt.py'))
            log.debug(f'Find {len(prompt_files)} prompt files: {[p.stem for p in prompt_files]}')

            for pf in prompt_files:
                m = importpath(pf)
                self.prompts[pf.stem] = Prompt(m.prompt, m.keys, pf.stem, pf)

        log.debug('All prompts loaded')
    
    def get(self, item):
        if (t := type(item)) is str:
            if item not in self.prompts: raise KeyError(f"Don't has prompt: {item}")
            return self.prompts[item]
        elif t is dict:
            name = f'prompt_{len(self.prompts)}'
            assert name not in self.prompts, f'PromptManager: two prompts has the same name {name}'
            self.prompts[name] = Prompt(item['prompt'], item['keys'], name)
            return self.prompts[name]

class PipelineManager:
    def __init__(self, llm_client=None, rag_client=None, run_mode='async', pipes_dir=None, prompt_manager=None):
        log.debug('Setup PipelineManager')
        if pipes_dir is None: pipes_dir = '.'
        self.pipes_dir = Path(pipes_dir)
        self.prompt_manager = prompt_manager or PromptManager()
        self.llm_client = llm_client
        self.rag_client = rag_client
        self.run_mode = run_mode
        self.pipes = {}
        self.load_pipes()

    def load_pipes(self):
        self.pipes = {}
        log.debug(f'Start load pipelines: {self.pipes_dir}')
        sys.path.append(str(self.pipes_dir))
        pipe_files = list(self.pipes_dir.glob('*_pipeline.py'))
        log.debug(f'Find {len(pipe_files)} pipeline files: {[p.stem for p in pipe_files]}')

        for pf in pipe_files:
            self.pipes[pf.stem] = Pipeline(self.llm_client, self.rag_client, self.prompt_manager, pipefile=pf, run_mode=self.run_mode)

        log.debug('All pipelines loaded')

    def export_pipe_conf(self):
        conf = {k: copy.deepcopy(v['conf']) for k,v in self.pipes.items()}
        for c in conf.values():
            for pipe_conf in c.values():
                if 'format' in pipe_conf:
                    for k, v in pipe_conf['format'].items():
                        pipe_conf['format'][k] = str(v)
        return conf

    def update_pipe(self, pipe_name, pipe_data):
        if pipe_name.endswith('_pipe'):
            pipe_file = self.pipes_dir / f'{pipe_name}.py'

            try:
                content = json.dumps(pipe_data, indent=4, ensure_ascii=False)
                content = re.sub(r'"<class \'(.*)\'>"', r'\1', content)

                conf = pipe_data
                for pipe_conf in conf.values():
                    if 'format' in pipe_conf:
                        for k, v in pipe_conf['format'].items():
                            pipe_conf['format'][k] = eval(v.replace("<class '","").replace("'>",""))

                pipe = copy.deepcopy(conf)
                for k in pipe:
                    if 'prompt' in pipe[k]:
                        pipe[k]['prompt'] = self.prompt_manager.prompts[pipe[k]['prompt']]

                self.pipes[pipe_name] = {
                    'file': pipe_file,
                    'conf': conf,
                    'func': Pipeline(pipe, self.llm_client, self.rag_client)
                }

                with open(pipe_file, 'w') as f:
                    content = 'pipe = ' + content + '\n'
                    f.write(content)
                
                log.debug(f'Save pipeline "{pipe_name}":\n{content}')
                return f'Successfully saved {pipe_name}'
            except Exception as e:
                return f'Error: {e}'
        else:
            return 'Error: name must end with `_pipe`.'

    def export_nodes(self):
        nodes = {}
        for pipeline in self.pipes.values():
            pt = pipeline.pipetree
            for node in pt.node_manager.values():
                nodes |= node.export_as_comfyui()
        return nodes

    def add_pipe(self, name, pipeconf=None, pipefile=None, run_mode='async', is_seq=False):
        self.pipes[name] = Pipeline(self.llm_client, self.rag_client, self.prompt_manager, pipeconf=pipeconf, pipefile=pipefile, run_mode=run_mode)
        return self.pipes[name]
