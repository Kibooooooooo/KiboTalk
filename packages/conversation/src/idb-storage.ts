import type { ConversationStorage } from './storage'
import type { ConversationTurn } from './types'

const DB_NAME = 'kibotalk-conversation'
const STORE_NAME = 'turns'
const DB_VERSION = 1

/**
 * IndexedDB-backed conversation storage. Append-only log keyed by turn id;
 * survives refresh. Production adapter for `apps/web`. The session is the
 * entire contents of the `turns` object store — MVP has no history list, so
 * "active session" = all rows.
 */
export class IndexedDbConversationStorage implements ConversationStorage {
  private dbName: string
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(dbName = DB_NAME) {
    this.dbName = dbName
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return this.dbPromise
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.openDb()
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
  }

  async appendTurn(turn: ConversationTurn): Promise<void> {
    const store = await this.tx('readwrite')
    await reqToPromise(store.add(turn))
  }

  async loadActiveSession(): Promise<ConversationTurn[] | null> {
    const store = await this.tx('readonly')
    const all = (await reqToPromise(store.getAll())) as ConversationTurn[]
    if (all.length === 0) return null
    return all.sort((a, b) => a.startedAt - b.startedAt)
  }

  async clearActiveSession(): Promise<void> {
    const store = await this.tx('readwrite')
    await reqToPromise(store.clear())
  }
}

function reqToPromise(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
