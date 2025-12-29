from pathlib import Path
from .prompt import PromptKeys, Prompt

BuildinPromptsDir = Path(__file__).parent

__call__ = [PromptKeys, Prompt, BuildinPromptsDir]
