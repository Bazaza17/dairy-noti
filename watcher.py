"""
1. Scrape AMS Dairy MMR page for the latest midweek PDF link
2. Check if we've already processed this report (by URL in DB)
3. If new: download PDF → parse → summarize → SMS → log
"""

import httpx
from bs4 import BeautifulSoup
import db
import parser
import summarizer

AMS_URL = "https://www.ams.usda.gov/rules-regulations/mmr/dmr"
PDF_URL = "https://www.ams.usda.gov/mnreports/dywdairyproductssales.pdf"


async def scrape_latest_pdf_url(page_url: str) -> str | None:
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        response = await client.get(page_url)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    candidates = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        parent_text = a.parent.get_text().lower() if a.parent else ""
        if href.endswith(".pdf") and "most recent issue" in parent_text:
            if href.startswith("/"):
                href = "https://www.ams.usda.gov" + href
            candidates.append(href)

    if not candidates:
        return None
    # Return the last one found (most recent listed)
    return candidates[-1]


async def download_pdf(url: str) -> bytes:
    async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.content


async def check_for_new_report():
    db.init_db()
    pdf_url = PDF_URL
    if db.already_processed(pdf_url):
        print(f"Already processed today's report.")
        return
    print(f"Attempting to fetch report: {pdf_url}")
    try:
        pdf_bytes = await download_pdf(pdf_url)
    except Exception as e:
        print(f"Could not fetch PDF: {e}")
        return
    tables = parser.extract_tables(pdf_bytes)
    if not tables:
        print("Warning: no commodity data extracted from PDF.")
    summary = summarizer.generate_brief(tables, pdf_url)
    db.log_report(pdf_url, tables, summary["full_text"])
    print("Report processed, SMS sent, and logged to DB.")

if __name__ == "__main__":
    import asyncio
    asyncio.run(check_for_new_report())