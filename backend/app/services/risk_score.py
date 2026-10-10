"""风险评分引擎（FR-P0-20）：概率×影响→分数→等级，矩阵可配置（app_settings.risk.matrix）。"""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.setting import Setting

MATRIX_KEY = "risk.matrix"
DEFAULT_MATRIX = {
    "rows": [1, 2, 3, 4, 5],
    "cols": [1, 2, 3, 4, 5],
    "levels": {"low": 4, "medium": 9, "high": 25},
}


def load_matrix(db: Session) -> dict:
    setting = db.scalar(select(Setting).where(Setting.key == MATRIX_KEY))
    value = setting.value if setting and isinstance(setting.value, dict) else {}
    matrix = dict(DEFAULT_MATRIX)
    for key in ("rows", "cols", "levels"):
        if key in value:
            matrix[key] = value[key]
    return matrix


def evaluate(db: Session, probability: int, impact: int) -> tuple[int, str]:
    """返回 (score, level)。概率/影响 1-5。"""
    probability = max(1, min(5, int(probability)))
    impact = max(1, min(5, int(impact)))
    score = probability * impact
    matrix = load_matrix(db)
    levels = matrix.get("levels", DEFAULT_MATRIX["levels"])
    low_threshold = int(levels.get("low", 4))
    medium_threshold = int(levels.get("medium", 9))
    if score <= low_threshold:
        level = "低"
    elif score <= medium_threshold:
        level = "中"
    else:
        level = "高"
    return score, level