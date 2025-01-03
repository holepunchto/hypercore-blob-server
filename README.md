# hypercore-blob-server

HTTP server for streaming hypercore blobs

```
npm install hypercore-blob-server
```

More flexible successor to [serve-drive](https://github.com/holepunchto/serve-drive)

## Usage

``` js
const BlobServer = require('hypercore-blob-server')

// store should be a corestore
const server = new BlobServer(store, options)

await server.listen()

// To get a link to a blob to
const link = server.getLink(key, {
  blob: blobId,
  type: 'image/jpeg'
})

// supports drive lookups also
const link = server.getLink(key, {
  filename: '/foo.js'
})
```

## API

#### `const server = new BlobServer(store, options)`

`store` - Corestore instance

`options`:
```js
{
  port // defaults to 49833,
  host // defaults to '127.0.0.1',
  token // server token
  protocol // 'http' | 'https'
}
```

#### `await server.listen()`
Listen to requests

#### `const link = server.getLink(key, options)`

Generates the url used to fetch data

`key` - hypercore or hyperdrive key

`options`:
```js
{
  host // custom host
  port // custom port
  protocol: 'http' | 'https',
  filename | blob
}
```
`filename` - hyperdrive filename

`blob` - blob ID in the form of `{ blockOffset, blockLength, byteOffset, byteLength}`

When downloading blobs, you can set the `Range` header to download sections of data, implement pause/resume download functionality. Offsets are zero-indexed & inclusive

```
Range: bytes=<start>-<end>
Range: bytes=0-300
Range: bytes=2-
```

#### `await server.suspend()`

Let the instance know you wanna suspend so it can make relevant changes.

#### `await server.resume()`

Let the instance know you wanna resume from suspension. Will rebind the server etc.

## License

Apache-2.0
