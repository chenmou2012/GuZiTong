"""
用户数据库模块 - SQLite
"""
import sqlite3
import json
import os
import re
from datetime import datetime
from contextlib import contextmanager

DB_PATH = os.path.join(os.path.dirname(__file__), "users.db")

# 允许的 data_type 值
ALLOWED_DATA_TYPES = {'learn', 'settings', 'progress'}
# 允许的 data_key 值
ALLOWED_DATA_KEYS = {
    'collections', 'history', 'translations',
    'learned_words', 'review_records',
    'preferences', 'theme'
}


def init_db():
    """初始化数据库"""
    with get_conn() as conn:
        cursor = conn.cursor()

        # 用户表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                openid TEXT PRIMARY KEY,
                token TEXT UNIQUE,
                expire_time TEXT,
                nickname TEXT,
                avatar TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # 学习数据表
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                openid TEXT,
                data_type TEXT,
                data_key TEXT,
                data_value TEXT,
                updated_at TEXT,
                UNIQUE(openid, data_type, data_key)
            )
        """)

        conn.commit()


@contextmanager
def get_conn():
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def validate_openid(openid: str) -> bool:
    """验证 openid 格式"""
    if not openid or not isinstance(openid, str):
        return False
    # 微信 openid 通常以 o 开头，长度 28 左右
    return bool(re.match(r'^o[a-zA-Z0-9_-]{20,30}$', openid))


def validate_data_type(data_type: str) -> bool:
    """验证 data_type"""
    return data_type in ALLOWED_DATA_TYPES


def validate_data_key(data_key: str) -> bool:
    """验证 data_key"""
    return data_key in ALLOWED_DATA_KEYS


def create_user(openid: str, token: str, expire_time: str) -> bool:
    """创建新用户"""
    if not validate_openid(openid):
        print("无效的 openid")
        return False

    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "INSERT INTO users (openid, token, expire_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (openid, token, expire_time, now, now)
            )
            conn.commit()
            return True
    except Exception as e:
        print(f"创建用户失败: {e}")
        return False


def get_user_by_openid(openid: str) -> dict:
    """根据 openid 获取用户"""
    if not validate_openid(openid):
        return None

    with get_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE openid = ?", (openid,))
        row = cursor.fetchone()
        return dict(row) if row else None


def get_user_by_token(token: str) -> dict:
    """根据 token 获取用户"""
    if not token or len(token) < 20:
        return None

    with get_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE token = ?", (token,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_user_token(openid: str, token: str, expire_time: str) -> bool:
    """更新用户 token"""
    if not validate_openid(openid):
        return False

    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "UPDATE users SET token = ?, expire_time = ?, updated_at = ? WHERE openid = ?",
                (token, expire_time, now, openid)
            )
            conn.commit()
            return True
    except Exception as e:
        print(f"更新token失败: {e}")
        return False


def update_user_info(openid: str, nickname: str = None, avatar: str = None) -> bool:
    """更新用户信息"""
    if not validate_openid(openid):
        return False

    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()

            # 限制昵称长度，防止过载
            if nickname:
                nickname = nickname[:50]  # 最多50字符

            if nickname:
                cursor.execute(
                    "UPDATE users SET nickname = ?, updated_at = ? WHERE openid = ?",
                    (nickname, now, openid)
                )
            if avatar:
                cursor.execute(
                    "UPDATE users SET avatar = ?, updated_at = ? WHERE openid = ?",
                    (avatar, now, openid)
                )
            conn.commit()
            return True
    except Exception as e:
        print(f"更新用户信息失败: {e}")
        return False


def save_user_data(openid: str, data_type: str, data_key: str, data_value: str) -> bool:
    """保存用户数据"""
    # 验证输入
    if not validate_openid(openid):
        return False
    if not validate_data_type(data_type):
        print(f"无效的 data_type: {data_type}")
        return False
    if not validate_data_key(data_key):
        print(f"无效的 data_key: {data_key}")
        return False

    # 验证 data_value 是有效的 JSON
    try:
        json.loads(data_value)
    except json.JSONDecodeError:
        print("无效的 JSON 数据")
        return False

    # 限制数据大小（最大 1MB）
    if len(data_value) > 1024 * 1024:
        print("数据过大")
        return False

    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                """INSERT OR REPLACE INTO user_data
                (openid, data_type, data_key, data_value, updated_at)
                VALUES (?, ?, ?, ?, ?)""",
                (openid, data_type, data_key, data_value, now)
            )
            conn.commit()
            return True
    except Exception as e:
        print(f"保存用户数据失败: {e}")
        return False


def get_user_data(openid: str, data_type: str = None) -> dict:
    """获取用户数据"""
    if not validate_openid(openid):
        return {}

    with get_conn() as conn:
        cursor = conn.cursor()
        if data_type:
            if not validate_data_type(data_type):
                return {}
            cursor.execute(
                "SELECT data_key, data_value FROM user_data WHERE openid = ? AND data_type = ?",
                (openid, data_type)
            )
        else:
            cursor.execute(
                "SELECT data_type, data_key, data_value FROM user_data WHERE openid = ?",
                (openid,)
            )

        rows = cursor.fetchall()
        result = {}
        for row in rows:
            if data_type:
                result[row["data_key"]] = json.loads(row["data_value"])
            else:
                if row["data_type"] not in result:
                    result[row["data_type"]] = {}
                result[row["data_type"]][row["data_key"]] = json.loads(row["data_value"])
        return result


def delete_user_data(openid: str, data_type: str = None, data_key: str = None) -> bool:
    """删除用户数据"""
    if not validate_openid(openid):
        return False

    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            if data_type and data_key:
                if not validate_data_type(data_type) or not validate_data_key(data_key):
                    return False
                cursor.execute(
                    "DELETE FROM user_data WHERE openid = ? AND data_type = ? AND data_key = ?",
                    (openid, data_type, data_key)
                )
            elif data_type:
                if not validate_data_type(data_type):
                    return False
                cursor.execute(
                    "DELETE FROM user_data WHERE openid = ? AND data_type = ?",
                    (openid, data_type)
                )
            else:
                cursor.execute(
                    "DELETE FROM user_data WHERE openid = ?",
                    (openid,)
                )
            conn.commit()
            return True
    except Exception as e:
        print(f"删除用户数据失败: {e}")
        return False


# 初始化数据库
init_db()