// 用 jsdom 真正把站点跑起来：加载 index.html、执行所有脚本、断言语义正确
//
// 这是"静态自检"之外的第二层：能抓出运行时报错（TypeError、未定义函数、KaTeX 初始化失败）。
//
// 用法: node test_site.mjs [站点URL]
import { JSDOM, VirtualConsole } from "jsdom";

const URL_BASE = process.argv[2] || "http://127.0.0.1:8642/";
const problems = [];
const notes = [];

const vc = new VirtualConsole();
vc.on("jsdomError", (e) => problems.push("jsdomError: " + (e && e.message ? e.message : e)));
vc.on("error", (...a) => problems.push("console.error: " + a.join(" ")));

const dom = await JSDOM.fromURL(URL_BASE, {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

await new Promise((res) => {
  if (window.document.readyState === "complete") res();
  else window.addEventListener("load", res);
});
// 等 MutationObserver 的 requestAnimationFrame 走完一轮公式渲染
await new Promise((r) => setTimeout(r, 800));

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => [...window.document.querySelectorAll(sel)];

// 1. 题库下拉
const opts = $$("#bankSelect option");
notes.push(`题库下拉 ${opts.length} 项`);
if (opts.length !== 13) problems.push(`题库下拉应为 13 项，实际 ${opts.length}`);

// 2. 当前题渲染
const stem = $(".q-stem");
if (!stem || !stem.textContent.trim()) problems.push("题干没有渲染出来");
else notes.push(`当前题干: ${stem.textContent.trim().slice(0, 40)}…`);

// 3. KaTeX 真的渲染了（第一题是「测得简谐振子初始时刻的位移为 A/2」，选项带 \frac{\pi}{3}）
const katexCount = $$(".katex").length;
notes.push(`KaTeX 渲染节点 ${katexCount} 个`);
if (katexCount === 0) problems.push("页面上没有 KaTeX 渲染结果（公式没渲染出来）");

// 4. 没有残留的裸 $...$（说明 auto-render 覆盖到了）
const rawMath = $$(".q-stem, .opt-text").map((el) => el.textContent).join(" ").match(/\$[^$]{2,}\$/g);
if (rawMath) problems.push(`还有未渲染的 $...$: ${rawMath.slice(0, 3).join(" ")}`);

// 5. AI 默认锁定
const lock = $("#aiLockState");
if (!lock) problems.push("找不到 #aiLockState");
else {
  notes.push(`AI 状态: ${lock.textContent}`);
  if (lock.textContent !== "未解锁") problems.push(`未输密码时 AI 应为「未解锁」，实际「${lock.textContent}」`);
}

// 6. 章节筛选：切到「物理实验」应只剩 5 个测验
window.setChapter("exp");
await new Promise((r) => setTimeout(r, 100));
const expOpts = $$("#bankSelect option").length;
notes.push(`切到「物理实验」后题库 ${expOpts} 项`);
if (expOpts !== 5) problems.push(`物理实验应有 5 个测验，实际 ${expOpts}`);

// 7. 切回全部 + 跳到最后一章最后一题，确认 160 题都能翻到
window.setChapter("all");
await new Promise((r) => setTimeout(r, 100));
const totalQ = $$("#bankSelect option").length;
notes.push(`全部章节题库 ${totalQ} 项`);

// 8. 密码解锁（jsdom 自身没有 crypto.subtle，这里把 Node 的 WebCrypto 注进去，
//    这样测的就是页面里真实的 aiUnlock → PBKDF2 → AES-GCM 解密那条路）
import { webcrypto } from "node:crypto";
let hasSubtle = !!(window.crypto && window.crypto.subtle);
if (!hasSubtle) {
  try {
    Object.defineProperty(window, "crypto", { value: webcrypto, configurable: true });
    hasSubtle = !!(window.crypto && window.crypto.subtle);
  } catch (e) {
    notes.push("注入 WebCrypto 失败: " + e.message);
  }
}
notes.push(`WebCrypto 可用: ${hasSubtle}`);

if (hasSubtle) {
  // 8a. 错误密码必须解不开
  await window.aiUnlock("definitely-wrong", true);
  let st = $("#aiLockState").textContent;
  notes.push(`错误密码后状态: ${st}`);
  if (st !== "未解锁") problems.push("错误密码竟然解锁了 AI！");

  // 8b. 正确密码（当前 ai-config.js 是测试密文，密码 physics2026）应解锁
  const okRight = await window.aiUnlock("physics2026", true);
  st = $("#aiLockState").textContent;
  notes.push(`正确密码后状态: ${st}（aiUnlock 返回 ${okRight}）`);
  if (!okRight || st !== "已解锁") problems.push("正确密码没能解锁 AI");

  // 8c. 锁定按钮要能关回去
  window.aiLock();
  st = $("#aiLockState").textContent;
  notes.push(`点锁定后状态: ${st}`);
  if (st !== "未解锁") problems.push("锁定后状态没回到未解锁");
} else {
  notes.push("跳过解锁测试（无法注入 WebCrypto）");
}

// 9. 真打一次 DeepSeek：用密文里的假 Key 必须被打回 401，并且页面给出「Key 已失效」的提示
//    （验证 endpoint / 请求头 / SSE 接线的正确性，不需要真 Key）
//    注意：app.js 里的 aiState 是 const 绑定，不在 window 上，只能通过 aiUnlock 走真实路径拿 Key。
try {
  // jsdom 的 AbortSignal 与 Node fetch 不是同一个类，Node 会拒绝外来的 signal。
  // 真实浏览器里没这问题（同一个 realm），测试时把 signal 去掉即可。
  Object.defineProperty(window, "fetch", {
    configurable: true,
    value: (url, init = {}) => {
      const { signal, ...rest } = init;
      return fetch(url, rest);
    },
  });
  await window.aiUnlock("physics2026", true);       // 解出 ai-config.js 里的假 Key
  await window.aiSend("只回复两个字：收到");
  const bubbles = $$(".ai-msg.ai .ai-bubble");
  const last = bubbles.length ? bubbles[bubbles.length - 1].textContent : "";
  notes.push(`DeepSeek 返回处理: ${last.replace(/\s+/g, " ").slice(0, 90)}`);
  if (!/401|Key 已失效/.test(last)) problems.push("假 Key 没有被打回 401，或错误提示没显示出来");
} catch (e) {
  problems.push("调用 DeepSeek 抛异常: " + e.message);
}
window.aiLock();

// 10. 本地图片引用能取到（抽第一张）
const img = $(".qimg");
if (img) notes.push(`配图示例: ${img.getAttribute("src")}`);

// 11. 全量遍历：13 个测验逐题渲染一遍，确认每题都能出题干（数据里有坏字符/坏 HTML 会在这里炸）
window.setChapter("all");
await new Promise((r) => setTimeout(r, 100));
let rendered = 0, empty = 0, threw = 0, imgOnly = 0;
for (const opt of $$("#bankSelect option")) {
  $("#bankSelect").value = opt.value;
  window.onBankChange();
  const m = opt.textContent.match(/（(\d+)题）/);
  const n = m ? parseInt(m[1], 10) : 0;
  for (let i = 0; i < n; i++) {
    try {
      window.renderQuestion();
      const st = $(".q-stem");
      const hasText = !!(st && st.textContent.trim());
      const hasImg = !!(st && st.querySelector("img"));
      if (!hasText && hasImg) imgOnly++;
      // 纯图片题干是合法的（原题就是一张图），只有"既没文字也没图"才算渲染失败
      else if (!hasText) empty++;
    } catch (e) {
      threw++;
      if (threw <= 3) notes.push(`渲染异常 @ ${opt.textContent.slice(0, 20)} 第${i + 1}题: ${e.message}`);
    }
    rendered++;
    window.goNext();
  }
}
notes.push(`全量遍历渲染 ${rendered} 题（纯图片题干 ${imgOnly}，空题干 ${empty}，抛异常 ${threw}）`);
if (rendered !== 160) problems.push(`应遍历 160 题，实际 ${rendered}`);
if (empty) problems.push(`有 ${empty} 道题既无文字也无图片`);
if (threw) problems.push(`有 ${threw} 道题渲染抛异常`);

// 12. 交互回归：答题判分 / 错题本 / 收藏 / 乱序 / 错题模式
//     注意 restartCurrent() 是弹确认框后才会重置，必须点确认
window.switchMode("single");
window.setChapter("all");
$("#bankSelect").value = "0";
window.onBankChange();
window.restartCurrent();
$("#modalConfirmBtn").click();
await new Promise((r) => setTimeout(r, 150));

const bankName = $(".q-bankname") ? $(".q-bankname").textContent.trim() : "";
const curQ = JSON.parse(window.eval(
  "JSON.stringify({k: QUIZ_BANKS[0].questions[0].k, a: QUIZ_BANKS[0].questions[0].a, t: QUIZ_BANKS[0].questions[0].t})"));
notes.push(`当前题库: ${bankName} / 首题 ${curQ.k}(${curQ.t}) 标准答案 ${curQ.a}`);
if (!/2\.10/.test(bankName)) problems.push(`没有回到 2.10 测验，实际「${bankName}」`);
const shownStem = $(".q-stem") ? $(".q-stem").textContent.slice(0, 16) : "";
if (!shownStem.startsWith("测得简谐振子")) problems.push(`首题不对，显示的是「${shownStem}」`);

const firstK = curQ.k;
const wrongPick = curQ.a === "A" ? "B" : "A";   // 故意选错
window.onOptClick(firstK, wrongPick);
await new Promise((r) => setTimeout(r, 120));

const fb = $(".feedback");
const fbText = fb ? fb.textContent : "";
notes.push(`答错后反馈: ${fbText.replace(/\s+/g, " ").slice(0, 50)}`);
if (!/✗|错/.test(fbText)) problems.push("答错后没有出现判错反馈");

const wrongCnt = parseInt($("#statWrongCount").textContent, 10);
const totalCnt = parseInt($("#statTotal").textContent, 10);
notes.push(`统计: 答题总数 ${totalCnt}，错题本 ${wrongCnt}`);
if (!(totalCnt >= 1)) problems.push("答题总数没有增加");
if (!(wrongCnt >= 1)) problems.push("答错的题没有进错题本");

// 收藏
window.toggleFav(firstK);
await new Promise((r) => setTimeout(r, 60));
const favBtn = $(".q-fav");
notes.push(`收藏按钮状态: ${favBtn ? favBtn.className : "(无)"}`);
if (!favBtn || !favBtn.classList.contains("on")) problems.push("收藏后按钮没有变成已收藏");

// 乱序模式（全部 160 题）
window.switchMode("all");
await new Promise((r) => setTimeout(r, 100));
const progress = $("#navProgress").textContent.replace(/\s+/g, " ");
notes.push(`乱序模式进度: ${progress}`);
if (!/\/ 160/.test(progress)) problems.push(`乱序模式题数不对: ${progress}`);

// 错题模式应能定位到刚答错的那题
window.switchMode("wrong");
await new Promise((r) => setTimeout(r, 100));
const wrongStem = $(".q-stem") ? $(".q-stem").textContent.slice(0, 24) : "";
notes.push(`错题模式首题: ${wrongStem}`);
if (!wrongStem) problems.push("错题模式里没有题");

// 收藏夹模式
window.switchMode("fav");
await new Promise((r) => setTimeout(r, 100));
const favProg = $("#navProgress").textContent.replace(/\s+/g, " ");
notes.push(`收藏夹进度: ${favProg}`);
if (!/^1 \//.test(favProg)) problems.push(`收藏夹应有 1 题，实际 ${favProg}`);

console.log("── 浏览器级自检（jsdom）──");
notes.forEach((n) => console.log("  · " + n));
if (problems.length) {
  console.log(`\n[FAIL] ${problems.length} 个问题:`);
  problems.forEach((p) => console.log("  - " + p));
  process.exit(1);
}
console.log("\n[OK] 页面加载无报错，公式渲染正常，AI 默认锁定，章节筛选正确");
dom.window.close();
