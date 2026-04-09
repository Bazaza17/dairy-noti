# dairy-noti

A Chrome extension that monitors the USDA AMS National Dairy Products Sales Report page and alerts a commodity trader the moment the weekly midweek PDF goes live every Wednesday between 11am and 1pm CT.

When the report is detected, the extension opens the PDF automatically, fires a desktop notification, sends the full document to Claude for analysis, and displays a structured price comparison summary in the extension popup.

---

## How It Works

### Detection

The service worker registers a Chrome alarm that fires every minute. During the active window (Wednesday, 11am-1pm CT), it falls back to a tighter `setTimeout` chain polling at 15-second intervals.

Each poll fetches the USDA AMS page and computes a SHA-256 hash of the first 16KB of the PDF response. The extension stores the last-seen hash in `chrome.storage.local`. When the hash changes, the report is treated as new and live.

### On Detection

1. The PDF URL is opened in a new Chrome tab.
2. A desktop notification fires via the Chrome Notifications API.
3. The full PDF binary is fetched and base64-encoded, then sent to the Claude API (`claude-opus-4-5` or similar) with a structured prompt.
4. Claude returns a week-over-week comparison table (weighted avg price, net change, % change for all products) and a one-sentence market callout.
5. The response is stored in `chrome.storage.local` and rendered on the summary page.

### Popup States

The extension popup shows one of three states based on the current time and detection status:

- **Outside Window** - it is not Wednesday between 11am-1pm CT
- **Watching** - inside the active window, polling in progress
- **Report Live** - a new PDF has been detected this session

The popup also surfaces the last-checked timestamp, the time the report was detected, and buttons to open the latest report or view the Claude-generated market summary.

---

## Setup

### 1. Add your Anthropic API key

Create (or edit) `dairy-extension/config.js`:

```js
const ANTHROPIC_API_KEY = 'sk-ant-...';
```

This file is gitignored. Do not commit your key.

### 2. Load the extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dairy-extension/` folder

The extension icon will appear in the toolbar. Click it to see the current status.

---

## Project Structure

```
dairy-noti/
├── dairy-extension/          # Chrome extension (Manifest V3)
│   ├── manifest.json         # MV3 manifest: permissions, service worker, popup
│   ├── background.js         # Service worker: alarm polling, fingerprinting, Claude API call
│   ├── popup.html            # Extension popup markup
│   ├── popup.js              # Popup logic: status display, button handlers
│   ├── summary.html          # Dark-theme summary page
│   ├── summary.js            # Renders Claude comparison table with color-coded changes
│   ├── config.js             # API key (gitignored)
│   └── icons/                # Extension icons (16, 48, 128px)
│
├── watcher.py                # APScheduler-based PDF watcher
├── parser.py                 # pdfplumber extraction logic
├── summarizer.py             # Anthropic API summarization
├── db.py                     # SQLite logging via sqlite-utils
├── main.py                   # Entry point
├── config.py                 # Environment/config loader
├── Procfile                  # Railway process definition
└── requirements.txt          # Python dependencies
```

### Extension permissions

Declared in `manifest.json`:

| Permission | Purpose |
|---|---|
| `alarms` | Minute-interval polling outside the active window |
| `notifications` | Desktop alert on report detection |
| `storage` | Persist last hash, detection time, and Claude output |
| `tabs` | Open the PDF in a new tab |
| `scripting` | Reserved for future in-page injection |

Host permissions cover `https://www.ams.usda.gov/*` (polling target) and `https://api.anthropic.com/*` (Claude API calls from the service worker).

---

## Summary Page

The summary page (`summary.html`) opens via the "View Market Summary" button in the popup. It renders on a dark background with a card-row layout:

- One row per dairy product
- Green/red color coding for positive/negative weekly change
- Magnitude bars scaled to the size of the move
- One-sentence market callout pulled from the Claude response at the top

---

## Part B: Railway Backend (in progress)

The Python backend at the project root is a server-side counterpart to the extension, intended for deployment on Railway. It replicates the detection and summarization pipeline without requiring a browser session to be open.

Current status: foundation complete, not yet deployed.

Planned capabilities:
- Scheduled polling via APScheduler
- PDF parsing with pdfplumber
- Summarization via the Anthropic SDK
- Run logging to SQLite
- SMS/push delivery via Twilio (dependency included)

To run locally:

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

A `.env` file with `ANTHROPIC_API_KEY` (and optionally Twilio credentials) is expected at the project root.

---

## Notes

- The extension makes direct API calls to `api.anthropic.com` from the service worker. No proxy or backend is required for the extension to function.
- Polling only activates on Wednesdays within the configured CT window. Outside that window the alarm is registered but the heavy polling loop does not start.
- The PDF fingerprint is keyed on the SHA-256 of the first 16KB of the response body, which is stable across CDN variations in headers or metadata.
