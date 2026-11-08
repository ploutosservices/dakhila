// THE ROSTER'S STORE, AS ITS CODE NAMES IT: `db` is the store over the pool the host handed in (ports.ts `pool`, made
// by store.ts), read on every use, so importing this module stays free and a host or a test that fills the ports
// later is the one used.
import { store, type Store } from '../store'

export const db: Store = new Proxy({} as Store, {
  get(_, key) {
    const s = store()
    const v = Reflect.get(s, key, s)
    return typeof v === 'function' ? v.bind(s) : v
  },
})
