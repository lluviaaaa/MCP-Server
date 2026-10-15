// Prints one random 48-character token. Use it for ADMIN_TOKEN / CODER_TOKEN / REVIEWER_TOKEN.
import crypto from "node:crypto";
console.log(crypto.randomBytes(24).toString("hex"));
