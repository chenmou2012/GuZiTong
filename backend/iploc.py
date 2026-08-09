# -*- coding: utf-8 -*-
"""
IP 属地查询：ip2region xdb v3.0+（IPv4/IPv6 双支持格式，内存模式，纯标准库）
数据文件：data/ip2region_v4.xdb

xdb v3 格式要点（对照官方 binding/python/ip2region）：
- HeaderInfoLength = 256；vector index = 256×256 网格（覆盖 IP 前两字节），
  项偏移 idx = i0*256*8 + i1*8，每项 8 字节（s_ptr + e_ptr）
- segment index 每条 14 字节：startIP(4) + endIP(4) + dataLen(2) + dataPtr(4)
- segment 内 IP 为小端存储，与输入（大端 bytes）比较时反向遍历
"""
import os
import socket

_xdb_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "ip2region_v4.xdb")
_buf = None

HEADER_INFO_LENGTH = 256
VECTOR_INDEX_COLS = 256
VECTOR_INDEX_SIZE = 8
SEGMENT_INDEX_SIZE = 14


def _load() -> bytes:
    global _buf
    if _buf is None:
        if os.path.exists(_xdb_path):
            with open(_xdb_path, "rb") as f:
                _buf = f.read()
    return _buf


def _le_u32(buf: bytes, offset: int) -> int:
    return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24))


def _le_u16(buf: bytes, offset: int) -> int:
    return buf[offset] | (buf[offset + 1] << 8)


def _cmp_v4(ip_bytes: bytes, buf: bytes, offset: int) -> int:
    """ip 输入为大端 bytes；segment 内 IP 为小端存储，反向比较"""
    j = offset + 3
    for i in range(4):
        b1 = ip_bytes[i]
        b2 = buf[j]
        if b1 < b2:
            return -1
        if b1 > b2:
            return 1
        j -= 1
    return 0


def query(ip_str: str) -> str:
    """查询 IP 完整属地，返回如 '中国|0|湖北|武汉|电信'；失败返回空字符串"""
    if not ip_str:
        return ""
    buf = _load()
    if not buf:
        return ""
    ip_str = ip_str.strip()
    try:
        ip_bytes = socket.inet_aton(ip_str)
    except OSError:
        return ""
    try:
        # vector index 定位 segment 区间（按 IP 前两字节）
        idx = HEADER_INFO_LENGTH + ip_bytes[0] * VECTOR_INDEX_COLS * VECTOR_INDEX_SIZE + ip_bytes[1] * VECTOR_INDEX_SIZE
        s_ptr = _le_u32(buf, idx)
        e_ptr = _le_u32(buf, idx + 4)
        if s_ptr == 0 or e_ptr == 0:
            return ""
        # segment index 二分
        low, high = 0, (e_ptr - s_ptr) // SEGMENT_INDEX_SIZE
        while low <= high:
            mid = (low + high) >> 1
            p = s_ptr + mid * SEGMENT_INDEX_SIZE
            if _cmp_v4(ip_bytes, buf, p) < 0:
                high = mid - 1
            elif _cmp_v4(ip_bytes, buf, p + 4) > 0:
                low = mid + 1
            else:
                d_len = _le_u16(buf, p + 8)
                d_ptr = _le_u32(buf, p + 10)
                return buf[d_ptr:d_ptr + d_len].decode("utf-8", "ignore")
    except Exception:
        pass
    return ""


def query_cn(ip_str: str) -> str:
    """返回精简属地（省·市），如 '湖北·武汉'；非中国返回国家名；未知返回空字符串"""
    raw = query(ip_str)
    if not raw:
        return ""
    parts = raw.split("|")
    country = parts[0] if parts else ""
    province = parts[2] if len(parts) > 2 and parts[2] and parts[2] != "0" else ""
    city = parts[3] if len(parts) > 3 and parts[3] and parts[3] != "0" else ""
    if country == "中国":
        if city and city != province:
            return f"{province}·{city}"
        return province or "中国"
    return country or ""
