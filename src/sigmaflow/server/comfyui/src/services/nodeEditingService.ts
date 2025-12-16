import { LGraphNode, LiteGraph } from '@/lib/litegraph/src/litegraph'
import { useDialogStore } from '@/stores/dialogStore'
import NodeEditingDialogContent from '@/components/dialog/content/NodeEditingDialogContent.vue'


/**
 * Service for dynamically editing node inputs and outputs
 */
export const useNodeEditingService = () => {
  /**
   * Add a new input to a node
   * @param node - The node to add input to
   * @param inputName - Name of the new input
   * @param inputType - Type of the new input
   * @param isOptional - Whether the input is optional
   */
  function addNodeInput(
    node: LGraphNode,
    inputName: string,
    inputType: string = 'STRING',
    isOptional: boolean = false
  ): void {
    // Check if input already exists
    if (node.findInputSlot(inputName) !== -1) {
      console.warn(`Input "${inputName}" already exists on node`)
      return
    }

    // Add the input slot
    node.addInput(inputName, inputType, {
      shape: isOptional ? 1 : undefined, // 1 is HollowCircle shape
      localized_name: inputName
    })

    // Resize node to accommodate new input
    const size = node.computeSize()
    node.setSize(size)

    // Mark the node as modified
    if (node.graph) {
      node.graph.change()
    }
  }

  /**
   * Remove an input from a node
   * @param node - The node to remove input from
   * @param inputName - Name of the input to remove
   */
  function removeNodeInput(node: LGraphNode, inputName: string): void {
    const inputSlot = node.findInputSlot(inputName)
    if (inputSlot === -1) {
      console.warn(`Input "${inputName}" not found on node`)
      return
    }

    // Disconnect any connections to this input
    if (node.inputs[inputSlot]?.link) {
      node.disconnectInput(inputSlot)
    }

    // Remove the input slot
    node.removeInput(inputSlot)

    // Resize node
    const size = node.computeSize()
    node.setSize(size)

    // Mark the node as modified
    if (node.graph) {
      node.graph.change()
    }
  }

  /**
   * Add a new output to a node
   * @param node - The node to add output to
   * @param outputName - Name of the new output
   * @param outputType - Type of the new output
   * @param isList - Whether the output is a list
   */
  function addNodeOutput(
    node: LGraphNode,
    outputName: string,
    outputType: string = 'STRING',
    isList: boolean = false
  ): void {
    // Check if output already exists
    if (node.findOutputSlot(outputName) !== -1) {
      console.warn(`Output "${outputName}" already exists on node`)
      return
    }

    // Add the output slot
    node.addOutput(outputName, outputType, {
      shape: isList ? LiteGraph.GRID_SHAPE : undefined,
      localized_name: outputName
    })

    // Resize node to accommodate new output
    const size = node.computeSize()
    node.setSize(size)

    // Mark the node as modified
    if (node.graph) {
      node.graph.change()
    }
  }

  /**
   * Remove an output from a node
   * @param node - The node to remove output from
   * @param outputName - Name of the output to remove
   */
  function removeNodeOutput(node: LGraphNode, outputName: string): void {
    const outputSlot = node.findOutputSlot(outputName)
    if (outputSlot === -1) {
      console.warn(`Output "${outputName}" not found on node`)
      return
    }

    // Disconnect any connections from this output
    if (node.outputs[outputSlot]?.links?.length) {
      // Disconnect all links from this output
      const links = [...(node.outputs[outputSlot].links || [])]
      links.forEach(linkId => {
        if (node.graph) {
          const link = node.graph.links[linkId]
          if (link) {
            node.graph.removeLink(linkId)
          }
        }
      })
    }

    // Remove the output slot
    node.removeOutput(outputSlot)

    // Resize node
    const size = node.computeSize()
    node.setSize(size)

    // Mark the node as modified
    if (node.graph) {
      node.graph.change()
    }
  }

  /**
   * Toggle widget visibility for a node
   * @param node - The node to toggle widgets for
   * @param visible - Whether widgets should be visible
   */
  function toggleNodeWidgets(node: LGraphNode, visible: boolean): void {
    if (!node.widgets) return

    node.widgets.forEach(widget => {
      if (widget.options) {
        widget.options.hidden = !visible
      }
    })

    // Resize node based on widget visibility
    const size = node.computeSize()
    node.setSize(size)

    // Mark the node as modified
    if (node.graph) {
      node.graph.change()
    }
  }

  /**
   * Get available input types for adding new inputs
   */
  function getAvailableInputTypes(): string[] {
    return [
      'STRING',
      'INT',
      'FLOAT',
      'BOOLEAN',
      'IMAGE',
      'LATENT',
      'CONDITIONING',
      'MODEL',
      'VAE',
      'CLIP',
      'CONTROL_NET',
      'MASK'
    ]
  }

  /**
   * Get available output types for adding new outputs
   */
  function getAvailableOutputTypes(): string[] {
    return [
      'STRING',
      'INT',
      'FLOAT',
      'BOOLEAN',
      'IMAGE',
      'LATENT',
      'CONDITIONING',
      'MODEL',
      'VAE',
      'CLIP',
      'CONTROL_NET',
      'MASK'
    ]
  }

  return {
    addNodeInput,
    removeNodeInput,
    addNodeOutput,
    removeNodeOutput,
    toggleNodeWidgets,
    getAvailableInputTypes,
    getAvailableOutputTypes
  }
}

/**
 * Service for managing node editing dialogs
 */
export const useNodeEditingDialogService = () => {
  const dialogStore = useDialogStore()

  /**
   * Show the node editing dialog
   * @param node - The node to edit
   * @param initialTab - The initial tab to show
   */
  function showNodeEditingDialog(
    node: LGraphNode,
    initialTab: 'addInput' | 'removeInput' | 'addOutput' | 'removeOutput' = 'addInput'
  ) {
    const nodeTitle = node.title || node.type || '未知节点'
    
    dialogStore.showDialog({
      key: `node-editing-${node.id}`,
      title: `${nodeTitle}`,
      component: NodeEditingDialogContent,
      props: {
        node,
        initialTab
      },
      dialogComponentProps: {
        modal: true,
        closable: true,
        maximizable: false,
        dismissableMask: true,
        closeOnEscape: true,
        position: 'center'
      }
    })
  }

  return {
    showNodeEditingDialog
  }
}