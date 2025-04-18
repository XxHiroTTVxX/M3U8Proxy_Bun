import crypto from "crypto";
import process from "process";

const IV_SIZE = 16; // 16 bytes for AES-128/192/256

// --- Configuration ---
// PASTE YOUR 32-BYTE AES SECRET KEY HERE (must be exactly 32 bytes)
const keyString = "crohvzxjqybvzdxlvygesvhvehgfawtm";
// PASTE THE MAIN URL YOU WANT TO ENCRYPT HERE
const mainUrlToEncrypt = "https://frostbite27.pro/_v7/71f87b4028d27b3ba749bd2029f3248245618a740ca81a9a9863f257784436f85c939482f4d306945639b935dc612f232173cae4f207297dea8798f69741cdadcf03986938ae645355b02ac49101bd99d26dbcacac3e6ab00b678324a21474728d09a70cb4b5086fbc36943efb9f1695c522b23382b639d8f473c8ce9a528151/master.m3u8";

// PASTE THE REFERRER URL YOU WANT TO ENCRYPT HERE (leave empty "" if not needed)
const refUrlToEncrypt = "https://megacloud.club/";
// ---------------------

/**
 * Encrypts plain text using AES-256-CBC.
 * The IV is prepended to the ciphertext, and the result is base64 encoded, then URL encoded.
 * @param plainText The text to encrypt.
 * @param keyString A 32-byte (256-bit) key.
 * @returns URL-encoded base64 string containing IV + ciphertext.
 * @throws Error if the key is not 32 bytes.
 */
function encrypt(plainText: string, keyString: string): string {
    if (!plainText) {
        return ""; // Return empty if input is empty
    }
    const keyBuffer = Buffer.from(keyString);
    if (keyBuffer.length !== 32) {
        throw new Error(`AES key must be 32 bytes (256 bits). Provided key is ${keyBuffer.length} bytes.`);
    }

    const iv = crypto.randomBytes(IV_SIZE);
    const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);

    let cipherText = cipher.update(Buffer.from(plainText, "utf8"));
    cipherText = Buffer.concat([cipherText, cipher.final()]);

    const combinedData = Buffer.concat([iv, cipherText]);
    const combinedBase64 = combinedData.toString("base64");

    // Make it URL-safe
    return encodeURIComponent(combinedBase64);
}

// --- Main Execution ---
try {
    // Encrypt Main URL
    if (!mainUrlToEncrypt) {
        console.warn("Main URL (mainUrlToEncrypt) is empty. Skipping encryption.");
    } else {
        console.log(`Encrypting Main URL: ${mainUrlToEncrypt}`);
        const encryptedMainUrl = encrypt(mainUrlToEncrypt, keyString);
        console.log("\nEncrypted Main URL Parameter (for path):\n");
        console.log(encryptedMainUrl);
    }


    // Encrypt Referrer URL (if provided)
    if (!refUrlToEncrypt) {
        console.log("\nReferrer URL (refUrlToEncrypt) is empty. No referrer parameter needed.");
    } else {
         console.log(`\nEncrypting Referrer URL: ${refUrlToEncrypt}`);
         const encryptedRefUrl = encrypt(refUrlToEncrypt, keyString);
         console.log("\nEncrypted Referrer URL Parameter (for ?encRef=...):\n");
         console.log(encryptedRefUrl);
    }

} catch (error: any) {
    console.error("\nEncryption failed:");
    console.error(error.message);
    process.exit(1); // Exit with error code
}
// --- End --- 