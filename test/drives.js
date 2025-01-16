const test = require('brittle')
const b4a = require('b4a')
const tmp = require('test-tmp')
const Corestore = require('corestore')
const testnet = require('hyperdht/testnet')
const Hyperswarm = require('hyperswarm')
const { testHyperdrive, testBlobServer, fetch } = require('./helpers')

test('can get file from hyperdrive', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/file.txt' })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Here')
})

test('can get versioned file from hyperdrive', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')
  const v = drive.version

  await drive.put('/file.txt', 'nope')

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/file.txt', version: v })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Here')
})

test('404 if file not found', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/testing.txt' })
  const res = await fetch(link)
  t.is(res.status, 404)
  t.is(await res.text(), '')
})

test('404 if token is invalid', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/testing.txt' })
  const res = await fetch(link.replace('token=', 'token=breakme'))

  t.is(res.status, 404)
  t.is(await res.text(), '')
})

test('sending request while suspended', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  await server.suspend()

  try {
    const link = server.getLink(drive.key, { filename: '/file.txt' })
    await fetch(link)
    t.fail('request should fail')
  } catch (err) {
    t.ok(err)
  }
})

test('sending request after resume', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  await server.suspend()
  await server.resume()

  const link = server.getLink(drive.key, { filename: '/file.txt' })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Here')
})

test('can get encrypted blob from hyperdrive', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store, { encryptionKey: b4a.alloc(32) })
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store, {
    resolve: function (key) {
      return { key, encryptionKey: b4a.alloc(32) }
    }
  })
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/file.txt' })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Here')

  await drive.close()
})

test('can get encrypted blob from hyperdrive while replicating', async function (t) {
  const store = new Corestore(await tmp())
  const store2 = new Corestore(await tmp())
  const { bootstrap } = await testnet(10, t)

  const swarm1 = new Hyperswarm({ bootstrap })
  const swarm2 = new Hyperswarm({ bootstrap })
  const encryptionKey = b4a.alloc(32)

  const drive = testHyperdrive(t, store, { encryptionKey })
  await drive.put('/file.txt', 'Here')

  swarm1.on('connection', c => {
    store.replicate(c)
  })

  swarm2.on('connection', c => {
    store2.replicate(c)
  })

  await swarm1.join(drive.discoveryKey).flushed()
  await swarm2.join(drive.discoveryKey).flushed()

  const server = testBlobServer(t, store2, {
    resolve: function (key) {
      return { key, encryptionKey }
    }
  })
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/file.txt', version: drive.version })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(await res.text(), 'Here')

  await swarm1.destroy()
  await swarm2.destroy()
  await drive.close()
})

test('can select a file for full download', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store, { encryptionKey: b4a.alloc(32) })
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store, {
    resolve: function (key) {
      return { key, encryptionKey: b4a.alloc(32) }
    }
  })
  await server.listen()

  const dl = server.download(drive.key, { filename: '/file.txt' })
  await dl.done()
})

test.skip('server could clear files', async function (t) {
  const store = new Corestore(await tmp())

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')
  await drive.put('/file2.txt', 'IAm')

  const server = testBlobServer(t, store)
  await server.listen()

  t.is((await drive.blobs.get({ blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 4 }, { wait: false })).toString(), 'Here')
  t.is((await drive.blobs.get({ blockOffset: 1, blockLength: 1, byteOffset: 4, byteLength: 3 }, { wait: false })).toString(), 'IAm')

  await server.clear(drive.key, {
    filename: '/file2.txt'
  })

  t.is((await drive.blobs.get({ blockOffset: 0, blockLength: 1, byteOffset: 0, byteLength: 4 }, { wait: false })).toString(), 'Here')
  t.is(await drive.blobs.get({ blockOffset: 1, blockLength: 1, byteOffset: 4, byteLength: 3 }, { wait: false }), null)
})
