# Spend Tracker

Bank SMS on your iPhone → your home screen, sorted into categories. Free, no sign-up, no bank login.

**Set it up:** https://ismailwangde.github.io/spend-tracker/

## Where your data goes

**Phone version (default).** Nothing leaves your iPhone and your own iCloud Drive.
- One shortcut has three message triggers (“ebit”, “pent”, “ent Rs”). It drops OTP messages, then hands the SMS to Scriptable code inside the shortcut (`phone/core.js`), which reads it and saves it to *iCloud Drive › Scriptable › Spend Tracker*.
- Running the shortcut by hand installs or updates the Spend Tracker app in Scriptable (`phone/core.js` + `phone/app.js`) and opens it: the dashboard, plus the home-screen widget.
- No network requests are made with your data.

**Google Sheets version** (`sheets.html`, `script/`, `shortcuts/sheets/`). The SMS go to an Apps Script web app in your own Google account, attached to your own copy of the Sheet. It asks for one permission only, `spreadsheets.currentonly`.

The setup pages count visits and button taps with GoatCounter (no cookies, no personal data). After setup, the shortcut opens `ready.html` (or `connected.html`) once; that page view is how finished setups are counted. Nothing about your payments is ever sent.

## Files

| Path | What it is |
|---|---|
| `shortcuts/Spend Tracker.shortcut` | Phone version: SMS triggers + reading and saving SMS + installing the app |
| `phone/core.js` | Reading bank SMS, storage, categories, rules, monthly totals |
| `phone/app.js` | Dashboard and widget for Scriptable |
| `script/`, `shortcuts/sheets/` | Google Sheets version |
| `tools/make_shortcuts.py` | Builds and signs the shortcuts (`python3 tools/make_shortcuts.py` on a Mac) |

## License

MIT. Not affiliated with any bank, Google or Apple. Provided as-is, for personal use.
