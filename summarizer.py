"""
Sends extracted table data to Claude.
Prompt instructs Claude to write:
  - A 2–3 paragraph trader-focused brief (market signal, notable moves, context)
  - Followed by a clean raw numbers section
Returns the full analysis text for DB logging.
"""

import anthropic
from config import settings

client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

SYSTEM_PROMPT = """You are a commodity market analyst specializing in CME dairy futures.
You receive parsed table data from the USDA AMS Dairy Mandatory Market Reporting midweek report.
Your output has two sections:

**BRIEF** (2-3 paragraphs):
Write a trader-focused analysis. Highlight notable price moves, spread changes between blocks and barrels,
butter signals, and any whey/NDM moves that imply demand shifts. Frame everything through the lens of
what a CME Class III/IV futures trader should watch this week.

**RAW NUMBERS**:
List every product with its weighted average price, range (low–high), and load count.
Format as clean bullet points.

Keep the BRIEF sharp and actionable. No fluff."""


def generate_brief(tables: dict, pdf_url: str) -> dict:
    table_str = "\n".join(
        f"{k}: avg={v['weighted_avg']}, low={v['low']}, high={v['high']}, loads={v['loads']}"
        for k, v in tables.items()
    )
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": f"Here is this week's midweek dairy data:\n\n{table_str}"}]
    )
    full_text = message.content[0].text
    return {"full_text": full_text}
