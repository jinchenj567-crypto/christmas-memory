import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Reproduce request success followed by transaction commit/rollback, without
// opening or clearing any real user's IndexedDB database.
const source = await readFile(new URL('../src/db.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText
let serial = 0
async function fixture() {
  let transaction
  const request = { result: 'saved-id' }
  globalThis.window = {
    indexedDB: {
      open() {
        const openRequest = { result: {
          transaction() {
            transaction = { objectStore: () => ({ put: () => request, delete: () => request }) }
            return transaction
          },
        } }
        queueMicrotask(() => openRequest.onsuccess())
        return openRequest
      },
    },
  }
  globalThis.indexedDB = window.indexedDB
  const { db } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}#${serial++}`)
  return { db, request, transaction: () => transaction }
}

test('a successful request does not report a save before transaction commit', async () => {
  const f = await fixture()
  let settled = false
  const saving = f.db.put({ id: 'test' }).then(value => { settled = true; return value })
  await new Promise(resolve => setImmediate(resolve))
  f.request.onsuccess?.()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  f.transaction().oncomplete()
  assert.equal(await saving, 'saved-id')
})

test('rollback after a successful request rejects the save', async () => {
  const f = await fixture()
  const saving = f.db.put({ id: 'test' })
  const rejected = assert.rejects(saving, /aborted/)
  await new Promise(resolve => setImmediate(resolve))
  f.request.onsuccess?.()
  f.transaction().onabort()
  await rejected
})

test('failed deletion is not reported as successful', async () => {
  const f = await fixture()
  const deleting = f.db.remove('test')
  const rejected = assert.rejects(deleting, /unavailable/)
  await new Promise(resolve => setImmediate(resolve))
  f.transaction().error = new Error('storage unavailable')
  f.transaction().onerror()
  await rejected
})
