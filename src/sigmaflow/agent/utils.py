#!/usr/bin/env python3
"""
Knight Rider style scanner animation as a context manager.
Similar to rich.status.Status but with Knight Rider animation.
Fixed at bottom of terminal while other output appears above.
"""
import re
import ast
import sys
import json
import time
import select
import threading
from enum import Enum
from rich import print as rprint
from dataclasses import dataclass
from typing import Optional, List, Tuple
from .conf import Prompt

# For keyboard input detection
try:
    import termios
    import tty

    HAS_UNIX_TERMIOS = True
except ImportError:
    HAS_UNIX_TERMIOS = False

def extract_json(text):
    text = text.strip()

    try:
        j = ast.literal_eval(text)
        return j
    except Exception:
        pass

    try:
        j = json.loads(text)
        return j
    except Exception:
        pass

    if m := re.findall(r"```(?:json)?(.*?)```", text, re.DOTALL):
        try:
            j = json.loads(m[0])
            return j
        except Exception:
            pass
    return None


class InterruptedError(BaseException):
    """Exception raised when ESC is pressed to interrupt execution."""

    pass


@dataclass
class ScannerState:
    active_position: int
    is_holding: bool
    hold_progress: int
    hold_total: int
    movement_progress: int
    movement_total: int
    is_moving_forward: bool


class KnightRiderStatus:
    """Knight Rider style status indicator that stays at bottom of terminal."""

    def __init__(
        self,
        text: str = "",
        *,
        width: int = 8,
        color: str = "#5c9cf5",
        fps: float = 30.0,
        style: str = "blocks",
        hold_start: int = 30,
        hold_end: int = 9,
        trail_length: int = 6,
        enable_fading: bool = True,
        min_alpha: float = 0.2,
        inactive_factor: float = 1,
    ):
        self.text = text
        self.width = width
        self.color = color
        self.fps = fps
        self.style = style
        self.hold_start = hold_start
        self.hold_end = hold_end
        self.trail_length = trail_length
        self.enable_fading = enable_fading
        self.min_alpha = min_alpha
        self.inactive_factor = inactive_factor

        # Animation state
        self._frame_index = 0
        self._total_frames = (
            self.width + self.hold_end + (self.width - 1) + self.hold_start
        )
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._keyboard_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._esc_pressed = threading.Event()
        self._animation_exception: Optional[tuple] = None

        # Terminal state
        self._animation_output = (
            sys.stderr
        )  # Use stderr for animation to avoid interfering with stdout prints

        # Colors
        self._colors = self._derive_trail_colors(color, trail_length)
        self._default_color = self._derive_inactive_color(color, inactive_factor)

        # Cache for state
        self._cached_frame_index = -1
        self._cached_state: Optional[ScannerState] = None

    def _derive_trail_colors(
        self, bright_color: str, steps: int = 6
    ) -> List[Tuple[int, int, int, float]]:
        """Derive trail gradient colors from a single bright color."""
        if bright_color.startswith("#"):
            hex_color = bright_color[1:]
            if len(hex_color) == 3:
                hex_color = "".join(c * 2 for c in hex_color)
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
        else:
            r, g, b = 92, 156, 245

        colors = []
        for i in range(steps):
            if i == 0:
                alpha = 1.0
                brightness_factor = 1.0
            elif i == 1:
                alpha = 0.9
                brightness_factor = 1.15
            else:
                alpha = 0.65 ** (i - 1)
                brightness_factor = 1.0

            cr = min(255, int(r * brightness_factor))
            cg = min(255, int(g * brightness_factor))
            cb = min(255, int(b * brightness_factor))
            colors.append((cr, cg, cb, alpha))

        return colors

    def _derive_inactive_color(
        self, bright_color: str, factor: float = 0.2
    ) -> Tuple[int, int, int, float]:
        """Derive inactive color from bright color."""
        if bright_color.startswith("#"):
            hex_color = bright_color[1:]
            if len(hex_color) == 3:
                hex_color = "".join(c * 2 for c in hex_color)
            r = int(hex_color[0:2], 16)
            g = int(hex_color[2:4], 16)
            b = int(hex_color[4:6], 16)
        else:
            r, g, b = 92, 156, 245

        return (r, g, b, factor)

    def get_scanner_state(self, frame_index: int) -> ScannerState:
        """Calculate scanner state for given frame index."""
        forward_frames = self.width
        hold_end_frames = self.hold_end
        backward_frames = self.width - 1

        if frame_index < forward_frames:
            return ScannerState(
                active_position=frame_index,
                is_holding=False,
                hold_progress=0,
                hold_total=0,
                movement_progress=frame_index,
                movement_total=forward_frames,
                is_moving_forward=True,
            )
        elif frame_index < forward_frames + hold_end_frames:
            return ScannerState(
                active_position=self.width - 1,
                is_holding=True,
                hold_progress=frame_index - forward_frames,
                hold_total=hold_end_frames,
                movement_progress=0,
                movement_total=0,
                is_moving_forward=True,
            )
        elif frame_index < forward_frames + hold_end_frames + backward_frames:
            backward_index = frame_index - forward_frames - hold_end_frames
            return ScannerState(
                active_position=self.width - 2 - backward_index,
                is_holding=False,
                hold_progress=0,
                hold_total=0,
                movement_progress=backward_index,
                movement_total=backward_frames,
                is_moving_forward=False,
            )
        else:
            return ScannerState(
                active_position=0,
                is_holding=True,
                hold_progress=frame_index
                - forward_frames
                - hold_end_frames
                - backward_frames,
                hold_total=self.hold_start,
                movement_progress=0,
                movement_total=0,
                is_moving_forward=False,
            )

    def calculate_color_index(
        self, frame_index: int, char_index: int, state: Optional[ScannerState] = None
    ) -> int:
        """Calculate color index based on position and state."""
        if state is None:
            if frame_index != self._cached_frame_index:
                self._cached_frame_index = frame_index
                self._cached_state = self.get_scanner_state(frame_index)
            state = self._cached_state
            assert state is not None, "State should not be None after assignment"

        if state.is_moving_forward:
            directional_distance = state.active_position - char_index
        else:
            directional_distance = char_index - state.active_position

        if state.is_holding:
            return directional_distance + state.hold_progress

        if 0 < directional_distance < self.trail_length:
            return directional_distance

        if directional_distance == 0:
            return 0

        return -1

    def _get_fade_factor(self, state: ScannerState) -> float:
        """Calculate fade factor based on state."""
        if not self.enable_fading:
            return 1.0

        if state.is_holding and state.hold_total > 0:
            progress = min(state.hold_progress / state.hold_total, 1.0)
            return max(self.min_alpha, 1.0 - progress * (1.0 - self.min_alpha))
        elif not state.is_holding and state.movement_total > 0:
            progress = min(
                state.movement_progress / max(1, state.movement_total - 1), 1.0
            )
            return self.min_alpha + progress * (1.0 - self.min_alpha)

        return 1.0

    def _get_frame(self) -> str:
        """Get current frame string."""
        state = self.get_scanner_state(self._frame_index)

        frame_chars = []
        for i in range(self.width):
            color_index = self.calculate_color_index(self._frame_index, i, state)

            if self.style == "diamonds":
                shapes = ["⬥", "◆", "⬩", "⬪"]
                if 0 <= color_index < len(self._colors):
                    char = shapes[min(color_index, len(shapes) - 1)]
                else:
                    char = "·"
            else:  # blocks
                if 0 <= color_index < len(self._colors):
                    char = "■"
                else:
                    char = "⬝"

            frame_chars.append(char)

        return "".join(frame_chars)

    def _get_colored_frame(self) -> str:
        """Get current frame with ANSI colors."""
        state = self.get_scanner_state(self._frame_index)
        fade_factor = self._get_fade_factor(state)

        frame_str = self._get_frame()
        colored_chars = []

        for i, char in enumerate(frame_str):
            color_index = self.calculate_color_index(self._frame_index, i, state)

            if color_index == -1 or color_index >= len(self._colors):
                r, g, b, alpha = self._default_color
                dim_level = alpha * fade_factor
                r = int(r * dim_level + 30 * (1 - dim_level))
                g = int(g * dim_level + 30 * (1 - dim_level))
                b = int(b * dim_level + 30 * (1 - dim_level))
                char = "⬝"
            else:
                r, g, b, alpha = self._colors[color_index]
                bg_r, bg_g, bg_b = 30, 30, 30
                r = int(r * alpha + bg_r * (1 - alpha))
                g = int(g * alpha + bg_g * (1 - alpha))
                b = int(b * alpha + bg_b * (1 - alpha))

            colored_chars.append(f"\033[38;2;{r};{g};{b}m{char}\033[0m")

        return "".join(colored_chars)

    def _animation_loop(self):
        """Animation loop in background thread."""
        frame_interval = 1.0 / self.fps

        try:
            while True:
                # Check if ESC was pressed
                if self._esc_pressed.is_set():
                    raise InterruptedError("ESC pressed")

                # Check if we should stop
                if self._stop_event.is_set():
                    break

                with self._lock:
                    # Update frame
                    self._frame_index = (self._frame_index + 1) % self._total_frames

                    # Clear line and display at column 0
                    # This keeps the animation on its line without interfering with other output
                    self._animation_output.write("\r\033[K")

                    # Get frame and display
                    frame = self._get_colored_frame()
                    display = f"{frame} {self.text}"
                    self._animation_output.write(display)
                    self._animation_output.flush()

                # Wait
                self._stop_event.wait(frame_interval)
        except InterruptedError:
            # Re-raise to propagate to main thread
            self._animation_exception = sys.exc_info()

    def _keyboard_listener(self):
        """Listen for ESC key press in background thread."""
        if not HAS_UNIX_TERMIOS:
            return  # Skip on non-Unix systems

        # Check if stdin is a terminal
        if not sys.stdin.isatty():
            return

        import termios
        import tty

        old_settings = None
        try:
            # Save terminal settings
            old_settings = termios.tcgetattr(sys.stdin)
            # Set terminal to raw mode to read single characters
            tty.setraw(sys.stdin.fileno())

            while not self._stop_event.is_set():
                # Check if there's input available with a timeout
                if select.select([sys.stdin], [], [], 0.1)[0]:
                    char = sys.stdin.read(1)
                    # ESC key or Ctrl+C
                    if char == "\x1b" or char == "\x03":
                        self._esc_pressed.set()
                        # Set stop event to halt animation
                        self._stop_event.set()
                        break
        finally:
            # Restore terminal settings
            if old_settings is not None:
                termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)

    def start(self):
        """Start the animation."""
        self._running = True
        self._stop_event.clear()
        self._esc_pressed.clear()

        # Hide cursor
        self._animation_output.write("\033[?25l")
        self._animation_output.flush()

        # Start animation thread
        self._thread = threading.Thread(target=self._animation_loop, daemon=True)
        self._thread.start()

        # Start keyboard listener thread
        self._keyboard_thread = threading.Thread(
            target=self._keyboard_listener, daemon=True
        )
        self._keyboard_thread.start()

    def stop(self):
        """Stop the animation."""
        self._running = False
        self._stop_event.set()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=0.5)

        # Keyboard listener thread will exit automatically due to _stop_event
        # but we can join it with a timeout
        if self._keyboard_thread and self._keyboard_thread.is_alive():
            self._keyboard_thread.join(timeout=0.5)

        # Clear animation line
        self._animation_output.write("\r\033[K")
        self._animation_output.flush()

        # Show cursor
        self._animation_output.write("\033[?25h")

    def __enter__(self):
        """Enter context manager."""
        self.start()
        return self

    def __exit__(self, exc_type=None, exc_val=None, exc_tb=None):
        """Exit context manager."""
        self.stop()
        # If animation thread raised an exception, re-raise it
        if self._animation_exception is not None:
            exc_type, exc_val, exc_tb = self._animation_exception
            if exc_type is InterruptedError:
                rprint(f"{Prompt.Interrupt}canceled")
            raise exc_type(exc_val).with_traceback(exc_tb)
        return False

    def update(self, text: Optional[str] = None):
        """Update status text."""
        if text is not None:
            with self._lock:
                self.text = text


# Test the implementation
if __name__ == "__main__":
    import time

    print("task start")
    with KnightRiderStatus("esc to interrupt", width=8, color="#5c9cf5", fps=35):
        for i in range(5):
            # print(f"step {i}")
            time.sleep(1)
    print("task done")
