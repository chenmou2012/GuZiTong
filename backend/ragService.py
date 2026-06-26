import os
import json
import re
from rich.console import Console

# Rich 控制台
console = Console()

# 加载配置
_config_path = os.path.join(os.path.dirname(__file__), "config.json")
with open(_config_path, "r", encoding="utf-8") as f:
    _config = json.load(f)

POEMS_FILE = _config["rag"]["poems_file"]
RAG_LIMIT = _config["rag"]["limit"]
MAX_LINE_LENGTH = _config["rag"]["max_line_length"]


class ChineseRAG:
    def __init__(self, file_name: str = None):
        self.db = []
        if file_name:
            self.path = os.path.join(os.path.dirname(__file__), file_name)
        else:
            self.path = os.path.join(os.path.dirname(__file__), POEMS_FILE)
        self._load()

    def _load(self):
        if os.path.exists(self.path):
            try:
                with open(self.path, "r", encoding="utf-8") as f:
                    self.db = json.load(f)
                console.log(f"[green]RAG: 加载 {len(self.db)} 条数据[/green]")
            except Exception as e:
                console.log(f"[red]RAG: 加载错误 {e}[/red]")
        else:
            console.log(f"[yellow]RAG: 文件不存在 {self.path}[/yellow]")

    def query(self, word: str, limit: int = None) -> str:
        """检索包含指定字词的例句

        多样性策略：
        1. 先按 type（诗/词/曲/文言文）分桶，保证类型覆盖
        2. 每桶均匀轮转采样，避免同义项扎堆
        3. 桶内按 entry 顺序遍历取前 N 条
        """
        if not word or not self.db:
            return "暂无例句"

        limit = limit or RAG_LIMIT

        # 第一遍：按 type 分桶收集候选
        buckets = {}  # type -> [(line, title, author)]
        for item in self.db:
            content = item.get("content", "")
            lines = re.split(r"[，。？！；、\n\r]", content)
            type_ = item.get("type", "其他")
            title = item.get("title", "未知")
            author = item.get("author", "佚名")

            for line in lines:
                line = line.strip()
                if word in line and 0 < len(line) <= MAX_LINE_LENGTH:
                    info = f"{line}（《{title}》{author}）"
                    buckets.setdefault(type_, []).append(info)

        if not buckets:
            return "暂无例句"

        # 第二遍：桶间轮转采样，保证多样性
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
            # 所有桶都遍历完都没新内容，退出
            if not progress:
                break

        if not res:
            return "暂无例句"

        return "\n".join(res)


# 全局实例
rag = ChineseRAG()