"""Build a local-only BoltPocket device app in the frozen Air workspace."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
from contextlib import contextmanager, nullcontext
from ios_sign import configuration, sign_app
import plistlib


@contextmanager
def signing_search_path():
    """Use the existing development identity, restoring host preferences after signing."""
    login = str(Path.home() / "Library/Keychains/login.keychain-db")
    original = shlex.split(subprocess.check_output(
        ["security", "list-keychains", "-d", "user"], text=True))
    try:
        subprocess.run(["security", "list-keychains", "-d", "user", "-s", login,
                        *[p for p in original if p != login]], check=True)
        yield
    finally:
        subprocess.run(["security", "list-keychains", "-d", "user", "-s", *original], check=True)

signed = "--signed" in sys.argv[1:]
dedicated = configuration() if signed else None
workspaces = sorted(Path("app/ios").glob("*.xcworkspace"))
if len(workspaces) != 1:
    raise SystemExit("Expected one generated iOS workspace")
workspace = workspaces[0]
scheme = workspace.stem
build = Path("build/bolt-ios")
build.mkdir(parents=True, exist_ok=True)
args = ["xcodebuild", "-workspace", str(workspace), "-scheme", scheme,
        "-configuration", "Release", "-sdk", "iphoneos", "-destination",
        "generic/platform=iOS", "-derivedDataPath", str(build / "DerivedData"),
        "-jobs", "2", "build"]
if signed and dedicated is None:
    # Only the public team identifier is needed; never load or print secret values.
    team = os.environ.get("APPLE_TEAM_ID")
    if not team:
        for line in (Path.home() / "Secrets/local-ops.env").read_text().splitlines():
            key, separator, value = line.removeprefix("export ").partition("=")
            if separator and key.strip() == "APPLE_TEAM_ID":
                team = shlex.split(value)[0]
                break
    if not team or not team.isalnum():
        raise SystemExit("APPLE_TEAM_ID is unavailable")
    args += ["CODE_SIGN_STYLE=Automatic", "CODE_SIGN_IDENTITY=Apple Development", "DEVELOPMENT_TEAM=" + team,
             "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration"]
else:
    args += ["CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO"]
with signing_search_path() if signed and dedicated is None else nullcontext():
    subprocess.run(args, check=True)
providers = list(Path("app/ios/Pods").rglob("ExpoModulesProvider.swift"))
if not providers or not any("import BoltRuntime" in path.read_text() and "BoltRuntimeModule.self" in path.read_text() for path in providers):
    raise SystemExit("BoltRuntime is missing from the Expo module provider")
app = build / "DerivedData/Build/Products/Release-iphoneos" / (scheme + ".app")
executable = (app / scheme).read_bytes()
embedded = sorted(Path("build/bolt-native-ios-ninja").rglob("ggml-metal-embed-*.metal"))
if not embedded:
    raise SystemExit("Missing embedded Metal sources")
for source in embedded:
    if source.read_bytes() not in executable:
        raise SystemExit("Stale Metal app embedding: " + str(source))
unsigned_sha256 = hashlib.sha256(executable).hexdigest()
if signed and dedicated is not None:
    requested_path = Path("app/ios") / scheme / (scheme + ".entitlements")
    requested = plistlib.loads(requested_path.read_bytes()) if requested_path.is_file() else {}
    app = sign_app(app, dedicated, requested)
    executable = (app / scheme).read_bytes()
    for source in embedded:
        if source.read_bytes() not in executable:
            raise SystemExit("Stale signed Metal app embedding: " + str(source))
receipt = {
    "source_snapshot_id": os.environ.get("DEVFLOW_SOURCE_SNAPSHOT_ID"),
    "source_sha256": os.environ.get("DEVFLOW_CONTENT_SHA256"),
    "signed": signed, "app": str(app.resolve()),
    "model_profile": os.environ.get("EXPO_PUBLIC_BOLTPOCKET_MODEL_PROFILE"),
    "gpu_layers": os.environ.get("EXPO_PUBLIC_BOLTPOCKET_GPU_LAYERS"),
    "executable_sha256": hashlib.sha256(executable).hexdigest(),
    "js_bundle_sha256": hashlib.sha256((app / "main.jsbundle").read_bytes()).hexdigest(),
    "metal_embedded_bytes_verified": True,
    "metal_embedded_sources_count": len(embedded),
    "native_module_registered": True,
    "unsigned_executable_sha256": unsigned_sha256,
    "signing_route": "dedicated-development-keychain" if dedicated else "xcode" if signed else "unsigned",
}
if signed:
    subprocess.run(["codesign", "--verify", "--strict", str(app)], check=True)
(build / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps(receipt))
