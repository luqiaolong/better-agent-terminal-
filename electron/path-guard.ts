import * as os from 'os'
import * as path from 'path'

/**
 * Deny-list guard for filesystem handlers. Blocks paths that are clearly
 * credential stores so that a malicious/authenticated remote client can't
 * trivially exfiltrate secrets via fs:readFile / image:read-as-data-url.
 *
 * This is a practical harm-reduction measure — it does NOT sandbox to a
 * workspace root, because legitimate use cases (Claude reading ~/.bashrc,
 * /etc/hosts, etc.) need broad read access. Stricter scoping would belong
 * at the IPC layer via ctx.isRemote, which we don't yet propagate.
 */

const home = os.homedir()

const DENIED_SUFFIXES = [
  // SSH keys
  path.join(home, '.ssh'),
  // AWS credentials
  path.join(home, '.aws', 'credentials'),
  path.join(home, '.aws', 'config'),
  // GCP service account keys
  path.join(home, '.config', 'gcloud'),
  // GitHub / gh CLI
  path.join(home, '.config', 'gh', 'hosts.yml'),
  // Generic secrets
  path.join(home, '.netrc'),
  path.join(home, '.pgpass'),
  // Kubernetes contexts
  path.join(home, '.kube', 'config'),
  // macOS Keychain
  path.join(home, 'Library', 'Keychains'),
  // Browser credential stores (Chrome/Brave/Edge Login Data, Cookies)
  path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
  path.join(home, 'Library', 'Application Support', 'BraveSoftware'),
  path.join(home, 'Library', 'Application Support', 'Microsoft Edge'),
  path.join(home, 'Library', 'Application Support', 'Firefox'),
  // BAT's own secrets (token + cert)
  path.join(home, 'Library', 'Application Support', 'better-agent-terminal', 'server-cert.enc.json'),
  path.join(home, 'Library', 'Application Support', 'better-agent-terminal', 'server-token.enc.json'),
  path.join(home, 'Library', 'Application Support', 'better-agent-terminal', 'claude-account-creds.enc.json'),
  // Linux / XDG
  path.join(home, '.config', 'better-agent-terminal', 'server-cert.enc.json'),
  path.join(home, '.config', 'better-agent-terminal', 'server-token.enc.json'),
  path.join(home, '.mozilla'),
  // Claude Code CLI state
  path.join(home, '.claude', '.credentials.json'),
  // Windows credential store (best-effort; WinAPI stores also apply)
  'C:\\Windows\\System32\\config',
  // System-wide
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/ssh/ssh_host_rsa_key',
  '/etc/ssh/ssh_host_ed25519_key',
  '/root',
  '/private/etc/master.passwd',
]

/**
 * Return true if `absolutePath` lies inside any denied directory or IS a denied file.
 * Caller should pass an already-resolved absolute path.
 */
export function isSensitivePath(absolutePath: string): boolean {
  if (!absolutePath) return true
  const normalized = path.normalize(absolutePath)
  for (const denied of DENIED_SUFFIXES) {
    const normDenied = path.normalize(denied)
    if (normalized === normDenied) return true
    // Directory match: path starts with denied + separator
    if (normalized.startsWith(normDenied + path.sep)) return true
  }
  // Also block any file matching well-known private key naming patterns anywhere.
  const base = path.basename(normalized)
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(base) && normalized.includes(`${path.sep}.ssh${path.sep}`)) return true
  if (/\.pem$/i.test(base) && (normalized.includes(`${path.sep}.ssh${path.sep}`) || normalized.includes(`${path.sep}keys${path.sep}`))) return true
  return false
}
