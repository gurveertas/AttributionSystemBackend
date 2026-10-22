import crypto from "crypto";
import ENV from "./env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Derive a 32-byte key from JWT_SECRET or fallback
const MASTER_KEY = crypto.createHash("sha256").update(ENV.JWT_SECRET || "default_signing_master_key_32_bytes!").digest();

/**
 * Encrypt a plaintext string or buffer using AES-256-GCM.
 * Output Buffer format: [IV (12 bytes)][AuthTag (16 bytes)][Ciphertext]
 */
export function encryptSecret(plaintext) {
    if (!plaintext) return Buffer.alloc(0);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    const textBuffer = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf-8");
    const encrypted = Buffer.concat([cipher.update(textBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypt a buffer encrypted with encryptSecret.
 * Gracefully falls back to plain UTF-8 if the buffer was stored in plaintext.
 */
export function decryptSecret(encryptedBuffer) {
    if (!encryptedBuffer) return "";
    const buf = Buffer.isBuffer(encryptedBuffer) ? encryptedBuffer : Buffer.from(encryptedBuffer);

    // If buffer is too short to contain IV + Tag, it was stored as plaintext
    if (buf.length < IV_LENGTH + TAG_LENGTH) {
        return buf.toString("utf-8");
    }

    try {
        const iv = buf.subarray(0, IV_LENGTH);
        const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
        const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

        const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return decrypted.toString("utf-8");
    } catch {
        // Fallback to plain UTF-8 string for legacy stored secrets
        return buf.toString("utf-8");
    }
}
