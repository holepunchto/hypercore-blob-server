const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const { testServeBlobs, request, testHyperblobs } = require('./helpers')

test('can get blob from hypercore', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, blobs.core.key, { blob: id })

  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})

test('can get blob from hypercore - multiple blocks', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)
  blobs.blockSize = 4 // force multiple blocks

  const id = await blobs.put(Buffer.from('Hello World'))

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, blobs.core.key, { blob: id })

  t.is(res.status, 200)
  t.is(res.data, 'Hello World')
})

test('can get a partial blob from hypercore', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, blobs.core.key, { blob: id, range: 'bytes=3-7' })
  t.is(res.status, 206)
  t.is(res.data, 'lo Wo')
})

test('can get a partial blob from hypercore, but request the whole data', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, blobs.core.key, { blob: id, range: 'bytes=0-10' })
  t.is(res.status, 206)
  t.is(res.data, 'Hello World')
})

test('can get a partial blob from hypercore, out of range', async function (t) {
  const store = new Corestore(RAM)

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(Buffer.from('Hello World'))

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, blobs.core.key, { blob: id, range: 'bytes=0-11' })
  t.is(res.status, 206)
  t.is(res.data, 'Hello World')
})
