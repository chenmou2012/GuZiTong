# 古字通

一款帮助初中生学习文言文的微信小程序。

## 功能

| 页面 | 功能 |
|------|------|
| 查词 | 查询文言文字词的含义和例句 |
| 学习 | 中考必备 330 个文言实词练习 |
| 翻译 | 文言文翻译成现代汉语 |
| 朗读 | 古字正确发音示范 |
| 我的 | 收藏夹、学习记录与云端同步 |

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
│   ├── index/       # 查词页面
│   ├── learn/       # 学习页面
│   ├── translate/   # 翻译页面
│   ├── pronounce/  # 朗读页面
│   └── profile/    # 我的页面
├── backend/
│   ├── backend_main.py  # FastAPI 主服务
│   ├── ragService.py    # RAG 检索服务
│   └── poems.json      # 古诗文知识库
├── utils/
│   ├── data/          # 数据文件
│   ├── services/      # 业务服务
│   └── fonts/         # 字体文件
├── assets/icons/     # 图标资源
└── app.*             # 小程序入口文件
```

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

## License

MIT