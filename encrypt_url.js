import crypto from "crypto";

const IV_SIZE = 16; // 16 bytes for AES-128/192/256

// --- PASTE YOUR 32-BYTE AES SECRET KEY HERE ---

const keyString = "crohvzxjqybvzdxlvygesvhvehgfawtm"; // Replace with your actual key
// ---------------------------------------------

const urlToEncrypt = "https://frostbite27.pro/_v7/71f87b4028d27b3ba749bd2029f3248245618a740ca81a9a9863f257784436f85c939482f4d306945639b935dc612f232173cae4f207297dea8798f69741cdadcf03986938ae645355b02ac49101bd99d26dbcacac3e6ab00b678324a21474728d09a70cb4b5086fbc36943efb9f1695c522b23382b639d8f473c8ce9a528151/master.m3u8&ref=https://megacloud.club/";

function encrypt(plainText, keyString) {
    if (Buffer.from(keyString).length !== 32) {
        throw new Error("AES key must be 32 bytes (256 bits).");
    }
    const iv = crypto.randomBytes(IV_SIZE);
    const cipher = crypto.createCipheriv("aes-256-cbc", Buffer.from(keyString), iv);
    let cipherText = cipher.update(Buffer.from(plainText, "utf8"));
    cipherText = Buffer.concat([cipherText, cipher.final()]);
    const combinedData = Buffer.concat([iv, cipherText]);
    const combinedString = combinedData.toString("base64");
    // Make it URL-safe
    return encodeURIComponent(combinedString);
}

try {
    const encrypted = encrypt(urlToEncrypt, keyString);
    console.log("Encrypted URL Parameter:\n");
    console.log(encrypted);
} catch (error) {
    console.error("Encryption failed:", error);
} 