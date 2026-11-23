# Total Telemetry

Total Telemetry is a Windows telemetry viewer for **Le Mans Ultimate**. Open recorded sessions, compare laps against a reference, and see where time was gained or lost.

- Compare speed, braking, throttle, and time delta with linked charts and a track map.
- Review lap and sector consistency, corner time loss, and speed through and after a corner.
- Export graph images and share best laps as ZIP files. Import reference laps locally or use a Community Server.
- Back up Display and Temperature settings separately from the Settings dialog.

## Install on Windows

Download both Windows installer parts from [Releases](https://github.com/lflem29/totaltelemetry/releases), save them in the same folder, and open the .001 file in 7-Zip. Run the extracted setup executable. Enable **Automatically Record Telemetry** in Le Mans Ultimate. If Total Telemetry cannot find your recording folders, select them under **Settings → LMU Folders**.

For Discord exports or Community Server access, enter your own connection details under **Settings → Sharing**.

## Run from source

Install Node.js and Python 3. On Windows, make sure the `python` command is on your PATH.

```sh
python -m pip install duckdb==2.0.1
npm install
npm start
```

Use `python3` in the first command on platforms where Python 3 is installed under that name. The Windows release includes its Python runtime.

For the optional companion server, see the [Community Server guide](community-server/README.md).
