from pathlib import Path
import json
import shutil

app = Path('win/resources/app')
for name in ('app.js', 'index.html', 'style.css', 'main.js', 'preload.js', 'telemetry.py'):
    shutil.copyfile(name, app/name)
package = app/'package.json'
data = json.loads(package.read_text())
assert data['version'] == '1.0.10'
assert data['productName'] == 'Total Telemetry'
assert bool(data.get('communityDefaults', {}).get('key')) is False
assert not data.get("defaultDiscordWebhook")
data['version'] = '1.1.8'
data['communityDefaults'] = {'host':'','port':8787,'https':False}
package.write_text(json.dumps(data, indent=2) + '\n')
