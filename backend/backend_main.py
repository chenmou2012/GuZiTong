import json
import time
import asyncio
import os
import random
from fastapi import FastAPI, WebSocket, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
from openai import OpenAI
import uvicorn
from concurrent.futures import ThreadPoolExecutor

from logger import log_info, log_success, log_warning, log_debug, log_error, DEBUG_ENABLED

from ragService import rag
from auth import (
    code2session, create_token, verify_token,
    create_ws_ticket, consume_ws_ticket,
    revoke_user_token,
)
from database import (
    create_user, get_user_by_openid, update_user_token, update_user_info,
    save_user_data, get_user_data,
)

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

# --- 辅助函数 ---
# P1-6: 删除未使用的 sync_create_chat_stream 函数（已被 call_ai_stream_async 替代）

async def call_ai_stream_async(model: str, messages: list, max_tokens: int, temperature: float = None):
    """异步流式调用 AI：在后台线程拉 chunks，主 event loop 边收边发（不阻塞）"""
    loop = asyncio.get_event_loop()
    queue = asyncio.Queue()

    def _producer():
        """后台线程：从智谱拉取每个 chunk 并 put 到 queue"""
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": True,
            }
            if temperature is not None:
                kwargs["temperature"] = temperature
            stream = client.chat.completions.create(**kwargs)
            for c in stream:
                if c.choices and c.choices[0].delta.content:
                    # 跨线程安全地把内容放进 asyncio.Queue
                    loop.call_soon_threadsafe(queue.put_nowait, c.choices[0].delta.content)
            loop.call_soon_threadsafe(queue.put_nowait, None)  # 哨兵
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, e)

    # 在 executor 中启动 producer（不 await！让 producer 在后台跑）
    loop.run_in_executor(executor, _producer)

    # 主 event loop 异步消费 queue
    while True:
        item = await queue.get()
        if item is None:
            return  # 收集完毕
        if isinstance(item, Exception):
            raise item
        yield item


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
**只输出拼音本身，不要重复字**（如查"道"输出 `dào`，不要输出"道dào"）。
如果是多音字，用 ` / ` 分隔全部读音（如 `dào / dǎo`）。
**不确定的读音请标注"读音待考"，不要猜测。**

## 义项
列出该字的所有常见义项，每个义项**必须包含以下 4 个字段**（缺一不可）：
- **词性**：名词/动词/形容词/副词/介词/连词/助词/叹词等
- **释义**：用现代汉语给出核心含义，要准确、简洁、适合初中生理解（1-2 个字即可，如「道路」「道理」「说」）
- **解释**：**必填**，对释义的补充说明（**25 字以内**），简洁点出关键用法即可：
  - 1 句话点明语法功能或核心用法
  - 可附近反义词对比
- **例句**：从下方提供的古诗文例句中选取，必须标注出处（如《论语·学而》）

**绝对不允许省略「解释」字段**——这是用户最看重的学习内容。即使只有一个义项，也要包含完整的「释义 + 解释 + 例句」。

格式示例（严格遵循）：
1. **【名词】道路**
   - 解释：指供人、车马通行的路。在文言文中常引申为人生道路、思想路线、方法规律等抽象含义。近义：路；反义：阻。
   - 例句：古道西风瘦马。（《天净沙·秋思》马致远）

2. **【名词】道理**
   - 解释：指事物的规律、原则或正确的做法。常用于抽象哲理表达，如「得道多助」。近义：理、义；反义：悖。
   - 例句：得道者多助，失道者寡助。（《孟子·公孙丑下》）

**核心要求（按优先级递减，不确定就舍弃而非编造）**：
1. **例句必须从下方提供的古诗文例句中选取**，必须包含查询的这个字！如果下方例句不足以覆盖某义项，**宁可少列义项，也不要自行编造例句**。
2. **每个义项必须标注出处**（书名·篇名），无出处的例句一律不收。
3. **读音不确定就标"读音待考"**，绝不猜测。
4. **多音字必须列全所有读音**，不要只列最常用的。
5. 释义要准确、简洁、适合初中生理解；解释要简短（≤25 字），不冗长。
6. **如对某个义项存在疑虑，宁可不列，也不要补全**。
7. **若有「常见误用避坑」段**，仅作内部参考（避免采纳错误理解），**不要在输出中显式标出"⚠️ 易误为"等避坑提示**。

以下是古诗文数据库中包含该字的例句（含「常见误用避坑」段，如有），直接选用，不需要自己编造：
{rag_examples}

注意：
1. 严格使用上面提供的例句，每个义项都要用对应的例句
2. 如果提供的例句不够，宁可少列义项，也不要用未提供的例句
3. 如果是多音字，在读音部分列出所有读音
4. **不要在输出中包含任何"⚠️ 易误为：..."、"避坑提示"、"注意：..."等元说明性文字**，只输出读音和义项本身
5. 返回纯 Markdown 内容，不要有额外解释"""

# 上下文消歧补充段：当用户提供了 context（出处/原句）时拼到 system prompt 末尾。
# 让 LLM 优先按 context 判断多音字读音和义项，无 context 则不拼这段。
QUERY_CONTEXT_NOTE = """

**【当前查询的上下文】**：用户正在阅读「{context}」一文。
- 如果该字在「{context}」中是**多音字**，**先按上下文判定当前读音**，放在最前；其他读音次之。
- 如果该字在「{context}」中有**特定用法**（如某义项只在该语境出现），**优先列该义项**。
- 如果该字在「{context}」中是**单字成词或特殊用法**，**不要默认套用最常见义项**，要回到原句解读。
- 例句尽量从上方 RAG 列表中选取与「{context}」同源/同作者/同时代的例子。
- 如果「{context}」中该字的用法你**不确定**，请在读音或义项后显式标"⚠️ 语境待考"。
"""

# 例句优先释义段：当用户提供了 example（自己输入的例句）时拼到 system prompt 末尾。
# 让 LLM 优先按 example 推断该字在例句中的义项并排在最前，其他义项次之。
QUERY_EXAMPLE_NOTE = """

**【用户提供的例句】**：用户已经知道这个字出现在「{example}」这句中，希望优先了解该字在这句里的用法。
- **首要任务**：判断「{word}」在「{example}」中的具体义项/读音，并**放在最前、用方框高亮**（如「📍 在本例句中的意思：...」）。
- **次要任务**：列出该字的其他常见义项（按常用度倒序）。
- 如果「{example}」中该字是**多音字**，先按例句判定当前读音，其他读音放后。
- 如果「{example}」的语义你**不确定**，请在判断后显式标"⚠️ 语境待考"。
- **不要套用最常见义项**：用户主动提供例句说明他想确认非默认义项的可能性。
"""

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
    except Exception as e:
        log_debug(f"[WS] send 失败: {e}")


@app.websocket("/ws/query")
async def ws_query(ws: WebSocket, ticket: str = None, token: str = None):
    # P0-3: 优先用 ticket 鉴权（避免 token 进 URL/Nginx 日志）
    # ticket 是一次性的，服务端 consume 后立即失效，防重放
    # 兼容 fallback：如果客户端还没升级，仍允许 ?token=xxx（过渡期）
    openid = None
    if ticket:
        openid, valid = consume_ws_ticket(ticket)
        if not valid:
            await ws.close(code=1008, reason="ticket 无效或已过期")
            log_error(f"[WS /ws/query] 拒绝无效 ticket")
            return
    elif token:
        openid, valid = verify_token(token)
        if not valid:
            await ws.close(code=1008, reason="未授权")
            log_error(f"[WS /ws/query] 拒绝未授权连接")
            return
        log_warning(f"[WS /ws/query] 使用 URL token（建议升级到 ticket）")
    else:
        await ws.close(code=1008, reason="缺少 ticket")
        log_error(f"[WS /ws/query] 缺少 ticket/token")
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

        # 可选上下文（多音字消歧、出处定位）
        # 前端可在 user 选择某字时附带原句/篇目名，AI 据此优先判定读音和义项
        context = (request.get('context') or '').strip()
        # 可选例句：用户输入的例句，AI 据此优先释义
        example = (request.get('example') or '').strip()
        if example:
            log_info(f"[query] word='{word}', example='{example[:60]}'")
        elif context:
            log_info(f"[query] word='{word}', context='{context[:60]}'")
        else:
            log_info(f"[query] word='{word}', no context/example")

        # RAG 检索例句
        rag_examples = rag.query(word)
        # 查询常见误用反例（避坑提示）
        misuses = rag.query_misuses(word)
        # 拼成完整上下文
        if misuses:
            rag_examples = misuses + "\n\n" + rag_examples
        log_info(f"[RAG] '{word}': 例句 {len(rag_examples)} 字")

        # 构建 prompt：先注入 RAG；有 example 时先追加例句优先释义段，再追加 context 消歧段
        prompt = QUERY_SYSTEM_PROMPT.replace("{rag_examples}", rag_examples)
        if example:
            example_note = QUERY_EXAMPLE_NOTE.replace("{word}", word).replace("{example}", example)
            prompt += example_note
            log_info(f"[query] 已注入 example 优先释义段（{len(example)} 字）")
        if context:
            prompt += QUERY_CONTEXT_NOTE.replace("{context}", context)
            log_info(f"[query] 已注入 context 消歧段（{len(context)} 字）")

        # user message 也带上 example / context，让 LLM 在对话上下文里明确知道
        user_content = f"请解析以下字词：{word}"
        if example:
            user_content += f"\n（用户提供的例句：{example}）"
        if context:
            user_content += f"\n（出处/原句：{context}）"

        messages = [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_content}
        ]

        # 调用 AI（temperature=0.1 减少幻觉，提升查词精确度）
        # 关键：async for 边收边发，producer 在后台线程跑，不阻塞主 event loop
        await manager.send({'type': 'start', 'word': word, 'context': context}, ws)
        first_token = True
        try:
            async for content in call_ai_stream_async(MODEL, messages, MAX_TOKENS, temperature=0.1):
                if first_token:
                    log_info(f"[查词] 首token: {(time.time()-start_time)*1000:.0f}ms")
                    first_token = False
                await send_streaming(ws, content)
        except Exception as e:
            log_error(f"[查词] {e}")

        log_success(f"[查词] 完成")
        try:
            await manager.send({'type': 'done'}, ws)
        except Exception as e:
            log_debug(f"[WS] send 失败: {e}")
    finally:
        manager.disconnect(ws)


@app.websocket("/ws/translate")
async def ws_translate(ws: WebSocket, ticket: str = None, token: str = None):
    # P0-3: 优先用 ticket 鉴权
    openid = None
    if ticket:
        openid, valid = consume_ws_ticket(ticket)
        if not valid:
            await ws.close(code=1008, reason="ticket 无效或已过期")
            log_error(f"[WS /ws/translate] 拒绝无效 ticket")
            return
    elif token:
        openid, valid = verify_token(token)
        if not valid:
            await ws.close(code=1008, reason="未授权")
            log_error(f"[WS /ws/translate] 拒绝未授权连接")
            return
        log_warning(f"[WS /ws/translate] 使用 URL token（建议升级到 ticket）")
    else:
        await ws.close(code=1008, reason="缺少 ticket")
        log_error(f"[WS /ws/translate] 缺少 ticket/token")
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
        # 关键：async for 边收边发，producer 在后台线程跑，不阻塞主 event loop
        first_token = True
        try:
            async for content in call_ai_stream_async(MODEL, messages, MAX_TOKENS):
                if first_token:
                    log_info(f"[翻译] 首token: {(time.time()-start_time)*1000:.0f}ms")
                    first_token = False
                await send_streaming(ws, content)
        except Exception as e:
            log_error(f"[翻译] {e}")

        log_success(f"[翻译] 完成")
        try:
            await manager.send({'type': 'done'}, ws)
        except Exception as e:
            log_debug(f"[WS] send 失败: {e}")
    except Exception as e:
        log_error(f"[翻译] {e}")
    finally:
        manager.disconnect(ws)


# --- 登录接口 ---
# P1-5: 所有 import 已统一在文件顶部引入；删除这里散落的重复 import


def _extract_token(authorization: str = None) -> str | None:
    """从 Authorization: Bearer xxx 头提取 token"""
    if not authorization:
        return None
    if authorization.startswith("Bearer "):
        return authorization[7:]
    return authorization


class LoginRequest(BaseModel):
    code: str


class UpdateProfileRequest(BaseModel):
    """更新用户资料的请求体（昵称/头像）。
    头像 URL 较长（微信返回的临时链接可达数百字符），必须用 body 不能用 query。
    """
    nickname: str = None
    avatar: str = None


class SyncRequest(BaseModel):
    data_type: str
    data_key: str
    # 接受任意类型：前端 wx.request 把整个 body JSON 序列化后，data_value
    # 仍是原生 list/dict/str，不是字符串；端点里统一 json.dumps 再存储
    data_value: Any = None


@app.post("/api/login")
async def login(req: LoginRequest):
    """微信登录"""
    # 用 code 换 openid
    result = await code2session(req.code)
    if not result["success"]:
        log_warning(f"[login] code2session 失败: {result['errmsg']}")
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
        # P1-7: 用纳秒级时间戳作种子，确保每个新用户拿到不同的背诵顺序
        # 否则 Python 默认固定种子 → 所有用户的第一组完全一样
        random.seed(time.time_ns())
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
        log_warning('[user] 无效 token')
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
    req: UpdateProfileRequest = None,
):
    """更新用户信息（昵称 / 头像）
    使用 body 而不是 query：头像 URL 长度可达数百字符，query 容易触发 URL 长度限制。
    """
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        log_warning('[user] 无效 token')
        return {"error": "无效的 token"}

    nickname = req.nickname if req else None
    avatar = req.avatar if req else None
    update_user_info(openid, nickname, avatar)
    return {"success": True}


@app.get("/api/user/data")
async def get_user_data_api(authorization: str = Header(None), data_type: str = None):
    """获取用户数据"""
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        log_warning('[user] 无效 token')
        return {"error": "无效的 token"}

    data = get_user_data(openid, data_type)
    return {"data": data}


@app.put("/api/user/data")
async def save_user_data_api(
    authorization: str = Header(None),
    req: SyncRequest = None
):
    """保存用户数据（仅支持 body，不再兼容 query 通道）

    P0-2: 删除 query 通道，避免通过 URL query 写入绕过 JSON 校验的脏数据。
    所有前端调用都已切到 body（见 auth.saveUserData）。
    """
    if not req:
        log_warning('[save_user_data] 缺少 body')
        return {"error": "缺少请求体"}

    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        log_warning('[save_user_data] 无效 token')
        return {"error": "无效的 token"}

    dt = req.data_type
    dk = req.data_key
    dv = req.data_value
    log_debug(f"[save_user_data] data_type={dt}, data_key={dk}, dv_type={type(dv).__name__}")

    # 纵深防御：无论前端传 list/dict/str，统一强制走 json.dumps。
    # 之前 `not isinstance(dv, str)` 分支会让"已是 JSON 字符串"的攻击者绕过规范化，
    # 导致 _parse_legacy_safe 二次解析行为不确定。
    if dv is None:
        return {"success": False, "error": "data_value 不能为空"}
    if not isinstance(dv, str):
        dv = json.dumps(dv, ensure_ascii=False)
    ok = save_user_data(openid, dt, dk, dv)
    if not ok:
        log_error(f"[save_user_data] 写入失败, key={dk}")
        # 失败原因由 save_user_data 内部 log_warning 给出（白名单/JSON/类型），
        # 这里只给前端一个粗粒度消息便于排查
        return {"success": False, "error": "data_type/data_key 不在白名单或 data_value 非法"}
    return {"success": True}


# --- 登出接口（P0-4：撤销 token） ---
@app.post("/api/logout")
async def logout(authorization: str = Header(None)):
    """撤销当前 token。前端调用后本地 + 服务端双清。"""
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        # 即便 token 无效也返回 success：登出"幂等"
        return {"success": True}

    revoke_user_token(token, openid)
    return {"success": True}


# --- WebSocket Ticket 接口（P0-3：避免 token 出现在 URL） ---
@app.post("/api/ws-ticket")
async def create_ws_ticket_api(authorization: str = Header(None)):
    """换取一次性 WS ticket（30s 有效）

    客户端流程：
    1. POST /api/ws-ticket（带 Bearer token）→ 拿到 ticket
    2. 立刻连 ws://host/ws/query?ticket=xxx（URL 里只有 ticket，无 token）
    3. ticket 一次性：服务端 consume 后立即失效，防重放
    """
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        log_warning('[ws-ticket] 无效 token')
        return {"error": "无效的 token"}

    ticket = create_ws_ticket(openid)
    return {"ticket": ticket, "expire_seconds": 30}


# --- 启动 ---
if __name__ == "__main__":
    log_success(f"[startup] guzi listening on {HOST}:{PORT}, model={MODEL}, debug={DEBUG_ENABLED}")
    uvicorn.run(app, host=HOST, port=PORT)