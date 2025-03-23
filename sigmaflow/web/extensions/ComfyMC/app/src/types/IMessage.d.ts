export type IMenuMessageType =
  | 'rename'
  | 'set-thumb'
  | 'save-template'
  | IMessageType

export type IActionMessageType = 'open-console' | 'open-manager' | IMessageType

export type IMessageType =
  | 'load-prompt'
  | 'get-prompt'
  | 'refresh-defs'
  | 'export'
  | 'import'
  | 'clear'
  | 'undo'
  | 'redo'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'editor-settings'
  | 'arrange'
  | 'queue-prompt'
