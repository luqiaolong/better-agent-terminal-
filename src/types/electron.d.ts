import type { CreatePtyOptions } from './index'

interface ElectronAPI {
  platform: 'win32' | 'darwin' | 'linux'
  pty: {
    create: (options: CreatePtyOptions) => Promise<boolean>
    write: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    kill: (id: string) => Promise<boolean>
    restart: (id: string, cwd: string, shell?: string) => Promise<boolean>
    getCwd: (id: string) => Promise<string | null>
    onOutput: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
  }
  workspace: {
    save: (data: string) => Promise<boolean>
    load: () => Promise<string | null>
    moveToWindow: (sourceWindowId: string, targetWindowId: string, workspaceId: string, insertIndex: number) => Promise<boolean>
    onReload: (callback: () => void) => () => void
  }
  settings: {
    save: (data: string) => Promise<boolean>
    load: () => Promise<string | null>
    getShellPath: (shell: string) => Promise<string>
  }
  dialog: {
    selectFolder: () => Promise<string[] | null>
  }
  clipboard: {
    saveImage: () => Promise<string | null>
    writeImage: (filePath: string) => Promise<boolean>
  }
  app: {
    openNewInstance: (profileId: string) => Promise<{ alreadyOpen: boolean; windowId?: string; windowIds?: string[] }>
    getLaunchProfile: () => Promise<string | null>
  }
  tunnel: {
    getConnection: () => Promise<{ url: string; token: string; mode: string; addresses: { ip: string; mode: string; label: string }[] } | { error: string }>
  }
  shell: {
    openExternal: (url: string) => Promise<void>
    openPath: (folderPath: string) => Promise<void>
  }
  git: {
    getGithubUrl: (folderPath: string) => Promise<string | null>
    getBranch: (cwd: string) => Promise<string | null>
    getLog: (cwd: string, count?: number) => Promise<{ hash: string; author: string; date: string; message: string }[]>
    getDiff: (cwd: string, commitHash?: string, filePath?: string) => Promise<string>
    getDiffFiles: (cwd: string, commitHash?: string) => Promise<{ path: string; status: string }[]>
    getStatus: (cwd: string) => Promise<{ path: string; status: string }[]>
    getRoot: (cwd: string) => Promise<string | null>
  }
  github: {
    checkCli: () => Promise<{ installed: boolean; authenticated: boolean }>
    listPRs: (cwd: string) => Promise<unknown>
    listIssues: (cwd: string) => Promise<unknown>
    viewPR: (cwd: string, number: number) => Promise<unknown>
    viewIssue: (cwd: string, number: number) => Promise<unknown>
    commentPR: (cwd: string, number: number, body: string) => Promise<{ success: true } | { error: string }>
    commentIssue: (cwd: string, number: number, body: string) => Promise<{ success: true } | { error: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
