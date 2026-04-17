import * as fs from 'fs'
import * as path from 'path'
import { createHash } from 'crypto'
import selfsigned from 'selfsigned'
import { logger } from '../logger'
import { readEncryptedJson, writeEncryptedJson } from './secrets'

export interface ServerCertificate {
  cert: string       // PEM
  privateKey: string // PEM
  fingerprint256: string // SHA-256 of DER cert, uppercase hex with colons (e.g. "AB:CD:...")
}

interface StoredCertificate {
  cert: string
  privateKey: string
  createdAt: number
}

const CERT_FILE = 'server-cert.enc.json'
const DEFAULT_VALIDITY_DAYS = 3650 // 10 years — self-signed, user controls trust via pinning

function computeFingerprint(certPem: string): string {
  // Strip PEM header/footer and whitespace, decode base64, SHA-256
  const der = Buffer.from(
    certPem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, ''),
    'base64'
  )
  const hex = createHash('sha256').update(der).digest('hex').toUpperCase()
  return hex.match(/.{2}/g)!.join(':')
}

function generate(): StoredCertificate {
  const attrs = [{ name: 'commonName', value: 'better-agent-terminal' }]
  const pems = selfsigned.generate(attrs, {
    keySize: 2048,
    days: DEFAULT_VALIDITY_DAYS,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      {
        name: 'keyUsage',
        keyCertSign: false,
        digitalSignature: true,
        keyEncipherment: true
      },
      {
        name: 'extKeyUsage',
        serverAuth: true,
        clientAuth: true
      },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' }
        ]
      }
    ]
  })
  return { cert: pems.cert, privateKey: pems.private, createdAt: Date.now() }
}

/**
 * Load an existing server certificate (safeStorage-encrypted at rest) or generate a new one.
 * Fingerprint is derived from the cert — not stored — so there is no drift.
 */
export function ensureCertificate(configDir: string): ServerCertificate {
  const certPath = path.join(configDir, CERT_FILE)
  let stored = readEncryptedJson<StoredCertificate>(certPath)

  if (!stored || !stored.cert || !stored.privateKey) {
    logger.log('[certificate] generating new self-signed cert')
    stored = generate()
    try {
      writeEncryptedJson(certPath, stored)
    } catch (e) {
      logger.error('[certificate] failed to persist cert:', e)
    }
  }

  return {
    cert: stored.cert,
    privateKey: stored.privateKey,
    fingerprint256: computeFingerprint(stored.cert)
  }
}

/**
 * Compute the SHA-256 fingerprint of a PEM-encoded certificate.
 * Exported for client-side pin comparison.
 */
export function fingerprintOfPem(pem: string): string {
  return computeFingerprint(pem)
}

/**
 * Normalize a fingerprint string for comparison: strip colons/spaces, uppercase.
 */
export function normalizeFingerprint(fp: string): string {
  return fp.replace(/[:\s]/g, '').toUpperCase()
}
