# Total Telemetry

Total Telemetry is a Windows telemetry viewer for **Le Mans Ultimate**. Open recorded sessions, compare laps against a reference, and see where time was gained or lost.

- Compare speed, braking, throttle, and time delta with linked charts and a track map.
- Review lap and sector consistency, corner time loss, and speed through and after a corner.
- Export graph images and share best laps as ZIP files. Import reference laps locally or use a Community Server.
- Back up Display and Temperature settings separately from the Settings dialog.

## Install on Windows

Download and run the Windows setup executable from [Releases](https://github.com/lflem29/totaltelemetry/releases). Enable **Automatically Record Telemetry** in Le Mans Ultimate. If Total Telemetry cannot find your recording folders, select them under **Settings → LMU Folders**.

For Discord exports or Community Server access, enter your own connection details under **Settings → Sharing**.

## Record and Open a Session

1. In Le Mans Ultimate, enable **Automatically Record Telemetry** in gameplay settings and drive a session with timed laps.
2. Launch the app. If the recording does not appear, open **Settings → LMU Folders** and select the LMU installation or set the telemetry and results folders separately.
3. Open **Session Library → My Recent Sessions** and click a session row. Use **Track**, **Track Layout**, **Class**, and **Car** to narrow the list. **Show How Many Recent Sessions** limits the rows displayed after filtering.
4. In **Telemetry Viewer**, use **Select Lap** to open the lap you want to review.

## Compare and Analyse Laps

1. Choose a reference using **Change Reference** or the reference dropdown. **Automatic** selects a compatible timed lap when one is available. To use a lap from a file or a server, import it and click **Use as Reference** in **Imported Laps**.
2. Check both lap names and times in the **Comparing Laps** strip. Read **Time Delta** at the same distance along the lap. A positive value means the selected lap is behind the reference.
3. Drag across a graph to zoom the linked graphs, click to pin the cursor, and use **Reset Zoom** in the bottom toolbar to see the full lap again. Open **Select Active Telemetry Graphs** to choose which graphs are visible.
4. Expand a row in **Corner Time Loss** to highlight the corner on the map and charts. Compare entry, mid-corner, and exit time changes, plus braking, throttle, and speeds. **Post Corner Max Speed** measures the highest speed reached after exit and before the next brake application. **Previous Corner** and **Next Corner** navigate in track order.
5. Under **Session Summary → Driver Performance**, use **Overview** to find the least consistent corners and the largest post-corner speed spreads. Click a corner to compare the relevant laps. **Lap and Sector Consistency** compares time spreads around the median. Use the stint and track-condition filters for comparable laps. **Vehicle Performance** shows recorded data such as tyre, brake, and engine temperatures.

## Import, Export, and Back Up

- **Import a reference lap.** Open **Session Library → Imported Laps**. Use the local import button for a saved lap ZIP, or **Browse the Community Server for Laps to Import** for a shared lap. Click **Import Lap** in the server browser, then **Use as Reference** in Imported Laps.
- **Share a lap.** Open a timed session and click **Export the Best Lap from This Session to Share**. Choose **Export Locally** to save a ZIP, **Export to Discord** to post through a configured webhook, or **Upload to Community Server** to add it to a shared library.
- **Save a chart.** Click **Export Image** on a graph. The PNG captures the visible chart section, including expanded details when visible.
- **Back up your settings.** Use the import and export buttons under **Settings → Display** and **Settings → Temperatures**. Each uses its own JSON file. Display includes appearance, graph and channel preferences, and presets. Temperatures includes threshold settings. Folder paths and sharing credentials are excluded.

## Set Up a Community Server

1. Download the [Community Server Windows x64 ZIP](https://github.com/lflem29/totaltelemetry/releases/tag/community-server-v1.0.1), extract the whole folder, and open **Total Telemetry Community Server.exe**.
2. Choose a lap storage folder and port. Use **Local Network** for other devices on a trusted LAN or VPN, or **This PC Only** for local access or an HTTPS proxy on the host. Click **Start Server** and leave the app running while others use it.
3. Share the server address, port, and shared access key privately. Keep the separate owner password to yourself.
4. On each desktop, enter the address, port, and shared key under **Settings → Sharing → Community Server**. Enable **Use HTTPS** if the endpoint uses HTTPS. Configure a webhook separately under **Sharing** if you want Discord exports.

See the [Community Server guide](community-server/README.md) for hosting and lap removal details.

## Run from source

Install Node.js and Python 3. On Windows, make sure the `python` command is on your PATH.

```sh
python -m pip install duckdb==2.0.1
npm install
npm start
```

Use `python3` in the first command on platforms where Python 3 is installed under that name. The Windows release includes its Python runtime.

For the optional companion server, see the [Community Server guide](community-server/README.md).
