const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const { testHyperdrive, testBlobServer, request, get } = require('./helpers')

test('can get file from hyperdrive', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, drive.key, { filename: '/file.txt' })
  t.is(res.status, 200)
  t.is(res.data, 'Here')
})

test('can get versioned file from hyperdrive', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')
  const v = drive.version

  await drive.put('/file.txt', 'nope')

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, drive.key, { filename: '/file.txt', version: v })
  t.is(res.status, 200)
  t.is(res.data, 'Here')
})

test('404 if file not found', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  const res = await request(server, drive.key, { filename: '/testing.txt' })
  t.is(res.status, 404)
  t.is(res.data, '')
})

test('404 if token is invalid', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  const link = server.getLink(drive.key, { filename: '/testing.txt' })
  const res = await get(link.replace('token=', 'token=breakme'))

  t.is(res.status, 404)
  t.is(res.data, '')
})

test('sending request while suspended', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  await server.suspend()

  try {
    await request(server, drive.key, { filename: '/file.txt' })
    t.fail('request should fail')
  } catch (err) {
    t.ok(err)
  }
})

test('sending request after resume', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const server = testBlobServer(t, store)
  await server.listen()

  await server.suspend()
  await server.resume()

  const res = await request(server, drive.key, { filename: '/file.txt' })
  t.is(res.status, 200)
  t.is(res.data, 'Here')
})
