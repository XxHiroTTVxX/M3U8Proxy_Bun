import type { Context } from "hono";
import { corsHeaders } from "./proxy";
import { M3U8Parser, createCorsResponse } from "./m3u8";
import fs from "fs";
import path from "path";

// Path to the intro file
const INTRO_PATH = path.join(process.cwd(), "src", "intro", "intro.ts");

export const handleM3U8WithIntro = async (c: Context) => {
  try {
    // Get URL from query parameters
    const url = c.req.query("url");
    if (!url) {
      return c.json({ error: "URL parameter is required" });
    }

    // Get referrer info
    const ref = c.req.query("ref") || c.req.header("Referer");

    // Log the request
    console.log(`[M3U8-Intro] Proxying playlist with intro: ${url}`);
    console.log(`[M3U8-Intro] Referrer: ${ref || "none"}`);

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
      console.error(`[M3U8-Intro] Error fetching playlist: ${response.status} ${response.statusText}`);
      return c.json({ error: "Failed to fetch playlist", status: response.status });
    }

    // Get the playlist content
    const content = await response.text();
    console.log(`[M3U8-Intro] Playlist fetched successfully (${content.length} bytes)`);

    // Split into lines for processing
    const lines = content.split("\n");

    // Determine the type of playlist (master or media)
    const isMasterPlaylist = M3U8Parser.isPlaylistM3U8(lines);
    console.log(`[M3U8-Intro] Playlist type: ${isMasterPlaylist ? "Master" : "Media"}`);

    let finalContent: string;
    
    if (isMasterPlaylist) {
      // For master playlists, modify URLs to point to our m3u8-intro endpoint instead of m3u8
      finalContent = fixMasterPlaylistUrls(lines, url, ref);
    } else {
      // For media playlists, fix URLs and insert intro at the beginning
      const updatedContent = M3U8Parser.fixM3U8Urls(lines, url, "/proxy", ref);
      finalContent = insertIntroIntoM3U8(updatedContent);
    }

    // Create response with appropriate headers
    const additionalHeaders: Record<string, string> = {
      "Cache-Control": "no-cache",
      "Content-Disposition": 'inline; filename="playlist.m3u8"'
    };
    
    return createCorsResponse(
      finalContent,
      200,
      "application/vnd.apple.mpegurl",
      additionalHeaders
    );
  } catch (error: any) {
    console.error("[M3U8-Intro] Error processing playlist:", error);
    return c.json({ error: "Error processing playlist", message: error.message || "Unknown error" });
  }
};

/**
 * Fix URLs in master playlist to use m3u8-intro endpoint instead of m3u8
 * 
 * @param lines The lines of the M3U8 content
 * @param baseUrl The base URL of the playlist
 * @param ref The referrer URL
 * @returns The modified M3U8 content
 */
function fixMasterPlaylistUrls(lines: string[], baseUrl: string, ref?: string): string {
  // First, fix the URLs using the standard M3U8Parser
  const fixedContent = M3U8Parser.fixM3U8Urls(lines, baseUrl, "/proxy", ref);
  
  // Then, replace all occurrences of /m3u8? with /m3u8-intro?
  const modifiedContent = fixedContent.replace(/\/m3u8\?/g, '/m3u8-intro?');
  
  console.log(`[M3U8-Intro] Modified master playlist URLs to use intro endpoint`);
  return modifiedContent;
}

/**
 * Insert the intro video into an M3U8 playlist
 * 
 * @param m3u8Content The original M3U8 content
 * @returns The modified M3U8 content with intro
 */
function insertIntroIntoM3U8(m3u8Content: string): string {
  try {
    // Check if the intro file exists
    if (!fs.existsSync(INTRO_PATH)) {
      console.error(`[M3U8-Intro] Intro file not found at ${INTRO_PATH}`);
      return m3u8Content;
    }

    const lines = m3u8Content.split('\n');
    const resultLines: string[] = [];
    
    // Variables to keep track of the playlist structure
    let foundFirstSegment = false;
    let seenMediaSequence = false;
    let mediaSequenceValue = 0;
    let targetDuration = 0;
    let introSegmentDuration = 6.222948; // Exact duration of the intro segment in seconds
    
    // Extract target duration if present
    const targetDurationLine = lines.find(line => line.startsWith('#EXT-X-TARGETDURATION'));
    if (targetDurationLine) {
      const match = targetDurationLine.match(/#EXT-X-TARGETDURATION:(\d+)/);
      if (match && match[1]) {
        targetDuration = parseInt(match[1], 10);
      }
    }
    
    // Process each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Process media sequence - we need to increment it by 1 since we're adding a segment
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        seenMediaSequence = true;
        const match = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
        if (match && match[1]) {
          mediaSequenceValue = parseInt(match[1], 10);
          // Don't increment media sequence if we're adding to beginning
          resultLines.push(line);
        } else {
          resultLines.push(line);
        }
        continue;
      }
      
      // Always add the header lines without modification
      if (line.startsWith('#EXTM3U') || 
          line.startsWith('#EXT-X-VERSION') || 
          line.startsWith('#EXT-X-TARGETDURATION') ||
          line.startsWith('#EXT-X-PLAYLIST-TYPE')) {
        resultLines.push(line);
        continue;
      }
      
      // When we find the first segment, insert our intro
      if (!foundFirstSegment && line.startsWith('#EXTINF')) {
        foundFirstSegment = true;
        
        // If we haven't seen a media sequence yet, add it with value 0
        if (!seenMediaSequence) {
          resultLines.push('#EXT-X-MEDIA-SEQUENCE:0');
        }
        
        // Get the server URL from environment or default to localhost
        const serverUrl = process.env.SERVER_URL || 'http://localhost:3001';
        
        // Add the intro segment
        resultLines.push(`#EXTINF:${introSegmentDuration},Intro`);
        
        // Use an absolute URL to the intro video through our proxy
        const introUrl = `${serverUrl}/proxy?url=${encodeURIComponent(`${serverUrl}/intro/intro.ts`)}`;
        resultLines.push(introUrl);
        
        // Add discontinuity marker to signal the player that there's a discontinuity between intro and main content
        resultLines.push('#EXT-X-DISCONTINUITY');
        
        console.log(`[M3U8-Intro] Inserted intro at ${introUrl} with discontinuity marker`);
        
        // Then add the current segment
        resultLines.push(line);
      } else {
        resultLines.push(line);
      }
    }
    
    console.log(`[M3U8-Intro] Successfully inserted intro into playlist`);
    return resultLines.join('\n');
  } catch (error) {
    console.error('[M3U8-Intro] Error inserting intro:', error);
    return m3u8Content;
  }
} 