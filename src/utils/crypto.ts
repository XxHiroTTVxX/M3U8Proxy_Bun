import crypto from "crypto";

const IV_SIZE = 16; // 16 bytes for AES-128/192/256

export class AES {
    /**
     * Encrypts plain text using AES-256-CBC.
     * The IV is prepended to the ciphertext, and the result is base64 encoded, then URL encoded.
     * @param plainText The text to encrypt.
     * @param keyString A 32-byte (256-bit) key.
     * @returns URL-encoded base64 string containing IV + ciphertext.
     */
    static Encrypt(plainText: string, keyString: string): string {
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

    /**
     * Decrypts a URL-encoded base64 string (IV + ciphertext) using AES-256-CBC.
     * @param combinedString URL-encoded base64 string containing IV + ciphertext.
     * @param keyString A 32-byte (256-bit) key.
     * @returns The original plain text.
     */
    static Decrypt(combinedString: string, keyString: string): string {
         if (Buffer.from(keyString).length !== 32) {
            throw new Error("AES key must be 32 bytes (256 bits).");
        }
        // Decode URL encoding first
        const combinedData = Buffer.from(decodeURIComponent(combinedString), "base64");

        if (combinedData.length < IV_SIZE) {
            throw new Error("Invalid encrypted data: too short to contain IV.");
        }

        const iv = Buffer.alloc(IV_SIZE);
        const cipherText = Buffer.alloc(combinedData.length - IV_SIZE);

        combinedData.copy(iv, 0, 0, IV_SIZE);
        combinedData.copy(cipherText, 0, IV_SIZE);

        const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(keyString), iv);
        let plainText = decipher.update(cipherText);
        plainText = Buffer.concat([plainText, decipher.final()]);
        return plainText.toString("utf8");
    }
} 