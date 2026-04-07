"""
Uses pdfplumber to extract tables from the AMS midweek dairy PDF.
AMS PDFs follow a consistent columnar format:
  Product | Weighted Avg Price | Low Price | High Price | # of Loads
"""

import pdfplumber
import io

PRODUCTS_OF_INTEREST = [
    "cheddar", "barrel", "butter", "dry whey",
    "nonfat dry milk", "NDM", "AA butter"
]


def extract_tables(pdf_bytes: bytes) -> dict:
    results = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table in tables:
                for row in table:
                    if row and any(p.lower() in str(row[0]).lower()
                                   for p in PRODUCTS_OF_INTEREST):
                        results[row[0]] = {
                            "weighted_avg": row[1],
                            "low": row[2],
                            "high": row[3],
                            "loads": row[4] if len(row) > 4 else "N/A"
                        }
    return results


def test_extract(pdf_path: str):
    """Accept a local PDF path and print extracted tables."""
    with open(pdf_path, "rb") as f:
        pdf_bytes = f.read()
    tables = extract_tables(pdf_bytes)
    if not tables:
        print("No matching products found.")
        return
    for product, data in tables.items():
        print(f"{product}:")
        print(f"  Weighted Avg: {data['weighted_avg']}")
        print(f"  Low:          {data['low']}")
        print(f"  High:         {data['high']}")
        print(f"  Loads:        {data['loads']}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 2:
        print("Usage: python parser.py <path/to/report.pdf>")
        sys.exit(1)
    test_extract(sys.argv[1])
