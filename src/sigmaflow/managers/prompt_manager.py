from pathlib import Path
from ..log import log
from ..utils import importpath
from ..prompts import Prompt, BuildinPromptsDir


class PromptManager:
    def __init__(self, prompts_dir=None):
        log.banner("Setup PromptManager", separate=False)
        self.buildin_prompts_dir = BuildinPromptsDir
        if prompts_dir is None:
            log.debug("PromptManager dir is None, set to current dir")
            self.prompts_dir = Path(".")
        else:
            self.prompts_dir = Path(prompts_dir)
        self.prompts = {}
        self.load_prompts()

    def load_prompts(self):
        self.prompts = {}
        prompts_dirs = [self.buildin_prompts_dir, self.prompts_dir]
        log.debug(f"Start load prompts: {prompts_dirs}")

        for pdir in prompts_dirs:
            for pf in pdir.glob("*_prompt.py"):
                m = importpath(pf)
                self.prompts[pf.stem] = Prompt(m.prompt, m.keys, pf.stem, pf)

        log.debug(
            f"Find {len(self.prompts)} prompt files: {list(self.prompts.keys())}\nAll prompts loaded"
        )

    def get(self, item):
        if (t := type(item)) is str:
            if item not in self.prompts:
                raise KeyError(f"Don't has prompt: {item}")
            return self.prompts[item]
        elif t is dict:
            name = f"prompt_{len(self.prompts)}"
            assert name not in self.prompts, (
                f"PromptManager: two prompts has the same name {name}"
            )
            self.prompts[name] = Prompt(item["prompt"], item["keys"], name)
            return self.prompts[name]
