import os
import time
from rich.console import Console
from rich.theme import Theme

custom_theme = Theme({
    "info": "cyan",
    "success": "green",
    "warning": "yellow",
    "error": "red bold",
    "debug": "dim",
    "time": "dim",
})
console = Console(theme=custom_theme)
DEBUG_ENABLED = os.getenv("DEBUG") == "1"


def _t():
    return time.strftime('%H:%M:%S')


def log_debug(msg):
    if not DEBUG_ENABLED:
        return
    console.log(f"[time]{_t()}[/time] [debug]{msg}[/debug]")


def log_info(msg):
    console.log(f"[time]{_t()}[/time] [info]{msg}[/info]")


def log_success(msg):
    console.log(f"[time]{_t()}[/time] [success]{msg}[/success]")


def log_warning(msg):
    console.log(f"[time]{_t()}[/time] [warning]{msg}[/warning]")


def log_error(msg):
    console.log(f"[time]{_t()}[/time] [error]{msg}[/error]")