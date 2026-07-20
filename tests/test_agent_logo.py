from pathlib import Path
from runpy import run_path


Logo = run_path(Path(__file__).parents[1] / "src" / "sigmaflow" / "agent" / "logo.py")[
    "Logo"
]


def test_click_listener_is_disabled_after_the_first_message():
    logo = Logo(
        logo_data={"left": [], "right": []},
        pad="",
        margin=0,
        print_row=1,
        print_column=1,
        logo_row=1,
        logo_column=1,
        width=0,
        height=0,
        active=False,
    )

    assert logo.prompt_options["mouse_support"] is True
    assert "key_bindings" in logo.prompt_options

    logo.disable_click_listener()

    assert logo.prompt_options == {"mouse_support": False}
