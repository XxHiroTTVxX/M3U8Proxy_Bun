import type { Context } from "hono";
import { corsHeaders } from "./proxy";

export class M3U8Parser {
  private static readonly listOfPlaylistKeywords: string[] = ["#EXT-X-STREAM-INF", "#EXT-X-I-FRAME-STREAM-INF", "#EXT-X-MEDIA"];

  static isPlaylistM3U8(lines: string[]): boolean {
    if (lines.length === 0) return false;
    
    // The first line of an M3U8 file must be #EXTM3U
    if (!lines[0].startsWith('#EXTM3U')) return false;
    
    // Check for playlist markers (#EXT-X-STREAM-INF)
    for (const line of lines) {
      for (const keyword of this.listOfPlaylistKeywords) {
        if (line.startsWith(keyword)) {
          return true;
        }
      }
      
      // Master playlists usually have .m3u8 URLs for child playlists
      if (!line.startsWith('#') && (line.includes('.m3u8') || line.includes('chunklist'))) {
        return true;
      }
    }
    
    // If we get here, it's not a master playlist
    return false;
  }

  static getProxiedUrl(url: string, baseUrl: string, proxyPrefix: string, ref?: string): string {
    if (!url.trim()) {
      return url;
    }
    
    // Make the URL absolute if it's not already
    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(url, baseUrl).href;
    } catch (e) {
      console.error(`[M3U8] Failed to parse URL: ${url}`, e);
      return url;
    }
    
    // Check if this is a segment (.ts) or playlist (.m3u8)
    const isM3u8 = url.includes('.m3u8') || url.includes('chunklist');
    
    // Check if this is a key file
    const isKeyFile = url.endsWith('.key');
    
    // The ref parameter
    const refParam = ref ? `&ref=${encodeURIComponent(ref)}` : '';
    
    // Special handling for key files
    if (isKeyFile) {
      try {
        // Extract the key name
        const keyName = url.split('/').pop();
        if (keyName && keyName.endsWith('.key')) {
          // Use the proxy for key files as well
          return `/proxy?url=${encodeURIComponent(absoluteUrl)}${refParam}`;
        }
      } catch (e) {
        console.log(`[M3U8] Error processing key URL: ${e}`);
      }
    }
    
    // Determine which endpoint to use based on content type
    if (isM3u8) {
      return `/m3u8?url=${encodeURIComponent(absoluteUrl)}${refParam}`;
    } else {
      return `/proxy?url=${encodeURIComponent(absoluteUrl)}${refParam}`;
    }
  }

  static fixM3U8Urls(lines: string[], baseUrl: string, proxyPrefix: string, ref?: string): string {
    // Extract hostname from the source URL
    let hostname: string;
    try {
      hostname = new URL(baseUrl).hostname;
    } catch (e) {
      console.error("[M3U8] Invalid URL:", baseUrl);
      hostname = "";
    }

    // Check if this is a Krussdomi feed
    const isKrussdomiFeed = baseUrl.includes('hls.krussdomi.com');
    
    // Always use the m3u8 URL itself as the referrer for krussdomiFeed
    const referrer = isKrussdomiFeed ? baseUrl : ref;

    const fixedLines = lines.map(line => {
      // Process #EXT-X-KEY tags to handle encryption keys
      if (line.startsWith('#EXT-X-KEY')) {
        // Extract URI from the key tag
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
          const originalUri = uriMatch[1];
          const fixedUri = M3U8Parser.getProxiedUrl(originalUri, baseUrl, proxyPrefix, referrer);
          return line.replace(uriMatch[0], `URI="${fixedUri}"`);
        }
        return line;
      }
      
      // Process #EXT-X-STREAM-INF and similar tags to extract URLs from attributes
      if (line.startsWith('#EXT-X-STREAM-INF') || line.startsWith('#EXT-X-MEDIA')) {
        // Extract URI from the tag if present
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (uriMatch && uriMatch[1]) {
          const originalUri = uriMatch[1];
          const fixedUri = M3U8Parser.getProxiedUrl(originalUri, baseUrl, proxyPrefix, referrer);
          return line.replace(uriMatch[0], `URI="${fixedUri}"`);
        }
        return line;
      }

      // Skip comments and tags
      if (line.startsWith('#')) {
        return line;
      }

      // Skip empty lines
      if (!line.trim()) {
        return line;
      }

      // Process URLs in segment lines
      return M3U8Parser.getProxiedUrl(line, baseUrl, proxyPrefix, referrer);
    });

    return fixedLines.join('\n');
  }

}

export const handleM3U8 = async (c: Context | { url: string, ref?: string }) => {
  try {
    // Get URL and ref either from context or direct parameters
    let url: string | undefined;
    let ref: string | undefined;

    if ('url' in c) {
      // Direct parameters
      url = c.url;
      ref = c.ref;
    } else {
      // Check if this is a video route request
      const path = c.req.path;
      if (path.startsWith('/video/')) {
        // This is a video route request, construct the URL
        url = c.req.url;
        ref = c.req.header("Referer");
      } else {
        // Normal m3u8 route request
        url = c.req.query("url");
        ref = c.req.query("ref") || c.req.header("Referer");
      }
    }

    if (!url) {
      return new Response(JSON.stringify({ error: "URL parameter is required" }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Log the request
    console.log(`[M3U8] Proxying playlist: ${url}`);
    console.log(`[M3U8] Referrer: ${ref || "none"}`);

    // Detect if this is a Krussdomi stream
    const isKrussdomiFeed = url.includes('hls.krussdomi.com');
    
    // Set up headers for the fetch request
    const headers: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive"
    };
    
    // Set referrer based on the source
    if (isKrussdomiFeed) {
      // For Krussdomi, use the URL itself as referrer
      headers["Referer"] = url;
      headers["Origin"] = "https://hls.krussdomi.com";
    } else if (ref) {
      headers["Referer"] = ref;
      headers["Origin"] = ref ? new URL(ref).origin : new URL(url).origin;
    } else {
      headers["Referer"] = url;
      headers["Origin"] = new URL(url).origin;
    }

    // Fetch the playlist
    const response = await fetch(url, {
      headers,
      redirect: "follow"
    });

    if (!response.ok) {
      console.error(`[M3U8] Error fetching playlist: ${response.status} ${response.statusText}`);
      return new Response(JSON.stringify({ error: "Failed to fetch playlist", status: response.status }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }

    // Get the playlist content
    const content = await response.text();
    console.log(`[M3U8] Playlist fetched successfully (${content.length} bytes)`);

    // Split into lines for processing
    const lines = content.split("\n");

    // Determine the type of playlist (master or media)
    const isMasterPlaylist = M3U8Parser.isPlaylistM3U8(lines);
    console.log(`[M3U8] Playlist type: ${isMasterPlaylist ? "Master" : "Media"}`);

    // Fix URLs in the playlist
    const updatedContent = M3U8Parser.fixM3U8Urls(lines, url, "/proxy", ref);

    // Create response with appropriate headers
    return createCorsResponse(
      updatedContent,
      200,
      "application/vnd.apple.mpegurl",
      {
        "Cache-Control": "no-cache",
        "Content-Disposition": 'inline; filename="playlist.m3u8"'
      }
    );
  } catch (error: any) {
    console.error("[M3U8] Error processing playlist:", error);
    return new Response(JSON.stringify({ error: "Error processing playlist", message: error.message || "Unknown error" }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
};

export function createCorsResponse(
  body: string,
  status: number,
  contentType: string,
  additionalHeaders: Record<string, string> = {}
): Response {
  const headers = new Headers({
    ...corsHeaders,
    "Content-Type": contentType,
    ...additionalHeaders
  });
  
  return new Response(body, {
    status,
    headers
  });
}

