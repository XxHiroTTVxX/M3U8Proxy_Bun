# M3U8 Proxy with Bun and Hono

A lightweight and fast M3U8 proxy for streaming HLS files, built using Bun runtime and Hono framework.

## Features

- Proxies M3U8 playlist files and their segments
- Automatically rewrites URLs in M3U8 files to route through the proxy
- Handles proper MIME types for M3U8 and TS files
- Supports VTT subtitle files with image references
- Correctly handles both absolute and relative URLs in M3U8 files
- CORS support for cross-origin requests
- Detects disguised TS files by checking binary content
- Supports custom HTTP Referer headers for requests
- Lightweight and fast with minimal dependencies

## Prerequisites

Before you begin, make sure you have the following installed:
- [Bun](https://bun.sh) (latest version recommended)

## Installation

1. Clone this repository:
```bash
git clone https://github.com/yourusername/M3U8Proxy_Bun.git
cd M3U8Proxy_Bun
```

2. Install dependencies:
```bash
bun install
```

## Usage

### Starting the proxy

Run the development server:
```bash
bun run index.ts
```

Or for production:
```bash
bun start
```

### Environment variables

- `PROXY_URL`: (Optional) Base URL to prefix relative paths with. Include trailing slash.
- `PORT`: (Optional) The port to run the server on (default: 3000)

### Proxying M3U8 files

#### Path-based format

To proxy an M3U8 stream:
```
http://localhost:3000/proxy/https://example.com/path/to/stream.m3u8
```

To proxy with a custom HTTP Referer header (useful for sites that check referer):
```
http://localhost:3000/proxy/https%3A%2F%2Fexample-referer.com/https://example.com/path/to/stream.m3u8
```

Note: The referer URL must be URL-encoded in this format.

#### Query parameter format

Alternatively, you can use the query parameter format:

To proxy an M3U8 stream:
```
http://localhost:3000/fetch?url=https://example.com/path/to/stream.m3u8
```

To proxy with a custom HTTP Referer header:
```
http://localhost:3000/fetch?url=https://example.com/path/to/stream.m3u8&ref=https://some-referer.com
```

This format doesn't require URL encoding the referer, making it easier to use in most cases.

## Content Type Support

The proxy is specifically optimized for:

- **M3U8 Playlists** - Handles HLS streams with automatic URL rewriting
- **TS Video Segments** - Properly serves TS files with the correct MIME type 
- **VTT Subtitles** - Processes WebVTT subtitle files, including any image references
- **Binary Data** - Detects and correctly serves video content even when marked with incorrect content types

## Docker

You can also run the proxy using Docker:

1. Build the Docker image:
```bash
docker build -t m3u8-proxy-bun .
```

2. Run the container:
```bash
docker run -d -p 3000:3000 -e PROXY_URL="https://example.com/" m3u8-proxy-bun
```

## CORS Support

The proxy includes CORS headers to allow cross-origin requests. This makes it usable from any website or application without encountering CORS restrictions.

## How it works

1. The proxy supports two request formats:
   - Path-based: `/proxy/[URL]` or `/proxy/[REFERER]/[URL]`
   - Query parameter: `/fetch?url=[URL]&ref=[REFERER]`
2. When requested, the proxy fetches content from the source
3. If a referer is provided, it's included as an HTTP Referer header when making the request
4. For M3U8 files, it processes the content and intelligently rewrites all URLs (both absolute and relative)
5. The proxy handles different content types appropriately (M3U8, TS video, VTT subtitles, etc.)
6. All responses include appropriate CORS headers to allow cross-origin access

## License

MIT