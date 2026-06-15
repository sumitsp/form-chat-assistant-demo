from sqlalchemy import text
from backend.connections.db import get_engine

eng = get_engine()
with eng.connect() as conn:
    n = conn.execute(text(
        "SELECT COUNT(*) FROM map_ltv_matrix "
        "WHERE special_overlays IS NOT NULL AND TRIM(special_overlays) <> ''"
    )).scalar()
    print("rows with special_overlays:", n)
    rows = conn.execute(text(
        "SELECT DISTINCT special_overlays FROM map_ltv_matrix "
        "WHERE special_overlays IS NOT NULL AND TRIM(special_overlays) <> '' LIMIT 8"
    )).fetchall()
    for r in rows:
        print(" •", repr(r[0])[:160])
