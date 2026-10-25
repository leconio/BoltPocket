"""Project-local, checksum-pinned build tools; no host installation is changed."""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile


def ninja():
    version = "1.13.2"
    url = f"https://github.com/ninja-build/ninja/releases/download/v{version}/ninja-mac.zip"
    expected = "c99048673aa765960a99cf10c6ddb9f1fad506099ff0a0e137ad8960a88f321b"
    root = Path("build/tools") / ("ninja-" + version)
    root.mkdir(parents=True, exist_ok=True)
    archive = root / "ninja-mac.zip"
    if not archive.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "BoltPocket-local-build"})
        with urllib.request.urlopen(request, timeout=60) as response:
            archive.write_bytes(response.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        raise RuntimeError("Ninja release checksum mismatch")
    with zipfile.ZipFile(archive) as release:
        binary = release.read("ninja")
    executable = root / "ninja"
    if not executable.exists() or executable.read_bytes() != binary:
        executable.write_bytes(binary)
        executable.chmod(0o755)
    actual = subprocess.check_output([str(executable.resolve()), "--version"], text=True).strip()
    if actual != version:
        raise RuntimeError("Unexpected Ninja version")
    receipt = {"version": version, "source": url, "archive_sha256": expected,
               "binary_sha256": hashlib.sha256(binary).hexdigest()}
    (root / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return str(executable.resolve()), receipt
