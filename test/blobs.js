const test = require('brittle')
const b4a = require('b4a')
const tmp = require('test-tmp')
const Autobase = require('autobase')
const Corestore = require('corestore')
const { testBlobServer, testHyperblobs, fetch } = require('./helpers')

test('can get blob from hypercore', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Hello World')
})

test('can get encrypted blob from hypercore', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  await blobs.core.setEncryptionKey(b4a.alloc(32).fill('a'))

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store, {
    resolve: function (key) {
      return { key, encryptionKey: b4a.alloc(32).fill('a') }
    }
  })
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.absent((await res.text()).includes('Hello Wolrd'))
})

test('can get blob from hypercore - multiple blocks', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)
  blobs.blockSize = 4 // force multiple blocks

  const id = await blobs.put(b4a.from('Hello World'))
  t.is(id.blockLength, 3) // 3 blocks

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Hello World')
})

test('can get a partial blob from hypercore', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })

  const res = await fetch(link, { headers: { range: 'bytes=3-7' } })
  t.is(await res.text(), 'lo Wo')
  t.is(res.status, 206)
})

test('can get a partial blob from hypercore, but request the whole data', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link, { headers: { range: 'bytes=0-10' } })
  t.is(res.status, 206)
  t.is(await res.text(), 'Hello World')
})

test('handle out of range header end', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link, { headers: { range: 'bytes=0-20' } })
  t.is(res.status, 206)
  t.is(await res.text(), 'Hello World')
})

test('handle range header without end', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link, { headers: { range: 'bytes=2-' } })
  t.is(res.status, 206)
  t.is(await res.text(), 'llo World')
})

test('handle invalid range header', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link, { headers: { range: 'testing' } })
  t.is(res.status, 200)
  t.is(await res.text(), 'Hello World')
})

test('server could clear blobs', async function (t) {
  const store = new Corestore(await tmp())

  const core = store.get({ name: 'test' })
  await core.append([b4a.from('abc'), b4a.from('d'), b4a.from('efg')])

  const server = testBlobServer(t, store)
  await server.listen()

  await server.clear(core.key, {
    blob: {
      blockOffset: 0,
      blockLength: 2,
      byteOffset: 0,
      byteLength: 4
    }
  })

  t.is(await core.get(0, { wait: false }), null)
  t.is(await core.get(1, { wait: false }), null)
  t.alike(await core.get(2, { wait: false }), b4a.from('efg'))
})

test('autobase batches work', async function (t) {
  const store = new Corestore(await tmp())
  const base = new Autobase(store.session(), {
    open (store) {
      return store.get('view')
    },
    async apply (nodes, view) {
      for (const node of nodes) {
        await view.append(node.value)
      }
    }
  })

  await base.append('a\n')
  await base.append('b\n')
  await base.append('c\n')
  await base.append('d\n')

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(base.view.key, { blob: { blockOffset: 0, blockLength: 4, byteOffset: 0, byteLength: 8 } })
  const res = await fetch(link)

  t.is(res.status, 200)
  t.is(await res.text(), 'a\nb\nc\nd\n')

  await base.close()
})

test('autobase batches work with a tip', async function (t) {
  const store = new Corestore(await tmp())
  const base1 = new Autobase(store.session(), {
    open (store) {
      return store.get('view')
    },
    async apply (nodes, view, host) {
      if (view.length === 0) {
        await host.addWriter(base2.local.key)
      }
      for (const node of nodes) {
        await view.append(node.value)
      }
    }
  })

  await base1.ready()

  const store2 = new Corestore(await tmp())
  const base2 = new Autobase(store2.session(), base1.key, {
    open (store) {
      return store.get('view')
    },
    async apply (nodes, view, host) {
      if (view.length === 0) {
        await host.addWriter(base2.local.key)
      }
      for (const node of nodes) {
        await view.append(node.value)
      }
    }
  })

  await base2.ready()

  const s1 = base1.replicate(true)
  const s2 = base2.replicate(false)

  s1.pipe(s2).pipe(s1)

  await base1.append('a')
  await base2.waitForWritable()
  await base2.append('a')
  await base1.append('a')

  while (base1.linearizer.indexers.length < 2) {
    await base1.append('a')
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  await base1.append('a')
  await base1.append('a')
  await base1.append('a')
  await base1.append('a')
  await base1.append('a')

  const id = {
    blockOffset: 0,
    blockLength: base1.view.length,
    byteOffset: 0,
    byteLength: base1.view.byteLength
  }

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(base1.view.key, { blob: id })
  const res = await fetch(link)

  t.is(res.status, 200)

  const text = await res.text()
  t.is(text, 'a'.repeat(base1.view.length))

  await base1.close()
  await base2.close()

  await store2.close()
})
