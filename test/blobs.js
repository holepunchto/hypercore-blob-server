const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const { testBlobServer, request, testHyperblobs } = require('./helpers')

test('can get blob from hypercore', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id })

  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})

test('can get blob from hypercore - multiple blocks', async function (t) {
  const store = new Corestore(RAM)

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
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=3-7' })
  t.is(res.status, 206)
  t.is(res.data, 'lo Wo')
})

test('can get a partial blob from hypercore, but request the whole data', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=0-10' })
  t.is(res.status, 206)
  t.is(res.data, 'Hello World')
})

test('handle out of range header end', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=0-20' })
  t.is(res.status, 206)
  t.is(res.data, 'Hello World')
})

test('handle range header without end', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'bytes=2-' })
  t.is(res.status, 206)
  t.is(res.data, 'llo World')
})

test('handle invalid range header', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, blobs.core.key, { blob: id, range: 'testing' })
  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})
