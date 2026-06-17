from rich import print
from .agent import Agent
from .logo import print_logo
from .input import session
from .conf import *

def cli(query, method='anthropic', available_tools=None, debug=False):
    agent = Agent(method, available_tools=available_tools, debug=debug)

    print_logo()
    agent.print_info()

    history = []
    if query:
        history.append({"role": "user", "content": query})
        print(f"{Prompt.User}{query}")

    while True:
        if history and history[-1]['role'] == 'user':
            info = agent(history)

        try:
            query = session.prompt(
                Prompt.UserHTML,
                mouse_support=False,
                vi_mode=False,
            ).strip()
        except (EOFError, KeyboardInterrupt):
            break

        match q := query.lower():
            case _ if q in SLASH_CMD.exit:
                break
            case SLASH_CMD.history:
                print(f"{Prompt.History}")
                if history: print(history)
            case SLASH_CMD.compact:
                history = compactor.auto_compact(history, force=True)
            case SLASH_CMD.team:
                ...
            case SLASH_CMD.inbox:
                ...
            case _ if q in SLASH_CMD.reset:
                print(f"{Prompt.Session}")
                history = []
            case _:
                m = {"role": "user", "content": query}
                if m != history[-1] if history else True:
                    history.append(m)
