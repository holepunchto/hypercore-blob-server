const BlobServer = require('../../index.js')
const Hyperdrive = require('hyperdrive')
const Hyperblobs = require('hyperblobs')

module.exports = {
  testBlobServer,
  testHyperblobs,
  testHyperdrive,
  fetch: global.fetch || require('bare-fetch')
}

function testBlobServer (t, store, opts) {
  const server = new BlobServer(store, opts)
  t.teardown(() => server.close())
  return server
}

function testHyperblobs (t, store) {
  const core = store.get({ name: 'test' })
  const blobs = new Hyperblobs(core)
  t.teardown(() => blobs.close())
  return blobs
}

function testHyperdrive (t, store, opts) {
  const drive = new Hyperdrive(store, opts)
  t.teardown(() => drive.close())
  return drive
}
