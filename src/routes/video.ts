import { Hono } from 'hono';
import { AES } from '../utils/AES';

const videoRoute = new Hono();

// Match both formats:
// /video/:encryptedUrl (original)
// /video/:encryptedUrl/:referer (new format with encoded referer)
videoRoute.get('/video/:encryptedData', async (c) => {
  try {
    const encryptedData = c.req.param('encryptedData');
    console.log('[VideoProxy] Encrypted data received:', encryptedData.substring(0, 30) + '...');
    
    // Decrypt the data
    const secretKey = Bun.env.SECRET_KEY;
    if (!secretKey) {
      console.error('[VideoProxy] SECRET_KEY is not defined in environment');
      return c.text('SECRET_KEY is not defined', 500);
    }
    
    console.log('[VideoProxy] Secret key length:', secretKey.length);
    
    // Decrypt the data (contains both URL and referer)
    let decryptedData;
    try {
      decryptedData = AES.Decrypt(encryptedData, secretKey);
      console.log('[VideoProxy] Successfully decrypted data:', decryptedData.substring(0, 100) + '...');
    } catch (error) {
      console.error('[VideoProxy] Error decrypting data:', error);
      return c.text(`Error decrypting data: ${error instanceof Error ? error.message : String(error)}`, 500);
    }
    
    // Parse the decrypted data - expecting JSON format { url: string, referer: string }
    let targetUrl: string;
    let referer: string;
    
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(decryptedData);
      targetUrl = parsed.url;
      referer = parsed.referer || 'https://megacloud.club/';
      console.log('[VideoProxy] Successfully parsed JSON data');
    } catch (e) {
      console.error('[VideoProxy] Error parsing JSON, falling back to plain URL:', e);
      // Fallback: assume it's just the URL without referer
      targetUrl = decryptedData;
      referer = c.req.header('referer') || 'https://megacloud.club/';
    }
    
    console.log(`[VideoProxy] Fetching content from: ${targetUrl}`);
    console.log(`[VideoProxy] Using referer: ${referer}`);
    
    // Directly fetch the content
    let response;
    try {
      response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': '*/*',
          'Referer': referer,
          'Origin': new URL(referer).origin
        }
      });
    } catch (error) {
      console.error('[VideoProxy] Error fetching content:', error);
      return c.text(`Error fetching content: ${error instanceof Error ? error.message : String(error)}`, 500);
    }
    
    if (!response.ok) {
      console.error(`[VideoProxy] Failed to fetch content: ${response.status} ${response.statusText}`);
      return c.text(`Failed to fetch content: ${response.status}`, response.status as any);
    }
    
    // Get content type from the original response or default to appropriate type
    const contentType = response.headers.get('content-type') || 
                        (targetUrl.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 
                        (targetUrl.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream'));
    
    // Read response as array buffer
    const responseData = await response.arrayBuffer();
    console.log(`[VideoProxy] Successfully fetched content (${responseData.byteLength} bytes)`);
    
    // For m3u8 files, we need to process the content to rewrite URLs
    if (targetUrl.endsWith('.m3u8') && contentType.includes('m3u8')) {
      const m3u8Content = new TextDecoder().decode(responseData);
      console.log(`[VideoProxy] Processing M3U8 content (${m3u8Content.length} bytes)`);
      
      // Process the M3U8 content to rewrite any URLs to use our proxy
      const processedContent = processM3U8Content(m3u8Content, targetUrl, referer, c.req.url);
      
      console.log(`[VideoProxy] M3U8 content processed (${processedContent.length} bytes)`);
      return new Response(processedContent, {
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'max-age=3600'
        }
      });
    }
    
    // Return the response with appropriate headers
    return new Response(responseData, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'max-age=3600'
      }
    });
  } catch (error) {
    console.error('Error processing video request:', error);
    return c.text(`Failed to process video request: ${error instanceof Error ? error.message : String(error)}`, 500);
  }
});

// Function to process M3U8 content and rewrite URLs
function processM3U8Content(content: string, originalUrl: string, referer: string, currentUrl: string): string {
  try {
    // Get base URL from current request
    const baseUrl = new URL(currentUrl);
    const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
    
    // Get the base directory of the original URL for resolving relative paths
    const originalUrlObj = new URL(originalUrl);
    const originalBasePath = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);
    
    const lines = content.split('\n');
    const processedLines: string[] = [];
    
    // Used to track the last URI key in case of attributes that define a URI
    let lastUriKey = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip empty lines
      if (line.trim() === '') {
        processedLines.push(line);
        continue;
      }
      
      // Process directive lines (starting with #)
      if (line.startsWith('#')) {
        // Check if the line contains a URI attribute that needs processing
        if (line.includes('URI="')) {
          // Handle lines with inline URIs like #EXT-X-KEY:METHOD=AES-128,URI="key.key"
          const processedLine = line.replace(/URI="([^"]+)"/g, (match, uri) => {
            // Check if the URI is relative or absolute
            const absoluteUri = uri.startsWith('http://') || uri.startsWith('https://')
              ? uri
              : new URL(uri, originalBasePath).toString();
              
            // Encrypt the URI with referer
            const encryptedUri = encryptUrlWithReferer(absoluteUri, referer);
            return `URI="${basePath}${encryptedUri}"`;
          });
          processedLines.push(processedLine);
        } 
        // Handle #EXT-X-STREAM-INF which is followed by a URL on the next line
        else if (line.startsWith('#EXT-X-STREAM-INF')) {
          processedLines.push(line);
          lastUriKey = 'STREAM-INF';
        }
        // Handle #EXT-X-I-FRAME-STREAM-INF with inline URI
        else if (line.startsWith('#EXT-X-I-FRAME-STREAM-INF')) {
          const processedLine = line.replace(/URI="([^"]+)"/g, (match, uri) => {
            const absoluteUri = uri.startsWith('http://') || uri.startsWith('https://')
              ? uri
              : new URL(uri, originalBasePath).toString();
              
            const encryptedUri = encryptUrlWithReferer(absoluteUri, referer);
            return `URI="${basePath}${encryptedUri}"`;
          });
          processedLines.push(processedLine);
        }
        // Handle other non-URL directives
        else {
          processedLines.push(line);
          lastUriKey = '';
        }
      } 
      // Process URLs (non-# lines)
      else {
        // If it's the URL following an #EXT-X-STREAM-INF directive
        if (lastUriKey === 'STREAM-INF') {
          const absoluteUri = line.startsWith('http://') || line.startsWith('https://')
            ? line
            : new URL(line, originalBasePath).toString();
          
          const encryptedUri = encryptUrlWithReferer(absoluteUri, referer);
          processedLines.push(`${basePath}${encryptedUri}`);
          lastUriKey = '';
        }
        // If it's a segment URL or any other URL
        else {
          const absoluteUri = line.startsWith('http://') || line.startsWith('https://')
            ? line
            : new URL(line, originalBasePath).toString();
          
          const encryptedUri = encryptUrlWithReferer(absoluteUri, referer);
          processedLines.push(`${basePath}${encryptedUri}`);
        }
      }
    }
    
    return processedLines.join('\n');
  } catch (error) {
    console.error('[M3U8Processor] Error processing M3U8 content:', error);
    // Return original content if processing fails
    return content;
  }
}

// Helper function to encrypt URL with referer
function encryptUrlWithReferer(url: string, referer: string): string {
  try {
    // Create a data object containing both URL and referer
    const dataToEncrypt = JSON.stringify({
      url: url,
      referer: referer
    });
    
    // Encrypt the combined data
    return AES.Encrypt(dataToEncrypt, Bun.env.SECRET_KEY || 'fallback-key-for-testing');
  } catch (error) {
    console.error(`[VideoProxy] Error encrypting URL ${url}:`, error);
    // Return a non-encrypted version if encryption fails
    return encodeURIComponent(url);
  }
}

export { videoRoute };
