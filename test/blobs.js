const test = require('brittle')
const b4a = require('b4a')
const tmp = require('test-tmp')
const Corestore = require('corestore')
const { testBlobServer, testHyperblobs, fetch } = require('./helpers')
const http = require('http')

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

test('request bad range', async function (t) {
  const store = new Corestore(await tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })

  {
    const res = await fetch(link, { headers: { range: 'bytes=129-1210' } })
    t.is(res.status, 416, 'returns 416')
    t.is(res.headers.get('content-range'), `bytes */${id.byteLength}`, 'returns content-range w/ "*"/length')
  }

  {
    const res = await fetch(link, { headers: { range: 'bytes=1337-123' } })
    t.is(res.status, 416, 'returns 416 for start > end')
  }

  {
    const res = await fetch(link, { headers: { range: 'bytes=0-123' } })
    t.is(res.status, 206, 'returns 206 for end > length')
    t.is(res.headers.get('content-range'), `bytes 0-${id.byteLength - 1}/${id.byteLength}`, 'returns content-range')
  }
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

  const bytesCleared = await server.clear(core.key, {
    blob: {
      blockOffset: 0,
      blockLength: 2,
      byteOffset: 0,
      byteLength: 4
    }
  })

  t.is(bytesCleared, 4)
  t.is(await core.get(0, { wait: false }), null)
  t.is(await core.get(1, { wait: false }), null)
  t.alike(await core.get(2, { wait: false }), b4a.from('efg'))
})

test('support blob links', async function (t) {
  const store = new Corestore(await tmp())

  const server = testBlobServer(t, store)
  await server.listen()

  const url1 = server.getBlobLink(Buffer.from('hello world'))
  const url2 = server.getBlobLink(Buffer.from('hej verden'))

  {
    const res = await fetch(url1)
    t.is(res.status, 200)
    t.is(await res.text(), 'hello world')
  }

  {
    const res = await fetch(url2)
    t.is(res.status, 200)
    t.is(await res.text(), 'hej verden')
  }
})

test('aborting request during async resolve closes core without downloading', async function (t) {
  const writerStore = new Corestore(await tmp())
  const readerStore = new Corestore(await tmp())
  t.teardown(() => readerStore.close())
  t.teardown(() => writerStore.close())

  const blobs = testHyperblobs(t, writerStore)
  blobs.blockSize = 65536
  const id = await blobs.put(b4a.alloc(8 * 1024 * 1024, 'x'))

  const s1 = writerStore.replicate(true)
  const s2 = readerStore.replicate(false)
  s1.pipe(s2).pipe(s1)
  t.teardown(() => {
    s1.destroy()
    s2.destroy()
  })

  const server = testBlobServer(t, readerStore.session(), {
    resolve: async function (key) {
      await new Promise(resolve => setTimeout(resolve, 40))
      return { key }
    }
  })
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const req = http.get(link, { headers: { range: 'bytes=0-' } })
  req.on('error', () => {})
  setTimeout(() => req.destroy(), 10)

  await new Promise(resolve => setTimeout(resolve, 500))
  const readerCore = readerStore.get({ key: blobs.core.key, active: false })
  t.teardown(() => readerCore.close())
  await readerCore.ready()

  t.is(await readerCore.count(0, readerCore.length), 0, 'does not download blocks after aborted resolve')
})

test('malformed query with token disabled returns 404', async function (t) {
  const store = new Corestore(await tmp())
  t.teardown(() => store.close())

  const server = testBlobServer(t, store.session(), { token: null })
  await server.listen()

  const res1 = await fetch(`http://127.0.0.1:${server.port}/?foo=bar`)
  t.is(res1.status, 404)

  const res2 = await fetch(`http://127.0.0.1:${server.port}/?key=invalid`)
  t.is(res2.status, 404)
})
