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
  $('start').disabled = busy || !state || running;
  $('stop').disabled = busy || !running;
  for (const id of ['address','copy-address','copy-key','copy-owner']) $(id).disabled = !running;
  const address = $('address');
  const current = address.value;
  const hosts = state?.scope === 'network'
    ? [...new Set([state.advertisedAddress, ...state.addresses])] : ['127.0.0.1'];
  address.replaceChildren(...hosts.map(host => new Option(host + ':' + state?.port, host)));
  if (hosts.includes(current)) address.value = current;
}

function loadSettings() {
  $('port').value = state.port;
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
  } catch (error) {
    showMessage(error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), true);
  } finally {
    busy = false;
    render();
  }
}

$('server-form').onsubmit = event => {
  event.preventDefault();
  const options = {port:$('port').valueAsNumber, scope:$('scope').value, directory:$('directory').value, key:$('key').value, ownerPassword:$('owner-password').value};
  void changeServer(() => communityHost.start(options), 'Ready to share laps.');
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
$('copy-address').onclick = async () => {
  await communityHost.copy($('address').value);
  showMessage('Address copied. Use port ' + state.port + '.');
};
$('copy-key').onclick = async () => {
  await communityHost.copy(state.key);
  showMessage('Shared access key copied.');
};
$('copy-owner').onclick = async () => {
  await communityHost.copy(state.ownerPassword);
  showMessage('Owner password copied.');
};
(async () => {
  try {
    state = await communityHost.state();
    loadSettings();
  } catch (error) {
    showMessage(error.message, true);
  }
  render();
})();
