#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))

assert manifest["manifest_version"] == 3
assert manifest["name"] == "Timeline Filter for X"
assert manifest["version"] == "3.0.0"
assert manifest["permissions"] == ["storage"]
assert set(manifest["host_permissions"]) == {
    "https://x.com/*",
    "https://twitter.com/*",
}

files = {
    "manifest.json",
    "content.js",
    "inject.js",
    "popup.html",
    "popup.js",
    *manifest["icons"].values(),
}
for path in files:
    assert (ROOT / path).is_file(), f"missing manifest asset: {path}"

sources = "\n".join((ROOT / path).read_text(encoding="utf-8") for path in ("content.js", "inject.js", "popup.js"))
for forbidden in ("eval(", "new Function", "<all_urls>", "analytics", "telemetry"):
    assert forbidden not in sources, f"forbidden source pattern: {forbidden}"

print(f"validated {manifest['name']} v{manifest['version']} ({len(files)} packaged files)")
