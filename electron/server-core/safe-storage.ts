// SafeStorage abstraction — Electron mode delegates to electron.safeStorage
// (OS-keychain backed encryption). Headless mode falls back to plaintext with
// 0o600 file permissions. Headless callers must accept that secrets at rest
// are no stronger than filesystem ACLs.

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plaintext: string): Buffer
  decryptString(encrypted: Buffer): string
}

let adapter: SafeStorageAdapter | null = null

export function setSafeStorage(impl: SafeStorageAdapter): void {
  adapter = impl
}

export function getSafeStorage(): SafeStorageAdapter {
  if (!adapter) {
    throw new Error('[safe-storage] getSafeStorage() called before setSafeStorage() — initialize at app startup')
  }
  return adapter
}

// Plaintext adapter for headless mode. encryptString returns the raw UTF-8
// bytes; decryptString reads them back. Files using this adapter rely on the
// caller writing with mode 0o600.
export const plaintextSafeStorage: SafeStorageAdapter = {
  isEncryptionAvailable: () => false,
  encryptString: (plaintext: string) => Buffer.from(plaintext, 'utf-8'),
  decryptString: (encrypted: Buffer) => encrypted.toString('utf-8'),
}
