"""
用户数据库模块 - SQLite

设计要点：
- 每个线程一个本地连接（threading.local 缓存），避免每次调用都开关连接
- busy_timeout=5000：写入竞争时最多等 5 秒，避免 OperationalError: database is locked
- WAL 模式：读写并发不互相阻塞
- cache_size=-20000：约 20MB 页缓存，提升读性能
"""
import sqlite3
import json
import os
import re
import threading
from datetime import datetime
from contextlib import contextmanager

from logger import log_warning, log_error

DB_PATH = os.path.join(os.path.dirname(__file__), "users.db")

# 允许的 data_type 值
ALLOWED_DATA_TYPES = {'learn', 'settings', 'progress', 'search'}
# 允许的 data_key 值
ALLOWED_DATA_KEYS = {
    'collections', 'history', 'translations',
    'learned_words', 'learnedWords', 'review_records',
    'reviewStats', 'wordStates',
    'learnOrder', 'preferences', 'theme',
    'wordCache',  # 查词结果缓存（避免重复调 AI）
    'translationCache'  # 翻译结果缓存（避免重复调 AI）
}

# 线程局部连接缓存：每个线程维护一个长连接，避免反复开关 + 反复执行 PRAGMA
# sqlite3 即使 check_same_thread=False，cursor 也不是线程安全的，必须 1 线程 1 连接
_local = threading.local()


def _open_connection():
    """新建并初始化一个 SQLite 连接（带全部 PRAGMA）"""
    conn = sqlite3.connect(
        DB_PATH,
        check_same_thread=False,
        # 5s 总等待：与 PRAGMA busy_timeout 配合，单次 SQL 也会等锁
        timeout=5.0,
    )
    conn.row_factory = sqlite3.Row
    # WAL 模式：读写并发不互相阻塞，提升多人同时使用时的延迟稳定性
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    # 关键：写入竞争时最多等 5 秒，避免 OperationalError: database is locked
    conn.execute("PRAGMA busy_timeout=5000")
    # 20MB 页缓存：相同 query 命中内存
    conn.execute("PRAGMA cache_size=-20000")
    # 外键约束
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """初始化数据库"""
    conn = _open_connection()
    try:
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

        # token 黑名单（撤销机制）：退出登录时写入，verify_token 时检查
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS revoked_tokens (
                token TEXT PRIMARY KEY,
                openid TEXT,
                revoked_at TEXT
            )
        """)
        # 撤销表加 openid 索引，便于定期清理某用户所有撤销记录
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_revoked_tokens_openid
            ON revoked_tokens(openid)
        """)

        # 索引：高频查询 (openid, data_type) 已有 UNIQUE 约束
        # user_data 的 (openid, data_type) 查询可用 UNIQUE 索引
        # 单查 data_type 的场景较少，不加额外索引避免写入开销

        # 用户反馈表（小程序提交 → 管理后台查看处理）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS feedbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                openid TEXT,
                nickname TEXT DEFAULT '',
                content TEXT NOT NULL,
                contact TEXT DEFAULT '',
                status TEXT DEFAULT 'new',
                created_at TEXT
            )
        """)
        # 反馈状态查询索引（管理后台按状态筛选）
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_feedbacks_status
            ON feedbacks(status)
        """)

        # 登录记录表（管理后台：最近上线时间 / IP 属地）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS login_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                openid TEXT NOT NULL,
                ip TEXT DEFAULT '',
                location TEXT DEFAULT '',
                created_at TEXT
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_login_logs_openid
            ON login_logs(openid)
        """)

        # 使用日志表（图表趋势：查词 / 翻译事件）
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS usage_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                openid TEXT,
                kind TEXT NOT NULL,
                created_at TEXT
            )
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_usage_logs_created
            ON usage_logs(created_at)
        """)

        conn.commit()
    finally:
        conn.close()


@contextmanager
def get_conn():
    """获取数据库连接（线程局部缓存，不关闭）"""
    conn = getattr(_local, 'conn', None)
    if conn is None:
        conn = _open_connection()
        _local.conn = conn
    try:
        yield conn
    # 注意：故意不 close()。长连接在进程退出时由 OS 回收。
    except Exception:
        # 异常时回滚未提交事务，但保留连接（下次复用）
        try:
            conn.rollback()
        except Exception:
            pass
        raise


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
        log_warning("[database] 无效的 openid")
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
        log_error(f"[database] 创建用户失败: {e}")
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
        log_error(f"[database] 更新token失败: {e}")
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
        log_error(f"[database] 更新用户信息失败: {e}")
        return False


def save_user_data(openid: str, data_type: str, data_key: str, data_value: str) -> bool:
    """保存用户数据"""
    # 验证输入
    if not validate_openid(openid):
        return False
    if not validate_data_type(data_type):
        log_warning(f"[database] 无效的 data_type: {data_type}")
        return False
    if not validate_data_key(data_key):
        log_warning(f"[database] 无效的 data_key: {data_key}")
        return False

    # None/非字符串 早退：json.loads(None) 抛 TypeError，不被 JSONDecodeError 捕获
    if data_value is None or not isinstance(data_value, str):
        log_warning(f"[database] data_value 必须是字符串, got {type(data_value).__name__}")
        return False

    # 验证 data_value 是有效的 JSON（兼容 TypeError/ValueError 以防御非字符串边界）
    try:
        json.loads(data_value)
    except (json.JSONDecodeError, TypeError, ValueError):
        log_warning("[database] 无效的 JSON 数据")
        return False

    # 限制数据大小（最大 1MB）
    if len(data_value) > 1024 * 1024:
        log_warning("[database] 数据过大")
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
        log_error(f"[database] 保存用户数据失败: {e}")
        return False


def get_user_data(openid: str, data_type: str = None) -> dict:
    """获取用户数据"""
    if not validate_openid(openid):
        return {}

    def _parse_legacy_safe(value: str):
        """解析 data_value，向后兼容历史上的双重 JSON 序列化数据"""
        parsed = json.loads(value)
        # 如果解析后仍是字符串，说明是老数据被双重 JSON 序列化（前端 JSON.stringify + 后端 json.dumps）
        if isinstance(parsed, str):
            try:
                parsed = json.loads(parsed)
            except json.JSONDecodeError:
                pass  # 不是 JSON 字符串则保持原样
        return parsed

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
                result[row["data_key"]] = _parse_legacy_safe(row["data_value"])
            else:
                if row["data_type"] not in result:
                    result[row["data_type"]] = {}
                result[row["data_type"]][row["data_key"]] = _parse_legacy_safe(row["data_value"])
        return result


def revoke_token(token: str, openid: str) -> bool:
    """撤销一个 token（logout 时调用）

    幂等：重复撤销同一个 token 不报错。
    """
    if not token:
        return False
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "INSERT OR IGNORE INTO revoked_tokens (token, openid, revoked_at) VALUES (?, ?, ?)",
                (token, openid, now)
            )
            conn.commit()
            return True
    except Exception as e:
        log_error(f"[database] 撤销 token 失败: {e}")
        return False


def is_token_revoked(token: str) -> bool:
    """检查 token 是否已被撤销"""
    if not token:
        return False
    with get_conn() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT 1 FROM revoked_tokens WHERE token = ?", (token,))
        return cursor.fetchone() is not None


def cleanup_revoked_tokens(older_than_iso: str) -> int:
    """清理早于指定时间的撤销记录（由后台定时任务调用）

    token 本身 30 天过期，过期后的撤销记录也无需保留。
    """
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM revoked_tokens WHERE revoked_at < ?",
                (older_than_iso,)
            )
            conn.commit()
            return cursor.rowcount
    except Exception as e:
        log_error(f"[database] 清理撤销记录失败: {e}")
        return 0


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
        log_error(f"[database] 删除用户数据失败: {e}")
        return False


# ==================== 用户反馈 ====================

FEEDBACK_STATUSES = {'new', 'processing', 'done'}


def add_feedback(openid: str, nickname: str, content: str, contact: str = '') -> bool:
    """新增一条用户反馈"""
    if not content or not isinstance(content, str) or not content.strip():
        log_warning("[database] 反馈内容不能为空")
        return False
    content = content.strip()[:2000]
    contact = (contact or '').strip()[:100]
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "INSERT INTO feedbacks (openid, nickname, content, contact, status, created_at) VALUES (?, ?, ?, ?, 'new', ?)",
                (openid, nickname, content, contact, now)
            )
            conn.commit()
            return True
    except Exception as e:
        log_error(f"[database] 添加反馈失败: {e}")
        return False


def get_feedbacks(status: str = None, page: int = 1, page_size: int = 20) -> dict:
    """分页查询反馈（status 为 None 查全部）"""
    page = max(1, int(page))
    page_size = min(100, max(1, int(page_size)))
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            if status and status in FEEDBACK_STATUSES:
                where, args = "WHERE status = ?", (status,)
            else:
                where, args = "", ()
            cursor.execute(f"SELECT COUNT(*) AS c FROM feedbacks {where}", args)
            total = cursor.fetchone()["c"]
            cursor.execute(
                f"SELECT * FROM feedbacks {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                args + (page_size, (page - 1) * page_size)
            )
            items = [dict(r) for r in cursor.fetchall()]
            return {"items": items, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        log_error(f"[database] 查询反馈失败: {e}")
        return {"items": [], "total": 0, "page": page, "page_size": page_size}


def update_feedback_status(feedback_id: int, status: str) -> bool:
    """更新反馈处理状态"""
    if status not in FEEDBACK_STATUSES:
        log_warning(f"[database] 无效的反馈状态: {status}")
        return False
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("UPDATE feedbacks SET status = ? WHERE id = ?", (status, feedback_id))
            conn.commit()
            return cursor.rowcount > 0
    except Exception as e:
        log_error(f"[database] 更新反馈状态失败: {e}")
        return False


# ==================== 管理后台 ====================

def add_login_log(openid: str, ip: str = '', location: str = '') -> bool:
    """记录一次登录（含 IP 与属地）"""
    if not openid:
        return False
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            now = datetime.now().isoformat()
            cursor.execute(
                "INSERT INTO login_logs (openid, ip, location, created_at) VALUES (?, ?, ?, ?)",
                (openid, (ip or '')[:64], (location or '')[:64], now)
            )
            conn.commit()
            return True
    except Exception as e:
        log_error(f"[database] 记录登录失败: {e}")
        return False


def get_login_logs(openid: str, limit: int = 10) -> list:
    """查询某用户最近登录记录（倒序）"""
    if not openid:
        return []
    limit = min(100, max(1, int(limit)))
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT id, ip, location, created_at FROM login_logs WHERE openid = ? ORDER BY id DESC LIMIT ?",
                (openid, limit)
            )
            return [dict(r) for r in cursor.fetchall()]
    except Exception as e:
        log_error(f"[database] 查询登录记录失败: {e}")
        return []

def get_user_list(page: int = 1, page_size: int = 20) -> dict:
    """分页查询用户列表（管理后台用）"""
    page = max(1, int(page))
    page_size = min(100, max(1, int(page_size)))
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) AS c FROM users")
            total = cursor.fetchone()["c"]
            cursor.execute(
                "SELECT openid, nickname, avatar, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (page_size, (page - 1) * page_size)
            )
            items = [dict(r) for r in cursor.fetchall()]
            return {"items": items, "total": total, "page": page, "page_size": page_size}
    except Exception as e:
        log_error(f"[database] 查询用户列表失败: {e}")
        return {"items": [], "total": 0, "page": page, "page_size": page_size}


def get_word_states_rows() -> list:
    """返回所有用户的 wordStates 原始行（学习统计用）"""
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT openid, data_value FROM user_data WHERE data_key = 'wordStates'"
            )
            return [dict(r) for r in cursor.fetchall()]
    except Exception as e:
        log_error(f"[database] 查询 wordStates 失败: {e}")
        return []


def get_db_stats() -> dict:
    """数据库基础统计（监控用）"""
    stats = {"users": 0, "user_data_rows": 0, "feedbacks": 0, "feedbacks_new": 0, "db_size_mb": 0}
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            stats["users"] = cursor.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
            stats["user_data_rows"] = cursor.execute("SELECT COUNT(*) AS c FROM user_data").fetchone()["c"]
            stats["feedbacks"] = cursor.execute("SELECT COUNT(*) AS c FROM feedbacks").fetchone()["c"]
            stats["feedbacks_new"] = cursor.execute("SELECT COUNT(*) AS c FROM feedbacks WHERE status = 'new'").fetchone()["c"]
        if os.path.exists(DB_PATH):
            stats["db_size_mb"] = round(os.path.getsize(DB_PATH) / 1024 / 1024, 2)
    except Exception as e:
        log_error(f"[database] 数据库统计失败: {e}")
    return stats


# ==================== 使用统计（图表趋势） ====================

def add_usage_log(openid: str, kind: str) -> bool:
    """记录一次使用事件（query / translate），供趋势图"""
    if kind not in ("query", "translate"):
        return False
    try:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO usage_logs (openid, kind, created_at) VALUES (?, ?, ?)",
                (openid, kind, datetime.now().isoformat())
            )
            conn.commit()
            return True
    except Exception as e:
        log_error(f"[database] 记录使用日志失败: {e}")
        return False


def cleanup_usage_logs(days: int = 90) -> int:
    """清理 N 天前的使用日志（控制表膨胀）"""
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM usage_logs WHERE created_at < ?", (cutoff,))
            conn.commit()
            return cursor.rowcount
    except Exception as e:
        log_error(f"[database] 清理使用日志失败: {e}")
        return 0


def get_daily_counts(table: str, days: int = 30) -> dict:
    """按天聚合计数（users / login_logs），返回 {date: count}（缺 0 的日期由调用方补齐）"""
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            if table == "users":
                cursor.execute(
                    "SELECT date(created_at) AS d, COUNT(*) AS c FROM users WHERE created_at >= ? GROUP BY d",
                    (cutoff,))
            elif table == "login_logs":
                cursor.execute(
                    "SELECT date(created_at) AS d, COUNT(*) AS c FROM login_logs WHERE created_at >= ? GROUP BY d",
                    (cutoff,))
            else:
                return {}
            return {r["d"]: r["c"] for r in cursor.fetchall()}
    except Exception as e:
        log_error(f"[database] 聚合 {table} 失败: {e}")
        return {}


def get_usage_daily_counts(days: int = 14) -> dict:
    """按天聚合 usage_logs，返回 {date: {"query": n, "translate": n}}"""
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = {}
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT date(created_at) AS d, kind, COUNT(*) AS c FROM usage_logs WHERE created_at >= ? GROUP BY d, kind",
                (cutoff,))
            for r in cursor.fetchall():
                result.setdefault(r["d"], {})[r["kind"]] = r["c"]
    except Exception as e:
        log_error(f"[database] 聚合 usage_logs 失败: {e}")
    return result


def get_usage_hourly(days: int = 14) -> list:
    """近 N 天 usage_logs 按小时聚合，返回 24 长度数组（0-23 点）"""
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    hours = [0] * 24
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT CAST(strftime('%H', created_at) AS INTEGER) AS h, COUNT(*) AS c "
                "FROM usage_logs WHERE created_at >= ? GROUP BY h",
                (cutoff,))
            for r in cursor.fetchall():
                hours[r["h"]] = r["c"]
    except Exception as e:
        log_error(f"[database] 聚合小时分布失败: {e}")
    return hours


def get_usage_heatmap(days: int = 7) -> list:
    """近 N 天 × 24h 活跃热力图数据，返回 [{date, hours:[24 值]}]（按日期升序）"""
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    raw = {}
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT date(created_at) AS d, CAST(strftime('%H', created_at) AS INTEGER) AS h, COUNT(*) AS c "
                "FROM usage_logs WHERE created_at >= ? GROUP BY d, h",
                (cutoff,))
            for r in cursor.fetchall():
                raw.setdefault(r["d"], {})[r["h"]] = r["c"]
    except Exception as e:
        log_error(f"[database] 聚合热力图失败: {e}")
    out = []
    for i in range(days - 1, -1, -1):
        d = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        row = raw.get(d, {})
        out.append({"date": d[5:], "hours": [row.get(h, 0) for h in range(24)]})
    return out


def get_usage_daily_uv(days: int = 14) -> dict:
    """近 N 天每日活跃用户数（usage_logs 按天去重 openid）"""
    from datetime import timedelta
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    result = {}
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT date(created_at) AS d, COUNT(DISTINCT openid) AS c FROM usage_logs WHERE created_at >= ? GROUP BY d",
                (cutoff,))
            for r in cursor.fetchall():
                result[r["d"]] = r["c"]
    except Exception as e:
        log_error(f"[database] 聚合日活跃用户失败: {e}")
    return result


def get_feedback_status_counts() -> dict:
    """反馈状态分布 {new, processing, done}"""
    result = {"new": 0, "processing": 0, "done": 0}
    try:
        with get_conn() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT status, COUNT(*) AS c FROM feedbacks GROUP BY status")
            for r in cursor.fetchall():
                if r["status"] in result:
                    result[r["status"]] = r["c"]
    except Exception as e:
        log_error(f"[database] 聚合反馈状态失败: {e}")
    return result


# 初始化数据库
init_db()