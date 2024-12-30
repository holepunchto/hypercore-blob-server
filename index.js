const c = require('compact-encoding')
const z32 = require('z32')
const listen = require('listen-async')
const http = require('http')
const crypto = require('hypercore-crypto')
const ByteStream = require('hypercore-byte-stream')
const { isEnded } = require('streamx')

const blobId = {
  preencode (state, b) {
    c.uint.preencode(state, b.blockOffset)
    c.uint.preencode(state, b.blockLength)
    c.uint.preencode(state, b.byteOffset)
    c.uint.preencode(state, b.byteLength)
  },
  encode (state, b) {
    c.uint.encode(state, b.blockOffset)
    c.uint.encode(state, b.blockLength)
    c.uint.encode(state, b.byteOffset)
    c.uint.encode(state, b.byteLength)
  },
  decode (state) {
    return {
      blockOffset: c.uint.decode(state),
      blockLength: c.uint.decode(state),
      byteOffset: c.uint.decode(state),
      byteLength: c.uint.decode(state)
    }
  }
}

module.exports = class ServeBlobs {
  constructor (store, opts = {}) {
    const {
      port = 49833,
      host = '127.0.0.1',
      address = host === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
      token = crypto.randomBytes(32),
      protocol = 'http',
      anyPort = true
    } = opts

    this.store = store
    this.host = host
    this.port = port
    this.address = address
    this.token = token ? (typeof token === 'string') ? token : z32.encode(token) : ''
    this.anyPort = anyPort
    this.protocol = protocol
    this.server = null
    this.connections = new Set()

    this.listening = null
    this.suspending = null
    this.resuming = null
    this.closing = null
  }

  _onconnection (socket) {
    if (this.suspending) {
      this.connection.destroy()
      return
    }

    this.connections.add(socket)
    socket.on('close', () => this.connections.delete(socket))
  }

  _onrequest (req, res) {
    if (req.method !== 'HEAD' && req.method !== 'GET') {
      req.socket.destroy()
      req.statusCode = 400
      res.end()
      return
    }

    const info = decodeRequest(req)

    if (info === null || info.token !== this.token) {
      res.statusCode = 404
      res.end()
      return
    }

    if (info.blob) {
      this._onblob(info, res)
      return
    }

    res.statusCode = 404
    res.end()
  }

  _onblob (info, res) {
    const blob = info.blob

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', 'video/mp4')

    let start = 0
    let length = blob.id.byteLength

    if (blob.range && length > 0) {
      const end = blob.range.end === -1 ? blob.id.byteLength - 1 : blob.range.end

      start = blob.range.start
      length = end - start + 1

      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + length)
    }

    res.setHeader('Content-Length', '' + length)

    if (info.head) {
      res.end()
      return
    }

    const core = this.store.get({ key: blob.key })
    const rs = new ByteStream(core, blob.id, { start, length })

    rs.on('error', teardown)
    res.on('error', teardown)
    res.on('close', teardown)

    rs.pipe(res)

    function teardown () {
      if (!isEnded(rs)) res.destroy()
    }
  }

  listen () {
    if (this.listening) return this.listening
    this.listening = this._listen()
    return this.listening
  }

  async suspend () {
    if (this.suspending) return this.suspending
    this.suspending = this._suspend()
    return this.suspending
  }

  async _suspend () {
    if (this.listening) await this.listening
    if (this.resuming) await this.resuming
    this.resuming = null
    await this._closeAll(false)
  }

  resume () {
    if (!this.suspending) return
    if (this.resuming) return this.resuming
    this.resuming = this._resume()
    return this.resuming
  }

  async _resume () {
    if (this.suspending) await this.suspending
    if (this.server) await this._closeAll(true)
    this.server.ref()
    return this._listen()
  }

  _closeAll (alsoServer) {
    return new Promise(resolve => {
      let waiting = 1

      if (alsoServer) {
        this.server.close(onclose)
        waiting++
      }
      this.server.unref()

      for (const c of this.connections) {
        waiting++
        c.on('close', onclose)
        c.destroy()
      }

      onclose() // clear the initial one

      function onclose () {
        if (--waiting === 0) resolve()
      }
    })
  }

  close () {
    if (this.closing) return this.closing
    this._closing = this._close()
    return this._closing
  }

  async _close () {
    if (this.listening) await this.listening
    await this._closeAll(true)
    await this.store.close()
  }

  async _listen () {
    if (this.server === null) {
      this.server = http.createServer()
      this.server.on('request', this._onrequest.bind(this))
      this.server.on('connection', this._onconnection.bind(this))
    }

    try {
      await listen(this.server, this.port, this.address)
    } catch (err) {
      if (this.anyPort) await listen(this.server, 0, this.address)
      else throw err
    }

    this.port = this.server.address().port
  }

  refreshLink (link) {
    return link.replace(/:\d+\//, ':' + this.port + '/')
  }

  getLink (key, blob, opts = {}) {
    const {
      host = this.host,
      port = this.port,
      protocol = this.protocol,
      mimetype = 'application/octet-stream',
      mimeType = mimetype
    } = opts

    const p = (protocol === 'http' && port === 80)
      ? ''
      : protocol === 'https' && port === 443
        ? ''
        : ':' + port

    const id = c.encode(blobId, blob)
    const type = encodeURIComponent(mimeType)
    const token = this.token && '&token=' + this.token

    return `${protocol}://${host}${p}/blob?key=${z32.encode(key)}&id=${z32.encode(id)}&type=${type}${token}`
  }
}

function decodeBlobRequest (req) {
  try {
    const info = {
      head: req.method === 'HEAD',
      token: null,
      drive: null,
      blob: {
        key: null,
        id: null,
        type: 'application/octet-stream',
        range: parseRange(req.headers.range)
      }
    }

    for (const p of req.url.split('?')[1].split('&')) {
      if (p.startsWith('token=')) info.token = p.slice(6)
      if (p.startsWith('key=')) info.blob.key = z32.decode(p.slice(4))
      if (p.startsWith('id=')) info.blob.id = c.decode(blobId, z32.decode(p.slice(3)))
      if (p.startsWith('type=')) info.blob.type = decodeURIComponent(p.slice(5))
    }

    if (!info.blob.key || !info.blob.id) return null
    return info
  } catch {
    return null
  }
}

function decodeRequest (req) {
  if (req.url.startsWith('/blob?')) return decodeBlobRequest(req)
  return null
}

function parseRange (range) {
  if (!range || !range.startsWith('bytes=')) return null
  const r = range.slice(6).split('-')
  if (r.length !== 2 || !/^\d*$/.test(r[0]) || !/^\d*$/.test(r[1])) return null
  return {
    start: Number(r[0] || 0),
    end: Number(r[1] === '' ? -1 : r[1])
  }
}
