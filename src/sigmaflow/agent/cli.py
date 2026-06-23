from rich import print
from .agent import Agent
from .conf import Prompt, SLASH_CMD
from .logo import Logo
from .input import session


def cli(query, method="anthropic", available_tools=None, debug=False):
    agent = Agent(method, available_tools=available_tools, debug=debug)

    logo = Logo.print()
    info_lines = agent.print_info()
    logo.sync_after_output(info_lines)

    history = []
    if query:
        history.append({"role": "user", "content": query})
        print(f"{Prompt.User}{query}")

    while True:
        if history and history[-1]["role"] == "user":
            agent(history)

        try:
            query = session.prompt(
                Prompt.UserHTML,
                **logo.prompt_options,
                vi_mode=False,
            ).strip()
        except (EOFError, KeyboardInterrupt):
            break

        match q := query.lower():
            case _ if q in SLASH_CMD.exit:
                break
            case SLASH_CMD.history:
                print(f"{Prompt.History}")
                if history:
                    print(history)
            case SLASH_CMD.compact:
                history = agent.compactor.auto_compact(history, force=True)
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
