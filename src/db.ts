// Minimal IndexedDB wrapper: memories stay on this device.

export interface StoredMemory {
  id: string
  date: string // YYYY-MM-DD
  title: string
  note: string
  blob: Blob
  created: number
}

const DB = 'a-year-in-light'
const STORE = 'memories'

let dbp: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no indexedDB'))
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        // A successful request can still be rolled back before the transaction commits.
        t.oncomplete = () => resolve(req.result)
        t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted'))
        t.onerror = () => reject(t.error ?? req.error)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const db = {
  all: () => tx<StoredMemory[]>('readonly', (s) => s.getAll() as IDBRequest<StoredMemory[]>).catch(() => [] as StoredMemory[]),
  put: (m: StoredMemory) => tx('readwrite', (s) => s.put(m)),
  remove: (id: string) => tx('readwrite', (s) => s.delete(id)),
}
