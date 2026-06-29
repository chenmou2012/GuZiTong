"""
微信登录认证模块
"""
import json
import os
import httpx
import secrets
from datetime import datetime, timedelta

from logger import log_warning, log_error, log_info

_config_path = os.path.join(os.path.dirname(__file__), "config.json")
with open(_config_path, "r", encoding="utf-8") as f:
    _config = json.load(f)

WECHAT_APPID = _config["wechat"]["appid"]
WECHAT_SECRET = _config["wechat"]["secret"]

# Token 有效期（天）
TOKEN_EXPIRE_DAYS = 30
# WebSocket 一次性 ticket 有效期（秒）：30s 内未用则失效
WS_TICKET_EXPIRE_SECONDS = 30


def generate_token():
    """生成随机 token（43 字符 URL-safe）"""
    return secrets.token_urlsafe(32)


async def code2session(code: str) -> dict:
    """调用微信 code2Session 接口"""
    url = "https://api.weixin.qq.com/sns/jscode2session"
    params = {
        "appid": WECHAT_APPID,
        "secret": WECHAT_SECRET,
        "js_code": code,
        "grant_type": "authorization_code"
    }

    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params)
        data = resp.json()

        if "openid" in data:
            return {
                "success": True,
                "openid": data["openid"],
                "session_key": data.get("session_key", "")
            }
        else:
            errcode = data.get("errcode", -1)
            errmsg = data.get("errmsg", "未知错误")
            log_warning(f"[auth.code2session] errcode={errcode}, errmsg={errmsg}")
            return {
                "success": False,
                "errcode": errcode,
                "errmsg": errmsg
            }


def create_token(openid: str) -> dict:
    """为用户创建 token"""
    token = generate_token()
    expire_time = datetime.now() + timedelta(days=TOKEN_EXPIRE_DAYS)

    return {
        "token": token,
        "openid": openid,
        "expire_time": expire_time.isoformat(),
        "expire_days": TOKEN_EXPIRE_DAYS
    }


def verify_token(token: str) -> tuple:
    """验证 token 是否有效，返回 (openid, 是否有效)

    检查顺序：
    1. 数据库里查不到 → 无效
    2. 黑名单里 → 无效（已被撤销）
    3. 过期 → 无效
    4. 都通过 → 有效
    """
    from database import get_user_by_token, is_token_revoked

    user = get_user_by_token(token)
    if not user:
        return None, False

    # 黑名单检查（数据库查询，单次 < 1ms）
    if is_token_revoked(token):
        log_info(f"[auth.verify_token] token 已被撤销 openid={user['openid']}")
        return None, False

    # 检查是否过期 - 支持时间戳和iso格式
    expire_val = user["expire_time"]
    try:
        if isinstance(expire_val, (int, float)):
            expire_time = datetime.fromtimestamp(expire_val)
        else:
            expire_time = datetime.fromisoformat(str(expire_val))
    except (ValueError, TypeError, OverflowError) as e:
        log_warning(f"[auth.verify_token] expire_time 解析失败: {e}")
        return None, False

    if datetime.now() > expire_time:
        return None, False

    return user["openid"], True


# ==================== WS 一次性 Ticket ====================
# 内存存储：{ticket: (openid, expire_at)}
# 不持久化：进程重启后失效（客户端必须重新换 ticket）
_ws_tickets: dict = {}


def create_ws_ticket(openid: str) -> str:
    """为已登录用户创建一次性 WS ticket（30s 有效）

    目的：让 token 永远不出现在 URL/Nginx 日志里。
    客户端拿到 ticket 后立刻连 WS，第一帧可发可不发鉴权消息。
    """
    ticket = secrets.token_urlsafe(24)
    expire_at = datetime.now().timestamp() + WS_TICKET_EXPIRE_SECONDS
    _ws_tickets[ticket] = (openid, expire_at)
    # 顺手清理已过期的 ticket，避免字典无限增长
    _cleanup_expired_tickets()
    log_info(f"[auth.create_ws_ticket] openid={openid}, ttl={WS_TICKET_EXPIRE_SECONDS}s")
    return ticket


def consume_ws_ticket(ticket: str) -> tuple:
    """消费（一次性使用）一个 WS ticket

    返回 (openid, valid)。消费后 ticket 立即失效，
    防止被重放。
    """
    if not ticket:
        return None, False

    # 顺手清理过期 ticket，避免无人换 ticket 时字典无限增长
    _cleanup_expired_tickets()

    entry = _ws_tickets.pop(ticket, None)  # pop 即一次性
    if entry is None:
        return None, False

    openid, expire_at = entry
    if datetime.now().timestamp() > expire_at:
        return None, False

    return openid, True


def _cleanup_expired_tickets():
    """清理过期 ticket"""
    now = datetime.now().timestamp()
    expired = [t for t, (_, exp) in _ws_tickets.items() if exp <= now]
    for t in expired:
        _ws_tickets.pop(t, None)


# ==================== Logout ====================

def revoke_user_token(token: str, openid: str) -> bool:
    """撤销 token（logout 时调用）

    把 token 加入黑名单。后续 verify_token 会拒绝。
    """
    from database import revoke_token
    ok = revoke_token(token, openid)
    if ok:
        log_info(f"[auth.revoke_user_token] openid={openid}")
    return ok