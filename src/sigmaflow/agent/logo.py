import io
import math
import re
import select
import shutil
import sys
import time
from contextlib import contextmanager
from dataclasses import dataclass

from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.keys import Keys
from rich.console import Console

try:
    import termios
    import tty
except ImportError:
    termios = None
    tty = None

LOGO_FULL = {
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
PEAK = (255, 255, 255)
PRIMARY = (255, 158, 104)
LEFT_BASE = (120, 124, 124)
LEFT_SHADOW_RGB = (38, 38, 38)
RIGHT_BASE = (235, 239, 242)
RIGHT_SHADOW_RGB = (64, 64, 64)
FRAME_DELAY = 1 / 45
ANIMATION_FRAMES = 18
SAVE_CURSOR = "\x1b[s"
RESTORE_CURSOR = "\x1b[u"
HIDE_CURSOR = "\x1b[?25l"
SHOW_CURSOR = "\x1b[?25h"
SGR_MOUSE_RE = re.compile(r"\x1b\[<(\d+);(\d+);(\d+)M")


def _draw_char(char: str, fg: str, shadow: str, bg: str) -> str:
    if char == "_":
        return f"{bg} {RESET}"
    if char == "^":
        return f"{fg}{bg}▀{RESET}"
    if char == "~":
        return f"{shadow}▀{RESET}"
    if char == " ":
        return " "
    return f"{fg}{char}{RESET}"


def draw(line: str, fg: str, shadow: str, bg: str) -> str:
    return "".join(_draw_char(char, fg, shadow, bg) for char in line)


def _animated_line(
    line: str,
    *,
    y: int,
    offset: int,
    base: tuple[int, int, int],
    shadow: tuple[int, int, int],
    origin: tuple[float, float],
    phase: float,
) -> str:
    parts = []
    for x, char in enumerate(line):
        glow = _intensity(offset + x, y, origin, phase) if char != " " else 0
        fg = _ansi(38, _tint(base, glow))
        bg = _ansi(48, _tint(shadow, glow * 0.22))
        shadow_fg = _ansi(38, _tint(shadow, glow * 0.28))
        parts.append(_draw_char(char, fg, shadow_fg, bg))
    return "".join(parts)


def _ansi(kind: int, rgb: tuple[int, int, int]) -> str:
    return f"\x1b[{kind};2;{rgb[0]};{rgb[1]};{rgb[2]}m"


def _mix(
    a: tuple[int, int, int], b: tuple[int, int, int], amount: float
) -> tuple[int, int, int]:
    amount = max(0.0, min(1.0, amount))
    return tuple(round(x + (y - x) * amount) for x, y in zip(a, b))


def _tint(base: tuple[int, int, int], glow: float) -> tuple[int, int, int]:
    if glow <= 0:
        return base
    warm = _mix(base, PRIMARY, min(1.0, glow * 0.72))
    return _mix(warm, PEAK, max(0.0, min(1.0, (glow - 0.65) * 1.5)))


def _intensity(x: int, y: int, origin: tuple[float, float], phase: float) -> float:
    dx = x + 0.5 - origin[0]
    dy = y * 2 + 1 - origin[1]
    distance = math.hypot(dx, dy)
    radius = phase * 32
    edge = math.exp(-(((distance - radius) / 1.35) ** 2)) * (1 - phase) ** 0.55
    trail = math.exp(-(radius - distance) / 4.6) * 0.34 if distance < radius else 0
    flash = math.exp(-(distance * distance) / 5.8) * max(0.0, 1 - phase * 4)
    shimmer = 0.08 * math.sin(phase * math.tau * 3 + x * 0.7 + y * 1.9)
    return max(0.0, edge * 1.85 + trail + flash + shimmer)


def _render_lines(
    logo_data: dict[str, list[str]],
    *,
    pad: str,
    margin: int,
    origin: tuple[float, float] | None = None,
    phase: float = 1.0,
) -> list[str]:
    lines = [""] * margin
    left_width = len(logo_data["left"][0]) if logo_data["left"] else 0
    for i, row in enumerate(logo_data["left"]):
        other = logo_data["right"][i] if i < len(logo_data["right"]) else ""
        if origin is None:
            left = draw(row, LEFT_FG, LEFT_SHADOW, LEFT_BG)
            right = draw(other, RIGHT_FG, RIGHT_SHADOW, RIGHT_BG)
        else:
            left = _animated_line(
                row,
                y=i,
                offset=0,
                base=LEFT_BASE,
                shadow=LEFT_SHADOW_RGB,
                origin=origin,
                phase=phase,
            )
            right = _animated_line(
                other,
                y=i,
                offset=left_width + 1,
                base=RIGHT_BASE,
                shadow=RIGHT_SHADOW_RGB,
                origin=origin,
                phase=phase,
            )
        line = f"{pad}{left} {right}"
        if i == len(logo_data["left"]) - 1:
            line += VERSION
        lines.append(line)
    lines.extend([""] * margin)
    return lines


def _write_lines(lines: list[str]) -> None:
    sys.stdout.write("\n".join(lines) + "\n")
    sys.stdout.flush()


def _write_lines_at(lines: list[str], row: int, column: int) -> None:
    sys.stdout.write(SAVE_CURSOR)
    for i, line in enumerate(lines):
        sys.stdout.write(f"\x1b[{row + i};{column}H{line}")
    sys.stdout.write(RESTORE_CURSOR)
    sys.stdout.flush()


@contextmanager
def _hidden_cursor():
    sys.stdout.write(HIDE_CURSOR)
    sys.stdout.flush()
    try:
        yield
    finally:
        sys.stdout.write(SHOW_CURSOR)
        sys.stdout.flush()


def _animation_frames(
    logo_data: dict[str, list[str]],
    *,
    pad: str,
    margin: int,
    origin: tuple[float, float],
):
    for frame in range(ANIMATION_FRAMES):
        yield _render_lines(
            logo_data,
            pad=pad,
            margin=margin,
            origin=origin,
            phase=frame / (ANIMATION_FRAMES - 1),
        )


def _read_available(timeout: float) -> str:
    end = time.monotonic() + timeout
    data = []
    while time.monotonic() < end:
        remaining = max(0.0, end - time.monotonic())
        readable, _, _ = select.select([sys.stdin], [], [], min(0.05, remaining))
        if not readable:
            continue
        data.append(sys.stdin.read(1))
    return "".join(data)


def _cursor_position(timeout: float = 0.2) -> tuple[int, int] | None:
    sys.stdout.write("\x1b[6n")
    sys.stdout.flush()
    response = _read_available(timeout)
    matches = re.findall(r"(?:\x1b)?\[(\d+);(\d+)R", response)
    if not matches:
        return None
    row, column = matches[-1]
    # print(f"row:{row}, column:{column}")
    return int(row), int(column)


def _terminal_cursor_position(timeout: float = 0.2) -> tuple[int, int] | None:
    if termios is None or tty is None:
        return None
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        return None

    old = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin)
        return _cursor_position(timeout)
    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old)


def _mouse_position(data: str, buttons: set[int]) -> tuple[int, int] | None:
    for button, x, y in SGR_MOUSE_RE.findall(data):
        if int(button) in buttons:
            return int(x), int(y)

    if data.startswith("\x1b[M") and len(data) >= 6:
        button = ord(data[3]) - 32
        if button in buttons:
            return ord(data[4]) - 32, ord(data[5]) - 32

    return None


def _rendered_row_count(lines: list[str]) -> int:
    width = shutil.get_terminal_size().columns
    output = io.StringIO()
    console = Console(file=output, force_terminal=False, width=width)
    rows = 0
    for line in lines:
        output.seek(0)
        output.truncate(0)
        console.print(line)
        rows += max(1, len(output.getvalue().splitlines()))
    return rows


@dataclass
class Logo:
    logo_data: dict[str, list[str]]
    pad: str
    margin: int
    print_row: int
    print_column: int
    logo_row: int
    logo_column: int
    width: int
    height: int
    active: bool
    calibrated: bool = False

    @classmethod
    def print(cls, is_slim=True, pad: str = "", margin=1) -> "Logo":
        logo_data = LOGO_SLIM if is_slim else LOGO_FULL
        cursor = _terminal_cursor_position()
        print_row = cursor[0] if cursor else 1
        print_column = cursor[1] if cursor else 1
        logo = cls(
            logo_data=logo_data,
            pad=pad,
            margin=margin,
            print_row=print_row,
            print_column=print_column,
            logo_row=print_row + margin,
            logo_column=print_column + len(pad),
            width=len(logo_data["left"][0]) + 1 + len(logo_data["right"][0]),
            height=len(logo_data["left"]),
            active=cursor is not None,
        )

        lines = logo.lines()
        _write_lines(lines)
        if cursor is None:
            logo.calibrate_print_position(lines)
        return logo

    def lines(
        self,
        origin: tuple[float, float] | None = None,
        phase: float = 1.0,
    ) -> list[str]:
        return _render_lines(
            self.logo_data,
            pad=self.pad,
            margin=self.margin,
            origin=origin,
            phase=phase,
        )

    def calibrate_print_position(self, lines: list[str]) -> None:
        end_cursor = _terminal_cursor_position()
        if not end_cursor:
            return
        self.print_row, self.print_column = end_cursor[0] - len(lines), 1
        self.logo_row, self.logo_column = self.print_row + self.margin, 1 + len(
            self.pad
        )
        self.active = True

    def _lit_at(self, x: int, y: int) -> bool:
        if y < 0 or y >= self.height:
            return False
        row = f"{self.logo_data['left'][y]} {self.logo_data['right'][y]}"
        return 0 <= x < len(row) and row[x] != " "

    def hit(self, x: int, y: int) -> tuple[float, float] | None:
        local_x = x - self.logo_column
        if not self.active:
            return self.calibrate_once(x, y, local_x)

        local_y = y - self.logo_row
        if (
            0 <= local_y < self.height
            and 0 <= local_x < self.width
            and self._lit_at(local_x, local_y)
        ):
            return local_x + 0.5, local_y * 2 + 1
        return None

    def calibrate_once(
        self, x: int, y: int, local_x: int | None = None
    ) -> tuple[float, float] | None:
        if self.calibrated:
            return None

        max_calibration_row = max(8, shutil.get_terminal_size().lines // 3)
        if y > max_calibration_row:
            return None

        local_x = x - self.logo_column if local_x is None else local_x
        if local_x < 0 or local_x >= self.width:
            return None

        rows = [row for row in range(self.height) if self._lit_at(local_x, row)]
        if not rows:
            return None

        local_y = min(rows, key=lambda row: abs(row - self.height // 2))
        self.logo_row = y - local_y
        self.print_row = self.logo_row - self.margin
        self.active = True
        self.calibrated = True
        return local_x + 0.5, local_y * 2 + 1

    def sync_after_output(self, lines: list[str]) -> None:
        terminal_height = shutil.get_terminal_size().lines
        before_row = self.print_row + len(self.lines())
        offset = before_row + _rendered_row_count(lines) - terminal_height
        amount = -offset if offset > 0 else 1 if offset == -1 else 5
        self.print_row += amount
        self.logo_row += amount

    def animate(self, origin: tuple[float, float]) -> None:
        with _hidden_cursor():
            for lines in _animation_frames(
                self.logo_data, pad=self.pad, margin=self.margin, origin=origin
            ):
                _write_lines_at(lines, self.print_row, self.print_column)
                time.sleep(FRAME_DELAY)
            _write_lines_at(self.lines(), self.print_row, self.print_column)

    def key_bindings(self) -> KeyBindings:
        bindings = KeyBindings()

        @bindings.add(Keys.Vt100MouseEvent, eager=True)
        def _(event):
            position = _mouse_position(event.data, {0, 32})
            if not position:
                return NotImplemented

            origin = self.hit(*position)
            if not origin:
                return NotImplemented

            self.animate(origin)
            return None

        return bindings

    @property
    def prompt_options(self) -> dict[str, object]:
        return {
            "mouse_support": True,
            "key_bindings": self.key_bindings(),
        }

if __name__ == "__main__":
    Logo.print()
