# 古字通

一款帮助初中生学习文言文的微信小程序。

## 功能

| 页面 | 功能 |
|------|------|
| 查词 | 查询文言文字词的含义和例句 |
| 学习 | 初中 150 个文言实词练习 |
| 翻译 | 文言文翻译成现代汉语 |
| 朗读 | 古字正确发音示范 |
| 我的 | 收藏夹、学习统计与云端同步 |

## 核心逻辑

### 1. 查词功能
- 用户输入文言文字词
- 后端查询本地词库 + RAG 检索古诗文库
- 返回释义、例句、出处

### 2. 学习功能
- 150 个初中必学文言实词
- 艾宾浩斯遗忘曲线复习（1、2、4、7、15、30 天）
- 组式学习（每组 3/5/10 词可选）
- 两种练习模式：句子选择 + 多选题

### 3. 翻译功能
- 用户输入文言文句子
- 后端调用智谱 GLM API 进行翻译
- WebSocket 流式返回结果

### 4. 朗读功能
- 150 个古字标准发音
- TTS 语音播放

## 技术栈

### 前端
- 微信小程序原生开发
- WebSocket 流式交互

### 后端
- Python FastAPI
- WebSocket
- 智谱 GLM 大模型
- RAG 本地文本检索

## 项目结构

```
├── pages/
│   ├── index/        # 查词页面
│   ├── learn/       # 学习页面
│   ├── translate/   # 翻译页面
│   ├── pronounce/  # 朗读页面
│   ├── profile/    # 我的页面
│   ├── done/       # 学习完成页面
│   ├── groupdone/   # 组完成页面
│   └── review/     # 复习页面
├── backend/
│   ├── backend_main.py  # FastAPI 主服务
│   └── ragService.py   # RAG 检索服务
├── utils/
│   ├── data/          # 数据文件
│   └── services/      # 业务服务
├── data/
│   └── realwords.js   # 150个文言实词数据
├── assets/icons/     # 图标资源
└── app.*             # 小程序入口文件
```

## 配置步骤

### 1. 微信小程序配置

在 `backend/config.json` 中配置：

```json
{
  "wechat": {
    "appid": "你的AppID",
    "secret": "你的AppSecret"
  },
  "zhipu": {
    "api_key": "你的智谱API Key"
  }
}
```

> 注意：AppID 和 Secret 必须在微信公众平台开通登录权限

### 2. 后端服务器配置

```bash
# 启动后端服务
cd /root/backend
python backend_main.py

# 或使用 systemd 服务
sudo systemctl start backend
```

### 3. 云开发配置（如需使用云端存储）

在微信开发者工具中：
1. 开通云开发
2. 创建云数据库

### 4. 域名配置

在微信公众平台配置：
- request 合法域名：`https://你的域名`
- WebSocket 合法域名：`wss://你的域名`

## 运行

### 1. 安装依赖

```bash
pip install -r backend/requirements.txt
```

### 2. 启动后端

```bash
cd backend
python backend_main.py
```

服务默认运行在 http://localhost:8000

### 3. 微信开发者工具

用微信开发者工具打开项目目录，选择测试 AppID 或你个人的 AppID 即可预览。

## 数据文件

| 文件 | 说明 |
|------|------|
| `data/realwords.js` | 150 个文言实词数据 |
| `backend/poems.json` | 古诗文知识库 |
| `backend/config.json` | 配置文件 |

## 状态管理

学习状态存储：
- `learnProgress` - 当前学习进度
- `learnedWords` - 已学会的词
- `reviewStats` - 复习统计数据

## 常见问题

### Q: 登录失败 invalid appsecret
A: 检查 `backend/config.json` 中的 appid 和 secret 是否正确

### Q: 学习数据不同步
A: 确认已登录，检查服务器 API 是否正常运行

### Q: 翻译请求失败
A: 检查智谱 API Key 是否有效

## License

MIT