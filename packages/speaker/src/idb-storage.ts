import type { Embedding } from './types'
import type { EmbeddingStorage } from './storage'

const DB_NAME = 'kibotalk-speaker'
const STORE_NAME = 'embedding'
const KEY = 'enrolled'
const DB_VERSION = 1

/**
 * IndexedDB-backed embedding storage (one enrolled embedding per device).
 * The embedding vector is stored as a regular array (IndexedDB structured-clones
 * Float32Array fine, but arrays survive schema changes more forgivingly).
 */
export class IndexedDbEmbeddingStorage implements EmbeddingStorage {
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
          db.createObjectStore(STORE_NAME)
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

  async load(): Promise<Embedding | null> {
    const store = await this.tx('readonly')
    const raw = (await reqToPromise(store.get(KEY))) as
      | { vector: number[]; createdAt: number; passphrase?: string }
      | undefined
    if (!raw) return null
    return {
      vector: new Float32Array(raw.vector),
      createdAt: raw.createdAt,
      ...(raw.passphrase !== undefined ? { passphrase: raw.passphrase } : {}),
    }
  }

  async save(embedding: Embedding): Promise<void> {
    const store = await this.tx('readwrite')
    await reqToPromise(
      store.put(
        {
          vector: Array.from(embedding.vector),
          createdAt: embedding.createdAt,
          ...(embedding.passphrase !== undefined ? { passphrase: embedding.passphrase } : {}),
        },
        KEY,
      ),
    )
  }

  async clear(): Promise<void> {
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
