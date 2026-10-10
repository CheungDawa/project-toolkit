"""统一日志初始化（T1-03）。"""
import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        stream=sys.stdout,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )
    # 降噪音：uvicorn 自身已有访问日志格式
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
