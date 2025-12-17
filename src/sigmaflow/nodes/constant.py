from enum import Enum


class DataState(Enum):
    VOID = 0


class Color:
    Black = "black"
    White = "white"
    Gray = "#ECE4E2"
    Pink = "#FE929F"
    RED = "#D64747"
    LightPink = "#FAB6BF"
    Khaki = "#CC8A4D"
    DarkBlue = "#445760"
    LightGreen = "#EAFFD0"
    Green = "#9BCFB8"
    LightYellow = "#FFFFAD"
    Black2 = "#3D3E3F"
    Orange = "#f96"


class NodeColorStyle:
    default = f"color:{Color.Black}"
    LLMNode = f"fill:{Color.Gray},color:{Color.Black},stroke:{Color.Orange},stroke-width:1px,stroke-dasharray: 5 5"
    RAGNode = f"fill:{Color.Pink},color:{Color.Black}"
    LoopNode = f"fill:none,stroke:{Color.Khaki},stroke-dasharray:5 5,stroke-width:2px"
    BranchNode = f"fill:{Color.DarkBlue},color:{Color.White}"
    CodeNode = f"fill:{Color.LightYellow},color:{Color.Black}"
    WebNode = f"fill:{Color.LightPink},color:{Color.Black}"
    ValueNode = f"fill:{Color.LightGreen},color:{Color.Black}"
    ExitNode = f"fill:{Color.Black2},color:{Color.White}"
    FileNode = f"fill:{Color.Khaki},color:{Color.Black}"
    Data = f"fill:{Color.Green},color:{Color.Black}"
    InputData = f"fill:{Color.RED},color:{Color.Black}"


class NodeShape:
    default = '{x}["{x}"]'  # 矩形
    LLMNode = '{x}["{x}"]'
    RAGNode = '{x}("{x}")'  # 圆角矩形
    LoopNode = '{x}(("{x}"))'  # 圆形
    BranchNode = '{x}{{"{x}"}}'
    CodeNode = '{x}[/"{x}"/]'
    WebNode = '{x}("{x}")'
    ValueNode = '{n}{{{{"{x}"}}}}'
    ExitNode = '{x}[["{x}"]]'
    FileNode = '{x}["{x}"]'
    Data = '{x}(["{x}"])'
    InputData = '{x}(["{x}"])'


class Data:
    mermaid_style = NodeColorStyle.Data
    mermaid_shape = NodeShape.Data


class InputData:
    mermaid_style = NodeColorStyle.InputData
    mermaid_shape = NodeShape.InputData
