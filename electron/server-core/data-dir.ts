// Data directory provider — abstracts Electron's app.getPath('userData') so
// modules outside Electron (headless CLI server, tests) can supply their own
// storage location. setDataDir() must be called before any consumer reads it.

let dataDir: string | null = null

export function setDataDir(dir: string): void {
  dataDir = dir
}

export function getDataDir(): string {
  if (!dataDir) {
    throw new Error('[data-dir] getDataDir() called before setDataDir() — initialize at app startup')
  }
  return dataDir
}

export function isDataDirSet(): boolean {
  return dataDir !== null
}
