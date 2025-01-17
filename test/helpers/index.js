const http = require('http')
const BlobServer = require('../../index.js')
const Hyperdrive = require('hyperdrive')
const Hyperblobs = require('hyperblobs')

module.exports = {
  request,
  get,
  testBlobServer,
  testHyperblobs,
  testHyperdrive
}

function get (link, range = null) {
  return new Promise((resolve, reject) => {
    const req = http.get(link, {
      headers: {
        Connection: 'close',
        range
      }
    })

    req.on('error', reject)
    req.on('response', function (res) {
      if (res.statusCode === 307) {
        // follow redirect
        get(new URL(link).origin + res.headers.location).then(resolve).catch(reject)
      } else {
        let buf = ''
        res.setEncoding('utf-8')
        res.on('data', function (data) {
          buf += data
        })
        res.on('end', function () {
          resolve({ status: res.statusCode, data: buf })
        })
        res.on('close', function () {
          resolve({ status: res.statusCode, data: buf })
        })
      }
    })
  })
}

async function request (server, key, opts) {
  const link = server.getLink(key, opts)

  return get(link, opts.range)
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
