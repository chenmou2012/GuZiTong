import json
import time
import asyncio
import os
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
import uvicorn
from concurrent.futures import ThreadPoolExecutor
from rich.console import Console
from rich.theme import Theme
from rich.logging import RichHandler

from ragService import rag

# ==================== 初始化 Rich 控制台 ====================
custom_theme = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "red bold",
    "time": "dim",
})
console = Console(theme=custom_theme)

def log_time():
    return time.strftime('%H:%M:%S')

def log_info(msg):
    console.log(f"[time]{log_time()}[/time] [info]{msg}[/info]")

def log_success(msg):
    console.log(f"[time]{log_time()}[/time] [success]{msg}[/success]")

def log_error(msg):
    console.log(f"[time]{log_time()}[/time] [error]{msg}[/error]")

# ==================== 加载配置 ====================
_config_path = os.path.join(os.path.dirname(__file__), "config.json")
with open(_config_path, "r", encoding="utf-8") as f:
    _config = json.load(f)

API_KEY = os.getenv("API_KEY", _config["api"]["key"])
BASE_URL = _config["api"]["base_url"]
MODEL = _config["api"]["model"]
HOST = _config["server"]["host"]
PORT = _config["server"]["port"]
MAX_WORKERS = _config["service"]["max_workers"]
MAX_TOKENS = _config["service"]["max_tokens"]
MAX_QUERY_LENGTH = _config["service"]["max_query_length"]

# 初始化 FastAPI
app = FastAPI(title="古字通 API")

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# 初始化客户端 (智谱 GLM)
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# 创建线程池
executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)


# --- 辅助函数 ---
def sync_create_chat_stream(model: str, messages: list, max_tokens: int):
    """在线程池中同步调用 AI"""
    return client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        stream=True
    )


async def call_ai_stream_async(model: str, messages: list, max_tokens: int):
    """异步调用 AI"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        executor,
        sync_create_chat_stream,
        model, messages, max_tokens
    )


# --- 数据模型 ---
class QueryRequest(BaseModel):
    text: str
    context: str = ""


# --- WebSocket 管理器 ---
class ConnectionManager:
    def __init__(self):
        self.active = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws):
        if ws in self.active:
            self.active.remove(ws)

    async def send(self, msg: dict, ws: WebSocket):
        await ws.send_json(msg)


manager = ConnectionManager()


# --- System Prompts ---
QUERY_SYSTEM_PROMPT = """你是一位专业的文言文教育专家，专门帮助初中生学习文言文。

当用户查询一个文言文字词时，请用 Markdown 格式返回该字的所有常见义项，包含以下内容：

## 读音
用汉语拼音标注正确读音（如果是多音字，全部列出）

## 义项
列出该字的所有常见义项，每个义项包含：
- 词性：名词/动词/形容词/副词/介词/连词/助词/叹词等
- 含义：用现代汉语解释含义，要准确、简洁、适合初中生理解
- 例句：从下方提供的古诗文例句中选取一个适合的

格式示例：
1. **【词性】含义**
   - 例句：xxxx

2. **【词性】含义**
   - 例句：xxxx

**核心要求**：
1. 例句必须从下方的古诗文句子里选取，必须包含查询的这个字！
2. 以下是古诗文数据库中包含该字的例句，直接选用，不需要自己编造：
{rag_examples}

注意：
1. 优先使用上面提供的例句，每个���项都要用对应的例句
2. 如果提供的例句不够，再考虑其他经典例句，但必须包含该字
3. 如果是多音字，在读音部分列出所有读音
4. 义项按常见程度排序
5. 释义要准确、简洁、适合初中生理解
6. 返回纯 Markdown 内容，不要有额外解释"""

TRANSLATE_SYSTEM_PROMPT = """你是一位专业的文言文翻译专家，专门帮助初中生学习文言文翻译。

当用户输入一段文言文时，请用 Markdown 格式返回翻译结果，按句子分块输出，每块包含：

**译文**
用现代汉语翻译该句子

**典故**
该句子涉及的典故来源或历史背景

**注释**
对句子中的重点字词进行解释，多个词用逗号分隔

**来源**
该句子出自的古文名称或诗词名称

注意：
1. 译文要准确、流畅、适合初中生理解
2. 典故部分要简明扼要
3. 注释要简洁
4. 每句单独一块，依次输出所有句子
5. 返回纯 Markdown 内容，不要有额外解释"""


# --- 接口 ---
@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "server": "active"}


async def send_streaming(ws: WebSocket, content: str):
    """流式发送内容"""
    for char in content:
        try:
            await manager.send({'type': 'content', 'content': char}, ws)
            await asyncio.sleep(0)
        except Exception:
            break


@app.websocket("/ws/query")
async def ws_query(ws: WebSocket):
    await manager.connect(ws)
    try:
        data = await ws.receive_text()
        request = json.loads(data)
        word = request.get('text', request.get('word', ''))

        if not word:
            await manager.send({'error': '请输入字词'}, ws)
            return

        if len(word) > MAX_QUERY_LENGTH:
            await manager.send({'error': f'请选择 1-{MAX_QUERY_LENGTH} 个字进行查询'}, ws)
            return

        start_time = time.time()

        # RAG 检索例句
        rag_examples = rag.query(word)
        log_info(f"[RAG] '{word}': {len(rag_examples)} 条")

        # 构建 prompt
        prompt = QUERY_SYSTEM_PROMPT.replace("{rag_examples}", rag_examples)
        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": f"请解析以下字词：{word}"}
        ]

        # 调用 AI
        await manager.send({'type': 'start', 'word': word}, ws)
        stream = await call_ai_stream_async(MODEL, messages, MAX_TOKENS)

        first_token = True
        try:
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    if first_token:
                        log_info(f"[查词] 首token: {(time.time()-start_time)*1000:.0f}ms")
                        first_token = False
                    await send_streaming(ws, chunk.choices[0].delta.content)
        except Exception as e:
            log_error(f"[查词] {e}")

        log_success(f"[查词] 完成")
        try:
            await manager.send({'type': 'done'}, ws)
        except Exception:
            pass
    finally:
        manager.disconnect(ws)


@app.websocket("/ws/translate")
async def ws_translate(ws: WebSocket):
    await manager.connect(ws)
    try:
        data = await ws.receive_text()
        text = json.loads(data).get('text', '')

        if not text:
            await manager.send({'error': '请输入内容'}, ws)
            return

        start_time = time.time()
        messages = [
            {"role": "system", "content": TRANSLATE_SYSTEM_PROMPT},
            {"role": "user", "content": f"请翻译：{text}"}
        ]

        await manager.send({'type': 'start', 'original': text}, ws)
        stream = await call_ai_stream_async(MODEL, messages, MAX_TOKENS)

        first_token = True
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                if first_token:
                    log_info(f"[翻译] 首token: {(time.time()-start_time)*1000:.0f}ms")
                    first_token = False
                await send_streaming(ws, chunk.choices[0].delta.content)

        log_success(f"[翻译] 完成")
        try:
            await manager.send({'type': 'done'}, ws)
        except Exception:
            pass
    except Exception as e:
        log_error(f"[翻译] {e}")
    finally:
        manager.disconnect(ws)


# --- 启动 ---
if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)