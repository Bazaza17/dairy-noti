"""
Smoke test — verifies the AMS page still has a findable PDF link
near "most recent issue" text, matching the extension's scraper logic.

Run manually before Wednesday or in CI:
    python scripts/smoke_test_ams.py
"""

import sys
import requests
from bs4 import BeautifulSoup

AMS_URL = "https://www.ams.usda.gov/rules-regulations/mmr/dmr"


def test_ams_scraper():
    print(f"Fetching {AMS_URL} ...")
    resp = requests.get(AMS_URL, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    pdf_url = None

    for text_node in soup.find_all(string=lambda t: t and "most recent issue" in t.lower()):
        container = text_node.parent
        for el in [container, container.parent if container else None]:
            if el is None:
                continue
            link = el.find("a", href=lambda h: h and h.endswith(".pdf"))
            if link:
                pdf_url = link["href"]
                if pdf_url.startswith("/"):
                    pdf_url = "https://www.ams.usda.gov" + pdf_url
                break
        if pdf_url:
            break

    assert pdf_url, (
        "FAIL: No PDF link found near 'most recent issue' — "
        "AMS may have changed their page layout. Update scrapeReportSignal() in background.js."
    )

    print(f"PASS: PDF link found -> {pdf_url}")
    return pdf_url


if __name__ == "__main__":
    try:
        test_ams_scraper()
        sys.exit(0)
    except AssertionError as e:
        print(e)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
