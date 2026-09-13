#!/usr/bin/env python3
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
assert manifest["version"] == package["version"], "manifest/package version mismatch"

payload = {
    "manifest.json",
    "content.js",
    "inject.js",
    "popup.html",
    "popup.js",
    *manifest["icons"].values(),
}
for relative in payload:
    assert (ROOT / relative).is_file(), f"missing package file: {relative}"

DIST.mkdir(exist_ok=True)
output = DIST / f"timeline-filter-for-x-v{manifest['version']}.zip"
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for relative in sorted(payload):
        info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (ROOT / relative).read_bytes())

with zipfile.ZipFile(output) as archive:
    assert set(archive.namelist()) == payload
    assert archive.testzip() is None

print(output)
