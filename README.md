# Spend Tracker

Bank SMS on your iPhone → your own Google Sheet, sorted into categories. Free, no app, no bank login.

**Set it up:** https://ismailwangde.github.io/spend-tracker/

## Where your data goes

- Your bank SMS go from your iPhone to a Google Apps Script web app that runs **in your own Google account**, attached to **your own copy** of the Sheet. Nothing is sent to anyone else.
- The script asks for one permission only, `spreadsheets.currentonly` (see `script/appsscript.json`): it can open the spreadsheet it's attached to and nothing else. No Gmail, no Drive, no network calls.
- OTP messages are dropped by the shortcut on the phone, and again by the script.
- The web app needs a connection code, created the first time you run the shortcut and stored on your phone.

## Files

| Path | What it is |
|---|---|
| `script/Code.gs`, `script/appsscript.json` | The Apps Script inside the template Sheet |
| `shortcuts/Spend Tracker.shortcut` | Connects once, then logs SMS (from the automation) or a cash amount (run by hand) |
| `shortcuts/Spend Tracker Auto.shortcut` | Message automation: runs Spend Tracker on SMS containing “ebit”, “pent” or “ent Rs” |
| `script/widget.js` | Optional home-screen widget for the Scriptable app |
| `tools/make_shortcuts.py` | Builds and signs the two shortcuts (`python3 tools/make_shortcuts.py` on a Mac) |

## License

MIT. Not affiliated with any bank, Google or Apple. Provided as-is, for personal use.
