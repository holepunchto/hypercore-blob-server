const test = require('brittle')
const b4a = require('b4a')
const tmp = require('test-tmp')
const Corestore = require('corestore')
const { testBlobServer, request, testHyperblobs } = require('./helpers')

test('can get blob from hypercore', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id })

  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})

test('can get encrypted blob from hypercore', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store, {
    resolve: function (key) {
      return { key, encryptionKey: b4a.alloc(32).fill('a') }
    }
  })
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id })

  t.is(res.status, 200)
  t.absent(res.data.includes('Hello Wolrd'))
})

test('can get blob from hypercore - multiple blocks', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)
  blobs.blockSize = 4 // force multiple blocks

  const id = await blobs.put(Buffer.from('Hello World'))
  t.is(id.blockLength, 3) // 3 blocks

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id })

  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})

test('can get a partial blob from hypercore', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=3-7' })
  t.is(res.status, 206)
  t.is(res.data, 'lo Wo')
})

test('can get a partial blob from hypercore, but request the whole data', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=0-10' })
  t.is(res.status, 206)
  t.is(res.data, 'Hello World')
})

test('handle out of range header end', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=0-20' })
  t.is(res.status, 206)
  t.is(res.data, 'Hello World')
})

test('handle range header without end', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=2-' })
  t.is(res.status, 206)
  t.is(res.data, 'llo World')
})

test('handle invalid range header', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'testing' })
  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})

test('server could clear blobs', async function (t) {
  const store = new Corestore(await tmp())

  const core = store.get({ name: 'test' })
  await core.append([Buffer.from('abc'), Buffer.from('d'), Buffer.from('efg')])

  const server = testBlobServer(t, store)
  await server.listen()

  await server.clear(core.key, {
    blob: {
      blockOffset: 0,
      blockLength: 2
    }
  })

  t.is(await core.get(0, { wait: false }), null)
  t.is(await core.get(1, { wait: false }), null)
  t.alike(await core.get(2, { wait: false }), Buffer.from('efg'))
})
