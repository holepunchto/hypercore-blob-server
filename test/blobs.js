const test = require('brittle')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const { testServeBlobs, request } = require('./helpers')

test('can get blob from hypercore', async function (t) {
  const store = new Corestore(RAM)

  const core = store.get({ name: 'test' })

  await core.append([Buffer.from('Hello'), Buffer.from('World')])

  const serve = testServeBlobs(t, store)
  await serve.listen()

  const res = await request(serve, core.key, {
    blob: {
      blockOffset: 0,
      blockLength: 2,
      byteOffset: 2,
      byteLength: 9
    }
  })
  t.is(res.status, 200)
  t.is(res.data, 'HelloWorl')
})
