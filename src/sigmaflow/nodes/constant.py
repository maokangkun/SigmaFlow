from enum import Enum

class DataState(Enum):
    VOID = 0

class Color:
    Black = 'black'
    White = 'white'
    Gray = '#ECE4E2'
    Pink = '#FE929F'
    RED = '#D64747'
    LightPink = '#FAB6BF'
    Khaki = '#CC8A4D'
    DarkBlue = '#445760'
    LightGreen = '#EAFFD0'
    Green = '#9BCFB8'
    LightYellow = '#FFFFAD'
    Black2 = '#3D3E3F'
    Orange = '#f96'

class NodeColorStyle:
    default = f'color:{Color.Black}'
    LLMNode = f'fill:{Color.Gray},color:{Color.Black},stroke:{Color.Orange},stroke-width:1px,stroke-dasharray: 5 5'
    RAGNode = f'fill:{Color.Pink},color:{Color.Black}'
    LoopNode = f'fill:none,stroke:{Color.Khaki},stroke-dasharray:5 5,stroke-width:2px'
    BranchNode = f'fill:{Color.DarkBlue},color:{Color.White}'
    CodeNode = f'fill:{Color.LightYellow},color:{Color.Black}'
    WebNode = f'fill:{Color.LightPink},color:{Color.Black}'
    ValueNode = f'fill:{Color.LightGreen},color:{Color.Black}'
    ExitNode = f'fill:{Color.Black2},color:{Color.White}'
    FileNode = f'fill:{Color.Khaki},color:{Color.Black}'
    Data = f'fill:{Color.Green},color:{Color.Black}'
    InputData = f'fill:{Color.RED},color:{Color.Black}'

class NodeShape:
    default = lambda x: f'{x}["{x}"]' # 矩形
    LLMNode = lambda x: f'{x}["{x}"]'
    RAGNode = lambda x: f'{x}("{x}")' # 圆角矩形
    LoopNode = lambda x: f'{x}(("{x}"))' # 圆形
    BranchNode = lambda x: f'{x}{{"{x}"}}'
    CodeNode = lambda x: f'{x}[/"{x}"/]'
    WebNode = lambda x: f'{x}("{x}")'
    ValueNode = lambda n, x: f'{n}{{{{"{x}"}}}}'
    ExitNode = lambda x: f'{x}[["{x}"]]'
    FileNode = lambda x: f'{x}["{x}"]'
    Data = lambda x: f'{x}(["{x}"])'
    InputData = lambda x: f'{x}(["{x}"])'

class Data:
    mermaid_style = NodeColorStyle.Data
    mermaid_shape = NodeShape.Data

class InputData:
    mermaid_style = NodeColorStyle.InputData
    mermaid_shape = NodeShape.InputData
