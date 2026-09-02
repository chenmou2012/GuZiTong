import os
import json
import re

from logger import log_info, log_warning, log_error

# 加载配置
_config_path = os.path.join(os.path.dirname(__file__), "config.json")
with open(_config_path, "r", encoding="utf-8") as f:
    _config = json.load(f)

POEMS_FILE = _config["rag"]["poems_file"]
RAG_LIMIT = _config["rag"]["limit"]
MAX_LINE_LENGTH = _config["rag"]["max_line_length"]
MISUSES_FILE = "common_misuses.json"


class ChineseRAG:
    """
    古诗文 RAG 检索

    P1-8: 启动时一次性建倒排索引 {字: [例句列表]}，查询走 O(1) 字典查找。
    原实现每次 query() 都全量扫描 6 万+ 条数据，150 词 × 多次查词 = 巨大 CPU 浪费。
    """

    def __init__(self, file_name: str = None):
        self.db = []
        self.misuses = {}  # 反例库：{字: [{wrong, correct, note}]}
        # 倒排索引：{字: [(line, title, author, type), ...]}
        # 与 db 分离，避免修改 db 影响其它调用方
        self._index = {}
        if file_name:
            self.path = os.path.join(os.path.dirname(__file__), file_name)
        else:
            self.path = os.path.join(os.path.dirname(__file__), POEMS_FILE)
        self._load()
        self._load_misuses()
        self._build_index()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self.db = json.load(f)
                log_info(f"[RAG] 加载 {len(self.db)} 条数据")
            except Exception as e:
                log_error(f"[RAG] 加载错误 {e}")
        else:
            log_warning(f"[RAG] 文件不存在 {self.path}")

    def _load_misuses(self):
        """加载常见误用反例库"""
        misuses_path = os.path.join(os.path.dirname(__file__), MISUSES_FILE)
        if os.path.exists(misuses_path):
            try:
                with open(misuses_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                # 剥离注释字段
                self.misuses = {k: v for k, v in data.items() if not k.startswith("_")}
                log_info(f"[RAG] 加载 {len(self.misuses)} 条反例")
            except Exception as e:
                log_error(f"[RAG] 反例库加载错误 {e}")
        else:
            log_warning(f"[RAG] 反例库不存在 {misuses_path}")

    def _build_index(self):
        """构建倒排索引：{字: [(line, title, author, type), ...]}

        对 db 中每条 content 用 [，。？！；、\n\r] 拆句，对每个非空短句
        按单字写入索引。同一字在同一例句中只记一次（避免重复占桶位）。
        """
        self._index = {}
        if not self.db:
            return

        for item in self.db:
            content = item.get("content", "")
            lines = re.split(r"[，。？！；、\n\r]", content)
            type_ = item.get("type", "其他")
            title = item.get("title", "未知")
            author = item.get("author", "佚名")

            for raw in lines:
                line = raw.strip()
                if not line or len(line) > MAX_LINE_LENGTH:
                    continue
                # 同一句去重加入每个单字的索引
                seen_chars = set(line)
                for ch in seen_chars:
                    # 仅索引中文字符（避免英文标点、数字、emoji 入索引）
                    if '一' <= ch <= '鿿':
                        bucket = self._index.get(ch)
                        if bucket is None:
                            bucket = []
                            self._index[ch] = bucket
                        bucket.append((line, title, author, type_))

        total = sum(len(v) for v in self._index.values())
        log_info(f"[RAG] 倒排索引建立：{len(self._index)} 个字，共 {total} 条例句映射")

    def query_misuses(self, word: str) -> str:
        """查询常见误用反例

        返回 Markdown 格式的避坑提示。如果没有命中则返回空串。
        """
        if not word or word not in self.misuses:
            return ""

        items = self.misuses[word]
        lines = [f"### 「{word}」常见误用避坑"]
        for i, item in enumerate(items, 1):
            lines.append(f"{i}. 误用：{item.get('wrong', '')}")
            lines.append(f"   正确：{item.get('correct', '')}")
            if item.get("note"):
                lines.append(f"   备注：{item['note']}")
        return "\n".join(lines)

    def query(self, word: str, limit: int = None) -> str:
        """检索包含指定字词的例句

        多样性策略（不变）：
        1. 先按 type（诗/词/曲/文言文）分桶，保证类型覆盖
        2. 每桶均匀轮转采样，避免同义项扎堆
        3. 桶内按 entry 顺序遍历取前 N 条

        P1-8: 数据源从 self.db 全量扫描改为 self._index[word] O(1) 查找。
        """
        if not word:
            return "暂无例句"

        limit = limit or RAG_LIMIT

        # 倒排索引查找：O(1)
        candidates = self._index.get(word)
        if not candidates:
            return "暂无例句"

        # 按 type 分桶
        buckets = {}
        for line, title, author, type_ in candidates:
            info = f"{line}（《{title}》{author}）"
            buckets.setdefault(type_, []).append(info)

        # 桶间轮转采样
        res = []
        types = list(buckets.keys())
        idx_per_type = {t: 0 for t in types}

        while len(res) < limit:
            progress = False
            for t in types:
                bucket = buckets[t]
                idx = idx_per_type[t]
                if idx < len(bucket):
                    candidate = bucket[idx]
                    if candidate not in res:
                        res.append(candidate)
                        progress = True
                    idx_per_type[t] = idx + 1
                    if len(res) >= limit:
                        break
            if not progress:
                break

        if not res:
            return "暂无例句"

        return "\n".join(res)


# 全局实例
rag = ChineseRAG()