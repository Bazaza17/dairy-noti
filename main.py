"""
APScheduler runs check_for_new_report() every N minutes,
but only on Wednesdays between 11 AM and 1 PM Central.
"""
import asyncio
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from config import settings
from watcher import check_for_new_report
from db import init_db


def run_check():
    asyncio.run(check_for_new_report())


if __name__ == "__main__":
    init_db()
    scheduler = BlockingScheduler(timezone=settings.timezone)
    scheduler.add_job(
        run_check,
        CronTrigger(
            day_of_week="wed",
            hour=f"{settings.target_hour_start}-{settings.target_hour_end}",
            minute=f"*/{settings.check_interval_minutes}",
            timezone=settings.timezone
        )
    )
    print("Dairy watcher started. Monitoring every Wednesday 11 AM–1 PM Central.")
    scheduler.start()
