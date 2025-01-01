const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const { testHyperdrive, testServeBlobs, request } = require('./helpers')

test('can get file from hyperdrive', async function (t) {
  const store = new Corestore(RAM)

  const drive = testHyperdrive(t, store)
  await drive.put('/file.txt', 'Here')

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, drive.key, { filename: '/file.txt' })
  t.is(res.status, 200)
  t.is(res.data, 'Here')
})
