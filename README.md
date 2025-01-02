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
  port = 49833,
  host = '127.0.0.1',
  token = crypto.randomBytes(32),
  protocol = 'http',
  anyPort = true
}
```

#### `await server.listen()`
Listen to http requests.

#### `const link = server.getLink(key, options)`

`key` - hypercore or hyperdrive key

Available `options`:
```js
{
  port = 49833,
  host = '127.0.0.1',
  token = crypto.randomBytes(32),
  protocol = 'http',
  anyPort = true
}
```

## License

Apache-2.0
