'use strict';

const $ = id => document.getElementById(id);
let state, busy = false;

function showMessage(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}

function render() {
  const running = Boolean(state?.running);
  $('server-version').textContent = state?.version ? 'v' + state.version : '';
  $('server-state').textContent = !state ? 'Unavailable' : running ? 'Running' : 'Stopped';
  $('server-state').classList.toggle('running', running);
  $('server-settings').disabled = busy || !state || running;
  $('tpr-updates').hidden = !state?.updatesDirectory;
  $('start').disabled = busy || !state || running;
  $('stop').disabled = busy || !running;
  for (const id of ['address','copy-address','copy-key','copy-owner']) $(id).disabled = !running;
  const address = $('address');
  const current = address.value;
  const https = state?.httpsEnabled && state?.caddyAvailable;
  const port = https ? 443 : state?.port;
  const hosts = https ? [state.httpsHostname] : state?.scope === 'network'
    ? [...new Set([state.advertisedAddress, ...state.addresses])] : ['127.0.0.1'];
  address.replaceChildren(...hosts.map(host => new Option(host + ':' + port, host)));
  if (hosts.includes(current)) address.value = current;
}

function loadSettings() {
  $('port').value = state.port;
  $('https-settings').hidden = !state.caddyAvailable;
  $('enable-https').checked = state.httpsEnabled && state.caddyAvailable;
  $('https-hostname').value = state.httpsHostname ?? '';
  $('enable-https').onchange();
  $('minimum-game-version').value = state.minimumGameVersion ?? '';
  $('scope').value = state.scope;
  $('directory').value = state.directory;
  $('key').value = state.key;
  $('owner-password').value = state.ownerPassword;
}

async function changeServer(action, success) {
  if (busy) return;
  busy = true;
  showMessage('');
  render();
  try {
    state = await action();
    showMessage(success);
    void refreshRecordSummary();
  } catch (error) {
    showMessage(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true);
  } finally {
    busy = false;
    render();
  }
}

$('enable-https').onchange = () => {
  const enabled = $('enable-https').checked;
  $('https-hostname').disabled = !enabled;
  $('scope').disabled = enabled;
};
communityHost.onProxyExit?.(async message => {
  state = await communityHost.state();
  render();
  showMessage('Caddy stopped. ' + message,true);
});
$('server-form').onsubmit = event => {
  event.preventDefault();
  const options = {port:$('port').valueAsNumber, scope:$('scope').value, directory:$('directory').value, key:$('key').value, ownerPassword:$('owner-password').value, minimumGameVersion:$('minimum-game-version').value,
    httpsEnabled:$('enable-https').checked, httpsHostname:$('https-hostname').value};
  void changeServer(() => communityHost.start(options), 'Ready to share laps.');
};
$('open-tpr-updates').onclick = async () => {
  try {
    await communityHost.openUpdates();
  } catch (error) {
    showMessage(error.message,true);
  }
};
$('stop').onclick = () => changeServer(() => communityHost.stop(), 'Server stopped.');
$('choose').onclick = async () => {
  try {
    const directory = await communityHost.chooseDirectory($('directory').value);
    if (directory && !$('server-settings').disabled) $('directory').value = directory;
  } catch (error) {
    showMessage(error.message, true);
  }
};
for (const [field, show, generate] of [['key','reveal','generate'],['owner-password','reveal-owner','generate-owner']]) {
  $(show).onclick = () => {
    const reveal = $(field).type === 'password';
    $(field).type = reveal ? 'text' : 'password';
    $(show).textContent = reveal ? 'Hide' : 'Show';
    $(show).setAttribute('aria-pressed', String(reveal));
  };
  $(generate).onclick = async () => {
    const key = await communityHost.generateKey();
    if (!$('server-settings').disabled) $(field).value = key;
  };
}
$('use-bundled-key').onclick = async () => {
  const key = await communityHost.bundledKey();
  if (!$('server-settings').disabled) $('key').value = key;
};
$('copy-address').onclick = async () => {
  await communityHost.copy($('address').value);
  showMessage(state.httpsEnabled ? 'Address copied. Use HTTPS on port 443.' : 'Address copied. Use port ' + state.port + '.');
};
$('copy-key').onclick = async () => {
  await communityHost.copy(state.key);
  showMessage('Shared access key copied.');
};
$('copy-owner').onclick = async () => {
  await communityHost.copy(state.ownerPassword);
  showMessage('Owner password copied.');
};
let lastSummary;
async function refreshRecordSummary() {
  try {
    const {records,telemetry,drivers} = await communityHost.recordSummary();
    const current = JSON.stringify([records,telemetry,drivers]);
    if (lastSummary === current) return;
    lastSummary = current;
    $('shared-record-count').textContent = records.toLocaleString();
    $('shared-telemetry-count').textContent = telemetry.toLocaleString();
    $('shared-drivers').replaceChildren(...(drivers.length ? drivers : [{name:'No drivers yet'}]).map(({name,records,telemetry}) => {
      const item = document.createElement('li');
      const driver = document.createElement('span');
      driver.textContent = name;
      driver.title = name;
      item.append(driver);
      for (const [count,label] of [[telemetry,'telemetry files'],[records,'records']]) {
        if (!Number.isFinite(count)) continue;
        const total = document.createElement('strong');
        total.textContent = count.toLocaleString();
        total.setAttribute('aria-label',count + ' ' + label);
        item.append(total);
      }
      return item;
    }));
  } catch {
    lastSummary = undefined;
    $('shared-record-count').textContent = '—';
    $('shared-telemetry-count').textContent = '—';
    const item = document.createElement('li');
    item.textContent = 'Could not read shared records';
    $('shared-drivers').replaceChildren(item);
  }
}

const initialRender = (async () => {
  try {
    state = await communityHost.state();
    loadSettings();
  } catch (error) {
    showMessage(error.message, true);
  }
  render();
  void refreshRecordSummary();
  setInterval(refreshRecordSummary,30_000);
})();
