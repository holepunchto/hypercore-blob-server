const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const { testHyperdrive, testBlobServer, request } = require('./helpers')

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
