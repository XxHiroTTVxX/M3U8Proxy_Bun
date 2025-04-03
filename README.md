# AniStream

A lightweight and fast M3U8 and CORS proxy for streaming media content, built using Bun runtime and Hono framework.

## Features

- **Easy Media Streaming** - Access video streams from any source without restrictions
- **Universal Compatibility** - Works with any HLS (M3U8) video player or media application
- **Automatic URL Handling** - All links in playlists are automatically processed to work through the proxy
- **Cross-Origin Support** - Bypass CORS restrictions when accessing media from different domains
- **Subtitle Support** - Handles VTT subtitle files including any embedded images
- **Custom Referrer** - Set custom referrer headers to bypass website protections
- **Format Detection** - Automatically identifies and correctly serves different media types
- **Lightning Fast** - Built with Bun and Hono for exceptional performance with minimal resource usage
- **Simple Integration** - Easy to use with straightforward URL patterns for any application

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

## API Reference

AniStream provides several endpoints to handle different types of content:

### M3U8 Proxy Endpoints

#### `/m3u8` - M3U8 Playlist Processing

Fetches and processes M3U8 playlists, rewriting all URLs to be proxied through AniStream.

```
http://localhost:3000/m3u8?url=https://example.com/path/to/playlist.m3u8
```

Optional parameters:
- `ref`: Custom referer header (e.g. `&ref=https://example.com`)

#### `/m3u8-intro` - M3U8 Playlist with Video Intro

Similar to the `/m3u8` endpoint but adds a video intro at the beginning of the stream.

```
http://localhost:3000/m3u8-intro?url=https://example.com/path/to/playlist.m3u8
```

Optional parameters:
- `ref`: Custom referer header

#### `/proxy` - General Purpose Content Proxy

Proxies any content with proper CORS headers, used for video segments, images, and other resources.

```
http://localhost:3000/proxy?url=https://example.com/path/to/segment.ts
```

Optional parameters:
- `ref`: Custom referer header

#### `/intro/intro.ts` - Direct Intro Access

Directly serves the intro video file when using the m3u8-intro feature.

```
http://localhost:3000/intro/intro.ts
```

### Legacy Path-Based Format

For backward compatibility, you can also use the path-based format:

```
http://localhost:3000/proxy/https://example.com/path/to/stream.m3u8
```

Or with a custom referer:

```
http://localhost:3000/proxy/https%3A%2F%2Fexample-referer.com/https://example.com/path/to/stream.m3u8
```

Note: In this format, the referer URL must be URL-encoded.

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