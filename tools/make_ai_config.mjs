// 生成 js/ai-config.js：把 DeepSeek API Key 用「使用密码」加密成密文
//
// 为什么用 Node 而不是 Python：浏览器解锁走的是 WebCrypto（crypto.subtle），
// Node 从 16 起内置同一套 API，所以这里加密、那边解密是**同一份实现**，
// 不会出现「PBKDF2 迭代数/salt/iv/GCM tag 拼接方式」对不上的问题。
//
// 算法：PBKDF2-HMAC-SHA256（默认 200000 次）→ AES-256-GCM
//
// 用法:
//   node tools\make_ai_config.mjs --key sk-xxxx --password 你的使用密码
//   set DEEPSEEK_KEY=sk-xxxx && node tools\make_ai_config.mjs        （走环境变量，不进命令历史）
//   node tools\make_ai_config.mjs --iterations 300000 --key ... --password ...
//
// 换 Key / 换密码：重跑，覆盖 js/ai-config.js，推仓库。
import { writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";

const OUT = new URL("../js/ai-config.js", import.meta.url);

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const apiKey = (argOf("key", process.env.DEEPSEEK_KEY || "")).trim();
const password = (argOf("password", process.env.AI_PASSWORD || "")).trim();
const iterations = parseInt(argOf("iterations", "200000"), 10);

if (!apiKey) {
  console.error("缺少 Key：用 --key sk-xxx，或先 set DEEPSEEK_KEY=sk-xxx");
  process.exit(1);
}
if (!password) {
  console.error("缺少使用密码：用 --password xxx，或先 set AI_PASSWORD=xxx");
  process.exit(1);
}
if (password.length < 8) {
  console.warn("!! 密码少于 8 位，密文可能被离线爆破，建议 10 位以上");
}
if (!apiKey.startsWith("sk-")) {
  console.warn("!! DeepSeek Key 通常以 sk- 开头，确认复制完整了");
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));

const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
const dk = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
  base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, dk, enc.encode(apiKey));

const b64 = (bytes) => Buffer.from(bytes).toString("base64");

const now = new Date().toISOString().slice(0, 19).replace("T", " ");
const text = `// AI 配置：DeepSeek API Key 的密文（AES-GCM + PBKDF2）—— 由 tools/make_ai_config.mjs 生成
// 生成时间：${now}
// 本文件不含任何明文 Key；必须输入正确的「使用密码」才能在本机解出 Key。
// 换 Key / 换密码：重跑 node tools\\make_ai_config.mjs --key ... --password ...
window.AI_CONFIG = {
  salt: "${b64(salt)}",
  iv: "${b64(iv)}",
  ciphertext: "${b64(ct)}",
  iterations: ${iterations}
};
`;

await writeFile(OUT, text, "utf8");
console.log(`已写入 js/ai-config.js`);
console.log(`  PBKDF2-SHA256 x${iterations} -> AES-256-GCM`);
console.log(`  Key 长度 ${apiKey.length}，密码长度 ${password.length}`);
console.log(`  提醒：密文不含明文 Key，但密码泄露 = Key 泄露。`);
