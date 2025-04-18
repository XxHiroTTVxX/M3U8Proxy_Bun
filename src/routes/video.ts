import { Hono, type Context } from 'hono';
import { AES } from '../utils/crypto';
import { handleM3U8 } from './m3u8'; // Assuming handleM3U8 is exported from m3u8.ts

// --- Known Referrers Configuration ---
// Map target domains to their default referrer URLs
// Add more entries as needed: ['target.domain.com', 'https://referrer.site/']
const knownReferrers = new Map<string, string>([
    ['frostbite27.pro', 'https://megacloud.club/'] // Example entry
]);
// -------------------------------------

// Create a new Hono app instance specifically for this route
const video = new Hono();

// Define the GET route for encrypted video URLs
video.get('/video/:encryptedUrl', async (c: Context) => {
    const encryptedUrlParam = c.req.param('encryptedUrl');
    // Read both possible referrer query parameters
    const encryptedRefParam = c.req.query('encRef');
    const plainRefParam = c.req.query('ref'); // The unencrypted ref param

    const aesKey = process.env.AES_SECRET_KEY || Bun.env.AES_SECRET_KEY; // Get the secret key

    // --- TEMPORARY DEBUG LOG ---
    console.log(`[Video Route Debug] Retrieved Key: ${aesKey || 'Not Set'}`);
    console.log(`[Video Route Debug] Key Length: ${aesKey ? Buffer.from(aesKey).length : 'Not Set'}`);
    // --- END DEBUG LOG ---

    if (!aesKey) {
        console.error("[Video Route] AES_SECRET_KEY environment variable is not set.");
        return c.json({ error: "Server configuration error: Missing secret key." }, 500);
    }
     if (Buffer.from(aesKey).length !== 32) {
        console.error(`[Video Route] AES_SECRET_KEY must be 32 bytes (256 bits). Actual length: ${Buffer.from(aesKey).length}`);
        return c.json({ error: "Server configuration error: Invalid secret key length." }, 500);
    }

    if (!encryptedUrlParam) {
        return c.json({ error: "Encrypted URL parameter is missing." }, 400);
    }

    let decryptedUrl: string;
    let finalRef: string | undefined; // This will hold the final referrer value

    try {
        // Decrypt the main URL first
        decryptedUrl = AES.Decrypt(encryptedUrlParam, aesKey);
        console.log(`[Video Route] Decrypted URL: ${decryptedUrl}`);

        // Determine the referrer
        if (encryptedRefParam) {
            // Prioritize encrypted 'encRef'
            try {
                finalRef = AES.Decrypt(encryptedRefParam, aesKey);
                console.log(`[Video Route] Using Decrypted Referrer (from encRef): ${finalRef}`);
            } catch (refError: any) {
                console.error("[Video Route] Failed to decrypt 'encRef' parameter:", refError);
                return c.json({ error: "Failed to decrypt referrer. Invalid or corrupted data." }, 400);
            }
        } else if (plainRefParam) {
            // If no encrypted ref, use the plain 'ref' if provided
            finalRef = plainRefParam;
            console.log(`[Video Route] Using Plain Referrer (from ref): ${finalRef}`);
        } else {
            // Neither 'encRef' nor 'ref' provided, check knownReferrers
            try {
                const targetUrl = new URL(decryptedUrl);
                const targetHostname = targetUrl.hostname;
                if (knownReferrers.has(targetHostname)) {
                    finalRef = knownReferrers.get(targetHostname);
                    console.log(`[Video Route] Using Known Referrer for ${targetHostname}: ${finalRef}`);
                } else {
                     console.log(`[Video Route] No referrer parameter provided and target host (${targetHostname}) not in knownReferrers.`);
                }
            } catch (urlError) {
                console.error(`[Video Route] Failed to parse decrypted URL (${decryptedUrl}) to check for known referrer:`, urlError);
                // Potentially handle this error, maybe proceed without ref or return error?
                // For now, proceed without ref if URL parsing fails
                console.log(`[Video Route] Proceeding without referrer due to URL parse error.`);
            }
        }

        // Pass the decrypted URL and the determined ref to the M3U8 handler
        return await handleM3U8({ url: decryptedUrl, ref: finalRef });

    } catch (error: any) {
        // Handle decryption error for the main URL
        if (error.message.includes("Invalid encrypted data") || error.message.includes("bad decrypt")) {
             console.error("[Video Route] Failed to decrypt main URL:", error);
             return c.json({ error: "Failed to decrypt URL. Invalid or corrupted data." }, 400);
        }
        // Handle other potential errors (e.g., from handleM3U8)
        console.error("[Video Route] Failed to process request:", error);
        return c.json({ error: "Failed to process request.", message: error.message || "Unknown error" }, 500);
    }
});

// Export the Hono app instance to be mounted in your main application file (e.g., src/index.ts)
export default video;
