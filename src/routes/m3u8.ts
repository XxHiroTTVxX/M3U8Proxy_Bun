import type { Context } from "hono";

export class M3U8Parser {
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
    const baseUrlWithoutQuery = baseUrl.split('?')[0];
    

    let baseDirectory = baseUrlWithoutQuery;
    if (!baseDirectory.endsWith('/')) {
      baseDirectory = baseDirectory.substring(0, baseDirectory.lastIndexOf('/') + 1);
    }
    
    console.log(`[M3U8] Base URL: ${baseUrl}`);
    console.log(`[M3U8] Base Directory: ${baseDirectory}`);
    
    const uri = new URL(baseDirectory);
    const uriPattern = /URI="([^"]+)"/;
    const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
    

    return lines.map(line => {
      if (!line.trim() || (line.startsWith('#') && 
          !line.includes('URI=') && 
          !line.includes('#EXT-X-I-FRAME-STREAM-INF') &&
          !line.includes('#EXT-X-STREAM-INF'))) {
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
          // Handle segments and other URLs - make sure to resolve relative paths against base
          fullUrl = new URL(line.trim(), uri).href;
          console.log(`[M3U8] Resolved URL: ${line.trim()} -> ${fullUrl}`);
        } else {
          return line;
        }

        // Determine which proxy route to use based on the content type
        let routePrefix = '/proxy'; // Default to proxy route for all content
        if (fullUrl.endsWith('.key') || line.includes('#EXT-X-KEY')) {
          routePrefix = '/proxy'; // Use proxy for key files
        } else if (fullUrl.endsWith('.ts') || fullUrl.endsWith('.m4s')) {
          routePrefix = '/proxy'; // Use proxy for segments
        } else if (fullUrl.endsWith('.m3u8') || fullUrl.endsWith('.m3u')) {
          routePrefix = '/proxy'; // Use m3u8 route for playlist files
        }

        // Create proxied URL
        const proxiedUrl = `${routePrefix}?url=${encodeURIComponent(fullUrl)}${refParam}`;

        // Return the appropriate format
        if (isUri) {
          return line.replace(uriPattern, `URI="${proxiedUrl}"`);
        }
        return proxiedUrl;

      } catch (error) {
        console.error('[M3U8] Error processing line:', line, error);
        return line; // Return original line if URL parsing fails
      }
    }).join('\n');
  }
}

export const handleM3U8 = async (c: Context) => {
  // Handle OPTIONS requests for CORS preflight
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
      }
    });
  }

  try {
    // Get URL and ref from query parameters and decode them
    let url = c.req.query("url");
    if (url) {
      try {
        // Decode the URL if it's encoded
        url = decodeURIComponent(url);
        // Remove any trailing slashes
        url = url.replace(/\/*$/, '');
      } catch (e) {
        console.error("[M3U8] Error decoding URL:", e);
        // If decoding fails, use the original URL
      }
    }

    // Check if ref is in the URL's query parameters
    let ref: string | undefined;
    try {
      const urlObj = url ? new URL(url) : null;
      let refFromUrl = urlObj?.searchParams.get("ref") || undefined;
      if (refFromUrl) {
        refFromUrl = decodeURIComponent(refFromUrl);
      }
      
      // Get and decode the ref parameter
      let refParam = c.req.query("ref");
      if (refParam) {
        refParam = decodeURIComponent(refParam);
      }
      // Use ref from either the proxy's query or the original URL's query
      ref = refParam || refFromUrl;
    } catch (e) {
      console.error("[M3U8] Error processing referer:", e);
      // If ref handling fails, continue without it
    }

    if (!url) {
      return createCorsResponse(
        JSON.stringify({ error: "URL parameter is required" }),
        400,
        "application/json"
      );
    }

    console.log(`[M3U8] Fetching decoded URL: ${url}`);
    console.log(`[M3U8] Decoded Referer: ${ref || 'none'}`);

    const headers: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive"
    };

    if (ref) {
      try {
        headers["Referer"] = ref;
        headers["Origin"] = new URL(ref).origin;
      } catch (e) {
        console.error("[M3U8] Invalid referer URL:", ref);
      }
    }

    const response = await fetch(url, { 
      headers,
      redirect: 'follow'
    });

    console.log(`[M3U8] Response status: ${response.status}`);
    console.log(`[M3U8] Response type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[M3U8] Error response: ${errorText}`);
      return createCorsResponse(
        JSON.stringify({ 
          error: "Failed to fetch M3U8",
          status: response.status,
          url: url,
          details: errorText.slice(0, 200)
        }),
        response.status,
        "application/json"
      );
    }

    const content = await response.text();
    console.log(`[M3U8] Content length: ${content.length}`);
    console.log(`[M3U8] First 100 chars: ${content.slice(0, 100)}`);

    if (!content.trim()) {
      return createCorsResponse(
        "Invalid M3U8 content (empty response)", 
        500,
        "text/plain"
      );
    }

    if (!content.includes('#EXTM3U')) {
      console.error(`[M3U8] Invalid content received:`, content);
      return createCorsResponse(
        JSON.stringify({
          error: "Invalid M3U8 content (no #EXTM3U tag)",
          content: content.slice(0, 200)
        }),
        500,
        "application/json"
      );
    }

    const lines = content.split("\n");
    
    // Fix URLs in the M3U8 content, using '/m3u8' for playlists
    const fixedContent = M3U8Parser.fixM3U8Urls(lines, url, '/proxy', ref);

    // Set up response headers
    const cache = response.headers.get("Cache-Control") || "no-cache";
    
    return createCorsResponse(
      fixedContent, 
      200,
      "application/vnd.apple.mpegurl",
      { "Cache-Control": cache }
    );
  } catch (error: any) {
    console.error("[M3U8] Error processing M3U8 file:", error);
    return createCorsResponse(
      JSON.stringify({ 
        error: "Failed to process M3U8",
        details: error?.message || "Unknown error"
      }),
      500,
      "application/json"
    );
  }
};

// Helper function to create CORS-enabled responses
export function createCorsResponse(
  body: string,
  status: number,
  contentType: string,
  additionalHeaders: Record<string, string> = {}
): Response {
  const headers = new Headers({
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    ...additionalHeaders
  });

  return new Response(body, {
    status,
    headers
  });
}
