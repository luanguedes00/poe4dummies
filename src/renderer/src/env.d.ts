import type { OraculoApi } from '../../shared/ipc'

declare global {
  interface Window {
    oraculo: OraculoApi
  }
}

export {}
