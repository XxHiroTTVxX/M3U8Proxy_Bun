import { AES } from "./src/utils/AES";

// URL to encrypt
const url = "https://lightningspark77.pro/_v7/71f87b4028d27b3ba749bd2029f3248245618a740ca81a9a9863f257784436f85c939482f4d306945639b935dc612f232173cae4f207297dea8798f69741cdadcf03986938ae645355b02ac49101bd99d26dbcacac3e6ab00b678324a21474728d09a70cb4b5086fbc36943efb9f1695c522b23382b639d8f473c8ce9a528151/master.m3u8";

// Referer to use
const referer = "https://megacloud.club/";

// Create the data object
const dataToEncrypt = JSON.stringify({
  url: url,
  referer: referer
});

// Using the exact same secret key as in .env - MUST match for it to work
const secretKey = "crohvzxjqybvzdxlvygesvhvehgfawtm";

console.log("Secret key length:", secretKey.length);
console.log("Data to encrypt:", dataToEncrypt);

// Encrypt the data
const encryptedData = AES.Encrypt(dataToEncrypt, secretKey);

// Base URL of your server
const serverUrl = "http://localhost:3001"; // Change this to your actual server URL

console.log("Test URL to try in your browser:");
console.log(`${serverUrl}/video/${encryptedData}`);

// Try a simple test string to verify encryption/decryption is working properly
const testString = "This is a test string";
const encryptedTest = AES.Encrypt(testString, secretKey);
const decryptedTest = AES.Decrypt(encryptedTest, secretKey);
console.log("\nSimple encryption test:");
console.log("Original:", testString);
console.log("Encrypted:", encryptedTest);
console.log("Decrypted:", decryptedTest);
console.log("Test passed:", testString === decryptedTest);

// Verify by decrypting the main data
console.log("\nVerification - Decrypted data:");
const decryptedData = AES.Decrypt(encryptedData, secretKey);
console.log(decryptedData); 