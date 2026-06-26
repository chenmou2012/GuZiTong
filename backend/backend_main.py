import json
import time
import asyncio
import os
import random
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
# 微信小程序的固定 origin 是 https://servicewechat.com，关闭 allow_credentials 避免
# 与 allow_origins=["*"] 组合的浏览器拒绝/服务器全开放问题
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://servicewechat.com"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=False,
)

# 初始化客户端 (智谱 GLM)
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# 创建线程池
executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

# 简单缓存（查词结果缓存）：用 OrderedDict 实现 LRU + TTL
# - 最多 MAX_CACHE_SIZE 项，防止内存无限增长
# - 每项 TTL = CACHE_TTL 秒，过期自动淘汰
from collections import OrderedDict

MAX_CACHE_SIZE = 500
CACHE_TTL = 3600  # 1 小时
cache = OrderedDict()

def get_cache(key: str) -> tuple:
    """获取缓存，返回 (结果, 是否命中)"""
    if key in cache:
        result, timestamp = cache[key]
        if time.time() - timestamp < CACHE_TTL:
            cache.move_to_end(key)  # LRU 更新
            return result, True
        else:
            del cache[key]
    return None, False

def set_cache(key: str, result: str):
    """设置缓存（超出容量时淘汰最旧）"""
    if key in cache:
        cache.move_to_end(key)
    cache[key] = (result, time.time())
    if len(cache) > MAX_CACHE_SIZE:
        cache.popitem(last=False)


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
        # 用 set 替代 list：O(1) 增删改查，并避免 'in' 判断的 O(N) 扫描
        self.active = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.add(ws)

    def disconnect(self, ws):
        # discard 在元素不存在时也不会抛异常，比 remove 更安全
        self.active.discard(ws)

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
    """流式发送一个 chunk（不再逐字符拆分，避免包数暴增和 UI 卡顿）"""
    try:
        await manager.send({'type': 'content', 'content': content}, ws)
    except Exception:
        pass


@app.websocket("/ws/query")
async def ws_query(ws: WebSocket, token: str = None):
    # WebSocket 协议不支持自定义 header，token 必须通过 query string 传递（这是协议限制）
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        await ws.close(code=1008, reason="未授权")
        log_error(f"[WS /ws/query] 拒绝未授权连接")
        return
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

        # 检查缓存
        cached_result, hit = get_cache(word)
        if hit:
            log_info(f"[缓存] 命中: {word}")
            await manager.send({'type': 'start', 'word': word}, ws)
            await send_streaming(ws, cached_result)
            await manager.send({'type': 'done'}, ws)
            return

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
        full_result = ''  # 累积完整结果用于缓存
        try:
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    if first_token:
                        log_info(f"[查词] 首token: {(time.time()-start_time)*1000:.0f}ms")
                        first_token = False
                    full_result += content  # 累积
                    await send_streaming(ws, content)
        except Exception as e:
            log_error(f"[查词] {e}")

        log_success(f"[查词] 完成")
        try:
            # 写入缓存（仅当结果非空）
            if full_result:
                set_cache(word, full_result)
                log_info(f"[缓存] 写入: {word} ({len(full_result)} 字符)")
            await manager.send({'type': 'done'}, ws)
        except Exception:
            pass
    finally:
        manager.disconnect(ws)


@app.websocket("/ws/translate")
async def ws_translate(ws: WebSocket, token: str = None):
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        await ws.close(code=1008, reason="未授权")
        log_error(f"[WS /ws/translate] 拒绝未授权连接")
        return
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


# --- 登录接口 ---
from auth import code2session, create_token, verify_token
from database import (
    create_user, get_user_by_openid, update_user_token, update_user_info,
    save_user_data, get_user_data
)
from fastapi import Header


def _extract_token(authorization: str = None) -> str | None:
    """从 Authorization: Bearer xxx 头提取 token"""
    if not authorization:
        return None
    if authorization.startswith("Bearer "):
        return authorization[7:]
    return authorization


class LoginRequest(BaseModel):
    code: str


class SyncRequest(BaseModel):
    data_type: str
    data_key: str
    data_value: str


@app.post("/api/login")
async def login(req: LoginRequest):
    """微信登录"""
    # 用 code 换 openid
    result = await code2session(req.code)
    if not result["success"]:
        return {"error": result["errmsg"]}

    openid = result["openid"]

    # 检查用户是否存在
    user = get_user_by_openid(openid)
    if user:
        # 已有用户，更新 token
        token_info = create_token(openid)
        update_user_token(openid, token_info["token"], token_info["expire_time"])
    else:
        # 新用户，创建
        token_info = create_token(openid)
        create_user(openid, token_info["token"], token_info["expire_time"])
        # 新用户：生成背诵顺序
        init_learn_order(openid)

    return {
        "openid": openid,
        "token": token_info["token"],
        "expire_days": token_info["expire_days"]
    }


def init_learn_order(openid: str):
    """新用户首次登录时生成背诵顺序"""
    # realwords.json 在项目根目录（backend 的父目录），不再硬编码 /root/backend/
    realwords_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "realwords.json")

    try:
        with open(realwords_path, 'r', encoding='utf-8') as f:
            words_data = json.load(f)

        words = [w['word'] for w in words_data]
        # 随机打乱
        random.shuffle(words)

        # 添加序号和初始复习时间
        order = []
        now = 0  # 初始间隔0
        for i, word in enumerate(words):
            order.append({
                'word': word,
                'order': i + 1,
                'learnedTime': 0,
                'lastReview': 0,
                'reviewCount': 0,
                'nextReview': now
            })

        save_user_data(openid, 'learn', 'learnOrder', json.dumps(order))
        log_info(f"为用户 {openid} 生成了 {len(order)} 个词的背诵顺序")
    except FileNotFoundError:
        log_error(f"realwords.json 不存在: {realwords_path}")
    except Exception as e:
        log_error(f"生成背诵顺序失败: {e}")


@app.get("/api/user")
async def get_user_info(authorization: str = Header(None)):
    """获取用户信息"""
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        return {"error": "无效的 token"}

    user = get_user_by_openid(openid)
    if not user:
        return {"error": "用户不存在"}

    return {
        "openid": user["openid"],
        "nickname": user["nickname"],
        "avatar": user["avatar"],
        "created_at": user["created_at"]
    }


@app.put("/api/user")
async def update_user(
    authorization: str = Header(None),
    nickname: str = None,
    avatar: str = None,
):
    """更新用户信息"""
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        return {"error": "无效的 token"}

    update_user_info(openid, nickname, avatar)
    return {"success": True}


@app.get("/api/user/data")
async def get_user_data_api(authorization: str = Header(None), data_type: str = None):
    """获取用户数据"""
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        return {"error": "无效的 token"}

    data = get_user_data(openid, data_type)
    return {"data": data}


@app.put("/api/user/data")
async def save_user_data_api(
    authorization: str = Header(None),
    data_type: str = None,
    data_key: str = None,
    data_value: str = None,
    req: SyncRequest = None
):
    """保存用户数据"""
    # 兼容两种请求方式：body 或 query
    if req:
        dt = req.data_type
        dk = req.data_key
        dv = req.data_value
    else:
        dt = data_type
        dk = data_key
        dv = data_value

    print(f"[SAVE] data_type={dt}, data_key={dk}")
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        print(f"[SAVE] 无效token")
        return {"error": "无效的 token"}

    # wx.request 会将 data 对象自动 JSON 序列化，所以 dv 此时已是 JSON 字符串
    # 直接存储，不再重复 json.dumps（避免双重序列化）
    save_user_data(openid, dt, dk, dv)
    print(f"[SAVE] 成功: openid={openid}, key={dk}")
    return {"success": True}


# --- 启动 ---
if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)