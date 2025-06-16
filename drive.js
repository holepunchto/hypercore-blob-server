// helpers to deal with drive redirect, hyperdrive made this too hard...

const Hyperbee = require('hyperbee')
const Hypercore = require('hypercore')
const crypto = require('hypercore-crypto')
const SubEncoder = require('sub-encoder')
const unixPathResolve = require('unix-path-resolve')

const filesEncoding = new SubEncoder('files', 'utf-8')
const [BLOBS] = crypto.namespace('hyperdrive', 1)

module.exports = resolveDriveFilename

async function resolveDriveFilename (core, key, version) {
  const bee = new Hyperbee(core, { valueEncoding: 'json', checkout: version })

  let entry = null
  try {
    entry = await bee.get(unixPathResolve('/', key), { keyEncoding: filesEncoding })
  } catch {}

  let content = null

  if (entry !== null) {
    try {
      if (!bee.core.core.compat) {
        content = generateContentKey(bee.core.manifest, core.key)
      }
      if (content === null) {
        content = await loadContentKey(bee)
      }
    } catch {}
  }

  await bee.close()

  return content === null ? null : { key: content, blob: entry.value.blob }
}

function generateContentKey (m, key) {
  if (!m || m.version < 1) return null

  const signers = []

  for (const s of m.signers) {
    const namespace = crypto.hash([BLOBS, key, s.namespace])
    signers.push({ ...s, namespace })
  }

  return Hypercore.key({
    version: m.version,
    hash: 'blake2b',
    allowPatch: m.allowPatch,
    quorum: m.quorum,
    signers,
    prologue: null
  })
}

async function loadContentKey (bee) {
  const header = await bee.getHeader()
  return (header.metadata && header.metadata.contentFeed) || null
}
