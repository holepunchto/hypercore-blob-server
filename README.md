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

## License

Apache-2.0
