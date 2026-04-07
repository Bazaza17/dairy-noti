import json
import datetime
import sqlite_utils

DB_PATH = "reports.db"


def get_db():
    return sqlite_utils.Database(DB_PATH)


def init_db():
    db = get_db()
    if "reports" not in db.table_names():
        db["reports"].create({
            "id": int,
            "url": str,
            "fetched_at": str,
            "raw_tables": str,   # JSON
            "full_summary": str
        }, pk="id")


def already_processed(url: str) -> bool:
    db = get_db()
    return db["reports"].count_where("url = ?", [url]) > 0


def log_report(url: str, tables: dict, summary: str):
    get_db()["reports"].insert({
        "url": url,
        "fetched_at": datetime.datetime.utcnow().isoformat(),
        "raw_tables": json.dumps(tables),
        "full_summary": summary
    })
