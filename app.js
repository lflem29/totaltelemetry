'use strict';
const popoutWindows = new Map();
const $ = id => {
  const inline = document.getElementById(id);
  if (inline) return inline;
  for (const popup of popoutWindows.values()) {
    const element = !popup.closed && popup.document.getElementById(id);
    if (element) return element;
  }
  return null;
};
const palette = ['#c6f36c', '#75dfc2', '#7baeff', '#eaa8ed'];
const comparison = ['#f0a479', '#f9cc81', '#d3a8ff', '#f68398'];
const wheels = ['FL', 'FR', 'RL', 'RR'];
const tyreChannels = {
  'TyresTempCentre': 'Centre Tread', 'TyresTempLeft': 'Left Tread', 'TyresTempRight': 'Right Tread',
  'TyresRubberTemp': 'Tyre Temperature', 'TyresCarcassTemp': 'Carcass', 'TyresRimTemp': 'Rim Temperature'
};
const deltaGraph = ['Time Delta','delta'];
const speedActivations = [
  ['ABS', '#ff626c', '#a8192d'],
  ['TC', '#45d4df', '#007482']
];
const chartSpecs = [
  ['Speed','Ground Speed'], ['Throttle','Throttle Pos'], ['Brake','Brake Pos'], ['Gear','Gear'],
  ['Steering','Steering Pos'], ['Brake Temperatures','Brakes Temp'], ['Tyre Temperatures','tyres'],
  ['Tyre Pressures','TyresPressure'], ['Oil Temperature','Engine Oil Temp'], ['Water Temperature','Engine Water Temp']
];
const defaultHiddenGraphs = ['Engine Oil Temp', 'Engine Water Temp'];
const builtInGraphKeys = new Set(chartSpecs.map(([, key]) => key));
const builtIn = {
  Driving: ['Ground Speed','Throttle Pos','Brake Pos','Gear','Steering Pos','Engine RPM','G Force Lat','G Force Long'],
  'Tyres & Brakes': ['Brakes Temp','Brakes Force','TyresTempCentre','TyresPressure','Tyres Wear','TyresCompound','Brake Thickness'],
  Engine: ['Engine RPM','Engine Oil Temp','Engine Water Temp','Fuel Level','Turbo Boost Pressure'],
  'Ride Height': ['FrontRideHeight','RideHeights','RearRideHeight'],
  'G Forces': ['G Force Lat','G Force Long','G Force Vert'],
  'Fuel & Energy': ['Fuel Level','Virtual Energy','SoC','Regen Rate'],
  'Wheel Slip': ['Ground Speed','Wheel Speed','ABS','TC'],
  Suspension: ['Susp Pos','Front3rdDeflection','Rear3rdDeflection']
};
let settings = {};
let sessions = [], resultGameVersions = [];
let scanBusy = false, runningScanAgain = false, scanKey;
let scanFailed = false;
let selected, lap, reference, primary, secondary;
const loadedTraceLabel = 'Loaded Lap';
const referenceTraceLabel = 'Reference Lap';
let referenceLoading = false;
let referenceSessionPath;
let referenceSessionLapId;
let manualReference = undefined;
let loadGeneration = 0, ready = false;
let view = 'library';
const listScrollPositions = new Map();
const listScrollContainers = {
  library:['library','session-wrap','imported-laps-table'],
  records:['records','records-table']
};
let enabled = new Set(builtIn.Driving), chartRows = [], readoutRows = [];
let range = [0, 1], cursor = 0, playTime = 0, pinned = false, playing = false, frame = 0;
let selection = null;
let pinnedGraph;
let renderRequested = false;
const maxChartOverlays = 3;
let mergeChoices = new Set();
let mergeChart;
const mergeColors = ['#c6f36c','#74d8ff','#ffb583','#d7a5ff','#70e4c0','#ff91ad','#f4dc72','#a2b4ff'];
const graphColor = (key, fallback = palette[0]) => settings.colors?.[key] || fallback;

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
const uiIconPaths = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2M3 7v12h16l3-8H7l-4 8',
  wave: 'M2 12h4l3-8 5 16 3-8h5',
  wheel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-2.5 1L4 8m10.5 3L20 8m-8 6v7',
  watch: 'M10 2h4m-2 7v4m6-8 2-2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  reset: 'M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3m0 8v3a2 2 0 0 1-2 2h-3m-8 0H5a2 2 0 0 1-2-2v-3',
  download: 'M12 3v12m-5-5 5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  pop: 'M13 5h6v6m0-6-9 9m0-9H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4',
  full: 'M8 3H3v5m13-5h5v5m0 8v5h-5m-8 0H3v-5M3 3l6 6m12-6-6 6m6 12-6-6M3 21l6-6',
  settings: 'M10 3h4l.6 2.6 2 .9 2.3-1.4 2 3.4-1.9 1.8v2.4l1.9 1.8-2 3.4-2.3-1.4-2 .9L14 21h-4l-.6-2.6-2-.9-2.3 1.4-2-3.4L5 12.7v-2.4L3.1 8.5l2-3.4 2.3 1.4 2-.9L10 3ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
  sliders: 'M5 3v5m0 4v9m7-18v9m0 4v5m7-18v2m0 4v12M2 8h6v4H2zm7 4h6v4H9zm7-7h6v4h-6z',
  bookmark: 'M10 3H6a1 1 0 0 0-1 1v17l7-4 7 4v-9M17 2v8m-4-4h8',
  request: 'M8 3v10m-4-4 4 4 4-4M3 15v5h8m11-4a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-5-3v3l2 1',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M3 6h18M9 6V4h6v2m4 0-1 14H6L5 6m5 4v6m4-6v6',
  update: 'M20 4v5h-5m5 0a8 8 0 1 0 .1 6',
  fitTrack: 'M7 3H3v4m14-4h4v4m0 10v4h-4M7 21H3v-4m4-2V9a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2a2 2 0 0 0-2 2v1a2 2 0 0 1-4 0Z',
  importLap: 'M8 7V4h7l4 4v12H8v-3m7-13v4h4M3 12h10m-3-3 3 3-3 3',
  share: 'M15.4 5.5l-6.8 4m0 5 6.8 4M21 4a3 3 0 1 0-6 0 3 3 0 1 0 6 0ZM9 12a3 3 0 1 0-6 0 3 3 0 1 0 6 0Zm12 8a3 3 0 1 0-6 0 3 3 0 1 0 6 0Z',
  circuit: 'M4 15c0-2 2-3 3-5l2-4c1-2 4-2 5 0l1 3c.5 1 1 1 2 1h2a2 2 0 0 1 2 2v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-4Z',
  summary: 'M9 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3M9 3h6v4H9Zm0 14v-3m3 3v-5m3 5v-7',
  gauge: 'M4 18a9 9 0 1 1 16 0H4Zm8-3 4-5M6 13h1m5-6v1m5 5h1',
  save: 'M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v6h10V3M7 21v-7h10v7',
  zoomIn: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6M7 10h6m-3-3v6',
  pin: 'M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Zm3 11v7',
  unlock: 'M7 11V7a5 5 0 0 1 9-3m-4 11v2M6 11h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z',
  play: 'M7 4l14 8-14 8V4Z',
  pause: 'M7 5h3v14H7zm7 0h3v14h-3z',
  globe: 'M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0ZM3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z'
};
function addButtonIcon(button, key) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', uiIconPaths[key]);
  icon.append(path);
  button.classList.add('icon-button');
  if (!button.childElementCount && button.textContent) {
    button.replaceChildren(node('span', button.textContent, 'icon-button-label'));
  }
  button.prepend(icon);
}
for (const button of document.querySelectorAll('[data-ui-icon]')) {
  addButtonIcon(button, button.dataset.uiIcon);
}
function option(select, label, value) {
  const el = node('option', label);
  el.value = value;
  select.append(el);
}
const headerStatus = $('status');
function fitHeaderStatus() {
  headerStatus.style.removeProperty('font-size');
  if (!headerStatus.textContent || !headerStatus.clientWidth) return;
  const naturalWidth = headerStatus.scrollWidth;
  if (naturalWidth <= headerStatus.clientWidth) return;
  const baseSize = parseFloat(getComputedStyle(headerStatus).fontSize);
  const fitted = Math.max(10, Math.floor(baseSize * headerStatus.clientWidth / naturalWidth * 10) / 10);
  headerStatus.style.fontSize = Math.min(baseSize, fitted) + 'px';
}
new ResizeObserver(fitHeaderStatus).observe(headerStatus);
document.fonts.ready.then(fitHeaderStatus);

const statusTimers = new WeakMap();
function setStatus(element, text, {error = false, temporary = true} = {}) {
  clearTimeout(statusTimers.get(element));
  statusTimers.delete(element);
  element.classList.toggle('status-error', error);
  element.textContent = text;
  if (element === headerStatus) {
    if (text) headerStatus.title = text;
    else headerStatus.removeAttribute('title');
    fitHeaderStatus();
  }
  if (text && temporary) {
    statusTimers.set(element, setTimeout(() => setStatus(element, ''), 20_000));
  }
}
function number(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}
function timeGapLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const rounded = Math.round(seconds * 1000) / 1000;
  return (rounded > 0 ? '+' : '') + number(rounded, 3) + ' s';
}
function lapTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const ms = Math.round(seconds * 1000);
  return Math.floor(ms / 60000) + ':' + ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
}
const australianDateTime = new Intl.DateTimeFormat('en-AU', {
  day:'2-digit', month:'2-digit', year:'numeric',
  hour:'numeric', minute:'2-digit', second:'2-digit'
});
const australianDate = new Intl.DateTimeFormat('en-AU', {day:'2-digit', month:'2-digit', year:'numeric'});
function recordingDate(value) {
  const text = value ?? '';
  const timestamp = text.match(/\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z(?=\.duckdb$|$)/i)?.[0] ?? text;
  return new Date(timestamp.replace(/T(\d\d)_(\d\d)_(\d\d)Z$/i, 'T$1:$2:$3Z'));
}
function dateLabel(value, formatter = australianDateTime) {
  const parsed = recordingDate(value);
  return Number.isNaN(+parsed) ? value : formatter.format(parsed);
}
function weekdayPeriod(date) {
  const weekday = date.toLocaleDateString('en-AU', {weekday:'long'});
  const hour = date.getHours();
  if (hour < 5 || hour >= 21) return weekday + ' night';
  if (hour < 12) return weekday + ' morning';
  if (hour < 17) return weekday + ' afternoon';
  return weekday + ' evening';
}
function lapLabel(l) {
  return (l.number === null ? 'Recording' : 'Lap ' + l.number) + ' · ' +
    (l.time ? lapTime(l.time) + (l.validity === 'unconfirmed' ? ' · validity unconfirmed' : '')
      : l.kind === 'complete' ? l.validity === 'no official time' ? 'No official time' : 'No recorded time' : l.kind);
}
function addLoadedLapLabel(cell, sessionPath, lapId) {
  if (!sessionPath) return;
  const label = node('small', 'Loaded', 'loaded-lap-label');
  label.dataset.loadedPath = sessionPath;
  if (lapId != null) label.dataset.loadedLap = String(lapId);
  cell.append(label);
  updateLoadedLapLabel(label);
}
function updateLoadedLapLabel(label) {
  label.hidden = !(ready && selected?.path === label.dataset.loadedPath &&
    (label.dataset.loadedLap == null || String(lap?.id) === label.dataset.loadedLap));
}
function positionListActions(key, empty) {
  const actions = $(key + '-list-actions');
  const container = $(key + (empty ? '-empty-state' : '-list-toolbar'));
  if (actions.parentElement === container) return;
  const focused = actions.contains(document.activeElement) ? document.activeElement : null;
  container.append(actions);
  focused?.focus({preventScroll:true});
}
function setListCount(id, shown, total, item) {
  const count = $(id);
  count.hidden = !total;
  count.textContent = 'Showing ' + shown.toLocaleString() + ' of ' + total.toLocaleString() + ' ' +
    item + (total === 1 ? '' : 's');
}
function addLoadedReferenceLabel(cell, sessionPath, lapId) {
  if (!sessionPath) return;
  const label = node('small', 'Loaded Reference', 'loaded-reference-label reference-color');
  label.dataset.referencePath = sessionPath;
  if (lapId != null) label.dataset.referenceLap = String(lapId);
  cell.append(label);
  updateLoadedReferenceLabel(label);
}
function updateLoadedReferenceLabel(label) {
  label.hidden = !(secondary && reference?.session.path === label.dataset.referencePath &&
    (label.dataset.referenceLap == null || String(reference.lap.id) === label.dataset.referenceLap));
}
function referenceLapCells(driver, track, layout, car, time, version) {
  return [node('td', driver || 'Unknown Driver'), node('td', track || 'Unknown'),
    node('td', layout || 'Unknown'), node('td', car || 'Unknown'),
    node('td', lapTime(time), 'numeric-cell session-best'), node('td', version || 'Unknown')];
}
function renderSessionDetailsMatchup(session, currentLap, comparison) {
  const matchup = $('session-details-matchup');
  matchup.hidden = !comparison;
  if (!comparison) {
    matchup.replaceChildren();
    return;
  }
  const loadedDriver = session?.driver?.trim();
  const referenceDriver = comparison.session?.driver?.trim();
  const sameDriver = loadedDriver && loadedDriver.toLowerCase() === referenceDriver?.toLowerCase();
  const loadedLabel = (sameDriver ? null : loadedDriver) ||
    (currentLap?.number == null ? 'Loaded Lap' : 'Lap ' + currentLap.number);
  const referenceLabel = (sameDriver ? null : referenceDriver) ||
    (comparison.lap?.number == null ? 'Reference Lap' : 'Lap ' + comparison.lap.number);
  matchup.replaceChildren(node('span', loadedLabel, 'selected-color'), ' vs ',
    node('span', referenceLabel, 'reference-color'));
}
function renderLoadedSessions() {
  const show = (id, session, currentLap, empty) => {
    const output = $(id);
    if (!session) {
      output.textContent = empty;
      return;
    }
    const time = currentLap?.time ? lapTime(currentLap.time) : '';
    const details = [session.driver, session.trackLayout !== session.track ? session.trackLayout : '',
      session.car, session.recorded && dateLabel(session.recorded),
      currentLap?.number != null ? 'Lap ' + currentLap.number : '', time];
    output.replaceChildren(node('strong', session.track || session.filename), details.filter(Boolean).join(' · '));
  };
  renderSessionDetailsMatchup(selected, lap, secondary ? reference : null);
  show('loaded-session', selected, lap, 'No session loaded');
  $('clear-loaded-session').hidden = !selected;
  syncCompatibleReferenceFilters();
  const pending = !selected && referenceSessionPath
    ? (settings.comparisonLaps ?? []).find(session => session.path === referenceSessionPath)
      ?? sessions.find(session => session.path === referenceSessionPath)
    : undefined;
  const comparisonSession = secondary ? reference?.session : pending;
  const comparisonLap = secondary ? reference?.lap
    : pending?.lap ?? pending?.laps?.find(item => referenceSessionLapId == null
      ? item.time > 0 && item.time === pending.best : item.id === referenceSessionLapId);
  show('loaded-comparison', comparisonSession, comparisonLap, 'No reference lap loaded');
  $('clear-loaded-reference').hidden = $('remove-reference-session').hidden = !(comparisonSession || referenceSessionPath);
  document.querySelectorAll('.loaded-reference-label').forEach(updateLoadedReferenceLabel);
  document.querySelectorAll('.loaded-lap-label').forEach(updateLoadedLapLabel);
  document.querySelectorAll('.reference-match-guide').forEach(guide => { guide.hidden = !ready; });
}
const visualizerSettings = {aero:'aeroVisualizerEnabled', suspension:'suspensionVisualizerEnabled'};
function syncVisualizerSettings() {
  for (const [name, setting] of Object.entries(visualizerSettings)) {
    const enabled = settings[setting] === true;
    $('enable-' + name).checked = enabled;
    $(name + '-tab').hidden = !enabled;
    if (!enabled && popoutWindows.has(name)) closePanelPopout(name);
  }
}
for (const [name, setting] of Object.entries(visualizerSettings)) {
  $('enable-' + name).onchange = event => {
    save({[setting]:event.target.checked});
    syncVisualizerSettings();
  };
  $(name + '-tab').onclick = () => openVisualiser(name);
}
function setView(name) {
  if (name === 'trainer' && settings.driverTrainerEnabled !== true) name = 'library';
  const changingView = name !== view;
  if (changingView) {
    for (const id of listScrollContainers[view] ?? []) {
      const element = $(id);
      if (!element.hidden) listScrollPositions.set(id,[element.scrollLeft,element.scrollTop]);
    }
  }
  view = name;
  $('trainer').hidden = name !== 'trainer';
  $('trainer-tab').classList.toggle('active', name === 'trainer');
  $('library').hidden = name !== 'library';
  const showTelemetry = name === 'viewer' && Boolean(lap);
  $('viewer').hidden = !showTelemetry;
  $('viewer-empty').hidden = name !== 'viewer' || showTelemetry;
  $('records').hidden = name !== 'records';
  $('export-best-lap').hidden = !showTelemetry;
  $('library-tab').classList.toggle('active', name === 'library');
  $('viewer-tab').classList.toggle('active', name === 'viewer');
  $('records-tab').classList.toggle('active', name === 'records');
  if (!showTelemetry) stop();
  if (name === 'library') { renderLibrary(); renderLoadedSessions(); }
  if (name === 'records') { renderRecords(); void refreshFriendRecords(); }
  if (name === 'trainer') { renderDriverTrainer(); void scanDriverTrainer(sessions); }
  if (showTelemetry) scheduleRender();
  for (const id of (changingView ? listScrollContainers[name] : undefined) ?? []) {
    const location = listScrollPositions.get(id);
    if (location && !$(id).hidden) $(id).scrollTo(...location);
  }
}
const carClasses = ['GTE', 'GT3', 'LMP3', 'LMP2', 'Hypercar'];
const temperatureThresholds = [
  ['tyres', 'Tyres', 90], ['brakes', 'Brakes', 701],
  ['oil', 'Engine oil', 110], ['water', 'Engine water', 100]
];
const classOptimalTemperatureMax = {
  GTE: {tyres: 90, brakes: 750},
  GT3: {tyres: 90, brakes: 750},
  LMP3: {tyres: 92, brakes: 700},
  LMP2: {tyres: 92, brakes: 800},
  Hypercar: {tyres: 94, brakes: 850}
};
function hotTemperature(carClass, key) {
  const category = carClasses.includes(carClass) ? carClass : 'other';
  const overrides = settings.hotTemperaturesByClass?.[category] ?? {};
  if (Object.hasOwn(overrides, key)) return overrides[key];
  if (Object.hasOwn(settings.hotTemperatures ?? {}, key)) return settings.hotTemperatures[key];
  const fallback = temperatureThresholds.find(([channel]) => channel === key)?.[2];
  if (category === 'other' || fallback === undefined) return fallback;
  return (classOptimalTemperatureMax[category][key] ?? fallback) + 1;
}
const orangeInterfaceColour = '#f59e42';
const greenInterfaceColour = '#2a6204';
const defaultInterfaceBackgroundColour = '#101513';
const defaultGraphBackgroundColour = '#171e1a';
function backgroundColour(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function isLightBackground(colour) {
  const [red, green, blue] = colour.slice(1).match(/../g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 0.179;
}
let lightGraphBackground = false;
function textScale() { return 0.9 * (settings.textScalePercent ?? 100) / 100; }
function interfaceColourMode() {
  const mode = settings.interfaceColourMode;
  if (mode === 'orange' || mode === 'green' || mode === 'custom') return mode;
  const colour = backgroundColour(settings.interfaceColour, greenInterfaceColour).toLowerCase();
  if (colour === orangeInterfaceColour) return 'orange';
  return colour === greenInterfaceColour ? 'green' : 'custom';
}
function activeInterfaceColour() {
  const mode = interfaceColourMode();
  if (mode === 'orange') return orangeInterfaceColour;
  if (mode === 'green') return greenInterfaceColour;
  return backgroundColour(settings.interfaceColour, greenInterfaceColour);
}
const interfaceColourOptions = [
  ['header','Header','#131a16'], ['panel','Panels and Dialogs','#171e1a'],
  ['raised','Cards and Inactive Tabs','#1d2721'], ['control','Inputs and Secondary Buttons','#202a23'],
  ['rule','Borders and Dividers','#344139'], ['fg','Primary Text','#ecf2e9'],
  ['muted','Secondary Text','#a4b3a7'], ['button-ink','Primary Button Text','#ffffff'],
  ['focus','Keyboard Focus and Graph Cursor','#e8f0dd'],
  ['accent','Loaded Lap and Highlights','#c6f36c'], ['reference','Reference Lap','#f0a479'],
  ['warning','Warnings and Time Loss','#ff8787'], ['graph-grid','Graph Grid','#2a382e'],
  ['graph-axis','Graph Axes and Labels','#a4b3a7'], ['map-surface','Track Map Background','#111915'],
  ['map-brake','Track Map Braking','#ff4545'], ['map-throttle','Track Map Throttle','#32e260'],
  ['abs','ABS Trace','#ff626c'], ['tc','Traction Control Trace','#45d4df'],
  ['cold','Cold Tyre Trace','#91d5ff'], ['prior-stint','Previous Stint Traces','#e0787d'],
  ['other-laps','Other Lap Traces','#90ac98'], ['trophy','Earned Trophies','#f2cd79']
];
const elementColour = (key, fallback) => backgroundColour(settings.elementColours?.[key],fallback);
const elementColourFields = interfaceColourOptions.map(([key,label,defaultColour]) => {
  const field = node('label',label);
  const input = node('input');
  input.type = 'color';
  field.append(input);
  $('element-colours').append(field);
  input.oninput = () => {
    settings.elementColours = {...settings.elementColours,[key]:input.value};
    applyAppearance();
  };
  input.onchange = () => {
    save({elementColours:{...settings.elementColours,[key]:input.value}});
    applyAppearance();
    renderSessionSummary();
    if (ready) {
      const column = $('plot-column');
      const scrollTop = column.scrollTop;
      buildCharts();
      column.scrollTop = scrollTop;
    }
  };
  return {key,input,defaultColour};
});

function interfaceColourFields() {
  const mode = interfaceColourMode();
  $('interface-colour-mode').value = mode;
  $('custom-interface-colour').hidden = mode !== 'custom';
  $('interface-colour').value = backgroundColour(settings.interfaceColour, greenInterfaceColour);
  for (const {key,input,defaultColour} of elementColourFields) input.value = elementColour(key,defaultColour);
}
function applyAppearance() {
  const root = document.documentElement;
  const interfaceColour = activeInterfaceColour();
  root.style.setProperty('--interface-colour', interfaceColour);
  const buttonFill = interfaceColour.toLowerCase() === orangeInterfaceColour ? '#ba5600' : interfaceColour;
  root.style.setProperty('--button-fill', buttonFill);
  const lightButton = isLightBackground(buttonFill);
  for (const [key] of interfaceColourOptions) {
    const colour = elementColour(key,'');
    if (colour) root.style.setProperty('--' + key,colour);
    else root.style.removeProperty('--' + key);
  }
  root.style.setProperty('--button-ink', elementColour('button-ink',lightButton ? '#000' : '#fff'));
  palette[0] = elementColour('accent','#c6f36c');
  comparison[0] = elementColour('reference','#f0a479');
  root.style.setProperty('--button-shade', lightButton ? '#fff' : '#000');
  const background = backgroundColour(settings.interfaceBackgroundColour, defaultInterfaceBackgroundColour);
  const graphBackground = backgroundColour(settings.graphBackgroundColour, '');
  lightGraphBackground = !!graphBackground && isLightBackground(graphBackground);
  root.style.setProperty('--bg', background);
  root.style.setProperty('--background-text', isLightBackground(background) ? '#000' : '#fff');
  root.style.setProperty('--graph-bg', graphBackground);
  root.style.setProperty('--graph-text', lightGraphBackground ? '#171e1a' : '');
  root.style.setProperty('--text-scale', String(textScale()));
  fitHeaderStatus();
  for (const popup of popoutWindows.values()) {
    if (!popup.closed) popup.document.documentElement.style.cssText = root.style.cssText;
  }
  $('text-scale-value').value = (settings.textScalePercent ?? 100) + '%';
  for (const chart of chartRows) chart.cache = null;
  if (selected) paintLapHistory();
  if (view === 'trainer') renderDriverTrainer();
  scheduleRender();
}
function settingsFields() {
  $('check-tpr-update').hidden = !settings.tprUpdatesSupported;
  $('settings-primary-driver').textContent = settings.primaryDriver || 'Awaiting Confirmation';
  $('settings-confirm-driver').hidden = Boolean(settings.primaryDriver || !primaryDriverSuggestion);
  $('share-track-records').checked = settings.shareTrackRecords === true;
  $('notification-sound').checked = settings.notificationSound === true;
  $('manage-track-records').disabled = !settings.communityOwnerConfigured;
  if (!$('settings-panel-telemetry-data').hidden || $('telemetry-name-fields').childElementCount) renderTelemetryData();
  $('auto-load-telemetry').checked = settings.autoLoadTelemetry !== false;
  syncDriverTrainerSetting();
  const server = settings.communityServer;
  $('community-host').value = server?.host ?? '';
  $('community-port').value = server?.port ?? 8787;
  $('community-https').checked = server?.https ?? false;
  $('community-key').placeholder = settings.communityUsesBundledKey ? 'Bundled shared key in use' :
    settings.communityConfigured ? 'Saved shared key' : '';
  $('community-settings-status').textContent = settings.communityOwnerConfigured ? 'Shared key and owner password saved.' : settings.communityConfigured ? 'Shared access key saved.' : '';

  updateDiscordSettings();
  interfaceColourFields();
  $('interface-background-colour').value = backgroundColour(settings.interfaceBackgroundColour, defaultInterfaceBackgroundColour);
  $('graph-background-colour').value = backgroundColour(settings.graphBackgroundColour, defaultGraphBackgroundColour);
  $('text-scale').value = settings.textScalePercent ?? 100;
  $('racing-line-spread').value = racingLineSpread();
  $('settings-channels').disabled = !ready;
  $('settings-channel-note').hidden = ready;
  for (const type of ['telemetry', 'results']) $(type + '-path').textContent = settings[type] || 'Folder not set';
  refreshUnitFields();
}
let distanceReport, distanceRequest;
const distanceNumber = new Intl.NumberFormat(undefined, {minimumFractionDigits:1, maximumFractionDigits:1});
function renderResultsDistance() {
  $('results-distance').hidden = !settings.results;
  const totals = distanceReport?.data?.drivers ?? [];
  const driver = normaliseDriverName(settings.primaryDriver);
  const preferred = driver ? totals.find(total => normaliseDriverName(total.name || total.id) === driver) : undefined;
  $('distance-total').textContent = preferred ? distanceNumber.format(convert('',preferred.km,'km')) + ' ' + displayUnit('','km') : '';
  $('track-hours').hidden = !preferred;
  const minutes = Math.round((preferred?.trackSeconds ?? 0) / 60);
  $('track-hours-total').textContent = Number.isFinite(preferred?.trackSeconds)
    ? Math.floor(minutes / 60).toLocaleString() + ' h ' + minutes % 60 + ' min' : '—';
  $('favourite-cars').hidden = !preferred;
  const classDistance = preferred?.classDistanceKm ?? {};
  const rankedClasses = [...carClasses].sort((a, b) => (classDistance[b] ?? 0) - (classDistance[a] ?? 0));
  $('favourite-car-classes').replaceChildren(...rankedClasses.flatMap(category => {
    const favourites = preferred?.favouriteCars?.[category] ?? [];
    const value = node('dd', favourites.length ? undefined : '—');
    if (favourites.length) {
      const list = node('ol');
      for (const favourite of favourites) {
        const item = node('li', favourite.car);
        item.append(node('small', distanceNumber.format(convert('',favourite.km,'km')) + ' ' + displayUnit('','km')));
        list.append(item);
      }
      value.append(list);
    }
    return [node('dt', category), value];
  }));
  const tracks = preferred?.favouriteTracks ?? [];
  $('favourite-tracks').hidden = !tracks.length;
  $('favourite-track-list').replaceChildren(...tracks.map(({track, km}) => {
    const item = node('li', track);
    item.append(node('small', distanceNumber.format(convert('',km,'km')) + ' ' + displayUnit('','km')));
    return item;
  }));
  $('distance-confirm-driver').hidden = Boolean(settings.primaryDriver || !primaryDriverSuggestion);
  const problem = distanceReport?.data?.errors;
  $('distance-status').textContent = distanceReport?.error
    ?? (!distanceReport ? 'Calculating distance from results files…'
      : !totals.length ? 'No driver distance available in the results files.'
      : preferred ? 'Estimated from ' + preferred.laps.toLocaleString() + ' laps in the results folder.'
      : driver ? 'No distance was found for ' + settings.primaryDriver + '.'
      : 'Confirm your primary driver to see their distance.') + (problem ? ' ' + problem + ' results files could not be counted.' : '');
}
function refreshResultsDistance() {
  const folder = settings.results;
  if (distanceReport?.folder !== folder) distanceReport = undefined;
  if (!folder || distanceRequest?.folder === folder) return;
  const request = {folder};
  distanceRequest = request;
  if (!distanceReport) renderResultsDistance();
  lmu.resultsDistance().then(data => {
    if (settings.results !== folder || distanceRequest !== request) return;
    if (JSON.stringify(data) === JSON.stringify(distanceReport?.data)) return;
    distanceReport = {folder, data};
    renderResultsDistance();
  }).catch(() => {
    if (settings.results !== folder || distanceRequest !== request) return;
    distanceReport = {folder, error:'Could not calculate distance from the results folder.'};
    renderResultsDistance();
  }).finally(() => {
    if (distanceRequest === request) distanceRequest = undefined;
  });
}
function normaliseDriverName(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

let primaryDriverSuggestion;
let deferredDriverConfirmation = false;
function offerPrimaryDriver(suggestion) {
  if (!suggestion || settings.primaryDriver || !lmu.confirmPrimaryDriver) return;
  primaryDriverSuggestion = suggestion;
  $('primary-driver-suggestion').textContent = suggestion.name + ' · ' + suggestion.laps.toLocaleString() + ' completed laps';
  if (!deferredDriverConfirmation && !$('confirm-primary-driver').open) $('confirm-primary-driver').showModal();
}
$('distance-confirm-driver').onclick = $('settings-confirm-driver').onclick = () => {
  deferredDriverConfirmation = false;
  if ($('folders').open) $('folders').close();
  offerPrimaryDriver(primaryDriverSuggestion);
};
$('primary-driver-later').onclick = () => $('confirm-primary-driver').close();
$('confirm-primary-driver').onclose = () => { deferredDriverConfirmation = true; };
$('primary-driver-confirm').onclick = async () => {
  const button = $('primary-driver-confirm');
  button.disabled = true;
  try {
    Object.assign(settings,await lmu.confirmPrimaryDriver(primaryDriverSuggestion.name));
    $('confirm-primary-driver').close();
    loadRecordNotifications();
    settingsFields();
    renderResultsDistance();
    refreshRecordsFromScan();
    friendConnectionGeneration++;
    void refreshFriendRecords(true);
  } catch (error) {
    $('primary-driver-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
function bindTabs(listId, onChange) {
  const tabs = [...$(listId).querySelectorAll('[role=tab]')];
  function select(activeTab) {
    if (activeTab.getAttribute('aria-selected') === 'true') return;
    for (const tab of tabs) {
      const active = tab === activeTab;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
    }
    onChange?.();
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(tab);
    tab.onkeydown = event => {
      const target = {ArrowLeft:(index + tabs.length - 1) % tabs.length,
        ArrowRight:(index + 1) % tabs.length, Home:0, End:tabs.length - 1}[event.key];
      if (target === undefined) return;
      event.preventDefault();
      select(tabs[target]);
      tabs[target].focus();
    };
  });
  return tabs;
}
bindTabs('library-tabs', () => { $('library').scrollTop = 0; });
bindTabs('settings-tabs', () => {
  if (!$('settings-panel-telemetry-data').hidden && !$('telemetry-name-fields').childElementCount) renderTelemetryData();
});

function filterLibraryEntries(id, entries) {
  const controls = $(id);
  const fields = id === 'imported-lap-filters'
    ? [...recordFields, ['driver', 'All Drivers', entry => entry.driver]] : recordFields;
  const filters = fields.map(([key, label, read]) => {
    const select = controls.querySelector('[name="' + key + '"]');
    const valueOf = entry => read(entry)?.trim() || 'Unknown';
    const track = controls.querySelector('[name="track"]').value;
    const available = key === 'layout' && track
      ? entries.filter(entry => (recordFields[0][2](entry)?.trim() || 'Unknown') === track) : entries;
    const values = [...new Set(available.map(valueOf))].sort((a, b) => a.localeCompare(b));
    if (select.options.length !== values.length + 1 ||
        values.some((value, index) => select.options[index + 1]?.value !== value)) {
      const prior = select.value;
      select.replaceChildren();
      option(select, label, '');
      for (const value of values) option(select, value, value);
      if (values.includes(prior)) select.value = prior;
    }
    return {key, value:select.value, valueOf};
  });
  const matches = entries.filter(entry => filters.every(({value, valueOf}) => !value || value === valueOf(entry)));
  const sortKey = controls.querySelector('[name="sort"]').value;
  const sort = filters.find(({key}) => key === sortKey);
  if (sort) matches.sort((a, b) => sort.valueOf(a).localeCompare(sort.valueOf(b)));
  return matches;
}

const useAsReferenceLabel = 'Use as Reference';
let compatibleReferencesOnly = false;
const noCompatibleReferences = 'No compatible references match your filters. Uncheck Show Compatible References Only to include other results.';
function syncCompatibleReferenceFilters() {
  for (const input of document.querySelectorAll('.compatible-reference-filter input')) {
    input.checked = compatibleReferencesOnly;
    input.parentElement.hidden = !selected;
  }
}
for (const input of document.querySelectorAll('.compatible-reference-filter input')) {
  input.onchange = () => {
    compatibleReferencesOnly = input.checked;
    syncCompatibleReferenceFilters();
    renderLibrary({resetRecentSessions:true});
  };
}
function matchesReferenceSession(session) {
  if (!selected) return false;
  const dimensions = value => [value.trackName || value.track, value.trackLayout || value.track, value.carClass]
    .map(field => field?.trim().toLowerCase());
  const current = dimensions(selected);
  return dimensions(session).every((field,index) => Boolean(field && field === current[index]));
}

function bindTelemetryRow(row, open) {
  row.classList.add('session-row');
  row.tabIndex = 0;
  row.title = 'Open in Telemetry Viewer';
  row.onclick = event => {
    if (!event.target.closest('button')) void open();
  };
  row.onkeydown = event => {
    if (event.target !== row || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) void open();
  };
}

function renderComparisonLaps() {
  const imported = [...(settings.comparisonLaps ?? [])].reverse();
  const entries = filterLibraryEntries('imported-lap-filters', imported).filter(entry =>
    !compatibleReferencesOnly || entry.path === selected.path || matchesReferenceSession(entry));
  $('imported-laps-empty').textContent = !imported.length ? 'No laps imported yet.' :
    compatibleReferencesOnly ? noCompatibleReferences : 'No imported laps match these filters.';
  $('imported-laps-table').hidden = !entries.length;
  $('imported-load-guide').hidden = !entries.length;
  setListCount('imported-list-count',entries.length,imported.length,'Imported Lap');
  $('imported-laps-empty').hidden = Boolean(entries.length);
  positionListActions('imported',!entries.length);
  $('comparison-lap-list').replaceChildren(...entries.map(entry => {
    const row = node('tr');
    const actions = node('td');
    bindTelemetryRow(row,() => openImportedLap(entry));
    const add = node('button', useAsReferenceLabel, 'reference-add');
    addButtonIcon(add, 'bookmark');
    add.hidden = !matchesReferenceSession(entry) || selected.path === entry.path;
    add.type = 'button';
    add.setAttribute('aria-pressed', String(referenceSessionPath === entry.path));
    add.onclick = () => selectReferenceSession(entry.path);
    const remove = node('button', 'Delete This Lap from My Database', 'button-secondary delete-imported-lap');
    addButtonIcon(remove, 'trash');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Delete This Lap from My Database: ' + entry.car + ' at ' + entry.track);
    remove.onclick = async () => {
      const details = [entry.driver || 'Unknown Driver', entry.trackName || entry.track, lapTime(entry.lap.time)].join(' · ');
      if (!window.confirm('Delete this lap from your database?\n\n' + details)) return;
      remove.disabled = true;
      const status = $('comparison-import-status');
      try {
        settings.comparisonLaps = await lmu.removeComparisonLap(entry.path);
        status.textContent = '';
        if (referenceSessionPath === entry.path) selectReferenceSession(undefined);
        else renderLibrary();
      } catch (error) {
        status.textContent = error.message;
        remove.disabled = false;
      }
    };
    actions.append(add, remove);
    addLoadedReferenceLabel(actions, entry.path, entry.lap.id);
    const cells = referenceLapCells(entry.driver, entry.trackName || entry.track, entry.trackLayout || entry.track,
      entry.car, entry.lap.time, entry.gameVersion);
    addLoadedLapLabel(cells[0],entry.path,entry.lap.id);
    row.append(...cells,actions);
    return row;
  }));
}

function showLapTransfer(progress, status, stage, received, total) {
  if (status.textContent !== stage) status.textContent = stage;
  progress.hidden = false;
  if (Number.isFinite(total) && total > 0) {
    progress.max = total;
    progress.value = received;
  } else {
    progress.removeAttribute('value');
  }
}
const communityDialog = $('community-laps-dialog');
const communityStatus = $('community-laps-status');
const communityProgressBar = $('community-laps-progress');
const closeCommunityLaps = $('close-community-laps');
let communityOperation;
communityDialog.oncancel = event => {
  if (communityOperation) event.preventDefault();
};
lmu.onCommunityProgress?.(({operation, stage, received, total}) => {
  if (operation.startsWith('requested-lap:')) {
    const id = operation.slice('requested-lap:'.length);
    if (stage === 'done') requestedLapProgress.delete(id);
    else requestedLapProgress.set(id,{stage,received,total});
    const row = $('requested-upload-' + id);
    if (row) updateRequestedLapProgress(row,requestedLapProgress.get(id));
  } else if (operation === 'upload' && exportingBestLap) {
    showLapTransfer(bestLapExportProgress, bestLapExportStatus, stage, received, total);
  } else if (operation === communityOperation) {
    showLapTransfer(communityProgressBar, communityStatus, stage, received, total);
  }
});
const communityFilters = $('community-filter-form');
const communityList = $('community-laps-list');
const communityTable = $('community-laps-table');
const communityPager = $('community-page');
const communityScroll = new IntersectionObserver(entries => {
  if (entries.some(entry => entry.isIntersecting) && communityDialog.open && communityPage < communityPageCount)
    void loadCommunityPage(communityPage + 1, '', true);
}, {root:communityDialog});
let communityQuery = {};
let communityPage = 1;
let communityPageCount = 1;

function beginCommunityOperation(operation) {
  communityOperation = operation;
  for (const control of communityFilters.elements) control.disabled = true;
  closeCommunityLaps.disabled = true;
  for (const button of communityList.querySelectorAll('button')) button.disabled = true;
  showLapTransfer(communityProgressBar, communityStatus, 'Connecting to the community server…');
}
function endCommunityOperation() {
  communityOperation = undefined;
  for (const control of communityFilters.elements) control.disabled = false;
  for (const button of communityList.querySelectorAll('button')) button.disabled = button.textContent === 'Imported';
  communityProgressBar.hidden = true;
  closeCommunityLaps.disabled = false;
}

function communityLapRow(lap, ownerActions) {
  const row = node('tr');
  const action = node('td');
  const server = settings.communityServer;
  const source = server ? new URL('/v1/laps/' + lap.id,
    (server.https ? 'https://' : 'http://') + server.host + ':' + server.port).href : undefined;
  const imported = (settings.comparisonLaps ?? []).some(entry => entry.path === source);
  const add = node('button', imported ? 'Imported' : 'Import Lap');
  addButtonIcon(add, 'importLap');
  add.type = 'button';
  add.onclick = async () => {
    if (communityOperation) return;
    beginCommunityOperation('download');
    try {
      settings.comparisonLaps = await lmu.importCommunityLap(lap.id);
      renderLibrary();
      add.querySelector('.icon-button-label').textContent = 'Imported';
      communityStatus.textContent = 'Lap saved to Imported Laps.';
    } catch (error) {
      communityStatus.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
    } finally {
      endCommunityOperation();
    }
  };
  action.append(add);
  if (ownerActions && settings.communityOwnerConfigured) {
    const remove = node('button', 'Remove from Server', 'community-remove');
    remove.type = 'button';
    remove.onclick = async () => {
      if (communityOperation || !window.confirm('Remove this lap from the community server for everyone?')) return;
      beginCommunityOperation('remove');
      showLapTransfer(communityProgressBar, communityStatus, 'Removing lap from the server…');
      try {
        await lmu.removeCommunityLap(lap.id);
      } catch (error) {
        communityStatus.textContent = error.message;
        return;
      } finally {
        endCommunityOperation();
      }
      await loadCommunityPage(1, 'Lap removed from the community server.');
    };
    action.append(remove);
  }
  addLoadedReferenceLabel(action, source);
  row.append(...referenceLapCells(lap.driver, lap.track, lap.layout, lap.car, lap.time, lap.gameVersion), action);
  return row;
}

function updateCommunityFilterChoices(choices) {
  const labels = {track:'All Tracks', layout:'All Layouts', driver:'All Drivers', gameVersion:'All Versions'};
  let reset = false;
  for (const [key, label] of Object.entries(labels)) {
    const select = communityFilters.elements.namedItem(key);
    const selected = select.value;
    select.replaceChildren();
    option(select, label, '');
    for (const value of choices[key] ?? []) option(select, value, value);
    if ([...select.options].some(entry => entry.value === selected)) select.value = selected;
    if (communityQuery[key] && !choices[key]?.includes(communityQuery[key])) {
      delete communityQuery[key];
      reset = true;
    }
  }
  return reset;
}

async function loadCommunityPage(page, message = '', append = false) {
  if (communityOperation) return;
  const retry = $('retry-community-load');
  retry.hidden = true;
  communityScroll.disconnect();
  if (!append) {
    communityPage = communityPageCount = 1;
    communityList.replaceChildren();
    communityTable.hidden = communityPager.hidden = true;
  }
  beginCommunityOperation('list');
  let reset = false;
  try {
    const result = await lmu.listCommunityLaps({...communityQuery, page});
    const {laps, page:current, pageCount, total, limited, ownerActions} = result;
    reset = updateCommunityFilterChoices(result.filterOptions);
    if (reset) return;
    communityPage = current;
    communityPageCount = pageCount;
    communityStatus.textContent = message || (!laps.length ? 'No community laps match these filters.' :
      limited ? 'This server version shows up to 1,000 recent uploads. Update the server to search older laps.' : '');
    communityList.append(...laps.map(lap => communityLapRow(lap, ownerActions)));
    communityTable.hidden = communityPager.hidden = !communityList.rows.length;
    communityPager.textContent = communityList.rows.length + ' of ' + total + (total === 1 ? ' lap' : ' laps');
    if (current < pageCount && laps.length) communityScroll.observe(communityPager);
  } catch (error) {
    communityStatus.textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
    retry.onclick = () => void loadCommunityPage(page, message, append);
    retry.hidden = false;
  } finally {
    endCommunityOperation();
    if (reset) void loadCommunityPage(1, message);
  }
}
$('browse-community-laps').onclick = () => {
  communityDialog.showModal();
  void loadCommunityPage(1);
};
communityFilters.onsubmit = event => event.preventDefault();
communityFilters.onchange = event => {
  if (communityOperation) return;
  if (event.target.name === 'track') communityFilters.elements.namedItem('layout').value = '';
  communityQuery = Object.fromEntries(new FormData(communityFilters));
  void loadCommunityPage(1);
};
$('clear-community-filters').onclick = () => {
  communityFilters.reset();
  communityQuery = {};
  void loadCommunityPage(1);
};
communityDialog.addEventListener('close', () => communityScroll.disconnect());

$('community-server-form').onsubmit = async event => {
  event.preventDefault();
  const key = $('community-key');
  const owner = $('community-owner-password');
  const status = $('community-settings-status');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const updated = await lmu.setCommunityServer({
      host:$('community-host').value, port:$('community-port').valueAsNumber,
      https:$('community-https').checked, key:key.value, ownerPassword:owner.value
    });
    Object.assign(settings, updated);
    friendConnectionGeneration++;
    friendSyncAfter = 0;
    friendRecords = [];
    communityMinimumGameVersion = updated.communityMinimumGameVersion ?? null;
    recordRequests = [];
    serverConnectionState = 'disconnected';
    serverSyncUntil = 0;
    lastServerSync = null;
    serverSyncError = false;
    serverEvents.length = 0;
    renderServerStatus();
    refreshRecordsFromScan();
    void refreshFriendRecords(true);
    settingsFields();
    key.value = owner.value = '';
    status.textContent = 'Community server settings saved.';
    void checkTprUpdate();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
$('folders').addEventListener('close', () => { $('community-key').value = $('community-owner-password').value = ''; });

const importComparisonButton = $('import-comparison-laps');
importComparisonButton.onclick = async () => {
  importComparisonButton.disabled = true;
  const status = $('comparison-import-status');
  try {
    const result = await lmu.importComparisonLaps();
    settings.comparisonLaps = result.laps;
    status.textContent = result.errors.join(' · ');
    renderLibrary();
    if (selected && referenceSessionPath) {
      fillReferences();
      void readReference();
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    importComparisonButton.disabled = false;
  }
};
const recordFields = [
  ['track', 'All Tracks', session => session.trackName || session.track],
  ['layout', 'All Layouts', session => session.trackLayout || session.track],
  ['class', 'All Classes', session => session.carClass],
  ['car', 'All Cars', session => session.model || session.car]
];

function recordDimensions(session) {
  return recordFields.map(([, , read]) => read(session) || 'Unknown');
}

function recordedGameVersion(raw) {
  const trimmed = (raw || '').trim();
  const packed = /^(\d+)\.(\d)(\d{3})$/.exec(trimmed);
  if (packed) {
    const [, major, minor, patch] = packed;
    return [major, minor, ...patch.replace(/0+$/, '')].join('.');
  }
  return /^\d+(\.\d+)*$/.test(trimmed) ? trimmed : '';
}

function compareVersions(actual, expected) {
  const actualParts = actual.split('.').map(Number);
  const expectedParts = expected.split('.').map(Number);
  for (let index = 0; index < Math.max(actualParts.length, expectedParts.length); index++) {
    const difference = (actualParts[index] ?? 0) - (expectedParts[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function eligibleRecordLap(item) {
  return item.kind === 'complete' && Number.isFinite(item.time) && item.time > 0 &&
    (item.validity === 'official' || item.validity === 'unconfirmed');
}

function fastestValidLap(session) {
  return session.laps.reduce((best, item) =>
    eligibleRecordLap(item) && item.validity === 'official' && (!best || item.time < best.time) ? item : best, null);
}

const recordsFilters = $('records-filters');
let recordsRefreshPending = false;
function updateRecordsLoading() {
  const loading = $('records-loading');
  const initial = scanBusy && scanKey === undefined;
  loading.hidden = !initial;
  loading.textContent = initial ? 'Loading session recordings…' : '';
  recordsFilters.setAttribute('aria-busy', String(initial));
  for (const control of recordsFilters.querySelectorAll('select,button')) {
    control.disabled = initial || (control.id === 'record-version' && settings.shareTrackRecords === true && settings.communityConfigured);
  }
  $('records-status').hidden = initial;
}
function refreshRecordsFromScan() {
  if (view !== 'records') return;
  if (recordsFilters.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') {
    recordsRefreshPending = true;
    return;
  }
  renderRecords();
}
recordsFilters.addEventListener('focusout', () => {
  queueMicrotask(() => {
    if (recordsRefreshPending) refreshRecordsFromScan();
  });
});

function setRecordOptions(select, label, values, current) {
  const existing = [...select.options];
  if (existing.length !== values.length + 1 || values.some((value, index) => existing[index + 1].value !== value)) {
    select.replaceChildren();
    option(select, label, '');
    for (const value of values) option(select, value, value);
  }
  const value = values.includes(current) ? current : '';
  if (select.value !== value) select.value = value;
}

const serverOperations = new Map();
const serverEvents = [];
let serverConnectionState = 'disconnected';
let serverSyncUntil = 0;
let serverStatusTimer;
let lastServerSync = null;
let serverSyncError = false;
const importantServerActions = new Map([
  ['Sending Request','Telemetry Request Sent'],['Sending Response','Request Response Sent'],
  ['Uploading Lap','Lap Uploaded'],['Downloading Lap','Lap Downloaded'],
  ['Uploading Requested Lap','Requested Lap Uploaded'],['Downloading Requested Lap','Requested Lap Downloaded']
]);
const backgroundSyncActions = new Set(['Syncing Track Records','Checking Requests']);
function renderServerStatus() {
  clearTimeout(serverStatusTimer);
  const operations = [...serverOperations.values()];
  const foreground = operations.findLast(action => !backgroundSyncActions.has(action));
  const syncActive = operations.some(action => backgroundSyncActions.has(action));
  const remaining = serverSyncUntil - performance.now();
  const showSync = syncActive || (remaining > 0 && serverConnectionState === 'connected');
  const action = foreground || (showSync ? 'Syncing' : '');
  if (!foreground && !syncActive && showSync) serverStatusTimer = setTimeout(renderServerStatus,remaining);
  const state = action ? 'busy' : serverConnectionState;
  const connection = $('server-connection');
  connection.dataset.state = state;
  connection.dataset.protocol = settings.communityServer?.https ? 'https' : 'http';
  const shortStatus = {
    'Checking Community Laps':'Checking Laps',
    'Downloading Requested Lap':'Downloading Lap','Uploading Requested Lap':'Uploading Lap'
  };
  const label = shortStatus[action] || action || (state === 'connected' ? 'Connected' : 'Disconnected');
  $('server-connection-label').textContent = label;
  connection.title = state !== 'disconnected'
    ? label + (connection.dataset.protocol === 'https' ? ' via HTTPS (encrypted)' : ' via HTTP (unencrypted)')
    : action || label;
  connection.setAttribute('aria-label',connection.title);
}
lmu.onCommunityActivity?.(({id,action,state,status,message,transferStep}) => {
  if (state === 'busy') {
    serverOperations.set(id,action);
    if (backgroundSyncActions.has(action)) serverSyncUntil = performance.now() + 900;
  } else {
    serverOperations.delete(id);
    serverConnectionState = state === 'connected' ? 'connected' :
      message?.startsWith('Could not reach') || message?.includes('rejected the access key') ? 'disconnected' : serverConnectionState;
  }
  if (!transferStep) {
    if (state === 'error') logServerEvent(action + ' · ' + (message || 'Failed'),true);
    else if (state === 'connected' && (!status || (status >= 200 && status < 300)) && importantServerActions.has(action)) {
      logServerEvent(importantServerActions.get(action));
    }
  }
  renderServerStatus();
});
function logServerEvent(text, deduplicate = false) {
  if (deduplicate && serverEvents[0]?.text === text) return;
  serverEvents.unshift({time:new Date(),text});
  serverEvents.length = Math.min(100,serverEvents.length);
  if ($('server-events-dialog').open) renderServerEvents();
}
function renderServerEvents() {
  const lastSync = lastServerSync ? ' Last successful sync at ' + lastServerSync.toLocaleTimeString() + '.' : '';
  $('server-sync-health').textContent = !settings.communityConfigured ? 'Community Server is not configured.' :
    serverSyncError ? 'Sync failed. Retrying automatically.' + lastSync :
    lastServerSync ? 'Syncing is working.' + lastSync : 'Waiting for the first sync.';
  $('server-events-empty').hidden = !!serverEvents.length;
  $('server-events').replaceChildren(...serverEvents.map(({time,text}) =>
    node('li',time.toLocaleTimeString() + ' · ' + text)));
}
$('server-connection').onclick = () => {
  renderServerEvents();
  $('server-events-dialog').showModal();
};

$('manage-track-records').onclick = () => {
  $('owner-records-dialog').showModal();
  void renderOwnerRecords('list');
};
async function renderOwnerRecords(action,id) {
  const list = $('owner-records-list');
  const status = $('owner-records-status');
  for (const button of list.querySelectorAll('button')) button.disabled = true;
  status.textContent = 'Loading Track Records…';
  try {
    const {records,requests} = await lmu.manageTrackRecords(action,id);
    const rows = [];
    for (const [entries,operation,label] of [[records,'remove','Remove Record'],[requests,'revoke','Revoke Lap Access']]) {
      for (const item of entries) {
        const record = item.record ?? item;
        const row = node('li',[record.driver,record.track,record.layout,record.carClass,lapTime(record.time),
          item.requesterName ? 'Requested by ' + item.requesterName : ''].filter(Boolean).join(' · '));
        const button = node('button',label,'button-secondary');
        button.onclick = () => {
          if (window.confirm(label + '?')) void renderOwnerRecords(operation,item.id);
        };
        row.append(button);
        rows.push(row);
      }
    }
    list.replaceChildren(...rows);
    status.textContent = rows.length ? '' : 'No shared records or active lap downloads.';
    if (action !== 'list') void refreshFriendRecords(true);
  } catch (error) {
    status.textContent = error.message;
    for (const button of list.querySelectorAll('button')) button.disabled = false;
  }
}

let recordRequests = [];
const pendingRecordTransfers = new Set();
const requestedLapProgress = new Map();

function updateRequestedLapProgress(row, progress) {
  row.hidden = !progress;
  if (!progress) return;
  const {stage,received,total} = progress;
  const bar = row.querySelector('progress');
  const status = row.querySelector('span');
  if (stage === 'preparing' || stage === 'sharing') {
    bar.removeAttribute('value');
    status.textContent = stage === 'sharing' ? 'Sharing in Community Laps…' : 'Preparing Requested Lap…';
    return;
  }
  const percent = Math.floor(received * 100 / total);
  bar.value = percent;
  status.textContent = percent === 100 ? 'Waiting for Server Confirmation…' : 'Uploading Requested Lap · ' + percent + '%';
}

const pendingRecordRequests = new Set();
let recordNotifications = {};

function recordNotificationStorageKey() {
  return 'track-record-notifications:' + (settings.primaryDriverProfile ?? 'unconfirmed');
}

function loadRecordNotifications() {
  recordNotifications = {};
  try {
    recordNotifications = JSON.parse(localStorage.getItem(recordNotificationStorageKey()) || '{}') || {};
  } catch { /* Notifications remain available for the current run. */ }
  renderRecordNotifications();
}

function writeRecordNotifications() {
  try { localStorage.setItem(recordNotificationStorageKey(),JSON.stringify(recordNotifications)); } catch {}
  renderRecordNotifications();
}
let notificationAudio;
let notificationArrival;
function playNotificationChime() {
  notificationAudio ??= new AudioContext();
  if (notificationAudio.state !== 'running') return;
  const start = notificationAudio.currentTime;
  [660, 880, 1100].forEach((frequency, index) => {
    const time = start + index * 0.075;
    const tone = notificationAudio.createOscillator();
    const gain = notificationAudio.createGain();
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.06, time + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
    tone.connect(gain).connect(notificationAudio.destination);
    tone.start(time);
    tone.stop(time + 0.17);
  });
}
$('notification-sound').onchange = event => {
  save({notificationSound:event.target.checked});
  if (!event.target.checked) return;
  notificationAudio ??= new AudioContext();
  void notificationAudio.resume().then(playNotificationChime).catch(() => {});
};
document.addEventListener('click', () => {
  if (settings.notificationSound !== true) return;
  notificationAudio ??= new AudioContext();
  if (notificationAudio.state === 'suspended') void notificationAudio.resume().catch(() => {});
});

function addRecordNotification(key,text,options = {}) {
  if (Object.hasOwn(recordNotifications,key)) return;
  recordNotifications[key] = {text,...options};
  const keys = Object.keys(recordNotifications);
  if (keys.length > 400) {
    const dismissed = keys.find(id => recordNotifications[id].dismissed);
    if (dismissed) delete recordNotifications[dismissed];
  }
  writeRecordNotifications();
  if (window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
    notificationArrival?.cancel();
    const bell = $('notifications-button').querySelector('svg');
    notificationArrival = bell.animate(
      ['#ff8989', '#ffbf70', '#ffe675', '#a4ee8b', '#88dcff', '#dda6ff', 'inherit'].map(color => ({color})),
      {duration:1200, easing:'ease-in-out'});
  }
  if (settings.notificationSound === true) playNotificationChime();
}
function resolveRecordNotification(key) {
  recordNotifications[key].dismissed = true;
  writeRecordNotifications();
}
function renderRecordNotifications() {
  const pending = Object.entries(recordNotifications).filter(([,entry]) => !entry.dismissed).reverse();
  const count = pending.length;
  $('notification-count').textContent = count === 0 ? 'No Notifications' :
    count.toLocaleString() + (count === 1 ? ' Notification' : ' Notifications');
  $('notifications-button').dataset.pending = String(count > 0);
  $('notifications-empty').hidden = !!pending.length;
  $('dismiss-all-notifications').disabled = !pending.some(([,entry]) => !entry.requestId);
  $('notification-list').replaceChildren(...pending.map(([key,entry]) => {
    const item = node('li',entry.text);
    const actions = node('div',undefined,'actions');
    item.append(actions);
    if (entry.requestId) {
      const row = node('div',undefined,'requested-upload-progress');
      row.id = 'requested-upload-' + entry.requestId;
      const bar = node('progress');
      bar.max = 100;
      bar.setAttribute('aria-label','Requested lap upload progress');
      row.append(node('span'),bar);
      item.insertBefore(row,actions);
      updateRequestedLapProgress(row,requestedLapProgress.get(entry.requestId));
      const share = node('input');
      share.type = 'checkbox';
      share.checked = entry.shareDraft ?? entry.shareWithCommunity ?? true;
      share.disabled = pendingRecordTransfers.has(entry.requestId);
      share.onchange = () => { entry.shareDraft = share.checked; };
      const shareLabel = node('label', undefined, 'request-community-share');
      shareLabel.append(share, 'Also Share This Lap in Community Laps');
      item.insertBefore(shareLabel,actions);
      for (const [action,label] of [['accept','Accept and Upload Lap'],['deny','Deny']]) {
        const accepted = recordRequests.some(request => request.id === entry.requestId && request.status === 'accepted');
        const button = node('button',action === 'accept' && accepted ? 'Retry Upload' : label,action === 'deny' ? 'button-secondary' : '');
        button.disabled = pendingRecordTransfers.has(entry.requestId);
        button.onclick = () => void respondToRecordRequest(action,entry.requestId,key,share.checked);
        actions.append(button);
      }
    } else {
      if (entry.record) {
        const viewRecord = node('button','View Track Record');
        viewRecord.onclick = () => {
          resolveRecordNotification(key);
          $('notifications-dialog').close();
          $('hide-friend-records').checked = false;
          setView('records');
          renderRecords({trackName:entry.record.track,trackLayout:entry.record.layout,
            carClass:entry.record.carClass});
        };
        actions.append(viewRecord);
      }
      const dismiss = node('button','Dismiss','button-secondary');
      dismiss.onclick = () => resolveRecordNotification(key);
      actions.append(dismiss);
    }
    return item;
  }));
}
$('dismiss-all-notifications').onclick = () => {
  for (const entry of Object.values(recordNotifications)) {
    if (!entry.requestId) entry.dismissed = true;
  }
  writeRecordNotifications();
};
$('notifications-button').onclick = () => {
  renderRecordNotifications();
  $('notifications-dialog').showModal();
};

function latestTrackRecordRequest(friend) {
  return recordRequests.findLast(item => !item.incoming && item.recordId === friend.id && item.record.lapKey === friend.lapKey);
}

function importedRequestedLap(request) {
  if (!request) return undefined;
  const suffix = '/v1/track-records/requests/download/' + request.id;
  return settings.comparisonLaps?.find(lap => lap.path?.endsWith(suffix));
}

async function applyTelemetryRequestResponse(result, id) {
  await updateRecordRequests(result?.requests ?? result);
  if (result?.communityShared) {
    addRecordNotification('community-shared-' + id,'Requested lap also shared in Community Laps.');
  } else if (result?.communityShareError) {
    addRecordNotification('community-share-error-' + id,
      'Requested lap sent to your friend. Community sharing failed · ' + result.communityShareError);
  }
}
async function respondToRecordRequest(action,id,key,shareWithCommunity) {
  if (pendingRecordTransfers.has(id)) return;
  pendingRecordTransfers.add(id);
  if (action === 'accept') {
    recordNotifications[key].shareWithCommunity = shareWithCommunity === true;
    delete recordNotifications[key].shareDraft;
    writeRecordNotifications();
  } else renderRecordNotifications();
  try {
    await applyTelemetryRequestResponse(await lmu.trackRecordRequest(action,id,undefined,
      action === 'accept' && shareWithCommunity === true),id);
    if (recordNotifications[key] && !recordNotifications[key].dismissed) resolveRecordNotification(key);
  } catch (error) {
    addRecordNotification('request-error-' + id + '-' + action,error.message);
    void refreshFriendRecords(true);
  } finally {
    pendingRecordTransfers.delete(id);
    renderRecordNotifications();
  }
}

async function updateRecordRequests(requests) {
  if (!Array.isArray(requests)) return;
  recordRequests = requests;
  const knownRequests = new Set(requests.map(request => request.id));
  for (const [key,entry] of Object.entries(recordNotifications)) {
    if (entry.requestId && !entry.dismissed && !knownRequests.has(entry.requestId) && !pendingRecordTransfers.has(entry.requestId)) {
      resolveRecordNotification(key);
    }
  }
  for (const request of requests) {
    const record = request.record;
    const description = [record.driver,record.track,record.layout !== record.track ? record.layout : '',
      record.carClass,record.car,lapTime(record.time),dateLabel(record.recorded,australianDate)].filter(Boolean).join(' · ');
    const key = 'request-' + request.id;
    if (request.incoming) {
      if (request.status === 'accepted' && !pendingRecordTransfers.has(request.id)) {
        pendingRecordTransfers.add(request.id);
        void lmu.trackRecordRequest('accept',request.id,undefined,recordNotifications[key]?.shareWithCommunity === true).then(updated => {
          pendingRecordTransfers.delete(request.id);
          return applyTelemetryRequestResponse(updated,request.id);
        }).catch(error => {
          pendingRecordTransfers.delete(request.id);
          addRecordNotification(key + '-retry','Could not finish uploading the approved lap · ' + error.message);
          renderRecordNotifications();
        });
      }
      if (['pending','accepted'].includes(request.status)) {
        addRecordNotification(key,(request.requesterName || 'A friend') + ' requested one lap of your telemetry · ' + description,{requestId:request.id});
      } else if (recordNotifications[key] && !recordNotifications[key].dismissed) {
        resolveRecordNotification(key);
        if (request.status === 'uploaded') addRecordNotification(key + '-sent','Requested lap uploaded · ' + description);
      }
      continue;
    }
    if (request.status === 'accepted' || request.status === 'uploaded')
      addRecordNotification(key + '-accepted','Telemetry request accepted · ' + description);
    if (request.status === 'denied') addRecordNotification(key + '-denied','Telemetry request denied · ' + description);
    if (['expired','revoked'].includes(request.status)) {
      if (!importedRequestedLap(request)) addRecordNotification(key + '-' + request.status,'Requested telemetry is ' + request.status + ' · ' + description);
    }
    if (request.status !== 'uploaded') continue;
    addRecordNotification(key + '-uploaded','Requested lap uploaded · ' + description);
    if (importedRequestedLap(request) || pendingRecordTransfers.has(request.id)) continue;
    pendingRecordTransfers.add(request.id);
    try {
      addRecordNotification(key + '-downloading','Downloading Requested Lap · ' + description);
      settings.comparisonLaps = await lmu.trackRecordRequest('download',request.id);
      for (const suffix of ['-downloading','-download-error']) {
        if (recordNotifications[key + suffix] && !recordNotifications[key + suffix].dismissed) resolveRecordNotification(key + suffix);
      }
      addRecordNotification(key + '-downloaded','Requested lap downloaded and ready to use as a reference · ' + description);
      renderLibrary();
    } catch (error) {
      addRecordNotification(key + '-download-error','Requested lap could not download. Retrying automatically. · ' + description);
    } finally {
      pendingRecordTransfers.delete(request.id);
    }
  }
  renderRecordNotifications();
  refreshRecordsFromScan();
}

let friendRecords = [];
let communityMinimumGameVersion = null;
let unlockedRecordVersion = '';
function friendRecordBaselineKey() {
  const server = settings.communityServer;
  return 'track-record-baseline:' + JSON.stringify([server?.https,server?.host,server?.port,settings.primaryDriverProfile]);
}
function rememberFriendRecordTimes(records) {
  try {
    localStorage.setItem(friendRecordBaselineKey(),JSON.stringify(Object.fromEntries(records.map(record => [friendDriverContestKey(record),record.time]))));
  } catch { /* The current session can still sync. */ }
}
let friendSyncBusy = false;
let privateRequestsAvailable = false;
let friendSyncAfter = 0;
let friendConnectionGeneration = 0;

async function refreshFriendRecords(changed = false) {
  if (!settings.communityConfigured || !lmu.syncTrackRecords || friendSyncBusy ||
      (!changed && Date.now() < friendSyncAfter)) return;
  friendSyncBusy = true;
  friendSyncAfter = Date.now() + 30_000;
  const generation = friendConnectionGeneration;
  try {
    const result = await lmu.syncTrackRecords();
    const {records,minimumGameVersion} = Array.isArray(result) ? {records:result,minimumGameVersion:null} : result;
    if (generation !== friendConnectionGeneration) return;
    const availabilityChanged = privateRequestsAvailable !== (result.privateRequestsAvailable === true);
    privateRequestsAvailable = result.privateRequestsAvailable === true;
    const policyChanged = minimumGameVersion !== communityMinimumGameVersion;
    communityMinimumGameVersion = minimumGameVersion;
    if (availabilityChanged || policyChanged || JSON.stringify(records) !== JSON.stringify(friendRecords)) {
      if (!policyChanged) notifyBeatenRecords(records);
      friendRecords = records;
      refreshRecordsFromScan();
    }
    rememberFriendRecordTimes(records);
    let syncStatus = '';
    if (!privateRequestsAvailable) syncStatus = 'Update the Community Server to share Track Records and request telemetry.';
    else if (settings.shareTrackRecords && !settings.primaryDriver) syncStatus = 'Confirm your primary driver to share Track Records.';
    else if (settings.shareTrackRecords && result.eligibility?.eligibleRecords === 0) {
      syncStatus = result.eligibility.excludedSessions
        ? 'No eligible records to share. Your official laps are below the server minimum game version (' +
          minimumGameVersion + ') or have no recognised game version.'
        : 'No official laps for your primary driver are available to share. Check that the LMU Results folder is set.';
    }
    $('friend-records-status').textContent = syncStatus;
    const requests = lmu.trackRecordRequest ? await lmu.trackRecordRequest('list') : null;
    if (generation !== friendConnectionGeneration) return;
    lastServerSync = new Date();
    serverSyncError = false;
    void checkTprUpdate();
    if ($('server-events-dialog').open) renderServerEvents();
    if (requests) await updateRecordRequests(requests);
  } catch (error) {
    if (generation === friendConnectionGeneration) {
      serverSyncError = true;
      if ($('server-events-dialog').open) renderServerEvents();
      $('friend-records-status').textContent = error.message.includes('route is no longer available')
        ? 'Update the Community Server to sync Track Records.'
        : 'Friends’ records could not sync. Retrying automatically.';
    }
  } finally {
    friendSyncBusy = false;
    if (generation !== friendConnectionGeneration) void refreshFriendRecords(true);
  }
}

$('share-track-records').onchange = event => {
  const {checked} = event.target;
  void lmu.save({shareTrackRecords:checked}).then(() => {
    settings.shareTrackRecords = checked;
    renderRecords();
    if (checked) void refreshFriendRecords(true);
  }).catch(error => {
    event.target.checked = settings.shareTrackRecords === true;
    setStatus($('community-settings-status'),error.message,{error:true});
  });
};
$('hide-friend-records').onchange = () => renderRecords();

function recordContestKey(dimensions) {
  return JSON.stringify(dimensions.slice(0,3).map(value => value.trim().toLowerCase()));
}
function localRecordCandidates() {
  const driver = normaliseDriverName(settings.primaryDriver);
  const recordings = driver ? sessions.filter(session => normaliseDriverName(session.driver) === driver) : sessions;
  return recordings.flatMap(session => {
    const bestLap = fastestValidLap(session);
    return bestLap ? [{session,bestLap,dimensions:recordDimensions(session)}] : [];
  });
}
function friendContestKey(record) {
  return recordContestKey([record.track,record.layout,record.carClass || 'Unknown']);
}
function friendDriverContestKey(record) {
  return JSON.stringify([normaliseDriverName(record.driver),friendContestKey(record)]);
}
function recordMeetsMinimum(session, minimum) {
  const version = recordedGameVersion(session.gameVersion);
  return !minimum || Boolean(version && compareVersions(version, minimum) >= 0);
}
function notifyBeatenRecords(records) {
  let previous;
  try { previous = JSON.parse(localStorage.getItem(friendRecordBaselineKey())); } catch { return; }
  if (!previous || !settings.primaryDriver) return;
  const local = new Map();
  for (const {session,bestLap,dimensions} of localRecordCandidates()) {
    if (!recordMeetsMinimum(session, settings.shareTrackRecords && communityMinimumGameVersion)) continue;
    const key = recordContestKey(dimensions);
    local.set(key,Math.min(local.get(key) ?? Infinity,bestLap.time));
  }
  for (const record of records) {
    const time = local.get(friendContestKey(record));
    if (normaliseDriverName(record.driver) === normaliseDriverName(settings.primaryDriver) ||
        time === undefined || !(record.time < time) || (previous[friendDriverContestKey(record)] ?? Infinity) < time) continue;
    addRecordNotification('beaten-' + record.id + '-' + record.time,
      record.driver + ' beat your ' + (record.carClass || 'class') + ' record at ' + record.track + ' · ' + lapTime(record.time),
      {record:{track:record.track,layout:record.layout,carClass:record.carClass,car:record.car,gameVersion:record.gameVersion}});
  }
}
function trophyIcon() {
  const cup = document.createElementNS('http://www.w3.org/2000/svg','svg');
  cup.setAttribute('viewBox','0 0 64 64');
  const silhouette = document.createElementNS(cup.namespaceURI,'path');
  silhouette.setAttribute('d','M17 8h30v6h9v9c0 9-6 15-14 16a15 15 0 0 1-7 5v7h9v6H20v-6h9v-7a15 15 0 0 1-7-5C14 38 8 32 8 23v-9h9V8Zm0 12h-3v3c0 4 2 7 5 9a24 24 0 0 1-2-12Zm30 0a24 24 0 0 1-2 12c3-2 5-5 5-9v-3h-3Z');
  cup.append(silhouette);
  cup.setAttribute('aria-hidden','true');
  return cup;
}
for (const medal of $('record-medals').children) medal.prepend(trophyIcon());

function renderRecordMedals(candidates) {
  const hidden = $('hide-friend-records').checked;
  $('record-medals').hidden = hidden;
  if (hidden) return;
  const groups = new Map();
  for (const {session,bestLap,dimensions,friend} of candidates) {
    const key = recordContestKey(dimensions);
    if (!groups.has(key)) groups.set(key,new Map());
    const group = groups.get(key);
    const driver = friend ? session.driver.trim().toLowerCase() : '';
    group.set(driver,Math.min(group.get(driver) ?? Infinity,bestLap.time));
  }
  const medals = [0,0,0];
  for (const group of groups.values()) {
    if (!group.has('') || group.size < 2) continue;
    const local = group.get('');
    const rank = [...group.values()].filter(time => time < local).length;
    if (rank < medals.length) medals[rank]++;
  }
  ['gold','silver','bronze'].forEach((medal,index) => {
    $('record-' + medal).textContent = medals[index];
  });
}

function importedFriendRecordLap(friend, request) {
  const requested = importedRequestedLap(request);
  if (requested) return requested;
  const recorded = +recordingDate(friend.recorded);
  if (!Number.isFinite(recorded)) return undefined;
  const {driver,car,time} = friend;
  return settings.comparisonLaps?.find(entry => entry.path && entry.lap?.kind === 'complete' &&
    normaliseDriverName(entry.driver) === normaliseDriverName(driver) &&
    [entry.model,entry.car].some(name => normaliseDriverName(name) === normaliseDriverName(car)) &&
    recordContestKey(recordDimensions(entry)) === friendContestKey(friend) &&
    +recordingDate(entry.recorded) === recorded && Math.round(entry.lap.time * 1000) === Math.round(time * 1000));
}

function renderRecords(lastSession) {
  recordsRefreshPending = false;
  const lastDimensions = lastSession && recordDimensions(lastSession);
  const candidates = localRecordCandidates();
  const localBest = new Map();
  if (!$('hide-friend-records').checked) {
    const primary = normaliseDriverName(settings.primaryDriver);
    const verified = new Set(friendRecords.filter(record => record.requestable).map(friendDriverContestKey));
    for (const friend of friendRecords) {
      if ((primary && normaliseDriverName(friend.driver) === primary) ||
          (!friend.requestable && verified.has(friendDriverContestKey(friend)))) continue;
      const session = {...friend,trackName:friend.track,trackLayout:friend.layout,trackLayoutVersion:friend.layoutVersion};
      const bestLap = {time:friend.time,sectors:friend.sectors,validity:friend.validity};
      candidates.push({session,bestLap,dimensions:recordDimensions(session),friend});
    }
  }
  const filters = recordFields.map(([key, label], index) => {
    const select = $('record-' + key);
    const current = lastDimensions ? (key === 'car' ? '' : lastDimensions[index]) : select.value;
    const selectedTrack = $('record-track').value;
    const available = key === 'layout' && selectedTrack
      ? candidates.filter(row => row.dimensions[0] === selectedTrack) : candidates;
    const values = new Set(available.map(row => row.dimensions[index]));
    if (lastDimensions && current) values.add(current);
    setRecordOptions(select, label, [...values].sort((a, b) => a.localeCompare(b)), current);
    return select.value;
  });

  const driverSelect = $('record-driver');
  const drivers = new Map();
  for (const {session} of candidates) {
    const key = normaliseDriverName(session.driver);
    if (key && !drivers.has(key)) drivers.set(key,session.driver.trim());
  }
  const currentDriver = lastSession ? '' : driverSelect.value;
  driverSelect.replaceChildren(new Option('All Drivers',''));
  for (const [key,label] of [...drivers].sort((a,b) => a[1].localeCompare(b[1]))) {
    option(driverSelect,label,key);
  }
  if (drivers.has(currentDriver)) driverSelect.value = currentDriver;

  const versionSelect = $('record-version');
  const locked = settings.shareTrackRecords === true && settings.communityConfigured;
  versionSelect.disabled = locked;
  const versionLock = $('record-version-lock');
  versionLock.hidden = !locked;
  if (locked) {
    versionSelect.replaceChildren(new Option(communityMinimumGameVersion ||
      (communityMinimumGameVersion === null ? 'Waiting for Server' : 'No Minimum Set'), communityMinimumGameVersion ?? ''));
  } else {
    const currentVersion = lastSession ? recordedGameVersion(lastSession.gameVersion) : unlockedRecordVersion;
    const versions = new Set([...resultGameVersions, ...candidates.map(({session}) => session.gameVersion)]
      .map(recordedGameVersion).filter(Boolean));
    setRecordOptions(versionSelect, 'All Versions', [...versions].sort((a, b) => compareVersions(b, a)), currentVersion);
    unlockedRecordVersion = versionSelect.value;
  }

  const minimum = versionSelect.value;
  if (locked && communityMinimumGameVersion === null) candidates.length = 0;
  renderRecordMedals(candidates.filter(({session}) => recordMeetsMinimum(session, minimum)));
  $('record-last-session').disabled = !sessions.length;
  const fastest = new Map();
  const unfilteredRecords = new Set();
  for (const row of candidates) {
    const contest = recordContestKey(row.dimensions);
    if (!row.friend && row.session.path && recordMeetsMinimum(row.session,minimum) &&
        (!locked || communityMinimumGameVersion !== null) &&
        (!localBest.has(contest) || row.bestLap.time < localBest.get(contest).bestLap.time)) {
      localBest.set(contest,row);
    }
    const key = JSON.stringify([contest,row.friend ? row.session.driver.trim().toLowerCase() : null]);
    if (!locked || recordMeetsMinimum(row.session, minimum)) unfilteredRecords.add(key);
    if ((driverSelect.value && driverSelect.value !== normaliseDriverName(row.session.driver)) ||
        filters.some((value, index) => value && value !== row.dimensions[index]) ||
        !recordMeetsMinimum(row.session, minimum)) continue;
    const version = recordedGameVersion(row.session.gameVersion);
    if (!fastest.has(key) || row.bestLap.time < fastest.get(key).bestLap.time) {
      fastest.set(key, {...row, version});
    }
  }

  const records = [...fastest.values()].filter(({session,friend}) => {
    if (!compatibleReferencesOnly) return true;
    const candidate = friend ? importedFriendRecordLap(friend,latestTrackRecordRequest(friend)) : session;
    return candidate?.path && (candidate.path === selected.path || matchesReferenceSession(candidate));
  }).sort((a, b) => {
    for (let index = 0; index < 3; index++) {
      const order = a.dimensions[index].localeCompare(b.dimensions[index], undefined, {sensitivity:'accent'});
      if (order) return order;
    }
    return a.bestLap.time - b.bestLap.time || a.session.driver.localeCompare(b.session.driver);
  });
  const rows = [];
  let previousTrack;
  for (const {session, bestLap, dimensions, version, friend} of records) {
    const [track, layout, carClass, car] = dimensions;
    const trackKey = JSON.stringify([track, layout]);
    if (previousTrack !== trackKey) {
      const group = node('tr', undefined, 'records-track-group');
      const title = node('th', [track,layout !== track ? layout : ''].filter(Boolean).join(' · '));
      title.colSpan = 11;
      group.append(title);
      rows.push(group);
      previousTrack = trackKey;
    }

    const row = node('tr', undefined, 'record-result');
    const time = node('td', undefined, 'numeric-cell session-best');
    const referenceCell = node('td', undefined, 'session-comparison');
    const telemetryCell = node('td', undefined, 'record-telemetry');
    if (friend) {
      const request = latestTrackRecordRequest(friend);
      const imported = importedFriendRecordLap(friend,request);
      const ownRecord = localBest.get(recordContestKey(dimensions));
      time.textContent = lapTime(bestLap.time);
      if (imported) {
        bindTelemetryRow(row,() => openImportedLap(imported));
        addLoadedLapLabel(time,imported.path,imported.lap.id);
      }
      telemetryCell.textContent = imported ? 'Ready to Open' : request?.status === 'uploaded' ? 'Ready to Download' :
        friend.requestable ? 'Request Required' : 'Unavailable';
      if (!imported && (!friend.requestable || !privateRequestsAvailable || !settings.primaryDriver || !lmu.trackRecordRequest)) {
        referenceCell.textContent = friend.requestable && !settings.primaryDriver ? 'Confirm Your Driver' : '—';
      }
      else {
        const requestLabel = 'Request the Telemetry for This Lap from ' + friend.driver;
        const action = node('button',imported ? useAsReferenceLabel :
          request ? {pending:'Request Sent',accepted:'Request Accepted',denied:'Request Denied',uploaded:'Download Telemetry Lap',expired:requestLabel,revoked:'Access Revoked'}[request.status]
            : requestLabel,imported ? 'reference-add' : 'record-request');
        const actionIcon = imported ? 'bookmark' : request?.status === 'uploaded' ? 'download' : 'request';
        addButtonIcon(action, actionIcon);
        action.disabled = !imported && ((!!request && !['uploaded','expired'].includes(request.status)) || pendingRecordRequests.has(friend.id) || pendingRecordTransfers.has(request?.id));
        if (imported) {
          action.hidden = !matchesReferenceSession(imported) || selected.path === imported.path;
          action.setAttribute('aria-pressed', String(referenceSessionPath === imported.path));
          action.onclick = event => {
            event.stopPropagation();
            selectReferenceSession(imported.path);
          };
          addLoadedReferenceLabel(referenceCell,imported.path);
        } else action.onclick = async () => {
          if (pendingRecordRequests.has(friend.id)) return;
          pendingRecordRequests.add(friend.id);
          action.disabled = true;
          try {
            if (request?.status === 'uploaded') {
              settings.comparisonLaps = await lmu.trackRecordRequest('download',request.id);
              renderLibrary();
            } else await updateRecordRequests(await lmu.trackRecordRequest('request',friend.id,friend.lapKey));
          }
          catch (error) { $('friend-records-status').textContent = error.message; }
          finally { pendingRecordRequests.delete(friend.id); refreshRecordsFromScan(); }
        };
        referenceCell.prepend(action);
      }
      if (imported && ownRecord) {
        const compare = node('button','Compare Best Laps','reference-add');
        compare.type = 'button';
        addButtonIcon(compare,'wave');
        compare.title = 'Compare your best lap with ' + friend.driver + ' at ' + track;
        compare.onclick = event => {
          event.stopPropagation();
          referenceSessionPath = imported.path;
          referenceSessionLapId = imported.lap.id;
          void openSession(ownRecord.session,ownRecord.bestLap);
        };
        referenceCell.prepend(compare);
      }
    } else {
      time.textContent = lapTime(bestLap.time);
      bindTelemetryRow(row,() => openSession(session,bestLap));
      addLoadedLapLabel(time,session.path,bestLap.id);
      if (session.path) {
        telemetryCell.append(node('span','Ready to Open'));
        if (settings.communityConfigured && lmu.exportBestLap) {
          const upload = node('button','Export to Server','button-secondary');
          upload.type = 'button';
          upload.onclick = event => {
            event.stopPropagation();
            openBestLapExport(session,bestLap);
          };
          telemetryCell.append(upload);
        }
      } else telemetryCell.textContent = 'Unavailable';
      const addReference = node('button', useAsReferenceLabel, 'reference-add');
      addButtonIcon(addReference, 'bookmark');
      addReference.hidden = !session.path || !matchesReferenceSession(session) ||
        (selected.path === session.path && lap?.id === bestLap.id);
      addReference.type = 'button';
      addReference.setAttribute('aria-label', addReference.textContent + ': ' + car + ' at ' + track + ' · ' + lapTime(bestLap.time));
      addReference.setAttribute('aria-pressed', String(referenceSessionPath === session.path && referenceSessionLapId === bestLap.id));
      addReference.onclick = event => {
        event.stopPropagation();
        selectReferenceSession(session.path, bestLap.id);
      };
      if (session.path) referenceCell.append(addReference);
      addLoadedReferenceLabel(referenceCell, session.path, bestLap.id);
    }
    if (bestLap.validity === 'unconfirmed') time.append(node('small', 'Validity unconfirmed'));
    const bestSectors = friend ? friend.bestSectors?.map(value => Number.isFinite(value) && value > 0 ? value : Infinity) ?? [] :
      [0,1,2].map(index => Math.min(Infinity,...session.laps.filter(item => eligibleRecordLap(item) && item.validity === 'official')
        .map(item => item.sectors?.[index]).filter(value => Number.isFinite(value) && value > 0)));
    const optimalTime = bestSectors.length === 3 ? bestSectors.reduce((total, sector) => total + sector, 0) : Infinity;
    const optimal = node('td', lapTime(optimalTime), 'numeric-cell record-optimal');
    if (Number.isFinite(optimalTime)) {
      const difference = Math.round((optimalTime - bestLap.time) * 1000) / 1000;
      optimal.append(node('small', '(' + timeGapLabel(difference) + ')'));
    }
    const carCell = node('td', car);
    carCell.append(node('small', session.driver || 'Unknown Driver'));
    row.append(node('td', carClass), carCell, time,
      ...[0, 1, 2].map(index => node('td', Number.isFinite(bestLap.sectors?.[index])
        ? number(bestLap.sectors[index], 3) + ' s' : '—', 'numeric-cell')),
      optimal, node('td', dateLabel(session.recorded, australianDate), 'record-date'),
      node('td', version || 'Unknown'), telemetryCell, referenceCell);
    rows.push(row);
  }
  $('record-rows').replaceChildren(...rows);
  $('records-table').hidden = !rows.length;
  setListCount('records-list-count',records.length,unfilteredRecords.size,'Record');
  $('records-load-guide').hidden = !rows.some(row => row.classList.contains('session-row'));
  positionListActions('records',!records.length);
  $('records-status').textContent = records.length ? ''
    : locked && communityMinimumGameVersion === null ? 'Waiting for the Community Server Game Version.'
    : compatibleReferencesOnly ? noCompatibleReferences : 'No matching records.';
}

$('record-driver').onchange = () => renderRecords();
for (const [key] of recordFields) {
  $('record-' + key).onchange = () => {
    if (key === 'track') $('record-layout').value = '';
    renderRecords();
  };
}
$('record-version').onchange = event => {
  unlockedRecordVersion = event.target.value;
  renderRecords();
};
$('record-last-session').onclick = () => {
  const lastSession = sessions[0];
  if (!lastSession) return;
  renderRecords(lastSession);
};
$('record-clear').onclick = () => {
  for (const [key] of recordFields) $('record-' + key).value = '';
  $('record-driver').value = '';
  unlockedRecordVersion = '';
  renderRecords();
};

const recentSessionBatchSize = 50;
const recentSessionTable = $('session-wrap');
const recentSessionRows = $('sessions');
let recentSessionMatches = [];
let recentSessionTotal = 0;

function appendRecentSessionRows(count = recentSessionBatchSize) {
  const start = recentSessionRows.rows.length;
  recentSessionRows.append(...recentSessionMatches.slice(start, start + count).map(recentSessionRow));
  setListCount('recent-list-count', recentSessionRows.rows.length, recentSessionTotal, 'Session');
}
recentSessionTable.addEventListener('scroll', () => {
  if (recentSessionRows.rows.length < recentSessionMatches.length &&
      recentSessionTable.scrollHeight - recentSessionTable.scrollTop - recentSessionTable.clientHeight < 200) {
    appendRecentSessionRows();
  }
}, {passive:true});

function renderLibrary({resetRecentSessions = false} = {}) {
  refreshRecordsFromScan();
  renderResultsDistance();
  renderComparisonLaps();
  const timedSessions = sessions.filter(session => session.timed > 0);
  const sessionType = $('recent-session-type').value;
  const matches = filterLibraryEntries('recent-session-filters', timedSessions).filter(session =>
    (!sessionType || session.session?.trim().toLowerCase().startsWith(sessionType)) &&
    (!compatibleReferencesOnly || session.path === selected.path || matchesReferenceSession(session)));
  const previousScroll = resetRecentSessions ? 0 : recentSessionTable.scrollTop;
  const rowCount = resetRecentSessions ? recentSessionBatchSize :
    Math.max(recentSessionBatchSize, recentSessionRows.rows.length);
  recentSessionMatches = matches;
  recentSessionTotal = timedSessions.length;
  const noMatches = $('recent-sessions-no-matches');
  noMatches.hidden = !$('library-loading').hidden || !timedSessions.length || !!matches.length;
  noMatches.textContent = compatibleReferencesOnly ? noCompatibleReferences : 'No recent sessions match these filters.';
  positionListActions('recent',!noMatches.hidden);
  $('empty').hidden = !$('library-loading').hidden || timedSessions.length > 0;
  $('empty-recording-guide').hidden = scanKey === undefined || !settings.telemetry || timedSessions.length > 0;
  recentSessionTable.hidden = !matches.length;
  $('recent-load-guide').hidden = !matches.length;
  $('empty-title').textContent = settings.telemetry ? 'Waiting for timed laps' : 'Choose your telemetry folder';
  $('empty-text').textContent = settings.telemetry ? settings.telemetry
    : 'Choose the LMU installation or set the telemetry and results folders separately.';
  recentSessionRows.replaceChildren();
  appendRecentSessionRows(rowCount);
  recentSessionTable.scrollTop = previousScroll;
}
function recentSessionRow(session) {
  const row = node('tr');
  const timestamp = node('td', undefined, 'session-date');
  const date = recordingDate(session.recorded);
  if (Number.isNaN(+date)) {
    timestamp.textContent = session.recorded;
  } else {
    timestamp.append(node('strong', weekdayPeriod(date)), node('small', australianDateTime.format(date)));
  }
  const track = node('td');
  const trackName = node('strong', session.track || session.filename);
  const addReference = node('button', useAsReferenceLabel, 'reference-add');
  addButtonIcon(addReference, 'bookmark');
  addReference.hidden = !matchesReferenceSession(session) || (selected.path === session.path &&
    !session.laps.some(item => item.kind === 'complete' && item.id !== lap?.id));
  addReference.type = 'button';
  addReference.setAttribute('aria-label', addReference.textContent + ': ' + (session.track || session.filename) + ' · ' + dateLabel(session.recorded));
  addReference.setAttribute('aria-pressed', String(referenceSessionPath === session.path));
  addReference.onclick = event => {
    event.stopPropagation();
    selectReferenceSession(session.path);
  };
  bindTelemetryRow(row,() => openSession(session));
  const layout = session.trackLayout;
  track.append(trackName, node('small', [
    layout && layout !== session.track ? layout : '', session.car, session.driver, session.session
  ].filter(Boolean).join(' · ')));
  addLoadedLapLabel(track,session.path);
  const comparison = node('td', undefined, 'session-comparison');
  comparison.append(addReference);
  addLoadedReferenceLabel(comparison, session.path);
  const measure = (value, unit) => Number.isFinite(value) ? measurement(value,unit,1) : '—';
  row.append(
    timestamp,
    track,
    node('td', lapTime(session.best), 'session-metric session-best numeric-cell'),
    node('td', session.timed, 'session-metric numeric-cell'),
    node('td', measure(session.distanceKm, 'km'), 'session-metric numeric-cell'),
    comparison
  );
  return row;
}
function showLibraryLoading(loading) {
  $('library-loading').hidden = !loading;
  if (loading) $('empty').hidden = $('recent-sessions-no-matches').hidden = true;
}
let scannedTelemetryFolder;
const seenTelemetry = new Set();
const pendingTelemetry = new Set();

$('auto-load-telemetry').onchange = event => {
  save({autoLoadTelemetry:event.target.checked});
  pendingTelemetry.clear();
};

async function autoLoadNewTelemetry(recordings, folder) {
  const baseline = scannedTelemetryFolder !== folder;
  if (baseline) {
    scannedTelemetryFolder = folder;
    seenTelemetry.clear();
    pendingTelemetry.clear();
  }
  for (const recording of recordings) {
    if (folder && !baseline && settings.autoLoadTelemetry !== false && !seenTelemetry.has(recording.path)) {
      pendingTelemetry.add(recording.path);
    }
    seenTelemetry.add(recording.path);
  }
  if (settings.autoLoadTelemetry === false || !folder) return false;

  // The scanner returns newest recordings first. Open one if a batch arrives together.
  const available = recordings.filter(recording => pendingTelemetry.has(recording.path) && recording.laps.length);
  const [latest,...older] = available;
  if (!latest) return false;
  for (const recording of older) pendingTelemetry.delete(recording.path);
  selectSummaryCategory('vehicle');
  await openSession(latest);
  if (ready || selected?.path !== latest.path) pendingTelemetry.delete(latest.path);
  return true;
}

async function scan() {
  refreshResultsDistance();
  if (scanBusy) { runningScanAgain = true; return; }
  if (!settings.telemetry && !settings.results) { renderLibrary(); return; }
  scanBusy = true;
  updateRecordsLoading();
  const initialScan = scanKey === undefined;
  const telemetryFolder = settings.telemetry;
  if (initialScan) showLibraryLoading(true);
  try {
    const response = await lmu.scan();
    if (response.stale || telemetryFolder !== settings.telemetry) { runningScanAgain = true; return; }
    scanFailed = false;
    if (initialScan) showLibraryLoading(false);
    const nextKey = JSON.stringify(response);
    if (scanKey === nextKey) {
      void refreshFriendRecords();
      await autoLoadNewTelemetry(response.sessions,telemetryFolder);
      return;
    }
    scanKey = nextKey;
    sessions = response.sessions;
    offerPrimaryDriver(response.suggestedDriver);
    $('settings-confirm-driver').hidden = Boolean(settings.primaryDriver || !primaryDriverSuggestion);
    renderResultsDistance();
    void refreshFriendRecords(true);
    if (settings.driverTrainerEnabled === true && view === 'trainer') void scanDriverTrainer(sessions);
    resultGameVersions = response.resultGameVersions || [];
    $('issues').hidden = !response.errors.length;
    $('issue-list').replaceChildren(...response.errors.map(error => node('li', error)));
    renderLibrary();
    if (await autoLoadNewTelemetry(sessions,telemetryFolder)) return;
    if (selected) {
      const updated = sessions.find(item => item.path === selected.path);
      if (updated) {
        const oldKey = referenceKey(reference);
        selected = updated;
        lap = updated.laps.find(item => item.id === lap.id) || lap;
        renderSessionSummary();
        fillLaps();
        fillReferences();
        if (oldKey !== referenceKey(reference)) await readReference();
        updateContext();
      }
    }
  } catch (error) {
    if (initialScan) {
      showLibraryLoading(false);
      renderLibrary();
    }
    if (!scanFailed) setStatus($('status'), 'Folder scan failed', {error:true});
    scanFailed = true;
    $('issues').hidden = false;
    $('issue-list').replaceChildren(node('li', error.message));
  } finally {
    scanBusy = false;
    updateRecordsLoading();
    if (runningScanAgain) { runningScanAgain = false; void scan(); }
  }
}
function save(change) {
  Object.assign(settings, change);
  void lmu.save(change).catch(error => { setStatus($('status'), error.message, {error:true}); });
}
function fitLapDropdown(select, labels) {
  const style = getComputedStyle(select);
  const fontSize = parseFloat(style.fontSize);
  const context = document.createElement('canvas').getContext('2d');
  context.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
  const widest = labels.reduce((width, label) => Math.max(width, context.measureText(label).width), 0);
  const padding = parseFloat(style.paddingInlineStart) + parseFloat(style.paddingInlineEnd);
  const borders = parseFloat(style.borderInlineStartWidth) + parseFloat(style.borderInlineEndWidth);
  // Native selects reserve their own arrow space in addition to CSS padding.
  select.style.width = ((widest + padding + borders) / fontSize + 1.25) + 'em';
}
const lapHistoryPlot = $('lap-history-plot');
let lapHistoryPoints = [];
let lapHistoryFocus = -1;
const lapHistoryInset = 9;
function lapHistoryLabel(item) {
  return item?.time ? (item.number == null ? '' : 'Lap ' + item.number + ' · ') + lapTime(item.time) : 'No timed laps';
}
function paintLapHistory() {
  const display = canvasContext(lapHistoryPlot);
  if (!display) return;
  const {ctx, width, height} = display;
  const active = lapHistoryPoints[lapHistoryFocus] ?? lap;
  $('lap-history-reading').textContent = lapHistoryLabel(active);
  ctx.clearRect(0, 0, width, height);
  if (!lapHistoryPoints.length) return;

  const times = lapHistoryPoints.map(point => point.time);
  const lo = Math.min(...times), span = Math.max(...times) - lo;
  const fastestIndex = times.indexOf(lo);
  const x = index => lapHistoryPoints.length === 1 ? width / 2
    : lapHistoryInset + index * Math.max(1, width - 2 * lapHistoryInset) / (lapHistoryPoints.length - 1);
  const y = time => span ? height - lapHistoryInset - (time - lo) / span * (height - 2 * lapHistoryInset) : height / 2;
  ctx.strokeStyle = palette[0];
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  lapHistoryPoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(x(index), y(point.time));
    else ctx.lineTo(x(index), y(point.time));
  });
  ctx.stroke();
  ctx.strokeStyle = '#c6a4ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x(fastestIndex), y(lo), 7.5, 0, Math.PI * 2);
  ctx.stroke();
  lapHistoryPoints.forEach((point, index) => {
    const selectedPoint = point.id === lap?.id;
    ctx.fillStyle = selectedPoint ? activeInterfaceColour() : palette[0];
    ctx.beginPath();
    ctx.arc(x(index), y(point.time), selectedPoint || index === lapHistoryFocus ? 4 : 2, 0, Math.PI * 2);
    ctx.fill();
  });
}
function lapHistoryIndex(event) {
  if (!lapHistoryPoints.length) return -1;
  const fraction = (event.offsetX - lapHistoryInset) / Math.max(1, lapHistoryPlot.clientWidth - 2 * lapHistoryInset);
  return Math.max(0, Math.min(lapHistoryPoints.length - 1, Math.round(fraction * (lapHistoryPoints.length - 1))));
}
new ResizeObserver(paintLapHistory).observe(lapHistoryPlot);
lapHistoryPlot.onpointermove = event => {
  lapHistoryFocus = lapHistoryIndex(event);
  paintLapHistory();
};
lapHistoryPlot.onpointerleave = lapHistoryPlot.onblur = () => {
  lapHistoryFocus = -1;
  paintLapHistory();
};
lapHistoryPlot.onclick = event => {
  lapHistoryFocus = lapHistoryIndex(event);
  selectLap(lapHistoryPoints[lapHistoryFocus]);
};
lapHistoryPlot.onkeydown = event => {
  if (!lapHistoryPoints.length || !['ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  if (lapHistoryFocus < 0) lapHistoryFocus = Math.max(0, lapHistoryPoints.findIndex(point => point.id === lap?.id));
  if (event.key === 'Enter' || event.key === ' ') {
    selectLap(lapHistoryPoints[lapHistoryFocus]);
  } else {
    lapHistoryFocus = Math.max(0, Math.min(lapHistoryPoints.length - 1,
      lapHistoryFocus + (event.key === 'ArrowLeft' ? -1 : 1)));
    paintLapHistory();
  }
};
function selectLap(nextLap) {
  if (!nextLap || nextLap.id === lap?.id) return;
  lap = nextLap;
  $('lap-select').value = lap.id;
  paintLapHistory();
  fillReferences();
  void readPrimary();
}
function fillLaps() {
  const select = $('lap-select');
  select.replaceChildren();
  for (const item of selected.laps) option(select, lapLabel(item), item.id);
  select.value = lap.id;
  fitLapDropdown(select, [...select.options].map(option=>option.text));
  lapHistoryPoints = selected.laps.filter(item => Number.isFinite(item.time) && item.time > 0);
  const labelWidth = lapHistoryPoints.reduce((longest, item) =>
    Math.max(longest, lapHistoryLabel(item).length), 'No timed laps'.length);
  $('lap-history-reading').style.inlineSize = labelWidth + 'ch';
  lapHistoryFocus = -1;
  paintLapHistory();
}
function referenceKey(value) { return value ? JSON.stringify([value.session.path, value.lap.id]) : ''; }
function savedReferenceLapKey() {
  return referenceSessionLapId == null ? undefined : JSON.stringify([referenceSessionPath, referenceSessionLapId]);
}
function selectReferenceSession(path, lapId) {
  referenceSessionPath = path;
  referenceSessionLapId = lapId;
  manualReference = path ? savedReferenceLapKey() : '';
  renderLibrary();
  if (!selected) {
    renderLoadedSessions();
    return;
  }
  if (path) setView('viewer');
  fillReferences();
  void readReference();
}
function fillReferences() {
  const carSelect = $('car-select'), refSelect = $('reference-select');
  const currentCar = carSelect.value;
  const pool = (lap.kind === 'complete' ? sessions : []).filter(s =>
    s.path === selected.path || matchesReferenceSession(s))
    .flatMap(session => session.laps.filter(item => item.kind === 'complete' &&
      (session.path !== selected.path || item.id !== lap.id)).map(lap => ({session, lap})))
    .concat(lap.kind === 'complete' ? (settings.comparisonLaps ?? [])
      .filter(session => session.path !== selected.path && matchesReferenceSession(session))
      .map(session => ({session,lap:session.lap,imported:true})) : [])
    .sort((a,b) => Number(b.lap.validity === 'official') - Number(a.lap.validity === 'official') ||
      (a.lap.time ?? Infinity) - (b.lap.time ?? Infinity));
  const imported = (settings.comparisonLaps ?? []).find(entry => entry.path === referenceSessionPath);
  const target = imported ?? sessions.find(session => session.path === referenceSessionPath);
  $('reference-car-control').hidden = !!referenceSessionPath;
  $('reference-session-control').hidden = !referenceSessionPath;
  const ownModel = selected.model || selected.car;
  carSelect.replaceChildren();
  option(carSelect, carSelect.getAttribute('aria-label'), '');
  const timedLapOrder = ({lap}) => Number.isFinite(lap.time) && lap.time > 0 ? lap.time : Infinity;
  const otherCarLaps = pool.filter(entry => !entry.imported && Number.isFinite(timedLapOrder(entry)) &&
    (entry.session.model || entry.session.car) !== ownModel);
  const otherCars = new Set(otherCarLaps.map(({session}) => session.model || session.car).filter(Boolean));
  for (const car of [...otherCars].sort()) option(carSelect, car, car);
  if ([...carSelect.options].some(x => x.value === currentCar)) carSelect.value = currentCar;
  carSelect.title = carSelect.selectedOptions[0].text;
  const candidates = pool.filter(x => referenceSessionPath
    ? x.session.path === referenceSessionPath
    : !carSelect.value || (x.session.model || x.session.car) === carSelect.value);
  $('reference-session-name').textContent = target
    ? [viewerCarDetails(target), imported ? (imported.driver || 'Imported lap') : dateLabel(target.recorded),
       candidates.length ? '' : 'No compatible laps'].filter(Boolean).join(' · ')
    : 'Reference session unavailable';
  const lapsInOrder = [...candidates].sort((a, b) => timedLapOrder(a) - timedLapOrder(b));
  const automatic = (carSelect.value && !referenceSessionPath
    ? lapsInOrder.find(entry => !entry.imported && Number.isFinite(timedLapOrder(entry)))
    : candidates.find(x => x.lap.time && (referenceSessionPath ||
      (!x.imported && (x.session.model || x.session.car) === ownModel)))) || null;
  refSelect.replaceChildren(refSelect.firstElementChild);
  const automaticScope = referenceSessionPath ? 'Reference Session' : carSelect.value ? 'Selected Car' : 'Same Car';
  const automaticLabel = 'Automatic · ' + automaticScope + ' · ' + (automatic ? lapLabel(automatic.lap) : 'No Timed Lap');
  option(refSelect, automaticLabel, 'auto');
  option(refSelect, 'No Reference Lap', '');
  const referenceLabel = value => lapLabel(value.lap) + ' · ' + (value.imported ? (value.session.driver || 'Imported lap') : dateLabel(value.session.recorded));
  for (const value of lapsInOrder) {
    option(refSelect, referenceLabel(value), referenceKey(value));
  }
  fitLapDropdown(refSelect, [automaticLabel, 'No Reference Lap', ...pool.map(referenceLabel)]);
  if (manualReference !== undefined && [...refSelect.options].some(x => x.value === manualReference)) {
    refSelect.value = manualReference;
    reference = candidates.find(x => referenceKey(x) === manualReference) || null;
  } else if (manualReference !== undefined && manualReference === savedReferenceLapKey()) {
    refSelect.value = '';
    reference = null;
  } else {
    refSelect.value = 'auto';
    reference = automatic;
  }
}
function openImportedLap(entry) {
  return openSession({...entry, imported:true, laps:[entry.lap], best:entry.lap.time}, entry.lap);
}
async function openSession(value, initialLap, comparison) {
  if (!value.laps.length) return;
  selected = value;
  practiceComparison = comparison;
  restoreTrackCamera();
  trackCameraOverride = undefined;
  fitTrack();
  lap = initialLap || fastestValidLap(value) ||
    value.laps.find(item => item.time === value.best && item.time) || value.laps[0];
  if (referenceSessionPath) {
    const target = (settings.comparisonLaps ?? []).find(session => session.path === referenceSessionPath)
      ?? sessions.find(session => session.path === referenceSessionPath);
    if (!target || (target.path === selected.path
      ? selected.imported || referenceSessionLapId === lap.id
      : !matchesReferenceSession(target))) {
      referenceSessionPath = referenceSessionLapId = undefined;
    }
  }
  manualReference = savedReferenceLapKey();
  $('car-select').replaceChildren();
  fillLaps();
  fillReferences();
  $('track').textContent = value.track;
  setView('viewer');
  await readPrimary();
}
$('clear-loaded-session').onclick = $('clear-viewer-session').onclick = () => {
  ++loadGeneration;
  compatibleReferencesOnly = false;
  ready = referenceLoading = pinned = false;
  selected = lap = reference = primary = secondary = undefined;
  if (popoutWindows.has('graphs')) closePanelPopout('graphs');
  renderVisualiserLaps();
  referenceSessionPath = referenceSessionLapId = manualReference = practiceComparison = undefined;
  setView(view === 'viewer' ? 'viewer' : 'library');
  if (view === 'viewer') $('viewer-open-recent').focus();
};
function message(text = '') {
  $('viewer-message').textContent = text;
  $('viewer-message').hidden = !text;
}
const exportBestLapButton = $('export-best-lap');
let exportingBestLap = false;
function updateBestLapExport() {
  exportBestLapButton.disabled = exportingBestLap || selected?.imported || !(selected?.best > 0);
}
const discordWebhookInput = $('discord-webhook');
const discordWebhookStatus = $('discord-webhook-status');
const saveDiscordWebhook = $('save-discord-webhook');
const removeDiscordWebhook = $('remove-discord-webhook');
function updateDiscordSettings() {
  removeDiscordWebhook.disabled = !settings.discordWebhookConfigured;
  discordWebhookInput.placeholder = settings.discordWebhookConfigured ? 'Webhook saved' : 'No webhook saved';
  discordWebhookStatus.textContent = '';
}
async function changeDiscordWebhook(value) {
  saveDiscordWebhook.disabled = removeDiscordWebhook.disabled = discordWebhookInput.disabled = true;
  try {
    settings.discordWebhookConfigured = await lmu.setDiscordWebhook(value);
    discordWebhookInput.value = '';
    updateDiscordSettings();
  } catch (error) {
    discordWebhookStatus.textContent = error.message;
  } finally {
    saveDiscordWebhook.disabled = discordWebhookInput.disabled = false;
    removeDiscordWebhook.disabled = !settings.discordWebhookConfigured;
  }
}
$('discord-webhook-form').onsubmit = event => {
  event.preventDefault();
  if (!saveDiscordWebhook.disabled) void changeDiscordWebhook(discordWebhookInput.value.trim());
};
removeDiscordWebhook.onclick = () => changeDiscordWebhook(null);
$('folders').addEventListener('close', () => { discordWebhookInput.value = ''; });

const bestLapExportDialog = $('best-lap-export-dialog');
const bestLapExportStatus = $('best-lap-export-status');
const bestLapExportProgress = $('best-lap-export-progress');
const bestLapExportLocal = $('best-lap-export-local');
const bestLapExportDiscord = $('best-lap-export-discord');
const bestLapExportCommunity = $('best-lap-export-community');
const bestLapExportCancel = $('best-lap-export-cancel');
let exportSessionPath, exportRecordLapId;
function openBestLapExport(session, recordLap) {
  if (exportingBestLap) return;
  exportSessionPath = session.path;
  exportRecordLapId = recordLap?.id;
  bestLapExportLocal.hidden = bestLapExportDiscord.hidden = Boolean(recordLap);
  $('best-lap-export-lap').textContent = [session.driver, session.track, lapTime(recordLap?.time ?? session.best)].filter(Boolean).join(' · ');
  bestLapExportDiscord.disabled = !settings.discordWebhookConfigured;
  bestLapExportCommunity.disabled = !settings.communityConfigured;
  setStatus(bestLapExportStatus,
    recordLap ? 'This shares the selected record lap with the community.' :
      settings.discordWebhookConfigured ? '' : 'Add a Discord webhook in Settings to export to Discord.',
    {temporary:false});
  bestLapExportDialog.showModal();
}
exportBestLapButton.onclick = () => {
  if (!exportBestLapButton.disabled) openBestLapExport(selected);
};
bestLapExportCancel.onclick = () => bestLapExportDialog.close();
bestLapExportDialog.oncancel = event => {
  if (bestLapExportLocal.disabled) event.preventDefault();
};
async function exportBestLap(target) {
  exportingBestLap = true;
  updateBestLapExport();
  bestLapExportLocal.disabled = bestLapExportDiscord.disabled = bestLapExportCommunity.disabled = bestLapExportCancel.disabled = true;
  setStatus(bestLapExportStatus, '', {temporary:false});
  if (target !== 'local') showLapTransfer(bestLapExportProgress, bestLapExportStatus,
    target === 'community' ? 'Preparing best lap…' : 'Uploading best lap…');
  try {
    const filename = await lmu.exportBestLap(exportSessionPath, target, exportRecordLapId);
    if (!filename) return;
    bestLapExportDialog.close();
    setStatus($('status'), (target === 'discord' ? 'Sent to Discord · ' : target === 'community' ? 'Uploaded to Community Server · ' : 'Exported ') + filename);
  } catch (error) {
    setStatus(bestLapExportStatus, error.message, {error:true});
  } finally {
    bestLapExportProgress.hidden = true;
    exportingBestLap = false;
    updateBestLapExport();
    bestLapExportLocal.disabled = bestLapExportCancel.disabled = false;
    bestLapExportDiscord.disabled = !settings.discordWebhookConfigured;
    bestLapExportCommunity.disabled = !settings.communityConfigured;
  }
}
bestLapExportLocal.onclick = () => exportBestLap('local');
bestLapExportDiscord.onclick = () => exportBestLap('discord');
bestLapExportCommunity.onclick = () => exportBestLap('community');
async function readPrimary() {
  const token = ++loadGeneration;
  const currentLap = lap;
  ready = false;
  stop();
  primary = secondary = null;
  referenceLoading = false;
  updateActiveLapComparison();
  renderSessionSummary();
  renderLoadedSessions();
  updateSectorZoom();
  trackProjection = undefined;
  pinned = false;
  updatePin();
  $('charts').replaceChildren();
  $('channel-list').replaceChildren();
  $('position').textContent = '';
  $('map-status').textContent = '';
  for (const canvas of [$('map'), racingMap]) {
    const map = canvasContext(canvas);
    map?.ctx.clearRect(0, 0, map.width, map.height);
  }
  message('Loading lap telemetry…');
  try {
    const channels = selected.imported ? await lmu.comparisonLap(selected.path) : await lmu.lap(selected.path, currentLap.id);
    if (token !== loadGeneration) return;
    primary = prepare(currentLap, channels);
    renderInCarSettings();
    updateSectorZoom(primary);
    playTime = currentLap.start;
    cursor = primary.distanceAt(playTime);
    ready = true;
    resetZoom();
    await readReference();
  } catch (error) {
    if (token === loadGeneration) message(error.message);
  }
}
async function readReference() {
  if (!ready) return;
  const token = ++loadGeneration;
  const chosen = reference;
  referenceLoading = Boolean(chosen);
  secondary = null;
  renderLoadedSessions();
  buildCharts();
  buildChannels();
  updateContext();
  message();
  if (!chosen) return;
  try {
    const channels = chosen.imported ? await lmu.comparisonLap(chosen.session.path) : await lmu.lap(chosen.session.path, chosen.lap.id);
    if (token !== loadGeneration) return;
    const prepared = prepare(chosen.lap, channels);
    if (!prepared.useDistance || !primary.useDistance) {
      message('Distance alignment is unavailable for these laps.');
      return;
    }
    secondary = prepared;
    renderLoadedSessions();
    buildCharts();
    buildChannels();
    message();
  } catch (error) {
    if (token === loadGeneration) message(error.message);
  } finally {
    if (token === loadGeneration) {
      referenceLoading = false;
      updateActiveLapComparison();
    }
  }
}

function lowerBound(values, x) {
  let low = 0, high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid] < x) low = mid + 1; else high = mid;
  }
  return low;
}
function interpolate(xs, ys, x) {
  const i = lowerBound(xs, x);
  if (!xs.length) return NaN;
  if (i === 0) return ys[0];
  if (i === xs.length) return ys.at(-1);
  const fraction = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + fraction * (ys[i] - ys[i - 1]);
}
function prepare(l, channels) {
  for (const channel of Object.values(channels)) {
    channel.times = channel.rate
      ? channel.rows.map((_, i) => channel.origin + i / channel.rate)
      : channel.rows.map(row => row[0]);
  }
  const distanceChannel = channels['Lap Dist'];
  const boundaryWrapped = l.kind === 'complete' || l.kind === 'in-lap';
  const times = [], distances = [];
  for (let i = 0; i < (distanceChannel?.rows.length || 0); i++) {
    const t = distanceChannel.times[i], value = distanceChannel.rows[i][0];
    if (t < l.start - 1e-6 || t >= l.end - 1e-6 || value === null) continue;
    if (boundaryWrapped && t - l.start < .4 && value > 1000) continue;
    if (boundaryWrapped && l.end - t < .4 && value < 100 && distances.at(-1) > 1000) continue;
    times.push(t);
    distances.push(Math.max(value, distances.at(-1) ?? value));
  }
  const useDistance = distances.length > 1 && distances.at(-1) - distances[0] > 10;
  if (useDistance && l.kind === 'complete') {
    if (times[0] > l.start + 1e-6) { times.unshift(l.start); distances.unshift(0); }
    else distances[0] = 0;
    const length = distances.at(-1) + Math.max(0, l.end - times.at(-1)) * Math.max(0, (sample(channels['Ground Speed'], l.end)?.[0] || 0) / 3.6);
    times.push(l.end);
    distances.push(length);
  }
  const distanceAt = t => useDistance ? interpolate(times, distances, t) : t - l.start;
  const timeAt = x => useDistance ? interpolate(distances, times, x) : l.start + x;
  const extent = useDistance ? [distances[0], distances.at(-1)] : [0, l.end - l.start];
  return {lap:l, channels, extent, distanceAt, timeAt, useDistance};
}
function sample(channel, time) {
  if (!channel?.times.length || !Number.isFinite(time)) return null;
  const i = lowerBound(channel.times, time);
  if (!channel.rate) return (channel.rows[i]?.[0] === time ? channel.rows[i] : channel.rows[i - 1])?.slice(1) || null;
  const index = i === 0 ? i : i === channel.times.length || time - channel.times[i-1] <= channel.times[i] - time ? i-1 : i;
  return channel.rows[index];
}
function inExtent(data, x) { return x >= data.extent[0] && x <= data.extent[1]; }
function tyreName() { return settings.tyres || 'TyresTempCentre'; }
const metricUnits = {speed:'metric',distance:'metric',temperature:'metric',pressure:'metric',fuel:'metric'};
const imperialUnits = Object.fromEntries(Object.keys(metricUnits).map(key => [key,'imperial']));
const unitPresets = {metricPsi:{...metricUnits,pressure:'imperial'},metric:metricUnits,imperial:imperialUnits};
const unitOptions = [...document.querySelectorAll('[data-measurement-unit]')];
const usingImperial = key => (settings.measurementUnits?.[key] ?? unitPresets.metricPsi[key]) === 'imperial';

function turboPressureReference() {
  return settings.turboPressureReference ?? 'gauge';
}

function unitConversion(name, unit) {
  const normalized = unit?.trim().toLowerCase();
  if (/ride[\s_-]*heights?/i.test(name) && (normalized === 'm' || normalized === 'mm')) {
    return ['mm', normalized === 'm' ? 1000 : 1];
  }
  if (['km/h','kph','kmh','mph'].includes(normalized)) {
    const mph = usingImperial('speed');
    return [mph ? 'mph' : 'km/h', normalized === 'mph' ? (mph ? 1 : 1.609344) : (mph ? 1 / 1.609344 : 1)];
  }
  if (['m','km','ft','mi'].includes(normalized)) {
    const imperial = usingImperial('distance');
    const long = normalized === 'km' || normalized === 'mi';
    const factor = long ? 1.609344 : .3048;
    const sourceImperial = normalized === 'ft' || normalized === 'mi';
    return [imperial ? (long ? 'mi' : 'ft') : (long ? 'km' : 'm'),
      sourceImperial === imperial ? 1 : imperial ? 1 / factor : factor];
  }
  if (['c','°c','degc','f','°f','degf'].includes(normalized)) {
    const fahrenheit = usingImperial('temperature');
    const sourceFahrenheit = ['f','°f','degf'].includes(normalized);
    return fahrenheit === sourceFahrenheit ? [fahrenheit ? '°F' : '°C',1] :
      fahrenheit ? ['°F',1.8,32] : ['°C',1 / 1.8,-32 / 1.8];
  }
  if (['TyresPressure','Turbo Boost Pressure'].includes(name) && ['pa','kpa','psi'].includes(normalized)) {
    const psi = usingImperial('pressure');
    const toKpa = normalized === 'pa' ? .001 : normalized === 'psi' ? 6.894757293168 : 1;
    const gauge = name === 'Turbo Boost Pressure' && turboPressureReference() === 'gauge';
    const unit = (psi ? 'psi' : 'kPa') + (gauge ? ' gauge' : '');
    return [unit,psi ? toKpa / 6.894757293168 : toKpa,
      gauge ? -101.325 / (psi ? 6.894757293168 : 1) : 0];
  }
  if (['l','litre','litres','liter','liters','us gal','gal'].includes(normalized)) {
    const gallons = usingImperial('fuel');
    const sourceGallons = normalized.endsWith('gal');
    return [gallons ? 'US gal' : 'L',sourceGallons === gallons ? 1 : gallons ? 1 / 3.785411784 : 3.785411784];
  }
  return [unit || '',1];
}
function displayUnit(name, unit) {
  return unitConversion(name,unit)[0];
}
function convert(name, value, unit) {
  if (!Number.isFinite(value)) return value;
  const [,factor,offset = 0] = unitConversion(name,unit);
  return value * factor + offset;
}
function measurement(value, unit, digits) {
  return number(convert('',value,unit),digits) + ' ' + displayUnit('',unit);
}
function temperatureInputValue(celsius) {
  return Number.isFinite(celsius) ? Number(convert('',celsius,'°C').toFixed(6)) : '';
}
function temperatureSettingValue(value) {
  return usingImperial('temperature') ? (value - 32) / 1.8 : value;
}
function refreshUnitFields() {
  $('turbo-pressure-reference').value = turboPressureReference();
  for (const input of unitOptions) input.value = usingImperial(input.dataset.measurementUnit) ? 'imperial' : 'metric';
  $('unit-preset').value = Object.keys(unitPresets).find(preset =>
    unitOptions.every(input => unitPresets[preset][input.dataset.measurementUnit] === input.value)) ?? 'custom';
  const unit = displayUnit('','°C');
  for (const text of document.querySelectorAll('[data-temperature-unit]')) text.textContent = unit;
  $('trainer-cold-unit').textContent = unit;
  for (const input of document.querySelectorAll('[data-hot-temperature]')) {
    input.value = temperatureInputValue(hotTemperature(input.dataset.carClass,input.dataset.hotTemperature));
    input.setAttribute('aria-label',input.dataset.temperatureLabel + ' (' + unit + ')');
  }
}
function applyMeasurementUnits(units) {
  save({measurementUnits:units});
  refreshMeasurementDisplays();
}
function refreshMeasurementDisplays() {
  refreshUnitFields();
  renderLibrary();
  renderSessionSummary();
  if (ready) {
    const column = $('plot-column');
    const scrollTop = column.scrollTop;
    buildCharts();
    column.scrollTop = scrollTop;
    buildChannels();
  }
  renderDriverTrainer();
}
$('turbo-pressure-reference').onchange = event => {
  save({turboPressureReference:event.target.value});
  refreshMeasurementDisplays();
};
$('unit-preset').onchange = event => applyMeasurementUnits(unitPresets[event.target.value]);
for (const input of unitOptions) input.onchange = () => applyMeasurementUnits(
  Object.fromEntries(unitOptions.map(field => [field.dataset.measurementUnit,field.value])));

const wholeNumberTelemetry = new Set([
  'Brakes Temp', 'frontBrakes', 'rearBrakes', 'tyres', ...Object.keys(tyreChannels),
  'Steering Pos', 'Throttle Pos', 'Brake Pos', 'Clutch RPM', 'Engine Max RPM'
]);
function telemetryDecimalPlaces(key, fallback = 1, overrides = settings.telemetryDecimals) {
  if (key === 'Engine RPM' || key === 'Gear') return 0;
  const places = overrides?.[key] ??
    (Object.hasOwn(tyreChannels, key) ? overrides?.tyres : undefined);
  if (Number.isInteger(places) && places >= 0 && places <= 6) return places;
  if (['FrontRideHeight','FrontWingHeight','RearRideHeight','RideHeights'].includes(key)) return 2;
  if (/height/i.test(key)) return 5;
  if (key === 'Fuel Level' || key === 'Brake Thickness' || /^G Force\b/i.test(key)) return 2;
  return wholeNumberTelemetry.has(key) ? 0 : fallback;
}
function summaryDecimalDefault(key) {
  return ['virtualEnergy', 'Fuel Level', 'absActiveTime', 'tcActiveTime'].includes(key) ? 2 : 1;
}
function valueLabel(name, value, sourceUnit) {
  if (value === null || value === undefined) return '—';
  if (name === 'Gear') return value === 0 ? 'N' : value === -1 ? 'R' : String(value);
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const unit = displayUnit(name, sourceUnit);
  const formatted = typeof value === 'number' ? number(convert(name, value, sourceUnit), telemetryDecimalPlaces(name)) : String(value);
  return formatted + (unit ? ' ' + unit : '');
}
function readings(data, name, stacked = false, widths, hiddenWheels) {
  const channel = data?.channels[name];
  const values = data && inExtent(data, cursor) ? sample(channel, data.timeAt(cursor)) : null;
  if (!values && !widths) return '—';
  const components = widths ?? values;
  const formatted = components.flatMap((_, index) => {
    if (hiddenWheels?.has(index)) return [];
    const label = valueLabel(name, values?.[index], channel?.unit);
    const reading = widths ? label.padStart(widths[index], '\u00a0') : label;
    return components.length === 4 ? wheels[index] + ' ' + reading : reading;
  });
  return formatted.join(stacked ? '\n' : widths ? ' / ' : '  /  ') || '—';
}
function chartReadingLayout(data, name) {
  const channel = data?.channels[name];
  const offset = channel?.rate ? 0 : 1;
  const count = Math.max(1, (channel?.rows[0]?.length ?? offset) - offset);
  const widths = Array(count).fill(1);
  for (const row of channel?.rows ?? []) {
    for (let index = 0; index < count; index++) {
      widths[index] = Math.max(widths[index], valueLabel(name, row[index + offset], channel.unit).length);
    }
  }
  return {widths, length:widths.reduce((total, width) => total + width, 0)
    + (count === 4 ? 4 * 3 : 0) + (count - 1) * 3};
}
function delta(x) {
  if (!primary?.useDistance || !secondary?.useDistance || !inExtent(primary,x) || !inExtent(secondary,x)) return NaN;
  return primary.timeAt(x) - primary.lap.start - (secondary.timeAt(x) - secondary.lap.start);
}
const inCarSettings = [
  ['TCLevel', 'TC 1 · Level'], ['TCCut', 'TC 2 · Cut'], ['TCSlipAngle', 'TC 3 · Slip Angle'],
  ['ABSLevel', 'ABS Level'], ['Brake Bias Rear', 'Brake Bias (F:R)'],
  ['Brake Migration', 'Brake Migration'], ['FuelMixtureMap', 'Fuel Mixture Map']
];
const hypercarSetupOptions = [
  ['VM_REGEN_LEVEL', 'Regen Level'],
  ['VM_ELECTRIC_MOTOR_MAP', 'Electric Motor Map'],
  ['VM_ENGINE_BRAKEMAP', 'Engine Braking Map']
];
const defaultTelemetryNames = new Map([
  ...chartSpecs.map(([label, key]) => [key, label]),
  ...Object.entries(tyreChannels),
  ...inCarSettings, ...hypercarSetupOptions,
  ['G Force Lat', 'G Force Lateral (Side-to-Side)'],
  ['G Force Long', 'G Force Longitudinal (Acceleration and Braking)'],
  ['G Force Vert', 'G Force Vertical (Bumps, Kerbs, etc)'],
  ['SoC', 'State of Charge'],
  ['Susp Pos', 'Suspension Position'],
  ['Front3rdDeflection', 'Front Third-Element Deflection'],
  ['Rear3rdDeflection', 'Rear Third-Element Deflection'],
  ['virtualEnergy', 'Virtual Energy Usage per Lap']
]);
function telemetryName(key, fallback = defaultTelemetryNames.get(key) ?? key) {
  return Object.hasOwn(settings.telemetryNames ?? {}, key) ? settings.telemetryNames[key] : fallback;
}
function telemetryGraphName(key, fallback) {
  if (key !== 'tyres') return telemetryName(key, fallback);
  const channel = tyreName();
  const defaultTitle = ['TyresRubberTemp', 'TyresRimTemp'].includes(channel) ? tyreChannels[channel] : fallback;
  return telemetryName(channel, telemetryName(key, defaultTitle));
}
const summaryChannelKeys = {
  oil:'Engine Oil Temp', water:'Engine Water Temp',
  air:'Ambient Temperature', track:'Track Temperature'
};
const defaultHiddenSummary = ['air', 'track'];
function hiddenSummaryChannels() {
  const hidden = new Set(settings.hiddenSummary ?? defaultHiddenSummary);
  if (hidden.delete('brakes')) {
    hidden.add('frontBrakes');
    hidden.add('rearBrakes');
  }
  return hidden;
}
function orderSummaryOptions(options, keyOf) {
  const ranks = new Map((settings.summaryChannelOrder ?? []).map((key, index) => [key, index]));
  return options.sort((a, b) => (ranks.get(keyOf(a)) ?? Infinity) - (ranks.get(keyOf(b)) ?? Infinity));
}
const summaryTemperaturePairs = [
  {setting:'mergeSummaryBrakes', key:'mergedBrakes', channels:['frontBrakes','rearBrakes'],
    label:'Front and Rear Brake Temperatures', names:['Front','Rear']},
  {setting:'mergeSummaryEngineTemperatures', key:'mergedEngineTemperatures', channels:['oil','water'],
    label:'Engine Oil and Water Temperatures', names:['Oil','Water']}
];
const summaryTemperatureOptions = [
  ['tyres', 'Hottest Tyre Temperature'], ['frontBrakes', 'Front Brake Temperature'],
  ['rearBrakes', 'Rear Brake Temperature'], ['oil', 'Engine Oil Temperature'],
  ['water', 'Engine Water Temperature'], ['air', 'Air temperature'], ['track', 'Track temperature']
];
const defaultSummaryChannels = new Set([
  'TyresTempCentre', 'Brakes Temp', 'Engine Oil Temp', 'Engine Water Temp',
  'Ambient Temperature', 'Track Temperature', 'Virtual Energy'
]);
const derivedSummaryChannels = new Map([
  ['finishSpeed', ['Ground Speed', 'Speed at the Finish Line']],
  ...wheels.map((wheel, index) => ['finishPressure' + wheel, ['TyresPressure', wheel + ' Peak Tyre Pressure', index]]),
  ['absActiveTime', ['ABS', 'ABS Time Active']],
  ['tcActiveTime', ['TC', 'TC Time Active']]
]);
function availableSummaryChannels(names) {
  const channels = new Set(names);
  for (const [key, [source]] of derivedSummaryChannels) {
    if (channels.has(source)) channels.add(key);
  }
  return [...channels];
}
let extraSummary = {};

function extraSummaryOptions(session) {
  const chosen = new Set(settings.extraSummaryChannels);
  const names = availableSummaryChannels(session?.summaryChannels ?? []).filter(name => chosen.has(name) && !defaultSummaryChannels.has(name));
  const fetched = [...new Set(names.filter(name => name !== 'Ground Speed')
    .map(name => derivedSummaryChannels.get(name)?.[0] ?? name))];
  const key = fetched.length ? JSON.stringify([session.path, session.laps.at(-1)?.end, fetched]) : '';
  if (!key) extraSummary = {};
  else if (extraSummary.key !== key) {
    const request = {key};
    extraSummary = request;
    lmu.summaryChannels(session.path, fetched).then(data => {
      if (extraSummary !== request) return;
      request.data = data;
      renderSessionSummary();
    }).catch(error => {
      if (extraSummary !== request) return;
      setStatus($('status'), error.message, {error:true});
    });
  }
  return names.map(name => {
    if (name === 'Ground Speed') {
      const values = Object.fromEntries(session.laps.map(lap => [lap.id, convert('Ground Speed',lap.topSpeed,'km/h')]));
      return [name, extraSummaryName(name), displayUnit('Ground Speed','km/h'), values];
    }
    const derived = derivedSummaryChannels.get(name);
    if (derived) {
      const [source, label, wheel] = derived;
      const channel = extraSummary.data?.[source];
      const isActivation = source === 'ABS' || source === 'TC';
      const readings = isActivation ? channel?.activeSeconds : wheel === undefined ? channel?.values : channel?.wheelValues?.[wheel];
      const unit = isActivation ? 's' : displayUnit(source, channel?.unit);
      const values = Object.fromEntries(Object.entries(readings ?? {}).map(([id, value]) =>
        [id, convert(source, value, channel.unit)]));
      return [name, label, unit, values];
    }
    const channel = extraSummary.data?.[name];
    const values = Object.fromEntries(Object.entries(channel?.values ?? {}).map(([id, value]) =>
      [id, convert(name, value, channel.unit)]));
    return [name, extraSummaryName(name), displayUnit(name, channel?.unit), values];
  });
}

function extraSummaryName(name) {
  if (name === 'TyresPressure') return telemetryName(name, 'Peak Tyre Pressure');
  if (name === 'Engine RPM') return telemetryName(name, 'PRM peak');
  if (name === 'Ground Speed') return telemetryName(name, 'Top Speed');
  if (derivedSummaryChannels.has(name)) {
    const [source, label, wheel] = derivedSummaryChannels.get(name);
    const channel = telemetryName(source, '');
    if (!channel) return label;
    if (wheel !== undefined) return wheels[wheel] + ' ' + channel + ' Peak';
    return channel + (name === 'finishSpeed' ? ' at the Finish Line' : ' Time Active');
  }
  return name === 'Fuel Level' ? telemetryName(name, 'Fuel Used per Lap') : telemetryName(name);
}

const summaryChartColours = {
  tyres: '#f7d27a',
  frontBrakes: '#ffac76',
  rearBrakes: '#67d8ed',
  oil: '#eaa8ed',
  water: '#8dbdff',
  air: '#9adac9',
  track: '#c6b7ff',
  virtualEnergy: '#c6f36c'
};
function summaryChannelColour(channel) {
  return graphColor('summary:' + channel, summaryChartColours[channel] ?? graphColor(channel));
}
function attachChartResize(handle, getSize, setSize, persist, reset, axis = 'y') {
  const horizontal = axis === 'x';
  const pointerPosition = event => horizontal ? event.clientX : event.clientY;
  const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp';
  const increase = horizontal ? 'ArrowRight' : 'ArrowDown';
  handle.title = "Double-click to restore default size";
  handle.addEventListener('dblclick', reset);
  let drag;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {pointerId:event.pointerId, position:pointerPosition(event), size:getSize()};
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.pointerId === event.pointerId) setSize(drag.size + pointerPosition(event) - drag.position);
  });
  handle.addEventListener('lostpointercapture', event => {
    if (drag?.pointerId !== event.pointerId) return;
    if (getSize() !== drag.size) persist?.();
    drag = null;
  });
  handle.addEventListener('keydown', event => {
    if (event.key !== decrease && event.key !== increase) return;
    event.preventDefault();
    setSize(getSize() + (event.key === increase ? 15 : -15));
    persist?.();
  });
}

const summaryPlots = new Map();
let summaryPlotObserver;
function observeSummaryPlots() {
  summaryPlotObserver?.disconnect();
  const owner = $('session-charts').ownerDocument.defaultView;
  summaryPlotObserver = new owner.ResizeObserver(entries => {
    for (const {target} of entries) summaryPlots.get(target)?.();
  });
  for (const canvas of summaryPlots.keys()) summaryPlotObserver.observe(canvas);
}
function redrawSummaryPlots() {
  for (const redraw of summaryPlots.values()) redraw();
}

function summaryChart(key, label, unit, readings, endpoints, secondReadings) {
  const section = node('div', null, 'summary-chart');
  const pair = summaryTemperaturePairs.find(pair => pair.key === key);
  const [firstKey,secondKey] = pair?.channels ?? [key];
  const isUsage = key === 'virtualEnergy' || key === 'Fuel Level';
  const colour = summaryChannelColour(firstKey);
  section.style.setProperty('--summary-chart-colour', colour);
  const format = (value, channel = firstKey) => Number.isFinite(value)
    ? number(value, telemetryDecimalPlaces(summaryChannelKeys[channel] ?? channel, summaryDecimalDefault(channel))) + (unit ? ' ' + unit : '')
    : '—';
  const heading = node('strong', label);
  const readout = node('span', '', 'summary-chart-readout');
  const plot = node('div', null, 'summary-chart-body');
  section.append(node('div', null, 'summary-chart-header'), plot);
  section.firstElementChild.append(heading);
  if (secondReadings) {
    readout.classList.add('summary-pair-readout');
    const legend = node('span', undefined, 'summary-pair-legend');
    pair.names.forEach((name,index) => {
      const item = node('span',name);
      item.style.color = summaryChannelColour(pair.channels[index]);
      legend.append(item);
    });
    section.firstElementChild.append(legend);
  }


  let points = (selected?.laps ?? []).map(lap => ({
    lapNumber: lap.number,
    label: lap.number == null ? 'Opening segment' : 'Lap ' + lap.number,
    value: readings?.[lap.id],
    second: secondReadings?.[lap.id]
  }));
  if (isUsage) {
    points = points.filter(point => Number.isFinite(point.value)).sort((a, b) => a.lapNumber - b.lapNumber);
  }
  const pointLabel = point => point.label + (secondReadings
    ? ' · ' + pair.names[0] + ' ' + format(point.value) + ' · ' + pair.names[1] + ' ' + format(point.second,secondKey)
    : ' · ' + format(point.value));
  const readoutWidth = points.reduce((width, point) => Math.max(width, pointLabel(point).length), 0);
  readout.style.width = 'calc(' + readoutWidth + 'ch + 12px)';
  const thresholdFor = channel => convert('',hotTemperature(selected?.carClass,
    ['frontBrakes','rearBrakes'].includes(channel) ? 'brakes' : channel),'°C');
  const threshold = thresholdFor(firstKey);
  const secondThreshold = pair ? thresholdFor(secondKey) : undefined;
  const isHot = (value, limit = threshold) => Number.isFinite(limit) && Number.isFinite(value) && value >= limit;
  const firstValues = points.map(point => point.value).filter(Number.isFinite);
  const secondValues = points.map(point => point.second).filter(Number.isFinite);
  const values = firstValues.concat(secondValues);
  const hasWarnings = firstValues.some(value => isHot(value)) ||
    secondValues.some(value => isHot(value,secondThreshold));
  heading.classList.toggle('temperature-hot', hasWarnings);

  if (values.length) {
    const canvas = node('canvas', null, 'summary-chart-plot');
    if (pair) canvas.style.setProperty('--summary-plot-height-multiplier', '2');
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', label + ' by lap. Use arrow keys to inspect.');
    plot.append(canvas);
    const ctx = canvas.getContext('2d');
    const min = Math.min(...values);
    const max = Math.max(...values);
    const peakIndex = points.findIndex(point => point.value === max || point.second === max);
    const span = max - min;
    const warningRadius = 4;
    const peakRingRadius = warningRadius + 2;
    const inset = peakRingRadius + 2;
    let width = 0, height = 0;
    const x = index => points.length === 1 ? width / 2 : inset + index * (width - 2 * inset) / (points.length - 1);
    const y = value => span ? height - inset - (value - min) * (height - 2 * inset) / span
      : Math.max(inset, (height - 20 * textScale()) / 2);
    let active = -1;
    function draw(index) {
      active = index;
      const point = points[index];
      readout.textContent = point ? pointLabel(point) : '';
      readout.classList.toggle('temperature-hot', isHot(point?.value) || isHot(point?.second,secondThreshold));
      const ratio = canvas.ownerDocument.defaultView.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (point) {
        const px = x(index);
        const value = Number.isFinite(point.value) ? point.value : point.second;
        const py = Number.isFinite(value) ? y(value) : height / 2;
        const left = px + readout.offsetWidth + 8 <= width ? px + 8 : px - readout.offsetWidth - 8;
        readout.style.left = Math.max(0, Math.min(width - readout.offsetWidth, left)) + 'px';
        readout.style.top = Math.max(0, Math.min(height - readout.offsetHeight, py - readout.offsetHeight / 2)) + 'px';
        ctx.strokeStyle = '#a4b3a766';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, height);
        ctx.stroke();
      }
      const series = secondReadings
        ? [['value',colour,threshold],['second',summaryChannelColour(secondKey),secondThreshold]]
        : [['value',colour,threshold]];
      for (const [field,traceColour,limit] of series) {
        ctx.strokeStyle = traceColour;
        ctx.setLineDash(field === 'second' ? [4,3] : []);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let connected = false;
        points.forEach((point, i) => {
          const value = point[field];
          if (!Number.isFinite(value)) {
            connected = false;
            return;
          }
          if (connected) ctx.lineTo(x(i), y(value));
          else ctx.moveTo(x(i), y(value));
          connected = true;
        });
        ctx.stroke();
        points.forEach((point, i) => {
          const value = point[field];
          if (!Number.isFinite(value)) return;
          const hot = isHot(value,limit);
          ctx.fillStyle = hot ? elementColour('warning','#ff8787') : traceColour;
          ctx.beginPath();
          ctx.arc(x(i), y(value), hot ? warningRadius : i === index ? 3.5 : 1.75, 0, Math.PI * 2);
          ctx.fill();
          if (hot && i === index) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        });
      }
      ctx.setLineDash([]);
      const lowestIndex = isUsage ? points.findIndex(point => point.value === min) : -1;
      ctx.lineWidth = 1.5;
      if (peakIndex !== lowestIndex) {
        ctx.strokeStyle = '#ff4545';
        ctx.beginPath();
        ctx.arc(x(peakIndex), y(max), peakRingRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      const minimumColour = lightGraphBackground ? '#7425a3' : '#c084fc';
      if (lowestIndex >= 0) {
        ctx.strokeStyle = minimumColour;
        ctx.beginPath();
        ctx.arc(x(lowestIndex), y(min), peakRingRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      const bounds = canvas.getBoundingClientRect();
      const occupied = [...plot.querySelectorAll('.summary-chart-endpoints span')]
        .map(label => label.getBoundingClientRect())
        .map(rect => ({left:rect.left - bounds.left, right:rect.right - bounds.left,
          top:rect.top - bounds.top, bottom:rect.bottom - bounds.top}));
      function drawValueLabel(pointIndex, value, color) {
        const label = format(value);
        const below = y(value) + peakRingRadius + 2;
        const above = y(value) - peakRingRadius - 2;
        const preferredSize = 12 * textScale();
        const drawBelow = height - below - 1 >= preferredSize || height - below >= above;
        const labelSize = Math.min(preferredSize, drawBelow ? height - below - 1 : above - 1);
        if (labelSize <= 0 || width <= 4) return;
        const labelTop = drawBelow ? below : above - labelSize;
        ctx.font = '700 ' + labelSize + 'px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const halfWidth = Math.min(ctx.measureText(label).width / 2, (width - 4) / 2);
        const minX = halfWidth + 2;
        const maxX = width - halfWidth - 2;
        const centre = Math.max(minX, Math.min(maxX, x(pointIndex)));
        const blocked = occupied
          .filter(rect => rect.top < labelTop + labelSize && rect.bottom > labelTop)
          .map(rect => [rect.left - halfWidth - 3, rect.right + halfWidth + 3]);
        const candidates = [centre, ...blocked.flat()]
          .filter(px => px >= minX && px <= maxX && blocked.every(([left, right]) => px <= left || px >= right))
          .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
        const labelX = candidates[0] ?? centre;
        ctx.strokeStyle = backgroundColour(settings.graphBackgroundColour, '#1d2721');
        ctx.lineWidth = 3;
        ctx.strokeText(label, labelX, labelTop, width - 4);
        ctx.fillStyle = color;
        ctx.fillText(label, labelX, labelTop, width - 4);
        occupied.push({left:labelX - halfWidth, right:labelX + halfWidth, top:labelTop, bottom:labelTop + labelSize});
      }
      if (peakIndex !== lowestIndex) drawValueLabel(peakIndex, max, lightGraphBackground ? '#ad1919' : '#ff6565');
      if (lowestIndex >= 0) drawValueLabel(lowestIndex, min, minimumColour);
    }
    canvas.addEventListener('pointermove', event => {
      const rect = canvas.getBoundingClientRect();
      const fraction = (event.clientX - rect.left - inset) / Math.max(1, width - 2 * inset);
      draw(Math.min(points.length - 1, Math.max(0, Math.round(fraction * (points.length - 1)))));
    });
    canvas.addEventListener('pointerleave', () => draw(-1));
    canvas.addEventListener('focus', () => draw(0));
    canvas.addEventListener('blur', () => draw(-1));
    canvas.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      draw(Math.min(points.length - 1, Math.max(0, active + (event.key === 'ArrowRight' ? 1 : -1))));
    });
    const handle = node('button', null, 'resize');
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Resize ' + label + ' chart. Use arrow keys.');
    const getHeight = () => canvas.getBoundingClientRect().height;
    const setHeight = value => { canvas.style.height = Math.round(Math.min(650, Math.max(24, value))) + 'px'; };
    const savedHeight = settings.summaryChartHeights?.[key];
    if (Number.isFinite(savedHeight)) setHeight(savedHeight);
    attachChartResize(handle, getHeight, setHeight,
      () => save({summaryChartHeights:{...settings.summaryChartHeights, [key]:getHeight()}}),
      () => {
        canvas.style.removeProperty('height');
        const heights = {...settings.summaryChartHeights};
        delete heights[key];
        save({summaryChartHeights:heights});
      });
    section.append(handle);
    summaryPlots.set(canvas, () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width && height) draw(active);
    });
  } else {
    plot.append(node('div', 'No recorded data', 'summary-chart-empty'));
  }
  const labels = isUsage ? ['Least', 'Most'] : ['Start', 'Finish'];
  const edgeValues = isUsage ? [Math.min(...values), Math.max(...values)] : endpoints;
  if (edgeValues) {
    const ends = node('div', null, 'summary-chart-endpoints');
    ends.append(...edgeValues.map((value, index) => node('span',
      labels[index] + ' ' + format(value), isHot(value) ? 'temperature-hot' : undefined)));
    plot.append(ends);
  }
  plot.append(readout);
  return section;
}
function renderMapSectorTimes() {
  const timed = (selected?.laps ?? []).filter(lap => lap.time > 0);
  const fastest = timed.find(lap => lap.time === selected.best);
  const referenceLap = secondary ? reference?.lap : null;
  const referenceHeading = $('map-reference-gap');
  referenceHeading.hidden = !referenceLap;
  referenceHeading.title = referenceLap
    ? 'Current lap minus reference · ' + lapLabel(referenceLap) : '';
  $('map-content').classList.toggle('has-reference-sectors', Boolean(referenceLap));
  $('map-current-lap').textContent = lap?.number == null ? 'Current Lap' : 'Current · Lap ' + lap.number;
  $('map-fastest-lap').textContent = fastest?.number == null ? 'Fastest Lap' : 'Fastest · Lap ' + fastest.number;

  const bestSectors = [0, 1, 2].map(index => {
    const candidates = timed.filter(lap => lap.sectors?.[index] > 0);
    return candidates.reduce((best, lap) => !best || lap.sectors[index] < best.sectors[index] ? lap : best, null);
  });
  const optimal = bestSectors.every(Boolean)
    ? bestSectors.reduce((total, lap, index) => total + lap.sectors[index], 0) : null;
  $('map-sector-note').hidden = ![lap, fastest, referenceLap, ...bestSectors].some(item => item?.validity === 'unconfirmed');
  const gapCell = (current, baseline) => {
    const gap = current > 0 && baseline > 0 ? Math.round((current - baseline) * 1000) / 1000 : NaN;
    return node('td', timeGapLabel(gap), gap > 0 ? 'corner-loss' : gap < 0 ? 'corner-gain' : undefined);
  };
  const rows = bestSectors.map((best, index) => {
    const value = node('td', number(best?.sectors[index], 3));
    if (best?.number != null) value.title = 'Lap ' + best.number;
    const current = lap?.sectors?.[index];
    return ['S' + (index + 1), node('td', number(current, 3)), node('td', number(fastest?.sectors?.[index], 3)), value,
      ...(referenceLap ? [gapCell(current, referenceLap.sectors?.[index])] : [])];
  });
  rows.push(['Total', node('td', lapTime(lap?.time)), node('td', lapTime(fastest?.time)), node('td', lapTime(optimal)),
    ...(referenceLap ? [gapCell(lap?.time, referenceLap.time)] : [])]);
  $('map-sector-rows').replaceChildren(...rows.map(([label, ...values]) => {
    const row = node('tr');
    const heading = node('th', label);
    heading.scope = 'row';
    row.append(heading, ...values);
    return row;
  }));
}
function sessionLength(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const remainder = String(total % 60).padStart(2, '0');
  return hours ? hours + ':' + String(minutes).padStart(2, '0') + ':' + remainder : minutes + ':' + remainder;
}
let summaryCategory = 'vehicle';
const summaryViews = {
  driver:['driver-performance', 'Driver Performance'],
  vehicle:['session-highlights', 'Vehicle Performance'],
  race:['race-summary', 'Race Summary']
};
let practiceRequest;
let practiceComparison;

function selectSummaryCategory(category) {
  summaryCategory = category;
  const driver = category === 'driver';
  const race = category === 'race';
  $('show-driver-performance').setAttribute('aria-pressed', String(driver));
  $('show-vehicle-performance').setAttribute('aria-pressed', String(!driver && !race));
  $('show-race-summary').setAttribute('aria-pressed', String(race));
  $('driver-performance').hidden = !driver;
  $('race-summary').hidden = !race;
  $('session-highlights').inert = driver || race;
  $('choose-summary-channels').hidden = driver || race;
  $('export-summary-image').setAttribute('aria-label', 'Export Image for ' + summaryViews[category][1]);
  $('driver-performance').parentElement.scrollTop = 0;
  if (driver) void updatePracticeReview();
  else if (race) renderRaceGaps();
  else redrawSummaryPlots();
}
$('show-driver-performance').onclick = () => selectSummaryCategory('driver');
$('show-vehicle-performance').onclick = () => selectSummaryCategory('vehicle');
$('show-race-summary').onclick = () => selectSummaryCategory('race');

let raceRecording;
let raceChartObserver;
const hiddenRaceRivals = new Set();
const raceIdentity = value => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function raceResultCard(player, field) {
  const result = player?.result;
  if (!result) return;
  const {position, classPosition, grid, best, laps, finishTime} = result;
  const winner = player.category && field.find(entry => entry.category === player.category && entry.result?.classPosition === 1);
  const winnerLaps = winner?.result.laps;
  const playerTime = finishTime || (player.lastCrossing?.[0] === laps ? player.lastCrossing?.[1] : null);
  const winnerTime = winner?.result.finishTime || (winner?.lastCrossing?.[0] === winnerLaps ? winner?.lastCrossing?.[1] : null);
  let classGap = '—';
  if (winner === player) classGap = 'Class Winner';
  else if (winnerLaps > laps && Number.isFinite(laps) && laps >= 0) {
    const deficit = winnerLaps - laps;
    classGap = '+' + deficit + (deficit === 1 ? ' Lap' : ' Laps');
  } else if (winnerLaps === laps && playerTime > 0 && winnerTime > 0 && playerTime >= winnerTime) {
    classGap = timeGapLabel(playerTime - winnerTime);
  }
  const places = grid > 0 && position > 0 ? grid - position : null;
  const metrics = [
    ['Overall Finish', position > 0 ? 'P' + position : '—'],
    ['Class Finish', classPosition > 0 ? 'P' + classPosition : '—'],
    ['Places Gained', places > 0 ? '+' + places : places ?? '—'],
    ['Best Lap', lapTime(best > 0 ? best : null)],
    ['Gap to Class Winner', classGap]
  ];
  const list = node('dl', undefined, 'race-result-metrics');
  for (const [label, value] of metrics) {
    const metric = node('div');
    metric.append(node('dt', label), node('dd', String(value)));
    list.append(metric);
  }
  $('race-result').append(node('h3', 'Race Result'), list);
}

function renderRaceStints(player) {
  const container = $('race-stints');
  const completed = player?.result?.laps ?? player?.lastCrossing?.[0];
  if (!(completed > 0) || !player.lapTimes?.length) return;
  const pits = [...new Set(player.pitLaps ?? [])].filter(n => n >= 1 && n <= completed).sort((a, b) => a - b);
  const ends = [...new Set([...pits, completed])];
  const table = node('table');
  const head = table.createTHead().insertRow();
  for (const title of ['Stint', 'Laps', 'Lap Count', 'Best Lap', 'Median Pace']) {
    const cell = node('th', title);
    cell.scope = 'col';
    head.append(cell);
  }
  const body = table.createTBody();
  let start = 1;
  for (const [index, end] of ends.entries()) {
    const laps = player.lapTimes.filter(([n]) => n >= start && n <= end && !pits.includes(n - 1)).map(([,time]) => time);
    const times = timingStats(laps);
    const row = body.insertRow();
    for (const value of [index + 1, start === end ? 'L' + start : 'L' + start + '–L' + end,
      end - start + 1, lapTime(laps.length ? Math.min(...laps) : null), lapTime(times.median)]) row.insertCell().textContent = value;
    start = end + 1;
  }
  container.append(node('h3', 'Pit Stints'), table, node('p', 'Pace excludes recorded pit laps and the lap immediately after.'));
}

$('race-field').onchange = renderRaceGaps;
$('race-chart-mode').onchange = renderRaceGaps;

function renderRaceGaps() {
  const container = $('race-gaps');
  raceChartObserver?.disconnect();
  const recording = selected?.path;
  const all = (selected?.raceGaps ?? []).map((entry, index) => ({...entry, index,
    player: raceIdentity(entry.driver) === raceIdentity(selected.driver) && raceIdentity(entry.car) === raceIdentity(selected.car)}));
  const player = all.find(entry => entry.player);
  const categories = new Set(all.map(entry => entry.category).filter(Boolean));
  const fieldSelect = $('race-field');
  const modeSelect = $('race-chart-mode');
  const previousField = fieldSelect.value;
  const newRace = raceRecording !== recording;
  if (newRace) {
    raceRecording = recording;
    hiddenRaceRivals.clear();
    modeSelect.value = 'gaps';
    $('race-rivals').open = false;
  }
  const classAvailable = Boolean(player?.category && categories.size > 1);
  const fieldChanged = fieldSelect.options[1]?.value !== (classAvailable ? player.category : undefined);
  if (fieldChanged || !fieldSelect.options.length) {
    fieldSelect.replaceChildren();
    option(fieldSelect, 'All Classes', '');
    if (classAvailable) option(fieldSelect, player.category, player.category);
    fieldSelect.value = classAvailable ? player.category : '';
  } else {
    fieldSelect.value = newRace ? (classAvailable ? player.category : '') : previousField;
  }
  fieldSelect.parentElement.hidden = !classAvailable;
  const category = fieldSelect.value;
  const positionAvailable = all.some(entry => entry.positions?.length > 1);
  modeSelect.options[1].disabled = !positionAvailable;
  if (!positionAvailable) modeSelect.value = 'gaps';
  const positions = modeSelect.value === 'positions';
  const chartTitle = positions ? 'Overall Position by Lap' : category ? 'Race Gaps to the Class Leader' : 'Race Gaps to the Leader';
  $('race-gaps-title').textContent = chartTitle;
  $('race-chart-controls').hidden = all.length < 2;
  $('race-result').replaceChildren();
  $('race-stints').replaceChildren();
  raceResultCard(player, all);
  renderRaceStints(player);
  const candidates = all.filter(entry => !category || entry.category === category);
  const rivals = $('race-rival-options');
  rivals.replaceChildren(...candidates.filter(entry => !entry.player).map(entry => {
    const label = node('label');
    const box = node('input');
    box.type = 'checkbox';
    box.checked = !hiddenRaceRivals.has(entry.index);
    box.onchange = () => {
      if (box.checked) hiddenRaceRivals.delete(entry.index);
      else hiddenRaceRivals.add(entry.index);
      renderRaceGaps();
      rivals.querySelector(`[data-entry="${entry.index}"] input`)?.focus();
    };
    label.dataset.entry = entry.index;
    label.append(box, entry.driver || entry.car || 'Unknown Driver');
    return label;
  }));
  const field = candidates.filter(entry => entry.player || !hiddenRaceRivals.has(entry.index))
    .map(entry => ({...entry, points: positions ? entry.positions ?? [] :
      entry.gaps.map(([lapNumber, overall, inClass]) => [lapNumber, category ? inClass : overall])}))
    .filter(entry => entry.points.length);
  if (!field.length || all.length < 2 && !positions) {
    container.replaceChildren(node('p', 'Race gaps require a matching LMU results file with lap timing for at least two cars.'));
    return;
  }
  const chart = container.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chart.setAttribute('role', 'img');
  chart.setAttribute('aria-label', player ? chartTitle + ' · ' + player.driver + ' highlighted' : chartTitle);
  container.replaceChildren(chart);
  raceChartObserver = new ResizeObserver(([{contentRect}]) => {
    const {width, height} = contentRect;
    if (width > 75 && height > 45) drawRaceChart(chart, field, positions, width, height);
  });
  raceChartObserver.observe(chart);
}

function drawRaceChart(chart, field, positions, width, height) {
  chart.replaceChildren();
  chart.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const left = 49, right = width - 24, top = 14, bottom = height - 26;
  let lastLap = 1, largestGap = 0;
  for (const {points} of field) {
    for (const [lapNumber, gap] of points) {
      lastLap = Math.max(lastLap, lapNumber);
      largestGap = Math.max(largestGap, gap);
    }
  }
  const roughStep = Math.max(1, largestGap / 5);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const gapStep = [1, 2, 5, 10].find(step => step * magnitude >= roughStep) * magnitude;
  const gapTicks = Math.max(1, Math.ceil(largestGap / gapStep));
  const x = value => left + (value - 1) / Math.max(1, lastLap - 1) * (right - left);
  const y = value => top + (positions ? (value - 1) / Math.max(1, largestGap - 1) : value / (gapTicks * gapStep)) * (bottom - top);
  const svg = (parent, tag, attributes, text) => {
    const element = parent.ownerDocument.createElementNS(chart.namespaceURI, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    parent.append(element);
    return element;
  };
  const tickStep = positions ? Math.max(1, Math.ceil((largestGap - 1) / 5)) : gapStep;
  const tickMax = positions ? largestGap : gapTicks * gapStep;
  for (let gap = positions ? 1 : 0; gap <= tickMax; gap += tickStep) {
    svg(chart, 'line', {x1:left, x2:right, y1:y(gap), y2:y(gap), class:'race-gap-grid'});
    svg(chart, 'text', {x:left - 6, y:y(gap) + 4, 'text-anchor':'end'}, (positions ? 'P' + gap : gap + ' s'));
  }
  const lapStep = Math.max(1, Math.ceil((lastLap - 1) / 8));
  const laps = [];
  for (let n = 1; n < lastLap - lapStep / 2; n += lapStep) laps.push(n);
  laps.push(lastLap);
  for (const n of laps) {
    svg(chart, 'line', {x1:x(n), x2:x(n), y1:top, y2:bottom, class:'race-gap-grid'});
    svg(chart, 'text', {x:x(n), y:bottom + 18, 'text-anchor':'middle'}, 'L' + n);
  }
  const playerTrace = chart.ownerDocument.createElementNS(chart.namespaceURI, 'g');
  field.forEach(({driver, car, points, player, pitLaps}) => {
    const trace = player ? playerTrace : chart;
    const colour = 'var(--accent)';
    const label = driver || car || 'Unknown Driver';
    let previousLap;
    const path = points.map(([n, gap]) => {
      const command = n === previousLap + 1 ? 'L' : 'M';
      previousLap = n;
      return command + x(n) + ',' + y(gap);
    }).join(' ');
    if (!player) {
      const rival = svg(trace, 'path', {d:path, fill:'none', class:'race-rival-trace'});
      svg(rival, 'title', {}, label);
      return;
    }
    svg(trace, 'path', {d:path, fill:'none', stroke:'var(--panel)', 'stroke-width':5});
    svg(trace, 'path', {d:path, fill:'none', stroke:colour, 'stroke-width':3});
    for (const [n, gap] of points) {
      const radius = lastLap > 80 ? 2.7 : 3.7;
      const dot = svg(trace, 'circle', {cx:x(n), cy:y(gap), r:radius, fill:colour});
      const reading = label + ' · Lap ' + n + ' · ' + (positions ? 'P' + gap : number(gap, 3) + ' s');
      svg(dot, 'title', {}, reading);
      if (pitLaps?.includes(n)) {
        const marker = svg(trace, 'circle', {cx:x(n), cy:y(gap), r:radius + 3, fill:'none',
          stroke:'var(--warning,#ffd078)', 'stroke-width':2});
        svg(marker, 'title', {}, reading + ' · Pit Lap');
      }
    }
  });
  chart.append(playerTrace);
}

const practiceTabs = bindTabs('practice-tabs', () => { $('practice-content').scrollTop = 0; });
function clearPracticePanels() {
  practiceLapLabels.disconnect();
  for (const tab of practiceTabs) $(tab.getAttribute('aria-controls')).replaceChildren();
}


function timingStats(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (!sorted.length) return {count:0};
  return {
    count:sorted.length,
    median:sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    spread:sorted.at(-1) - sorted[0]
  };
}

const practiceLapLabels = new ResizeObserver(([{target:plot, contentRect}]) => {
  if (!contentRect.width) return;
  const labels = [...plot.querySelectorAll('.practice-lap-label')];
  const labelWidth = labels.reduce((widest, label) => Math.max(widest, label.getBoundingClientRect().width), 0);
  const step = Math.max(1, Math.ceil((labelWidth + 4) * labels.length / contentRect.width));
  const intervals = Math.floor((labels.length - 1) / step);
  const visible = new Set([0]);
  for (let i = 1; i <= intervals; i++) visible.add(Math.round(i * (labels.length - 1) / intervals));
  labels.forEach((label, index) => label.classList.toggle('visible', visible.has(index)));
});

function practiceInterfaceTips(...tips) {
  const list = node('ul', undefined, 'practice-interface-tips');
  list.append(...tips.map(tip => node('li', tip)));
  return list;
}

function renderLapConsistency(measured, stats) {
  const section = node('section', undefined, 'practice-lap-consistency');
  section.append(node('h4', 'Lap Consistency'));
  if (stats.count < 2) {
    section.append(node('p', 'Two laps are needed to compare lap times.'));
    return section;
  }

  const tolerance = stats.median * .005;
  const deviations = measured.map(({lap}) => lap.time - stats.median);
  const close = deviations.filter(delta => Math.abs(delta) <= tolerance).length;
  const metrics = node('div', undefined, 'practice-overview-metrics');
  const range = node('div', undefined, 'practice-spread-card');
  range.append(node('strong', number(stats.spread, 3) + ' s'),
    node('p', 'Fastest to slowest lap'));
  const consistency = node('div', undefined, 'practice-spread-card');
  const bar = node('progress');
  bar.max = stats.count;
  bar.value = close;
  bar.setAttribute('aria-label', 'Laps within 0.5% of the median');
  consistency.append(node('strong', close + ' of ' + stats.count + ' laps'),
    node('p', 'Within 0.5% of the median'), bar);
  metrics.append(range, consistency);
  section.append(metrics);
  const scale = Math.max(.001, ...deviations.map(Math.abs));
  const plot = node('ol', undefined, 'practice-lap-plot');
  plot.setAttribute('aria-label', 'Lap times in order, compared with the median');
  measured.forEach(({lap}, index) => {
    const delta = deviations[index];
    const label = lap.number == null ? 'Recording' : 'Lap ' + lap.number;
    const difference = Math.round(delta * 1000) / 1000;
    const reading = label + ' in ' + lapTime(lap.time) + '. ' + (difference === 0 ? 'Matches the median.' :
      number(Math.abs(difference), 3) + ' s ' + (difference < 0 ? 'faster' : 'slower') + ' than the median.');
    const column = node('li');
    column.title = reading;
    column.setAttribute('aria-label', reading);
    const track = node('span', undefined, 'practice-lap-track');
    const bar = node('span', undefined, 'practice-lap-bar');
    bar.style.setProperty('--magnitude', (50 * Math.abs(delta) / scale) + '%');
    bar.classList.toggle('faster', delta < 0);
    bar.classList.toggle('median', delta === 0);
    track.append(bar);
    column.append(track, node('span', lap.number == null ? 'Rec.' : String(lap.number), 'practice-lap-label'));
    plot.append(column);
  });
  practiceLapLabels.observe(plot);
  section.append(plot);
  return section;
}

function renderConsistencySpreads(measured) {
  const section = node('section', undefined, 'practice-section practice-spreads');
  section.append(node('h3', 'Lap and Sector Consistency'));
  const timings = [
    ['Lap', measured.map(({lap}) => lap.time), lapTime],
    ...[0, 1, 2].map(index => ['Sector ' + (index + 1),
      measured.map(({lap}) => lap.sectors?.[index]).filter(time => time > 0),
      time => number(time, 3) + ' s'])
  ].map(([label, values, format]) => {
    const valid = values.filter(Number.isFinite);
    return {label, format, shortest:Math.min(...valid), longest:Math.max(...valid), ...timingStats(valid)};
  });
  const scale = Math.max(.001, ...timings.filter(item => item.count > 1)
    .map(({shortest, longest, median}) => Math.max(median - shortest, longest - median)));
  const cards = node('div', undefined, 'practice-spread-grid');
  for (const {label, format, shortest, longest, count, spread, median} of timings) {
    const card = node('div', undefined, 'practice-spread-card');
    card.append(node('h4', label));
    if (count < 2) {
      card.append(node('p', count ? 'Only one recorded time (' + format(median) + '). Two are needed to show a spread.' : 'No times available.'));
    } else {
      const track = node('div', undefined, 'practice-spread-track');
      track.setAttribute('aria-hidden', 'true');
      const faster = node('span', undefined, 'practice-spread-faster');
      faster.style.width = (50 * (median - shortest) / scale) + '%';
      const slower = node('span', undefined, 'practice-spread-slower');
      slower.style.width = (50 * (longest - median) / scale) + '%';
      const marker = node('span', undefined, 'practice-spread-marker');
      track.append(faster, slower, marker);
      const directions = node('div', undefined, 'practice-spread-directions');
      directions.append(node('span', '← Faster'), node('span', 'Slower →'));
      card.append(node('strong', number(spread, 3) + ' s spread'), track, directions,
        node('p', 'Fastest ' + format(shortest) + ' · Slowest ' + format(longest)),
        node('p', 'Median ' + format(median) + ' across ' + count + ' laps'));
    }
    cards.append(card);
  }
  section.append(cards);
  return section;
}

const practiceConditionLabels = new Map([
  ['dry', 'Dry'], ['damp', 'Damp Off-Line'], ['wet', 'Wet'],
  ['changing', 'Changing'], ['unknown', 'Unknown']
]);
function practiceStints(laps) {
  const stints = new Map();
  let stint = 0, needsStart = true;
  for (const lap of laps) {
    if (lap.kind === 'in-lap' || lap.kind === 'out-lap') needsStart = true;
    if (lap.kind !== 'complete') continue;
    if (needsStart) stint++;
    needsStart = false;
    stints.set(lap.id, stint);
  }
  return stints;
}
function practiceFilter(select, label, options) {
  const previous = select.value;
  select.replaceChildren();
  option(select, label, '');
  for (const [value, text] of options) option(select, text, String(value));
  if (Array.from(select.options).some(item => item.value === previous)) select.value = previous;
  return select.value;
}
for (const id of ['practice-stint', 'practice-condition']) {
  $(id).onchange = () => {
    if (practiceRequest?.samples) renderPracticeReview(practiceRequest);
  };
}

$('reset-practice-filters').onclick = () => {
  $('practice-stint').value = '';
  $('practice-condition').value = '';
  if (practiceRequest?.samples) renderPracticeReview(practiceRequest);
};

function practiceTyreLaps(laps, samples, stints) {
  const plateauTolerance = 2;
  const rows = laps.map(lap => {
    const sample = samples.get(lap.id);
    const tyres = sample?.tyres ?? [];
    const measured = tyres.length === 2 && tyres.every(values => values?.length === 4 && values.every(Number.isFinite));
    return {lap, stint:stints.get(lap.id), condition:sample?.condition ?? 'unknown',
      times:sample?.times ?? [], postCornerSpeeds:sample?.postCornerSpeeds ?? [], tyres, temperature:measured ? 'unsettled' : 'unknown'};
  });
  let previous;
  for (const row of rows) {
    if (row.temperature === 'unknown') { previous = undefined; continue; }
    const consecutive = previous && previous.stint === row.stint && Number.isFinite(row.lap.number) && row.lap.number === previous.lap.number + 1;
    if (consecutive && row.tyres[0].every((_, wheel) => {
      const values = [...previous.tyres, ...row.tyres].map(sample => sample[wheel]);
      return Math.max(...values) - Math.min(...values) <= plateauTolerance;
    })) {
      previous.temperature = row.temperature = 'in-range';
    }
    previous = row;
  }
  return rows;
}

function renderPracticeReview(request) {
  const {session, laps, corners, samples} = request;
  const status = $('practice-status');
  clearPracticePanels();
  const allRows = practiceTyreLaps(laps, samples, practiceStints(session.laps));
  const stints = [...new Set(allRows.map(row => row.stint))];
  const conditions = new Set(allRows.map(row => row.condition));
  $('practice-filters').hidden = false;
  const stint = practiceFilter($('practice-stint'), 'All Stints', stints.map(id => [id, 'Stint ' + id]));
  const condition = practiceFilter($('practice-condition'), 'All Conditions',
    [...practiceConditionLabels].filter(([key]) => conditions.has(key)));
  const rows = allRows.filter(row => (!stint || String(row.stint) === stint) && (!condition || row.condition === condition));
  const known = rows.some(row => row.temperature !== 'unknown');
  const measured = known ? rows.filter(row => row.temperature === 'in-range') : rows;
  status.textContent = rows.length ? '' : 'No timed laps match the selected stint and track condition.';
  if (!rows.length) return;

  const lapStats = timingStats(measured.map(({lap}) => lap.time));
  const mostInconsistent = corners.map(({index}, offset) => {
    const runs = measured.filter(row => Number.isFinite(row.times[offset]))
      .map(row => ({lap:row.lap, time:row.times[offset]}))
      .sort((a, b) => a.time - b.time);
    return {index, runs, ...timingStats(runs.map(run => run.time))};
  }).filter(row => row.count > 1)
    .sort((a, b) => b.spread - a.spread || b.count - a.count || a.index - b.index).slice(0, 3);

  const overview = node('section', undefined, 'practice-section practice-overview');
  overview.append(node('h3', 'Driver Overview'), renderLapConsistency(measured, lapStats));
  const cornersHeading = node('h4', 'Most Inconsistent Corners');
  overview.append(cornersHeading);
  if (mostInconsistent.length) {
    const list = node('ol', undefined, 'practice-consistent-corners');
    list.setAttribute('aria-label', cornersHeading.textContent);
    const scale = Math.max(.001, mostInconsistent[0].spread);
    for (const {index, runs, spread, count} of mostInconsistent) {
      const best = runs[0];
      const slower = runs.at(-1).lap;
      const action = node('button', 'Corner ' + (index + 1));
      action.type = 'button';
      action.onclick = () => void openPracticeCorner(request, slower, best.lap, index, best);
      const item = node('li');
      const reading = node('span', number(spread, 3) + ' s · ' + count + ' laps', 'practice-corner-reading');
      const track = node('span', undefined, 'practice-spread-track');
      const band = node('span');
      band.style.width = (100 * spread / scale) + '%';
      track.setAttribute('aria-hidden', 'true');
      track.append(band);
      item.append(action, reading, track);
      list.append(item);
    }
    overview.append(list, practiceInterfaceTips('Select a corner to compare its fastest and slowest runs.'));
  } else {
    overview.append(node('p', 'Corner comparisons need at least two laps with recorded corner times.'));
  }

  const speedHeading = node('h4', 'Largest Post-Corner Top Speed Spread');
  overview.append(speedHeading);
  const speedSpreads = corners.map(({index}, offset) => {
    const runs = measured.map(row => ({lap:row.lap, speed:row.postCornerSpeeds[offset]}))
      .filter(run => Number.isFinite(run.speed)).sort((a, b) => a.speed - b.speed);
    return {index, runs, ...timingStats(runs.map(run => run.speed))};
  }).filter(row => row.count > 1)
    .sort((a, b) => b.spread - a.spread || b.count - a.count || a.index - b.index).slice(0, 3);
  if (speedSpreads.length) {
    const list = node('ol', undefined, 'practice-consistent-corners');
    list.setAttribute('aria-label', speedHeading.textContent);
    const scale = Math.max(.001, speedSpreads[0].spread);
    const digits = telemetryDecimalPlaces('Ground Speed');
    for (const {index, runs, spread, count} of speedSpreads) {
      const [low, high] = [runs[0], runs.at(-1)];
      const action = node('button', 'Corner ' + (index + 1));
      action.type = 'button';
      action.onclick = () => void openPracticeCorner(request, low.lap, high.lap, index, undefined, true);
      const item = node('li');
      const track = node('span', undefined, 'practice-spread-track');
      track.setAttribute('aria-hidden', 'true');
      const band = node('span');
      band.style.width = (100 * spread / scale) + '%';
      track.append(band);
      const reading = measurement(spread,'km/h',digits) + ' spread (' + number(convert('',low.speed,'km/h'),digits) + '–' +
        measurement(high.speed,'km/h',digits) + ') · ' + count + ' laps';
      item.append(action, track, node('span', reading, 'practice-corner-reading'));
      list.append(item);
    }
    overview.append(list);
  } else {
    overview.append(node('p', 'Speed spreads need at least two laps with recorded speeds through the next braking point.'));
  }

  const tyreNote = known
    ? 'Laps only count towards consistency once tyre temperatures have stabilised.'
    : 'Tyre temperatures are unavailable for these laps, so warm-up could not be checked.';
  overview.append(practiceInterfaceTips(tyreNote));
  const consistency = renderConsistencySpreads(measured);
  consistency.append(practiceInterfaceTips(tyreNote));
  $('practice-overview').append(overview);
  $('practice-consistency').append(consistency);
}

async function updatePracticeReview() {
  if (summaryCategory !== 'driver') return;
  const session = selected;
  const status = $('practice-status');
  status.removeAttribute('title');
  const eligible = session?.laps.filter(item => !item.pitLaneAtBoundary && eligibleRecordLap(item)) ?? [];
  const official = eligible.filter(lap => lap.validity === 'official');
  const laps = (official.length >= 2 ? official : eligible).sort((a, b) => a.start - b.start);
  if (!session || !laps.length) {
    practiceRequest = undefined;
    $('practice-filters').hidden = true;
    clearPracticePanels();
    status.textContent = 'Open a session with timed laps to see your driving feedback.';
    return;
  }
  const key = JSON.stringify([session.path, laps.map(lap => [lap.id, lap.start, lap.end, lap.time, lap.validity, lap.sectors])]);
  if (practiceRequest?.key === key) {
    if (practiceRequest.samples) renderPracticeReview(practiceRequest);
    return;
  }
  const request = {key, session, laps};
  if (practiceRequest?.session.path !== session.path) {
    $('practice-stint').value = '';
    $('practice-condition').value = '';
  }
  practiceRequest = request;
  $('practice-filters').hidden = true;
  clearPracticePanels();
  status.textContent = 'Checking your lap times and tyre temperatures…';
  const anchor = laps.reduce((best, lap) => lap.time < best.time ? lap : best);
  try {
    let geometry;
    try {
      geometry = prepare(anchor, await lmu.lap(session.path, anchor.id));
    } catch {
      // Timings and tyre readiness can still be reviewed without a GPS route.
    }
    const gps = geometry?.useDistance ? route(geometry) : [];
    const corners = gps.length ? routeCorners(geometry, Math.cos(gps[0][1] * Math.PI / 180))
      .map((corner, index) => ({index, from:geometry.distanceAt(corner.start), to:geometry.distanceAt(corner.end)}))
      .filter(({from, to}) => from >= 0 && to > from).slice(0, 200) : [];
    if (practiceRequest !== request || selected?.path !== session.path) return;
    const samples = await lmu.practiceReview(session.path, laps.map(lap => lap.id),
      corners.map(({from, to}) => [from, to]));
    if (practiceRequest !== request || selected?.path !== session.path) return;
    Object.assign(request, {corners, samples:new Map(samples.map(sample => [sample.id, sample]))});
    if (summaryCategory === 'driver') renderPracticeReview(request);
  } catch (error) {
    if (practiceRequest !== request) return;
    practiceRequest = undefined;
    status.textContent = 'Could not load driver feedback for this session.';
    status.title = error.message;
  }
}

async function openPracticeCorner(request, representative, benchmark, index, best, includePostCorner = false) {
  if (practiceRequest !== request || selected?.path !== request.session.path) return;
  await openCornerComparison(selected, request, representative, benchmark, index, best, includePostCorner);
}

async function openCornerComparison(session, request, representative, benchmark, index, best, includePostCorner = false) {
  const overview = reviewingPracticeCorner() && practiceComparison.request === request
    ? practiceComparison.overview : {
      fullScreen:summaryDialog.open,
      stint:$('practice-stint').value,
      condition:$('practice-condition').value,
      scrollTop:$('practice-content').scrollTop
    };
  const comparison = {request, path:session.path, lapId:representative.id, benchmarkId:benchmark.id,
    corners:request.corners, index, best, includePostCorner, overview};
  referenceSessionPath = session.path;
  referenceSessionLapId = benchmark.id;
  if (summaryDialog.open) summaryDialog.close();
  await openSession(session, representative, comparison);
  if (practiceComparison !== comparison || !reviewingPracticeCorner() || !secondary) return;
  const corner = $('corner-time-loss')?.querySelector('[data-corner-index="' + index + '"]');
  if (!corner) return;
  if (!cornerTimeLossOpen) chartRows.find(row => row.key === 'delta')?.cornerAnalysis?.toggle.click();
  corner.click();
  corner.scrollIntoView({block:'nearest'});
  window.focus();
}

function returnToDriverOverview({fullScreen, stint, condition, scrollTop}) {
  $('practice-stint').value = stint;
  $('practice-condition').value = condition;
  selectSummaryCategory('driver');
  $('practice-tab-overview').click();
  if (fullScreen && !summaryDialog.open && !summaryToggle.hidden) summaryToggle.click();
  const panel = $('practice-overview');
  panel.scrollIntoView({block:'nearest'});
  $('practice-content').scrollTop = scrollTop;
  $('practice-tab-overview').focus({preventScroll:true});
}

function renderAdditionalConditions(conditions = {}) {
  const wetness = (conditions.wetness ?? []).map(value =>
    Number.isFinite(value) && value >= 0 && value <= 1 ? number(value * 100, 0) + '%' : '');
  const wind = (conditions.windSpeed ?? []).map((speed, index) => {
    if (!Number.isFinite(speed) || speed < 0) return '';
    const heading = conditions.windHeading?.[index];
    // LMU recordings store wind heading in radians despite labelling the channel degrees.
    const compass = Number.isFinite(heading) && speed > 0
      ? ['N','NE','E','SE','S','SW','W','NW'][((Math.round(heading * 4 / Math.PI) % 8) + 8) % 8] : '';
    return [measurement(speed * 3.6, 'km/h', 0), compass].filter(Boolean).join(' ');
  });
  for (const [key, [start, finish]] of [['wetness', wetness], ['wind', wind]]) {
    const value = start && finish && start !== finish ? start + ' → ' + finish : start || finish || '';
    $('map-' + key + '-row').hidden = !value;
    $('map-' + key).textContent = value;
  }
}
function renderSessionSummary() {
  const isRace = /^race/i.test(selected?.session ?? '');
  $('show-race-summary').hidden = !isRace;
  if (summaryCategory === 'race') {
    if (isRace) renderRaceGaps();
    else selectSummaryCategory('vehicle');
  }
  void updatePracticeReview();
  updateBestLapExport();
  renderMapSectorTimes();
  const summary = selected?.sessionSummary;
  renderAdditionalConditions(summary?.conditionEndpoints);
  $('map-session-length').textContent = sessionLength(selected?.durationSeconds);
  const [weatherStart, weatherFinish] = summary?.weatherEndpoints ?? [];
  $('map-weather').textContent = weatherStart && weatherFinish && weatherStart !== weatherFinish
    ? weatherStart + ' through to ' + weatherFinish
    : (weatherStart || weatherFinish || '—');
  for (const channel of ['track','air']) {
    $('map-' + channel + '-label').textContent = telemetryName(summaryChannelKeys[channel], channel === 'track' ? 'Track Temp' : 'Air Temp') + ':';
    const readings = summary?.temperatureEndpoints?.[channel];
    for (const [index, bound] of ['start','finish'].entries()) {
      const value = readings?.[index];
      $('map-' + channel + '-' + bound).textContent = Number.isFinite(value) ? measurement(value,'°C',telemetryDecimalPlaces(summaryChannelKeys[channel])) : '—';
    }
  }
  const hidden = hiddenSummaryChannels();
  const chartOptions = [
    ...summaryTemperatureOptions.map(([key, label]) => [key, telemetryName(summaryChannelKeys[key] ?? key, label), displayUnit('','°C'),
      Object.fromEntries(Object.entries(summary?.peakTemperaturesByLap?.[key] ?? {}).map(([id,value]) => [id,convert('',value,'°C')])),
      (summary?.chartEndpoints?.[key] ?? summary?.temperatureEndpoints?.[key])?.map(value => convert('',value,'°C'))]),
    ['virtualEnergy', telemetryName('virtualEnergy'), '%', summary?.energyUsedByLap]
  ].filter(([key]) => !hidden.has(key));
  chartOptions.push(...extraSummaryOptions(selected));
  orderSummaryOptions(chartOptions, ([key]) => key);
  for (const {setting,key,channels,label} of summaryTemperaturePairs) {
    if (!settings[setting] || channels.some(channel => hidden.has(channel))) continue;
    const [first,second] = channels.map(channel => chartOptions.findIndex(([key]) => key === channel));
    const [, , unit, firstValues] = chartOptions[first];
    const [, , , secondValues] = chartOptions[second];
    chartOptions.splice(Math.max(first,second),1);
    chartOptions.splice(Math.min(first,second),1,[key,label,unit,firstValues,undefined,secondValues]);
  }
  $('session-highlights').hidden = !chartOptions.length;
  summaryPlots.clear();
  $('session-charts').replaceChildren(...chartOptions.map(option => summaryChart(...option)));
  observeSummaryPlots();

  renderInCarSettings();
}
function lapSetting(channel, currentLap) {
  if (!channel || !currentLap) return {};
  let initial, current;
  let changes = 0;
  for (let index = 0; index < channel.times.length; index++) {
    const time = channel.times[index];
    if (time >= currentLap.end) break;
    const value = channel.rows[index][channel.rate ? 0 : 1];
    if (!Number.isFinite(value)) continue;
    if (time <= currentLap.start) initial = value;
    else if (current !== undefined && current !== value) changes++;
    current = value;
  }
  return {initial, final:current, changes};
}
function renderInCarSettings() {
  const summary = selected?.sessionSummary;
  const hidden = hiddenSummaryChannels();
  const isHypercar = selected?.carClass === 'Hypercar';
  const visibleSettings = inCarSettings.filter(([key]) =>
    key !== 'FuelMixtureMap' && !hidden.has(key) && (key !== 'Brake Migration' || isHypercar));
  const visibleHypercarSettings = isHypercar
    ? hypercarSetupOptions.filter(([key]) => !hidden.has(key) && summary?.hypercarSetup?.[key])
    : [];
  $('session-settings-group').hidden = !(visibleSettings.length || visibleHypercarSettings.length);
  const settingsList = $('session-settings');
  const settingRow = (key, label, value) => {
    const row = node('div');
    row.append(node('dt', telemetryName(key, label)), value);
    return row;
  };
  settingsList.replaceChildren(...visibleSettings.map(([channel, label]) => {
    const event = lapSetting(primary?.channels[channel], primary?.lap);
    function format(value) {
      if (channel !== 'Brake Bias Rear') {
        const places = telemetryDecimalPlaces(channel, null);
        return places === null ? Number(value.toFixed(2)).toString() : number(value, places);
      }
      // Observed LMU recordings store rear brake bias as a fraction.
      const rear = value >= 0 && value <= 1 ? value * 100 : value;
      const places = telemetryDecimalPlaces(channel);
      return number(100 - rear, places) + ':' + number(rear, places);
    }
    const value = node('dd', event.initial === undefined ? '—' : format(event.initial));
    if (event?.changes) {
      value.title = 'Start ' + (event.initial === undefined ? '—' : format(event.initial)) + ' · Finish ' + format(event.final);
      value.append(' ', node('small', '(' + event.changes + (event.changes === 1 ? ' change)' : ' changes)')));
    }
    return settingRow(channel, label, value);
  }));
  for (const [key, label] of visibleHypercarSettings) {
    const value = node('dd', summary.hypercarSetup[key] + ' (setup)');
    value.title = 'Value from the recorded car setup.';
    settingsList.append(settingRow(key, label, value));
  }
}
function updateContext() {
  if (!ready) return;
  $('map-status').textContent = lap.validity === 'official' ? ''
    : lap.time ? '' : lap.kind === 'complete'
      ? lap.validity === 'no official time' ? 'No official time' : 'No recorded time' : lap.kind;
}
const sectorZoomButtons = [...document.querySelectorAll('[data-zoom-sector]')];
function updateSectorZoom(data) {
  const bounds = new Map();
  const channel = data?.channels['Current Sector'];
  if (channel) {
    const {start, end} = data.lap;
    const firstSample = Math.min(start + .03, end);
    let from = start;
    let state = sample(channel, firstSample)?.[0];
    const addInterval = until => {
      // LMU uses 0 for the third sector.
      const sector = state === 0 ? 3 : state;
      if (![1, 2, 3].includes(sector) || until - from < .1) return;
      const left = data.distanceAt(from), right = data.distanceAt(until);
      if (right - left <= .01) return;
      const previous = bounds.get(sector);
      if (!previous || right - left > previous[1] - previous[0]) bounds.set(sector, [left, right]);
    };
    for (const [time, next] of channel.rows) {
      if (time <= firstSample || time >= end || next === state) continue;
      addInterval(time);
      from = time;
      state = next;
    }
    addInterval(end);
  }
  for (const button of sectorZoomButtons) {
    const sectorRange = bounds.get(Number(button.dataset.zoomSector));
    button.disabled = !sectorRange;
    button.onclick = sectorRange ? () => {
      stop();
      selection = null;
      pinned = false;
      setTelemetryZoom([...sectorRange]);
      updatePin();
      seek(range[0], false);
    } : null;
  }
}
function resetZoom() {
  if (!primary) return;
  range = [primary.extent[0], Math.max(primary.extent[1], primary.extent[0]+.01)];
  restoreTrackCamera();
  scheduleRender();
}
function setTelemetryZoom(next) {
  range = next;
  if (next[0] <= primary.extent[0] + .01 && next[1] >= primary.extent[1] - .01) {
    restoreTrackCamera();
    return;
  }
  previousTrackCamera ??= {mode:trackCameraMode.value, camera:{...trackCamera}, override:trackCameraOverride};
  trackCameraMode.value = 'section';
  trackCameraOverride = undefined;
}
function availableChannels() {
  if (!ready) return [];
  return [...new Set([...Object.keys(primary.channels), ...Object.keys(secondary?.channels || {})])]
    .sort((a, b) => a.localeCompare(b));
}
function orderedChannels() {
  const available = new Set(availableChannels());
  return [...enabled].filter(name => available.has(name));
}
function buildChannels(updateSelector = true) {
  if (!ready) return;
  readoutRows = [];
  const rows = orderedChannels().map(name => {
    const row = node('div', undefined, 'channel');
    const read = node('div', undefined, 'reading');
    const a = node('span', '—', 'selected-color');
    const b = node('span', '—', 'reference-color');
    read.append(a);
    if (secondary) read.append(b);
    row.append(node('h3', telemetryName(name), 'channel-title'), read);
    readoutRows.push({name, a, b});
    return row;
  });
  $('channel-list').replaceChildren(...rows);
  if (!rows.length) $('channel-list').append(node('p', 'Use Select Telemetry Channels to show their values here.'));
  if (updateSelector && $('channel-dialog').open) {
    if ($('channel-order-pane').hidden) buildChannelSelector(); else buildChannelOrder();
  }
  scheduleRender();
}
function shownChannels() {
  const filter = $('channel-search').value.trim().toLowerCase();
  return availableChannels().filter(name => name.toLowerCase().includes(filter) || telemetryName(name).toLowerCase().includes(filter));
}
function updateChannelCount() {
  const available = availableChannels();
  $('channel-count').textContent = available.filter(name => enabled.has(name)).length + ' of ' + available.length + ' enabled';
}
function buildChannelSelector() {
  const options = shownChannels().map(name => {
    const label = node('label');
    const box = node('input');
    box.type = 'checkbox';
    box.checked = enabled.has(name);
    box.addEventListener('change', () => {
      if (box.checked) enabled.add(name); else enabled.delete(name);
      save({enabled:[...enabled]});
      buildChannels(false);
      updateChannelCount();
    });
    label.append(box, telemetryName(name));
    return label;
  });
  $('channel-options').replaceChildren(...options);
  if (!options.length) $('channel-options').append(node('p', 'No channels found.'));
  updateChannelCount();
}

function buildChannelOrder(movedName, direction) {
  const names = orderedChannels();
  let focusButton;
  const rows = names.map((name, index) => {
    const row = node('li');
    row.append(node('span', telemetryName(name)));
    for (const [offset, symbol, action] of [[-1, '↑', 'up'], [1, '↓', 'down']]) {
      const button = node('button', symbol);
      button.setAttribute('aria-label', 'Move ' + telemetryName(name) + ' ' + action);
      const neighbor = names[index+offset];
      button.disabled = neighbor === undefined;
      button.onclick=()=>{
        const order = [...enabled];
        const from = order.indexOf(name);
        const to = order.indexOf(neighbor);
        [order[from], order[to]] = [order[to], order[from]];
        enabled = new Set(order);
        save({enabled:order});
        buildChannels(false);
        buildChannelOrder(name, offset);
      };
      if (name === movedName && !button.disabled && (!focusButton || offset === direction)) focusButton = button;
      row.append(button);
    }
    return row;
  });
  $('channel-order-options').replaceChildren(...rows);
  $('channel-order-empty').hidden = names.length > 0;
  focusButton?.focus();
}
function showChannelMode(order) {
  $('channel-select-tab').setAttribute('aria-pressed', String(!order));
  $('channel-order-tab').setAttribute('aria-pressed', String(order));
  $('channel-select-pane').hidden = order;
  $('channel-order-pane').hidden = !order;
  if (order) buildChannelOrder(); else buildChannelSelector();
}

function updateMergePicker() {
  const filter = $('merge-search').value.trim().toLowerCase();
  const names = [...new Set([...availableChannels(), ...mergeChoices])].filter(name => name !== mergeChart.channelName && (name.toLowerCase().includes(filter) || telemetryName(name).toLowerCase().includes(filter)) &&
    (mergeChoices.has(name) || [primary, secondary].some(data => data?.channels[name]?.rows.some(row => {
      const channel = data.channels[name];
      return (channel.rate ? row : row.slice(1)).some(Number.isFinite);
    }))));
  $('merge-options').replaceChildren(...names.map(name => {
    const label = node('label');
    const box = node('input');
    box.type = 'checkbox';
    box.checked = mergeChoices.has(name);
    box.addEventListener('change', () => {
      if (box.checked && mergeChoices.size < maxChartOverlays) mergeChoices.add(name);
      else if (!box.checked) mergeChoices.delete(name);
      box.checked = mergeChoices.has(name);
      updateMergeCount();
    });
    const unit = displayUnit(name,(primary.channels[name] || secondary?.channels[name])?.unit);
    label.append(box, telemetryName(name) + (unit ? ' · ' + unit : ''));
    return label;
  }));
  if (!names.length) $('merge-options').append(node('p','No numeric channels found.'));
  updateMergeCount();
}
function updateMergeCount() {
  $('merge-count').textContent = mergeChoices.size + ' of ' + maxChartOverlays + ' selected';
  for (const box of $('merge-options').querySelectorAll('input')) {
    box.disabled = !box.checked && mergeChoices.size >= maxChartOverlays;
  }
}
function chartOverlayChannels(key) {
  const saved = settings.chartOverlays?.[key] ?? (key === 'delta' ? settings.deltaChannels : []);
  return Array.isArray(saved) ? [...new Set(saved)].slice(0,maxChartOverlays) : [];
}
function openMerge(key, title, channelName, mergeButton) {
  if (!ready) return;
  mergeChart = {key,channelName};
  mergeChoices = new Set(chartOverlayChannels(key).filter(name => name !== channelName));
  $('merge-title').textContent = title + ' Overlays';
  $('merge-search').value = '';
  const dialog = $('merge-dialog');
  mergeButton.ownerDocument.body.append(dialog);
  dialog.showModal();
  updateMergePicker();
  $('merge-search').focus();
}
$('merge-search').oninput = updateMergePicker;
$('cancel-merge').onclick = () => $('merge-dialog').close();
$('merge-form').onsubmit = event => {
  event.preventDefault();
  const column = graphScrollContainer();
  const scrollTop = column.scrollTop;
  const {key} = mergeChart;
  save({chartOverlays:{...settings.chartOverlays,[key]:[...mergeChoices]}});
  $('merge-dialog').close();
  buildCharts();
  column.scrollTop = scrollTop;
  chartRows.find(row => row.key === key)?.edit.focus({preventScroll:true});
};
function colorControl(label, key, fallback, onChange) {
  const input = node('input',undefined,'chart-color');
  input.type = 'color';
  input.value = graphColor(key,fallback);
  input.title = label + ' colour';
  input.setAttribute('aria-label', input.title);
  input.addEventListener('input', () => {
    settings.colors = {...settings.colors,[key]:input.value};
    onChange();
  });
  input.addEventListener('change', () => save({colors:settings.colors}));
  return input;
}

function canvasFont() { return 14 * textScale() + 'px Consolas, monospace'; }
function xBounds(width) {
  const left = 72 * textScale();
  return [left, Math.max(left + 3, width - 30 * textScale())];
}
function orderTelemetryGraphs(items, key, order = settings.graphOrder ?? []) {
  const rank = new Map(order.map((name, index) => [name,index]));
  const position = name => name === 'delta' ? -1 : rank.get(name) ?? Infinity;
  return [...items].sort((a,b) => position(key(a)) - position(key(b)));
}

function showGraphOrder(show, movedKey, direction) {
  $('graph-select-tab').setAttribute('aria-pressed', String(!show));
  $('graph-order-tab').setAttribute('aria-pressed', String(show));
  $('graph-select-pane').hidden = show;
  $('graph-order-pane').hidden = !show;
  if (!show) return;
  const active = orderTelemetryGraphs(
    [...$('graph-options').querySelectorAll('input:checked:not(:disabled)')],
    input => input.value, displayPicker.graphOrder);
  let focus;
  $('graph-order-options').replaceChildren(...active.map((input, index) => {
    const key = input.value;
    const label = displayPicker.graphLabels.get(key);
    const row = node('li');
    row.append(node('span', label));
    for (const [offset, symbol, action] of [[-1,'↑','up'],[1,'↓','down']]) {
      const button = node('button', symbol);
      button.type = 'button';
      button.setAttribute('aria-label', 'Move ' + label + ' ' + action);
      const neighbor = active[index + offset];
      button.disabled = !neighbor;
      button.onclick = () => {
        const order = displayPicker.graphOrder;
        const from = order.indexOf(key), to = order.indexOf(neighbor.value);
        [order[from], order[to]] = [order[to], order[from]];
        displayPicker.reordered = true;
        showGraphOrder(true, key, offset);
      };
      if (key === movedKey && !button.disabled && (!focus || offset === direction)) focus = button;
      row.append(button);
    }
    return row;
  }));
  $('graph-order-empty').hidden = active.length > 0;
  focus?.focus();
}
$('graph-select-tab').onclick = () => showGraphOrder(false);
$('graph-order-tab').onclick = () => showGraphOrder(true);

let displayPicker;
function openDisplayPicker(title, key, options, apply) {
  if ($('graph-dialog').open) return;
  displayPicker = {key, apply};
  const isSummary = key === 'hiddenSummary';
  $('graph-picker-tabs').hidden = isSummary;
  showGraphOrder(false);
  if (!isSummary) {
    displayPicker.graphLabels = new Map(options.map(([label,name]) => [name,label]));
    const order = orderTelemetryGraphs(options, ([,name]) => name).map(([,name]) => name);
    const listed = new Set(order);
    displayPicker.graphOrder = [...order,...(settings.graphOrder ?? []).filter(name => !listed.has(name))];
  }
  const list = $('graph-options');
  list.classList.toggle('summary-channel-options', isSummary);
  $('graph-dialog-title').textContent = title;
  $('summary-channel-note').hidden = key !== 'hiddenSummary';
  for (const {setting} of summaryTemperaturePairs) {
    const input = $(setting);
    input.parentElement.hidden = !isSummary;
    input.checked = settings[setting] === true;
  }
  $('graph-options-search').value = '';
  $('graph-options-empty').hidden = true;
  const hidden = key === 'hiddenSummary' ? hiddenSummaryChannels() : new Set(settings[key] ?? defaultHiddenGraphs);
  list.replaceChildren(...options.map(([title, value, checked, noData]) => {
    const label = node('label');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.checked = !isSummary && value === 'delta' ? true : (checked ?? !hidden.has(value));
    checkbox.disabled = !isSummary && value === 'delta';
    if (checked !== undefined) checkbox.dataset.extraChannel = '';
    label.append(checkbox, title);
    if (noData) label.append(node('small','No Data','graph-option-no-data'));
    if (!isSummary) return label;
    const row = node('div', undefined, 'summary-channel-option');
    const swatch = node('input', undefined, 'chart-color');
    swatch.type = 'color';
    swatch.dataset.summaryChannel = value;
    swatch.defaultValue = summaryChannelColour(value);
    swatch.setAttribute('aria-label', title + ' Colour');
    row.append(label,swatch);
    for (const [direction, symbol] of [['up', '↑'], ['down', '↓']]) {
      const button = node('button', symbol);
      button.type = 'button';
      button.dataset.move = direction;
      button.setAttribute('aria-label', 'Move ' + title + ' ' + direction);
      button.onclick = () => {
        const visible = [...list.children].filter(item => !item.hidden);
        const target = visible[visible.indexOf(row) + (direction === 'up' ? -1 : 1)];
        if (!target) return;
        list.insertBefore(row, direction === 'up' ? target : target.nextElementSibling);
        displayPicker.reordered = true;
        updateSummaryMoveButtons();
        (button.disabled ? checkbox : button).focus();
      };
      row.append(button);
    }
    return row;
  }));
  if (isSummary) updateSummaryMoveButtons();
  $('graph-dialog').showModal();
  $('graph-options-search').focus();
}
function updateSummaryMoveButtons() {
  const visible = [...$('graph-options').children].filter(row => !row.hidden);
  visible.forEach((row, index) => {
    row.querySelector('[data-move="up"]').disabled = index === 0;
    row.querySelector('[data-move="down"]').disabled = index === visible.length - 1;
  });
}
$('graph-options-search').oninput = event => {
  const query = event.target.value.trim().toLowerCase();
  let matches = 0;
  for (const row of $('graph-options').children) {
    const input = row.querySelector('input');
    row.hidden = !input.closest('label').textContent.toLowerCase().includes(query) && !input.value.toLowerCase().includes(query);
    if (!row.hidden) matches++;
  }
  if (displayPicker.key === 'hiddenSummary') updateSummaryMoveButtons();
  $('graph-options-empty').hidden = matches > 0;
};
function graphHasLapData(data, name) {
  const channel = data?.channels[name];
  if (!channel?.times.length) return false;
  const hasValue = (row,offset) => row?.some((value,index) =>
    index >= offset && (Number.isFinite(value) || typeof value === 'boolean'));
  const {start,end} = data.lap;
  const offset = channel.rate ? 0 : 1;
  const first = lowerBound(channel.times,start - 1e-6);
  if (!channel.rate && hasValue(sample(channel,start),0)) return true;
  for (let i = first; i < channel.times.length && channel.times[i] < end; i++) {
    if (hasValue(channel.rows[i],offset)) return true;
  }
  return false;
}

function openGraphPicker() {
  const chosen = new Set(settings.extraGraphChannels);
  const hidden = new Set(settings.hiddenGraphs ?? defaultHiddenGraphs);
  const names = new Set([...chosen, ...(settings.graphOrder ?? []).filter(name => name !== 'delta'), ...availableChannels(), ...sessions.flatMap(session => session.summaryChannels ?? [])]);
  const extra = [...names].filter(name => !builtInGraphKeys.has(name)).sort((a, b) => a.localeCompare(b))
    .map(name => [telemetryName(name), name, chosen.has(name) && !hidden.has(name)]);
  const options = [deltaGraph, ...chartSpecs.map(([label,key]) => [telemetryGraphName(key,label),key]), ...extra];
  const annotated = options.map(([label,key,checked]) => {
    const name = key === 'tyres' ? tyreName() : key;
    const hasData = key === 'delta' ? primary?.useDistance && secondary?.useDistance :
      graphHasLapData(primary,name) || graphHasLapData(secondary,name);
    return [label,key,checked,ready && !hasData];
  });
  openDisplayPicker('Select Active Telemetry Graphs', 'hiddenGraphs', annotated, () => {
    if (ready) buildCharts();
  });
}
$('choose-graphs').onclick=openGraphPicker;
$('settings-graphs').onclick=openGraphPicker;
const telemetryNameFields = $('telemetry-name-fields');
function renderTelemetryData() {
  const names = new Set([
    ...defaultTelemetryNames.keys(), ...Object.keys(settings.telemetryNames ?? {}),
    ...Object.keys(settings.telemetryDecimals ?? {}), ...Object.values(builtIn).flat(),
    ...summaryTemperatureOptions.map(([key]) => summaryChannelKeys[key] ?? key),
    ...derivedSummaryChannels.keys(),
    ...availableChannels(), ...sessions.flatMap(session => session.summaryChannels ?? [])
  ]);
  const channels = [...names].map(key => ({
    key,
    source:summaryTemperatureOptions.find(([name]) => name === key)?.[1] ??
      derivedSummaryChannels.get(key)?.[1] ?? (key === 'virtualEnergy' ? 'Virtual Energy summary' : key)
  })).sort((a,b) => a.source.localeCompare(b.source));
  telemetryNameFields.replaceChildren(...channels.map(({key,source}) => {
    const row = node('div', undefined, 'telemetry-display-row');
    const input = node('input');
    input.type = 'text';
    input.dataset.channel = key;
    input.maxLength = 80;
    input.placeholder = defaultTelemetryNames.get(key) ?? key;
    input.value = telemetryName(key);
    input.setAttribute('aria-label', source + ' display name');
    const decimals = node('input');
    decimals.type = 'number';
    decimals.min = '0';
    decimals.max = '6';
    decimals.step = '1';
    decimals.setAttribute('aria-label', source + ' decimal places');
    decimals.disabled = key === 'Engine RPM' || key === 'Gear';
    const fallback = summaryDecimalDefault(key);
    decimals.defaultValue = String(telemetryDecimalPlaces(key, fallback));
    decimals.placeholder = String(telemetryDecimalPlaces(key, fallback, null));
    row.append(node('span', source), input, decimals);
    return row;
  }));
  $('telemetry-names-search').value = '';
  telemetryNameFields.scrollTop = 0;
  $('telemetry-data-status').textContent = '';
}
$('telemetry-names-search').oninput = event => {
  const query = event.target.value.trim().toLowerCase();
  for (const input of telemetryNameFields.querySelectorAll('input[type=text]')) {
    input.parentElement.hidden = ![input.dataset.channel, input.value, input.placeholder, input.parentElement.firstElementChild.textContent]
      .some(text => text.toLowerCase().includes(query));
  }
};
$('cancel-telemetry-names').onclick = renderTelemetryData;
$('telemetry-names-form').onsubmit = event => {
  event.preventDefault();
  const entries = [...telemetryNameFields.querySelectorAll('input[type=text]')]
    .map(input => [input.dataset.channel, input.value.trim()])
    .filter(([key, value]) => value && value !== (defaultTelemetryNames.get(key) ?? key));
  const telemetryDecimals = {...settings.telemetryDecimals};
  for (const row of telemetryNameFields.children) {
    const key = row.querySelector('input[type=text]').dataset.channel;
    const decimals = row.querySelector('input[type=number]');
    if (decimals.disabled || decimals.value === '') delete telemetryDecimals[key];
    else if (decimals.value !== decimals.defaultValue) telemetryDecimals[key] = decimals.valueAsNumber;
  }
  save({telemetryNames:Object.fromEntries(entries), telemetryDecimals});
  if (view === 'records') renderRecords();
  for (const input of telemetryNameFields.querySelectorAll('input')) input.defaultValue = input.value;
  $('telemetry-data-status').textContent = 'Telemetry data settings saved.';
  renderSessionSummary();
  if (ready) {
    buildChannels();
    buildCharts();
  }
};
function openSummaryChannelPicker(event) {
  const dialog = $('graph-dialog');
  const owner = event?.currentTarget?.ownerDocument;
  if (dialog.open) return;
  if (owner && owner !== document) owner.body.append(dialog);
  const options = [
    ...summaryTemperatureOptions, ['virtualEnergy', 'Virtual Energy Usage per Lap']
  ].map(([key, label]) => [telemetryName(summaryChannelKeys[key] ?? key, label), key]);
  const chosen = new Set(settings.extraSummaryChannels);
  const names = availableSummaryChannels(selected?.summaryChannels ?? sessions.flatMap(session => session.summaryChannels ?? []));
  for (const name of [...names].filter(name => !defaultSummaryChannels.has(name)).sort((a, b) => a.localeCompare(b))) {
    options.push([extraSummaryName(name), name, chosen.has(name)]);
  }
  openDisplayPicker('Select Summary Channels', 'hiddenSummary', orderSummaryOptions(options, ([, key]) => key), renderSessionSummary);
}
$('settings-summary').onclick = openSummaryChannelPicker;
$('choose-summary-channels').onclick = openSummaryChannelPicker;
$('cancel-graphs').onclick=()=>$('graph-dialog').close();
$('graph-form').onsubmit=event=>{
  event.preventDefault();
  const isSummary = displayPicker.key === 'hiddenSummary';
  const hidden = isSummary ? hiddenSummaryChannels() : new Set();
  const selectionKey = isSummary ? 'extraSummaryChannels' : 'extraGraphChannels';
  const chosen = new Set(isSummary ? settings[selectionKey] : []);
  const options = $('graph-options');
  for (const input of options.querySelectorAll('input[type="checkbox"]')) {
    const list = input.hasAttribute('data-extra-channel') ? chosen : hidden;
    const include = list === chosen ? input.checked : !input.checked;
    if (include) list.add(input.value);
    else list.delete(input.value);
  }
  const changes = {[displayPicker.key]:[...hidden], [selectionKey]:[...chosen]};
  if (isSummary) {
    for (const {setting} of summaryTemperaturePairs) changes[setting] = $(setting).checked;
    const colours = [...options.querySelectorAll('[data-summary-channel]')].filter(input => input.value !== input.defaultValue);
    if (colours.length) {
      changes.colors = {...settings.colors};
      for (const input of colours) changes.colors['summary:' + input.dataset.summaryChannel] = input.value;
    }
  }
  if (isSummary && displayPicker.reordered) {
    const shown = [...options.querySelectorAll('input[type="checkbox"]')].map(input => input.value);
    const shownKeys = new Set(shown);
    changes.summaryChannelOrder = [...shown, ...(settings.summaryChannelOrder ?? []).filter(key => !shownKeys.has(key))];
  }
  if (!isSummary && displayPicker.reordered) changes.graphOrder = displayPicker.graphOrder;
  save(changes);
  $('graph-dialog').close();
  displayPicker.apply();
};

function hasActivationData(channel) {
  return [primary, secondary].some(data => data?.channels[channel]?.rows.length);
}

function speedActivationControls(controls, track = false) {
  return speedActivations.map(([channel, colour]) => {
    const label = node('label', undefined, 'speed-activation');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!settings.speedActivations?.[channel];
    checkbox.disabled = !hasActivationData(channel);
    controls.get(channel).push(checkbox);
    label.title = checkbox.disabled ? channel + ' activation was not recorded'
      : track ? channel + ' activation on each lap’s racing line.'
      : channel + ' activation on each lap’s speed trace.';
    const swatch = node('span', undefined, 'speed-activation-swatch');
    swatch.style.backgroundColor = elementColour(channel.toLowerCase(),colour);
    label.append(checkbox, swatch, channel);
    checkbox.onchange = () => {
      save({speedActivations: {...settings.speedActivations, [channel]: checkbox.checked}});
      for (const control of controls.get(channel)) control.checked = checkbox.checked;
      for (const chartRow of chartRows) if (chartRow.hasSpeedTrace) chartRow.cache = null;
      scheduleRender();
    };
    return label;
  });
}

let cornerTimeLossOpen = true;
let cornerTimeLossHeight;

function cornerComparisonLabel(currentLap, comparison) {
  const current = currentLap.number == null ? loadedTraceLabel : 'Lap ' + currentLap.number;
  const [, driver] = chartDriverLabels(selected?.driver, comparison.session.driver);
  const referenceLap = comparison.lap;
  const referenceLabel = referenceLap.number == null ? 'Reference Lap' : 'Lap ' + referenceLap.number;
  if (!comparison.imported && comparison.session.path === referenceSessionPath) {
    return current + ' vs ' + (referenceLap.number == null ? 'a lap' : referenceLabel) + ' of the Reference Session';
  }
  const time = referenceLap.time > 0 ? lapTime(referenceLap.time) : '';
  const target = driver === 'Reference' ? referenceLabel : driver + ' ' + (time || referenceLabel);
  return current + ' vs ' + target;
}

let cornerEventMarkers = [];
let selectedCorner;
const cornerHighlightColour = '#f5cc68';

function cornerPedalCrossings(data, channelName, from, to, threshold, rising) {
  const channel = data.channels[channelName];
  if (!channel?.times.length) return [];
  const offset = channel.rate ? 0 : 1;
  const first = Math.max(1, lowerBound(channel.times, data.timeAt(from)));
  const end = Math.min(channel.times.length - 1, lowerBound(channel.times, data.timeAt(to)));
  const crossings = [];
  for (let i = first; i <= end; i++) {
    const before = channel.rows[i - 1][offset], after = channel.rows[i][offset];
    const span = channel.times[i] - channel.times[i - 1];
    if (!Number.isFinite(before) || !Number.isFinite(after) || span <= 0 || span > .5) continue;
    if (!(rising ? before < threshold && after >= threshold : before >= threshold && after < threshold)) continue;
    const time = channel.times[i - 1] + span * (threshold - before) / (after - before);
    const distance = data.distanceAt(time);
    if (distance >= from && distance <= to) crossings.push({channelName, distance, value:threshold});
  }
  return crossings;
}

function mainCornerBraking(data, approach, apex, exit) {
  const channelName = 'Brake Pos';
  const threshold = 5;
  const onsets = cornerPedalCrossings(data, channelName, approach, exit, threshold, true);
  const releases = cornerPedalCrossings(data, channelName, approach, exit, threshold, false);
  const approachTime = data.timeAt(approach);
  const channel = data.channels[channelName];
  const alreadyBraking = approachTime >= channel?.times[0] && approachTime <= channel.times.at(-1) &&
    sample(channel, approachTime)?.[0] >= threshold;
  if (alreadyBraking) onsets.unshift(null);

  // Compare applications by duration so a late tap cannot replace the main braking zone.
  let longest = 0;
  let main = {};
  for (const [index, on] of onsets.entries()) {
    const start = on?.distance ?? approach;
    if (start > apex) break;
    const nextStart = onsets[index + 1]?.distance ?? Infinity;
    const off = releases.find(event => event.distance > start && event.distance < nextStart);
    if (!off && nextStart !== Infinity) continue;
    const duration = data.timeAt(off?.distance ?? exit) - data.timeAt(start);
    if (duration > longest) {
      longest = duration;
      main = {brakeOn:on, brakeOff:off};
    }
  }
  return main;
}

function nextBrakeAfterCorner(data, exit) {
  return cornerPedalCrossings(data, 'Brake Pos', exit, data.extent[1], 5, true)
    .find(event => event.distance > exit);
}

function postCornerMaxSpeed(data, points, exit) {
  const braking = nextBrakeAfterCorner(data, exit);
  const speed = data.channels['Ground Speed'];
  if (!braking || !speed?.times.length) return undefined;
  const from = data.timeAt(exit), to = data.timeAt(braking.distance);
  if (from < speed.times[0] || to > speed.times.at(-1)) return undefined;
  let max = -Infinity;
  for (const time of [from, to]) {
    const value = convert('Ground Speed', sample(speed, time)?.[0], speed.unit);
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  for (const [distance, [value]] of points) {
    if (distance > exit && distance < braking.distance && Number.isFinite(value)) max = Math.max(max, value);
  }
  return max;
}

function cornerStraightComparison(laps, exit, nextCorner, gapAt) {
  if (!nextCorner) return null;
  const onsets = laps.map(data => mainCornerBraking(data, exit, nextCorner.apex, nextCorner.to).brakeOn?.distance);
  if (!onsets.every(Number.isFinite)) return null;
  const point = Math.min(...onsets);
  if (point <= exit) return null;
  const atExit = gapAt(exit), atBraking = gapAt(point);
  if (!Number.isFinite(atExit) || !Number.isFinite(atBraking)) return null;
  return {atExit, atBraking, straight:atBraking - atExit};
}

function expandedCorner(from, apex, to, approach, selectedDriver, referenceDriver, nextCorner, minimums, maxima) {
  const detail = node('div', undefined, 'corner-detail');
  const heading = node('div', undefined, 'corner-detail-heading');
  heading.append(node('h3', 'Where the Gap Changed'), node('span', 'Positive = time lost'));
  detail.append(heading);
  // Use the same phase boundaries for both laps, centred on the estimated apex.
  const startGap = delta(from);
  const boundaries = [from, (from + apex) / 2, (apex + to) / 2, to]
    .map(distance => Math.round((delta(distance) - startGap) * 1000));
  const phases = ['Entry', 'Mid-corner', 'Exit'].map((label, index) =>
    [label, (boundaries[index + 1] - boundaries[index]) / 1000]);
  const largestLoss = phases.reduce((largest, [label, gap]) =>
    gap > largest[1] ? [label, gap] : largest, ['', 0]);
  const phaseBar = node('div', undefined, 'corner-detail-phases');
  for (const [label, gap] of phases) {
    const phase = node('div');
    if (label === largestLoss[0]) phase.classList.add('largest-loss');
    phase.append(node('span', label), node('strong', (gap > 0 ? '+' : '') + number(gap, 3) + ' s',
      gap > 0 ? 'corner-loss' : gap < 0 ? 'corner-gain' : undefined));
    phaseBar.append(phase);
  }
  detail.append(phaseBar);

  const laps = [primary, secondary];
  const events = laps.map(data => {
    const throttle = 'Throttle Pos';
    const {brakeOn, brakeOff} = mainCornerBraking(data, approach, apex, to);
    const throttleStart = Math.max((from + apex) / 2, brakeOff?.distance ?? apex);
    const throttleOn = cornerPedalCrossings(data, throttle, throttleStart, to, 20, true)[0];
    const fullThrottle = cornerPedalCrossings(data, throttle, throttleOn?.distance ?? throttleStart, to, 95, true)[0];
    const speed = data.channels['Ground Speed'];
    const time = data.timeAt(to);
    const exitSpeed = time >= speed?.times[0] && time <= speed.times.at(-1)
      ? convert('Ground Speed',sample(speed,time)?.[0],speed.unit) : undefined;
    return {pedals:[brakeOn, brakeOff, throttleOn, fullThrottle], exitSpeed};
  });

  const table = node('table');
  const head = node('thead');
  const header = node('tr');
  header.append(node('th', 'Telemetry Event'), node('th', selectedDriver, 'corner-selected-speed'),
    node('th', referenceDriver, 'reference-color'), node('th', 'Difference'));
  header.children[1].style.color = graphColor('Ground Speed');
  head.append(header);
  const body = node('tbody');
  table.append(head, body);
  const addRow = (label, readings, difference) => {
    const row = node('tr');
    const title = node('th', label);
    title.scope = 'row';
    row.append(title, ...readings.map(value => node('td', value)), node('td', difference));
    body.append(row);
  };
  for (const [index, label] of ['Brake On', 'Brake Off', 'Throttle On', 'Full Throttle'].entries()) {
    const [own, other] = events.map(event => event.pedals[index]?.distance);
    const readings = [own, other].map(distance => {
      if (!Number.isFinite(distance)) return '—';
      const offset = Math.round(convert('',distance - apex,'m'));
      return offset ? Math.abs(offset) + ' ' + displayUnit('','m') + ' ' + (offset < 0 ? 'before apex' : 'after apex') : 'At apex';
    });
    const difference = Math.round(convert('',own - apex,'m')) - Math.round(convert('',other - apex,'m'));
    addRow(label, readings, !Number.isFinite(difference) ? '—' : difference === 0 ? 'Within 1 ' + displayUnit('','m')
      : selectedDriver + ' ' + Math.abs(difference) + ' ' + displayUnit('','m') + ' ' + (difference < 0 ? 'earlier' : 'later'));
  }
  const speeds = events.map(event => event.exitSpeed);
  const digits = telemetryDecimalPlaces('Ground Speed');
  for (const [label, values] of [
    ['Minimum Speed', minimums], ['Speed at Corner Exit', speeds], ['Post Corner Max Speed', maxima]
  ]) {
    const difference = values[0] - values[1];
    addRow(label, values.map(value => Number.isFinite(value) ? number(value, digits) + ' ' + displayUnit('','km/h') : '—'),
      !Number.isFinite(difference) ? '—' : Number(number(difference, digits)) === 0 ? 'Same speed'
        : selectedDriver + ' ' + number(Math.abs(difference), digits) + ' ' + displayUnit('','km/h') + ' ' + (difference < 0 ? 'slower' : 'faster'));
  }
  const scroll = node('div', undefined, 'corner-detail-table');
  scroll.append(table);
  const trace = {Entry:'the brake trace', 'Mid-corner':'the speed and brake traces', Exit:'the throttle trace'}[largestLoss[0]];
  detail.append(scroll);
  const straight = cornerStraightComparison(laps, to, nextCorner, distance => delta(distance) - startGap);
  const straightSection = node('section', undefined, 'corner-straight');
  straightSection.append(node('h3', 'Exit to Next Braking Point'));
  if (straight) {
    const metrics = node('div', undefined, 'corner-detail-phases');
    for (const [label, value] of [['At Corner Exit', straight.atExit], ['At Next Braking', straight.atBraking], ['Change on Straight', straight.straight]]) {
      const gap = Math.round(value * 1000) / 1000;
      const cell = node('div');
      cell.append(node('span', label), node('strong', (gap > 0 ? '+' : '') + number(gap, 3) + ' s',
        gap > 0 ? 'corner-loss' : gap < 0 ? 'corner-gain' : undefined));
      metrics.append(cell);
    }
    straightSection.append(metrics, node('p', 'Both laps are compared at the same point, where the first driver starts braking for Corner ' + (nextCorner.index + 1) + '.'));
  } else {
    straightSection.append(node('p', 'No comparable next braking point in the recorded section.'));
  }
  detail.append(straightSection);
  if (trace) detail.append(node('p', largestLoss[0] + ' has the largest time loss. Compare ' + trace + '.'));
  detail.append(node('p', 'Estimated apex · Brake 5% · Throttle 20% · Full throttle 95%'));
  return {detail, markers:events.flatMap(({pedals}, index) => pedals.filter(Boolean).map(event => ({...event, reference:index === 1})))};
}

function reviewingPracticeCorner() {
  return practiceComparison && selected?.path === practiceComparison.path && lap?.id === practiceComparison.lapId &&
    reference?.session.path === practiceComparison.path && reference.lap.id === practiceComparison.benchmarkId;
}
function cornerTimeLossPanel() {
  const panel = node('section', undefined, 'corner-time-loss');
  panel.id = 'corner-time-loss';
  panel.setAttribute('aria-label', 'Corner Time Loss');
  const comparisonLabel = cornerComparisonLabel(lap, reference);
  panel.append(node('p', comparisonLabel));

  const gps = route(primary);
  const correction = gps.length ? Math.cos(gps[0][1] * Math.PI / 180) : 1;
  const start = Math.max(primary.extent[0], secondary.extent[0]);
  const finish = Math.min(primary.extent[1], secondary.extent[1]);
  const speeds = [primary, secondary].map(data => trace(data, 'Ground Speed'));
  const geometry = reviewingPracticeCorner() ? practiceComparison.corners : routeCorners(primary, correction)
    .map((corner, index) => ({index, from:primary.distanceAt(corner.start), to:primary.distanceAt(corner.end)}));
  const corners = geometry.map(({index, from, to}) => {
    if (from < start || to > finish || to <= from) return null;
    const change = delta(to) - delta(from);
    if (!Number.isFinite(change)) return null;
    const minimums = speeds.map(points => points.reduce((minimum, point) =>
      point[0] >= from && point[0] <= to && Number.isFinite(point[1][0]) && point[1][0] < (minimum?.[1][0] ?? Infinity)
        ? point : minimum, null));
    const minimumAt = minimums[0]?.[0];
    const apex = minimumAt > from && minimumAt < to ? minimumAt : (from + to) / 2;
    return {index, from, apex, to, change, minimums:minimums.map(point => point?.[1][0])};
  }).filter(Boolean).sort((a, b) => b.change - a.change);

  const cornersByDistance = [...corners].sort((a, b) => a.from - b.from);
  let expandedButton, expandedDetail;
  let expandedMarkers = [];
  const toggle = node('button', undefined, 'chart-edit');
  const chevron = node('span', '›', 'corner-toggle-chevron');
  chevron.setAttribute('aria-hidden', 'true');
  const toggleLabel = node('span');
  toggle.append(chevron, toggleLabel);
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', panel.id);
  const updateVisibility = () => {
    panel.hidden = !cornerTimeLossOpen;
    toggleLabel.textContent = cornerTimeLossOpen ? 'Hide Corner Time Loss' : 'Show Corner Time Loss';
    toggle.setAttribute('aria-expanded', String(cornerTimeLossOpen));
  };
  updateVisibility();
  toggle.onclick = () => {
    cornerTimeLossOpen = !cornerTimeLossOpen;
    if (cornerTimeLossOpen) resetHeight();
    cornerEventMarkers = cornerTimeLossOpen ? expandedMarkers : [];
    updateVisibility();
    scheduleRender();
  };

  const [selectedDriver, referenceDriver] = chartDriverLabels(selected?.driver, reference.session.driver);
  const comparedDriver = referenceDriver === 'Reference' ? 'Reference Lap' : referenceDriver;
  const speedDigits = telemetryDecimalPlaces('Ground Speed');
  const note = corners.length ? 'Estimated corners · Largest time loss first'
    : 'No comparable corners were detected in the recorded GPS route.';
  panel.append(node('p', note));
  const speedText = value => Number.isFinite(value) ? number(value, speedDigits) + ' ' + displayUnit('','km/h') : '—';
  const cornerRows = corners.map(({index, from, apex, to, change, minimums}) => {
    const displayed = Math.round(change * 1000) / 1000;
    const maxima = [primary, secondary].map((data, i) => postCornerMaxSpeed(data, speeds[i], to));
    return {index, from, apex, to, change:displayed, minimums, maxima, labels:[
      'Corner ' + (index + 1),
      selectedDriver + ' ' + number(minimums[0], speedDigits) + ' ' + displayUnit('','km/h'),
      comparedDriver + ' ' + number(minimums[1], speedDigits) + ' ' + displayUnit('','km/h'),
      timeGapLabel(displayed),
      selectedDriver + ' ' + speedText(maxima[0]),
      comparedDriver + ' ' + speedText(maxima[1])
    ]};
  });
  const list = node('ol');
  const resetHeight = () => {
    cornerTimeLossHeight = undefined;
    list.style.removeProperty('max-height');
  };
  if (cornerRows.length) panel.append(list);
  for (const {index, from, apex, to, change, minimums, maxima, labels} of cornerRows) {
    const button = node('button');
    button.type = 'button';
    const selectedSpeed = node('span', labels[1], 'corner-selected-speed');
    selectedSpeed.style.color = graphColor('Ground Speed');
    const referenceSpeed = node('span', labels[2], 'reference-color');
    const speedComparison = node('span', undefined, 'corner-speed-comparison');
    speedComparison.append(selectedSpeed, ' ', node('span', 'Minimum Speed vs'), ' ', referenceSpeed);
    const selectedMax = node('span', labels[4], 'corner-selected-speed');
    selectedMax.style.color = selectedSpeed.style.color;
    const maxComparison = node('span', undefined, 'corner-max-comparison');
    maxComparison.append(node('span', 'Post Corner Max Speed '), selectedMax, ' ', node('span', 'vs'), ' ',
      node('span', labels[5], 'reference-color'));
    const separator = node('span', '|', 'corner-speed-separator');
    separator.setAttribute('aria-hidden', 'true');
    button.append(node('strong', labels[0]), speedComparison, separator, maxComparison,
      node('strong', labels[3], change > 0 ? 'corner-loss' : change < 0 ? 'corner-gain' : undefined));
    const item = node('li');
    button.setAttribute('aria-expanded', 'false');
    button.dataset.cornerIndex = index;
    button.onclick = () => {
      const wasExpanded = expandedButton === button;
      expandedButton?.setAttribute('aria-expanded', 'false');
      expandedDetail?.remove();
      expandedButton = expandedDetail = undefined;
      cornerEventMarkers = expandedMarkers = [];
      selectedCorner = undefined;
      if (wasExpanded) {
        scheduleRender();
        return;
      }
      const approach = Math.max(start, from - 150);
      const nextCorner = cornersByDistance.find(corner => corner.from >= to);
      const {detail, markers} = expandedCorner(from, apex, to, approach, selectedDriver, comparedDriver, nextCorner, minimums, maxima);
      if (reviewingPracticeCorner() && practiceComparison.index === index && practiceComparison.best) {
        const {request, best} = practiceComparison;
        const actions = node('div', undefined, 'corner-best');
        const label = 'Best Through This Corner · ' + lapLabel(best.lap) + ' · ' + number(best.time, 3) + ' s';
        actions.append(node('strong', label));
        if (best.lap.id === reference.lap.id) {
          actions.append(node('span', 'Comparing With Best'));
        } else if (best.lap.id === lap.id) {
          actions.append(node('span', 'Loaded Lap Is Best'));
        } else {
          const representative = lap;
          const compare = node('button', 'Compare With Best');
          compare.type = 'button';
          compare.onclick = () => void openPracticeCorner(request, representative, best.lap, index, best);
          actions.append(compare);
        }
        detail.prepend(actions);
      }
      const navigation = node('div', undefined, 'corner-navigation');
      navigation.append(node('strong', labels[0]));
      const position = cornersByDistance.findIndex(corner => corner.index === index);
      for (const [label, offset] of [['‹ Previous Corner', -1], ['Next Corner ›', 1]]) {
        const destination = cornersByDistance[position + offset];
        const action = node('button', label, 'button-secondary');
        action.type = 'button';
        action.disabled = !destination;
        action.onclick = () => {
          const target = list.querySelector('[data-corner-index="' + destination.index + '"]');
          target?.click();
          target?.focus({preventScroll:true});
          target?.scrollIntoView({block:'nearest', inline:'nearest'});
        };
        navigation.append(action);
      }
      if (reviewingPracticeCorner()) {
        const back = node('button', '← Return to Driver Overview', 'corner-return button-secondary');
        back.type = 'button';
        const {overview} = practiceComparison;
        back.onclick = () => returnToDriverOverview(overview);
        navigation.append(back);
      }
      detail.prepend(navigation);
      item.append(detail);
      expandedButton = button;
      expandedDetail = detail;
      cornerEventMarkers = expandedMarkers = markers;
      selectedCorner = {from, to, route:routeSection(primary, from, to)};
      button.setAttribute('aria-expanded', 'true');
      stop();
      selection = null;
      pinned = false;
      updatePin();
      const showPostCorner = reviewingPracticeCorner() &&
        practiceComparison.index === index && practiceComparison.includePostCorner;
      const zoomEnd = showPostCorner
        ? Math.max(to, ...[primary, secondary].map(data => nextBrakeAfterCorner(data, to)?.distance ?? to))
        : to;
      setTelemetryZoom([Math.min(from, ...markers.map(event => event.distance)), zoomEnd]);
      seek(from, false);
    };
    item.append(button);
    list.append(item);
  }
  if (cornerRows.length) {
    const handle = node('button', undefined, 'resize corner-time-loss-resize');
    handle.type = 'button';
    handle.setAttribute('aria-label', 'Resize Corner Time Loss. Use arrow keys.');
    const setHeight = value => {
      cornerTimeLossHeight = Math.round(Math.max(50, value));
      list.style.maxHeight = cornerTimeLossHeight + 'px';
    };
    if (cornerTimeLossHeight !== undefined) setHeight(cornerTimeLossHeight);
    attachChartResize(handle, () => list.getBoundingClientRect().height, setHeight, undefined, resetHeight);
    panel.append(handle);
  }
  return {toggle, panel};
}

function viewerCarDetails(session) {
  return [session.model || session.car, session.carClass].filter(Boolean).join(' · ');
}
function viewerLapDetails(label, session, currentLap) {
  const driverAndCar = [label, session.driver, viewerCarDetails(session)].filter(Boolean).join(' · ');
  const dateAndLap = [dateLabel(session.recorded), lapLabel(currentLap)].filter(Boolean).join(' · ');
  return driverAndCar + '\n' + dateAndLap;
}
function updateActiveLapComparison() {
  renderVisualiserLaps();
  const focusGraphs = $('graphs-popout-link');
  if (focusGraphs) focusGraphs.hidden = !lap;
  if (!lap) return;
  renderMapSectorTimes();
  $('viewer-loaded-session').textContent = viewerLapDetails('Loaded Session', selected, lap);
  const comparing = !!(reference && secondary);
  const loadedReference = $('viewer-loaded-reference');
  loadedReference.classList.toggle('reference-color', comparing);
  loadedReference.textContent = comparing
    ? viewerLapDetails('Loaded Reference', reference.session, reference.lap)
    : referenceLoading ? 'Loading Reference Lap…' : 'No Reference Lap Loaded';
}

const suspensionCorners = ['Front Left', 'Front Right', 'Rear Left', 'Rear Right'];
const suspensionColours = ['var(--accent)', '#75dfc2', '#7baeff', '#eaa8ed'];
const suspensionLimits = [
  ...suspensionCorners.map(name => name + ' compression limit'),
  'Front floor clearance', 'Rear floor clearance'
];
const suspensionCache = new WeakMap();
let suspensionRenderKey = [];
let suspensionCar;

function suspensionSamples(data, name, component = 0) {
  const channel = data.channels[name];
  const scale = {m:1000, cm:10, mm:1}[channel?.unit?.trim().toLowerCase()];
  if (!scale) return [];
  return channel.rows.flatMap((row, index) => {
    const time = channel.times[index];
    if (time < data.lap.start || time >= data.lap.end) return [];
    const raw = row[component + (channel.rate ? 0 : 1)];
    return [[data.distanceAt(time), Number.isFinite(raw) ? raw * scale : NaN, time]];
  });
}
function suspensionData(data) {
  if (suspensionCache.has(data)) return suspensionCache.get(data);
  const travel = suspensionCorners.map((_, i) => suspensionSamples(data, 'Susp Pos', i));
  const velocity = travel.map(points => points.map(([distance, value, time], index) => {
    const previous = points[index - 1], next = points[index + 1];
    const duration = previous && next ? next[2] - previous[2] : 0;
    return [distance, Number.isFinite(value) && duration > 0 && duration <= .12
      ? (next[1] - previous[1]) / duration : NaN, time];
  }));
  const heights = ['FrontRideHeight','RearRideHeight'].map(name => suspensionSamples(data, name));
  const result = {travel, velocity, heights};
  suspensionCache.set(data, result);
  return result;
}
function suspensionEvents(points, limit, floor) {
  const finite = points.filter(point => Number.isFinite(point[1]));
  if (!finite.length || (floor && limit == null)) return [];
  const [min, max] = finite.reduce(([low, high], [,value]) =>
    [Math.min(low,value), Math.max(high,value)], [Infinity,-Infinity]);
  if (limit == null && max - min < 2) return [];
  const threshold = limit ?? max - .15;
  const runs = [];
  let run;
  for (const point of points) {
    const [,value,time] = point;
    const hit = Number.isFinite(value) && (floor ? value <= threshold : value >= threshold);
    if (!hit || (run && time - run.last[2] > .08)) {
      if (run && run.last[2] - run.first[2] >= (limit == null ? .035 : .015)) runs.push(run);
      run = undefined;
    }
    if (hit) {
      run ??= {first:point,last:point,value};
      run.last = point;
      run.value = floor ? Math.min(run.value,value) : Math.max(run.value,value);
    }
  }
  if (run && run.last[2] - run.first[2] >= (limit == null ? .035 : .015)) runs.push(run);
  if (limit == null && runs.length < 2) return [];
  return runs;
}
function suspensionSvg(parent, tag, attrs = {}, text) {
  const element = parent.ownerDocument.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
  if (text != null) element.textContent = text;
  parent.append(element);
  return element;
}
function suspensionPlot(parent, title, width, height, axis, domain, bounds) {
  const graph = node('section', undefined, 'suspension-plot');
  graph.append(node('h3',title));
  parent.append(graph);
  const svg = suspensionSvg(graph,'svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':title});
  const left = 49, right = width - 13, top = 12, bottom = height - 29;
  const x = value => left + (right-left)*(value-domain[0])/(domain[1]-domain[0]);
  const y = value => bottom - (bottom-top)*(value-bounds[0])/(bounds[1]-bounds[0]);
  for (let i=0;i<=4;i++) {
    const value = bounds[0] + (bounds[1]-bounds[0])*i/4;
    const px = left + (right-left)*i/4;
    suspensionSvg(svg,'line',{x1:left,x2:right,y1:y(value),y2:y(value),class:'suspension-grid'});
    suspensionSvg(svg,'line',{x1:px,x2:px,y1:top,y2:bottom,class:'suspension-grid'});
    suspensionSvg(svg,'text',{x:left-6,y:y(value)+4,'text-anchor':'end'},Number(value.toFixed(1)));
    suspensionSvg(svg,'text',{x:px,y:bottom+15,'text-anchor':'middle'},Math.round(domain[0]+(domain[1]-domain[0])*i/4));
  }
  suspensionSvg(svg,'text',{x:right,y:height-1,'text-anchor':'end'},axis);
  return {svg,x,y,left,right,top,bottom,width};
}
function suspensionDistancePlot(parent, title, sources, events, domain) {
  const bounds = sources.reduce(([min,max], source) => source.points.reduce(([low,high],[distance,value]) =>
    distance >= domain[0] && distance <= domain[1] && Number.isFinite(value)
      ? [Math.min(low,value),Math.max(high,value)] : [low,high], [min,max]), [Infinity,-Infinity]);
  if (!Number.isFinite(bounds[0])) {
    parent.append(node('p', title + ' is unavailable in this section of the recording.'));
    return;
  }
  const pad = Math.max(1,(bounds[1]-bounds[0])*.08);
  const plot = suspensionPlot(parent,title,840,155,primary.useDistance ? 'Distance (m)' : 'Time (s)',domain,[bounds[0]-pad,bounds[1]+pad]);
  const {svg,x,y,left,right,top,bottom,width} = plot;
  for (const event of events) {
    if (event.last[0] < domain[0] || event.first[0] > domain[1]) continue;
    const start = Math.max(left, Math.min(right-3,x(event.first[0])));
    const band = suspensionSvg(svg,'rect',{x:start,y:top,width:Math.max(3,Math.min(right,x(event.last[0]))-start),
      height:bottom-top, class:event.floor ? 'suspension-floor' : 'suspension-bottoming',tabindex:0,'aria-label':event.label});
    suspensionSvg(band,'title',{},event.label);
  }
  for (const {points,colour,reference} of sources) {
    let path = '', connected = false;
    for (const [distance,value] of points) {
      if (distance < domain[0] || distance > domain[1] || !Number.isFinite(value)) { connected = false; continue; }
      path += (connected ? 'L' : 'M') + x(distance).toFixed(1) + ' ' + y(value).toFixed(1);
      connected = true;
    }
    suspensionSvg(svg,'path',{d:path,stroke:colour,'stroke-dasharray':reference ? '5 4' : 'none',class:'suspension-trace'});
  }
  suspensionSvg(svg,'line',{y1:top,y2:bottom,class:'suspension-cursor','data-left':left,'data-right':right});
  svg.addEventListener('pointermove',event => {
    if (pinned) return;
    const rect = svg.getBoundingClientRect();
    const fraction = ((event.clientX-rect.left)/rect.width*width-left)/(right-left);
    if (fraction >= 0 && fraction <= 1) seek(domain[0]+fraction*(domain[1]-domain[0]),false);
  });
}
function suspensionHistograms(parent, sources, domain) {
  const histograms = node('section',undefined,'suspension-histograms');
  histograms.append(node('h3','Calculated Suspension Velocity Histograms (% of time)'));
  const grid = node('div',undefined,'suspension-histogram-grid');
  histograms.append(grid);
  parent.append(histograms);
  const visible = sources.map(({points,...source}) => ({...source,points:points.filter(([x]) => x >= domain[0] && x <= domain[1])}));
  const extent = visible.reduce((max,source) => source.points.reduce((peak,[,v]) =>
    Number.isFinite(v) ? Math.max(peak,Math.abs(v)) : peak,max), 0);
  const step = Math.max(10,Math.ceil(extent/160)*10);
  const limit = 16*step;
  const series = visible.map(source => {
    const bins = Array(32).fill(0);
    let total = 0;
    for (let i=0;i<source.points.length-1;i++) {
      const [,value,time] = source.points[i];
      const duration = source.points[i+1][2]-time;
      if (!Number.isFinite(value) || duration <= 0 || duration > .08) continue;
      bins[Math.min(31,Math.max(0,Math.floor((value+limit)/step)))] += duration;
      total += duration;
    }
    return {...source,bins:bins.map(value => total ? 100*value/total : 0)};
  });
  const peak = Math.max(4,...series.flatMap(source => source.bins));
  for (const [corner,name] of suspensionCorners.entries()) {
    const {svg,x,y} = suspensionPlot(grid,name,220,130,'Rebound ← mm/s → Bump',[-limit,limit],[0,Math.ceil(peak/4)*4]);
    for (const {bins,colour,reference} of series.filter(source => source.index === corner)) {
      bins.forEach((value,index) => {
        if (!value) return;
        suspensionSvg(svg,'rect',{x:x(index*step-limit),y:y(value),width:x(step)-x(0),height:y(0)-y(value),
          fill:reference ? 'none' : colour,stroke:colour,'stroke-dasharray':reference ? '3 2' : 'none',opacity:reference ? 1 : .55});
      });
    }
  }
}
const aeroCache = new WeakMap();
let aeroRenderKey = [];

function aeroRideHeight(data,name,time) {
  const channel = data.channels[name];
  const value = channel && sample(channel,time)?.[0];
  const scale = {m:1000,cm:10,mm:1}[channel?.unit?.trim().toLowerCase()];
  return Number.isFinite(value) && scale ? value*scale : NaN;
}
function aeroPhaseMatches(data,time,phase) {
  if (phase === 'all') return true;
  const active = name => {
    const channel = data.channels[name];
    const value = channel && sample(channel,time)?.[0];
    return Number.isFinite(value) ? value > (channel.unit === '%' ? 5 : .05) : null;
  };
  const brake = active('Brake Pos');
  const throttle = active('Throttle Pos');
  if (phase === 'braking') return brake === true;
  if (phase === 'throttle') return throttle === true && brake === false;
  return throttle === false && brake === false;
}

function aeroData(data) {
  const cached = aeroCache.get(data);
  if (cached && cached.units === settings.measurementUnits) return cached;
  const heights = suspensionData(data).heights;
  const speed = trace(data,'Ground Speed').map(([distance,[value]]) => [distance,value]);
  const rake = heights[0].map(([distance,front,time]) => [
    distance,aeroRideHeight(data,'RearRideHeight',time)-front
  ]);
  const result = {heights,speed,rake,units:settings.measurementUnits};
  aeroCache.set(data,result);
  return result;
}

function renderAeroVisualiser() {
  const charts = $('aero-plots');
  const checkbox = $('aero-show-reference');
  checkbox.disabled = !secondary;
  const comparison = checkbox.checked ? secondary : null;
  const limits = settings.suspensionLimits;
  const phase = $('aero-phase').value;
  const key = [primary,comparison,range[0],range[1],limits,settings.measurementUnits,phase];
  if (key.some((value,index) => value !== aeroRenderKey[index])) {
    aeroRenderKey = key;
    charts.replaceChildren();
    if (!primary) charts.append(node('p','Load a lap in Telemetry Viewer to show aero data.'));
    else {
      const laps = [primary,...(comparison ? [comparison] : [])];
      const heights = laps.flatMap((data,index) => aeroData(data).heights.map((points,axle) =>
        ({points,reference:index===1,colour:suspensionColours[axle*2],axle,index})));
      const events = heights.flatMap(({points,axle,index}) => {
        const session = index ? reference.session : selected;
        const car = session.model || session.car;
        const threshold = Object.hasOwn(limits ?? {},car) ? limits[car][axle+4] : null;
        return suspensionEvents(points,threshold,true).map(run => ({...run,floor:true,
          label:[index ? 'Reference' : 'Loaded','Possible Floor Contact',axle ? 'Rear' : 'Front',
            run.first[0].toFixed(1)+(primary.useDistance ? ' m' : ' s'),run.value.toFixed(2)+' mm'].join(' · ')}));
      });
      const speedUnit = displayUnit('Ground Speed', 'km/h');
      suspensionDistancePlot(charts,'Front and Rear Ride Height (mm)',heights,events,range);
      suspensionDistancePlot(charts,'Ground Speed ('+speedUnit+')',laps.map((data,index) =>
        ({points:aeroData(data).speed,reference:index===1,colour:index ? 'var(--reference)' : 'var(--accent)'})),[],range);
      suspensionDistancePlot(charts,'Dynamic Rake · Rear − Front (mm)',laps.map((data,index) =>
        ({points:aeroData(data).rake,reference:index===1,colour:index ? 'var(--reference)' : 'var(--accent)'})),[],range);
      const scatter = heights.map(source => {
        const speeds = aeroData(laps[source.index]).speed;
        const points = speeds.length ? source.points.flatMap(([distance,height,time]) => {
          const data = laps[source.index];
          if (distance < range[0] || distance > range[1] || !Number.isFinite(height) || !aeroPhaseMatches(data,time,phase)) return [];
          const channel = data.channels['Ground Speed'];
          const speed = convert('Ground Speed',sample(channel,time)?.[0],channel.unit);
          return Number.isFinite(speed) ? [[speed,height]] : [];
        }) : [];
        return {...source,points};
      });
      const points = scatter.flatMap(source => source.points);
      if (points.length) {
        const [minSpeed,maxSpeed,minHeight,maxHeight] = points.reduce(([lo,hi,low,high],[speed,height]) =>
          [Math.min(lo,speed),Math.max(hi,speed),Math.min(low,height),Math.max(high,height)], [Infinity,-Infinity,Infinity,-Infinity]);
        const {svg,x,y} = suspensionPlot(charts,'Ride Height (mm) vs Ground Speed',840,185,'Ground speed ('+speedUnit+')',
          [Math.floor(minSpeed),Math.max(Math.floor(minSpeed)+1,Math.ceil(maxSpeed))],[minHeight-1,maxHeight+1]);
        for (const {points,colour,reference} of scatter) {
          const stride = Math.max(1,Math.ceil(points.length/650));
          for (let i=0;i<points.length;i+=stride) {
            const [speed,height] = points[i];
            suspensionSvg(svg,'circle',{cx:x(speed),cy:y(height),r:1.8,fill:reference ? 'none' : colour,
              stroke:colour,opacity:reference ? .65 : .45});
          }
        }
      } else charts.append(node('p','No ride height and speed samples match this driving phase and zoom range.'));
    }
  }
  paintVisualiserCursor(charts);
  const diagram = $('aero-platform');
  const carClass = selected?.carClass?.toLowerCase().trim();
  const model = selected?.model || selected?.car || '';
  const profile = /lexus.*rc[ -]?f/i.test(model) ? 'lexus' : carClass === 'lmgt3' ? 'gt3'
    : ['gt3','gte','lmp3','lmp2','hypercar'].includes(carClass) ? carClass : 'generic';
  if (diagram.dataset.profile !== profile) {
    diagram.dataset.profile = profile;
    diagram.setAttribute('viewBox', profile === 'lexus' ? '-29 -76 540 201' : '0 -32 460 157');
    diagram.querySelectorAll('use').forEach(outline => outline.setAttribute('href','#aero-outline-' + profile));
  }
  for (const [index,data] of [primary,comparison].entries()) {
    const group = diagram.querySelector(index ? '.aero-reference-platform' : '.aero-loaded-platform');
    const output = $(index ? 'aero-reference-reading' : 'aero-loaded-reading');
    const time = data?.timeAt(cursor);
    const heights = !data || cursor < data.extent[0] || cursor > data.extent[1] ? []
      : ['FrontRideHeight','RearRideHeight'].map(name => aeroRideHeight(data,name,time));
    const [front,rear] = heights;
    const valid = Number.isFinite(front) && Number.isFinite(rear);
    group.style.visibility = valid ? 'visible' : 'hidden';
    output.hidden = index === 1 && !comparison;
    output.textContent = valid ? `Front ${front.toFixed(1)} mm · Rear ${rear.toFixed(1)} mm · Rake ${(rear-front).toFixed(1)} mm`
      : 'Ride height unavailable at cursor';
    if (valid) {
      const height = value => 98 - Math.max(-10,Math.min(140,value))*(profile === 'lexus' ? .22 : .44);
      const start = height(front), end = height(rear);
      group.setAttribute('transform',`matrix(1 ${(end-start)/300} 0 1 0 ${start-80*(end-start)/300})`);
    }
  }
}
$('aero-show-reference').onchange = $('aero-phase').onchange = renderAeroVisualiser;

function renderVisualiserLaps() {
  for (const name of Object.keys(visualizerSettings)) {
    if (!popoutWindows.has(name)) continue;
    $(name + '-loaded').textContent = selected && lap ? viewerLapDetails('Loaded Lap',selected,lap) : 'No lap loaded';
    $(name + '-reference').textContent = secondary && reference
      ? viewerLapDetails('Reference Lap',reference.session,reference.lap) : 'No reference lap loaded';
  }
  if (popoutWindows.has('aero')) renderAeroVisualiser();
  if (!popoutWindows.has('suspension')) return;
  const checkbox = $('suspension-show-reference');
  checkbox.disabled = !secondary;
  const car = selected?.model || selected?.car;
  const limits = settings.suspensionLimits ?? {};
  const carLimits = Object.hasOwn(limits,car) ? limits[car] : undefined;
  if (car !== suspensionCar) {
    suspensionCar = car;
    $('suspension-limits').querySelectorAll('input').forEach((input,index) => { input.value = carLimits?.[index] ?? ''; });
  }
  const useReference = checkbox.checked && secondary;
  const referenceCar = reference?.session.model || reference?.session.car;
  const referenceLimits = Object.hasOwn(limits,referenceCar) ? limits[referenceCar] : undefined;
  const key = [primary,useReference,range[0],range[1],car,carLimits,referenceLimits];
  if (key.some((value,index) => value !== suspensionRenderKey[index])) {
    suspensionRenderKey = key;
    const content = $('suspension-plots');
    content.replaceChildren();
    if (!primary) {
      content.append(node('p','Load a lap in Telemetry Viewer to show suspension data.'));
      return;
    }
    const laps = [primary,...(useReference ? [secondary] : [])];
    const sources = field => laps.flatMap((data,lapIndex) => suspensionData(data)[field].map((points,index) =>
      ({points,index,reference:lapIndex===1,colour:suspensionColours[field === 'heights' ? index * 2 : index]})));
    const events = floor => laps.flatMap((data,lapIndex) => {
      const thresholds = lapIndex ? referenceLimits : carLimits;
      const series = suspensionData(data)[floor ? 'heights' : 'travel'];
      return series.flatMap((points,index) => {
        const limit = thresholds?.[index + (floor ? 4 : 0)];
        return suspensionEvents(points,limit,floor).map(run => ({...run,floor,
          label:[lapIndex ? 'Reference' : 'Loaded', floor ? 'Possible Floor Contact' : limit == null ? 'Possible Bottoming' : 'Suspension Travel Limit',
            floor ? ['Front','Rear'][index] : suspensionCorners[index],
            run.first[0].toFixed(1) + (primary.useDistance ? ' m' : ' s'), run.value.toFixed(2)+' mm'].join(' · ')}));
      });
    });
    suspensionDistancePlot(content,'Suspension Travel (mm)',sources('travel'),events(false),range);
    const velocity = sources('velocity');
    if (velocity.some(source => source.points.some(([,value]) => Number.isFinite(value)))) suspensionHistograms(content,velocity,range);
    suspensionDistancePlot(content,'Calculated Suspension Velocity (mm/s)',velocity,[],range);
    suspensionDistancePlot(content,'Front and Rear Ride Height (mm)',sources('heights'),events(true),range);
  }
  paintVisualiserCursor($('suspension-plots'));
}
function paintVisualiserCursor(charts) {
  const fraction = (cursor-range[0])/(range[1]-range[0]);
  charts.querySelectorAll('.suspension-cursor').forEach(line => {
    const {left,right} = line.dataset;
    const x = Number(left) + (Number(right)-Number(left))*fraction;
    line.style.visibility = fraction >= 0 && fraction <= 1 ? 'visible' : 'hidden';
    line.setAttribute('x1',x);
    line.setAttribute('x2',x);
  });
}

const suspensionLimitPanel = $('suspension-limits');
suspensionLimits.forEach((label,index) => {
  const field = node('label',label + ' (mm)');
  const input = node('input');
  input.type = 'number';
  input.step = 'any';
  input.onchange = () => {
    if (!suspensionCar) return;
    const limits = settings.suspensionLimits ?? {};
    const thresholds = Object.hasOwn(limits,suspensionCar) ? [...limits[suspensionCar]] : Array(6).fill(null);
    thresholds[index] = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
    save({suspensionLimits:{...limits,[suspensionCar]:thresholds}});
    renderVisualiserLaps();
  };
  field.append(input);
  suspensionLimitPanel.append(field);
});
$('suspension-show-reference').onchange = renderVisualiserLaps;

const chartHiddenWheels = new Map();
let smoothTyrePressure = true;

function wheelTraceControls(chartKey, channelName, colour, redraw) {
  const sources = [primary.channels[channelName], secondary?.channels[channelName]];
  const hasWheelTraces = sources.some(channel =>
    channel?.rows[0]?.length === (channel?.rate ? 4 : 5) &&
    (channelName === 'TyresPressure' || /temp/i.test(channelName) || /^(?:°?[cfk]|deg[cf])$/i.test(channel.unit?.trim() ?? '')));
  if (!hasWheelTraces) return {};

  const key = chartKey === 'delta' ? chartKey + '|' + channelName : chartKey;
  if (!chartHiddenWheels.has(key)) chartHiddenWheels.set(key, new Set());
  const hiddenWheels = chartHiddenWheels.get(key);
  const controls = node('span', undefined, 'wheel-trace-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', telemetryName(channelName) + ' wheel traces');
  const swatches = wheels.map((wheel, index) => {
    const label = node('label', undefined, 'speed-activation');
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hiddenWheels.has(index);
    const swatch = node('span', undefined, 'speed-activation-swatch');
    swatch.style.backgroundColor = colour(index);
    checkbox.onchange = () => {
      if (checkbox.checked) hiddenWheels.delete(index);
      else hiddenWheels.add(index);
      redraw();
    };
    label.append(checkbox, swatch, wheel);
    controls.append(label);
    return swatch;
  });
  const updateSwatches = () => swatches.forEach((swatch, index) => { swatch.style.backgroundColor = colour(index); });
  return {controls, hiddenWheels, updateSwatches};
}

function loadedLapPrefix(separator = ' ') {
  return secondary ? loadedTraceLabel + separator : '';
}

function graphScrollContainer() {
  return popoutWindows.has('graphs') ? $('telemetry-graphs-panel') : $('plot-column');
}

function buildCharts() {
  updateActiveLapComparison();
  cornerEventMarkers = [];
  selectedCorner = undefined;
  selection = null;
  chartRows = [];
  const hidden = new Set(settings.hiddenGraphs ?? defaultHiddenGraphs);
  const chosen = new Set(settings.extraGraphChannels);
  const extra = [...chosen].filter(name => !builtInGraphKeys.has(name))
    .sort((a,b) => a.localeCompare(b)).map(name => [defaultTelemetryNames.get(name) ?? name,name]);
  const specs = orderTelemetryGraphs([...(secondary?.useDistance && primary.useDistance
    ? [deltaGraph] : []), ...chartSpecs, ...extra]
    .filter(([,key])=>key === 'delta' || !hidden.has(key)), ([,key]) => key);
  const activationControls = new Map(speedActivations.map(([channel]) => [channel, []]));
  const deltaWidth = number(Math.max(lap.end - lap.start, secondary ? secondary.lap.end - secondary.lap.start : 0), 3).length + 3;
  const fragments = specs.map(([label, key]) => {
    const title = key === 'delta' ? label : telemetryGraphName(key, label);
    const chart = node('section', undefined, 'chart');
    const head = node('div', undefined, 'card-head');
    const output = node('output', undefined, 'chart-reading');
    const channelName = key === 'tyres' ? tyreName() : key;
    const configured = chartOverlayChannels(key).filter(name => name !== channelName);
    const channels = configured.filter(name => primary.channels[name] || secondary?.channels[name]);
    const group = channels.length ? {channels} : null;
    const mainLayout = key === 'delta' ? null : chartReadingLayout(primary, channelName);
    const referenceLayout = key !== 'delta' && secondary ? chartReadingLayout(secondary, channelName) : null;
    const readingWidth = mainLayout
      ? loadedLapPrefix().length + mainLayout.length + (referenceLayout ? referenceTraceLabel.length + 4 + referenceLayout.length : 0)
      : deltaWidth;
    output.style.inlineSize = readingWidth + 'ch';
    head.append(node('h2', title));
    head.append(colorControl(title,key,palette[0],()=>{
      wheelOptions.updateSwatches?.();
      row.cache = null;
      if (key === 'Ground Speed') {
        for (const speed of document.querySelectorAll('.corner-selected-speed')) speed.style.color = graphColor(key);
      }
      scheduleRender();
    }));
    const cornerAnalysis = key === 'delta' ? cornerTimeLossPanel() : null;
    const edit = node('button', configured.length ? 'Edit Overlays' : 'Add Channels', 'chart-edit button-secondary');
    edit.type = 'button';
    edit.setAttribute('aria-label', edit.textContent + ' for ' + title);
    edit.onclick = () => openMerge(key, title, channelName, edit);
    head.append(edit);
    const exportImage = node('button', 'Export Image', 'chart-edit chart-export button-secondary');
    addButtonIcon(exportImage, 'download');
    exportImage.type = 'button';
    exportImage.setAttribute('aria-label', 'Export Image for ' + title);
    exportImage.onclick = async () => {
      exportImage.disabled = true;
      try {
        const saved = await exportChartImage(row, title, exportImage);
        if (saved) setStatus($('status'), 'Exported ' + saved);
      } catch (error) {
        setStatus($('status'), error.message, {error:true});
      } finally {
        exportImage.disabled = false;
      }
    };
    if (key === 'tyres') {
      const select = node('select');
      select.setAttribute('aria-label', 'Tyre temperature measurement');
      Object.entries(tyreChannels).forEach(([channel, label]) => option(select, telemetryName(channel, label), channel));
      select.value = tyreName();
      select.addEventListener('change', () => {
        const column = graphScrollContainer();
        const scrollTop = column.scrollTop;
        const chartTop = chart.getBoundingClientRect().top;
        const hadFocus = select.ownerDocument.activeElement === select;
        save({tyres:select.value});
        buildCharts();
        const replacement = column.querySelector('select[aria-label="Tyre temperature measurement"]');
        if (replacement) {
          const newTop = replacement.closest('.chart').getBoundingClientRect().top;
          column.scrollTop += newTop - chartTop;
          if (hadFocus) replacement.focus({preventScroll:true});
        } else {
          column.scrollTop = scrollTop;
        }
      });
      head.append(select);
    }
    const source = primary.channels[key] || secondary?.channels[key];
    const isWheelChannel = source?.rows[0]?.length === (source?.rate ? 4 : 5) && /tyres|brakes|wheels/i.test(key);
    const redrawWheels = () => { row.cache = null; scheduleRender(); };
    const wheelOptions = wheelTraceControls(key, channelName,
      index => index === 0 ? graphColor(key) : palette[index], redrawWheels);
    if (wheelOptions.controls) head.append(wheelOptions.controls);
    else if (key === 'tyres' || isWheelChannel) head.append(node('span','FL / FR / RL / RR'));
    if (key === 'TyresPressure') {
      const label = node('label', undefined, 'speed-activation');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.checked = smoothTyrePressure;
      label.title = 'Average each wheel’s pressure over one second.';
      checkbox.onchange = () => {
        smoothTyrePressure = checkbox.checked;
        redrawWheels();
      };
      label.append(checkbox, 'Smooth Traces');
      head.append(label);
    }
    const hasSpeedTrace = key === 'Ground Speed' || group?.channels.includes('Ground Speed');
    if (hasSpeedTrace) {
      head.append(...speedActivationControls(activationControls));
    }
    const headerEnd = node('div', undefined, 'chart-header-end');
    if (key === 'Ground Speed') {
      const readouts = node('span', undefined, 'speed-readouts');
      readouts.append(speedPeaks(), output);
      headerEnd.append(readouts);
    } else {
      headerEnd.append(output);
    }
    const exportActions = node('span', undefined, 'chart-export-actions');
    exportActions.append(exportImage);
    if (key !== 'delta') {
      const close = node('button', undefined, 'chart-close');
      addButtonIcon(close, 'close');
      close.type = 'button';
      close.title = 'Hide ' + title;
      close.setAttribute('aria-label', close.title);
      close.onclick = () => {
        const column = graphScrollContainer();
        const scrollTop = column.scrollTop;
        const nextIndex = chartRows.indexOf(row);
        save({hiddenGraphs:[...new Set([...(settings.hiddenGraphs ?? defaultHiddenGraphs), key])]});
        buildCharts();
        column.scrollTop = scrollTop;
        const nextClose = chartRows[nextIndex]?.canvas.closest('.chart').querySelector('.chart-close');
        (nextClose ?? (popoutWindows.has('graphs') ? $('dock-graphs') : $('choose-graphs'))).focus({preventScroll:true});
      };
      exportActions.append(close);
    }
    headerEnd.append(exportActions);
    head.append(headerEnd);
    const canvas = node('canvas');
    canvas.setAttribute('aria-label', title);
    const resizer = node('button', undefined, 'resize');
    resizer.setAttribute('aria-label', 'Resize ' + title + ' chart. Use arrow keys.');
    const row = {key, edit, canvas, output, cache:null, group, hasSpeedTrace, cornerAnalysis, deltaWidth, mainLayout, referenceLayout, hiddenWheels:wheelOptions.hiddenWheels, readings:[]};
    const legend = node('div',undefined,'merge legend');
    if (group) {
        group.channels.forEach((name,index) => {
        const channel = primary.channels[name] || secondary?.channels[name];
        const unit = displayUnit(name,channel?.unit) || name;
        const item = node('span');
        const text = node('span', telemetryName(name) + (channel?.unit ? ' (' + unit + ')' : ''));
        const axisLabel = node('span');
        const read = node('span', undefined, 'chart-reading');
        const main = chartReadingLayout(primary, name);
        const ref = secondary ? chartReadingLayout(secondary, name) : null;
        read.style.inlineSize = (loadedLapPrefix().length + main.length + (ref ? referenceTraceLabel.length + 4 + ref.length : 0)) + 'ch';
        const fallback = mergeColors[(index + 1) % mergeColors.length], colorKey = key+'|'+name;
        text.style.color = graphColor(colorKey,fallback);
        const wheelOptions = wheelTraceControls(key, name, () => graphColor(colorKey,fallback), redrawWheels);
        const button = colorControl(telemetryName(name),colorKey,fallback,()=>{
          text.style.color = graphColor(colorKey,fallback);
          wheelOptions.updateSwatches?.();
          row.cache = null;
          scheduleRender();
        });
        item.append(button,' ',text,' ',axisLabel,' ',read);
        if (wheelOptions.controls) item.append(' ',wheelOptions.controls);
        row.readings.push({name,read,axisLabel,main,ref,hiddenWheels:wheelOptions.hiddenWheels});
        legend.append(item);
      });
      if (secondary) legend.prepend(node('span',loadedTraceLabel + ' · Solid  |  ' + referenceTraceLabel + ' · Dashed'));
    }
    chartRows.push(row);
    const setHeight = height => {
      row.height = Math.min(650, Math.max(75, height));
      canvas.style.height = row.height + 'px';
      row.cache = null;
      scheduleRender();
    };
    const persist = () => save({heights:{...settings.heights,[key]:row.height}});
    const defaultHeight = key === 'delta' ? 285 : key === 'Ground Speed' ? 175 : 135;
    setHeight(settings.heights?.[key] || defaultHeight);
    attachChartResize(resizer, () => row.height, setHeight, persist, () => {
      setHeight(defaultHeight);
      const heights = {...settings.heights};
      delete heights[key];
      save({heights});
    });
    function position(event) {
      const rect = canvas.getBoundingClientRect(), [left,right] = xBounds(rect.width);
      const f = Math.max(0,Math.min(1,(event.clientX - rect.left - left)/(right-left)));
      return range[0] + f*(range[1]-range[0]);
    }
    canvas.addEventListener('pointerenter', () => {
      row.hovering = true;
      scheduleRender();
    });
    canvas.addEventListener('pointerleave', () => {
      row.hovering = false;
      scheduleRender();
    });
    canvas.addEventListener('pointermove', e => {
      const x = position(e);
      if (selection?.row === row) { selection.x = x; scheduleRender(); }
      else if (!pinned && !playing) seek(x, false);
    });
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      selection = {row, initial:position(e), x:position(e), screen:e.clientX};
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointerup', e => {
      if (selection?.row !== row) return;
      const x = position(e);
      if (Math.abs(e.clientX - selection.screen) > 7 && Math.abs(x-selection.initial) > .01) {
        stop();
        pinned = false;
        updatePin();
        setTelemetryZoom([Math.min(selection.initial,x), Math.max(selection.initial,x)]);
        seek(range[0], false);
      } else {
        stop();
        pinned = !pinned;
        if (pinned) pinnedGraph = row.key;
        seek(x, false);
        updatePin();
      }
      selection = null;
      scheduleRender();
    });
    for (const event of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => {
      if (selection?.row !== row) return;
      selection = null;
      scheduleRender();
    });
    chart.append(head);
    if (group) chart.append(legend);
    chart.append(canvas,resizer);
    if (cornerAnalysis) {
      const cornerBar = node('div', undefined, 'corner-toggle-bar');
      cornerBar.append(cornerAnalysis.toggle);
      chart.append(cornerBar, cornerAnalysis.panel);
    }
    return chart;
  });
  $('track-activations').replaceChildren(...speedActivationControls(activationControls, true));
  $('charts').replaceChildren(...fragments);
  if (!fragments.length) $('charts').append(node('p', 'Use Select Active Telemetry Graphs to show a chart.'));
  scheduleRender();
}
function canvasContext(canvas) {
  const width = canvas.clientWidth, height = canvas.clientHeight, ratio = canvas.ownerDocument.defaultView.devicePixelRatio || 1;
  if (!width || !height) return null;
  if (canvas.width !== Math.round(width*ratio) || canvas.height !== Math.round(height*ratio)) {
    canvas.width = Math.round(width*ratio);
    canvas.height = Math.round(height*ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return {ctx,width,height,ratio};
}
function trace(data, name) {
  const channel = data.channels[name];
  if (!channel?.rows.length) return [];
  const plotValues = values => values.map(value =>
    typeof value === 'boolean' ? Number(value) : convert(name, value, channel.unit));
  let points;
  if (!channel.rate) {
    points = [[data.lap.start, sample(channel,data.lap.start) || []]];
    for (const [time,...values] of channel.rows) {
      if (time > data.lap.start && time < data.lap.end) points.push([time,values]);
    }
    points.push([data.lap.end, sample(channel,data.lap.end-1e-6) || []]);
  } else {
    points = channel.rows.map((values,index) => [channel.times[index],values])
      .filter(([time]) => time >= data.lap.start - 1e-6 && time < data.lap.end);
  }
  return points.map(([time,values], index) => [
    channel.rate || (index > 0 && index < points.length - 1) ? data.distanceAt(time) :
      data.extent[index === 0 ? 0 : 1],
    plotValues(values)
  ]);
}

function paintGearSegments(ctx, points, x, y) {
  let previous;
  for (const [distance,[gear]] of points) {
    const px = x(distance);
    if (Number.isFinite(previous)) ctx.lineTo(px,y(previous));
    if (gear !== previous && Number.isFinite(gear)) ctx.moveTo(px,y(gear));
    previous = gear;
  }
}
function smoothPressureTrace(data, points) {
  const times = points.map(([distance]) => data.timeAt(distance));
  const result = points.map(([distance, values]) => [distance, [...values]]);
  const count = points.find(([,values]) => values.length)?.[1].length ?? 0;
  for (let wheel = 0; wheel < count; wheel++) {
    const pressure = index => points[index][1][wheel];
    let start = 0;
    while (start < points.length) {
      if (!Number.isFinite(pressure(start))) { start++; continue; }
      let end = start + 1;
      while (end < points.length && Number.isFinite(pressure(end))) end++;
      let left = start, right = start, sum = 0;
      for (let index = start; index < end; index++) {
        while (right < end && times[right] <= times[index] + .5) sum += pressure(right++);
        while (times[left] < times[index] - .5) sum -= pressure(left++);
        result[index][1][wheel] = sum / (right - left);
      }
      start = end;
    }
  }
  return result;
}
function paintHorizontalTick(ctx, label, centre, baseline, width) {
  const half = ctx.measureText(label).width / 2;
  ctx.textAlign = 'center';
  ctx.fillText(label,Math.max(half + 2,Math.min(centre,width - half - 2)),baseline);
}
function deltaHeadingLimits(low, high, plotHeight) {
  // Leave space on both sides of zero even when every sample has the same sign.
  const share = Math.min(0.4, 28 * textScale() / Math.max(1, plotHeight));
  const opposite = share / (1 - share);
  return [Math.min(low, -high * opposite), Math.max(high, -low * opposite)];
}
function paintDeltaHeadings(ctx, left, right, top, bottom) {
  const inset = 9 * textScale();
  const maxWidth = Math.max(1, right - left - 2 * inset);
  ctx.globalAlpha = 1;
  ctx.font = '600 ' + 13 * textScale() + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = (lightGraphBackground ? '#253329' : '#b5c2b4');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('Losing time compared to the reference lap', left + inset, top + inset, maxWidth);
  ctx.textBaseline = 'bottom';
  ctx.fillText('Gaining time compared to the reference lap', left + inset, bottom - inset, maxWidth);
}
function* activationIntervals(data, name, enabled = settings.speedActivations?.[name]) {
  const channel = data.channels[name];
  if (!enabled || !channel?.rows.length) return;
  for (let i = 0; i < channel.rows.length; i++) {
    const value = channel.rows[i][channel.rate ? 0 : 1];
    if (value !== true && value !== 1) continue;
    const start = Math.max(channel.times[i], data.lap.start);
    const end = Math.min(channel.times[i + 1] ?? data.lap.end, data.lap.end);
    if (end > start) yield [start, end];
  }
}
function paintSpeedActivations(ctx, x, y) {
  for (const data of [primary, secondary]) {
    const speed = data?.channels['Ground Speed'];
    if (!speed?.rows.length) continue;
    for (const [name, colour, lightColour] of speedActivations) {
      ctx.strokeStyle = elementColour(name.toLowerCase(),lightGraphBackground ? lightColour : colour);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);
      for (const [start, end] of activationIntervals(data, name)) {
        const from = data.distanceAt(start), to = data.distanceAt(end);
        if (to < range[0] || from > range[1]) continue;
        const first = sample(speed, start)?.[0], last = sample(speed, end)?.[0];
        if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
        const startX = x(from), endX = x(to);
        ctx.beginPath();
        ctx.moveTo(startX, y(first));
        for (let j = lowerBound(speed.times, start); j < speed.times.length && speed.times[j] < end; j++) {
          const point = speed.rows[j][speed.rate ? 0 : 1];
          if (Number.isFinite(point)) ctx.lineTo(x(data.distanceAt(speed.times[j])), y(point));
        }
        ctx.lineTo(endX, y(last));
        ctx.stroke();
      }
    }
  }
}
function baseChart(row, width, height, ratio) {
  const image = document.createElement('canvas');
  image.width = Math.round(width*ratio); image.height = Math.round(height*ratio);
  const ctx = image.getContext('2d');
  ctx.scale(ratio,ratio);
  const [left,right] = xBounds(width), top = 12 * textScale(), bottom = height - 30 * textScale();
  const x = value => left + (value - range[0]) / (range[1] - range[0]) * (right-left);
  const name = row.key === 'tyres' ? tyreName() : row.key;
  const a = name === 'delta'
    ? Array.from({length:Math.max(150, Math.ceil(right-left))}, (_,i) => i)
    : trace(primary,name);
  let first = a;
  if (name === 'delta') first = a.map(i => {
    const at = range[0] + i/(a.length-1)*(range[1]-range[0]);
    return [at,[delta(at)]];
  });
  const second = secondary && name !== 'delta' ? trace(secondary,name) : [];
  let low = Infinity, high = -Infinity;
  for (const points of [first,second]) for (const [at,values] of points) {
    if (at < range[0] || at > range[1]) continue;
    for (const value of values) if (Number.isFinite(value)) { low = Math.min(low,value); high = Math.max(high,value); }
  }
  const source = primary.channels[name] || secondary?.channels[name];
  const baseAxis = name === 'delta' ? 'Time delta' : displayUnit(name,source?.unit) || name;
  const scales = new Map();
  const overlays = row.readings.map(entry => {
    const channel = primary.channels[entry.name] || secondary?.channels[entry.name];
    const axis = displayUnit(entry.name,channel.unit) || entry.name;
    const traces = [primary,secondary].map(data => {
      if (!data) return [];
      const points = trace(data,entry.name);
      return entry.name === 'TyresPressure' && smoothTyrePressure ? smoothPressureTrace(data,points) : points;
    });
    if (!scales.has(axis)) scales.set(axis,[Infinity,-Infinity]);
    const limits = scales.get(axis);
    for (const points of traces) for (const [at,values] of points) {
      if (at < range[0] || at > range[1]) continue;
      values.forEach((value,index) => {
        if (!Number.isFinite(value) || entry.hiddenWheels?.has(index)) return;
        limits[0] = Math.min(limits[0],value);
        limits[1] = Math.max(limits[1],value);
      });
    }
    return {entry,axis,traces};
  });
  if (scales.has(baseAxis)) {
    const [lo,hi] = scales.get(baseAxis);
    low = Math.min(low,lo);
    high = Math.max(high,hi);
  }
  for (const [axis,limits] of scales) {
    const [lo,hi] = limits;
    if (!Number.isFinite(lo)) { scales.set(axis,[0,1]); continue; }
    const pad = (hi-lo)*.06 || .5;
    scales.set(axis,[lo-pad,hi+pad]);
  }
  const smooth = name === 'TyresPressure' && smoothTyrePressure;
  const drawnFirst = smooth ? smoothPressureTrace(primary,first) : first;
  const drawnSecond = smooth && secondary ? smoothPressureTrace(secondary,second) : second;
  if (['Throttle Pos','Brake Pos'].includes(name)) {
    low = scales.has(baseAxis) ? Math.min(0,low) : 0;
    high = scales.has(baseAxis) ? Math.max(100,high) : 100;
  }
  else if (name === 'Gear') { low = Math.floor(Math.min(-1,low)); high = Math.ceil(Math.max(1,high)); }
  else if (name === 'delta') { low = Math.min(0,low); high = Math.max(0,high); }
  if (!Number.isFinite(low) || !Number.isFinite(high)) { low = 0; high = 1; }
  const splitGear = name === 'Gear' && [first,second].every(points => points.some(([,values]) => Number.isFinite(values[0])));
  const gearOffset = splitGear ? .18 : 0;
  const padding = (high-low)*.07 || 1;
  if (!['Throttle Pos','Brake Pos','Gear'].includes(name)) { low -= padding; high += padding; }
  if (name === 'delta') [low, high] = deltaHeadingLimits(low, high, bottom - top);
  const gearPadding = splitGear ? gearOffset + .12 : 0;
  const y = value => bottom - (value-low+gearPadding)/(high-low+2*gearPadding)*(bottom-top);
  scales.set(baseAxis,[low-gearPadding,high+gearPadding]);
  ctx.font = canvasFont();
  ctx.strokeStyle = elementColour('graph-grid',lightGraphBackground ? '#59645d55' : '#2a382e');
  ctx.fillStyle = elementColour('graph-axis',lightGraphBackground ? '#253329' : '#a4b3a7');
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const xx = left + (right-left)*i/4;
    ctx.beginPath();
    ctx.moveTo(xx, top); ctx.lineTo(xx,bottom); ctx.stroke();
    const tick = range[0] + (range[1]-range[0])*i/4;
    const label = number(primary.useDistance ? convert('',tick,'m') : tick,primary.useDistance ? (range[1]-range[0]<10 ? 1 : 0) : 1);
    paintHorizontalTick(ctx,label + (i === 4 ? (primary.useDistance ? ' ' + displayUnit('','m') : ' s') : ''),xx,bottom+18*textScale(),width);
  }
  ctx.textAlign = 'right';
  const digits = telemetryDecimalPlaces(name, ['delta','TyresPressure'].includes(name) ? 2 : high-low<12 ? 1 : 0);
  const tickCount = name === 'Gear' ? high - low : 4;
  for (let i = 0; i <= tickCount; i++) {
    const tick = high - (name === 'Gear' ? i : (high-low)*i/tickCount);
    const yy = y(tick);
    ctx.beginPath();
    ctx.moveTo(left,yy); ctx.lineTo(right,yy); ctx.stroke();
    ctx.fillText(name === 'Gear' ? valueLabel('Gear',tick) : number(tick,digits), left-8,yy+4*textScale());
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(left,top,right-left,bottom-top); ctx.clip();
  const sectors = primary.channels['Current Sector']?.rows || [];
  for (const [t] of sectors) {
    if (t <= lap.start+.1 || t >= lap.end-.1) continue;
    const px = x(primary.distanceAt(t));
    ctx.strokeStyle='#60715e'; ctx.setLineDash([3,4]); ctx.beginPath();
    ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();
  }
  ctx.setLineDash([]);
  overlays.forEach(({entry,axis,traces},index) => {
    const [lo,hi] = scales.get(axis);
    const scale = axis === baseAxis ? y : value => bottom-(value-lo)/(hi-lo)*(bottom-top);
    const colour = graphColor(row.key+'|'+entry.name,mergeColors[(index+1)%mergeColors.length]);
    traces.forEach((points,lapIndex) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.35;
      ctx.setLineDash(lapIndex ? [5,3] : []);
      const count = points.find(([,values]) => values.length)?.[1].length || 0;
      for (let component = 0; component < count; component++) {
        if (entry.hiddenWheels?.has(component)) continue;
        ctx.globalAlpha = Math.max(.4,1-component*.2);
        ctx.beginPath();
        if (entry.name === 'Gear') {
          paintGearSegments(ctx,points,x,scale);
        } else {
          const data = lapIndex ? secondary : primary;
          const stepped = !data.channels[entry.name]?.rate && entry.name !== 'TyresPressure';
          let previous;
          for (const [at,values] of points) {
            const value = values[component];
            if (!Number.isFinite(value)) { previous = undefined; continue; }
            const px = x(at), py = scale(value);
            if (previous === undefined) ctx.moveTo(px,py);
            else {
              if (stepped) ctx.lineTo(px,previous);
              ctx.lineTo(px,py);
            }
            previous = py;
          }
        }
        ctx.stroke();
      }
    });
    entry.axisLabel.textContent = number(lo,2) + ' to ' + number(hi,2) +
      (axis === baseAxis ? ' · Shared Axis' : '');
  });
  ctx.globalAlpha = 1;
  const step = source => source?.channels[name] && !source.channels[name].rate;
  for (const [points,colors,dashed,stepped] of [[drawnFirst,[graphColor(row.key), ...palette.slice(1)],false,!smooth && step(primary)],[drawnSecond,comparison,true,!smooth && step(secondary)]]) {
    const count = points.find(([,values])=>values.length)?.[1].length || 0;
    for (let i=0;i<count;i++) {
      if (row.hiddenWheels?.has(i)) continue;
      ctx.strokeStyle=colors[i%4];ctx.lineWidth=1.35;ctx.setLineDash(dashed?[5,3]:[]);
      ctx.beginPath();
      if (name === 'Gear') {
        paintGearSegments(ctx,points,x,gear => y(gear + (dashed ? -gearOffset : gearOffset)));
        ctx.stroke();
        break;
      }
      let previous;
      for (const [at,values] of points) {
        if (!Number.isFinite(values[i])) { previous=undefined; continue; }
        const px=x(at), py=y(values[i]);
        if (previous) { if(stepped)ctx.lineTo(px,previous);ctx.lineTo(px,py); }
        else ctx.moveTo(px,py);
        previous = py || Number.EPSILON;
      }
      ctx.stroke();
    }
  }
  if (name === 'Ground Speed') paintSpeedActivations(ctx, x, y);
  else if (row.hasSpeedTrace) {
    const speed = primary.channels['Ground Speed'] || secondary?.channels['Ground Speed'];
    const limits = scales.get(displayUnit('Ground Speed',speed?.unit) || 'Ground Speed');
    if (limits) paintSpeedActivations(ctx,x,value => bottom-(value-limits[0])/(limits[1]-limits[0])*(bottom-top));
  }
  if (name === 'delta') {
    ctx.setLineDash([3,3]);ctx.strokeStyle=(elementColour('graph-axis',lightGraphBackground ? '#253329' : '#a4b3a7'));ctx.beginPath();
    ctx.moveTo(left,y(0));ctx.lineTo(right,y(0));ctx.stroke();
    paintDeltaHeadings(ctx, left, right, top, bottom);
  }
  ctx.restore();
  if (name !== 'delta' && ![first,second].some(points => points.some(([,values]) => values.some(Number.isFinite)))) {
    ctx.textAlign = 'center';
    ctx.fillText('No Recorded Data for the Loaded Laps',(left + right) / 2,(top + bottom) / 2,right - left);
  }
  return {image,x,y,left,right,top,bottom,width,height,ratio,scales,gearOffset,from:range[0],to:range[1]};
}
function paintCursorValues(ctx, row, name) {
  const {x, y, left, right, top, bottom, scales} = row.cache;
  const at = x(cursor);
  const badges = [];
  const add = (label, value, scale, colour, characters, referenceLap = false) => {
    if (!Number.isFinite(value)) return;
    const py = scale(value);
    if (py < top || py > bottom) return;
    badges.push({label, py, colour, characters, referenceLap});
  };
  const scaleFor = axis => {
    const [lo, hi] = scales.get(axis);
    return value => bottom - (value - lo) / (hi - lo) * (bottom - top);
  };
  if (name === 'delta') {
    const gap = delta(cursor);
    add(timeGapLabel(gap), gap, scales ? scaleFor('Time delta') : y, graphColor('delta'), row.deltaWidth);
  }
  const channels = [...(name === 'delta' ? [] : [name]), ...(row.group?.channels ?? [])];
  channels.forEach((channelName, index) => {
    const source = primary.channels[channelName] || secondary?.channels[channelName];
    if (!source) return;
    const overlayIndex = index - (name === 'delta' ? 0 : 1);
    const overlay = overlayIndex >= 0 ? row.readings[overlayIndex] : undefined;
    const scale = overlay ? scaleFor(displayUnit(channelName,source.unit) || channelName) : y;
    for (const [data, referenceLap] of [[primary, false], [secondary, true]]) {
      if (!data || !inExtent(data, cursor)) continue;
      const channel = data.channels[channelName];
      const values = sample(channel, data.timeAt(cursor));
      const hiddenWheels = overlay ? overlay.hiddenWheels : row.hiddenWheels;
      values?.forEach((value, component) => {
        if (hiddenWheels?.has(component)) return;
        const shown = typeof value === 'boolean' ? Number(value) : convert(channelName, value, channel.unit);
        const wheel = values.length === 4 ? wheels[component] + ' ' : '';
        const lapPrefix = referenceLap ? referenceTraceLabel + ' · ' : loadedLapPrefix(' · ');
        const prefix = lapPrefix + (row.group ? telemetryName(channelName) + ' · ' : '');
        const normalColours = referenceLap ? comparison : [graphColor(row.key), ...palette.slice(1)];
        const colour = overlay ? graphColor(row.key + '|' + channelName, mergeColors[(overlayIndex + 1) % mergeColors.length])
          : normalColours[component % normalColours.length];
        const layout = overlay ? (referenceLap ? overlay.ref : overlay.main)
          : referenceLap ? row.referenceLayout : row.mainLayout;
        const label = valueLabel(channelName, value, channel.unit);
        const traceScale = !overlay && channelName === 'Gear' && row.cache.gearOffset
          ? gear => scale(gear + (referenceLap ? -row.cache.gearOffset : row.cache.gearOffset)) : scale;
        add(prefix + wheel + label, shown, traceScale, colour, prefix.length + wheel.length + (layout?.widths[component] ?? label.length), referenceLap);
      });
    }
  });

  ctx.save();
  const maxLabels = Math.max(1, Math.floor((bottom - top) / (14 * textScale())));
  const ordered = badges.slice(0, maxLabels).sort((a, b) => a.py - b.py);
  const step = Math.min(22 * textScale(), (bottom - top) / Math.max(1, ordered.length));
  const height = Math.max(1, step - 2);
  const font = Math.min(13 * textScale(), height - 2);
  badges.forEach(({py, colour}) => {
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(at, py, 3, 0, Math.PI * 2);
    ctx.fill();
  });
  if (font >= 8) {
    ctx.font = '600 ' + font + 'px Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let next = top;
    ordered.forEach(({label, py, colour, characters, referenceLap}, index) => {
      const ribbonWidth = Math.min(ctx.measureText('0').width * characters + 12, right - left);
      const px = at + ribbonWidth + 7 <= right ? at + 7 : Math.max(left, at - ribbonWidth - 7);
      const pyLabel = Math.min(bottom - (ordered.length - index) * step, Math.max(next, py - height / 2));
      next = pyLabel + step;
      ctx.fillStyle = '#152019';
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(px, pyLabel, ribbonWidth, height, 4);
      ctx.fill();
      ctx.setLineDash(referenceLap ? [1, 2] : []);
      ctx.stroke();
      ctx.fillStyle = '#f2f6ef';
      ctx.fillText(label, px + 6, pyLabel + height / 2, Math.max(1, ribbonWidth - 12));
    });
  }
  ctx.restore();
}
function captureChartElement(element, exportButton, expanded = new Set()) {
  const owner = element.ownerDocument.defaultView;
  const isCanvas = element.localName === 'canvas';
  const copy = isCanvas ? node('img') : element.cloneNode(false);
  const style = owner.getComputedStyle(element);
  copy.style.cssText = '';
  for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
  if (element === exportButton) {
    copy.style.visibility = 'hidden';
    return copy;
  }
  if (style.display === 'none') return copy;
  if (isCanvas) {
    copy.src = element.toDataURL();
    return copy;
  }
  if (element.localName === 'input') {
    copy.setAttribute('value', element.value);
    copy.toggleAttribute('checked', element.checked);
  }
  for (const child of element.childNodes) {
    const rendered = child.nodeType === 1 ? captureChartElement(child, exportButton, expanded) : child.cloneNode(true);
    if (rendered.style && !expanded.has(element) && (element.scrollTop || element.scrollLeft)) {
      rendered.style.translate = -element.scrollLeft + 'px ' + -element.scrollTop + 'px';
    }
    if (element.localName === 'select' && child.localName === 'option') {
      rendered.toggleAttribute('selected', child.selected);
    }
    copy.append(rendered);
  }
  const after = owner.getComputedStyle(element, '::after');
  if (after.content === '"▸"' || after.content === '"▾"') {
    const arrow = node('span', after.content.slice(1, -1));
    arrow.style.marginInlineStart = after.marginInlineStart;
    arrow.style.color = after.color;
    copy.append(arrow);
  }
  if (expanded.has(element)) Object.assign(copy.style, {position:'static', height:'auto', maxHeight:'none', overflow:'visible', flex:'none'});
  return copy;
}

async function exportChartImage(row, title, exportImage) {
  const card = row.canvas.closest('.chart');
  const rect = card.getBoundingClientRect();
  if (!ready || !rect.width || !rect.height) throw new Error('Open a lap before exporting a graph.');
  const width = Math.ceil(rect.width), height = Math.ceil(rect.height);
  const copy = captureChartElement(card, exportImage);
  copy.style.margin = '0';
  copy.style.boxSizing = 'border-box';
  copy.style.width = rect.width + 'px';
  copy.style.height = rect.height + 'px';
  const filename = [selected?.track, lap?.number == null ? '' : 'Lap ' + lap.number, title].filter(Boolean).join(' - ');
  return saveMarkupImage(copy, width, height, filename);
}

async function saveMarkupImage(copy, width, height, filename) {
  const font = await lmu.graphExportFont();
  const markup = new XMLSerializer().serializeToString(copy);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '"><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,' + font +
    ');font-weight:400 800}</style><foreignObject width="100%" height="100%">' + markup + '</foreignObject></svg>';
  const snapshot = new Image();
  snapshot.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await snapshot.decode();

  const ratio = Math.min(2, window.devicePixelRatio || 1, 16384 / Math.max(width, height));
  const png = node('canvas');
  png.width = Math.ceil(width * ratio);
  png.height = Math.ceil(height * ratio);
  png.getContext('2d').drawImage(snapshot, 0, 0, png.width, png.height);
  const blob = await new Promise(resolve => png.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not export the graph as a PNG.');
  return lmu.exportGraphImage(filename, await blob.arrayBuffer());
}

const exportSummaryButton = $('export-summary-image');
exportSummaryButton.onclick = async () => {
  exportSummaryButton.disabled = true;
  try {
    const [id, title] = summaryViews[summaryCategory];
    const section = $(id);
    const sectionWidth = Math.ceil(section.getBoundingClientRect().width);
    if (!selected || !sectionWidth) throw new Error('Open a session before exporting its summary.');
    const width = sectionWidth + 24;
    const owner = section.ownerDocument;
    const theme = owner.defaultView.getComputedStyle($('session-summary'));
    const copy = captureChartElement(section, null, new Set([section, $('practice-content')]));
    Object.assign(copy.style, {width:'100%', margin:'0', boxSizing:'border-box'});
    const image = owner.createElement('div');
    Object.assign(image.style, {width:width + 'px', boxSizing:'border-box', padding:'12px',
      background:theme.backgroundColor, color:theme.color, font:theme.font});
    const heading = owner.createElement('h2');
    heading.textContent = title;
    heading.style.margin = '0 0 10px';
    image.append(heading, copy);
    const measure = owner.createElement('div');
    Object.assign(measure.style, {position:'fixed', left:'-100000px', top:'0', visibility:'hidden'});
    measure.append(image);
    owner.body.append(measure);
    let height;
    try { height = Math.ceil(image.getBoundingClientRect().height); }
    finally { measure.remove(); }
    const saved = await saveMarkupImage(image, width, height, [selected.track, title].filter(Boolean).join(' - '));
    if (saved) setStatus($('status'), 'Exported ' + saved);
  } catch (error) {
    setStatus($('status'), error.message, {error:true});
  } finally {
    exportSummaryButton.disabled = false;
  }
};
function speedPeaks() {
  const name = 'Ground Speed';
  const peak = data => {
    const max = trace(data, name).reduce((best, [, [speed]]) =>
      Number.isFinite(speed) ? Math.max(best, speed) : best, -Infinity);
    const unit = displayUnit(name, data.channels[name]?.unit) || displayUnit('','km/h');
    return Number.isFinite(max) ? number(max, telemetryDecimalPlaces(name)) + ' ' + unit : '—';
  };
  const peaks = node('span', telemetryName(name, 'Top Speed') + ' · ', 'chart-reading');
  peaks.append(node('span', loadedLapPrefix() + peak(primary), 'selected-color'));
  if (secondary) peaks.append(' | ', node('span', referenceTraceLabel + ' ' + peak(secondary), 'reference-color'));
  return peaks;
}
function chartDriverLabels(selectedDriver, referenceDriver) {
  const selectedNames = selectedDriver?.trim().split(/\s+/) ?? [];
  const referenceNames = referenceDriver?.trim().split(/\s+/) ?? [];
  const sameDriver = selectedNames.join(' ').toLowerCase() === referenceNames.join(' ').toLowerCase();
  return [selectedNames[0] || 'Selected', sameDriver ? 'Reference' : referenceNames[0] || 'Reference'];
}
function paintChart(row) {
  const display=canvasContext(row.canvas);
  if(!display)return;
  const {ctx,width,height,ratio}=display;
  const cache=row.cache;
  if(!cache || cache.width!==width || cache.height!==height || cache.ratio!==ratio ||
    cache.from!==range[0] || cache.to!==range[1]) row.cache=baseChart(row,width,height,ratio);
  const {image,x,left,right,top,bottom}=row.cache;
  ctx.clearRect(0,0,width,height);
  ctx.drawImage(image,0,0,width,height);
  if (selectedCorner) {
    const start = Math.max(selectedCorner.from, range[0]);
    const finish = Math.min(selectedCorner.to, range[1]);
    if (finish > start) {
      ctx.save();
      ctx.fillStyle = lightGraphBackground ? '#8e5800' : cornerHighlightColour;
      ctx.globalAlpha = .16;
      ctx.fillRect(x(start), top, x(finish) - x(start), bottom - top);
      ctx.restore();
    }
  }
  if (row.cache.y) {
    for (const {channelName, distance, value, reference} of cornerEventMarkers) {
      if (row.key !== channelName || distance < range[0] || distance > range[1]) continue;
      ctx.fillStyle = reference ? comparison[0] : graphColor(channelName);
      ctx.beginPath();
      ctx.arc(x(distance), row.cache.y(value), 4 * textScale(), 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  if(cursor>=range[0] && cursor<=range[1]) {
    ctx.strokeStyle=(elementColour('focus',lightGraphBackground ? '#172119' : '#e8f0dd'));ctx.beginPath();ctx.moveTo(x(cursor),top);ctx.lineTo(x(cursor),bottom);ctx.stroke();
  }
  if(selection?.row===row) {
    const a=Math.max(left,Math.min(right,x(selection.initial))),b=Math.max(left,Math.min(right,x(selection.x)));
    ctx.fillStyle='#c6f36c30';ctx.fillRect(Math.min(a,b),top,Math.abs(b-a),bottom-top);
  }
  const name=row.key==='tyres'?tyreName():row.key;
  const showValues = row.hovering || (pinned && pinnedGraph === row.key);
  if (showValues && !selection && cursor >= range[0] && cursor <= range[1]) paintCursorValues(ctx, row, name);
  if(row.group) {
    for(const entry of row.readings){
      entry.read.replaceChildren(node('span',loadedLapPrefix() +
        readings(primary, entry.name, false, entry.main.widths, entry.hiddenWheels),'selected-color'));
      if (entry.ref) entry.read.append(' | ',node('span',referenceTraceLabel + ' ' +
        readings(secondary, entry.name, false, entry.ref.widths, entry.hiddenWheels),'reference-color'));
      const channel=primary.channels[entry.name] || secondary?.channels[entry.name];
      const unit=displayUnit(entry.name,channel?.unit) || entry.name;
      const limits=row.cache.scales.get(unit);
      entry.read.title=limits?'Axis '+number(limits[0],2)+' to '+number(limits[1],2)+' '+unit:'';
    }
  }
  if(name==='delta') {
    const value=delta(cursor);
    row.output.textContent=timeGapLabel(value);
  } else {
    row.output.replaceChildren(node('span', loadedLapPrefix() + readings(primary, name, false, row.mainLayout.widths, row.hiddenWheels), 'selected-color'));
    if (secondary) row.output.append('  |  ', node('span', referenceTraceLabel + ' ' + readings(secondary, name, false, row.referenceLayout.widths, row.hiddenWheels), 'reference-color'));
  }
}
function route(data) {
  if (data.route) return data.route;
  const lat = data.channels['GPS Latitude'], lon = data.channels['GPS Longitude'];
  if (!lat || !lon) return [];
  const points = [];
  for (let i=0;i<lat.rows.length;i++) {
    const t=lat.times[i], north=lat.rows[i][0], east=sample(lon,t)?.[0];
    if(t>=data.lap.start && t<=data.lap.end && Number.isFinite(north) && Number.isFinite(east))points.push([east,north,t]);
  }
  data.route=points;
  return points;
}
function routeSection(data, from, to) {
  const points = route(data);
  const start = data.timeAt(from), end = data.timeAt(to);
  const section = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i], previous = points[i - 1];
    if (previous && point[2] > previous[2]) {
      for (const boundary of [start, end]) {
        if (previous[2] < boundary && boundary < point[2]) {
          const fraction = (boundary - previous[2]) / (point[2] - previous[2]);
          section.push([previous[0] + (point[0] - previous[0]) * fraction,
            previous[1] + (point[1] - previous[1]) * fraction, boundary]);
        }
      }
    }
    if (point[2] > end) break;
    if (point[2] >= start) section.push(point);
  }
  return section;
}
function trackRoutes(selectedSection) {
  return [primary, secondary].map(data => data
    ? (selectedSection ? routeSection(data, ...range) : route(data)) : []);
}
const racingMap = $('racing-map');
const trackPanel = $('track-location');
const trackCameraMode = $('track-camera-mode');
let previousTrackCamera;
let trackCameraOverride;
new ResizeObserver(scheduleRender).observe(racingMap);
const trackCamera = {zoom:1, x:0, y:0};
const trackColours = {brake:'#ff4545', throttle:'#32e260'};
let trackProjection;
let trackDrag;
function restoreTrackCamera() {
  if (!previousTrackCamera) return;
  trackCameraMode.value = previousTrackCamera.mode;
  Object.assign(trackCamera, previousTrackCamera.camera);
  trackCameraOverride = previousTrackCamera.override;
  previousTrackCamera = undefined;
}
function fitTrack() {
  Object.assign(trackCamera, {zoom:1, x:0, y:0});
  scheduleRender();
}
function zoomTrack(factor, x = racingMap.clientWidth / 2, y = racingMap.clientHeight / 2) {
  if (trackCameraMode.value !== 'follow') trackCameraOverride = cursor;
  const zoom = Math.max(1, Math.min(80, trackCamera.zoom * factor));
  const ratio = zoom / trackCamera.zoom;
  const dx = x - racingMap.clientWidth / 2, dy = y - racingMap.clientHeight / 2;
  trackCamera.x = dx + (trackCamera.x - dx) * ratio;
  trackCamera.y = dy + (trackCamera.y - dy) * ratio;
  trackCamera.zoom = zoom;
  if (zoom === 1) fitTrack();
  scheduleRender();
}
function inspectTrackLocation(x, y) {
  if (!trackProjection) return;
  const [a, b] = trackRoutes(trackCameraMode.value === 'section');
  const data = a.length > 1 ? primary : secondary;
  if (!data) return;
  const points = data === primary ? a : b;
  let best = 30 ** 2, time;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = trackProjection(points[i - 1]);
    const [bx, by] = trackProjection(points[i]);
    const dx = bx - ax, dy = by - ay;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const fraction = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length));
    const error = (x - ax - fraction * dx) ** 2 + (y - ay - fraction * dy) ** 2;
    if (error >= best) continue;
    best = error;
    time = points[i - 1][2] + fraction * (points[i][2] - points[i - 1][2]);
  }
  if (time === undefined) return;
  seek(data.distanceAt(time), false);
  return true;
}
const trackViewButton = $('show-track-view');
const telemetryChannelsButton = $('show-telemetry-channels');
function showTrackView(showTrack) {
  trackViewButton.setAttribute('aria-pressed', String(showTrack));
  telemetryChannelsButton.setAttribute('aria-pressed', String(!showTrack));
  trackPanel.hidden = !showTrack && !popoutWindows.has('track');
  const link = $('track-popout-link');
  if (link) link.hidden = !showTrack;
  $('channel-list').hidden = showTrack;
  $('telemetry-channel-actions').hidden = showTrack;
  $('choose-channels').disabled = showTrack;
  scheduleRender();
}
trackViewButton.onclick = () => showTrackView(true);
telemetryChannelsButton.onclick = () => showTrackView(false);
function resetTrackView() {
  if (trackCameraMode.value === 'section') {
    trackCameraOverride = undefined;
    scheduleRender();
    return;
  }
  trackCameraOverride = cursor;
  fitTrack();
}
$('track-fit').onclick = resetTrackView;
racingMap.addEventListener('contextmenu', event => {
  event.preventDefault();
  resetTrackView();
});
trackCameraMode.onchange = () => {
  trackCameraOverride = undefined;
  scheduleRender();
};
$('track-zoom-in').onclick = () => zoomTrack(1.5);
$('track-zoom-out').onclick = () => zoomTrack(1 / 1.5);
$('track-pedals').onchange = scheduleRender;
racingMap.addEventListener('wheel', event => {
  event.preventDefault();
  zoomTrack(Math.exp(Math.max(-1, Math.min(1, -event.deltaY * .002))), event.offsetX, event.offsetY);
}, {passive:false});
racingMap.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  trackDrag = {id:event.pointerId, x:event.clientX, y:event.clientY, panX:trackCamera.x, panY:trackCamera.y, moved:false};
  racingMap.setPointerCapture(event.pointerId);
});
racingMap.addEventListener('pointermove', event => {
  if (trackDrag?.id === event.pointerId) {
    const dx = event.clientX - trackDrag.x, dy = event.clientY - trackDrag.y;
    if (!trackDrag.moved && Math.hypot(dx, dy) < 4) return;
    trackDrag.moved = true;
    trackCameraOverride = cursor;
    trackCamera.x = trackDrag.panX + dx;
    trackCamera.y = trackDrag.panY + dy;
    scheduleRender();
  } else if (ready && !pinned && !playing) {
    inspectTrackLocation(event.offsetX, event.offsetY);
  }
});
racingMap.addEventListener('pointerup', event => {
  if (trackDrag?.id !== event.pointerId || trackDrag.moved || !ready) return;
  if (inspectTrackLocation(event.offsetX, event.offsetY)) {
    stop();
    pinned = true;
    pinnedGraph = undefined;
    updatePin();
  }
});
racingMap.addEventListener('lostpointercapture', () => { trackDrag = null; });

function routeCorners(data, correction) {
  if (data.corners) return data.corners;
  const points = route(data);
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    distances.push(distances[i - 1] + Math.hypot((bx - ax) * correction, by - ay) * 111195);
  }

  // Measure heading changes across two 30 m chords to suppress GPS jitter.
  const corners = [];
  let bend;
  const finishBend = () => {
    if (!bend) return;
    const start = lowerBound(distances, Math.max(0, bend.start - 30));
    const end = Math.min(points.length - 1, lowerBound(distances, bend.end + 30));
    corners.push({points:points.slice(start, end + 1), start:points[start][2], end:points[end][2]});
    bend = undefined;
  };
  const length = distances.at(-1);
  for (let metres = 30; metres <= length - 30; metres += 10) {
    const a = points[lowerBound(distances, metres - 30)];
    const b = points[lowerBound(distances, metres)];
    const c = points[lowerBound(distances, metres + 30)];
    const heading = (from, to) => Math.atan2(to[1] - from[1], (to[0] - from[0]) * correction);
    const turn = heading(b, c) - heading(a, b);
    const angle = Math.atan2(Math.sin(turn), Math.cos(turn));
    if (Math.abs(angle) < Math.PI / 15) continue;
    if (bend && (metres - bend.end > 35 || Math.sign(angle) !== bend.direction)) finishBend();
    if (!bend) bend = {start:metres, end:metres, direction:Math.sign(angle)};
    else bend.end = metres;
  }
  finishBend();
  data.corners = corners;
  return corners;
}
function frameCurrentCorner(camera, data, referenceData, correction, width, height, baseScale, centreX, centreY) {
  const corners = routeCorners(data, correction);
  if (!corners.length) return;
  const time = data.timeAt(cursor);
  const corner = corners.findLast(item => item.start <= time) ?? corners[0];
  const points = [...corner.points];
  if (referenceData && data.useDistance && referenceData.useDistance) {
    const from = data.distanceAt(corner.start), to = data.distanceAt(corner.end);
    for (const point of route(referenceData)) {
      const distance = referenceData.distanceAt(point[2]);
      if (distance >= from && distance <= to) points.push(point);
    }
  }
  frameTrackPoints(camera, points, correction, width, height, baseScale, centreX, centreY);
}
function frameTrackPoints(camera, points, correction, width, height, baseScale, centreX, centreY) {
  if (!points.length) return;
  const east = points.map(point => point[0] * correction);
  const north = points.map(point => point[1]);
  const left = Math.min(...east), right = Math.max(...east), top = Math.max(...north), bottom = Math.min(...north);
  const cornerScale = Math.min(Math.max(1,width-28)/(right-left||1), Math.max(1,height-28)/(top-bottom||1));
  camera.zoom = Math.max(1, Math.min(80, cornerScale / baseScale));
  const scale = baseScale * camera.zoom;
  camera.x = (centreX - (left + right) / 2) * scale;
  camera.y = ((top + bottom) / 2 - centreY) * scale;
}
function currentGpsPoint(data) {
  if (!inExtent(data, cursor)) return null;
  const time = data.timeAt(cursor);
  const point = [sample(data.channels['GPS Longitude'], time)?.[0], sample(data.channels['GPS Latitude'], time)?.[0]];
  return point.every(Number.isFinite) ? [...point, time] : null;
}

function racingLineSpread() {
  return [2, 3].includes(settings.racingLineSpread) ? settings.racingLineSpread : 1;
}
function hasLateralOffset(data) {
  const channel = data?.channels['Path Lateral'];
  return channel?.unit === 'm' && channel.times.length > 0;
}
function spreadRacingPoint(data, point, correction, spread) {
  const [east, north, time] = point;
  const offset = sample(data.channels['Path Lateral'], time)?.[0];
  if (!Number.isFinite(offset) || Math.abs(correction) < 1e-6) return point;
  const longitude = data.channels['GPS Longitude'], latitude = data.channels['GPS Latitude'];
  const dx = (sample(longitude, time + .3)?.[0] - sample(longitude, time - .3)?.[0]) * correction;
  const dy = sample(latitude, time + .3)?.[0] - sample(latitude, time - .3)?.[0];
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-7)) return point;
  // Positive LMU lateral offsets are to the right of the recorded path.
  const extra = (spread - 1) * offset / 111195;
  return [east + dy / length * extra / correction, north - dx / length * extra, time];
}
const racingLineSpreadCache = new WeakMap();
function racingLineProjection(data, correction, spread, project) {
  if (spread === 1 || !hasLateralOffset(data)) return project;
  let cached = racingLineSpreadCache.get(data);
  if (cached?.spread !== spread || cached.correction !== correction) {
    cached = {spread, correction, points:new WeakMap()};
    racingLineSpreadCache.set(data, cached);
  }
  return point => {
    let displayPoint = cached.points.get(point);
    if (!displayPoint) {
      displayPoint = spreadRacingPoint(data, point, correction, spread);
      cached.points.set(point, displayPoint);
    }
    return project(displayPoint);
  };
}
function compactTrackGeometry(points, correction) {
  const [eastOrigin, northOrigin] = points[0];
  const local = ([east, north]) => [(east - eastOrigin) * correction, north - northOrigin];
  const sorted = points.map(local).sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
  function hullSide(ordered) {
    const side = [];
    for (const point of ordered) {
      while (side.length >= 2) {
        const [ax, ay] = side.at(-2), [bx, by] = side.at(-1);
        if ((bx - ax) * (point[1] - ay) > (by - ay) * (point[0] - ax)) break;
        side.pop();
      }
      side.push(point);
    }
    return side.slice(0, -1);
  }
  const hull = [...hullSide(sorted), ...hullSide(sorted.reverse())];
  let best;
  for (let index = 0; index < hull.length; index++) {
    const [ax, ay] = hull[index], [bx, by] = hull[(index + 1) % hull.length];
    const dx = bx - ax, dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const direction = dx < 0 || (dx === 0 && dy < 0) ? -1 : 1;
    const cos = direction * dx / length, sin = direction * dy / length;
    const rotate = ([x, y]) => [x * cos + y * sin, y * cos - x * sin];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of hull) {
      const [x, y] = rotate(point);
      minX = Math.min(x, minX); maxX = Math.max(x, maxX);
      minY = Math.min(y, minY); maxY = Math.max(y, maxY);
    }
    const span = maxY - minY;
    if (!best || span < best.maxY - best.minY) {
      best = {project:point => rotate(local(point)), minX, maxX, minY, maxY};
    }
  }
  return best;
}
let compactMapCache;
function paintTrackActivations(ctx, data, points, xy) {
  if (points.length < 2 || !speedActivations.some(([name]) => settings.speedActivations?.[name])) return;
  const times = points.map(point => point[2]);
  ctx.save();
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const [name, colour] of speedActivations) {
    ctx.strokeStyle = elementColour(name.toLowerCase(),colour);
    for (const [start, end] of activationIntervals(data, name)) {
      if (end <= times[0] || start >= times.at(-1)) continue;
      ctx.beginPath();
      for (let index = Math.max(1, lowerBound(times, start)); index < times.length && times[index - 1] < end; index++) {
        const before = times[index - 1], after = times[index];
        if (after <= before) continue;
        const [x, y] = xy(points[index - 1]);
        const [nextX, nextY] = xy(points[index]);
        const dx = nextX - x, dy = nextY - y;
        const from = (Math.max(start, before) - before) / (after - before);
        const to = (Math.min(end, after) - before) / (after - before);
        ctx.moveTo(x + dx * from, y + dy * from);
        ctx.lineTo(x + dx * to, y + dy * to);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function windIndicatorPosition(width, height, paths, labelWidth) {
  const centreX = width / 2, centreY = height / 2;
  const halfWidth = Math.max(28, (labelWidth + 30) / 2);
  const halfHeight = 37;
  if (centreX < halfWidth + 4 || centreY < halfHeight + 3) return [centreX, centreY];
  let best = [centreX, centreY], bestScore = -Infinity;
  for (const dy of [0, -.08, .08, -.16, .16, -.24, .24, -.32, .32, -.4, .4]) {
    for (const dx of [0, -.08, .08, -.16, .16, -.24, .24, -.32, .32, -.4, .4]) {
      const x = Math.max(halfWidth + 4, Math.min(width - halfWidth - 4, centreX + dx * width));
      const y = Math.max(halfHeight + 3, Math.min(height - halfHeight - 3, centreY + dy * height));
      let clearance = 1.6;
      let withinLoop = false;
      for (const path of paths) {
        let inside = false;
        const first = path[0], last = path.at(-1);
        const closed = first && Math.hypot(first[0] - last[0], first[1] - last[1]) < 20;
        for (let i = 0; i < path.length; i++) {
          const [px, py] = path[i];
          const [qx, qy] = path[i + 1] ?? (closed ? first : path[i]);
          const ax = (px - x) / halfWidth, ay = (py - y) / halfHeight;
          const vx = (qx - px) / halfWidth, vy = (qy - py) / halfHeight;
          const lengthSquared = vx * vx + vy * vy;
          const t = lengthSquared ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / lengthSquared)) : 0;
          clearance = Math.min(clearance, Math.hypot(ax + t * vx, ay + t * vy));
          if (closed && (py > y) !== (qy > y) && x < px + (qx - px) * (y - py) / (qy - py)) inside = !inside;
        }
        withinLoop ||= inside;
      }
      // The clearance ellipse encloses the indicator's full bounding rectangle.
      const clear = clearance >= Math.SQRT2;
      const score = clearance - Math.hypot(dx, dy) * .5 + (clear ? 2 + (withinLoop ? .35 : 0) : 0);
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  }
  return best;
}
let windPlacement;
function paintMapWind(ctx, width, height, project, origin, correction, routes = [], xy = project) {
  if (!primary || width < 90 || height < 55 || Math.abs(correction) < 1e-6) return;
  const time = primary.timeAt(cursor);
  const speed = sample(primary.channels['Wind Speed'], time)?.[0];
  const heading = sample(primary.channels['Wind Heading'], time)?.[0];
  if (!(Number.isFinite(speed) && speed >= 0)) return;

  const label = measurement(speed * 3.6, 'km/h', 0);
  const colour = elementColour('graph-axis', '#a4b3a7');
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.font = canvasFont();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelWidth = ctx.measureText(label).width;
  if (windPlacement?.primary !== primary || windPlacement.secondary !== secondary || windPlacement.corner !== selectedCorner ||
      windPlacement.width !== width || windPlacement.height !== height || windPlacement.labelWidth !== labelWidth) {
    const paths = routes.map(route => route.map(xy));
    windPlacement = {primary, secondary, corner:selectedCorner, width, height, labelWidth,
      point:windIndicatorPosition(width, height, paths, labelWidth)};
  }
  const [x, y] = windPlacement.point;
  if (speed > 0 && Number.isFinite(heading)) {
    const [east, north] = origin;
    const [ax, ay] = project(origin);
    const [bx, by] = project([east + Math.sin(heading) * .0001 / correction, north + Math.cos(heading) * .0001]);
    const angle = Math.atan2(ay - by, bx - ax);
    ctx.save();
    ctx.translate(x, y - 11);
    ctx.rotate(angle);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-22, 0);
    ctx.lineTo(22, 0);
    ctx.moveTo(15, -6);
    ctx.lineTo(22, 0);
    ctx.lineTo(15, 6);
    ctx.stroke();
    ctx.restore();
  }
  const labelY = y + 21;
  const iconX = x - labelWidth / 2 - 10;
  ctx.save();
  ctx.translate(iconX, labelY);
  ctx.lineWidth = 1.35;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(8, -4);
  ctx.bezierCurveTo(12, -4, 12, -8, 9, -8);
  ctx.moveTo(0, 0);
  ctx.lineTo(13, 0);
  ctx.bezierCurveTo(17, 0, 17, -4, 14, -4);
  ctx.moveTo(0, 4);
  ctx.lineTo(8, 4);
  ctx.bezierCurveTo(12, 4, 12, 8, 9, 8);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = elementColour('map-surface', '#111915');
  ctx.lineWidth = 4;
  ctx.strokeText(label, x + 10, labelY);
  ctx.fillText(label, x + 10, labelY);
  ctx.restore();
}

function paintMap(canvas, interactive = false) {
  if (interactive) {
    trackProjection = undefined;
    $('track-line-spread-key').hidden = true;
  }
  const display=canvasContext(canvas);
  if(!display)return;
  const {ctx,width}=display;
  let {height}=display;
  ctx.clearRect(0,0,width,height);
  const sectionMode = interactive && trackCameraMode.value === 'section';
  const [a, b] = trackRoutes(sectionMode);
  const all = sectionMode ? [...route(primary), ...(secondary ? route(secondary) : [])] : [...a, ...b];
  if (all.length < 2 || (sectionMode && a.length + b.length < 2)) {
    ctx.font = canvasFont();ctx.fillStyle='#a4b3a7';ctx.textAlign='center';ctx.fillText(sectionMode ? 'No GPS route in the selected section' : 'No GPS route available',width/2,height/2);
    return;
  }
  const meanLat=all[0][1]*Math.PI/180, correction=Math.cos(meanLat);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const [longitude,latitude] of all){
    const x=longitude*correction;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);
    minY=Math.min(minY,latitude);maxY=Math.max(maxY,latitude);
  }
  if(Math.max(maxX-minX,maxY-minY)<.00005) {
    ctx.font = canvasFont();ctx.fillStyle='#a4b3a7';ctx.textAlign='center';ctx.fillText('No on-track route in this segment',width/2,height/2);return;
  }
  let project = ([east, north]) => [east * correction, north];
  if (!interactive) {
    if (compactMapCache?.primary !== primary || compactMapCache?.secondary !== secondary) {
      compactMapCache = {primary, secondary, geometry:compactTrackGeometry(all, correction)};
    }
    const geometry = compactMapCache.geometry;
    if (geometry) {
      ({project, minX, maxX, minY, maxY} = geometry);
      const target = Math.ceil(Math.max(72, Math.min(225, 32 + Math.max(1, width - 36) * (maxY - minY) / (maxX - minX || 1))));
      if (height !== target) {
        canvas.style.height = target + 'px';
        height = canvasContext(canvas).height;
        ctx.clearRect(0, 0, width, height);
      }
    }
  }
  const camera = interactive ? trackCamera : {zoom:1, x:0, y:0};
  const baseScale = Math.min(Math.max(1,width-36)/(maxX-minX||1),Math.max(1,height-32)/(maxY-minY||1));
  const centreX = (minX + maxX) / 2, centreY = (minY + maxY) / 2;
  const automatic = interactive && trackCameraOverride !== cursor;
  if (automatic && trackCameraMode.value === 'corner') {
    frameCurrentCorner(camera, a.length ? primary : secondary, a.length ? secondary : null, correction, width, height, baseScale, centreX, centreY);
  }
  if (automatic && sectionMode) {
    frameTrackPoints(camera, [...a, ...b], correction, width, height, baseScale, centreX, centreY);
  }
  const scale = baseScale * camera.zoom;
  const followPoint = automatic && trackCameraMode.value === 'follow' && camera.zoom > 1 ? currentGpsPoint(a.length ? primary : secondary) : null;
  if (followPoint) {
    camera.x = (centreX - followPoint[0] * correction) * scale;
    camera.y = (followPoint[1] - centreY) * scale;
  }
  const xy = point => {
    const [x, y] = project(point);
    return [
      width / 2 + camera.x + (x - centreX) * scale,
      height / 2 + camera.y - (y - centreY) * scale
    ];
  };
  const spread = interactive ? racingLineSpread() : 1;
  const selectedLine = racingLineProjection(primary, correction, spread, xy);
  const referenceLine = racingLineProjection(secondary, correction, spread, xy);
  if (interactive) {
    trackProjection = a.length > 1 ? selectedLine : referenceLine;
    const spreadKey = $('track-line-spread-key');
    spreadKey.hidden = spread === 1 || !(a.length && hasLateralOffset(primary) || b.length && hasLateralOffset(secondary));
    if (!spreadKey.hidden) spreadKey.textContent = spread + '× Spread';
    $('track-reference-key').hidden = !b.length;
    $('track-pedals-key').hidden = !$('track-pedals').checked;
    const road = b.length > 1 && (secondary.lap.kind === 'complete' || a.length < 2) ? b : a;
    const roadWidth = Math.max(6, 12 * scale / 111195);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let previous;
    for (const point of road) {
      const [x, y] = xy(point);
      if (previous && Math.hypot(x - previous[0], y - previous[1]) < 100 * scale / 111195) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      previous = [x, y];
    }
    ctx.strokeStyle = '#67746d';
    ctx.lineWidth = roadWidth + 2;
    ctx.stroke();
    ctx.strokeStyle = '#333d38';
    ctx.lineWidth = roadWidth;
    ctx.stroke();
    ctx.restore();
  }
  for (const [points,color,data,xy] of [[b,comparison[0],secondary,referenceLine],[a,palette[0],primary,selectedLine]]) {
    if(!points.length)continue;
    ctx.beginPath();points.forEach((p,i)=>{const [x,y]=xy(p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
    ctx.strokeStyle = color;
    ctx.globalAlpha = .72;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (interactive && data === primary && $('track-pedals').checked) {
      ctx.lineWidth = 3.5;
      const brakes = data.channels['Brake Pos'], throttle = data.channels['Throttle Pos'];
      for (let i = 1; i < points.length; i++) {
        const time = points[i][2];
        const pedal = sample(brakes, time)?.[0] > 5 ? 'brake' : sample(throttle, time)?.[0] > 5 ? 'throttle' : null;
        if (!pedal) continue;
        ctx.strokeStyle = elementColour('map-' + pedal,trackColours[pedal]);
        ctx.beginPath();
        ctx.moveTo(...xy(points[i - 1]));
        ctx.lineTo(...xy(points[i]));
        ctx.stroke();
      }
    }
    if (interactive) paintTrackActivations(ctx, data, points, xy);
    const point = !sectionMode || (cursor >= range[0] && cursor <= range[1]) ? currentGpsPoint(data) : null;
    if (point) {
      const [x,y] = xy(point);
      ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
    }
  }
  if (selectedCorner?.route.length > 1) {
    ctx.save();
    ctx.strokeStyle = cornerHighlightColour;
    ctx.lineWidth = 5;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    selectedCorner.route.forEach((point, index) => {
      if (index) ctx.lineTo(...selectedLine(point));
      else ctx.moveTo(...selectedLine(point));
    });
    ctx.stroke();
    ctx.restore();
  }
  if (!interactive) paintMapWind(ctx, width, height, project, all[0], correction, [a, b, selectedCorner?.route ?? []], xy);
}
function scheduleRender(){
  if(renderRequested)return;
  renderRequested=true;
  requestAnimationFrame(()=>{
    renderRequested=false;
    renderVisualiserLaps();
    if (!ready) return;
    if (view === 'viewer' || popoutWindows.has('graphs')) {
      for (const row of chartRows) paintChart(row);
    }
    if (view !== 'viewer') return;
    for(const row of readoutRows) {
      row.a.textContent=readings(primary,row.name,true);
      row.b.textContent=readings(secondary,row.name,true);
    }
    paintMap($('map'));
    if (!trackPanel.hidden) paintMap(racingMap, true);
    $('position').textContent=number(playTime-lap.start,2)+' / '+number(lap.end-lap.start,2)+' s';
    $('scrub').value=Math.round(1000*(playTime-lap.start)/Math.max(.01,lap.end-lap.start));
  });
}
function seek(x, clampRange) {
  if(!primary)return;
  if(clampRange && (x<range[0] || x>range[1]))resetZoom();
  cursor=x;
  playTime=primary.timeAt(x);
  scheduleRender();
}
function setTime(t) {
  playTime=t;
  cursor=primary.distanceAt(t);
  scheduleRender();
}
function updatePin(){
  if (!pinned) pinnedGraph = undefined;
  $('unpin').disabled = !pinned;
  scheduleRender();
}
function updatePlaybackButton(playing) {
  const button = $('play');
  button.querySelector('.icon-button-label').textContent = playing ? 'Pause' : 'Play';
  button.querySelector('svg path').setAttribute('d', playing ? uiIconPaths.pause : uiIconPaths.play);
}
function stop() {
  playing=false;
  cancelAnimationFrame(frame);
  updatePlaybackButton(false);
}
function play() {
  if(!ready)return;
  if(playing){stop();return;}
  pinned=false;updatePin();
  if(playTime>=lap.end-.01)setTime(lap.start);
  playing=true;
  updatePlaybackButton(true);
  let last=performance.now();
  function step(now){
    if(!playing)return;
    setTime(Math.min(lap.end,playTime+(now-last)/1000*Number($('play-rate').value)));
    last=now;
    if(playTime>=lap.end)stop();else frame=requestAnimationFrame(step);
  }
  frame=requestAnimationFrame(step);
}
const builtInGraphPresets = {
  'Lap Comparison': {
    graphOrder:['Ground Speed','Brake Pos','Throttle Pos','Steering Pos','Gear'],
    heights:{'Ground Speed':235}
  },
  'Braking & Corner Entry': {
    graphOrder:['Brake Pos','Ground Speed','Steering Pos','Gear'],
    heights:{'Brake Pos':235},
    activations:['ABS']
  },
  'Corner Exit & Traction': {
    graphOrder:['Throttle Pos','Ground Speed','Steering Pos','Gear'],
    heights:{'Throttle Pos':235},
    activations:['TC']
  },
  'Tyres & Brakes': {
    graphOrder:['TyresPressure','tyres','Brakes Temp','Ground Speed'],
    heights:{TyresPressure:195,tyres:195,'Brakes Temp':195}
  },
  'Ride Height': {
    graphOrder:builtIn['Ride Height'],
    heights:{}
  },
  'G Forces': {
    graphOrder:builtIn['G Forces'],
    heights:{}
  },
  'Fuel & Energy': {
    graphOrder:builtIn['Fuel & Energy'],
    heights:{}
  },
  'Wheel Slip': {
    graphOrder:['Ground Speed','Wheel Speed'],
    heights:{},
    activations:['ABS','TC']
  },
  Suspension: {
    graphOrder:builtIn.Suspension,
    heights:{}
  }
};

const builtInColourPresets = {
  'Classic Green': {interfaceColourMode:'green'},
  'Classic Orange': {interfaceColourMode:'orange'},
  'TRD IMSA': {
    interfaceColour:'#9c1c20', interfaceBackgroundColour:'#080808', graphBackgroundColour:'#0b0b0b',
    elementColours:{header:'#050505',panel:'#121212',raised:'#1a1a1a',control:'#202020',rule:'#383838',
      fg:'#f7f7f7',muted:'#bdbdbd',accent:'#ffcf00',reference:'#ff7800',warning:'#ff6266',
      focus:'#ffcf00','graph-grid':'#292929','graph-axis':'#bdbdbd','map-surface':'#0b0b0b',trophy:'#ffcf00'}
  },
  'Slate & Amber': {
    interfaceColour:'#a45412', interfaceBackgroundColour:'#171a20', graphBackgroundColour:'#1e232d',
    elementColours:{header:'#1b1f28',panel:'#222733',raised:'#2b3240',control:'#323a4b',rule:'#4b5567',
      fg:'#f3f0e8',muted:'#b4bdcc',accent:'#ffcb79',reference:'#77c8ff','graph-grid':'#364152','map-surface':'#181e29'}
  },
  'Ocean & Coral': {
    interfaceColour:'#116777', interfaceBackgroundColour:'#101b21', graphBackgroundColour:'#16252e',
    elementColours:{header:'#14232b',panel:'#1a2b36',raised:'#223744',control:'#2b414f',rule:'#405c69',
      fg:'#edf7f9',muted:'#acc5cd',accent:'#6ae0db',reference:'#ffab91','graph-grid':'#304d59','map-surface':'#13242c'}
  },
  'Plum & Gold': {
    interfaceColour:'#704387', interfaceBackgroundColour:'#1b1522', graphBackgroundColour:'#231b2b',
    elementColours:{header:'#21192a',panel:'#2b2135',raised:'#352842',control:'#42334e',rule:'#564461',
      fg:'#f8effa',muted:'#c6b4d0',accent:'#dfa5f4',reference:'#ffd47e','graph-grid':'#493650','map-surface':'#21192a'}
  }
};

function colourPresetSettings() {
  return {
    interfaceColourMode:interfaceColourMode(),
    interfaceColour:backgroundColour(settings.interfaceColour,greenInterfaceColour),
    interfaceBackgroundColour:backgroundColour(settings.interfaceBackgroundColour,defaultInterfaceBackgroundColour),
    ...(settings.graphBackgroundColour ? {graphBackgroundColour:settings.graphBackgroundColour} : {}),
    elementColours:{...settings.elementColours}
  };
}

let presetTarget = 'presets';
const presetControls = {
  presets:{select:$('preset'), save:$('save-preset'), remove:$('remove-preset'), title:'Save Telemetry Channel Preset'},
  graphPresets:{select:$('graph-preset'), save:$('save-graph-preset'), remove:$('remove-graph-preset'), title:'Save Telemetry Graph Preset'},
  colourPresets:{select:$('colour-preset'), save:$('save-colour-preset'), remove:$('remove-colour-preset'), title:'Save Colour Preset'}
};
function populatePresets(target, selection = presetControls[target].select.value){
  const {select, remove} = presetControls[target];
  select.replaceChildren();
  option(select,'Choose Preset','');
  const defaults = {presets:builtIn, graphPresets:builtInGraphPresets, colourPresets:builtInColourPresets}[target];
  for (const label of Object.keys(defaults)) option(select,label,'builtin:'+label);
  for(const label of Object.keys(settings[target] || {}))option(select,label,'saved:'+label);
  select.value = [...select.options].some(entry => entry.value === selection) ? selection : '';
  remove.disabled = !select.value.startsWith('saved:');
}
function setupPresets(){
  for(const target of Object.keys(presetControls))populatePresets(target);
}
$('preset').addEventListener('change',()=>{
  const key=$('preset').value;
  $('remove-preset').disabled = !key.startsWith('saved:');
  if(!key)return;
  if(key.startsWith('builtin:')){
    enabled=new Set(builtIn[key.slice(8)]);
    save({enabled:[...enabled]});
  }else{
    const preset=settings.presets[key.slice(6)];
    enabled=new Set(preset.enabled);
    save({enabled:[...enabled],heights:preset.heights,tyres:preset.tyres || 'TyresTempCentre',
      ...(preset.colors ? {colors:preset.colors} : {}),
      ...(preset.chartOverlays || preset.deltaChannels ? {chartOverlays:preset.chartOverlays ?? {delta:preset.deltaChannels}} : {}),
      ...(preset.hiddenGraphs ? {hiddenGraphs:preset.hiddenGraphs} : {}),
      ...(preset.graphOrder ? {graphOrder:preset.graphOrder} : {}),
      ...(preset.extraGraphChannels ? {extraGraphChannels:preset.extraGraphChannels} : {}),
      ...(preset.hiddenSummary ? {hiddenSummary:preset.hiddenSummary} : {})});
    renderSessionSummary();
    if(ready)buildCharts();
  }
  buildChannels();
});
$('graph-preset').onchange=()=>{
  const key = $('graph-preset').value;
  $('remove-graph-preset').disabled = !key.startsWith('saved:');
  if(!key)return;
  if (key.startsWith('builtin:')) {
    const {graphOrder, heights, activations = []} = builtInGraphPresets[key.slice(8)];
    save({
      graphOrder, heights, chartOverlays:{delta:[]},
      extraGraphChannels:graphOrder.filter(name => name !== 'delta' && !builtInGraphKeys.has(name)),
      hiddenGraphs:chartSpecs.map(([,name]) => name).filter(name => !graphOrder.includes(name)),
      ...(activations.length ? {speedActivations:{...settings.speedActivations,
        ...Object.fromEntries(activations.map(channel => [channel,true]))}} : {})
    });
  } else {
    const {hiddenGraphs, extraGraphChannels, heights, graphOrder = [], chartOverlays = {delta:[]}} = settings.graphPresets[key.slice(6)];
    save({hiddenGraphs, extraGraphChannels, heights, graphOrder, chartOverlays});
  }
  if(ready)buildCharts();
};
$('colour-preset').onchange = () => {
  const key = $('colour-preset').value;
  const saved = key.startsWith('saved:');
  $('remove-colour-preset').disabled = !saved;
  if (!key) return;
  const preset = saved ? settings.colourPresets[key.slice(6)] : builtInColourPresets[key.slice(8)];
  save({
    interfaceColourMode:preset.interfaceColourMode ?? 'custom',
    interfaceColour:preset.interfaceColour ?? null,
    interfaceBackgroundColour:preset.interfaceBackgroundColour ?? null,
    graphBackgroundColour:preset.graphBackgroundColour ?? null,
    elementColours:preset.elementColours ?? {}
  });
  refreshTheme();
};
for(const [target, controls] of Object.entries(presetControls)){
  controls.save.onclick=()=>{
    presetTarget = target;
    $('preset-dialog-title').textContent = controls.title;
    $('preset-name').value='';
    $('preset-dialog').showModal();
  };
  controls.remove.onclick=()=>{
    if(!controls.select.value.startsWith('saved:'))return;
    const name = controls.select.value.slice(6);
    if(!window.confirm('Remove the preset “'+name+'”?'))return;
    const presets = {...settings[target]};
    delete presets[name];
    save({[target]:presets});
    populatePresets(target, '');
  };
}
$('cancel-preset').onclick=()=>$('preset-dialog').close();
$('preset-form').addEventListener('submit',e=>{
  e.preventDefault();
  const name=$('preset-name').value.trim();
  if(!name)return;
  if (presetTarget === 'colourPresets') {
    save({colourPresets:{...settings.colourPresets,[name]:colourPresetSettings()}});
    populatePresets(presetTarget, 'saved:'+name);
    $('preset-dialog').close();
    return;
  }
  const graphLayout = {
    hiddenGraphs:[...(settings.hiddenGraphs ?? defaultHiddenGraphs)],
    extraGraphChannels:[...(settings.extraGraphChannels || [])],
    heights:{...settings.heights},
    graphOrder:[...(settings.graphOrder ?? [])],
    chartOverlays:{delta:chartOverlayChannels('delta'),...settings.chartOverlays}
  };
  const preset = presetTarget === 'graphPresets' ? graphLayout : {
    ...graphLayout, enabled:[...enabled], tyres:tyreName(), colors:{...settings.colors},
    deltaChannels:settings.deltaChannels || [], hiddenSummary:settings.hiddenSummary ?? defaultHiddenSummary
  };
  save({[presetTarget]:{...settings[presetTarget],[name]:preset}});
  populatePresets(presetTarget, 'saved:'+name);
  $('preset-dialog').close();
});
function openChannelPicker() {
  $('channel-search').value='';
  $('channel-dialog').showModal();
  showChannelMode(false);
  $('channel-search').focus();
}
$('choose-channels').onclick=openChannelPicker;
$('settings-channels').onclick=openChannelPicker;
$('channel-search').oninput=buildChannelSelector;
$('channel-select-tab').onclick=()=>showChannelMode(false);
$('channel-order-tab').onclick=()=>showChannelMode(true);
for (const id of ['enable-shown', 'disable-shown']) $(id).onclick=()=>{
  for (const name of shownChannels()) {
    if (id === 'enable-shown') enabled.add(name); else enabled.delete(name);
  }
  save({enabled:[...enabled]});
  buildChannels();
};
$('pin-session-details').onclick = event => {
  const button = event.currentTarget;
  const locked = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(locked));
  button.title = locked ? 'Unpin Session Details' : 'Pin Session Details';
  button.closest('.map-card').classList.toggle('session-details-pinned', locked);
};
$('toggle-map').onclick=event=>{
  const map = $('map-content');
  map.hidden = !map.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!map.hidden));
  event.currentTarget.setAttribute('aria-label', map.hidden ? 'Expand Session Details' : 'Collapse Session Details');
  if (!map.hidden) scheduleRender();
};
$('play').onclick=play;
$('reset-zoom').onclick=()=>{
  stop();
  pinned=false;
  selection=null;
  updatePin();
  resetZoom();
};
$('unpin').onclick=()=>{pinned=false;updatePin();};
$('scrub').oninput=()=>{
  if(!ready)return;
  stop();pinned=false;updatePin();
  setTime(lap.start+Number($('scrub').value)/1000*(lap.end-lap.start));
};
$('lap-select').onchange = () => {
  lapHistoryFocus = -1;
  selectLap(selected.laps.find(item => String(item.id) === $('lap-select').value));
};
$('remove-reference-session').onclick = $('clear-loaded-reference').onclick = () => selectReferenceSession(undefined);
$('car-select').onchange=()=>{manualReference=undefined;fillReferences();void readReference();};
$('reference-select').onchange=()=>{
  manualReference=$('reference-select').value==='auto'?undefined:$('reference-select').value;
  fillReferences();
  void readReference();
};
$('library-tab').onclick=()=>setView('library');
$('viewer-tab').onclick=()=>setView('viewer');
$('viewer-open-recent').onclick = () => {
  setView('library');
  $('recent-sessions-title').click();
  $('recent-sessions-title').focus();
};
$('viewer-import-lap').onclick = () => {
  setView('library');
  $('comparison-laps-title').click();
  importComparisonButton.focus();
  importComparisonButton.click();
};
$('records-tab').onclick=()=>setView('records');
$('recent-session-filters').addEventListener('change', event => {
  if (event.target instanceof HTMLSelectElement) renderLibrary({resetRecentSessions:true});
});
$('imported-lap-filters').addEventListener('change', renderComparisonLaps);
$('reset-imported-lap-filters').onclick = () => {
  for (const select of $('imported-lap-filters').querySelectorAll('select')) select.value = '';
  renderComparisonLaps();
};
$('reset-library-filters').onclick = () => {
  for (const select of $('recent-session-filters').querySelectorAll('select')) select.value = '';
  renderLibrary({resetRecentSessions:true});
};
$('interface-colour-mode').onchange = event => {
  save({interfaceColourMode:event.target.value});
  interfaceColourFields();
  applyAppearance();
};
$('interface-colour').addEventListener('input', event => {
  settings.interfaceColour = event.target.value;
  applyAppearance();
});
$('interface-colour').addEventListener('change', event => {
  save({interfaceColour:event.target.value});
  applyAppearance();
});
$('interface-background-colour').addEventListener('input', event => {
  settings.interfaceBackgroundColour = event.target.value;
  applyAppearance();
});
$('interface-background-colour').addEventListener('change', event => {
  save({interfaceBackgroundColour:event.target.value});
  applyAppearance();
});
$('graph-background-colour').addEventListener('input', event => {
  settings.graphBackgroundColour = event.target.value;
  applyAppearance();
});
$('graph-background-colour').addEventListener('change', event => {
  save({graphBackgroundColour:event.target.value});
  applyAppearance();
});
function refreshTheme() {
  applyAppearance();
  interfaceColourFields();
  $('interface-background-colour').value = backgroundColour(settings.interfaceBackgroundColour,defaultInterfaceBackgroundColour);
  $('graph-background-colour').value = backgroundColour(settings.graphBackgroundColour,defaultGraphBackgroundColour);
  renderSessionSummary();
  if (ready) {
    const column = $('plot-column');
    const scrollTop = column.scrollTop;
    buildCharts();
    column.scrollTop = scrollTop;
  }
}
$('reset-interface-colours').onclick = () => {
  save({interfaceColourMode:null, interfaceColour:null, interfaceBackgroundColour:null, graphBackgroundColour:null, elementColours:{}});
  populatePresets('colourPresets','');
  refreshTheme();
};
$('text-scale').addEventListener('input', event => {
  $('text-scale-value').value = event.target.valueAsNumber + '%';
});
$('text-scale').addEventListener('change', event => {
  save({textScalePercent:event.target.valueAsNumber});
  applyAppearance();
});
$('racing-line-spread').onchange = event => {
  save({racingLineSpread:Number(event.target.value)});
  scheduleRender();
};
for (const category of [...carClasses, 'other']) {
  const row = node('tr');
  const classLabel = category === 'other' ? 'Unclassified' : category;
  const heading = node('th', classLabel);
  heading.scope = 'row';
  row.append(heading);
  for (const [key, label] of temperatureThresholds) {
    const cell = node('td');
    const input = node('input');
    input.type = 'number';
    input.step = 'any';
    input.placeholder = 'Off';
    input.dataset.hotTemperature = key;
    input.dataset.carClass = category;
    input.dataset.temperatureLabel = classLabel + ' ' + label;
    input.addEventListener('change', () => {
      if (input.validity.badInput) return;
      const byClass = settings.hotTemperaturesByClass ?? {};
      const threshold = Number.isFinite(input.valueAsNumber) ? temperatureSettingValue(input.valueAsNumber) : null;
      save({hotTemperaturesByClass: {...byClass, [category]: {...byClass[category], [key]: threshold}}});
      renderSessionSummary();
    });
    cell.append(input);
    row.append(cell);
  }
  $('class-temperature-thresholds').append(row);
}
const settingsFileButtons = [...document.querySelectorAll('[data-settings-file]')];
for (const button of settingsFileButtons) {
  button.onclick = async () => {
    const {settingsFile:action, settingsCategory:category} = button.dataset;
    const status = $(category + '-settings-file-status');
    for (const control of settingsFileButtons) control.disabled = true;
    setStatus(status, '');
    try {
      const result = await lmu.transferSettingsFile(action, category);
      if (!result) return;
      if (action === 'import') {
        settings = result.settings;
        if (category === 'display') {
          enabled = new Set(settings.enabled ?? builtIn.Driving);
          setupPresets();
          if (Number.isFinite(settings.summaryHeight)) setSummaryHeight(settings.summaryHeight);
          else {
            summaryHeight = null;
            telemetryPanels.style.removeProperty('--summary-height');
          }
          applySidebarWidth(settings.telemetrySidebarWidth);
          applyAppearance();
          if (ready) {
            buildCharts();
            buildChannels();
          }
        }
        settingsFields();
        renderSessionSummary();
      }
      setStatus(status, action === 'import' ? 'Imported ' + result.filename : 'Exported ' + result);
    } catch (error) {
      setStatus(status, error.message.replace(/^Error invoking remote method '[^']+': Error: /, ''), {error:true});
    } finally {
      for (const control of settingsFileButtons) control.disabled = false;
    }
  };
}
$('reset-settings').onclick = async () => {
  const button = $('reset-settings');
  button.disabled = true;
  try {
    await lmu.resetSettings();
  } catch (error) {
    setStatus($('status'), error.message, {error:true});
  } finally {
    button.disabled = false;
  }
};
let availableUpdate;
let lastAnnouncedUpdateVersion;
let updateInProgress = false;
const updateStatus = $('tpr-update-status');
const updateDialog = $('tpr-update-dialog');
const installUpdateButton = $('install-tpr-update');

async function checkTprUpdate(interactive = false) {
  if (!settings.tprUpdatesSupported || updateInProgress) return;
  updateInProgress = true;
  installUpdateButton.hidden = true;
  if (interactive) {
    updateStatus.textContent = 'Checking the Community Server…';
    if (!updateDialog.open) updateDialog.showModal();
  }
  try {
    availableUpdate = await lmu.checkTprUpdate();
    if (availableUpdate && lastAnnouncedUpdateVersion !== availableUpdate.version) {
      lastAnnouncedUpdateVersion = availableUpdate.version;
      if (settings.notificationSound === true) playNotificationChime();
    }
    $('tpr-update-available').hidden = !availableUpdate;
    installUpdateButton.hidden = !availableUpdate;
    updateStatus.textContent = availableUpdate ? 'TPR Edition ' + availableUpdate.version + ' is ready to download.' :
      'No newer TPR installer is available from the Community Server.';
  } catch (error) {
    availableUpdate = undefined;
    $('tpr-update-available').hidden = true;
    if (interactive) updateStatus.textContent = error.message;
  } finally {
    updateInProgress = false;
  }
}
$('check-tpr-update').onclick = () => void checkTprUpdate(true);
$('tpr-update-available').onclick = () => { if (!updateDialog.open) updateDialog.showModal(); };
installUpdateButton.onclick = async () => {
  if (!availableUpdate || updateInProgress) return;
  updateInProgress = true;
  installUpdateButton.disabled = true;
  updateStatus.textContent = 'Downloading update…';
  try {
    await lmu.installTprUpdate(availableUpdate.version);
  } catch (error) {
    updateStatus.textContent = error.message;
  } finally {
    updateInProgress = false;
    installUpdateButton.disabled = false;
  }
};
lmu.onTprUpdateProgress?.(percent => {
  updateStatus.textContent = percent === 100 ? 'Verifying the installer…' : 'Downloading update… ' + percent + '%';
});

let choosingLmuFolder = false;
for (const id of ['settings-button','empty-folders']) $(id).onclick = () => {
  if (choosingLmuFolder) return;
  settingsFields();
  if (id === 'empty-folders') $('settings-tab-folders').click();
  $('folders').showModal();
};
for (const button of document.querySelectorAll('[data-folder]')) button.onclick = async () => {
  if (choosingLmuFolder) return;
  choosingLmuFolder = true;
  const settingsDialog = $('folders');
  const status = $('folder-selection-status');
  setStatus(status, '');
  settingsDialog.close();
  try {
    const {telemetry,results} = settings;
    Object.assign(settings, await lmu.folder(button.dataset.folder));
    settingsFields();
    if (settings.telemetry !== telemetry || settings.results !== results) void scan();
  } catch (error) {
    setStatus(status, error.message, {error:true,temporary:false});
  } finally {
    choosingLmuFolder = false;
    if (!settingsDialog.open) settingsDialog.showModal();
    button.focus();
  }
};
const telemetryWorkbench = $('telemetry-workbench');
const viewerDivider = $('viewer-divider');
const telemetrySidebar = $('telemetry-sidebar');
function applySidebarWidth(percent) {
  if (Number.isFinite(percent)) telemetryWorkbench.style.setProperty('--sidebar-width', percent + '%');
  else telemetryWorkbench.style.removeProperty('--sidebar-width');
}
const sidebarWidth = () => telemetrySidebar.getBoundingClientRect().width;
const resetSidebarWidth = () => {
  applySidebarWidth(null);
  save({telemetrySidebarWidth:null});
};
attachChartResize(viewerDivider, () => -sidebarWidth(), offset => {
  const width = telemetryWorkbench.clientWidth;
  if (width) applySidebarWidth(Math.max(0, Math.min(100, -offset / width * 100)));
}, () => {
  const width = telemetryWorkbench.clientWidth;
  if (width) {
    const telemetrySidebarWidth = sidebarWidth() / width * 100;
    applySidebarWidth(telemetrySidebarWidth);
    save({telemetrySidebarWidth});
  }
}, resetSidebarWidth, 'x');
viewerDivider.onclick = event => { if (event.detail === 0) resetSidebarWidth(); };
new ResizeObserver(scheduleRender).observe($('plot-column'));

const summaryPanel = $('session-summary');
const telemetryPanels = $('telemetry-panels');
let summaryHeight;
function setSummaryHeight(percent) {
  summaryHeight = Math.max(20, Math.min(80, percent));
  telemetryPanels.style.setProperty('--summary-height', summaryHeight + '%');
}
attachChartResize($('telemetry-divider'),
  () => -summaryPanel.getBoundingClientRect().height,
  offset => {
    if (telemetryPanels.clientHeight) setSummaryHeight(-offset / telemetryPanels.clientHeight * 100);
  },
  () => save({summaryHeight}),
  () => {
    summaryHeight = null;
    telemetryPanels.style.removeProperty('--summary-height');
    save({summaryHeight});
  });
const summaryDialog = $('summary-fullscreen');
const summaryToggle = $('toggle-summary-fullscreen');
const graphDialog = $('graph-dialog');
graphDialog.addEventListener('close', () => {
  if (graphDialog.ownerDocument !== document) document.body.append(graphDialog);
});
const mergeDialog = $('merge-dialog');
mergeDialog.addEventListener('close', () => {
  if (mergeDialog.ownerDocument !== document) document.body.append(mergeDialog);
});
function closePanelPopout(key) {
  if (lmu.dockPanel) lmu.dockPanel(key).catch(error => message(error.message));
  else popoutWindows.get(key)?.close();
}
function openPanelWindow(key,title) {
  const popup = window.open('about:blank', key, 'popup');
  if (!popup) {
    message('Could not open the ' + title + ' window.');
    return;
  }
  const doc = popup.document;
  doc.title = 'Total Telemetry · ' + title;
  doc.documentElement.lang = 'en-AU';
  doc.documentElement.style.cssText = document.documentElement.style.cssText;
  doc.body.className = 'panel-popout';
  const source = document.querySelector('link[rel="stylesheet"]');
  try {
    const sheet = new popup.CSSStyleSheet({baseURL:source.href});
    sheet.replaceSync(Array.from(source.sheet.cssRules,rule => rule.cssText).join('\n'));
    doc.adoptedStyleSheets = [sheet];
  } catch {
    const stylesheet = doc.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = source.href;
    stylesheet.onload = scheduleRender;
    doc.head.append(stylesheet);
  }
  return popup;
}
function openVisualiser(name) {
  const existing = popoutWindows.get(name);
  if (existing && !existing.closed) { existing.focus(); return; }
  if (settings[visualizerSettings[name]] !== true || !lap) return;
  const panel = $(name);
  const popup = openPanelWindow(name,$(name + '-title').textContent);
  if (!popup) return;
  const home = panel.parentElement;
  popoutWindows.set(name,popup);
  popup.document.body.append(panel);
  panel.hidden = false;
  popup.addEventListener('beforeunload',() => {
    panel.hidden = true;
    home.append(panel);
    popoutWindows.delete(name);
  },{once:true});
  renderVisualiserLaps();
}
function togglePanelPopout(key, panel, title) {
  const existing = popoutWindows.get(key);
  if (existing && !existing.closed) {
    closePanelPopout(key);
    return;
  }
  const popup = openPanelWindow(key,title);
  if (!popup) return;
  const doc = popup.document;
  const link = node('button', 'Focus ' + title, 'popout-link');
  link.id = key + '-popout-link';
  link.type = 'button';
  addButtonIcon(link, 'pop');
  link.onclick = () => popup.focus();
  panel.before(link);
  const button = $('pop-out-' + key);
  const label = button.querySelector('.icon-button-label');
  const originalLabel = label.textContent;
  label.textContent = key === 'graphs' ? 'Dock Telemetry Graphs' : 'Dock Panel';
  let dockGraphs;
  if (key === 'graphs') {
    dockGraphs = node('button', 'Dock Telemetry Graphs', 'button-secondary');
    dockGraphs.id = 'dock-graphs';
    dockGraphs.type = 'button';
    addButtonIcon(dockGraphs, 'pop');
    dockGraphs.onclick = () => closePanelPopout(key);
    panel.prepend(dockGraphs);
  }
  popoutWindows.set(key, popup);
  if (key === 'summary') {
    summaryToggle.hidden = true;
    $('telemetry-divider').hidden = true;
  }
  doc.body.append(panel);
  if (key === 'summary') observeSummaryPlots();
  popup.addEventListener('resize', () => {
    if (key === 'summary') redrawSummaryPlots();
    scheduleRender();
  });
  popup.addEventListener('beforeunload', () => {
    if (graphDialog.ownerDocument === doc) {
      graphDialog.close();
      document.body.append(graphDialog);
    }
    if (mergeDialog.ownerDocument === doc) {
      mergeDialog.close();
      document.body.append(mergeDialog);
    }
    popoutWindows.delete(key);
    dockGraphs?.remove();
    link.replaceWith(panel);
    label.textContent = originalLabel;
    if (key === 'summary') {
      summaryToggle.hidden = false;
      $('telemetry-divider').hidden = false;
      observeSummaryPlots();
    } else if (key === 'graphs') {
      updateActiveLapComparison();
    } else {
      panel.hidden = trackViewButton.getAttribute('aria-pressed') !== 'true';
    }
    scheduleRender();
  }, {once:true});
  scheduleRender();
}
$('pop-out-graphs').onclick = () => togglePanelPopout('graphs', $('telemetry-graphs-panel'), 'Telemetry Graphs');
$('pop-out-track').onclick = () => togglePanelPopout('track', trackPanel, 'Track View');
$('pop-out-summary').onclick = () => {
  if (!summaryDialog.open) togglePanelPopout('summary', summaryPanel, 'Session Summary');
};
summaryToggle.onclick = () => {
  if (summaryDialog.open) {
    summaryDialog.close();
    return;
  }
  summaryDialog.append(summaryPanel);
  summaryToggle.querySelector('.icon-button-label').textContent = 'Exit Full Screen';
  $('pop-out-summary').hidden = true;
  summaryDialog.showModal();
  summaryToggle.focus();
};
summaryDialog.addEventListener('close', () => {
  telemetryPanels.append(summaryPanel);
  summaryToggle.querySelector('.icon-button-label').textContent = 'Full Screen';
  $('pop-out-summary').hidden = false;
  summaryToggle.focus();
});

window.addEventListener('resize', () => {
  if (summaryPanel.ownerDocument === document) redrawSummaryPlots();
  scheduleRender();
});
(async()=>{
  settings=await lmu.settings();
  loadRecordNotifications();
  communityMinimumGameVersion = settings.communityMinimumGameVersion ?? null;
  syncDriverTrainerSetting();
  syncVisualizerSettings();
  if (settings.appVersion) {
    $('app-version').textContent = 'v' + settings.appVersion;
    $('app-version').hidden = false;
  }
  if (Number.isFinite(settings.summaryHeight)) setSummaryHeight(settings.summaryHeight);
  applySidebarWidth(settings.telemetrySidebarWidth);
  applyAppearance();
  enabled=new Set(settings.enabled || builtIn.Driving);
  setupPresets();
  renderRecordNotifications();
  showTrackView(true);
  renderLibrary();
  lmu.onFolderChange(scan);
  if (!settings.telemetry && !settings.results) {
    try {
      if (!settings.telemetryReminderSeen) {
        const reminder = $('first-run-telemetry');
        await new Promise(resolve => {
          reminder.addEventListener('close', resolve, {once:true});
          reminder.showModal();
        });
        await lmu.save({telemetryReminderSeen:true});
        settings.telemetryReminderSeen = true;
      }
      choosingLmuFolder = true;
      try {
        Object.assign(settings, await lmu.folder('first-run-installation'));
      } finally {
        choosingLmuFolder = false;
      }
    } catch (error) {
      setStatus($('status'), error.message, {error:true});
    }
  }
  void scan();
  void checkTprUpdate();
  setInterval(scan,5000);
  setInterval(() => void refreshFriendRecords(),30_000);
  window.addEventListener('online',() => {
    void refreshFriendRecords(true);
    void checkTprUpdate();
  });
})().catch(error=>{setStatus($('status'), error.message, {error:true});});

const trainerTrophies = [
  ['First Clean Run', 'Complete three consecutive clean practice laps.'],
  ['Brake Marker', 'Start braking within a 10 m window at one corner across three clean laps.'],
  ['Clean Getaway', 'Keep post-corner top speeds within 3 km/h across three clean laps.'],
  ['Metronome', 'Complete five consecutive clean laps, each within 1% of their median time.'],
  ['Practice Pays Off', 'Reduce a corner’s braking or exit speed spread by 25% without losing median corner time.'],
];
const trainerCache = new Map();
let trainerCacheLoaded = false;
let trainerStints = [];
let trainerTracks = new Map();
let trainerSelected;
let trainerComparison;
let trainerPickerCurrent;
let trainerTrack;
let trainerFocus = 0;
let trainerCorner;
let trainerScanRun = 0;
let trainerScanSource;
let trainerScanPending = false;

function syncDriverTrainerSetting() {
  const enabled = settings.driverTrainerEnabled === true;
  $('enable-driver-trainer').checked = enabled;
  $('trainer-tab').hidden = !enabled;
  if (!enabled) {
    trainerScanRun++;
    trainerScanSource = undefined;
    $('trainer-scan').hidden = true;
    if (view === 'trainer') setView('library');
  }
}

$('enable-driver-trainer').onchange = event => {
  save({driverTrainerEnabled:event.target.checked});
  syncDriverTrainerSetting();
};
$('trainer-tab').onclick = () => setView('trainer');

function trainerTrackKey(session) { return trainerNormalize(session.trackName || session.track); }
function trainerStintMatch(a, b) {
  return a.condition !== 'unknown' && a.condition !== 'changing' && a.condition === b.condition &&
    ['car', 'track', 'trackLayout', 'driver'].every(key =>
      trainerNormalize(a.session[key]) === trainerNormalize(b.session[key]));
}

function trainerCleanLaps(session) {
  return session.laps.filter(lap => lap.kind === 'complete' && lap.validity === 'official' &&
    Number.isFinite(lap.time) && lap.time > 0 && !lap.pitLaneAtBoundary).sort((a,b) => a.start - b.start);
}

function trainerConsecutive(laps) {
  const runs = [];
  for (const lap of laps) {
    if (!runs.length || !Number.isFinite(lap.number) || lap.number !== runs.at(-1).at(-1).number + 1) runs.push([]);
    runs.at(-1).push(lap);
  }
  return runs;
}

async function readTrainerSession(session, laps) {
  if (!laps.length) return [];
  let points = [], corners = [];
  const dataByLap = new Map();
  try {
    const data = prepare(laps[0], await lmu.lap(session.path, laps[0].id));
    dataByLap.set(laps[0].id, data);
    points = data.useDistance ? route(data) : [];
    if (points.length) {
      corners = routeCorners(data, Math.cos(points[0][1] * Math.PI / 180))
        .map(({start,end}, index) => ({index,start,end,from:data.distanceAt(start),to:data.distanceAt(end)}))
        .filter(({from,to}) => from >= 0 && to > from).slice(0,200);
    }
  } catch { /* Lap timing remains available when GPS or channel data is missing. */ }
  const samples = await lmu.practiceReview(session.path, laps.map(lap => lap.id), corners.map(({from,to}) => [from,to]));
  const samplesById = new Map(samples.map(sample => [sample.id,sample]));
  const stintNumbers = practiceStints(session.laps);
  const finalLaps = new Map(session.laps.filter(lap => stintNumbers.has(lap.id)).map(lap => [stintNumbers.get(lap.id),lap]));
  const groups = new Map();
  for (const lap of laps) {
    const sample = samplesById.get(lap.id) ?? {};
    const number = stintNumbers.get(lap.id);
    const condition = sample.condition ?? 'unknown';
    const key = number + ':' + condition;
    if (!groups.has(key)) groups.set(key, {id:session.path + ':' + key, session, number, condition, points, corners, finalLap:finalLaps.get(number), laps:[]});
    const group = groups.get(key);
    const brakes = [];
    if (corners.length) {
      try {
        const data = dataByLap.get(lap.id) ?? prepare(lap, await lmu.lap(session.path,lap.id));
        for (const {from,to} of corners) {
          const approach = Math.max(data.extent[0], from - 100);
          brakes.push(mainCornerBraking(data, approach, (from + to) / 2, to).brakeOn?.distance);
        }
      } catch { /* Missing pedal traces leave this lap out of the braking sample. */ }
    }
    group.laps.push({...lap, brakes, exits:sample.postCornerSpeeds ?? [], cornerTimes:sample.times ?? []});
  }
  return [...groups.values()].sort((a,b) => b.laps.at(-1).start - a.laps.at(-1).start);
}

const trainerNormalize = value => String(value ?? '').trim().toLowerCase();
function trainerSessionLapCount(session) {
  const count = session.laps.filter(lap => lap.kind === 'complete').length;
  return count + (count === 1 ? ' Lap Driven' : ' Laps Driven');
}

function trainerLabel(stint) {
  return [dateLabel(stint.session.recorded), 'Stint ' + stint.number,
    practiceConditionLabels.get(stint.condition)].filter(Boolean).join(' · ');
}
function trainerValues(stint, focus, offset) {
  return stint.laps.map(lap => focus === 2 ? lap.time : (focus === 0 ? lap.brakes : lap.exits)[offset]);
}

function evaluateTrainerTrophies() {
  const awarded = new Map();
  for (const [key, track] of trainerTracks) awarded.set(key, {name:track.name, earned:new Set(), best:0, streak:0});
  for (const [index, stint] of trainerStints.entries()) {
    const track = awarded.get(trainerTrackKey(stint.session));
    const runs = trainerConsecutive(stint.laps);
    const best = Math.max(0,...runs.map(run => run.length));
    track.best = Math.max(track.best,best);
    if (!track.streakChecked) {
      const finalLap = stint.finalLap;
      track.streak = finalLap?.id === stint.laps.at(-1)?.id ? runs.at(-1)?.length ?? 0 : 0;
      track.streakChecked = true;
    }
    if (best >= 3) track.earned.add(0);
    if (runs.some(run => run.some((_, offset) => {
      const values = run.slice(offset,offset + 5).map(lap => lap.time);
      const {median} = timingStats(values);
      return values.length === 5 && values.every(value => Math.abs(value - median) <= median * .01);
    }))) track.earned.add(3);
    const earlier = trainerStints.slice(index + 1).find(other => other.session.path !== stint.session.path && other.laps.length >= 3 && trainerStintMatch(stint,other));
    for (const [offset, corner] of stint.corners.entries()) {
      const priorOffset = earlier?.corners.findIndex(other => other.index === corner.index && Math.abs(other.from - corner.from) < 50) ?? -1;
      for (const focus of [0,1]) {
        const stats = timingStats(trainerValues(stint,focus,offset));
        if (stats.count >= 3 && stats.spread <= (focus === 0 ? 10 : 3)) track.earned.add(focus + 1);
        if (priorOffset < 0 || stats.count < 3) continue;
        const prior = timingStats(trainerValues(earlier,focus,priorOffset));
        const time = timingStats(stint.laps.map(lap => lap.cornerTimes[offset]));
        const priorTime = timingStats(earlier.laps.map(lap => lap.cornerTimes[priorOffset]));
        if (prior.count >= 3 && prior.spread > 0 && stats.spread <= prior.spread * .75 &&
            time.count >= 3 && priorTime.count >= 3 && time.median <= priorTime.median) track.earned.add(4);
      }
    }
  }
  trainerTracks = awarded;
}

async function scanDriverTrainer(source) {
  if (scanKey === undefined || trainerScanPending || trainerScanSource === source || settings.driverTrainerEnabled !== true) return;
  trainerScanPending = true;
  trainerScanSource = source;
  const run = ++trainerScanRun;
  const recordings = source.filter(session => /^practice/i.test(session.session) && trainerTrackKey(session)).sort((a,b) => b.recorded.localeCompare(a.recorded));
  const meter = $('trainer-progress');
  meter.max = Math.max(1,recordings.length);
  meter.value = 0;
  $('trainer-progress-label').textContent = 'Checking saved practice sessions';
  $('trainer-scan').hidden = !recordings.length;
  renderDriverTrainer();
  const nextTracks = new Map();
  const nextStints = [];
  let failures = 0;
  let dirty = false;
  let checkpoint = Date.now();
  const previousLatest = trainerStints.find(stint => stint.laps.length >= 3);
  const previousByPath = new Map();
  for (const stint of trainerStints) {
    if (!previousByPath.has(stint.session.path)) previousByPath.set(stint.session.path,[]);
    previousByPath.get(stint.session.path).push(stint);
  }
  let published = 0;
  let foundComparison = false;
  let lastPublish = 0;
  let latestHandled = false;
  const publishResults = () => {
    const latest = nextStints.find(stint => stint.laps.length >= 3);
    if (latest && !latestHandled) {
      latestHandled = true;
      if (previousLatest && latest.id !== previousLatest.id && latest.session.recorded >= previousLatest.session.recorded) {
        trainerSelected = undefined;
        trainerCorner = undefined;
      }
    }
    const remaining = recordings.slice(meter.value);
    trainerStints = [...nextStints,...remaining.flatMap(session => previousByPath.get(session.path) ?? [])];
    trainerTracks = new Map(nextTracks);
    for (const session of remaining) trainerTracks.set(trainerTrackKey(session),{name:session.trackName || session.track});
    evaluateTrainerTrophies();
    renderDriverTrainer();
    published = meter.value;
    lastPublish = Date.now();
  };
  const saveCache = async () => {
    if (!dirty) return;
    try {
      await lmu.writeTrainerCache([...trainerCache]);
      dirty = false;
    } catch { /* Analysis remains available in memory if local storage fails. */ }
    checkpoint = Date.now();
  };
  try {
    if (!trainerCacheLoaded) {
      const entries = await lmu.readTrainerCache().catch(() => []);
      for (const entry of entries) {
        if (!Array.isArray(entry)) continue;
        const [recording, cached] = entry;
        if (typeof recording === 'string' && typeof cached?.key === 'string' && Array.isArray(cached.stints)) {
          trainerCache.set(recording,cached);
        }
      }
      trainerCacheLoaded = true;
    }
    const paths = new Set(recordings.map(session => session.path));
    for (const recording of trainerCache.keys()) {
      if (!paths.has(recording)) { trainerCache.delete(recording); dirty = true; }
    }
    for (const [index, session] of recordings.entries()) {
      if (run !== trainerScanRun) return;
      nextTracks.set(trainerTrackKey(session),{name:session.trackName || session.track});
      const laps = trainerCleanLaps(session);
      const key = JSON.stringify([session.recordingStamp, session.recorded, session.laps.map(lap => [lap.id,lap.kind]), laps.map(lap => [lap.id,lap.start,lap.end,lap.time,lap.number])]);
      try {
        let cached = trainerCache.get(session.path);
        if (cached?.key !== key) {
          const stints = await readTrainerSession(session,laps);
          cached = {key,stints:stints.map(({session:recording,...stint}) => stint)};
          trainerCache.set(session.path,cached);
          dirty = true;
        }
        nextStints.push(...cached.stints.map(stint => ({...stint,session})));
      } catch { failures++; }
      meter.value = index + 1;
      $('trainer-progress-label').textContent = meter.value + ' / ' + recordings.length + ' sessions checked';
      if (run !== trainerScanRun) return;
      const first = nextStints.find(stint => stint.laps.length >= 3);
      const comparisonReady = !foundComparison && first && nextStints.some(stint =>
        stint.session.path !== first.session.path && stint.laps.length >= 3 && trainerStintMatch(first,stint));
      if (first && (!published || comparisonReady || Date.now() - lastPublish >= 750)) {
        foundComparison ||= Boolean(comparisonReady);
        publishResults();
      }
      if (Date.now() - checkpoint >= 10000) await saveCache();
    }
    if (run !== trainerScanRun) return;
    $('trainer-scan').hidden = true;
    $('trainer-status').title = failures ? failures + ' practice recordings could not be checked.' : '';
    publishResults();
  } finally {
    await saveCache();
    trainerScanPending = false;
    if (view === 'trainer' && settings.driverTrainerEnabled === true && trainerScanSource !== sessions) void scanDriverTrainer(sessions);
  }
}

function trainerCanvas(canvas) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = devicePixelRatio;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio,ratio);
  return {ctx,width,height};
}

function renderTrainerMap(stint, corner) {
  const canvas = $('trainer-map');
  const surface = trainerCanvas(canvas);
  if (!surface || !stint?.points.length) return;
  const {ctx,width,height} = surface;
  const points = stint.points;
  const correction = Math.cos(points[0][1] * Math.PI / 180);
  const west = Math.min(...points.map(point => point[0])), east = Math.max(...points.map(point => point[0]));
  const south = Math.min(...points.map(point => point[1])), north = Math.max(...points.map(point => point[1]));
  const scale = Math.min((width * .82) / Math.max(.000001,(east - west) * correction),(height * .76) / Math.max(.000001,north - south));
  const xy = ([lon,lat]) => [width / 2 + (lon - (east + west) / 2) * correction * scale,height / 2 - (lat - (north + south) / 2) * scale];
  ctx.strokeStyle = '#809486';
  ctx.lineWidth = 6;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point,index) => index ? ctx.lineTo(...xy(point)) : ctx.moveTo(...xy(point)));
  ctx.stroke();
  if (!corner) return;
  const point = points[lowerBound(points.map(point => point[2]), (corner.start + corner.end) / 2)] ?? points.at(-1);
  ctx.fillStyle = elementColour('accent','#c5fa78');
  ctx.beginPath();
  ctx.arc(...xy(point),8,0,Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#19221c';
  ctx.stroke();
}

let trainerHover;
const trainerPlot = $('trainer-plot');
const trainerHoverReading = $('trainer-hover-reading');
const trainerHoverGuide = $('trainer-hover-guide');
function hideTrainerHover() {
  trainerHoverGuide.hidden = true;
  trainerHoverReading.hidden = true;
}
let trainerPointer;
trainerPlot.addEventListener('pointerleave',() => {
  trainerPointer = undefined;
  hideTrainerHover();
});
trainerPlot.addEventListener('pointermove',event => {
  trainerPointer = {clientX:event.clientX,clientY:event.clientY};
  updateTrainerHover(trainerPointer);
});
function updateTrainerHover(event) {
  if (!trainerHover || !event || document.elementFromPoint(event.clientX,event.clientY) !== trainerPlot) {
    hideTrainerHover();
    return;
  }
  const bounds = trainerPlot.getBoundingClientRect();
  const px = event.clientX - bounds.left, py = event.clientY - bounds.top;
  const {left,right,top,bottom,reading} = trainerHover;
  if (px < left || px > right || py < top || py > bottom) { hideTrainerHover(); return; }
  const hit = reading(px,py);
  if (!hit) { hideTrainerHover(); return; }
  trainerHoverReading.replaceChildren(...hit.values.map(({text,colour,dotted,label}) => {
    const badge = node('span', text, 'trainer-hover-value');
    badge.style.setProperty('--reading-colour',colour);
    badge.classList.toggle('dotted',dotted);
    badge.setAttribute('aria-label',label + ' ' + text);
    return badge;
  }));
  trainerHoverReading.hidden = false;
  const size = trainerHoverReading.getBoundingClientRect();
  trainerHoverReading.style.left = Math.max(4,Math.min(event.clientX + 14,innerWidth - size.width - 4)) + 'px';
  trainerHoverReading.style.top = Math.max(4,Math.min(event.clientY + 14,innerHeight - size.height - 4)) + 'px';
  trainerHoverGuide.style.left = bounds.left + hit.x + 'px';
  trainerHoverGuide.style.top = bounds.top + top + 'px';
  trainerHoverGuide.style.height = bottom - top + 'px';
  trainerHoverGuide.hidden = false;
}

function trainerTraceValue(points, distances, distance) {
  const index = lowerBound(distances,distance);
  if (distances[index] === distance) return points[index][1];
  if (!index || index === points.length) return undefined;
  const [from,start] = points[index - 1], [to,end] = points[index];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return start + (end - start) * (distance - from) / (to - from);
}

let trainerTrace;
let trainerComparisonTrace;
async function loadTrainerTraces(stint, laps, isCurrent) {
  const results = [];
  for (let offset = 0; offset < laps.length && isCurrent(); offset += 3) {
    const batch = await Promise.allSettled(laps.slice(offset,offset + 3)
      .map(async lap => prepare(lap,await lmu.lap(stint.session.path,lap.id))));
    results.push(...batch.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
  }
  return results;
}
function trainerBrakingStart(lap, corner) {
  const approach = Math.max(lap.extent[0], corner.from - 100);
  const {brakeOn} = mainCornerBraking(lap, approach, (corner.from + corner.to) / 2, corner.to);
  if (brakeOn !== null) return brakeOn?.distance;

  // The main brake application was already active at the approach boundary.
  return cornerPedalCrossings(lap, 'Brake Pos', lap.extent[0], approach, 5, true).at(-1)?.distance
    ?? lap.extent[0];
}

function renderTrainerCornerTrace(stint, corner, cornerOffset, comparison, comparisonOffset, comparisonLabel = 'Previous Session') {
  const canvas = $('trainer-plot');
  const surface = trainerCanvas(canvas);
  if (!surface) return;
  const focus = trainerFocus;
  const braking = focus === 0;
  const channelName = braking ? 'Brake Pos' : 'Ground Speed';
  const unit = braking ? '%' : displayUnit('','km/h');
  const axis = telemetryName(channelName, braking ? 'Brake pedal' : 'Ground speed') + ' · ' + unit;
  $('trainer-chart-legend').hidden = true;
  if (!corner) {
    canvas.setAttribute('aria-label','Corner trace unavailable');
    return;
  }
  const byTime = stint.laps.filter(lap => Number.isFinite(lap.cornerTimes[cornerOffset]))
    .sort((a,b) => a.cornerTimes[cornerOffset] - b.cornerTimes[cornerOffset]);
  const fastest = byTime[0];
  const laps = fastest ? [fastest,...stint.laps.filter(lap => lap !== fastest)] : stint.laps;
  const key = JSON.stringify([stint.id,stint.session.recordingStamp,focus,corner.from,corner.to,
    laps.map(lap => [lap.id,lap.start,lap.end])]);
  if (trainerTrace?.key !== key) {
    const request = {key};
    trainerTrace = request;
    void loadTrainerTraces(stint,laps,() => trainerTrace === request).then(results => {
      request.data = results;
      if (trainerTrace === request) renderDriverTrainer();
    });
  }
  const {ctx,width,height} = surface;
  const data = trainerTrace.data?.filter(lap => lap.useDistance && lap.channels[channelName]?.times.length);
  if (!data?.length) {
    const message = !laps.length ? 'No laps remain after excluding cold tyres' : trainerTrace.data ? 'Corner trace unavailable' : 'Loading corner traces…';
    canvas.setAttribute('aria-label',message);
    ctx.fillStyle = elementColour('graph-axis','#b7c8b9');
    ctx.font = '13px system-ui';
    ctx.fillText(message,12,height / 2);
    return;
  }
  const comparisonLegend = $('trainer-comparison-legend');
  comparisonLegend.hidden = true;
  let previousData = [];
  let loadingComparison = false;
  const showComparison = $('trainer-show-comparison').checked;
  // Use the same bounds for both stints, even when the comparison is hidden.
  if (comparison) {
    const comparisonKey = JSON.stringify([comparison.id,comparison.session.recordingStamp,
      comparison.laps.map(lap => [lap.id,lap.start,lap.end])]);
    if (trainerComparisonTrace?.key !== comparisonKey) {
      const request = {key:comparisonKey};
      trainerComparisonTrace = request;
      void loadTrainerTraces(comparison,comparison.laps,() => trainerComparisonTrace === request).then(results => {
        request.data = results;
        if (trainerComparisonTrace === request) renderDriverTrainer();
      });
    }
    loadingComparison = !trainerComparisonTrace.data;
    previousData = trainerComparisonTrace.data?.filter(lap => lap.useDistance && lap.channels[channelName]?.times.length) ?? [];
  }
  const brakingPoints = braking ? [...data,...previousData]
    .map(lap => trainerBrakingStart(lap,corner)).filter(Number.isFinite) : [];
  const start = Math.max(...data.map(lap => lap.extent[0]), braking ? Math.min(corner.from,...brakingPoints) - 35 : corner.from);
  const nextBrakingPoints = braking ? [] : [...data,...previousData]
    .map(lap => nextBrakeAfterCorner(lap,corner.to)?.distance).filter(Number.isFinite);
  const exitEnd = nextBrakingPoints.length ? Math.max(...nextBrakingPoints) + 35 : corner.to + 100;
  const end = Math.min(...data.map(lap => lap.extent[1]), braking ? corner.to + 20 : exitEnd);
  if (!(end > start)) return;
  const readTrace = lap => {
    const first = lap.timeAt(start), last = lap.timeAt(end);
    const channel = lap.channels[channelName];
    const points = [];
    for (const [index,time] of channel.times.entries()) {
      if (time < first) continue;
      if (time > last) break;
      const distance = lap.distanceAt(time);
      if (distance >= start && distance <= end) points.push([distance,convert(channelName,channel.rows[index][0],channel.unit)]);
    }
    return points;
  };
  const traces = data.map(readTrace);
  const previousTraces = previousData.map(readTrace);
  const previousCount = previousTraces.filter(points => points.some(([,value]) => Number.isFinite(value))).length;
  const readings = [...traces,...previousTraces].flatMap(points => points.map(([,value]) => value)).filter(Number.isFinite);
  if (!readings.length) return;
  $('trainer-chart-legend').hidden = false;
  const painted = data.filter((lap,index) => traces[index].some(([,value]) => Number.isFinite(value)));
  const fastestIndex = data.findIndex(lap => lap.lap.id === fastest?.id && painted.includes(lap));
  $('trainer-current-legend').hidden = fastestIndex < 0;
  const previousFastest = comparison?.laps.filter(lap => Number.isFinite(lap.cornerTimes[comparisonOffset]))
    .sort((a,b) => a.cornerTimes[comparisonOffset] - b.cornerTimes[comparisonOffset])[0];
  const previousFastestIndex = showComparison ? previousData.findIndex((lap,index) =>
    lap.lap.id === previousFastest?.id && previousTraces[index].some(([,value]) => Number.isFinite(value))) : -1;
  const previousLegend = $('trainer-previous-legend');
  previousLegend.hidden = previousFastestIndex < 0;
  if (previousFastestIndex >= 0) {
    previousLegend.textContent = 'Lap ' + (previousFastest.number ?? previousFastest.id) + ' · ' + comparisonLabel + ' Fastest Corner Lap';
  }
  const otherCount = painted.length - Number(fastestIndex >= 0);
  $('trainer-other-legend').hidden = !otherCount;
  $('trainer-other-legend').textContent = otherCount + (otherCount === 1 ? ' other lap' : ' other laps');
  const otherPreviousCount = previousCount - Number(previousFastestIndex >= 0);
  comparisonLegend.hidden = !showComparison || (!loadingComparison && !otherPreviousCount);
  comparisonLegend.textContent = loadingComparison ? 'Loading ' + comparisonLabel + ' Traces…' :
    comparisonLabel + ' · ' + otherPreviousCount + (previousFastestIndex >= 0 ? ' other' : '') +
    (otherPreviousCount === 1 ? ' lap' : ' laps');
  $('trainer-plot-axis').textContent = axis;
  if (fastest) $('trainer-current-legend').textContent = 'Lap ' + (fastest.number ?? fastest.id) + ' · Fastest corner lap';
  canvas.setAttribute('aria-label',axis + ' versus distance · ' + painted.length + ' shown out of ' + stint.laps.length + ' clean laps');
  const min = braking ? 0 : Math.floor(Math.min(...readings) / 10) * 10;
  const max = braking ? 100 : Math.max(min + 10,Math.ceil(Math.max(...readings) / 10) * 10);
  const assist = braking ? 'ABS' : 'TC';
  const assistEnabled = $(braking ? 'trainer-show-abs' : 'trainer-show-tc').checked;
  const highlights = [
    {trace:data[fastestIndex], points:traces[fastestIndex], colour:elementColour('accent','#c5fa78'),
      dotted:false, label:'Current session fastest corner lap'},
    {trace:previousData[previousFastestIndex], points:previousTraces[previousFastestIndex],
      colour:elementColour('reference','#f5a982'), dotted:true, label:comparisonLabel + ' Fastest Corner Lap'}
  ].filter(({trace}) => trace);
  const assistOverlays = assistEnabled ? highlights.flatMap(({trace,points,label}) => {
    if (!trace.channels[assist]?.rows?.length) return [];
    const intervals = [...activationIntervals(trace,assist,true)]
      .map(([from,to]) => [Math.max(start,trace.distanceAt(from)),Math.min(end,trace.distanceAt(to))])
      .filter(([from,to]) => to > from);
    return [{lap:trace.lap,intervals,points,label}];
  }) : [];
  const left = 62, right = width - 18, top = 10, bottom = height - 25;
  const x = distance => left + (right - left) * (distance - start) / (end - start);
  const y = value => bottom - (bottom - top) * (value - min) / (max - min);
  const hoverTraces = highlights.map(trace => ({...trace,distances:trace.points.map(([distance]) => distance)}));
  trainerHover = {left,right,top,bottom,reading(px) {
    const distance = start + (end - start) * (px - left) / (right - left);
    const values = hoverTraces.flatMap(({trace,points,distances,colour,dotted,label}) => {
      const channel = trace.channels['Ground Speed'];
      const time = trace.timeAt(distance);
      const speed = !braking ? trainerTraceValue(points,distances,distance) :
        time >= channel?.times[0] && time <= channel.times.at(-1) ?
          convert('Ground Speed',sample(channel,time)?.[0],channel.unit) : undefined;
      return Number.isFinite(speed) ? [{
        text:number(speed,telemetryDecimalPlaces('Ground Speed')) + ' ' + displayUnit('','km/h'),
        colour,dotted,label
      }] : [];
    });
    return values.length ? {x:px,values} : null;
  }};
  ctx.font = '12px system-ui';
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4;
    ctx.textAlign = 'right';
    ctx.fillStyle = elementColour('graph-axis','#b7c8b9');
    ctx.fillText(number(value,0) + ' ' + unit,left - 7,y(value) + 4);
    ctx.strokeStyle = elementColour('graph-grid','#354438');
    ctx.beginPath(); ctx.moveTo(left,y(value)); ctx.lineTo(right,y(value)); ctx.stroke();
    ctx.textAlign = 'center';
    paintHorizontalTick(ctx,measurement((end - start) * i / 4,'m',0),left + (right - left) * i / 4,height - 8,width);
  }
  const drawTrace = (points,colour,alpha,lineWidth,dotted = false) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dotted ? [6,4] : []);
    ctx.beginPath();
    let connected = false;
    for (const [distance,value] of points) {
      if (!Number.isFinite(value)) { connected = false; continue; }
      if (connected) ctx.lineTo(x(distance),y(value));
      else ctx.moveTo(x(distance),y(value));
      connected = true;
    }
    ctx.stroke();
  };
  if (showComparison) for (const [index,points] of previousTraces.entries()) {
    if (index !== previousFastestIndex) drawTrace(points,elementColour('prior-stint','#e0787d'),.35,1.5);
  }
  for (const [index,points] of traces.entries()) {
    if (index !== fastestIndex) drawTrace(points,elementColour('other-laps','#90ac98'),.45,1.5);
  }
  for (const {points,colour,dotted} of highlights) drawTrace(points,colour,1,2.5,dotted);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = elementColour(assist.toLowerCase(),assist === 'ABS' ? '#ff626c' : '#45d4df');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (const overlay of assistOverlays) {
    const distances = overlay.points.map(([distance]) => distance);
    let visible = false;
    ctx.beginPath();
    for (const [from,to] of overlay.intervals) {
      for (let i = Math.max(1,lowerBound(distances,from)); i < distances.length && distances[i - 1] < to; i++) {
        const [startDistance,startValue] = overlay.points[i - 1];
        const [endDistance,endValue] = overlay.points[i];
        if (endDistance <= startDistance || !Number.isFinite(startValue) || !Number.isFinite(endValue)) continue;
        const segmentStart = Math.max(from,startDistance), segmentEnd = Math.min(to,endDistance);
        if (segmentEnd <= segmentStart) continue;
        const valueAt = distance => startValue + (endValue - startValue) * (distance - startDistance) / (endDistance - startDistance);
        ctx.moveTo(x(segmentStart),y(valueAt(segmentStart)));
        ctx.lineTo(x(segmentEnd),y(valueAt(segmentEnd)));
        visible = true;
      }
    }
    ctx.stroke();
    overlay.visible = visible;
  }
  if (assistOverlays.length) {
    canvas.setAttribute('aria-label',canvas.getAttribute('aria-label') + ' · ' + assistOverlays.map(overlay =>
      assist + ' on ' + overlay.label.toLowerCase() + ' ' + (overlay.lap.number ?? overlay.lap.id) +
      (overlay.visible ? '' : ' (no activation in view)')).join(' · '));
  }
}

function trainerTyresAreCold(temperature) {
  return Number.isFinite(temperature) && temperature < (settings.trainerColdTyreTemperature ?? 60);
}

function trainerExcludeColdLaps(stint) {
  if (!stint) return undefined;
  const temperatures = stint.session.sessionSummary?.peakTemperaturesByLap?.tyres;
  return {...stint,laps:stint.laps.filter(lap => !trainerTyresAreCold(temperatures?.[lap.id]))};
}

function trainerCompletedLaps(session) {
  if (!session) return [];
  const temperatures = session.sessionSummary?.peakTemperaturesByLap?.tyres;
  return session.laps.filter(lap => lap.kind === 'complete')
    .map(lap => ({
      number:lap.number,
      time:Number.isFinite(lap.time) && lap.time > 0 ? lap.time : lap.end - lap.start,
      start:lap.start,
      temperature:temperatures?.[lap.id]
    }))
    .filter(lap => Number.isFinite(lap.time) && lap.time > 0)
    .sort((a,b) => a.start - b.start);
}

const trainerColdThreshold = $('trainer-cold-threshold');
trainerColdThreshold.onchange = () => {
  if (Number.isFinite(trainerColdThreshold.valueAsNumber) && trainerColdThreshold.validity.valid) {
    save({trainerColdTyreTemperature:temperatureSettingValue(trainerColdThreshold.valueAsNumber)});
  }
  trainerColdThreshold.value = temperatureInputValue(settings.trainerColdTyreTemperature ?? 60);
  renderDriverTrainer();
};

function renderTrainerLapTimes(values, prior, manualComparison) {
  const isCold = lap => trainerTyresAreCold(lap.temperature);
  const unit = 's';
  const canvas = $('trainer-plot');
  const surface = trainerCanvas(canvas);
  if (!surface) return;
  const {ctx,width,height} = surface;
  canvas.setAttribute('aria-label','Per-lap values in ' + unit + (prior.length ? ', with the matching comparison session' : ''));
  const measured = [...values,...prior].map(lap => lap.time);
  $('trainer-chart-legend').hidden = !measured.length;
  $('trainer-plot-axis').textContent = 'Completed Lap in Session';
  $('trainer-cold-legend').hidden = ![...values,...prior].some(isCold);
  $('trainer-other-legend').hidden = true;
  $('trainer-comparison-legend').hidden = true;
  $('trainer-current-legend').textContent = 'Current Session';
  $('trainer-previous-legend').textContent = manualComparison ? 'Comparison Session' : 'Previous Session';
  $('trainer-current-legend').hidden = !values.length;
  if (!measured.length) return;
  const max = Math.max(...measured);
  const span = Math.max(max - Math.min(...measured),.001);
  const min = max - span;
  const left = 64, bottom = height - 25;
  ctx.font = '12px system-ui';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = 9 + i * (bottom - 9) / 4;
    ctx.strokeStyle = elementColour('graph-grid','#354438');
    ctx.beginPath(); ctx.moveTo(left,y); ctx.lineTo(width - 10,y); ctx.stroke();
    ctx.fillStyle = elementColour('graph-axis','#b7c8b9');
    ctx.fillText(number(max - span * i / 4,unit === 's' ? 3 : 1) + ' ' + unit,left - 7,y + 4);
  }
  const step = (width - left - 12) / Math.max(values.length,prior.length);
  trainerHover = {left,right:width - 12,top:9,bottom,reading(px) {
    const index = Math.min(Math.max(values.length,prior.length) - 1,Math.floor((px - left) / step));
    const readings = [[values[index],false],[prior[index],true]].flatMap(([lap,previous]) => {
      if (!lap) return [];
      return [{
        text:lapTime(lap.time),
        colour:isCold(lap) ? elementColour('cold','#91d5ff') : previous ? elementColour('reference','#f5a982') : elementColour('accent','#c5fa78'),
        dotted:previous,
        label:previous ? (manualComparison ? 'Comparison Session' : 'Previous Session') : 'Current Session'
      }];
    });
    return readings.length ? {x:left + step * (index + .5),values:readings} : null;
  }};
  $('trainer-previous-legend').hidden = !prior.length;
  ctx.textAlign = 'center';
  ctx.fillStyle = elementColour('graph-axis','#b7c8b9');
  const count = Math.max(values.length,prior.length);
  const labelStride = Math.max(1,Math.ceil(40 / step));
  for (let i = 0; i < count; i += labelStride) {
    ctx.fillText(String(i + 1),left + step * (i + .5),bottom + 16);
  }
  for (const [row,color,dash] of [[values,elementColour('accent','#c5fa78'),[]],[prior,elementColour('reference','#f5a982'),[7,5]]]) {
    ctx.lineWidth = 2.5;
    ctx.setLineDash(dash);
    const points = row.map((lap,index) => ({
      x:left + step * (index + .5),
      y:bottom - (lap.time - min) * (bottom - 9) / span,
      colour:isCold(lap) ? elementColour('cold','#91d5ff') : color
    }));
    if (points.length === 1) {
      const [point] = points;
      ctx.fillStyle = point.colour;
      ctx.beginPath(); ctx.arc(point.x,point.y,3,0,Math.PI * 2); ctx.fill();
    }
    for (let start = 0; start < points.length - 1;) {
      const first = points[start];
      ctx.strokeStyle = first.colour;
      ctx.beginPath();
      ctx.moveTo(first.x,first.y);
      let end = start + 1;
      while (end < points.length && points[end].colour === first.colour) {
        ctx.lineTo(points[end].x,points[end].y);
        end++;
      }
      if (end < points.length) {
        const before = points[end - 1], after = points[end];
        const x = (before.x + after.x) / 2, y = (before.y + after.y) / 2;
        ctx.lineTo(x,y);
        ctx.stroke();
        ctx.strokeStyle = after.colour;
        ctx.beginPath();
        ctx.moveTo(x,y);
        ctx.lineTo(after.x,after.y);
      }
      ctx.stroke();
      start = end;
    }
    ctx.setLineDash([]);
  }
}

function renderTrainerTrophies() {
  const earned = [...trainerTracks.values()].reduce((sum,track) => sum + track.earned.size,0);
  const total = trainerTracks.size * trainerTrophies.length;
  $('trainer-awards').textContent = earned;
  $('trainer-unlocked').textContent = total;
  for (const id of ['trainer-awards-meter','trainer-completion-meter']) {
    $(id).max = total || 1;
    $(id).value = earned;
  }
  $('trainer-trophy-progress').textContent = earned + ' of ' + total + ' unlocked trophies earned';
  $('trainer-percent').textContent = (total ? Math.round(100 * earned / total) : 0) + '%';
  trainerTrack = trainerTracks.has(trainerTrack) ? trainerTrack : trainerTracks.keys().next().value;
  const detail = trainerTracks.get(trainerTrack);
  $('trainer-trophy-track').textContent = detail?.name ?? '';
  $('trainer-streak').textContent = detail ? 'Clean Lap Streak · Current ' + detail.streak + ' · Best ' + detail.best : '';
  $('trainer-trophy-cards').replaceChildren(...trainerTrophies.map(([name, description], index) => {
    const awarded = detail?.earned.has(index);
    const card = node('article',undefined,awarded ? 'earned' : '');
    const emblem = node('div',undefined,'trainer-trophy-emblem');
    emblem.setAttribute('aria-hidden','true');
    emblem.append(trophyIcon());
    card.append(emblem,node('strong',name,'trainer-trophy-title'),node('p',description
      .replace('10 m',measurement(10,'m',usingImperial('distance') ? 1 : 0))
      .replace('3 km/h',measurement(3,'km/h',usingImperial('speed') ? 2 : 0))),
      node('small',awarded ? 'Awarded' : detail ? 'Available' : 'Visit a track in Practice to unlock','trainer-trophy-state'));
    return card;
  }));
  $('trainer-tracks').replaceChildren(...[...trainerTracks].map(([key,track]) => {
    const button = node('button');
    button.type = 'button';
    button.append(node('span', track.name, 'trainer-track-name'),
      node('span', track.earned.size + '/' + trainerTrophies.length, 'trainer-track-count'));
    button.title = track.name;
    button.setAttribute('aria-pressed',key === trainerTrack);
    button.onclick = () => { trainerTrack = key; renderTrainerTrophies(); $('trainer-tracks').querySelector('[aria-pressed=true]')?.focus(); };
    return button;
  }));
}

function renderDriverTrainer() {
  if (view !== 'trainer') return;
  trainerHover = undefined;
  hideTrainerHover();
  const eligible = trainerStints.filter(stint => stint.laps.length >= 3);
  const selection = eligible.findIndex(stint => stint.id === trainerSelected);
  const stint = eligible[Math.max(0,selection)];
  const compatible = stint ? eligible.filter(other =>
    other.session.path !== stint.session.path && trainerStintMatch(stint,other)) : [];
  const manual = stint && trainerComparison?.current === stint.id && compatible.find(other => other.id === trainerComparison.reference);
  const earlier = manual || compatible.find(other => eligible.indexOf(other) > Math.max(0,selection));
  $('trainer-choose').disabled = !eligible.length;
  $('trainer-choose-reference').disabled = !compatible.length;
  $('trainer-choose-reference').onclick = () => {
    trainerPickerCurrent = stint.id;
    openTrainerSessionPicker('Choose Comparison Session',compatible,manual?.id,true);
  };
  $('trainer-combo').textContent = stint ? [stint.session.track,stint.session.car,practiceConditionLabels.get(stint.condition)].filter(Boolean).join(' · ') : '';
  $('trainer-current').textContent = stint ? trainerLabel(stint) : 'No eligible practice stint';
  $('trainer-current-laps').textContent = stint ? trainerSessionLapCount(stint.session) : '';
  $('trainer-reference-laps').textContent = earlier ? trainerSessionLapCount(earlier.session) : '';
  $('trainer-reference').textContent = earlier ? trainerLabel(earlier) : !$('trainer-scan').hidden ? 'Looking for an earlier compatible stint…' : 'No earlier compatible stint';
  $('trainer-status').textContent = stint ? '' : !$('trainer-scan').hidden ? 'Looking for your latest eligible practice stint…' : 'Complete three clean, timed Practice laps in one stint to get started.';
  $('trainer-analysis').hidden = !stint;
  renderTrainerTrophies();
  if (!stint) { renderTrainerMap(); return; }
  const lapTimes = trainerFocus === 2;
  const cornerStint = lapTimes ? undefined : trainerExcludeColdLaps(stint);
  const cornerComparison = lapTimes ? undefined : trainerExcludeColdLaps(earlier);
  const ranked = (cornerStint?.corners ?? []).map((corner,offset) =>
    ({corner,offset,stats:timingStats(trainerValues(cornerStint,trainerFocus,offset))}))
    .sort((a,b) => {
      const priority = item => item.stats.count >= 3 ? item.stats.spread : -1;
      return priority(b) - priority(a) || a.corner.index - b.corner.index;
    });
  const chosen = trainerFocus === 2 ? undefined : ranked.find(item => item.corner.index === trainerCorner) ?? ranked[0];
  const completed = lapTimes ? trainerCompletedLaps(stint.session) : [];
  const comparisonCompleted = lapTimes ? trainerCompletedLaps(earlier?.session) : [];
  const values = lapTimes ? completed.map(lap => lap.time) :
    chosen ? trainerValues(cornerStint,trainerFocus,chosen.offset) : [];
  const priorOffset = chosen && earlier?.corners.findIndex(corner => corner.index === chosen.corner.index && Math.abs(corner.from - chosen.corner.from) < 50);
  const prior = !earlier ? [] : lapTimes ? comparisonCompleted.map(lap => lap.time) :
    priorOffset >= 0 ? trainerValues(cornerComparison,trainerFocus,priorOffset) : [];
  const stats = timingStats(values), previous = timingStats(prior);
  const unit = ['m','km/h','s'][trainerFocus];
  const spreadReading = (value,digits) => measurement(value,unit,digits) + ' spread';

  const headings = ['Brake at a repeatable point','Make your corner exits consistent','Consistent Lap Times'];
  $('trainer-metric').textContent = headings[trainerFocus];
  $('trainer-corner-controls').hidden = !chosen;
  $('trainer-corner-label').textContent = chosen ? 'Corner ' + (chosen.corner.index + 1) : '';
  if (chosen) {
    const position = ranked.indexOf(chosen);
    for (const [id,step] of [['trainer-prev-corner',-1],['trainer-next-corner',1]]) {
      const button = $(id);
      button.disabled = ranked.length < 2;
      button.onclick = () => {
        trainerCorner = ranked[(position + step + ranked.length) % ranked.length].corner.index;
        renderDriverTrainer();
      };
    }
  }
  $('trainer-spread').textContent = stats.count >= 3 ? spreadReading(stats.spread,trainerFocus === 2 ? 3 : 1) : '—';
  const lapCount = count => count + (count === 1 ? ' lap' : ' laps') + ' counted';
  const comparisonLabel = manual ? 'Comparison Session' : 'Previous Session';
  $('trainer-evidence').textContent = 'Current Session: ' + lapCount(stats.count) +
    (earlier ? ' · ' + comparisonLabel + ': ' + lapCount(previous.count) : '');
  const priority = $('trainer-priorities');
  priority.hidden = trainerFocus === 2 || !ranked.length;
  $('trainer-priority-label').hidden = priority.hidden;
  priority.replaceChildren(...(trainerFocus === 2 ? [] : ranked.map(({corner,stats:spread}) => {
    const button = node('button');
    const cornerNumber = String(corner.index + 1);
    const detail = spread.count >= 3 ? spreadReading(spread.spread,1) : 'Insufficient data';
    button.title = detail;
    button.setAttribute('aria-label','Corner ' + cornerNumber);
    button.setAttribute('aria-description',detail);
    button.append(node('span','Corner ','trainer-corner-prefix'),cornerNumber,node('small',detail));
    button.setAttribute('aria-pressed',String(corner === chosen?.corner));
    button.onclick = () => { trainerCorner = corner.index; renderDriverTrainer(); priority.querySelector('[aria-pressed=true]')?.focus(); };
    return button;
  })));
  $('trainer-abs-control').hidden = trainerFocus !== 0 || !chosen;
  $('trainer-tc-control').hidden = trainerFocus !== 1 || !chosen;
  $('trainer-comparison-control').hidden = lapTimes || !chosen;
  $('trainer-comparison-label').textContent = manual ? 'Comparison Traces' : 'Previous Session Traces';
  $('trainer-show-comparison').disabled = !(earlier && priorOffset >= 0);
  $('trainer-cold-control').hidden = false;
  $('trainer-cold-label').textContent = 'Temperature at Which Tyres Are Considered Cold' + (lapTimes ? '' : ' (Exclude Laps)');
  $('trainer-cold-legend').hidden = true;
  if (document.activeElement !== trainerColdThreshold) trainerColdThreshold.value = temperatureInputValue(settings.trainerColdTyreTemperature ?? 60);
  if (lapTimes) renderTrainerLapTimes(completed,comparisonCompleted,Boolean(manual));
  else renderTrainerCornerTrace(cornerStint,chosen?.corner,chosen?.offset,priorOffset >= 0 ? cornerComparison : undefined,priorOffset,comparisonLabel);
  renderTrainerMap(stint,chosen?.corner);
  updateTrainerHover(trainerPointer);
}

$('trainer-show-abs').onchange = renderDriverTrainer;
$('trainer-show-tc').onchange = renderDriverTrainer;
$('trainer-show-comparison').onchange = renderDriverTrainer;

$('trainer-focus').onclick = event => {
  const button = event.target.closest('[data-focus]');
  if (!button) return;
  trainerFocus = Number(button.dataset.focus);
  trainerCorner = undefined;
  for (const candidate of $('trainer-focus').children) candidate.setAttribute('aria-pressed',String(candidate === button));
  renderDriverTrainer();
};
function openTrainerSessionPicker(title, options, selectedId, comparison = false) {
  const choice = $('trainer-session-choice');
  $('trainer-session-heading').textContent = title;
  choice.replaceChildren(...options.map(stint => new Option([
    stint.session.track, stint.session.car, trainerLabel(stint), trainerSessionLapCount(stint.session)
  ].filter(Boolean).join(' · '),stint.id)));
  if (comparison) choice.prepend(new Option('Automatic · Latest earlier matching session',''));
  if (selectedId && options.some(stint => stint.id === selectedId)) choice.value = selectedId;
  $('trainer-session-dialog').returnValue = '';
  $('trainer-session-dialog').showModal();
}
$('trainer-choose').onclick = () => {
  trainerPickerCurrent = undefined;
  openTrainerSessionPicker('Choose a Different Session',trainerStints.filter(stint => stint.laps.length >= 3),trainerSelected);
};
$('trainer-session-dialog').onclose = event => {
  if (event.target.returnValue !== 'load') return;
  const choice = $('trainer-session-choice').value;
  if (trainerPickerCurrent) {
    trainerComparison = choice ? {current:trainerPickerCurrent,reference:choice} : undefined;
  } else {
    trainerSelected = choice;
    trainerComparison = undefined;
    trainerCorner = undefined;
  }
  renderDriverTrainer();
};
$('trainer-trophies').onclick = () => { renderTrainerTrophies(); $('trainer-trophy-dialog').showModal(); };
const trainerResize = new ResizeObserver(() => { if (view === 'trainer') renderDriverTrainer(); });
trainerResize.observe($('trainer-map'));
trainerResize.observe($('trainer-plot'));
