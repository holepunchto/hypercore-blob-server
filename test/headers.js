const test = require('brittle')
const b4a = require('b4a')
const Corestore = require('corestore')
const { testBlobServer, testHyperblobs, fetch } = require('./helpers')

test('sandbox option sets Content-Security-Policy on blob response', async function (t) {
  const store = new Corestore(await t.tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store, { sandbox: true })
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(res.headers.get('content-security-policy'), 'sandbox')
})

test('sandbox option sets Content-Security-Policy on pointer response', async function (t) {
  const store = new Corestore(await t.tmp())

  const server = testBlobServer(t, store, { sandbox: true })
  await server.listen()

  const url = server.getBlobLink(b4a.from('hello world'))
  const res = await fetch(url)
  t.is(res.status, 200)
  t.is(res.headers.get('content-security-policy'), 'sandbox')
})

test('no Content-Security-Policy header when sandbox disabled', async function (t) {
  const store = new Corestore(await t.tmp())

  const blobs = testHyperblobs(t, store)

  const id = await blobs.put(b4a.from('Hello World'))

  const server = testBlobServer(t, store, { sandbox: false })
  await server.listen()

  const link = server.getLink(blobs.core.key, { blob: id })
  const res = await fetch(link)
  t.is(res.status, 200)
  t.is(res.headers.get('content-security-policy'), null)
})
