const http = require('http')
const ServeBlobs = require('../../index.js')
const Hyperdrive = require('hyperdrive')

module.exports = {
  request,
  tmpServeBlobs,
  tmpHyperdrive
}

function get (link) {
  return new Promise((resolve, reject) => {
    const req = http.get(link, {
      headers: {
        Connection: 'close'
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
      }
    })
  })
}

async function request (serve, key, opts) {
  const link = serve.getLink(key, opts)

  return get(link)
}

function tmpServeBlobs (t, store, opts) {
  const serve = new ServeBlobs(store, opts)
  t.teardown(() => serve.close())
  return serve
}

function tmpHyperdrive (t, store) {
  const drive = new Hyperdrive(store)
  t.teardown(() => drive.close())
  return drive
}
