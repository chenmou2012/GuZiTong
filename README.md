# 古字通

> 面向初中生的文言文学习微信小程序，结合 SM-2 间隔重复算法、AI 查词与翻译、字音跟读，解决文言文词汇记忆与语感难题。

![小程序](https://img.shields.io/badge/平台-微信小程序-1AAD19) ![Python](https://img.shields.io/badge/后端-Python%20FastAPI-009688) ![License](https://img.shields.io/badge/license-Private-lightgrey)

---

## 目录

- [项目简介](#项目简介)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [前端架构](#前端架构)
  - [页面（pages）](#页面pages)
  - [组件（components）](#组件components)
  - [服务模块（utils/services）](#服务模块utilsservices)
  - [数据（utils/data）](#数据utilsdata)
  - [测试脚本（scripts）](#测试脚本scripts)
- [后端架构](#后端架构)
  - [接口（REST + WebSocket）](#接口rest--websocket)
  - [数据库（SQLite）](#数据库sqlite)
  - [RAG 古诗文检索](#rag-古诗文检索)
- [核心算法：SM-2 间隔重复](#核心算法sm-2-间隔重复)
- [数据流与同步](#数据流与同步)
- [启动与运行](#启动与运行)
- [部署](#部署)
- [测试](#测试)
- [已知约束与陷阱](#已知约束与陷阱)
- [后续规划](#后续规划)

---

## 项目简介

**古字通** 是面向初中生的文言文学习工具，覆盖"查词 → 学习 → 翻译 → 复习 → 跟读"全流程。

- 词库：**150 个中考常用文言实词**（含拼音、释义、例句、出处）
- 题型：**句子选择（4 选 1）+ 多选题（"选出 X 所有的意思"）**
- 复习：**SM-2 间隔重复算法**（参考 Anki 实现，按 LEARNING → REVIEW → GRADUATED 三阶段推进）
- 查词 / 翻译：**智谱 GLM** 流式 WebSocket，**RAG 古诗文库**作为上下文增强
- 字音：**150 字正音**，女声 / 男声双版本

部署环境：微信小程序原生开发 + FastAPI 后端 + 宝塔 Nginx（PM2 进程管理）。

---

## 核心特性

| 模块 | 能力 |
|------|------|
| **查词** | 输入单字 → 流式拉取 LLM 解析（读音 + 义项 + 例句 + 避坑提示），支持 Markdown 渲染、收藏、复制 |
| **学习** | 每组 3/5/10 词可调；先"展示"所有意思，再"练习"句子题 + 多选题；自动判分与振动反馈 |
| **翻译** | 整段文言文 → 流式白话翻译 + 注释 + 典故 + 来源（支持 1000 字以内） |
| **复习** | 基于 SM-2 到期字；多选题 + 三档自评混合双轮模式（round 1 答错入 round 2 重做） |
| **字音跟读** | 150 字正音 WAV 播放（女声 / 男声切换），可搜索 |
| **个人中心** | 学习统计饼图（未学 / 复习中 / 已毕业）、连续天数、设置同步、登出 |
| **云同步** | 登录后自动静默同步 wordStates / reviewStats / collections / history / translations / learnList |

---

## 技术栈

### 前端

- **微信小程序** 原生开发（`libVersion: 3.15.1`）
- WXML + WXSS + JavaScript（无 npm、无框架）
- 自定义顶部导航栏（`navigationStyle: "custom"` + `env(safe-area-inset-*)`）
- WebSocket 客户端：`utils/services/websocket.js`（含自动重连，最多 3 次指数退避）

### 后端

- **Python 3 + FastAPI** + uvicorn
- **OpenAI 客户端**（兼容智谱 GLM-4-Flash：`base_url=https://open.bigmodel.cn/api/paas/v4/`）
- **SQLite + WAL**，每线程一个本地连接（`threading.local` + `busy_timeout=5000`）
- **倒排索引 RAG**：启动时一次性建 `{字: 例句列表}` 字典，查询 O(1)
- **rich** 库做彩色日志

### 部署

- **PM2** 守护进程（应用名 `guzi`，端口 8000）
- **宝塔 Nginx** WebSocket 反向代理（关闭缓冲，要点见下文"部署"）

---

## 目录结构

```
古字通/
├── app.js / app.json / app.wxss     # 小程序入口、全局样式、自定义导航
├── project.config.json              # 编译配置（appid=wx7ac0e7ebeed25203）
│
├── pages/                           # 12 个页面
│   ├── index/         # 查词首页（WS 流式）
│   ├── learn/         # 学习主流程（SM-2 驱动）
│   ├── review/        # 复习页（双轮多选 + 三档自评）
│   ├── translate/     # 翻译页（WS 流式）
│   ├── profile/       # 个人中心
│   ├── pronounce/     # 字音跟读
│   ├── realwords/     # 150 实词列表
│   ├── history/       # 查询历史
│   ├── collections/   # 收藏
│   ├── translations/  # 翻译历史
│   ├── done/          # 学完庆祝
│   └── groupdone/     # 单组完成
│
├── components/
│   └── records-list/  # 通用列表组件（被 history/collections/translations 共用）
│
├── utils/
│   ├── services/      # 业务逻辑纯函数 / 服务模块
│   │   ├── sm2.js          # SM-2 间隔重复算法（Anki 风格）
│   │   ├── storage.js      # 本地 Storage + 服务器同步
│   │   ├── auth.js         # 微信登录 / token / 用户资料
│   │   ├── quiz.js         # 出题 / 答题纯函数（多选评分、洗牌）
│   │   ├── realWords.js    # 150 实词完整数据（REAL_WORDS_DATA）
│   │   ├── constants.js    # API_BASE_URL / REAL_WORDS / HIGH_FREQ_REAL_WORDS
│   │   ├── websocket.js    # WS 客户端（含自动重连）
│   │   ├── markdown.js     # 简易 Markdown ↔ HTML 转换
│   │   ├── logger.js       # 统一日志（带 __devLog 开关）
│   │   └── error.js        # showRetryError / showToast
│   ├── data/
│   │   ├── quiz_questions.js    # 150 字 × sentence_meaning + select_meanings 题库
│   │   ├── pronunciationData.js # 150 字 × 多音 × 例句定音数据
│   │   └── audio_manifest.csv   # 音频清单
│   └── fonts/ebGaramond.js       # base64 字体（古诗文展示）
│
├── backend/
│   ├── backend_main.py   # FastAPI 主程序（REST + WS 接口）
│   ├── auth.py           # code2session / token 创建与验证 / 一次性 WS ticket
│   ├── database.py       # SQLite 表 + 白名单 + CRUD
│   ├── ragService.py     # 古诗文倒排索引 + 常见误用反例
│   ├── logger.py         # rich 彩色日志
│   ├── realwords.json    # 150 词表（由 scripts/gen_realwords_json.js 生成）
│   └── config.json       # 微信 secret / GLM API key（**不上传**）
│
├── scripts/
│   ├── test_learn_queue.js     # learn.js 队列逻辑端到端模拟
│   ├── test_review_multi.js    # review.js 多选 + 两轮重做验证
│   ├── test_sm2_batch.js       # SM-2 批量写入不丢字（P0 回归）
│   ├── test_fullsync_merge.js  # fullSync 先拉后推 / 合并回归
│   ├── test_translate_cache.js # 翻译缓存命中后复制/收藏回归
│   ├── gen_realwords_json.js   # 由 realWords.js 生成 backend/realwords.json
│   ├── test_logger.js          # logger 模块测试
│   └── test_privacy_guard.js   # 隐私 API 守卫验证
│
├── DOCUMENTATION.md     # 产品向创作说明文档（与本 README 互补）
├── 古字朗读清单*.md     # 字音数据源文档
└── .eslintrc.js         # ESLint 配置
```

---

## 前端架构

### 页面（pages）

> 顶部状态栏高度由 `app.globalData.statusBarHeight` 提供；所有页面统一用 `<view style="padding-top: {{statusBarHeight}}px">` 占位。

| 路径 | 角色 | 核心交互 |
|------|------|----------|
| `pages/index/index` | **TabBar** · 查词 | 输入字 → `/ws/query` WS 流式 → Markdown 渲染；支持快捷虚词标签、收藏、复制 |
| `pages/learn/learn` | **TabBar** · 学习 | SM-2 驱动；展示环节浏览 → 练习环节答题（句子 + 多选）→ 振动反馈 → 推进 |
| `pages/review/review` | 复习 | 到期字 → 多选 / 三档自评混合 → round 2 重做错题 |
| `pages/translate/translate` | **TabBar** · 翻译 | 整段文言文 → `/ws/translate` WS 流式 → 译文 + 典故 + 注释 |
| `pages/profile/profile` | **TabBar** · 我的 | 用户信息 / 学习统计饼图 / 设置 / 同步 / 登出 |
| `pages/pronounce/pronounce` | 字音跟读 | 150 字 × 双声部 WAV 播放 |
| `pages/realwords/realwords` | 实词列表 | 150 字网格 → 点击跳转查词页 |
| `pages/history/history` | 查询历史 | 复用 `records-list` 组件 |
| `pages/collections/collections` | 收藏 | 复用 `records-list` 组件 |
| `pages/translations/translations` | 翻译历史 | 复用 `records-list` 组件 |
| `pages/done/done` | 学完 | 全部组完成 → 返回首页 |
| `pages/groupdone/groupdone` | 小组完成 | 单组完成 → 下一组 |

**TabBar 配置**：`查词 / 学习 / 翻译 / 我的`（米白底，学术红 `#B91C1C`）。

---

### 组件（components）

#### `components/records-list/`

通用记录列表，被 `history` / `collections` / `translations` 三个页共用。

| Property | 类型 | 默认 | 说明 |
|----------|------|------|------|
| `list` | Array | `[]` | 数据源 |
| `titleField` | String | `'word'` | 列表项主字段 |
| `subtitleField` | String | `'content'` | 副字段 |
| `showTime` | Boolean | `true` | 是否显示时间 |
| `emptyText` | String | `'暂无记录'` | 空态文案 |

事件：`itemtap` / `itemdelete` / `clearall`。

---

### 服务模块（utils/services）

#### `sm2.js` — SM-2 间隔重复算法（核心）

数据结构：

```js
wordStates: {
  [word]: {
    word, ef=2.5, interval=0, repetition=0,
    phase: 'learning' | 'review' | 'graduated',
    nextReviewAt, learnedAt, lastReviewedAt,
    totalReviews, correctCount, wrongCount
  }
}
```

| 常量 | 值 | 说明 |
|------|-----|------|
| `QUALITY.EASY` | 5 | 认识：interval × 1.2 + EF +0.15 |
| `QUALITY.GOOD` | 3 | 模糊：标准 × EF |
| `QUALITY.HARD` | 2 | 不认识：interval 重置 1，EF -0.20 |
| `LEARNING_INTERVALS` | `[1, 3, 6]` | 学习阶段 1→3→6 天 |
| `GRADUATION_INTERVAL` | `30` | interval ≥ 30 天视为毕业 |
| `PHASE` | `learning / review / graduated` | 三阶段 |

**关键 API**：
- `recordReview(word, quality)` — 一次评分入口；内部走**串行写队列**（P1-9）防止网络请求乱序
- `markWordLearned(word)` — 初始化 + stats.todayLearn++（幂等）
- `getWordsToReview(now, meaningsByWord)` — 返回 `{ word, state, meanings }[]`，按 phase → nextReviewAt 升序
- `migrateLegacyData()` — 启动时一次性迁移老 `learnedWords`（幂等 flag: `sm2_migration_done`）
- `restoreFromServer()` — 从云端拉 `wordStates` + `reviewStats` 恢复
- `getEbbinghausStats()` — 给 profile 页饼图用的统计数据

**learn.js 推断 quality 的策略**（`inferQuality(isCorrect, consecutiveCorrect)`）：
- 答错 → HARD
- 首次答对（consecutiveCorrect === 0）→ GOOD
- 连对 → EASY

#### `quiz.js` — 出题纯函数

无状态、不依赖 `wx.*`，便于测试。

| 函数 | 作用 |
|------|------|
| `shuffleArray(arr)` | Fisher-Yates 洗牌（in-place） |
| `toggleMultiOption(selected, idx)` | 切换多选选中（纯函数） |
| `gradeMultiAnswer(correct, selected)` | 多选评分（顺序无关、长度必须相等） |
| `getMultiSelectQuestion(word, QUIZ_DATA)` | 从题库拿 select_meanings 题，打乱选项 |
| `getOrGenerateMultiSelectQuestion(word, QUIZ_DATA, wordMeanings, distractorPool)` | **题库找不到时自动生成**：所有正确选项 + 3 个随机干扰项（解决"只有一个意思的词语没选择题"问题） |
| `loadFont()` | 模块级单例，加载 EB Garamond 字体 |

#### `storage.js` — 本地 + 云同步

```js
// 数据键
SEARCH_HISTORY / COLLECTIONS / TRANSLATIONS / PENDING_QUERY / PENDING_TRANSLATION / LEARN_LIST
```

- `fullSync()`：登录态下后台推本地 + 拉云端 + 合并 collections（按 `time` 字段去重）
- `mergeCollectionsByTime(local, cloud)`：相同 word 取 `time` 大的
- `syncLearnList(words)`：本地无则从服务端拉（首登生成背诵顺序）
- `getGroupSize() / setGroupSize(size)`：3 / 5 / 10（默认 5）

#### `auth.js` — 微信登录

| API | 说明 |
|-----|------|
| `login()` | `wx.login` 拿 code → `/api/login` → 写 token + openid |
| `checkLogin()` / `getToken()` / `getOpenid()` | 登录态查询 |
| `fetchUserInfo()` | `GET /api/user` 拉资料 |
| `updateUserInfo(nickname, avatar)` | `PUT /api/user`（**用 body 不用 query**，头像 URL 可达数百字符） |
| `getUserData(dataType)` / `saveUserData(type, key, value)` | K-V 数据读写 |
| `fetchWsTicket()` | **P0-3 安全优化**：换取一次性 WS ticket（30s），让 token 永远不出现于 URL/Nginx 日志 |
| `logout()` | 服务端撤销 token（写黑名单） + 本地清缓存 |

默认昵称生成：`文言学者 + 4位 hex(openid)`，哈希冲突概率低。

#### `constants.js`

```js
API_BASE_URL = 'https://share.sng-oj.cn'
REAL_WORDS: 459 个常用文言实词（搜索候选）
HIGH_FREQ_REAL_WORDS: ['学','习','道','德','仁','义','师','友','知']
```

#### `websocket.js`

- `connect(endpoint, handlers)` 入口；自动重连最多 3 次（指数退避 `BASE_DELAY × 2^(n-1)`）
- `send(data)` / `close()` / `isConnected()`
- `onClose` 触发 `scheduleReconnect`；`manualClosed = true` 时不重连

#### `markdown.js`

- `markdownToHtml(md)`：极简转换（标题 / 加粗 / 列表 / `<br>`）
- `parseMarkdown(md)`：把 LLM 返回的 Markdown 解析为 `{ pinyin, meanings: [{pos, meaning, example, source}] }`

#### `logger.js`

模块级单例 + tag 过滤；可通过 `wx.setStorageSync('__devLog', false)` 关闭 debug 输出。

#### `error.js`

- `showRetryError(message, retryFn, title)`：把"一闪而过"的 toast 升级为可重试的 modal
- `showToast(message, icon)`：轻量提示

---

### 数据（utils/data）

#### `quiz_questions.js`

150 字 × 两种题型：

```js
{
  word: '比',
  type: 'sentence_meaning',          // 句子选择（4 选 1）
  sentence: '其两膝相比者…',
  source: '核舟记',
  options: [{ text: '...', correct: true|false }]   // 4 个
}

{
  word: '比',
  type: 'select_meanings',           // 多选题（"选出 X 所有的意思"）
  options: [{ text: '...', correct: true|false }]   // N 个（多 true + 少 false）
}
```

**队列构造（learn.js `buildQuizQueue`）**：
1. 取出该字的所有 `sentence_meaning` 打乱
2. 调 `getOrGenerateMultiSelectQuestion` 拿或生成多选题（保证每个字至少有 1 道多选）
3. 拼成 `[...singles, multi]`

**答错处理**：把当前字的题库整体重打乱，`quizIndex = 0`，`consecutiveCorrect = 0`。

#### `pronunciationData.js`

150 字 × 多音 × 例句定音数据（自动生成，请勿手改）。字段：`id / word / mi / pinyin / meaning / example / source / note`。

---

### 测试脚本（scripts）

```bash
# 端到端模拟 learn.js 队列逻辑（mock Page state）
node scripts/test_learn_queue.js

# 端到端模拟 review.js 多选 + 双轮重做
node scripts/test_review_multi.js

# SM-2 同 tick 批量写入不丢字（P0 回归）
node scripts/test_sm2_batch.js

# fullSync 先拉后推 / 多端合并（数据不丢回归）
node scripts/test_fullsync_merge.js

# 翻译命中缓存后复制/收藏可用（回归）
node scripts/test_translate_cache.js

# 流式渲染节流工具（chunk 合并 / flushNow / reset）
node scripts/test_stream_throttle.js

# logger 模块测试
node scripts/test_logger.js

# 隐私守卫：未登录不发任何网络请求
node scripts/test_privacy_guard.js
```

改动词库后需重新生成后端词表：

```bash
node scripts/gen_realwords_json.js
```

---

## 后端架构

### 接口（REST + WebSocket）

#### REST

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET` | `/health` | 无 | 健康检查 |
| `POST` | `/api/login` | 无 | code2session → 返回 token + openid（30 天有效） |
| `GET` | `/api/user` | Bearer | 取用户资料 |
| `PUT` | `/api/user` | Bearer | 更新 nickname/avatar（**body 不用 query**） |
| `GET` | `/api/user/data?data_type=...` | Bearer | 拉用户 K-V 数据 |
| `PUT` | `/api/user/data` | Bearer | 写用户 K-V 数据 |
| `POST` | `/api/logout` | Bearer | 撤销 token（写黑名单） |
| `POST` | `/api/ws-ticket` | Bearer | 换一次性 WS ticket（30s） |

#### WebSocket

| 路径 | 鉴权 | 说明 |
|------|------|------|
| `ws://.../ws/query` | ticket（推荐）/ token（兼容） | 查词：接 `{text}` → RAG 检索 → LLM 流式 → `start / content / done` |
| `ws://.../ws/translate` | ticket（推荐）/ token（兼容） | 翻译：接 `{text}` → 直接 LLM 流式 |

**P0-3 安全优化**：URL 里只放 ticket（30s 一次性消费），token 永远不进 Nginx 日志。

**流式核心**（`call_ai_stream_async`）：
- 后台线程拉 LLM chunks → `loop.call_soon_threadsafe` → `asyncio.Queue`
- 主 event loop `async for` 边收边发，producer 不阻塞

---

### 数据库（SQLite）

表结构：

```sql
users (openid PK, token UNIQUE, expire_time, nickname, avatar, created_at, updated_at)

user_data (id PK, openid, data_type, data_key, data_value, updated_at,
           UNIQUE(openid, data_type, data_key))

revoked_tokens (token PK, openid, revoked_at)
```

**白名单**（`ALLOWED_DATA_TYPES / ALLOWED_DATA_KEYS`）：
- `data_type`: `learn / settings / progress`
- `data_key`: `collections / history / translations / learnedWords / wordStates / reviewStats / learnOrder / preferences / theme`

> ⚠️ 新增字段时必须**显式加入** `ALLOWED_DATA_KEYS`，否则 `save_user_data` 返回 False。

**性能优化**：
- 每线程本地连接（`threading.local`），长连接不关
- WAL 模式 + `synchronous=NORMAL` + `busy_timeout=5000`
- `cache_size=-20000`（约 20MB 页缓存）
- `data_value` 大小限 1MB

---

### RAG 古诗文检索

启动时一次性建倒排索引：

```js
_index: { 字: [(line, title, author, type), ...] }   // O(1) 查找
```

- 拆句规则：`re.split(r"[，。？！；、\n\r]", content)`
- 同一字在同一例句只记一次（避免重复占桶）
- 查询时按 `type`（诗 / 词 / 曲 / 文言文）分桶，桶间轮转采样（保证类型覆盖）
- **常见误用反例**：`common_misuses.json`（`query_misuses` 返回 Markdown 避坑提示）

---

## 核心算法：SM-2 间隔重复

```
init: ef=2.5, interval=0, repetition=0, phase=learning

review(word, quality):
  if quality == HARD (2):
    ef -= 0.20 (下限 1.3)
    interval = 1
    repetition = 0
  else:
    repetition += 1
    if repetition <= 3:
      interval = [1, 3, 6][repetition - 1]      // 学习阶段
    else:
      interval = round(prev_interval * ef)     // 复习阶段
    if quality == EASY (5):
      interval = round(interval * 1.2)
      ef += 0.15

  phase = (interval >= 30) ? GRADUATED : (repetition < 3 ? LEARNING : REVIEW)
  nextReviewAt = now + interval * 1day
```

**P1-9 串行写队列**：连续 recordReview 时本地写 + 服务端同步必须严格按顺序，否则后发请求可能先到服务端导致 last-write-wins 误判。

---

## 数据流与同步

```
┌────────────────────────────────────────────────────────┐
│  小程序本地 (wx.storage)                                │
│  ├─ wordStates, reviewStats   ← SM-2 核心数据          │
│  ├─ collections, history, translations                 │
│  └─ learnList (随机排列 150 字)                         │
└────────────────────────────────────────────────────────┘
              ↑↓ fullSync() 后台静默
┌────────────────────────────────────────────────────────┐
│  FastAPI 后端 (SQLite, WAL)                            │
│  └─ user_data 表（K-V + 白名单 + 1MB 上限）             │
└────────────────────────────────────────────────────────┘
```

**启动流程**（`app.onLaunch`）：
1. `sm2.migrateLegacyData()` 一次性迁移老数据
2. `_silentLogin()` 静默 `wx.login` → 换 token（失败仅 warn）
3. `_autoSync()` 登录态下后台 `fullSync()`（推 + 拉 + 合并）

**API 守卫**：
- 所有 `auth.saveUserData / getUserData / fetchWsTicket` 都检查 `checkLogin()`
- 未登录时静默跳过

---

## 启动与运行

### 前端

1. 用**微信开发者工具**打开项目根目录
2. AppID 已配置：`wx7ac0e7ebeed25203`
3. 编译即可在模拟器中预览

> ⚠️ 必须在开发者工具中**关闭**「不校验合法域名」（开发期）；生产环境需要在微信公众平台后台配置 `share.sng-oj.cn` 为合法 request / uploadFile / downloadFile / websocket 域名。

### 后端

```bash
cd backend
pip install fastapi uvicorn openai httpx rich

# 准备 config.json（不要上传到 git）
cat > config.json <<EOF
{
  "wechat": { "appid": "...", "secret": "..." },
  "api":    { "key": "zhipu-glm-key", "base_url": "https://open.bigmodel.cn/api/paas/v4/", "model": "glm-4-flash" },
  "server": { "host": "0.0.0.0", "port": 8000 },
  "service":{ "max_workers": 20, "max_tokens": 2048, "max_query_length": 10, "translate_max_length": 1000, "ws_rate_limit_per_minute": 30, "login_rate_limit_per_minute": 60, "ws_receive_timeout_seconds": 60 },
  "rag":    { "poems_file": "poems.json", "limit": 10, "max_line_length": 20 }
}
EOF

# 启动
python backend_main.py
# 或 PM2 守护：
# pm2 start backend_main.py --name guzi --interpreter python
```

健康检查：`curl http://localhost:8000/health` → `{"status":"ok",...}`。

---

## 部署

服务器：宝塔 + Nginx + PM2（应用名 `guzi`）

```bash
# SSH 到服务器
ssh root@<server>

# 上传代码（不要上传 config.json）
scp -r backend/* <server>:/www/wwwroot/wyw/backend/

# 修复权限
chown -R www:www /www/wwwroot/wyw/backend/

# 清理 __pycache__
cd /www/wwwroot/wyw/backend && find . -type d -name __pycache__ -exec rm -rf {} +

# 重启
pm2 restart guzi
pm2 logs guzi
```

**WebSocket 反代要点**（手工配置到站点 Nginx 配置中）：
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

---

## 测试

```bash
# 前端纯逻辑测试（mock wx + Page state），全部脚本逐一运行：
node scripts/test_learn_queue.js     # 队列 + inferQuality
node scripts/test_review_multi.js    # 多选 + 双轮 + 三档
node scripts/test_review_integration.js  # review.js 真实页面集成
node scripts/test_sm2_batch.js       # SM-2 批量写入不丢字（P0 回归）
node scripts/test_fullsync_merge.js  # 同步先拉后推 / 多端合并
node scripts/test_translate_cache.js # 翻译缓存命中后复制/收藏
node scripts/test_stream_throttle.js # 流式渲染节流工具
node scripts/test_privacy_guard.js   # 未登录不发网络请求
node scripts/test_logger.js
```

测试覆盖：
- ✅ 队列打乱 / 答错重置 / 单意思字也能生成多选题
- ✅ 多选评分（顺序无关、长度必须相等）
- ✅ SM-2 quality 推断（错 → HARD，首对 → GOOD，连对 → EASY）
- ✅ 双轮映射（round 1 错 → round 2 重做；round 2 对 → GOOD，错 → HARD）
- ✅ 自评模式（不知道 → 翻面 → 下一词）
- ✅ SM-2 同 tick 批量 markWordLearned / recordReview 不丢字
- ✅ fullSync 先拉后推：新设备不覆盖云端、离线新数据不被旧云端覆盖
- ✅ 翻译缓存命中后复制/收藏可用
- ✅ 隐私守卫（未登录时静默跳过，不发任何网络请求）

---

## 已知约束与陷阱

### 微信小程序

- **`requiredPrivateInfos` 只接受 8 个地理位置类 API**。`chooseAvatar` 不能写进去，否则开发工具会报 `requiredPrivateInfos[0] field needs to be <8 location APIs`。`chooseAvatar` 的声明应在小程序管理后台 → 设置 → 用户隐私保护指引里配置。
- **`__usePrivacyCheck__: true`** 必须在 `app.json` 中显式开启。
- 隐私敏感 API（`wx.login` / `wx.cloud.callFunction` / `wx.getUserProfile`）在用户未同意隐私政策时直接报 `errno:4 backgroundfetch privacy fail`。所有云函数调用都必须先用 `auth.checkLogin()` 守卫。
- `getUserProfile` 已被官方弃用但仍可用；新方案推荐 `<button open-type="chooseAvatar">` + `<input type="nickname">`。
- `saveUserData.data_value` 后端用 `Any`（不要 `str`）：前端 `wx.request` 把 body JSON 序列化后，`data_value` 是原生 list/dict，不是字符串。
- openid 验证：`re.match(r'^o[a-zA-Z0-9_-]{20,30}$', openid)`，必须以 `o` 开头。

### 数据库

- 新增 user_data 字段必须**显式加入** `ALLOWED_DATA_KEYS`。
- 双重 JSON 序列化兼容：`get_user_data` 自动检测并二次 `json.loads`。

### SM-2

- `recordReview` 内部串行写队列（P1-9）防止快速答题导致云端乱序。
- EF 不封顶上限（用户选 EASY 是真实信号）。
- `migrateLegacyData` 用 `sm2_migration_done` flag 幂等。

### Bash on Windows

- 使用 `/dev/null` 不是 `NUL`，用前向斜杠路径。
- `node` 可直接跑前端逻辑测试（mock wx/storage）。

---

## 后续规划

- [ ] 虚词、实词用法辨析
- [ ] 中考真题练习
- [ ] 听写 / 填空等更多题型
- [ ] 错题本 + AI 智能分析
- [ ] 学习排行榜 + 成就系统
- [ ] 微信群分享学习进度
- [ ] PC 端网页版

---

**作者**：古字通开发团队
**最后更新**：2026 年 6 月
