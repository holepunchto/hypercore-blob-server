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
  filename | blob
}
```
`filename` - hyperdrive filename

`blob` - blob ID in the form of `{ blockOffset, blockLength, byteOffset, byteLength}`

## License

Apache-2.0
