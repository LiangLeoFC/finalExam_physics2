// 站点静态自检：不打浏览器也能抓出「一打开就报错」的常见毛病
//
// 检查项：
//   1. index.html 里引用的 js/css/img 文件是否都存在
//   2. app.js 里 getElementById("x") 用的 id 是否都在 index.html 里（少一个就 TypeError 白屏）
//   3. app.js 里 onclick="fn(" 形式调用的函数是否在 app.js 里定义
//   4. data.js 是否能被解析、题目字段是否齐全（k/t/s/a）
//   5. ai-config.js 是否存在、AI_CONFIG 结构是否完整
//
// 用法: node tools\check_site.mjs
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

const html = await readFile(join(ROOT, "index.html"), "utf8");
const app = await readFile(join(ROOT, "js/app.js"), "utf8");

// 1. 资源引用
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:|data:|#|javascript:)/.test(ref)) continue;
  try { await access(join(ROOT, ref)); }
  catch { problems.push(`index.html 引用的文件不存在: ${ref}`); }
}

// 2. id 一致性（app.js 自己也会用模板串动态生成节点，这类 id 一并算作"存在"）
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const appIds = new Set([...app.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const usedIds = new Set([...app.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]));
for (const id of usedIds) {
  if (!htmlIds.has(id) && !appIds.has(id))
    problems.push(`app.js 用了 getElementById("${id}")，但页面里（含动态模板）没有这个 id`);
}

// 3. 行内 onclick 调用的函数
const called = new Set([...html.matchAll(/on(?:click|change)="([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]));
for (const fn of called) {
  const defined =
    new RegExp(`function\\s+${fn}\\s*\\(`).test(app) ||
    new RegExp(`(?:const|let|var)\\s+${fn}\\s*=`).test(app);
  if (!defined) problems.push(`index.html 里 onclick 调了 ${fn}()，但 app.js 没有定义`);
}

// 4. 数据（data.js 用的是 const QUIZ_BANKS，在 new Function 里是局部绑定，这里改成挂到 globalThis）
const dataCode = await readFile(join(ROOT, "js/data.js"), "utf8");
globalThis.window = globalThis;
new Function(dataCode.replace(/^const\s+QUIZ_BANKS\s*=/m, "globalThis.QUIZ_BANKS ="))();
const banks = globalThis.QUIZ_BANKS;
if (!Array.isArray(banks) || !banks.length) problems.push("data.js 里 QUIZ_BANKS 为空");
else {
  let n = 0;
  for (const b of banks) {
    for (const f of ["id", "section", "name", "chapter"]) {
      if (!b[f]) problems.push(`题库 ${b.section || b.id} 缺字段 ${f}`);
    }
    for (const q of b.questions) {
      n++;
      for (const f of ["k", "t", "s"]) if (q[f] == null) problems.push(`${q.k || "?"} 缺字段 ${f}`);
      if (q.a == null) problems.push(`${q.k} 没有答案`);
      if (!["single", "multiple", "judge", "fill"].includes(q.t)) problems.push(`${q.k} 题型异常 ${q.t}`);
      if (q.t === "single" && (!q.o || Object.keys(q.o).length < 2)) problems.push(`${q.k} 单选选项不足`);
    }
  }
  notes.push(`数据: ${banks.length} 个测验 / ${n} 题`);
  const mathCount = banks.reduce((s, b) => s + b.questions.filter((q) => /\$[^$]+\$/.test(q.s + JSON.stringify(q.o || ""))).length, 0);
  notes.push(`含 $LaTeX$ 的题: ${mathCount} 道`);
  const imgCount = banks.reduce((s, b) => s + b.questions.filter((q) => /!\[\]\(img\//.test(q.s + JSON.stringify(q.o || {}) + (q.an || ""))).length, 0);
  notes.push(`含本地配图的题: ${imgCount} 道`);
}

// 5. AI 配置
try {
  const cfgCode = await readFile(join(ROOT, "js/ai-config.js"), "utf8");
  new Function(cfgCode)();
  const cfg = globalThis.AI_CONFIG;
  if (!cfg) notes.push("AI_CONFIG 为 null（未配置 Key，AI 面板会保持锁定）");
  else for (const f of ["salt", "iv", "ciphertext", "iterations"]) {
    if (!cfg[f]) problems.push(`ai-config.js 缺字段 ${f}`);
  }
  if (cfg) notes.push(`AI 配置: PBKDF2 x${cfg.iterations}，密文 ${cfg.ciphertext.length} 字符`);
} catch (e) {
  problems.push(`ai-config.js 读取失败: ${e.message}`);
}

console.log("── 自检 ──");
notes.forEach((n) => console.log("  · " + n));
if (problems.length) {
  console.log(`\n[FAIL] ${problems.length} 个问题:`);
  problems.slice(0, 40).forEach((p) => console.log("  - " + p));
  if (problems.length > 40) console.log(`  ... 共 ${problems.length} 条`);
  process.exit(1);
}
console.log("\n[OK] 静态自检通过：资源齐全、id 对齐、数据字段完整");
