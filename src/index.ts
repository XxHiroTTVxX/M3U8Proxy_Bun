import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { handleProxy } from "./routes/proxy";
import { handleM3U8 } from "./routes/m3u8";
import { handleM3U8WithIntro } from "./routes/m3u8WithIntro";
import videoRoute from "./routes/video";
import fs from "fs";
import path from "path";

const app = new Hono();

app.use(logger());
app.use(cors({
  origin: '*',
  allowHeaders: ['*'],
  allowMethods: ['GET', 'HEAD', 'OPTIONS'],
  exposeHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400,
  credentials: true
}));

// Set the SERVER_URL environment variable based on the request
app.use('*', async (c, next) => {
  const host = c.req.header('host');
  if (host) {
    const protocol = host.includes('localhost') ? 'http' : 'https';
    process.env.SERVER_URL = `${protocol}://${host}`;
    console.log(`[Server] Set SERVER_URL to ${process.env.SERVER_URL}`);
  }
  await next();
});

app.get("/", (c) => {
  return c.text("M3U8 Proxy - Use /m3u8?url=YOUR_M3U8_URL, /proxy?url=YOUR_URL to proxy content, or /youtube/YOUTUBE_ID to view a YouTube video");
});


app.get("/proxy", handleProxy);
app.get("/m3u8", handleM3U8);
app.get("/m3u8-intro", handleM3U8WithIntro);
// Mount the video route at the root '/' so its internal '/video/:encryptedUrl' path works correctly
app.route("/", videoRoute);
// Handler for serving the intro file directly
app.get("/intro/intro.ts", async (c) => {
  try {
    const introPath = path.join(process.cwd(), "src", "intro", "intro.ts");
    if (!fs.existsSync(introPath)) {
      console.error(`[Intro] Intro file not found at ${introPath}`);
      return c.json({ error: "Intro file not found" }, 404);
    }

    const fileBuffer = await fs.promises.readFile(introPath);
    console.log(`[Intro] Serving intro file (${fileBuffer.length} bytes)`);

    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "video/mp2t",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "max-age=3600"
      }
    });
  } catch (error: any) {
    console.error(`[Intro] Error serving intro file:`, error);
    return c.json({ error: "Error serving intro file", message: error.message || "Unknown error" }, 500);
  }
});

// Special handler for key files - intercept paths that look like key paths
app.get('/keys/:keyId', async (c) => {
  const keyId = c.req.param('keyId');
  console.log(`[KeyProxy] Request for key: ${keyId}`);
  
  // Get the referer to determine the base URL
  const referer = c.req.header('Referer') || '';
  const originUrl = c.req.header('Origin') || '';
  
  // Extract the current page URL to find what HLS file is being played
  let hlsUrl = '';
  const urlMatch = referer.match(/\/(?:m3u8|proxy)\?url=([^&]+)/);
  if (urlMatch && urlMatch[1]) {
    try {
      hlsUrl = decodeURIComponent(urlMatch[1]);
      console.log(`[KeyProxy] Detected HLS URL: ${hlsUrl}`);
    } catch (e) {
      console.error("[KeyProxy] Error decoding HLS URL:", e);
    }
  }
  
  // Try to determine the base URL from several sources
  let baseUrl = '';
  
  // Option 1: Analyze HLS URL to find the base path
  if (hlsUrl) {
    try {
      const hlsUrlObj = new URL(hlsUrl);
      
      // Get directory path from HLS URL
      let path = hlsUrlObj.pathname;
      
      // Remove filenames to get directory
      if (path.includes('.')) {
        path = path.substring(0, path.lastIndexOf('/') + 1);
      }
      
      baseUrl = `${hlsUrlObj.origin}${path}`;
      console.log(`[KeyProxy] Base URL from HLS: ${baseUrl}`);
    } catch (e) {
      console.error("[KeyProxy] Error extracting base URL from HLS URL:", e);
    }
  }
  
  // Option 2: Extract from query parameters in referer
  if (!baseUrl) {
    try {
      const match = referer.match(/url=([^&]+)/);
      if (match && match[1]) {
        baseUrl = decodeURIComponent(match[1]);
        
        // Extract the base directory from the URL (remove filename if present)
        if (!baseUrl.endsWith('/')) {
          const lastSlash = baseUrl.lastIndexOf('/');
          if (lastSlash > 0) {
            baseUrl = baseUrl.substring(0, lastSlash + 1);
          }
        }
        
        console.log(`[KeyProxy] Extracted base URL from referer: ${baseUrl}`);
      }
    } catch (e) {
      console.error("[KeyProxy] Error extracting base URL from referer:", e);
    }
  }
  
  // If we still don't have a base URL, use a hardcoded fallback
  if (!baseUrl) {
    // Try to extract domain from the keyId if possible
    if (hlsUrl) {
      try {
        const urlObj = new URL(hlsUrl);
        baseUrl = `${urlObj.origin}/958c12d6-3754-4d1a-81c3-afe3764eead1/`;
      } catch (e) {
        console.error("[KeyProxy] Error creating fallback URL:", e);
      }
    } else {
      baseUrl = 'https://seiryuu.vid-cdn.xyz/958c12d6-3754-4d1a-81c3-afe3764eead1/';
    }
    console.log(`[KeyProxy] Using fallback URL: ${baseUrl}`);
  }
  
  // Construct the full key URL
  let keyUrl = `${baseUrl}keys/${keyId}`;
  
  // Handle case where baseUrl already ends with 'keys/'
  if (baseUrl.endsWith('keys/')) {
    keyUrl = `${baseUrl}${keyId}`;
  }
  
  console.log(`[KeyProxy] Fetching key from: ${keyUrl}`);
  
  try {
    const response = await fetch(keyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Referer': referer || baseUrl,
        'Origin': originUrl || new URL(baseUrl).origin
      }
    });
    
    if (!response.ok) {
      console.error(`[KeyProxy] Failed to fetch key: ${response.status}`);
    }
    
    const keyData = await response.arrayBuffer();
    console.log(`[KeyProxy] Successfully fetched key: ${keyId} (${keyData.byteLength} bytes)`);
    
    return new Response(keyData, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=3600'
      }
    });
  } catch (error: any) {
    console.error("[KeyProxy] Error fetching key:", error);
    return new Response(`Error fetching key: ${error.message}`, { status: 500 });
  }
});

// Handle any request that looks like a segment file
app.get('*', async (c) => {
  const path = c.req.path;
  
  // Process .ts segment files and other media files (jpg, png, webp, mp4, etc.)
  const isMedia = path.endsWith('.ts') || 
                 path.endsWith('.jpg') || 
                 path.endsWith('.jpeg') || 
                 path.endsWith('.png') || 
                 path.endsWith('.webp') || 
                 path.endsWith('.mp4') || 
                 path.endsWith('.webm');
  
  if (!isMedia) {
    // Skip non-media files
    return c.notFound();
  }
  
  console.log(`[GlobalMediaProxy] Intercepted request for: ${path}`);
  
  // Extract file ID from path
  const fileId = path.split('/').pop() || '';
  const fileExtension = fileId.includes('.') ? fileId.split('.').pop() : '';
  
  // Get the referer to determine the base URL
  const referer = c.req.header('Referer') || '';
  const originUrl = c.req.header('Origin') || '';
  
  console.log(`[GlobalMediaProxy] File: ${fileId}, Referer: ${referer}`);
  
  // Extract the current page URL to find what HLS file is being played
  let hlsUrl = '';
  const urlMatch = referer.match(/\/(?:m3u8|proxy)\?url=([^&]+)/);
  if (urlMatch && urlMatch[1]) {
    try {
      hlsUrl = decodeURIComponent(urlMatch[1]);
      console.log(`[GlobalMediaProxy] Detected HLS URL: ${hlsUrl}`);
    } catch (e) {
      console.error("[GlobalMediaProxy] Error decoding HLS URL:", e);
    }
  }
  
  // Try to determine the base URL from several sources
  let baseUrl = '';
  
  // Special case for Krussdomi
  const isKrussdomiFeed = referer.includes('hls.krussdomi.com') || 
                          hlsUrl.includes('hls.krussdomi.com');
  
  // Special case for Seiryuu
  const isSeiryuuFeed = referer.includes('seiryuu.vid-cdn.xyz') || 
                        hlsUrl.includes('seiryuu.vid-cdn.xyz');
  
  if (isSeiryuuFeed && path.endsWith('.ts')) {
    console.log(`[GlobalMediaProxy] Detected Seiryuu TS segment: ${path}`);
    
    // Convert the path to a proper URL
    let segmentUrl = '';
    
    try {
      if (hlsUrl) {
        // Extract the base directory from the HLS URL
        const hlsUrlObj = new URL(hlsUrl);
        const basePath = hlsUrlObj.pathname.substring(0, hlsUrlObj.pathname.lastIndexOf('/') + 1);
        const baseDirectory = `${hlsUrlObj.origin}${basePath}`;
        
        // Get the segment path, handling both absolute and relative paths
        const segmentPath = path.startsWith('/') ? path : path;
        
        // Create the full segment URL
        segmentUrl = new URL(segmentPath, baseDirectory).href;
        console.log(`[GlobalMediaProxy] Constructed Seiryuu segment URL: ${segmentUrl}`);
      } else {
        // Extract segment ID from the path as fallback
        const segmentId = path.split('/').pop() || '';
        
        // Try to extract the content ID from the path
        const contentMatch = path.match(/\/([a-f0-9\-]+)\/(?:video|audio)\/[^\/]+\/([^\/]+)\.ts/);
        if (contentMatch && contentMatch[1]) {
          const contentId = contentMatch[1];
          const quality = path.includes('/video/') ? path.split('/video/')[1].split('/')[0] : '1080';
          const fileNum = segmentId.replace('.ts', '');
          
          segmentUrl = `https://seiryuu.vid-cdn.xyz/${contentId}/video/${quality}/${fileNum}.ts`;
          console.log(`[GlobalMediaProxy] Constructed Seiryuu segment URL: ${segmentUrl}`);
        }
      }
      
      if (segmentUrl) {
        // Proxy the segment with special handling
        return c.redirect(`/proxy?url=${encodeURIComponent(segmentUrl)}&ref=${encodeURIComponent(hlsUrl || referer)}`);
      }
    } catch (e) {
      console.error("[GlobalMediaProxy] Error processing Seiryuu segment:", e);
    }
  }
  
  if (isKrussdomiFeed) {
    // For Krussdomi HLS feeds, determine proper base URL from HLS URL
    try {
      // Try to extract content ID from the original URL
      let contentId = '';
      const contentMatch = hlsUrl.match(/manifest\/([a-f0-9]+)\//);
      if (contentMatch && contentMatch[1]) {
        contentId = contentMatch[1];
        console.log(`[GlobalMediaProxy] Extracted Krussdomi content ID: ${contentId}`);
        
        // Construct proper proxying for this content
        const possibleExtensions = ['ts', 'jpg', 'jpeg', 'png', 'mp4'];
        const fileExtension = fileId.split('.').pop() || '';
        
        for (const extension of possibleExtensions) {
          if (fileExtension === extension) {
            // Return the file through our proxy with proper referrer
            const segmentUrl = path.startsWith('/') ? path : `/${path}`;
            const fullSegmentUrl = `https://hls.krussdomi.com${segmentUrl}`;
            const proxyUrl = `/proxy?url=${encodeURIComponent(fullSegmentUrl)}&ref=${encodeURIComponent(hlsUrl)}`;
            console.log(`[GlobalMediaProxy] Redirecting to proxied Krussdomi URL: ${proxyUrl}`);
            return c.redirect(proxyUrl);
          }
        }
      }
    } catch (e) {
      console.error("[GlobalMediaProxy] Error processing Krussdomi URL:", e);
    }
  }
  
  // Option 1: Analyze HLS URL to find the base path
  if (hlsUrl) {
    try {
      const hlsUrlObj = new URL(hlsUrl);
      
      // Get directory path from HLS URL
      let path = hlsUrlObj.pathname;
      
      // Remove filenames to get directory
      if (path.includes('.')) {
        path = path.substring(0, path.lastIndexOf('/') + 1);
      }
      
      baseUrl = `${hlsUrlObj.origin}${path}`;
      console.log(`[GlobalMediaProxy] Base URL from HLS: ${baseUrl}`);
    } catch (e) {
      console.error("[GlobalMediaProxy] Error extracting base URL from HLS URL:", e);
    }
  }
  
  // Option 2: Extract from query parameters in referer
  if (!baseUrl) {
    try {
      const match = referer.match(/url=([^&]+)/);
      if (match && match[1]) {
        baseUrl = decodeURIComponent(match[1]);
        
        // Extract the base directory from the URL (remove filename if present)
        if (!baseUrl.endsWith('/')) {
          const lastSlash = baseUrl.lastIndexOf('/');
          if (lastSlash > 0) {
            baseUrl = baseUrl.substring(0, lastSlash + 1);
          }
        }
        
        console.log(`[GlobalMediaProxy] Extracted base URL from referer: ${baseUrl}`);
      }
    } catch (e) {
      console.error("[GlobalMediaProxy] Error extracting base URL from referer:", e);
    }
  }
  
  // Option 3: Try with known path patterns from the URL path
  if (!baseUrl) {
    const pathParts = path.split('/');
    if (pathParts.length > 1) {
      // Path might include directories like /video/1080/00000.ts or /67e8ab4a799084dd1ee0e6f9/019.jpg
      // Extract everything before the filename
      const dirPath = pathParts.slice(0, -1).join('/');
      if (dirPath) {
        console.log(`[GlobalMediaProxy] Potential directory path: ${dirPath}`);
      }
    }
  }
  
  // If we still don't have a base URL, use the original domain from referer
  if (!baseUrl && referer) {
    try {
      const referrerUrl = new URL(referer);
      // Use origin only if we have part of the path from the request
      const pathParts = path.split('/');
      if (pathParts.length > 1) {
        baseUrl = `${referrerUrl.origin}/`;
        console.log(`[GlobalMediaProxy] Using referer origin as base: ${baseUrl}`);
      }
    } catch (e) {
      console.error("[GlobalMediaProxy] Error creating base URL from referer:", e);
    }
  }
  
  // If we still don't have a base URL, extract domain from the path segments
  if (!baseUrl) {
    const pathSegments = path.split('/').filter(s => s);
    if (pathSegments.length >= 2) {
      const potentialId = pathSegments[0];
      // Use common HLS server domains based on the ID pattern in the URL
      const domains = [
        'https://hls.krussdomi.com/manifest/',
        'https://st1.smartinvestmentstrategies.xyz/',
        'https://seiryuu.vid-cdn.xyz/958c12d6-3754-4d1a-81c3-afe3764eead1/'
      ];
      
      for (const domain of domains) {
        baseUrl = `${domain}${potentialId}/`;
        console.log(`[GlobalMediaProxy] Trying potential domain: ${baseUrl}`);
      }
    }
  }
  
  // Try various possible URLs for the file
  let possibleUrls: string[] = [];
  
  // For image files, try specific domains that might serve images for this content
  if (path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.png') || path.endsWith('.webp')) {
    possibleUrls = [
      `https://st1.smartinvestmentstrategies.xyz${path}`,
      `https://hls.krussdomi.com${path}`,
    ];
    
    // If we have path segments that look like IDs, try reconstructing the URL
    const pathSegments = path.split('/').filter(s => s);
    if (pathSegments.length >= 2) {
      possibleUrls.push(`https://st1.smartinvestmentstrategies.xyz/${pathSegments.join('/')}`);
    }
  }
  
  // Add standard URLs as fallbacks
  if (baseUrl) {
    possibleUrls.push(`${baseUrl}${fileId}`);
    possibleUrls.push(`${baseUrl}${path}`);
  }
  
  // Always add the exact path as requested as a last resort
  possibleUrls.push(path);
  
  console.log(`[GlobalMediaProxy] Will try these URLs: ${possibleUrls.join(', ')}`);
  
  // Try each URL in sequence
  for (const mediaUrl of possibleUrls) {
    try {
      // Ensure absolute URL
      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `https://st1.smartinvestmentstrategies.xyz${mediaUrl}`;
      console.log(`[GlobalMediaProxy] Trying: ${fullUrl}`);
      
      const response = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': '*/*',
          'Referer': referer || fullUrl,
          'Origin': originUrl || new URL(fullUrl).origin
        },
        // Short timeout to fail fast and try next URL
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const mediaData = await response.arrayBuffer();
        console.log(`[GlobalMediaProxy] Success with ${fullUrl} (${mediaData.byteLength} bytes)`);
        
        // Determine content type based on extension if not provided by response
        let contentType = response.headers.get('content-type');
        if (!contentType) {
          if (fileExtension === 'ts') contentType = 'video/mp2t';
          else if (fileExtension === 'jpg' || fileExtension === 'jpeg') contentType = 'image/jpeg';
          else if (fileExtension === 'png') contentType = 'image/png';
          else if (fileExtension === 'webp') contentType = 'image/webp';
          else if (fileExtension === 'mp4') contentType = 'video/mp4';
          else if (fileExtension === 'webm') contentType = 'video/webm';
          else contentType = 'application/octet-stream';
        }
        
        return new Response(mediaData, {
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'max-age=3600'
          }
        });
      }
      
      console.log(`[GlobalMediaProxy] Failed with status ${response.status} for ${fullUrl}`);
      
    } catch (error: any) {
      console.error(`[GlobalMediaProxy] Error with ${mediaUrl}: ${error.message}`);
      // Continue to the next URL
    }
  }
  
  // If we got here, all URLs failed
  console.error(`[GlobalMediaProxy] All URLs failed for file ${fileId}`);
  return new Response(`Failed to fetch file: ${fileId}`, { status: 404 });
});

// Special handler for directly requested playlist files
app.get('/playlist.m3u8', async (c) => {
  console.log(`[PlaylistProxy] Direct request for playlist.m3u8`);
  
  // Get the referer to determine the original HLS URL
  const referer = c.req.header('Referer') || '';
  
  // Try to extract the original M3U8 URL from the referer
  let originalUrl = '';
  try {
    const match = referer.match(/\/(?:m3u8|proxy)\?url=([^&]+)/);
    if (match && match[1]) {
      originalUrl = decodeURIComponent(match[1]);
      console.log(`[PlaylistProxy] Extracted URL from referer: ${originalUrl}`);
    }
  } catch (e) {
    console.error("[PlaylistProxy] Error extracting URL from referer:", e);
  }
  
  if (!originalUrl) {
    // Fallback to a hardcoded URL if we can't extract it
    originalUrl = 'https://seiryuu.vid-cdn.xyz/958c12d6-3754-4d1a-81c3-afe3764eead1/video/1080/playlist.m3u8';
    console.log(`[PlaylistProxy] Using fallback URL: ${originalUrl}`);
  }
  
  // Redirect to our proxy with the original URL
  return c.redirect(`/m3u8?url=${encodeURIComponent(originalUrl)}`);
});

// Handle audio playlist requests
app.get('/audio/:languageId/playlist.m3u8', async (c) => {
  const languageId = c.req.param('languageId');
  console.log(`[Audio] Handling audio playlist request for language: ${languageId}`);

  // Get the referer to determine the original HLS URL
  const referer = c.req.header('referer') || '';
  
  // Extract the original URL from the referer
  const originalUrlMatch = referer.match(/url=([^&]+)/);
  if (originalUrlMatch && originalUrlMatch[1]) {
    const decodedUrl = decodeURIComponent(originalUrlMatch[1]);
    console.log(`[Audio] Extracted original URL from referer: ${decodedUrl}`);
    
    // Construct the full audio playlist URL 
    // Replace video playlist URL path with audio path
    const baseUrlParts = decodedUrl.split('/');
    baseUrlParts.pop(); // Remove the last part (filename)
    const baseUrlDir = baseUrlParts.join('/');
    
    // Form the audio URL with the language ID
    const audioUrl = `${baseUrlDir}/audio/${languageId}/playlist.m3u8`;
    console.log(`[Audio] Proxying audio playlist: ${audioUrl}`);
    
    try {
      // Fetch the audio playlist directly
      const response = await fetch(audioUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": referer || decodedUrl,
          "Origin": new URL(referer || decodedUrl).origin
        }
      });
      
      if (!response.ok) {
        console.error(`[Audio] Failed to fetch audio playlist: ${response.status}`);
        return c.json({ error: "Failed to fetch audio playlist", status: response.status }, 500);
      }
      
      // Get the playlist content
      const content = await response.text();
      console.log(`[Audio] Successfully fetched audio playlist (${content.length} bytes)`);
      
      // Process the playlist with our M3U8 parser
      const lines = content.split('\n');
      const { M3U8Parser } = await import('./routes/m3u8');
      
      // Fix URLs in the playlist - force audio flag to ensure proper segment handling
      const fixedContent = M3U8Parser.fixM3U8Urls(lines, audioUrl, '/proxy', referer);
      
      // Log the first few lines of the fixed content for debugging
      const fixedLines = fixedContent.split('\n');
      console.log(`[Audio] Fixed playlist first 10 lines:`);
      fixedLines.slice(0, Math.min(10, fixedLines.length)).forEach(line => {
        console.log(`[Audio] > ${line}`);
      });
      
      // Return the processed playlist with explicit audio content type
      return new Response(fixedContent, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache"
        }
      });
    } catch (error: any) {
      console.error(`[Audio] Error processing audio playlist:`, error);
      return c.json({ 
        error: "Error processing audio playlist", 
        message: error.message || "Unknown error" 
      }, 500);
    }
  }
  
  console.error('[Audio] Failed to extract original URL from referer');
  return c.json({ error: 'Failed to process audio playlist request' }, 400);
});

// Handle audio segment requests
app.get('/audio/:languageId/:segmentId', async (c) => {
  const languageId = c.req.param('languageId');
  const segmentId = c.req.param('segmentId');
  
  console.log(`[Audio] Handling audio segment request: language=${languageId}, segment=${segmentId}`);
  
  // Get the referer to determine the original HLS URL
  const referer = c.req.header('referer') || '';
  let originalUrl = '';
  
  // Extract the original URL from the referer
  const originalUrlMatch = referer.match(/url=([^&]+)/);
  if (originalUrlMatch && originalUrlMatch[1]) {
    originalUrl = decodeURIComponent(originalUrlMatch[1]);
    console.log(`[Audio] Extracted original URL from referer: ${originalUrl}`);
  } else {
    console.error('[Audio] Failed to extract original URL from referer');
    return c.json({ error: 'Failed to process audio segment request' }, 400);
  }
  
  try {
    // Construct the base URL for the audio segments
    const baseUrl = new URL(originalUrl);
    const pathParts = baseUrl.pathname.split('/');
    
    // Replace the last part (playlist.m3u8) with the segment ID
    if (pathParts.length > 0) {
      pathParts[pathParts.length - 1] = segmentId;
      baseUrl.pathname = pathParts.join('/');
    }
    
    const fullSegmentUrl = baseUrl.toString();
    console.log(`[Audio] Fetching audio segment from: ${fullSegmentUrl}`);
    
    // Fetch the segment
    const segmentResponse = await fetch(fullSegmentUrl);
    if (!segmentResponse.ok) {
      console.error(`[Audio] Failed to fetch segment: ${segmentResponse.status} ${segmentResponse.statusText}`);
      return c.json({ 
        error: 'Failed to fetch audio segment',
        status: segmentResponse.status,
        message: segmentResponse.statusText
      }, 500);
    }
    
    // Get the audio segment content
    const audioData = await segmentResponse.arrayBuffer();
    const contentType = segmentResponse.headers.get('content-type') || 'video/mp2t';
    
    // Return the segment with proper headers
    return new Response(audioData, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error: any) {
    console.error('[Audio] Error processing audio segment:', error);
    return c.json({ error: 'Error processing audio segment', message: error.message || 'Unknown error' }, 500);
  }
});

app.options("*", (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400"
    }
  });
});

export default {
  port: process.env.PORT ? parseInt(process.env.PORT) : 3001,
  fetch: app.fetch
};