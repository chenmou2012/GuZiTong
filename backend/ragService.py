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
        """检索包含指定字词的例句"""
        if not word or not self.db:
            return "暂无例句"

        limit = limit or RAG_LIMIT
        res = []

        for item in self.db:
            content = item.get("content", "")
            lines = re.split(r"[，。？！；、\n\r]", content)

            for line in lines:
                line = line.strip()
                if word in line and 0 < len(line) <= MAX_LINE_LENGTH:
                    title = item.get("title", "未知")
                    author = item.get("author", "佚名")
                    info = f"{line}（《{title}》{author}）"

                    if info not in res:
                        res.append(info)

                if len(res) >= limit:
                    break
            if len(res) >= limit:
                break

        if not res:
            return "暂无例句"

        return "\n".join(res)


# 全局实例
rag = ChineseRAG()