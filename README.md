# 大学物理(Ⅱ) 刷题站

从学习通《大学物理(Ⅱ)》抓下来的 13 个测验 / 160 题（官方答案齐全），做成可刷题的静态站。
移植自电工学站，公式改用 **KaTeX** 本地渲染，AI 助教换成 **DeepSeek + 使用密码解锁**。

## 本地预览

```powershell
py -m http.server 8642 --bind 127.0.0.1 --directory .
# 浏览器打开 http://127.0.0.1:8642/
```

**别用双击 file:// 打开**：AI 解锁依赖 `crypto.subtle`，它只在 https 或 localhost 下可用。
刷题功能在 file:// 下正常，只是 AI 用不了。

## 目录

```
finalExam_physics2/
├─ index.html
├─ css/style.css                 站点样式
├─ css/vendor/katex.min.css      KaTeX（本地化，不依赖 CDN）
├─ css/vendor/fonts/*.woff2      公式字体 20 个
├─ js/app.js                     交互逻辑（刷题 + AI）
├─ js/data.js                    题库数据（由 tools/build_data_js.py 生成，别手改）
├─ js/ai-config.js               DeepSeek Key 的密文（不含明文）
├─ js/vendor/katex.min.js        KaTeX
├─ js/vendor/auto-render.min.js  自动识别 $...$ / $$...$$
├─ img/                          题目配图 33 张（公式小图已转成文本，这里是图/装置图）
└─ tools/
   ├─ build_data_js.py           题库 JSON → js/data.js
   ├─ fetch_katex.py             下载并裁剪 KaTeX 到 vendor/
   ├─ make_ai_config.mjs         用密码把 Key 加密成 js/ai-config.js
   ├─ test_ai_config.mjs         验证密文能否用密码解出（Node 的 WebCrypto）
   └─ check_site.mjs             静态自检：资源/id/数据/AI 配置
```

## AI 是怎么做的（重点）

| 环节 | 做法 |
| --- | --- |
| Key 存放 | **不存明文**。用「使用密码」经 PBKDF2-SHA256（20 万次）派生密钥，AES-256-GCM 加密后只把 `salt/iv/ciphertext` 写进 `js/ai-config.js` |
| 解锁 | 用户点 ⚙ 输入使用密码 → 浏览器派生 → 解密 → Key 只在内存 + 本标签页 sessionStorage |
| 不输密码 | 刷题、判分、错题本、收藏、统计全部正常，AI 面板显示 🔒 |
| 请求 | 浏览器直连 `https://api.deepseek.com/chat/completions`（已实测支持 CORS，不需要后端代理） |
| 错误区分 | 401=内置 Key 失效，402=余额不足，429=限流，Failed to fetch=网络/跨域 |
| 限流 | 本地 6 次/分钟、150 次/天，防朋友手滑刷爆额度 |
| 上下文 | 送「当前题目 + 官方答案 + **官方解析**」+ 题库检索（检索范围含解析正文），
让模型优先依据老师的解析回答，而不是自己重推 |

### 生成 / 更换密文

```powershell
node tools\make_ai_config.mjs --key sk-你的DeepSeekKey --password 你的使用密码
node tools\test_ai_config.mjs 你的使用密码      # 验证能解出，应该打印 [OK]
```

换 Key 或换密码就重跑这两条，覆盖 `js/ai-config.js` 后推仓库。

> 安全边界：不知道密码拿不到 Key；但密码一旦分享出去就等于 Key 分享出去。
> 建议密码 10 位以上；给朋友用的站，定期换 Key 或换密码。

## 部署到 GitHub Pages

1. 新建仓库（如 `finalExam_physics2`），把本目录全部内容推上去（`tools/` 可推可留）。
2. 仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。
3. 等 1 分钟左右，访问 `https://<用户名>.github.io/finalExam_physics2/`。
4. GitHub Pages 默认 https，`crypto.subtle` 可用，AI 解锁正常。

## 自检（三层，都可重复跑）

```powershell
# 第 1 层：静态检查（资源引用 / id 对齐 / 数据字段 / AI 配置结构）
node tools\check_site.mjs

# 第 2 层：浏览器级（真加载页面、执行 JS、断言公式渲染与章节筛选）
#   需要先装一次 jsdom：
#   npm install jsdom --registry https://registry.npmmirror.com --prefix .
node tools\test_site.mjs http://127.0.0.1:8642/

# 第 3 层：密码学（密文能否被密码解出）
node tools\test_ai_config.mjs 你的使用密码
```

`test_site.mjs` 覆盖：13 个测验下拉、当前题渲染、KaTeX 真的产出 `.katex` 节点、
无残留裸 `$...$`、AI 默认锁定、错误密码解不开、正确密码能解锁、锁定能回退、
**假 SSE 流验证流式解析 + 回复里的 `$...$` 被渲染**、真打 DeepSeek 假 Key 被打回 401、
**160 题逐题遍历渲染**、以及**答题判分 / 错题本 / 收藏夹 / 乱序 / 错题模式** 五个交互回归。

实测结果（2026-11-22）：

```
题库下拉 13 项            当前题干渲染正常            KaTeX 节点 5 个（首题）
AI 状态: 未解锁           错误密码 -> 未解锁          正确密码 -> 已解锁 -> 锁定 -> 未解锁
DeepSeek 假 Key -> HTTP 401（错误提示正确显示）
全量遍历渲染 160 题（纯图片题干 0，空题干 0，抛异常 0）
流式回复（假 SSE）: 文本正确拼接，气泡内 KaTeX 1 个（AI 输出的 $T=2\pi\sqrt{m/k}$ 被渲染）
首题 2.10#1(single) 标准答案 D；答错反馈「正确答案：D」
统计: 答题总数 1，错题本 12（预置 11 + 本次答错 1）
收藏按钮 -> on        乱序 1 / 160        收藏夹 1 / 1        错题模式有题
```

## 题库文字化程度

**160 题的题干、选项、解析全部是文字 + LaTeX，没有一张图片依赖**：

- 10 道原本是纯图片题干（9.3 偏振光、11.3 光电效应）已读图转写 → `chaoxing_phys/data/stem_text_fix.json`
- 4 道题的解析里是老师 PPT 的公式截图（3.10#9/#10/#13/#15）已转成 LaTeX
  → `chaoxing_phys/data/analysis_text_fix.json`
- `img/` 目录仍保留 33 张原始图作归档，但页面已不再引用（`data.js` 里 `img/` 出现 0 次）

所以 DeepSeek 这个纯文本模型现在能读到**完整题面**，不存在"看不到图"的题。


## 已知限制

- **题干已全部是文字**：9.3 偏振光 5 道、11.3 光电效应 5 道原本是纯图片题干，已读图转写；
  现在 160 题题干均为文字，AI 能读到完整题面。
- 只有 **4 道题的「解析」里还带图**（`3.10#9/#10/#13/#15` 的干涉示意图）。AI 看不到这些图，
  但题干文字完整，讲题不受影响；你本人在页面上能正常看到。
- DeepSeek 无视觉能力，问它「解析里的图长什么样」会得到「看不到」的诚实回答。
- 题库里「光学」整章在原课程里**没有测验节点**，所以题只是实验部分的偏振光/光栅。
- `js/ai-config.js` 当前是**测试密文**（假 Key），AI 会返回 401；换成真 Key 后才可用。

## 免责

题库与图片版权归课程及教材作者所有，仅供个人复习。
