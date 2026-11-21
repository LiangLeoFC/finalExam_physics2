// 验证 js/ai-config.js 的密文能被「使用密码」正确解出，且解出的就是原 Key
//
// 目的：前端是 WebCrypto，后端生成用的是 Python 的 cryptography，
// 两边参数（PBKDF2-SHA256 迭代次数 / salt / iv / AES-256-GCM）必须完全一致。
// 这个脚本用 Node 的 WebCrypto 走一遍前端逻辑，等价于在浏览器里解锁。
//
// 用法: node tools\test_ai_config.mjs [密码]
import { readFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";

const pwd = process.argv[2] || "physics2026";

const code = await readFile(new URL("../js/ai-config.js", import.meta.url), "utf8");
globalThis.window = globalThis;
new Function(code)();

const cfg = globalThis.AI_CONFIG;
if (!cfg) {
  console.log("AI_CONFIG 为 null（还没生成配置），跳过");
  process.exit(0);
}

const b64ToBytes = (b64) => {
  const s = atob(b64);
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
};

const base = await crypto.subtle.importKey(
  "raw", new TextEncoder().encode(pwd), "PBKDF2", false, ["deriveKey"]);
const dk = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt: b64ToBytes(cfg.salt), iterations: cfg.iterations, hash: "SHA-256" },
  base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);

try {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(cfg.iv) }, dk, b64ToBytes(cfg.ciphertext));
  const key = new TextDecoder().decode(plain);
  console.log(`[OK] 密码 "${pwd}" 解出: ${key.slice(0, 6)}…${key.slice(-4)} (长度 ${key.length})`);
  console.log(`     迭代 ${cfg.iterations} 次`);
} catch (e) {
  console.log(`[FAIL] 密码 "${pwd}" 解不开: ${e.message}`);
  process.exit(1);
}
