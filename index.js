const c = require('compact-encoding')
const z32 = require('z32')
const listen = require('listen-async')
const http = require('http')
const crypto = require('hypercore-crypto')
const ByteStream = require('hypercore-byte-stream')
const getMimeType = require('get-mime-type')
const { isEnded } = require('streamx')
const resolveDriveFilename = require('./drive')

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

module.exports = class HypercoreBlobServer {
  constructor (store, opts = {}) {
    const {
      port = 49833,
      host = '127.0.0.1',
      address = host === '127.0.0.1' ? '127.0.0.1' : '0.0.0.0',
      token = crypto.randomBytes(32),
      protocol = 'http',
      anyPort = true,
      resolve = defaultResolve
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
    this.resolve = resolve

    this.listening = null
    this.suspending = null
    this.resuming = null
    this.closing = null
  }

  _onconnection (socket) {
    if (this.suspending) {
      socket.destroy()
      return
    }

    this.connections.add(socket)
    socket.on('close', () => this.connections.delete(socket))
  }

  async _onrequest (req, res) {
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

    let resolved = null

    try {
      resolved = await this.resolve(info.blob ? info.blob.key : info.drive.key)
    } catch {
      res.statusCode = 400
      res.end()
      return
    }

    if (resolved) {
      if (info.blob) {
        this._onblob(resolved, info, res)
        return
      }

      if (info.drive) {
        this._ondrive(resolved, info, res)
        return
      }
    }

    res.statusCode = 404
    res.end()
  }

  async _ondrive ({ key, encryptionKey }, info, res) {
    const core = this.store.get(key)

    if (encryptionKey) {
      try {
        await core.setEncryptionKey(encryptionKey)
      } catch {
        res.statusCode = 400
        res.end()
        return
      }
    }

    res.on('close', () => core.close().catch(noop))

    let result = null

    try {
      result = await resolveDriveFilename(core, info.drive.filename, info.drive.version)
    } catch {}

    if (result === null) {
      res.statusCode = 404
      res.end()
      return
    }

    const path = this.getLink(result.key, {
      url: false,
      blob: result.blob,
      type: info.drive.type || getMimeType(info.drive.filename)
    })

    res.statusCode = 307
    res.setHeader('Location', path)
    res.end()
  }

  async _onblob ({ key, encryptionKey }, info, res) {
    const blob = info.blob

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', blob.type)

    let start = 0
    let length = blob.id.byteLength

    if (blob.range && length > 0) {
      const end = blob.range.end === -1 ? blob.id.byteLength - 1 : blob.range.end

      start = blob.range.start
      length = end - start + 1

      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + blob.id.byteLength)
    }

    res.setHeader('Content-Length', '' + length)

    if (info.head) {
      res.end()
      return
    }

    const core = this.store.get(key)

    if (encryptionKey) {
      try {
        await core.setEncryptionKey(encryptionKey)
      } catch {
        res.statusCode = 400
        res.end()
        return
      }
    }

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
    this.suspending = null
    if (this.server !== null) {
      await this._closeAll(true)
      this.server.ref()
    }
    return this._listen()
  }

  _closeAll (alsoServer) {
    return new Promise(resolve => {
      let waiting = 1

      if (this.server !== null) {
        if (alsoServer) {
          this.server.close(onclose)
          waiting++
        }
        this.server.unref()
      }

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

  getLink (key, opts = {}) {
    const {
      host = this.host,
      port = this.port,
      protocol = this.protocol,
      filename = null,
      version = 0,
      blob = null,
      url = true,
      mimetype = filename ? getMimeType(filename) : 'application/octet-stream',
      mimeType = mimetype,
      type = mimeType
    } = opts

    if (!blob && !filename) {
      throw new Error('Must specify a filename or blob')
    }

    const p = (protocol === 'http' && port === 80)
      ? ''
      : protocol === 'https' && port === 443
        ? ''
        : ':' + port

    const id = blob && c.encode(blobId, blob)
    const encodedType = encodeURIComponent(type)
    const token = this.token ? '&token=' + this.token : ''
    const v = version ? '&version=' + version : ''
    const name = filename && encodeURI(filename.replace(/^\//, ''))
    const path = id
      ? `/blob?key=${z32.encode(key)}&id=${z32.encode(id)}&type=${encodedType}${token}`
      : `/drive/${name}?key=${z32.encode(key)}&type=${encodedType}${token}${v}`

    return url ? `${protocol}://${host}${p}${path}` : path
  }

  async clear (key, opts = {}) {
    const { blob = null, filename = null, version = 0 } = opts

    if (!blob && !filename) {
      throw new Error('Must specify a filename or blob')
    }

    const core = this.store.get({ key, wait: false, active: false })

    if (blob) {
      await core.clear(blob.blockOffset, blob.blockOffset + blob.blockLength)
      await core.close()
      return
    }

    let result = null
    try {
      result = await resolveDriveFilename(core, filename, version)
    } catch {}

    await core.close()

    if (result !== null) await this.clear(result.key, { blob: result.blob })
  }
}

function decodeParams (url) {
  const result = {
    token: null,
    key: null,
    id: null,
    type: 'application/octet-stream',
    version: 0
  }

  const parts = url.split('?')
  if (parts.length < 2) return result

  for (const p of parts[1].split('&')) {
    if (p.startsWith('token=')) result.token = p.slice(6)
    if (p.startsWith('key=')) result.key = z32.decode(p.slice(4))
    if (p.startsWith('id=')) result.id = c.decode(blobId, z32.decode(p.slice(3)))
    if (p.startsWith('type=')) result.type = decodeURIComponent(p.slice(5))
    if (p.startsWith('version=')) result.version = Number(p.slice(8))
  }

  return result
}

function decodeDriveRequest (req) {
  try {
    const { token, key, type, version } = decodeParams(req.url)
    const filename = decodeURI(req.url.slice('/drive'.length).split('?')[0])

    const info = {
      head: req.method === 'HEAD',
      token,
      drive: {
        key,
        version,
        filename,
        type
      },
      blob: null
    }

    if (!info.drive.key || !filename || filename === '/') return null
    return info
  } catch {
    return null
  }
}

function decodeBlobRequest (req) {
  try {
    const { token, key, id, type } = decodeParams(req.url)

    const info = {
      head: req.method === 'HEAD',
      token,
      drive: null,
      blob: {
        key,
        id,
        type,
        range: parseRange(req.headers.range)
      }
    }

    if (!info.blob.key || !info.blob.id) return null
    return info
  } catch {
    return null
  }
}

function defaultResolve (key) {
  return { key, encryptionKey: null }
}

function decodeRequest (req) {
  if (req.url.startsWith('/blob')) return decodeBlobRequest(req)
  if (req.url.startsWith('/drive')) return decodeDriveRequest(req)
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

function noop () {}
