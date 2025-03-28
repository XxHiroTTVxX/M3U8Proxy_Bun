import type { Context } from "hono";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "3600",
};

export const handleProxy = async (c: Context) => {
  const url = c.req.query("url");
  const ref = c.req.query("ref");

  if (!url) {
    return new Response(JSON.stringify({ error: "URL parameter is required" }), { status: 400 });
  }

  try {
    const headers: HeadersInit = {
      ...corsHeaders,
    };

    if (ref) {
      headers["Referer"] = ref;
    }

    const response = await fetch(url, {
      headers,
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch from remote server" }), { status: response.status });
    }

    const contentType = response.headers.get("content-type");
    if (contentType) {
      c.header("Content-Type", contentType);
    }

    // Add CORS headers to response
    Object.entries(corsHeaders).forEach(([key, value]) => {
      c.header(key, value);
    });

    // Convert the response body to a string to ensure compatibility
    const responseText = await response.text();
    return c.text(responseText);
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to proxy request" }), { status: 500 });
  }
};
