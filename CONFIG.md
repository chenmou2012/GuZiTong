# 古字通项目配置指南

## 项目概述

古字通是一个帮助初中生学习文言文的微信小程序，包含查词、学习、翻译、朗读四大功能。

## 核心逻辑

### 1. 查词功能
- 用户输入文言文字词
- 后端查询本地词库（realwords.json）+ RAG 检索古诗文库
- 返回释义、例句、出处

### 2. 学习功能
- 150 个初中必学文言实词
- 艾宾浩斯遗忘曲线复习（1、2、4、7、15、30 天）
- 组式学习（每组 3/5/10 词可选）
- 两种练习模式：
  - 句子选择（选择加粗字的意思）
  - 多选题（选择正确释义）

### 3. 翻译功能
- 用户输入文言文句子
- 后端调用智谱 GLM API 进行翻译
- WebSocket 流式返回结果

### 4. 朗读功能
- 150 个古字标准发音
- TTS 语音播放

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

服务器部署在 `/root/backend/` 目录：

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
3. 上传 cloudfunctions/

### 4. 域名配置

在微信公众平台配置：
- request 合法域名：`https://你的域名`
- WebSocket 合法域名：`wss://你的域名`

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