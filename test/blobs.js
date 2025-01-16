const test = require('brittle')
const b4a = require('b4a')
const tmp = require('test-tmp')
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

test.solo('can get encrypted blob from hypercore', async function (t) {
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
  const stream = res.body.pipeThrough(new TextDecoderStream())
  for await (const value of stream) {
    console.log(value)
  }
  // t.absent(text.includes('Hello Wolrd'))
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

test.skip('handle out of range header end', async function (t) {
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

test.skip('server could clear blobs', async function (t) {
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
  // const link = server.getLink(core.key, {
  //   blob: {
  //     blockOffset: 0,
  //     blockLength: 2,
  //     byteOffset: 0,
  //     byteLength: 4
  //   }
  // })
  // const res = await fetch(link)
  // t.is(res.status, 404)
  // t.is(await res.text(), '')
})
