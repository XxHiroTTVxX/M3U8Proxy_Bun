import type { Context } from "hono";
import { createCorsResponse } from "./m3u8";
import { Buffer } from "node:buffer";
import crypto from "crypto";

/**
 * AES Encryption/Decryption class for URL handling
 */
class AES {
  /**
   * Encrypts the given plain text using AES-256-CBC.
   * 
   * @param plainText - The text to encrypt
   * @param key - The encryption key (must be 32 bytes for AES-256)
   * @returns Base64 encoded string with IV prepended to cipher data
   */
  static encrypt(plainText: string, key: string): string {
    // Create a buffer of the key with appropriate length
    const keyBuffer = Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf-8');
    
    // Create the cipher and IV
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    
    // Encrypt the data
    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    // Combine IV and encrypted data and return as base64
    const combinedData = Buffer.concat([
      iv,
      Buffer.from(encrypted, 'base64')
    ]);
    
    return combinedData.toString('base64');
  }
  
  /**
   * Decrypts the given encrypted text using AES-256-CBC.
   * 
   * @param combinedString - The base64 encoded string with IV and cipher data
   * @param key - The encryption key (must be 32 bytes for AES-256)
   * @returns The original plain text
   */
  static decrypt(combinedString: string, key: string): string {
    try {
      // Create a buffer of the key with appropriate length
      const keyBuffer = Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf-8');
      
      // Convert the combined data from base64
      const combinedData = Buffer.from(combinedString, 'base64');
      
      // Extract the IV (first 16 bytes)
      const iv = combinedData.subarray(0, 16);
      
      // Extract the encrypted data (rest of the buffer)
      const encryptedData = combinedData.subarray(16);
      
      // Create the decipher
      const decipher = crypto.createDecipheriv('aes-256-cbc', keyBuffer, iv);
      
      // Decrypt the data
      let decrypted = decipher.update(encryptedData);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      console.error('[VIDEO] Decryption error:', error);
      throw new Error('Failed to decrypt URL');
    }
  }
}

/**
 * Handles video proxy requests
 * This endpoint accepts an encrypted URL, decrypts it, and proxies the content
 */
export const handleVideo = async (c: Context) => {
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
    // Get the encrypted URL parameter
    const encryptedUrl = c.req.param('encrypted_url');
    
    if (!encryptedUrl) {
      return createCorsResponse(
        JSON.stringify({ error: "Encrypted URL parameter is required" }),
        400,
        "application/json"
      );
    }
    
    // Get the secret key from environment
    const secretKey = Bun.env.SECRET_KEY;
    if (!secretKey) {
      return createCorsResponse(
        JSON.stringify({ error: "Server configuration error: SECRET_KEY not defined" }),
        500,
        "application/json"
      );
    }
    
    // Decrypt the URL
    let url: string;
    try {
      url = AES.decrypt(encryptedUrl, secretKey);
      console.log(`[VIDEO] Decrypted URL: ${url}`);
    } catch (error) {
      return createCorsResponse(
        JSON.stringify({ error: "Invalid encrypted URL" }),
        400,
        "application/json"
      );
    }
    
    // Get referer from query parameter if provided
    let ref = c.req.query("ref");
    if (ref) {
      try {
        ref = decodeURIComponent(ref);
      } catch (e) {
        console.error("[VIDEO] Error decoding referer:", e);
      }
    }
    
    console.log(`[VIDEO] Fetching: ${url}`);
    console.log(`[VIDEO] Referer: ${ref || 'none'}`);
    
    // Prepare headers for the fetch request
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
        console.error("[VIDEO] Invalid referer URL:", ref);
      }
    }
    
    // Fetch the content from the decrypted URL
    const response = await fetch(url, {
      headers,
      redirect: 'follow'
    });
    
    console.log(`[VIDEO] Response status: ${response.status}`);
    console.log(`[VIDEO] Content-Type: ${response.headers.get("content-type")}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[VIDEO] Error response:`, errorText);
      return createCorsResponse(
        JSON.stringify({ 
          error: "Failed to fetch from remote server", 
          status: response.status,
          details: errorText.slice(0, 200)
        }),
        response.status, 
        "application/json"
      );
    }
    
    // Prepare response headers
    const responseHeaders = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400"
    });
    
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
    console.error("[VIDEO] Error:", error);
    return createCorsResponse(
      JSON.stringify({ 
        error: "Failed to process video request",
        details: error?.message || "Unknown error"
      }),
      500,
      "application/json"
    );
  }
};

/**
 * Creates an encrypted URL for the video route
 * This is a helper function for testing and integration
 * 
 * @param sourceUrl The original media URL to encrypt
 * @param baseUrl The base URL of the proxy server
 * @returns The full proxy URL with encrypted parameter
 */
export function createEncryptedVideoUrl(sourceUrl: string, baseUrl: string = ''): string {
  const secretKey = Bun.env.SECRET_KEY;
  if (!secretKey) {
    throw new Error("SECRET_KEY is not defined in environment");
  }
  
  const encryptedUrl = AES.encrypt(sourceUrl, secretKey);
  return `${baseUrl}/video/${encryptedUrl}`;
}

// Export AES class for use in other modules
export { AES };
