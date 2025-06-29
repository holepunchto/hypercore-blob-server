const c = require('compact-encoding')
const z32 = require('z32')
const HypercoreID = require('hypercore-id-encoding')
const listen = require('listen-async')
const http = require('http')
const crypto = require('hypercore-crypto')
const ByteStream = require('hypercore-byte-stream')
const getMimeType = require('get-mime-type')
const { isEnded } = require('streamx')
const ReadyResource = require('ready-resource')
const resolveDriveFilename = require('./drive')
const speedometer = require('speedometer')
const Xache = require('xache')

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

class BlobCache {
  constructor (limit) {
    this.cache = new Xache({ limit })
    this.pointer = 0
  }

  add (buffer) {
    const id = ++this.pointer
    this.cache.set(id, buffer)
    return id
  }

  get (id) {
    return this.cache.get(id) || null
  }
}

class BlobRef extends ReadyResource {
  constructor (server, key, opts = {}) {
    super()

    const { blob = null, filename = null, version = 0 } = opts

    if (!blob && !filename) {
      throw new Error('Must specify a filename or blob')
    }

    this.server = server
    this.key = key
    this.blob = blob
    this.filename = filename
    this.version = version
    this.core = null

    this.ready().catch(noop)
  }

  async _open () {
    await this._getBlob()
    if (!this.core || !this.blob) return
    this._oncore()
  }

  _oncore () {
    // overwrite me
  }

  _gc () {
    // gc
  }

  close () {
    if (this.core) this.core.close()
    return super.close()
  }

  async _close () {
    if (!this.core) return
    await this.core.close()
    this.core = null
    this._gc()
  }

  async _getBlob () {
    const info = toInfo(this.key, this.blob, this.filename, this.version)
    const core = await this.server._getCore(this.key, info, true)
    if (core === null) return

    this.core = core
    if (this.blob) return
    let result = null
    try {
      result = await resolveDriveFilename(this.core, this.filename, this.version)
    } catch {}

    await this.core.close()

    if (result !== null) {
      info.key = result.key
      info.drive = this.key
      info.blob = result.blob
      this.core = await this.server._getCore(result.key, info, true)
      this.blob = result.blob
    } else {
      this.core = null
    }
  }
}

class BlobDownloader extends BlobRef {
  constructor (server, key, opts) {
    super(server, key, opts)
    this.range = null
  }

  _oncore () {
    this.range = this.core.download({
      start: this.blob.blockOffset,
      length: this.blob.blockLength
    })
  }

  _gc () {
    if (this.range) {
      this.range.destroy()
      this.range = null
    }
  }

  async done () {
    await this.opening
    await this.range.done()
    await this.close()
  }
}

class BlobMonitor extends BlobRef {
  constructor (server, key, opts) {
    super(server, key, opts)
    this.stats = {
      blob: this.blob,
      peers: 0,
      uploadStats: {
        peers: 0,
        speed: 0,
        blocks: 0
      },
      downloadStats: {
        peers: 0,
        speed: 0,
        blocks: 0
      }
    }
    this._uploadStats = { blocks: 0 }
    this._downloadStats = { blocks: 0 }

    this._uploadSpeedometer = speedometer()
    this._downloadSpeedometer = speedometer()
    this._timer = null
    this._interval = opts.interval ?? 1000

    this._boundOnUpload = this._onUpload.bind(this)
    this._boundOnDownload = this._onDownload.bind(this)
    this._boundSendUpdate = this._sendUpdate.bind(this)
  }

  _oncore () {
    this._timer = setInterval(this._boundSendUpdate, this._interval)

    this.core.on('upload', this._boundOnUpload)
    this.core.on('download', this._boundOnDownload)
  }

  // has side effect
  _hasChanged () {
    let changed = false

    const upSpeed = this._uploadSpeedometer()
    const downSpeed = this._downloadSpeedometer()
    if (upSpeed !== this.stats.uploadStats.speed || downSpeed !== this.stats.downloadStats.speed) {
      changed = true
      this.stats.uploadStats.speed = upSpeed
      this.stats.downloadStats.speed = downSpeed
    }

    if (this._uploadStats.blocks !== this.stats.uploadStats.blocks || this._downloadStats.blocks !== this.stats.downloadStats.blocks) {
      changed = true
      this.stats.uploadStats.blocks = this._uploadStats.blocks
      this.stats.downloadStats.blocks = this._downloadStats.blocks
    }

    const peers = this.core.peers.length
    if (peers !== this.stats.peers) {
      changed = true
      this.stats.peers = this.stats.uploadStats.peers = this.stats.downloadStats.peers = peers
    }

    return changed
  }

  _sendUpdate () {
    if (this._hasChanged()) {
      this.emit('update')
    }
  }

  _onUpload (index, byteLength, from) {
    this._updateStats(this._uploadSpeedometer, this._uploadStats, index, byteLength, from)
  }

  _onDownload (index, byteLength, from) {
    this._updateStats(this._downloadSpeedometer, this._downloadStats, index, byteLength, from)
  }

  _updateStats (speedometer, stats, index, byteLength) {
    if (!isWithinRange(index, this.blob)) return

    speedometer(byteLength)
    stats.blocks++
  }

  _gc () {
    if (this._timer) clearInterval(this._timer)

    if (this.core) {
      this.core.off('upload', this._boundOnUpload)
      this.core.off('download', this._boundOnDownload)
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
      resolve = defaultResolve,
      blobCacheLimit = 64
    } = opts

    this.store = store
    this.host = host
    this.port = port
    this.address = address
    this.token = token ? (typeof token === 'string') ? token : z32.encode(token) : ''
    this.anyPort = anyPort
    this.protocol = protocol
    this.server = null
    this.blobCache = new BlobCache(blobCacheLimit)
    this.connections = new Set()
    this.resolve = resolve

    this.listening = null
    this.suspending = null
    this.resuming = null
    this.closing = null
  }

  static getMimetype (filename) {
    return getMimeType(filename)
  }

  static getMimeType (filename) {
    return getMimeType(filename)
  }

  _onconnection (socket) {
    if (this.suspending) {
      socket.destroy()
      return
    }

    this.connections.add(socket)
    socket.on('close', () => this.connections.delete(socket))
  }

  async _getCore (k, info, active) {
    try {
      const resolved = await this.resolve(k, info)
      if (!resolved) return null

      const { key = k, encryptionKey } = resolved
      const core = this.store.get({ key, active, wait: active })

      if (encryptionKey) {
        await core.setEncryptionKey(encryptionKey)
      }

      return core
    } catch {
      return null
    }
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

    if (info.pointer) {
      this._onpointer(info, res)
      return
    }

    if (info.blob) {
      this._onblob(info, res)
      return
    }

    if (info.filename) {
      this._ondrive(info, res)
      return
    }

    res.statusCode = 404
    res.end()
  }

  async _ondrive (info, res) {
    info.drive = info.key
    const core = await this._getCore(info.key, info, true)

    if (core === null) {
      res.statusCode = 404
      res.end()
      return
    }

    res.on('close', () => core.close().catch(noop))
    info.drive = core.key

    let result = null

    try {
      result = await resolveDriveFilename(core, info.filename, info.version)
    } catch {}

    if (result === null) {
      res.statusCode = 404
      res.end()
      return
    }

    const path = this.getLink(result.key, {
      url: false,
      blob: result.blob,
      drive: info.drive,
      filename: info.filename,
      version: info.version,
      type: info.type || getMimeType(info.filename)
    })

    res.statusCode = 307
    res.setHeader('Location', path)
    res.end()
  }

  _onpointer (info, res) {
    const buffer = this.blobCache.get(info.pointer)

    if (buffer === null) {
      res.statusCode = 404
      res.end()
      return
    }

    res.setHeader('Content-Type', info.type)
    res.setHeader('Content-Length', '' + buffer.byteLength)
    res.end(buffer)
  }

  async _onblob (info, res) {
    const core = await this._getCore(info.key, info, true)

    if (core === null) {
      res.statusCode = 404
      res.end()
      return
    }

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', info.type)

    let start = 0
    let length = info.blob.byteLength

    if (info.range && length > 0) {
      const end = info.range.end === -1 ? info.blob.byteLength - 1 : Math.min(info.range.end, info.blob.byteLength - 1)

      start = info.range.start
      length = end - start + 1

      res.statusCode = 206
      res.setHeader('Content-Range', 'bytes ' + start + '-' + end + '/' + info.blob.byteLength)
    }

    res.setHeader('Content-Length', '' + length)

    if (info.head) {
      core.close().catch(noop)
      res.end()
      return
    }

    const rs = new ByteStream(core, info.blob, { start, length })

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
      const server = this.server
      await this._closeAll(true)
      server.ref()
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
        this.server = null
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
    return link.replace(/:\d+\//, ':' + this.port + '/').replace(/token=([^&]+)/, 'token=' + this.token)
  }

  getBlobLink (buffer, opts = {}) {
    const pointer = this.blobCache.add(buffer)
    return this.getLink(null, { ...opts, pointer })
  }

  getLink (key, opts = {}) {
    const {
      host = this.host,
      port = this.port,
      protocol = this.protocol,
      name = null,
      filename = name,
      version = 0,
      drive = null,
      blob = null,
      url = true,
      pointer = 0,
      mimetype = filename ? getMimeType(filename) : 'application/octet-stream',
      mimeType = mimetype,
      type = mimeType
    } = opts

    if (!blob && !filename && !pointer) {
      throw new Error('Must specify a filename, blob, or pointer')
    }

    const p = (protocol === 'http' && port === 80)
      ? ''
      : protocol === 'https' && port === 443
        ? ''
        : ':' + port

    const k = key ? '?key=' + (typeof key === 'string' ? key : HypercoreID.encode(key)) : ''
    const ptr = pointer ? (key ? '&' : '?') + 'pointer=' + pointer : ''
    const b = blob ? '&blob=' + z32.encode(c.encode(blobId, blob)) : ''
    const d = drive ? '&drive=' + HypercoreID.encode(drive) : ''
    const v = version ? '&version=' + version : ''
    const t = '&type=' + encodeURIComponent(type)
    const token = this.token ? '&token=' + this.token : ''
    const pathname = filename ? encodeURI(filename.replace(/^\//, '').replace(/\\+/g, '/')) : ''

    const path = `/${pathname}${k}${b}${d}${ptr}${v}${t}${token}`

    return url ? `${protocol}://${host}${p}${path}` : path
  }

  monitor (key, opts) {
    return new BlobMonitor(this, key, opts)
  }

  download (key, opts) {
    return new BlobDownloader(this, key, opts)
  }

  async clear (key, opts = {}) {
    const { blob = null, filename = null, version = 0 } = opts

    if (!blob && !filename) {
      throw new Error('Must specify a filename or blob')
    }

    const core = await this._getCore(key, toInfo(key, blob, filename, version), false)
    if (core === null) return null

    if (blob) {
      const cleared = await core.clear(blob.blockOffset, blob.blockOffset + blob.blockLength)
      await core.close()
      return cleared
    }

    let result = null
    try {
      result = await resolveDriveFilename(core, filename, version)
    } catch {}

    await core.close()

    if (result !== null) return this.clear(result.key, { blob: result.blob, drive: key, filename, version })
    return null
  }
}

function toInfo (key, blob, filename, version) {
  return {
    head: null,
    range: null,
    token: null,
    key,
    blob,
    drive: blob ? null : key,
    pointer: 0,
    version,
    filename,
    type: 'application/octet-stream'
  }
}

function decodeRequest (req) {
  try {
    const result = {
      head: req.method === 'HEAD',
      range: parseRange(req.headers.range),
      token: null,
      key: null,
      blob: null,
      drive: null,
      pointer: 0,
      version: 0,
      filename: null,
      type: 'application/octet-stream'
    }

    const parts = req.url.split('?')
    if (parts.length < 2) return result

    result.filename = parts[0] !== '/' ? decodeURI(parts[0]) : null

    for (const p of parts[1].split('&')) {
      if (p.startsWith('token=')) result.token = p.slice(6)
      if (p.startsWith('key=')) result.key = HypercoreID.decode(p.slice(4))
      if (p.startsWith('drive=')) result.drive = HypercoreID.decode(p.slice(6))
      if (p.startsWith('blob=')) result.blob = c.decode(blobId, z32.decode(p.slice(5)))
      if (p.startsWith('pointer=')) result.pointer = parseInt(p.slice(8), 10)
      if (p.startsWith('type=')) result.type = decodeURIComponent(p.slice(5))
      if (p.startsWith('version=')) result.version = Number(p.slice(8))
    }

    if (result.pointer) return result
    if (result.key === null) return null
    if (result.filename === null && result.blob === null) return null

    return result
  } catch {
    return null
  }
}

function defaultResolve (key, info) {
  return { key, encryptionKey: null }
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

function isWithinRange (index, { blockOffset, blockLength }) {
  return index >= blockOffset && index < blockOffset + blockLength
}

function noop () {}
