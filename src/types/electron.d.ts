// Window.electronAPI shape is inferred from the contextBridge object in
// electron/preload.ts. Do NOT duplicate the method list here — TS type-only
// imports don't run any electron code, so the renderer tsconfig can safely
// reach across the project boundary for typing.
import type { ElectronAPI } from '../../electron/preload'

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
