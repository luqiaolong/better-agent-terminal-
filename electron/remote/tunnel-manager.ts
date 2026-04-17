import { networkInterfaces } from 'os'
import { logger } from '../logger'

export type TunnelMode = 'localhost' | 'tailscale' | 'lan'

export interface NetworkAddress {
  ip: string
  mode: TunnelMode
  label: string  // e.g. "en0 (Tailscale)" or "en0 (LAN)"
}

export interface TunnelResult {
  url: string
  token: string
  fingerprint: string
  mode: TunnelMode
  addresses: NetworkAddress[]
}

/**
 * Build a connection URL and list of candidate addresses for the given server.
 *
 * If `boundHost` is 127.0.0.1/::1 we only return the loopback address, because
 * the server literally isn't accepting connections from any other interface.
 */
export function getConnectionInfo(
  port: number,
  token: string,
  fingerprint: string,
  boundHost: string
): TunnelResult | { error: string } {
  const addresses = getAllAddresses(boundHost)
  if (addresses.length === 0) return { error: 'No network interface found' }

  const primary = addresses[0]
  const url = `wss://${primary.ip}:${port}`
  logger.log(`[TunnelManager] Primary: ${url} (${primary.label}), ${addresses.length} addresses available`)
  return { url, token, fingerprint, mode: primary.mode, addresses }
}

function getAllAddresses(boundHost: string): NetworkAddress[] {
  // Loopback-only: the server rejects off-host traffic, so don't even
  // advertise external IPs in QR codes.
  if (boundHost === '127.0.0.1' || boundHost === '::1' || boundHost === 'localhost') {
    return [{ ip: '127.0.0.1', mode: 'localhost', label: 'localhost — 127.0.0.1' }]
  }

  const nets = networkInterfaces()
  const tailscale: NetworkAddress[] = []
  const lan: NetworkAddress[] = []

  for (const [name, iface] of Object.entries(nets)) {
    if (!iface) continue
    for (const net of iface) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (net.address.startsWith('100.')) {
        tailscale.push({ ip: net.address, mode: 'tailscale', label: `${name} — ${net.address} (Tailscale)` })
      } else {
        lan.push({ ip: net.address, mode: 'lan', label: `${name} — ${net.address} (LAN)` })
      }
    }
  }

  return [...tailscale, ...lan]
}
