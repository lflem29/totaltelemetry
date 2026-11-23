# Total Telemetry

Total Telemetry is a Windows telemetry viewer for **Le Mans Ultimate**. Open recorded sessions, compare laps against a reference, and see where time was gained or lost.

- Compare speed, braking, throttle, and time delta with linked charts and a track map.
- Review lap and sector consistency, corner time loss, and speed through and after a corner.
- Export graph images and share best laps as ZIP files. Import reference laps locally or use a Community Server.
- Back up Display and Temperature settings separately from the Settings dialog.

## Install on Windows

Download and run the Windows setup executable from [Releases](https://github.com/lflem29/totaltelemetry/releases). Enable **Automatically Record Telemetry** in Le Mans Ultimate. If Total Telemetry cannot find your recording folders, select them under **Settings → LMU Folders**.

For Discord exports or Community Server access, enter your own connection details under **Settings → Sharing**.

## How It Works

1. **Record a session.** Enable **Automatically Record Telemetry** in Le Mans Ultimate and drive a few timed laps. Open the recording from **Session Library → My Recent Sessions**.
2. **Choose a lap and a reference.** In **Telemetry Viewer**, pick the lap you want to review and compare it with another lap from your recordings or an imported reference. The comparison strip shows which laps are loaded and their times.
3. **Find where the gap changed.** **Time Delta** compares elapsed time at the same point on the track. A positive gap means the selected lap is behind the reference. Drag across a chart to zoom all graphs, or click to pin the cursor and read the values at that point.
4. **Inspect a corner.** Expand a row in **Corner Time Loss** to highlight the section on the track map and charts. Compare braking and throttle points, minimum speed, exit speed, and the highest speed reached before the next brake application. Use **Previous Corner** and **Next Corner** to review corners in track order.
5. **Review the session.** Open **Driver Performance** for lap and sector consistency, inconsistent corners, and post-corner speed spreads. Filter by stint or track condition to compare similar laps. Switch to **Vehicle Performance** to review recorded data such as tyre, brake, and engine temperatures.
6. **Share what you found.** Use **Export Image** to save a chart as a PNG. Use **Export the Best Lap from This Session to Share** to save a reference-lap ZIP or send it through a configured Discord webhook or Community Server. To compare a lap someone sent you, use **Imported Laps** in the Session Library.

The viewer reads your recorded telemetry locally. A Community Server is optional for sharing and browsing laps.

## Run from source

Install Node.js and Python 3. On Windows, make sure the `python` command is on your PATH.

```sh
python -m pip install duckdb==2.0.1
npm install
npm start
```

Use `python3` in the first command on platforms where Python 3 is installed under that name. The Windows release includes its Python runtime.

For the optional companion server, see the [Community Server guide](community-server/README.md).
