const http = require('http')
const ServeBlobs = require('../../index.js')
const Hyperdrive = require('hyperdrive')
const Hyperblobs = require('hyperblobs')

module.exports = {
  request,
  testServeBlobs,
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

async function request (serve, key, opts) {
  const link = serve.getLink(key, opts)

  return get(link, opts.range)
}

function testServeBlobs (t, store, opts) {
  const serve = new ServeBlobs(store, opts)
  t.teardown(() => serve.close())
  return serve
}

function testHyperblobs (t, store) {
  const core = store.get({ name: 'test' })
  const blobs = new Hyperblobs(core)
  t.teardown(() => blobs.close())
  return blobs
}

function testHyperdrive (t, store) {
  const drive = new Hyperdrive(store)
  t.teardown(() => drive.close())
  return drive
}
