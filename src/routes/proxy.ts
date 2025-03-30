import type { Context } from "hono";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export const handleProxy = async (c: Context) => {
  // Handle OPTIONS requests for CORS preflight
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders
    });
  }

  try {
    // Get URL and ref from query parameters and decode them
    let url = c.req.query("url");
    if (url) {
      try {
        url = decodeURIComponent(url);
        url = url.replace(/\/*$/, '');
      } catch (e) {
        console.error("[PROXY] Error decoding URL:", e);
      }
    }

    let ref = c.req.query("ref");
    if (ref) {
      try {
        ref = decodeURIComponent(ref);
      } catch (e) {
        console.error("[PROXY] Error decoding referer:", e);
      }
    }

    if (!url) {
      return createErrorResponse("URL parameter is required", 400);
    }

    console.log(`[PROXY] Fetching: ${url}`);
    console.log(`[PROXY] Referer: ${ref || 'none'}`);

    // Check if this is an image or media file
    const isImage = url.match(/\.(jpg|jpeg|png|webp|gif)$/i) !== null;
    const isMedia = url.match(/\.(mp4|webm|mp3|ts)$/i) !== null;
    
    if (isImage || isMedia) {
      console.log(`[PROXY] Handling as ${isImage ? 'image' : 'media'} file`);
    }

    const headers: HeadersInit = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      "Accept": isImage ? "image/*" : "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Connection": "keep-alive"
    };

    // Only handle Krussdomi feeds specially
    const isKrussdomiFeed = url.includes('hls.krussdomi.com');
    
    if (isKrussdomiFeed) {
      // For Krussdomi feeds, we use the feed URL itself as referer to maintain authorization
      console.log(`[PROXY] Detected Krussdomi feed, using feed URL as referer`);
      headers["Referer"] = url;
      headers["Origin"] = "https://hls.krussdomi.com";
      
      // For HLS media files, use the master m3u8 URL as referer
      if (isMedia) {
        // Extract content ID from URL - this is typically the first ID in the path
        const match = url.match(/\/([a-f0-9]+)\/[a-f0-9]+\//);
        if (match && match[1]) {
          const contentId = match[1];
          console.log(`[PROXY] Extracted content ID: ${contentId}`);
          
          // Construct the master m3u8 URL as the referer
          const masterReferer = `https://hls.krussdomi.com/manifest/${contentId}/master.m3u8`;
          console.log(`[PROXY] Using master m3u8 as referer: ${masterReferer}`);
          
          headers["Referer"] = masterReferer;
        }
      }
    } else if (ref) {
      // For non-Krussdomi resources, use provided referer
      try {
        headers["Referer"] = ref;
        headers["Origin"] = new URL(ref).origin;
      } catch (e) {
        console.error("[PROXY] Invalid referer URL:", e);
      }
    } else {
      // No referer provided and not Krussdomi
      try {
        // Standard fallback to URL origin
        const urlObj = new URL(url);
        headers["Referer"] = urlObj.origin;
        headers["Origin"] = urlObj.origin;
      } catch (e) {
        console.error("[PROXY] Error setting default referer:", e);
      }
    }

    console.log(`[PROXY] Using Referer: ${headers["Referer"]}`);
    console.log(`[PROXY] Using Origin: ${headers["Origin"]}`);

    const response = await fetch(url, {
      headers,
      redirect: 'follow'
    });

    console.log(`[PROXY] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[PROXY] Error response:`, errorText);
      return createErrorResponse("Failed to fetch from remote server", response.status);
    }

    // For images/media, return as binary
    if (isImage || isMedia) {
      const data = await response.arrayBuffer();
      console.log(`[PROXY] Successfully fetched ${data.byteLength} bytes`);
      
      // Prepare response headers with CORS
      const responseHeaders = new Headers(corsHeaders);
      
      // Set content type based on file extension if not provided
      let contentType = response.headers.get("content-type");
      if (!contentType) {
        if (isImage) {
          // Set appropriate content type for images if not provided
          if (url.endsWith('.jpg') || url.endsWith('.jpeg')) {
            contentType = "image/jpeg";
          } else if (url.endsWith('.png')) {
            contentType = "image/png";
          } else if (url.endsWith('.webp')) {
            contentType = "image/webp";
          } else if (url.endsWith('.gif')) {
            contentType = "image/gif";
          }
        } else if (isMedia) {
          // Set appropriate content type for media if not provided
          if (url.endsWith('.ts')) {
            contentType = "video/mp2t";
          } else if (url.endsWith('.mp4')) {
            contentType = "video/mp4";
          } else if (url.endsWith('.mp3')) {
            contentType = "audio/mpeg";
          }
        }
      }
      if (contentType) {
        responseHeaders.set("Content-Type", contentType);
      }
      
      const contentLength = response.headers.get("content-length");
      if (contentLength) {
        responseHeaders.set("Content-Length", contentLength);
      }
      
      // Copy caching headers
      const cacheControl = response.headers.get("cache-control");
      if (cacheControl) {
        responseHeaders.set("Cache-Control", cacheControl);
      } else {
        responseHeaders.set("Cache-Control", "public, max-age=86400");
      }

      // Return the response with CORS headers
      return new Response(data, {
        status: response.status,
        headers: responseHeaders
      });
    }

    // Prepare response headers
    const responseHeaders = new Headers(corsHeaders);
    
    // Copy important headers from the original response
    const contentType = response.headers.get("content-type");
    if (contentType) {
      responseHeaders.set("Content-Type", contentType);
    }
    
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }
    
    // Copy caching headers
    const cacheControl = response.headers.get("cache-control");
    if (cacheControl) {
      responseHeaders.set("Cache-Control", cacheControl);
    } else {
      responseHeaders.set("Cache-Control", "public, max-age=86400");
    }

    // Return the response with CORS headers
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders
    });
  } catch (error: any) {
    console.error("[PROXY] Error:", error);
    return createErrorResponse("Failed to proxy request", 500);
  }
};

function createErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders
    }
  });
}
