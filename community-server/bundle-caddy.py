"""Add the pinned Windows x64 Caddy binary to an unpacked server release."""

import hashlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

VERSION = "2.11.9"
SHA256 = "ad93112d335ee687100c4c9f11bced16ca590377976b7fe7883882b9e797e472"
URL = f"https://github.com/caddyserver/caddy/releases/download/v{VERSION}/caddy_{VERSION}_windows_amd64.zip"


def bundle(package):
    resources = package / "resources"
    if not (resources / "app" / "main.cjs").is_file():
        raise ValueError("Pass the root of the unpacked Community Server package.")
    destination = resources / "caddy"
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "caddy.zip"
        with urllib.request.urlopen(URL, timeout=60) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        with archive.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != SHA256:
            raise ValueError("The Caddy archive does not match the pinned checksum.")
        with zipfile.ZipFile(archive) as files:
            members = [name for name in files.namelist()
                       if Path(name).name.lower() in ("caddy.exe", "license", "license.txt", "notice", "notice.txt")]
            if not any(Path(name).name.lower() == "caddy.exe" for name in members):
                raise ValueError("The Caddy archive is missing caddy.exe.")
            if not any(Path(name).name.lower().startswith("license") for name in members):
                raise ValueError("The Caddy archive is missing the license.")
            destination.mkdir(exist_ok=True)
            for name in members:
                with files.open(name) as source, (destination / Path(name).name).open("wb") as output:
                    shutil.copyfileobj(source, output)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: python bundle-caddy.py PATH_TO_UNPACKED_SERVER")
    bundle(Path(sys.argv[1]))
