LOGO = {
    "left": [
        "█▀▀▀ ▀█^ █▀▀▀ █▄▄█ ▄^^▄",
        "^^^█  █_ █__█ █__█ █^^█",
        "▀▀▀▀ ▀▀▀ ▀▀▀▀ ▀  ▀ ▀  ▀",
    ],
    "right": [
        "█▀▀▀ █_   █▀▀█ █   █",
        "█^^^ █_   █__█ █_█_█",
        "▀    ▀▀▀▀ ▀▀▀▀ ▀▀▀▀▀",
    ],
}
LOGO_SLIM = {
    "left": [
        "█▀▀ ▀█^ █▀▀ █▄█ █^█",
        "^^█  █_ █_█ █_█ █^█",
        "▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀ ▀ ▀",
    ],
    "right": [
        "█▀▀ █_  █▀█ █_█",
        "█^^ █_  █_█ █▄█",
        "▀   ▀▀▀ ▀▀▀ ▀ ▀",
    ],
}

RESET = "\x1b[0m"
LEFT_FG = "\x1b[90m"
LEFT_SHADOW = "\x1b[38;5;235m"
LEFT_BG = "\x1b[48;5;235m"
RIGHT_FG = RESET
RIGHT_SHADOW = "\x1b[38;5;238m"
RIGHT_BG = "\x1b[48;5;238m"
VERSION = "\x1b[38;5;51m" + " v1.0.0" + RESET


def draw(line: str, fg: str, shadow: str, bg: str) -> str:
    parts = []
    for char in line:
        if char == "_":
            parts.extend([bg, " ", RESET])
            continue
        if char == "^":
            parts.extend([fg, bg, "▀", RESET])
            continue
        if char == "~":
            parts.extend([shadow, "▀", RESET])
            continue
        if char == " ":
            parts.append(" ")
            continue
        parts.extend([fg, char, RESET])
    return "".join(parts)


def print_logo(is_slim=True, pad: str = "", margin=1) -> str:
    logo_data = LOGO_SLIM if is_slim else LOGO
    result = []
    for i, row in enumerate(logo_data["left"]):
        if pad:
            result.append(pad)
        result.append(draw(row, LEFT_FG, LEFT_SHADOW, LEFT_BG))
        result.append(" ")
        other = logo_data["right"][i] if i < len(logo_data["right"]) else ""
        result.append(draw(other, RIGHT_FG, RIGHT_SHADOW, RIGHT_BG))
        result.append("\n")
    
    result[-1] = result[-1].rstrip("\n") + VERSION + "\n"
    content = "".join(result).rstrip()
    if margin:
        content = "\n"*margin + content + "\n"*margin
    print(content)


if __name__ == "__main__":
    print_logo()
