// Desktop notification abstraction — Electron mode shows native notifications
// via electron.Notification; headless mode silently no-ops since there's no
// desktop session to notify.

export interface NotifierOptions {
  title: string
  body: string
  silent?: boolean
  onClick?: () => void
}

export interface Notifier {
  isSupported(): boolean
  show(options: NotifierOptions): void
}

let notifier: Notifier | null = null

export function setNotifier(impl: Notifier): void {
  notifier = impl
}

export function getNotifier(): Notifier {
  return notifier ?? noopNotifier
}

export const noopNotifier: Notifier = {
  isSupported: () => false,
  show: () => { /* headless: no UI to notify */ },
}
