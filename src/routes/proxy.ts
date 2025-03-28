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
        console.error("[PROXY] Invalid referer URL:", ref);
      }
    }

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
