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
    LightBlue = "#E2EEFA"
    LightPurple = "#E6DAF8"
    Skin = "#EFC2A2"
    Blue = "#4A90E2"
    LightGray = "#F5F5F5"


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
    FileNode = f"fill:{Color.Skin},color:{Color.Black}"
    MCPNode = f"fill:{Color.LightBlue},stroke:{Color.Blue},stroke-dasharray:5 5,stroke-width:2px"
    APINode = f"fill:{Color.LightPurple},color:{Color.Black}"
    SubGraphNode = f"fill:{Color.LightGray},stroke:{Color.Blue},stroke-dasharray:5 5,stroke-width:2px"
    DatabaseNode = f"fill:{Color.Orange},color:{Color.Black}"
    InputData = f"fill:{Color.RED},color:{Color.Black}"
    OutputData = f"fill:{Color.Green},color:{Color.Black}"


class NodeShape:
    default = '{x}["{x}"]'
    LLMNode = '{x}["{x}<br><font size=2>[{llm}] {model}</font>"]'
    RAGNode = '{x}@{{shape: docs, label: "{x}"}}'
    # LoopNode = '{x}(("{x}"))'
    BranchNode = '{x}{{"{x}"}}'
    CodeNode = '{x}[/"{x}"/]'
    WebNode = '{x}@{{shape: procs, label: "{x}"}}'
    ValueNode = '{n}@{{shape: notch-rect, label: "{n}\\n{x}"}}'
    ExitNode = '{x}[["{x}"]]'
    FileNode = '{x}@{{shape: div-rect, label: "{x}"}}'
    # MCPNode = '{x}("{x}")'
    APINode = '{x}>"{x}"]'
    DatabaseNode = '{x}@{{shape: cyl, label: "{x}"}}'
    InputData = '{x}(["{x}"])'
    OutputData = '{x}(["{x}"])'


class InputData:
    mermaid_style = NodeColorStyle.InputData
    mermaid_shape = NodeShape.InputData


class OutputData:
    mermaid_style = NodeColorStyle.OutputData
    mermaid_shape = NodeShape.OutputData
