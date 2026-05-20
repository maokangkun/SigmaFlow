import re
from prompt_toolkit.styles import Style
from prompt_toolkit.lexers import Lexer
from prompt_toolkit import PromptSession
from prompt_toolkit.document import Document
from prompt_toolkit.history import FileHistory
from prompt_toolkit.auto_suggest import AutoSuggestFromHistory
from prompt_toolkit.completion import Completer, Completion, WordCompleter, PathCompleter
from .conf import *

class MyCompleter(Completer):
    def __init__(self, cmd_completer: Completer, path_completer: Completer):
        self.cmd_completer = cmd_completer
        self.path_completer = path_completer

    def get_completions(self, document: Document, complete_event):
        text = document.text_before_cursor
        last_at = text.rfind('@')
        if last_at != -1:
            after_at = text[last_at + 1:]
            if ' ' not in after_at:
                path_doc = Document(after_at, cursor_position=len(after_at))
                for comp in self.path_completer.get_completions(path_doc, complete_event):
                    full_path = after_at + comp.text
                    yield Completion(
                        comp.text,
                        start_position=comp.start_position,
                        display=full_path,
                        display_meta=comp.display_meta,
                        style=comp.style,
                    )
                return
        yield from self.cmd_completer.get_completions(document, complete_event)

class AtPathLexer(Lexer):
    def lex_document(self, document):
        def get_line(lineno):
            line = document.lines[lineno]
            pattern = r'@\S+'
            last_end = 0
            result = []
            for match in re.finditer(pattern, line):
                start, end = match.span()
                if start > last_end:
                    result.append(('', line[last_end:start]))
                result.append(('class:at-path', line[start:end]))
                last_end = end
            if last_end < len(line):
                result.append(('', line[last_end:]))
            return result
        return get_line

style = Style([
    ('at-path', 'fg:white bg:#d78787'),
])
cmd_completer = WordCompleter(SLASH_CMD.all())
path_completer = PathCompleter(only_directories=False, expanduser=True)
custom_completer = MyCompleter(cmd_completer, path_completer)
session = PromptSession(
    history=FileHistory(str(INPUT_HISTORY)), 
    enable_history_search=True,
    auto_suggest=AutoSuggestFromHistory(),
    completer=custom_completer,
    lexer=AtPathLexer(),
    style=style,
    # multiline=True,
)