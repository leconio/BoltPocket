"""Use an authorized, dedicated development keychain without altering login."""
import json
from pathlib import Path
import plistlib
import shlex
import subprocess


def env_value(path, key):
    if not path.is_file():
        return None
    for line in path.read_text().splitlines():
        name, separator, value = line.removeprefix("export ").partition("=")
        if separator and name.strip() == key:
            parts = shlex.split(value, comments=True)
            return parts[0] if parts else None
    return None


def configuration():
    secret_root = Path.home() / "Secrets"
    env_path = env_value(secret_root / "local-ops.env", "BOLTPOCKET_IOS_DEVELOPMENT_ENV_PATH")
    if not env_path:
        return None
    state_path = env_value(Path(env_path).expanduser(), "BOLTPOCKET_IOS_DEVELOPMENT_STATE_PATH")
    if not state_path:
        raise RuntimeError("Dedicated iOS signing state is unavailable")
    state_path = Path(state_path).expanduser().resolve()
    if not state_path.is_relative_to(secret_root.resolve()):
        raise RuntimeError("iOS signing state must remain under Air Secrets")
    state = json.loads(state_path.read_text())
    state["password_file"] = state_path.parent / "passwords.json"
    return state


def sign_app(app, state, requested_entitlements):
    profile = Path(state["profile"])
    decoded = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", str(profile)], stderr=subprocess.PIPE))
    info = plistlib.loads((app / "Info.plist").read_bytes())
    if info["CFBundleIdentifier"] != state["app_id"]:
        raise RuntimeError("Development profile bundle ID mismatch")
    allowed = decoded["Entitlements"]
    entitlements = {key: allowed[key] for key in (
        "application-identifier", "com.apple.developer.team-identifier", "get-task-allow")}
    entitlements["keychain-access-groups"] = [state["team"] + "." + state["app_id"]]
    for key, value in requested_entitlements.items():
        if isinstance(value, (list, dict)) and not value:
            continue
        if key not in allowed or allowed[key] != value:
            raise RuntimeError("Development profile does not grant requested entitlement: " + key)
        entitlements[key] = value
    root = Path("build/bolt-ios/signed")
    root.mkdir(parents=True, exist_ok=True)
    signed = root / app.name
    subprocess.run(["ditto", str(app), str(signed)], check=True)
    subprocess.run(["ditto", str(profile), str(signed / "embedded.mobileprovision")], check=True)
    entitlements_path = root / "entitlements.plist"
    entitlements_path.write_bytes(plistlib.dumps(entitlements))
    original = shlex.split(subprocess.check_output(["security", "list-keychains", "-d", "user"], text=True))
    try:
        password = json.loads(state["password_file"].read_text())["keychain"]
        command = "unlock-keychain -p " + shlex.quote(password) + " " + shlex.quote(state["keychain"]) + "\n"
        subprocess.run(["security", "-i"], input=command.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        subprocess.run(["security", "list-keychains", "-d", "user", "-s", state["keychain"], *original], check=True)
        nested = sorted([*signed.rglob("*.framework"), *signed.rglob("*.dylib")], key=lambda path: len(path.parts), reverse=True)
        for target in [*nested, signed]:
            args = ["codesign", "--force", "--sign", state["identity_sha1"], "--keychain", state["keychain"],
                    "--timestamp=none", "--generate-entitlement-der"]
            if target == signed:
                args += ["--entitlements", str(entitlements_path)]
            subprocess.run([*args, str(target)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(signed)], check=True)
    finally:
        subprocess.run(["security", "list-keychains", "-d", "user", "-s", *original], check=True)
        restored = shlex.split(subprocess.check_output(["security", "list-keychains", "-d", "user"], text=True))
        if restored != original:
            raise RuntimeError("Host keychain search path was not restored")
    return signed
