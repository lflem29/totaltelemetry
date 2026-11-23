# Total Telemetry Community Server

The server stores shared best-lap ZIPs and lets friends browse and import them from Total Telemetry. It runs separately from the telemetry app.

## Start the Windows app

1. Download the Windows x64 ZIP from [Community Server releases](https://github.com/lflem29/totaltelemetry/releases/tag/community-server-v1.0.1). Extract it to a folder and open **Total Telemetry Community Server.exe**. Keep the files from the archive together.
2. Choose a port, listening mode and lap storage folder. The app generates a shared access key and a separate owner password on first launch.
3. Click **Start Server**. Use **Copy Address** and **Copy Key** to give your friends the address, port and key privately. The shared key and separate owner password are saved using Windows secure storage. Give friends only the shared key.
4. Leave the app open while friends use the server. **Stop Server** stops incoming connections. Closing the window exits the app.

Use **Local Network** for LAN or private VPN access. Allow inbound TCP on the chosen port on the Windows firewall for that network. For an HTTPS reverse proxy on the same PC, choose **This PC Only**, point the proxy at the listener and give friends the proxy hostname and HTTPS port. Keep the built-in HTTP listener on a trusted network.

## Run from source

Install Node.js and run `npm install` followed by `npm start` in this folder to open the desktop UI. Headless hosting is also available with `node server.cjs` and the `TT_COMMUNITY_KEY`, `TT_COMMUNITY_PORT`, `TT_COMMUNITY_BIND`, and `TT_COMMUNITY_DATA` environment variables.

## Remove a shared lap

In your own copy of Total Telemetry, enter the **Owner Password** in **Settings → Sharing → Community Server**. Open **Browse the Community Server for Laps to Import** and use **Remove from Server** on the lap you want to delete. The server requires both the shared key and the owner password for removal. Copies already imported into local libraries remain available.

## Connect Total Telemetry

1. Open **Settings → Sharing → Community Server** and enter the server address, port and shared key. Reset All Settings keeps the current community address, port and shared key. Enable **Use HTTPS** for an HTTPS endpoint.
2. Open a session and choose **Upload to Community Server** in its best-lap export dialog.
3. In **Session Library → Imported Laps**, choose **Browse the Community Server for Laps to Import**. Choose a track, layout, driver or game version from the filter dropdowns, then select **Import Lap** beside the lap you want, then **Use as Reference** in the local Imported Laps list.
4. Use **Import Locally Saved Laps** there to add ZIP files from disk.

The Windows app stores uploads in the Lap Storage Folder shown in its settings. The headless server defaults to `data` beside `server.cjs`. Back up that folder to keep shared laps. Members with the shared key can upload and download laps. Uploads are capped at 32 MiB per lap. The server stores ZIPs as files and Total Telemetry validates them before adding them to the local reference library.
