"""Fail if the Recruiting HQ Reader could ever write, type or send anything in Outlook, Slack or WhatsApp.

Run:  python scripts/check_reader.py

The reader's page scripts may only read text, scroll, and open a list item through rhqSafeClick (safe.js). This
check rejects, in every script that runs on those sites:
  - typing or editing: setting .value / textContent / innerText / innerHTML, execCommand, insertText, contentEditable;
  - keys and synthetic events: dispatchEvent, KeyboardEvent, InputEvent, key names, .focus(), .submit(), .requestSubmit();
  - clipboard and paste;
  - any .click() outside rhqSafeClick in safe.js;
  - network calls (fetch / XMLHttpRequest / sendBeacon) from page scripts: only the background talks to Recruiting HQ;
checks the manifest asks for no permission that could act on pages (scripting, debugger, tabs, cookies...), and that
the background's network lock only ever blocks requests.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "reader-extension"
PAGE_SCRIPTS = ["safe.js", "outlook.js", "slack.js", "whatsapp.js", "bridge.js"]  # bridge.js runs on Recruiting HQ only
FORBIDDEN = {
    r"\.value\s*=(?!=)": "sets a field's value",
    r"\.(textContent|innerText|innerHTML|outerHTML)\s*=(?!=)": "writes into the page",
    r"execCommand|insertText|contentEditable\s*=": "edits text",
    r"dispatchEvent|new\s+(Keyboard|Input|Mouse|Pointer|Clipboard)Event|createEvent": "fakes events",
    r"\b(keydown|keyup|keypress)\b|['\"]Enter['\"]": "presses keys",
    r"\.focus\s*\(|\.submit\s*\(|requestSubmit": "focuses or submits",
    r"clipboard|paste": "uses the clipboard",
    r"\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket": "talks to the network from the page",
    r"window\.open|location\s*=|location\.href\s*=|\.assign\s*\(": "navigates the page",
}
SAFE_DEF = re.compile(r"function rhqSafeClick\(.*?\n}\n", re.S)
BAD_PERMISSIONS = {"scripting", "debugger", "tabs", "cookies", "webRequest", "declarativeNetRequestWithHostAccess", "nativeMessaging",
                   "clipboardWrite", "clipboardRead", "management", "userScripts"}


def main() -> int:
    problems = []
    for name in PAGE_SCRIPTS:
        src = (ROOT / name).read_text(encoding="utf-8")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", src):  # e.g. a backspace where a regex meant \b: that check silently never matches
            problems.append(f"{name}: contains a control character")
        code = re.sub(r"//[^\n]*", "", src)  # comments may describe what is forbidden
        for pattern, what in FORBIDDEN.items():
            for m in re.finditer(pattern, code):
                problems.append(f"{name}: {what} ({m.group(0)!r})")
        outside = SAFE_DEF.sub("", code) if name == "safe.js" else code
        if ".click(" in outside:
            problems.append(f"{name}: clicks outside rhqSafeClick")
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for perm in set(manifest.get("permissions", [])) & BAD_PERMISSIONS:
        problems.append(f"manifest.json: asks for the '{perm}' permission")
    scripts = {js for cs in manifest.get("content_scripts", []) for js in cs["js"]}
    if not scripts <= set(PAGE_SCRIPTS):
        problems.append(f"manifest.json: page scripts not covered by this check: {sorted(scripts - set(PAGE_SCRIPTS))}")
    background = re.sub(r"//[^\n]*", "", (ROOT / "background.js").read_text(encoding="utf-8"))
    for url in re.findall(r"https://[^\s'\"`/]+", background):
        if url not in ("https://recruiting-hq.onrender.com", "https://outlook.cloud.microsoft", "https://app.slack.com", "https://web.whatsapp.com",
                       "https://www.capitaliq.com"):
            problems.append(f"background.js: unexpected address {url}")
    # Capital IQ is only ever read: its one fetch helper sends GET requests and nothing else.
    capiq = re.search(r"async function capiqGet\(.*?\n}\n", background, re.S)
    if "capitaliq" in background and not (capiq and "method: 'GET'" in capiq.group(0) and background.count("capiqGet(") >= 2):
        problems.append("background.js: Capital IQ is reached other than through the GET-only capiqGet")
    if re.search(r"executeScript|chrome\.debugger|chrome\.scripting", background):
        problems.append("background.js: runs code in pages")
    # The network lock may only block requests: never allow, redirect, rewrite headers or upgrade them.
    for kind in re.findall(r"action:\s*\{\s*type:\s*'([A-Za-z]+)'", background):
        if kind != "block":
            problems.append(f"background.js: a network rule of type '{kind}' (only 'block' is allowed)")
    if re.search(r"updateDynamicRules|redirect|modifyHeaders|allowAllRequests|upgradeScheme", background):
        problems.append("background.js: network rules that do more than block")
    if problems:
        print("Reader check FAILED:\n  " + "\n  ".join(problems))
        return 1
    print(f"Reader check passed: {len(PAGE_SCRIPTS)} page scripts only read, scroll and use rhqSafeClick; no page-acting permissions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
