import { serializedLGraph } from './litegraph'

export namespace IComfy {
  interface Extension {
    name: string
    [key: string]: any
  }

  interface NodeDef {
    input: { [key: string]: any }
    output: any[]
    output_is_list: any[]
    output_name: any[]
    name: string
    display_name: string
    description: string
    category: string
    output_node: boolean
  }

  interface Node {
    id: number
    inputs?: Input[]
    outputs?: Output[]
    title: string
    mode: number
    order: number
    size: { 0: number; 1: number }
    pos: number[]
    type: string
    widgets: any[]
    widgets_values: any[]
    properties: any
    flags: any
    bgcolor: string
    is_selected: boolean
    properties_info: any[]
    serialize_widgets: boolean
    shape: any
    imgs?: any[]
  }

  interface Input {
    name: string
    type: string
    link: number
  }

  interface Output {
    title: string
    name: string
    type: string
    links: number[]
    slot_index: number
  }

  interface Widget {
    title: string
    name: string
    type: string
    value: any
    options: any
  }

  interface AppGraphPromptNode {
    id: number
    title: string
    type: string
    inputs: Input[]
    outputs: Output[]
    widgets: Widget[]
  }

  interface AppGraphPrompt {
    nodes: AppGraphPromptNode[]
    output: {
      [key: number]: {
        class_type: string
        inputs: {
          [key: string]: any
        }
      }
    }
    workflow: serializedLGraph
  }
}
