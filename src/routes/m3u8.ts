import type { Context } from "hono";

class M3U8Parser {
  private static readonly listOfPlaylistKeywords: string[] = ["#EXT-X-STREAM-INF", "#EXT-X-I-FRAME-STREAM-INF"];

  static isPlaylistM3U8(lines: string[]): boolean {
    const maxLines = Math.min(lines.length, 10);
    for (let i = 0; i < maxLines; i++) {
      if (this.listOfPlaylistKeywords.some(keyword => 
        lines[i].toLowerCase().includes(keyword.toLowerCase()))) {
        return true;
      }
    }
    return false;
  }

  static fixM3U8Urls(lines: string[], baseUrl: string, proxyPrefix: string, ref?: string): string {
    // Extract the base URL without query parameters and get base directory for segments
    const baseUrlWithoutQuery = baseUrl.split('?')[0];
    const baseDirectory = baseUrlWithoutQuery.split('/').slice(0, -1).join('/');
    const uri = new URL(baseDirectory);
    const uriPattern = /URI="([^"]+)"/;
    const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
    
    // Detect if this is a master playlist or contains segments
    const isMasterPlaylist = this.isPlaylistM3U8(lines);
    const hasSegments = lines.some(line => line.includes('.ts') || line.includes('.m4s'));

    return lines.map(line => {
      // Skip comments and empty lines except special cases
      if (!line.trim() || (line.startsWith('#') && 
          !line.includes('URI=') && 
          !line.includes('#EXT-X-I-FRAME-STREAM-INF'))) {
        return line;
      }

      try {
        let fullUrl: string;
        let isUri = false;

        // Handle different types of URLs
        if (line.includes('URI=')) {
          // Handle key files and other URI attributes
          isUri = true;
          const match = uriPattern.exec(line);
          const uriContent = match?.[1] ?? '';
          fullUrl = new URL(uriContent, uri).href;
        } else if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
          // Handle I-Frame playlists
          isUri = true;
          const match = line.match(/URI="([^"]+)"/);
          const uriContent = match?.[1] ?? '';
          fullUrl = new URL(uriContent, uri).href;
        } else if (!line.startsWith('#')) {
          // Handle segments and other URLs
          fullUrl = new URL(line, uri).href;
        } else {
          return line;
        }

        // Determine which proxy route to use
        let routePrefix = proxyPrefix;
        if (fullUrl.endsWith('.key') || line.includes('#EXT-X-KEY')) {
          routePrefix = '/proxy';
        } else if (hasSegments && (fullUrl.endsWith('.ts') || fullUrl.endsWith('.m4s'))) {
          routePrefix = '/proxy'; // Use direct proxy for segments
        }

        // Create proxied URL
        const proxiedUrl = `${routePrefix}?url=${encodeURIComponent(fullUrl)}${refParam}`;

        // Return the appropriate format
        if (isUri) {
          return line.replace(uriPattern, `URI="${proxiedUrl}"`);
        }
        return proxiedUrl;

      } catch (error) {
        console.error('Error processing line:', line, error);
        return line; // Return original line if URL parsing fails
      }
    }).join('\n');
  }
}

export const handleM3U8 = async (c: Context) => {
  try {
    // Get URL and ref from query parameters
    const url = c.req.query("url");
    // Check if ref is in the URL's query parameters
    const urlObj = url ? new URL(url) : null;
    const refFromUrl = urlObj?.searchParams.get("ref") || undefined;
    // Use ref from either the proxy's query or the original URL's query
    const ref = c.req.query("ref") || refFromUrl;

    if (!url) {
      return new Response(JSON.stringify({ error: "URL parameter is required" }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, Referer"
        }
      });
    }

    const headers: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    };

    if (ref) {
      headers["Referer"] = ref;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch M3U8" }), {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, Referer"
        }
      });
    }

    const content = await response.text();
    if (!content.trim()) {
      return new Response("Invalid M3U8 content", {
        status: 500,
        headers: {
          "Content-Type": "text/plain",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, Referer"
        }
      });
    }

    const lines = content.split("\n");
    
    // Get the base URL for the proxy (e.g., "/m3u8")
    const proxyPrefix = "/m3u8";
    
    // Fix URLs in the M3U8 content
    const fixedContent = M3U8Parser.fixM3U8Urls(lines, url, proxyPrefix, ref);

    // Set up response headers
    const responseHeaders = new Headers({
      "Content-Type": response.headers.get("Content-Type") || "application/vnd.apple.mpegurl",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, Referer",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": response.headers.get("Cache-Control") || "no-cache"
    });

    return new Response(fixedContent, {
      headers: responseHeaders,
      status: 200
    });
  } catch (error) {
    console.error("Error processing M3U8 file:", error);
    return new Response(JSON.stringify({ error: "Failed to process M3U8" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Origin, Referer"
      }
    });
  }
};
