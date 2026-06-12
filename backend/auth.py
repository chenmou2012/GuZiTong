"""
微信登录认证模块
"""
import json
import os
import httpx
import secrets
from datetime import datetime, timedelta

_config_path = os.path.join(os.path.dirname(__file__), "config.json")
with open(_config_path, "r", encoding="utf-8") as f:
    _config = json.load(f)

WECHAT_APPID = _config["wechat"]["appid"]
WECHAT_SECRET = _config["wechat"]["secret"]

# Token 有效期（天）
TOKEN_EXPIRE_DAYS = 30


def generate_token():
    """生成随机 token"""
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
            return {
                "success": False,
                "errcode": data.get("errcode", -1),
                "errmsg": data.get("errmsg", "未知错误")
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
    """验证 token 是否有效，返回 (openid, 是否有效)"""
    from database import get_user_by_token

    user = get_user_by_token(token)
    if not user:
        return None, False

    # 检查是否过期
    expire_time = datetime.fromisoformat(user["expire_time"])
    if datetime.now() > expire_time:
        return None, False

    return user["openid"], True