import json
import time
import asyncio
import os
import random
import secrets
import threading
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Header, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
from openai import OpenAI
import uvicorn
from concurrent.futures import ThreadPoolExecutor

from logger import log_info, log_success, log_warning, log_debug, log_error, DEBUG_ENABLED

from ragService import rag
from iploc import query_cn as ip_query_cn
from auth import (
    code2session, create_token, verify_token,
    create_ws_ticket, consume_ws_ticket,
    revoke_user_token, WS_TICKET_EXPIRE_SECONDS,
)
from database import (
    create_user, get_user_by_openid, update_user_token, update_user_info,
    save_user_data, get_user_data, cleanup_revoked_tokens,
    add_feedback, get_feedbacks, update_feedback_status,
    get_user_list, get_word_states_rows, get_db_stats,
    add_login_log, get_login_logs,
    add_usage_log, cleanup_usage_logs, get_daily_counts, get_usage_daily_counts,
    get_usage_hourly, get_usage_heatmap, get_usage_daily_uv, get_feedback_status_counts,
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
MAX_TRANSLATE_LENGTH = _config["service"].get("translate_max_length", 1000)
MAX_QUERY_CONTEXT_LENGTH = _config["service"].get("query_context_max_length", 200)
WS_RATE_LIMIT_PER_MINUTE = _config["service"].get("ws_rate_limit_per_minute", 30)
LOGIN_RATE_LIMIT_PER_MINUTE = _config["service"].get("login_rate_limit_per_minute", 60)
WS_RECEIVE_TIMEOUT = _config["service"].get("ws_receive_timeout_seconds", 60)
AI_STREAM_TOTAL_TIMEOUT = _config["service"].get("ai_stream_timeout_seconds", 180)
CLEANUP_INTERVAL_SECONDS = _config["service"].get("cleanup_interval_seconds", 3600)
CLEANUP_REVOKED_AFTER_DAYS = _config["service"].get("cleanup_revoked_after_days", 40)

# 内存滑动窗口限流（重启即清零，够用于防滥用；正式多实例部署应换 Redis）
class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            hits = self._hits.setdefault(key, [])
            while hits and hits[0] < now - self.window:
                hits.pop(0)
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def prune(self, max_idle_seconds: float = 3600.0):
        """清理长时间不活跃的 key，防止内存膨胀"""
        now = time.time()
        with self._lock:
            stale = [k for k, v in self._hits.items() if not v or v[-1] < now - max_idle_seconds]
            for k in stale:
                del self._hits[k]


ws_rate_limiter = RateLimiter(WS_RATE_LIMIT_PER_MINUTE)
login_rate_limiter = RateLimiter(LOGIN_RATE_LIMIT_PER_MINUTE)


# ==================== 管理后台 ====================
# 运行统计（内存计数，重启清零；供管理后台"实时监控"）
_runtime_stats = {
    "start_time": time.time(),
    "query_total": 0,
    "translate_total": 0,
    "ai_errors": 0,
    "feedback_total": 0,
}

# admin token（内存，12h 有效；重启后需重新登录）
_admin_tokens: dict = {}
ADMIN_TOKEN_EXPIRE_SECONDS = 12 * 3600


def _admin_password() -> str:
    """管理员密码：优先环境变量，其次 config.json 的 admin.password"""
    return os.getenv("ADMIN_PASSWORD", (_config.get("admin") or {}).get("password", ""))


def _create_admin_token() -> str:
    token = secrets.token_urlsafe(32)
    _admin_tokens[token] = time.time() + ADMIN_TOKEN_EXPIRE_SECONDS
    return token


def _verify_admin(authorization: str = None) -> bool:
    """校验 admin token"""
    token = _extract_token(authorization)
    if not token:
        return False
    expire = _admin_tokens.get(token)
    if not expire:
        return False
    if time.time() > expire:
        _admin_tokens.pop(token, None)
        return False
    return True


def _self_proc_info() -> dict:
    """当前进程基础信息（Linux /proc）"""
    info = {"pid": os.getpid(), "memory_mb": None, "cmdline": ""}
    try:
        with open("/proc/self/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    info["memory_mb"] = round(int(line.split()[1]) / 1024, 1)
                    break
        with open("/proc/self/cmdline", "rb") as f:
            info["cmdline"] = f.read().decode("utf-8", "ignore").replace("\x00", " ")
    except Exception:
        pass
    return info

def _client_ip(request: Request) -> str:
    """取客户端 IP（用于限流）。

    优先用 Nginx 反代覆盖的 X-Real-IP（README 部署配置里由 Nginx 强制写入，
    客户端无法伪造）；兜底取 TCP 对端地址。
    不信任 X-Forwarded-For：其最左侧值可由客户端伪造，会让登录限流形同虚设。
    """
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"


async def _background_cleanup():
    """后台定时任务：清理过期的撤销 token 和限流器内存"""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        try:
            cutoff = (datetime.now() - timedelta(days=CLEANUP_REVOKED_AFTER_DAYS)).isoformat()
            removed = cleanup_revoked_tokens(cutoff)
            if removed:
                log_info(f"[cleanup] 清理撤销记录 {removed} 条")
        except Exception as e:
            log_error(f"[cleanup] 清理撤销记录失败: {e}")
        try:
            ws_rate_limiter.prune()
            login_rate_limiter.prune()
        except Exception as e:
            log_error(f"[cleanup] 限流器清理失败: {e}")
        try:
            removed_usage = cleanup_usage_logs(90)
            if removed_usage:
                log_info(f"[cleanup] 清理使用日志 {removed_usage} 条")
        except Exception as e:
            log_error(f"[cleanup] 清理使用日志失败: {e}")


# 初始化 FastAPI
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_background_cleanup())
    log_info("[startup] 后台清理任务已启动")
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

app = FastAPI(title="古字通 API", lifespan=lifespan)

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

# 管理后台静态页面：独立于后端目录（项目根 admin/ 优先；后端目录内 admin 兜底，
# 兼容服务器"后端文件直接铺在站点根"的部署形态）。可用环境变量 ADMIN_DIR 强制指定
# （相对后端目录，如 ADMIN_DIR=../admin）。
_this_dir = os.path.dirname(os.path.abspath(__file__))
_admin_dir = os.getenv("ADMIN_DIR", "")
if _admin_dir:
    _admin_dir = os.path.join(_this_dir, _admin_dir)
else:
    _admin_candidates = [
        os.path.join(os.path.dirname(_this_dir), "admin"),  # 项目根 admin/
        os.path.join(_this_dir, "admin"),                    # 后端目录内 admin/（服务器 wyw/admin）
    ]
    _admin_dir = next((p for p in _admin_candidates if os.path.isdir(p)), None)
if _admin_dir and os.path.isdir(_admin_dir):
    from fastapi.staticfiles import StaticFiles
    app.mount("/admin", StaticFiles(directory=_admin_dir, html=True), name="admin")
    log_info(f"[startup] 管理后台静态目录: {_admin_dir}")

# 初始化客户端 (智谱 GLM)
client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# 创建线程池
executor = ThreadPoolExecutor(max_workers=MAX_WORKERS)

# --- 辅助函数 ---
# P1-6: 删除未使用的 sync_create_chat_stream 函数（已被 call_ai_stream_async 替代）

async def call_ai_stream_async(model: str, messages: list, max_tokens: int, temperature: float = None, stop_event: asyncio.Event = None, total_timeout: float = None):
    """异步流式调用 AI：在后台线程拉 chunks，主 event loop 边收边发（不阻塞）。

    stop_event 置位时（客户端断开/超时）producer 停止拉取，避免白烧 API 费用；
    生成器退出时兜底置位并回收 executor future。

    total_timeout：整个流式调用的硬性总时限（秒）。openai 请求自身也带该超时，
    保证网络卡死的 producer 线程最终能自行退出，不会永久占用 executor 槽位
    （此前无总超时时，20 个并发卡死连接就能耗尽线程池，服务整体不可用）。
    """
    loop = asyncio.get_event_loop()
    queue = asyncio.Queue()
    if total_timeout is None:
        total_timeout = AI_STREAM_TOTAL_TIMEOUT
    deadline = time.monotonic() + total_timeout

    def _producer():
        """后台线程：从智谱拉取每个 chunk 并 put 到 queue"""
        try:
            kwargs = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": True,
                "timeout": total_timeout,  # 请求级超时：卡死的线程最终自行退出
            }
            if temperature is not None:
                kwargs["temperature"] = temperature
            stream = client.chat.completions.create(**kwargs)
            for c in stream:
                if stop_event is not None and stop_event.is_set():
                    break  # 客户端已断开：停止拉取，节省费用
                if c.choices and c.choices[0].delta.content:
                    # 跨线程安全地把内容放进 asyncio.Queue
                    loop.call_soon_threadsafe(queue.put_nowait, c.choices[0].delta.content)
            loop.call_soon_threadsafe(queue.put_nowait, None)  # 哨兵
        except Exception as e:
            loop.call_soon_threadsafe(queue.put_nowait, e)

    # 在 executor 中启动 producer（不 await！让 producer 在后台跑）
    future = loop.run_in_executor(executor, _producer)

    try:
        # 主 event loop 异步消费 queue（带总时限，防止 AI 端卡死时永久等待）
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if stop_event is not None:
                    stop_event.set()
                raise asyncio.TimeoutError(f"AI 流式调用超过总时限 {total_timeout:.0f}s")
            item = await asyncio.wait_for(queue.get(), timeout=remaining)
            if item is None:
                return  # 收集完毕
            if isinstance(item, Exception):
                raise item
            if stop_event is not None and stop_event.is_set():
                return  # 主动终止：丢弃尚未发出的内容
            yield item
    finally:
        if stop_event is not None:
            stop_event.set()
        # 回收 executor future，避免线程泄漏；producer 卡在网络时最多等 2s，
        # 超时后强制 cancel 释放引用（线程本身受 openai 请求超时约束，最终会退出）
        try:
            await asyncio.wait_for(asyncio.wrap_future(future), timeout=2)
        except asyncio.CancelledError:
            future.cancel()
            raise
        except Exception:
            future.cancel()


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
- **解释**：**必填**，对释义的补充说明（**15-25 字**），简洁点出关键用法即可：
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
7. **若有「常见误用避坑」段**，仅作内部参考（避免采纳错误理解），**不要在输出中显式标出"易误为"等避坑提示**。

以下是古诗文数据库中包含该字的例句（含「常见误用避坑」段，如有），直接选用，不需要自己编造：
{rag_examples}

注意：
1. 严格使用上面提供的例句，每个义项都要用对应的例句
2. 如果提供的例句不够，宁可少列义项，也不要用未提供的例句
3. 如果是多音字，在读音部分列出所有读音
4. **不要在输出中包含任何"易误为：..."、"避坑提示"、"注意：..."等元说明性文字**，只输出读音和义项本身
5. 返回纯 Markdown 内容，不要有额外解释"""

# 上下文消歧补充段：当用户提供了 context（出处/原句）时拼到 system prompt 末尾。
# 让 LLM 优先按 context 判断多音字读音和义项，无 context 则不拼这段。
QUERY_CONTEXT_NOTE = """

**【当前查询的上下文】**：用户正在阅读「{context}」一文。
- 如果该字在「{context}」中是**多音字**，**先按上下文判定当前读音**，放在最前；其他读音次之。
- 如果该字在「{context}」中有**特定用法**（如某义项只在该语境出现），**优先列该义项**。
- 如果该字在「{context}」中是**单字成词或特殊用法**，**不要默认套用最常见义项**，要回到原句解读。
- 例句尽量从上方 RAG 列表中选取与「{context}」同源/同作者/同时代的例子。
- 如果「{context}」中该字的用法你**不确定**，请在读音或义项后显式标「语境待考」（不要用 emoji 符号）。
"""

# 例句优先释义段：当用户提供了 example（自己输入的例句）时拼到 system prompt 末尾。
# 让 LLM 优先按 example 推断该字在例句中的义项并排在最前，其他义项次之。
QUERY_EXAMPLE_NOTE = """

**【用户提供的例句】**：用户已经知道这个字出现在「{example}」这句中，希望优先了解该字在这句里的用法。
- **首要任务**：判断「{word}」在「{example}」中的具体义项/读音，并**放在最前、用方框高亮**（如「在本例句中的意思：...」）。
- **次要任务**：列出该字的其他常见义项（按常用度倒序）。
- 如果「{example}」中该字是**多音字**，先按例句判定当前读音，其他读音放后。
- 如果「{example}」的语义你**不确定**，请在判断后显式标「语境待考」（不要用 emoji 符号）。
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
    # 只回状态，不暴露模型/技术栈信息，避免被侦察
    return {"status": "ok"}


async def send_streaming(ws: WebSocket, content: str):
    """流式发送一个 chunk（不再逐字符拆分，避免包数暴增和 UI 卡顿）"""
    await manager.send({'type': 'content', 'content': content}, ws)


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
    if not ws_rate_limiter.allow(openid):
        await ws.close(code=1008, reason="请求过于频繁，请稍后再试")
        log_error(f"[WS /ws/query] 限流: {openid}")
        return
    await manager.connect(ws)
    stop_event = asyncio.Event()
    try:
        try:
            data = await asyncio.wait_for(ws.receive_text(), timeout=WS_RECEIVE_TIMEOUT)
        except asyncio.TimeoutError:
            log_error(f"[WS /ws/query] 空闲超时: {openid}")
            await ws.close(code=1008, reason="空闲超时")
            return
        try:
            request = json.loads(data)
        except json.JSONDecodeError:
            await manager.send({'type': 'error', 'message': '消息格式错误'}, ws)
            return
        if not isinstance(request, dict):
            await manager.send({'type': 'error', 'message': '消息格式错误'}, ws)
            return
        word = str(request.get('text', request.get('word', ''))).strip()

        if not word:
            await manager.send({'error': '请输入字词'}, ws)
            return

        if len(word) > MAX_QUERY_LENGTH:
            await manager.send({'error': f'请选择 1-{MAX_QUERY_LENGTH} 个字进行查询'}, ws)
            return

        start_time = time.time()

        # 可选上下文（多音字消歧、出处定位）
        # 前端可在 user 选择某字时附带原句/篇目名，AI 据此优先判定读音和义项
        context = (request.get('context') or '').strip()[:MAX_QUERY_CONTEXT_LENGTH]
        # 可选例句：用户输入的例句，AI 据此优先释义
        example = (request.get('example') or '').strip()[:MAX_QUERY_CONTEXT_LENGTH]
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
        _runtime_stats["query_total"] += 1
        try:
            add_usage_log(openid, "query")
        except Exception:
            pass
        await manager.send({'type': 'start', 'word': word, 'context': context}, ws)
        first_token = True
        try:
            async for content in call_ai_stream_async(MODEL, messages, MAX_TOKENS, temperature=0.1, stop_event=stop_event):
                if first_token:
                    log_info(f"[查词] 首token: {(time.time()-start_time)*1000:.0f}ms")
                    first_token = False
                if stop_event.is_set():
                    break
                try:
                    await send_streaming(ws, content)
                except Exception as e:
                    # 客户端已断开：停止消费 AI 流，避免白烧费用
                    log_debug(f"[WS /ws/query] send 失败，停止流: {e}")
                    stop_event.set()
                    break
        except Exception as e:
            log_error(f"[查词] AI 流式调用失败: {e}")
            _runtime_stats["ai_errors"] += 1
            # 明确告知客户端失败，避免"显示完成但内容为空"的假象
            try:
                await manager.send({'type': 'error', 'message': 'AI 服务暂不可用，请重试'}, ws)
            except Exception:
                pass
            stop_event.set()
            return

        log_success(f"[查词] 完成")
        try:
            await manager.send({'type': 'done'}, ws)
        except Exception as e:
            log_debug(f"[WS] send 失败: {e}")
    except Exception as e:
        # 兜底：非法消息等未预期异常不能静默断连，告知客户端后正常收尾
        log_error(f"[WS /ws/query] 未处理异常: {e}")
        try:
            await manager.send({'type': 'error', 'message': '查询失败，请重试'}, ws)
        except Exception:
            pass
    finally:
        stop_event.set()
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
    if not ws_rate_limiter.allow(openid):
        await ws.close(code=1008, reason="请求过于频繁，请稍后再试")
        log_error(f"[WS /ws/translate] 限流: {openid}")
        return
    await manager.connect(ws)
    stop_event = asyncio.Event()
    try:
        try:
            data = await asyncio.wait_for(ws.receive_text(), timeout=WS_RECEIVE_TIMEOUT)
        except asyncio.TimeoutError:
            log_error(f"[WS /ws/translate] 空闲超时: {openid}")
            await ws.close(code=1008, reason="空闲超时")
            return
        try:
            req = json.loads(data)
        except json.JSONDecodeError:
            await manager.send({'type': 'error', 'message': '消息格式错误'}, ws)
            return
        if not isinstance(req, dict):
            await manager.send({'type': 'error', 'message': '消息格式错误'}, ws)
            return
        text = str(req.get('text', '')).strip()

        if not text:
            await manager.send({'error': '请输入内容'}, ws)
            return

        if len(text) > MAX_TRANSLATE_LENGTH:
            await manager.send({'error': f'单次最多翻译 {MAX_TRANSLATE_LENGTH} 字'}, ws)
            return

        start_time = time.time()
        messages = [
            {"role": "system", "content": TRANSLATE_SYSTEM_PROMPT},
            {"role": "user", "content": f"请翻译：{text}"}
        ]

        await manager.send({'type': 'start', 'original': text}, ws)
        _runtime_stats["translate_total"] += 1
        try:
            add_usage_log(openid, "translate")
        except Exception:
            pass
        # 关键：async for 边收边发，producer 在后台线程跑，不阻塞主 event loop
        first_token = True
        try:
            async for content in call_ai_stream_async(MODEL, messages, MAX_TOKENS, stop_event=stop_event):
                if first_token:
                    log_info(f"[翻译] 首token: {(time.time()-start_time)*1000:.0f}ms")
                    first_token = False
                if stop_event.is_set():
                    break
                try:
                    await send_streaming(ws, content)
                except Exception as e:
                    log_debug(f"[WS /ws/translate] send 失败，停止流: {e}")
                    stop_event.set()
                    break
        except Exception as e:
            log_error(f"[翻译] AI 流式调用失败: {e}")
            _runtime_stats["ai_errors"] += 1
            try:
                await manager.send({'type': 'error', 'message': 'AI 服务暂不可用，请重试'}, ws)
            except Exception:
                pass
            stop_event.set()
            return

        log_success(f"[翻译] 完成")
        try:
            await manager.send({'type': 'done'}, ws)
        except Exception as e:
            log_debug(f"[WS] send 失败: {e}")
    except Exception as e:
        log_error(f"[翻译] {e}")
    finally:
        stop_event.set()
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


def _auth_error(message: str = "无效的 token"):
    """统一返回认证失败状态，避免客户端把错误 JSON 当成成功响应。"""
    return JSONResponse(status_code=401, content={"error": message})


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
async def login(req: LoginRequest, request: Request):
    """微信登录"""
    if not login_rate_limiter.allow(_client_ip(request)):
        log_warning(f"[login] 限流: {_client_ip(request)}")
        return {"error": "请求过于频繁，请稍后再试"}
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
        created = create_user(openid, token_info["token"], token_info["expire_time"])
        if not created:
            # 并发首次登录时 INSERT 唯一冲突会返回 False：用户可能已被另一请求创建，
            # 改走 update 路径，避免"登录成功但所有接口 401"
            log_warning(f"[login] create_user 失败（可能并发注册），改走 update: {openid}")
            update_user_token(openid, token_info["token"], token_info["expire_time"])
        # 新用户：生成背诵顺序
        init_learn_order(openid)

    # 记录登录日志（管理后台：最近上线时间 + IP 属地）；失败不阻塞登录
    try:
        client_ip = _client_ip(request)
        location = ip_query_cn(client_ip) if client_ip and client_ip != "unknown" else ""
        add_login_log(openid, client_ip, location)
    except Exception as e:
        log_debug(f"[login] 记录登录日志失败: {e}")

    return {
        "openid": openid,
        "token": token_info["token"],
        "expire_days": token_info["expire_days"]
    }


# realwords.json 由 utils/services/realWords.js 生成，放在 backend 目录内
# （README 有说明；改动词库后用 `node scripts/gen_realwords_json.js` 重新生成）
# 进程内只读盘解析一次，避免每个新用户登录都重复 IO + JSON 解析
_realwords_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "realwords.json")
_realwords_cache = None


def _load_realwords():
    """读取 150 词表（带进程内缓存）"""
    global _realwords_cache
    if _realwords_cache is None:
        with open(_realwords_path, 'r', encoding='utf-8') as f:
            _realwords_cache = json.load(f)
    return _realwords_cache


def init_learn_order(openid: str):
    """新用户首次登录时生成背诵顺序"""
    try:
        words_data = _load_realwords()

        words = [w['word'] for w in words_data]
        # P1-7: 用纳秒级时间戳作独立 RNG 种子，确保每个新用户拿到不同的背诵顺序
        # 用独立 random.Random 实例，避免 random.seed 污染进程全局 RNG 状态
        rng = random.Random(time.time_ns())
        rng.shuffle(words)

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
        return _auth_error()

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
        return _auth_error()

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
        return _auth_error()

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
        return _auth_error()

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
        return _auth_error()

    ticket = create_ws_ticket(openid)
    return {"ticket": ticket, "expire_seconds": WS_TICKET_EXPIRE_SECONDS}


# ==================== 用户反馈（小程序提交 → 管理后台查看） ====================

class FeedbackRequest(BaseModel):
    content: str
    contact: str = ""


@app.post("/api/feedback")
async def submit_feedback(authorization: str = Header(None), req: FeedbackRequest = None):
    """小程序提交用户反馈（用户 token 鉴权）"""
    token = _extract_token(authorization)
    openid, valid = verify_token(token) if token else (None, False)
    if not valid:
        return _auth_error()
    if not req or not req.content or not req.content.strip():
        return {"error": "反馈内容不能为空"}
    user = get_user_by_openid(openid)
    nickname = (user or {}).get("nickname") or ""
    ok = add_feedback(openid, nickname, req.content.strip(), (req.contact or "").strip())
    if not ok:
        return {"success": False, "error": "提交失败，请稍后重试"}
    _runtime_stats["feedback_total"] += 1
    log_info(f"[feedback] 新反馈来自 {nickname or openid}")
    return {"success": True}


# ==================== 管理后台接口（admin token 鉴权） ====================

class AdminLoginRequest(BaseModel):
    password: str


class FeedbackStatusRequest(BaseModel):
    status: str


@app.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest):
    """管理员登录：密码换 admin token（12h 有效）"""
    if not _admin_password():
        return {"error": "管理员密码未配置（config.json admin.password 或环境变量 ADMIN_PASSWORD）"}
    if req.password != _admin_password():
        log_warning("[admin] 登录密码错误")
        return {"error": "密码错误"}
    return {"token": _create_admin_token(), "expire_seconds": ADMIN_TOKEN_EXPIRE_SECONDS}


@app.get("/api/admin/status")
async def admin_status(authorization: str = Header(None)):
    """实时监控：服务 / 进程 / 数据库 / WS 连接 / 计数器"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    now = time.time()
    return {
        "status": "ok",
        "model": MODEL,
        "uptime_seconds": round(now - _runtime_stats["start_time"]),
        "start_time": datetime.fromtimestamp(_runtime_stats["start_time"]).isoformat(),
        "proc": _self_proc_info(),
        "ws_active": len(manager.active),
        "db": get_db_stats(),
        "counters": dict(_runtime_stats),
        "rate_limiter_keys": {
            "ws": len(ws_rate_limiter._hits),
            "login": len(login_rate_limiter._hits),
        },
        "active_hours_24": get_usage_hourly(1),
    }


@app.get("/api/admin/users")
async def admin_users(authorization: str = Header(None), page: int = 1, page_size: int = 20):
    """用户列表（管理）"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    return get_user_list(page, page_size)


def _parse_json_field(value, default):
    """user_data 字段可能是 JSON 字符串或已解析对象"""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default
    return value if value is not None else default


@app.get("/api/admin/user-detail")
async def admin_user_detail(authorization: str = Header(None), openid: str = None):
    """用户详细信息：资料 / 最近上线 / 登录记录(IP属地) / 学习统计 / 查词记录 / 翻译记录"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    if not openid:
        return {"error": "缺少 openid 参数"}
    user = get_user_by_openid(openid)
    if not user:
        return {"error": "用户不存在"}
    data = get_user_data(openid) or {}

    learned = _parse_json_field(data.get("wordStates"), {}) or {}
    review_stats = _parse_json_field(data.get("reviewStats"), {}) or {}
    history = _parse_json_field(data.get("history"), []) or []
    translations = _parse_json_field(data.get("translations"), []) or []
    collections = _parse_json_field(data.get("collections"), []) or []
    if not isinstance(learned, dict): learned = {}
    if not isinstance(review_stats, dict): review_stats = {}
    if not isinstance(history, list): history = []
    if not isinstance(translations, list): translations = []
    if not isinstance(collections, list): collections = []

    # 学习统计聚合
    phase_dist = {"learning": 0, "review": 0, "graduated": 0}
    learned_words = 0
    review_count = 0
    for state in learned.values():
        if not isinstance(state, dict):
            continue
        learned_words += 1
        ph = state.get("phase")
        if ph in phase_dist:
            phase_dist[ph] += 1
        try:
            review_count += int(state.get("reviewCount") or state.get("review_count") or 0)
        except (TypeError, ValueError):
            pass

    # 查词记录：最近 15 条，含完整 content（前端默认折叠，点击展开）
    recent_queries = []
    for i, it in enumerate(reversed(history[-15:])):
        if not isinstance(it, dict):
            continue
        content = it.get("content") or ""
        recent_queries.append({
            "word": it.get("word") or "",
            "time": it.get("time"),
            "preview": content[:80],
            "content": content,
        })

    login_logs = get_login_logs(openid, 10)
    last_active = login_logs[0]["created_at"] if login_logs else (user.get("updated_at") or user.get("created_at"))

    return {
        "profile": {
            "openid": user.get("openid"),
            "nickname": user.get("nickname") or "",
            "avatar": user.get("avatar") or "",
            "created_at": user.get("created_at"),
            "updated_at": user.get("updated_at"),
            "last_active_at": last_active,
        },
        "login_logs": login_logs,
        "learning": {
            "learned_words": learned_words,
            "phase_dist": phase_dist,
            "review_count": review_count,
            "streak_days": review_stats.get("streak_days", 0),
        },
        "counts": {
            "collections": len(collections),
            "translations": len(translations),
            "history": len(history),
        },
        "recent_queries": recent_queries,
        "recent_translations": [
            {"original": (t.get("original") if isinstance(t, dict) else "") or "", "time": t.get("time") if isinstance(t, dict) else None}
            for t in reversed(translations[-5:])
        ],
        "user_data_keys": sorted(data.keys()),
    }


@app.get("/api/admin/user-data")
async def admin_user_data(authorization: str = Header(None), openid: str = None):
    """查看单用户数据"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    if not openid:
        return {"error": "缺少 openid 参数"}
    return {"openid": openid, "data": get_user_data(openid)}


@app.get("/api/admin/feedbacks")
async def admin_feedbacks(authorization: str = Header(None), status: str = None, page: int = 1, page_size: int = 20):
    """反馈列表（管理）"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    return get_feedbacks(status, page, page_size)


@app.put("/api/admin/feedbacks/{feedback_id}")
async def admin_feedback_status(feedback_id: int, authorization: str = Header(None), req: FeedbackStatusRequest = None):
    """标记反馈处理状态"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    if not req or not req.status:
        return {"error": "缺少 status"}
    ok = update_feedback_status(feedback_id, req.status)
    return {"success": ok}


@app.get("/api/admin/stats")
async def admin_stats(authorization: str = Header(None)):
    """数据统计：学习进度分布等（遍历各用户 wordStates 聚合）"""
    if not _verify_admin(authorization):
        return {"error": "未授权"}
    phase_dist = {"learning": 0, "review": 0, "graduated": 0}
    total_states = 0
    users_with_states = 0
    for row in get_word_states_rows():
        try:
            states = json.loads(row["data_value"])
        except Exception:
            continue
        if not isinstance(states, dict):
            continue
        users_with_states += 1
        for state in states.values():
            if not isinstance(state, dict):
                continue
            total_states += 1
            ph = state.get("phase")
            if ph in phase_dist:
                phase_dist[ph] += 1
    # 趋势数据（图表）：近 30 天注册 / 近 14 天活跃 / 近 14 天查词与翻译
    def _fill_daily(days, data):
        out = []
        for i in range(days - 1, -1, -1):
            d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            out.append({"date": d[5:], "value": data.get(d, 0)})
        return out

    reg = _fill_daily(30, get_daily_counts("users", 30))
    act = _fill_daily(14, get_daily_counts("login_logs", 14))
    usage_raw = get_usage_daily_counts(14)
    usage = []
    for i in range(13, -1, -1):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        u = usage_raw.get(d, {})
        usage.append({"date": d[5:], "query": u.get("query", 0), "translate": u.get("translate", 0)})

    uv_raw = get_usage_daily_uv(14)
    uv = _fill_daily(14, uv_raw)
    active_hours = get_usage_hourly(14)
    heatmap = get_usage_heatmap(7)
    feedback_status = get_feedback_status_counts()

    return {
        "db": get_db_stats(),
        "users_with_states": users_with_states,
        "total_word_states": total_states,
        "phase_dist": phase_dist,
        "counters": dict(_runtime_stats),
        "trends": {
            "registration": reg,
            "active": act,
            "uv": uv,
            "usage": usage,
            "active_hours": active_hours,
            "heatmap": heatmap,
            "feedback_status": feedback_status,
        },
    }


# --- 启动 ---
if __name__ == "__main__":
    log_success(f"[startup] guzi listening on {HOST}:{PORT}, model={MODEL}, debug={DEBUG_ENABLED}")
    uvicorn.run(app, host=HOST, port=PORT)
