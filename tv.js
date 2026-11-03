import {
  makeCode, isValidCode, peerIdFor, formatTime,
  reduce, initialQueue, sanitizeVideo,
  APPS, applyAppConfig, visibleApps, moveFocus, STATIONS, stationById, YT_ROWS, thumbFor, launchTarget,
} from './logic.js';

const $ = (sel) => document.querySelector(sel);
const tv = $('#tv');
const el = {
  boot: $('#boot'), home: $('#home'),
  clock: $('#clock'), date: $('#date'), bigClock: $('#bigClock'), bigDate: $('#bigDate'),
  code: $('#code'), idleLead: $('#idleLead'), idleHint: $('#idleHint'), qr: $('#qr'),
  shelfApp: $('#shelfApp'), shelfCard: $('#shelfCard'), shelfKicker: $('#shelfKicker'), shelfTitle: $('#shelfTitle'), shelfText: $('#shelfText'), shelfNow: $('#shelfNow'),
  apps: $('#apps'),
  appScreens: { youtube: $('#appYoutube'), twitch: $('#appTwitch'), radio: $('#appRadio'), clock: $('#appClock') },
  ytBrowse: $('#ytBrowse'), ytRows: $('#ytRows'), ytHint: $('#ytHint'), twEmpty: $('#twEmpty'), twChip: $('#twChip'), twChipText: $('#twChipText'),
  radioNow: $('#radioNow'), stations: $('#stations'), radioChip: $('#radioChip'), radioChipText: $('#radioChipText'),
  status: $('#status'), statusText: $('#statusText'),
  now: $('#now'), nowThumb: $('#nowThumb'), nowTitle: $('#nowTitle'), nowChannel: $('#nowChannel'),
  nowFill: $('#nowFill'), nowPos: $('#nowPos'), nowDur: $('#nowDur'), nowNext: $('#nowNext'), nowNextTitle: $('#nowNextTitle'),
  osdCenter: $('#osdCenter'), osdCenterIcon: $('#osdCenterIcon'), osdCenterLabel: $('#osdCenterLabel'),
  osdVolume: $('#osdVolume'), osdVolIcon: $('#osdVolIcon'), osdVolFill: $('#osdVolFill'), osdVolLabel: $('#osdVolLabel'),
  queuePanel: $('#queuePanel'), queueList: $('#queueList'),
  tapToPlay: $('#tapToPlay'), tapTitle: $('#tapTitle'),
  ambientArt: $('#ambientArt'), toast: $('#toast'),
};

// iPadOS reports itself as a Mac; touch points tell it apart. Volume is hardware-only there.
const IS_IOS = /iP(ad|hone|od)/.test(navigator.platform)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const TILES = {
  youtube: { bg: 'linear-gradient(160deg, #ffffff, #e6e6ea)', fg: '#ff0000' },
  twitch: { bg: 'linear-gradient(160deg, #a970ff, #6d28d9)', fg: '#ffffff' },
  radio: { bg: 'linear-gradient(160deg, #1fb3a3, #0b4f49)', fg: '#ffffff' },
  clock: { bg: 'linear-gradient(160deg, #3b36a8, #1b1850)', fg: '#f3efe6' },
  netflix: { bg: 'linear-gradient(160deg, #1c1c1c, #000000)', fg: '#e50914' },
  prime: { bg: 'linear-gradient(160deg, #1f3a63, #0f1b2f)', fg: '#00a8e1' },
  disney: { bg: 'linear-gradient(160deg, #1b3c8a, #0b1a3a)', fg: '#f3efe6' },
  appletv: { bg: 'linear-gradient(160deg, #2c2c2e, #0a0a0a)', fg: '#f3efe6' },
  spotify: { bg: 'linear-gradient(160deg, #1ed760, #13843c)', fg: '#0a0a0a' },
  ard: { bg: 'linear-gradient(160deg, #0f3fa3, #001d6a)', fg: '#f3efe6' },
  zdf: { bg: 'linear-gradient(160deg, #f27e1a, #b8540e)', fg: '#f3efe6' },
  arte: { bg: 'linear-gradient(160deg, #ff5200, #b63800)', fg: '#f3efe6' },
  joyn: { bg: 'linear-gradient(160deg, #1a1a1a, #000000)', fg: '#00d4c8' },
  custom: { bg: 'linear-gradient(160deg, #3a4668, #1a2238)', fg: '#f3efe6' },
};
const GLOW = { youtube: '#ff3b3b', twitch: '#9146ff', radio: '#1aa092', clock: '#5b57d6', netflix: '#e50914', prime: '#00a8e1', disney: '#2f5fd6', appletv: '#8e8e93', spotify: '#1ed760', ard: '#2f5fd6', zdf: '#f27e1a', arte: '#ff5200', joyn: '#00d4c8' };
const tileFor = (id) => TILES[id] || TILES.custom;

// ---- state -----------------------------------------------------------------
let screen = 'boot';            // boot | home | app
let app = 'home';               // youtube | twitch | radio | clock (when screen === 'app')
let media = 'none';             // which app owns the sound: none | youtube | twitch | radio
let booted = false;

let apps = applyAppConfig(APPS, loadJSON('couchkanal.apps'));
let focusHome = 0, focusRadio = 0;

let q = initialQueue();
let playback = 'idle';          // youtube: idle | loading | playing | paused | buffering | blocked
let pos = 0, dur = 0, volume = 100, muted = false;
let panelOpen = false;
let currentKey = null;
let player = null, playerReady = false, playerPromise = null;

const radio = { station: null, playing: false, buffering: false, error: '' };
const audio = new Audio(); audio.preload = 'none';

const twitch = { channel: '', playing: false, online: null, ready: false };
const yt = { view: 'browse', key: '', rows: {}, focusRow: 0, focusCol: {}, loading: false, error: '', searchQ: '', searchItems: null, loadedAt: 0 };
try { yt.key = localStorage.getItem('couchkanal.apikey') || ''; } catch {}
let launched = '', launchedAt = 0;
let twitchPlayer = null, twitchPromise = null;

let peer = null, code = null, idRetries = 0;
const conns = new Set();

// ---- helpers ---------------------------------------------------------------
const timers = {};
function after(name, ms, fn) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }
function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
function toast(text) {
  el.toast.textContent = text; el.toast.classList.add('show');
  after('toast', 2600, () => el.toast.classList.remove('show'));
}
function setStatus(kind, text) {
  el.status.className = 'status glass ' + kind;
  el.statusText.textContent = text;
  el.status.classList.remove('fade');
  if (kind === 'ok' && screen === 'app' && (app === 'youtube' || app === 'twitch')) after('statusFade', 3500, () => el.status.classList.add('fade'));
}
const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
function tickClock() {
  const d = new Date();
  const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const date = `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  el.clock.textContent = t; el.bigClock.textContent = t;
  el.date.textContent = date; el.bigDate.textContent = date;
}
function current() { return q.index >= 0 ? q.queue[q.index] : null; }
function upcoming() { return q.index >= 0 ? q.queue[q.index + 1] : null; }
function connected() { return conns.size > 0; }

// ---- screens -----------------------------------------------------------------
function setScreen(next, nextApp) {
  screen = next; if (nextApp) app = nextApp;
  tv.dataset.state = screen; tv.dataset.app = screen === 'app' ? app : 'home';
  el.boot.classList.toggle('active', screen === 'boot');
  el.home.classList.toggle('active', screen === 'home');
  for (const [id, sec] of Object.entries(el.appScreens)) sec.classList.toggle('active', screen === 'app' && app === id);
  el.status.classList.remove('fade');
  if (screen !== 'app' || app !== 'youtube') { el.now.classList.remove('show'); showPanel(false, true); }
  if (screen === 'home') renderHome();
  if (screen === 'app' && app === 'radio') renderRadio();
  if (screen === 'app' && app === 'clock') renderClockChip();
  if (screen === 'app' && app === 'youtube') { if (current() && playback !== 'idle' && yt.view === 'watch') showNow(playback === 'paused'); renderYt(); } else el.ytBrowse.classList.remove('show');
  if (connected() && (app === 'youtube' || app === 'twitch') && screen === 'app') after('statusFade', 3500, () => el.status.classList.add('fade'));
}
function goHome() { setScreen('home'); sendState(); }
function launchApp(a) {
  const target = launchTarget(a);
  if (!target) { toast(`${a.name} hat keine Adresse`); return; }
  launched = a.name; launchedAt = Date.now();
  toast(`Öffne ${a.name}`);
  sendState();
  try { sessionStorage.setItem('couchkanal.resume', '1'); } catch {}
  after('launch', 350, () => { try { location.href = target; } catch {} });
  after('launchReset', 15000, () => { launched = ''; sendState(); });
}
function openApp(id) {
  const a = apps.find((x) => x.id === id);
  if (!a) return;
  if (a.kind === 'launch') { launchApp(a); return; }
  if (media !== 'none' && media !== id && id !== 'clock') stopMedia(media);
  setScreen('app', id);
  if (id === 'youtube') {
    yt.view = (current() && media === 'youtube') ? 'watch' : 'browse';
    if (yt.view === 'browse') loadYtRows();
    renderYt();
  }
  if (id === 'twitch') { el.twEmpty.hidden = !!twitch.channel; if (twitch.channel) ensureTwitch(twitch.channel); }
  sendState();
}
function back() {
  if (screen === 'app' && app === 'youtube' && yt.view === 'watch' && current()) {
    yt.view = 'browse';
    try { if (playerReady && playback === 'playing') player.pauseVideo(); } catch {}
    el.now.classList.remove('show');
    loadYtRows(); renderYt(); sendState(); return;
  }
  if (screen === 'app') goHome();
  else sendState();
}
function nav(dir) {
  if (screen === 'home') {
    const list = visibleApps(apps);
    const before = focusHome;
    focusHome = moveFocus(focusHome, dir, list.length);
    tiltDir = focusHome > before ? 'r' : (focusHome < before ? 'l' : null);
    renderHome(); sendState(); return;
  }
  if (screen === 'app' && app === 'radio') {
    focusRadio = moveFocus(focusRadio, dir, STATIONS.length, 4);
    renderRadio(); sendState(); return;
  }
  if (screen === 'app' && app === 'youtube') {
    if (yt.view === 'browse') {
      const rows = ytRowsList();
      if (!rows.length) return;
      if (dir === 'up' || dir === 'down') yt.focusRow = moveFocus(yt.focusRow, dir, rows.length, 1);
      else { const row = rows[yt.focusRow]; const cur = Math.min(yt.focusCol[row.id] ?? 0, row.items.length - 1); yt.focusCol[row.id] = moveFocus(cur, dir, row.items.length); }
      renderYt(); sendState(); return;
    }
    if (playerReady && current()) { if (dir === 'left') seekBy(-10); else if (dir === 'right') seekBy(10); }
    return;
  }
}
function select() {
  if (screen === 'home') { const list = visibleApps(apps); const a = list[focusHome]; if (a) openApp(a.id); return; }
  if (screen === 'app' && app === 'radio') { playStation(STATIONS[focusRadio]); return; }
  if (screen === 'app' && app === 'youtube') {
    if (yt.view === 'browse') { const rows = ytRowsList(); const row = rows[yt.focusRow]; if (row) selectYt(row, Math.min(yt.focusCol[row.id] ?? 0, row.items.length - 1)); return; }
    toggleMedia(); return;
  }
  if (screen === 'app' && app === 'twitch') { toggleMedia(); return; }
  if (screen === 'app' && app === 'clock') { goHome(); }
}

// ---- home rendering ----------------------------------------------------------
function renderCode(c, confirmed) {
  el.code.classList.toggle('pending', !confirmed);
  el.code.classList.toggle('waiting', confirmed && !connected());
  el.code.innerHTML = '';
  [...c].forEach((d, i) => {
    const s = document.createElement('span'); s.className = 'tile';
    s.textContent = d; s.style.setProperty('--i', i);
    el.code.appendChild(s);
  });
}
function renderQR() {
  if (!code || typeof qrcode !== 'function') return;
  try {
    const url = new URL('remote.html', location.href); url.searchParams.set('code', code);
    const q2 = qrcode(0, 'M'); q2.addData(url.href); q2.make();
    el.qr.innerHTML = q2.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch (e) { el.qr.textContent = ''; }
}
function mediaLabel() {
  if (media === 'youtube' && current()) return current().title;
  if (media === 'twitch' && twitch.channel) return `Twitch: ${twitch.channel}`;
  if (media === 'radio' && radio.station) return radio.station.name;
  return '';
}
let lastShelfApp = null, tiltDir = null, lastHomeFocus = -1;
function shelfCard(a) {
  const c = el.shelfCard; c.innerHTML = '';
  const t = tileFor(a.id);
  c.style.setProperty('--tile-bg', t.bg); c.style.setProperty('--tile-fg', t.fg);
  if (a.kind === 'launch') {
    const d = document.createElement('div'); d.className = 'card-word' + (a.id === 'netflix' ? ' upper' : ''); d.textContent = a.name;
    c.appendChild(d); return;
  }
  if (a.id === 'youtube') {
    const v = current() || q.queue[q.queue.length - 1];
    if (v) {
      const img = document.createElement('img'); img.src = v.thumb; img.alt = '';
      const sub = document.createElement('div'); sub.className = 'card-sub'; sub.textContent = current() ? (playback === 'playing' ? 'Läuft gerade' : 'Pausiert') : 'Zuletzt gesehen';
      const title = document.createElement('div'); title.className = 'card-title'; title.textContent = v.title;
      c.append(img, Object.assign(document.createElement('div'), { className: 'card-scrim' }), sub, title);
    } else c.innerHTML = '<div class="card-logo"><svg class="logo"><use href="#l-youtube"/></svg></div>';
    return;
  }
  if (a.id === 'twitch') {
    if (twitch.channel) {
      const img = document.createElement('img'); img.alt = '';
      img.src = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${twitch.channel}-640x360.jpg?t=${Math.floor(Date.now() / 60000)}`;
      const sub = document.createElement('div'); sub.className = 'card-sub'; sub.textContent = twitch.online === false ? 'Gerade offline' : (twitch.playing ? 'Live' : 'Kanal geöffnet');
      const title = document.createElement('div'); title.className = 'card-title'; title.textContent = twitch.channel;
      c.append(img, Object.assign(document.createElement('div'), { className: 'card-scrim' }), sub, title);
    } else c.innerHTML = '<div class="card-logo"><svg class="logo"><use href="#l-twitch"/></svg></div>';
    return;
  }
  if (a.id === 'radio') {
    if (media === 'radio' && radio.station) {
      const d = document.createElement('div'); d.className = 'card-radio'; d.style.setProperty('--hue', radio.station.hue);
      d.innerHTML = `<span class="bars${radio.playing ? '' : ' still'}"><i></i><i></i><i></i><i></i></span><span class="w"></span><span class="s"></span>`;
      d.querySelector('.w').textContent = radio.station.name; d.querySelector('.s').textContent = radio.station.tag;
      c.appendChild(d);
    } else {
      const d = document.createElement('div'); d.className = 'card-stations';
      STATIONS.slice(0, 6).forEach((s) => { const sp = document.createElement('span'); sp.style.setProperty('--hue', s.hue); sp.textContent = s.name; d.appendChild(sp); });
      c.appendChild(d);
    }
    return;
  }
  if (a.id === 'clock') {
    const d = document.createElement('div'); d.className = 'card-clock';
    d.innerHTML = `<span class="t">${el.clock.textContent}</span><span class="d">${el.date.textContent}</span>`;
    c.appendChild(d);
  }
}
function renderHome() {
  el.home.classList.toggle('paired', connected());
  el.code.classList.toggle('waiting', !connected() && !el.code.classList.contains('pending'));
  const list = visibleApps(apps);
  if (focusHome >= list.length) focusHome = Math.max(0, list.length - 1);
  // tiles: built once per app set (so the entrance plays once), focus is a class toggle
  const key = list.map((a) => a.id + ':' + a.name).join(',');
  if (el.apps.dataset.key !== key) {
    el.apps.dataset.key = key;
    el.apps.innerHTML = '';
    list.forEach((a, i) => {
      const slot = document.createElement('div');
      slot.className = 'app-slot'; slot.dataset.app = a.id;
      slot.style.setProperty('--i', i); slot.setAttribute('role', 'listitem');
      const b = document.createElement('button');
      b.className = 'app-tile'; b.dataset.app = a.id; b.setAttribute('aria-label', a.name);
      const t = tileFor(a.id);
      b.style.setProperty('--tile-bg', t.bg); b.style.setProperty('--tile-fg', t.fg);
      if (a.kind === 'launch') { b.classList.add('launch'); const w = document.createElement('span'); w.className = 'wordmark'; w.textContent = a.name; b.appendChild(w); }
      else b.innerHTML = `<svg class="logo"><use href="#l-${a.id}"/></svg>`;
      b.addEventListener('click', () => { focusHome = i; openApp(a.id); });
      const name = document.createElement('span'); name.className = 'app-name';
      name.innerHTML = '<span class="live-dot"></span>'; name.append(a.name);
      if (a.kind === 'launch') { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'iPad-App'; name.appendChild(tag); }
      slot.append(b, name);
      el.apps.appendChild(slot);
    });
  }
  [...el.apps.children].forEach((slot, i) => {
    const a = list[i]; const tile = slot.querySelector('.app-tile');
    slot.classList.toggle('focused', i === focusHome);
    slot.classList.toggle('live', !!a && media === a.id);
    tile.classList.toggle('focused', i === focusHome);
    tile.classList.remove('tilt-l', 'tilt-r');
    if (i === focusHome && tiltDir) { void tile.offsetWidth; tile.classList.add('tilt-' + tiltDir); }
    tile.classList.remove('glint');
    if (i === focusHome && lastHomeFocus !== i) { void tile.offsetWidth; tile.classList.add('glint'); }
  });
  lastHomeFocus = focusHome;
  el.apps.style.transform = `translateX(${-Math.max(0, focusHome - 3) * 19.2}vw)`;
  tiltDir = null;
  // shelf
  const a = list[focusHome];
  if (a) {
    el.shelfApp.style.setProperty('--tile-a', GLOW[a.id] || '#777');
    el.shelfKicker.textContent = media === a.id ? 'Läuft gerade' : '';
    el.shelfTitle.textContent = a.name;
    el.shelfText.textContent = a.blurb;
    const label = media === a.id ? mediaLabel() : (media !== 'none' && a.id === 'clock' ? mediaLabel() : '');
    el.shelfNow.innerHTML = '';
    if (label) {
      const bars = document.createElement('span'); bars.className = 'bars'; bars.innerHTML = '<i></i><i></i><i></i><i></i>';
      const stillness = (media === 'youtube' && playback !== 'playing') || (media === 'radio' && !radio.playing) || (media === 'twitch' && !twitch.playing);
      if (stillness) bars.classList.add('still');
      el.shelfNow.append(bars, document.createTextNode(label));
    }
    shelfCard(a);
    if (lastShelfApp !== a.id) {
      lastShelfApp = a.id;
      el.shelfApp.classList.remove('swap'); void el.shelfApp.offsetWidth; el.shelfApp.classList.add('swap');
      after('swap', 800, () => el.shelfApp.classList.remove('swap'));
    }
  }
  if (!connected()) {
    el.idleLead.textContent = 'Öffne die Fernbedienung am Handy und gib diesen Code ein';
    el.idleHint.textContent = 'Oder scanne den Code rechts mit der Kamera deines Handys.';
  }
  renderClockChip();
}
function renderClockChip() {
  const label = media !== 'none' ? mediaLabel() : '';
  el.radioChip.hidden = !label;
  el.radioChipText.textContent = label;
  el.radioChip.querySelector('.bars').classList.toggle('still', !(media === 'radio' ? radio.playing : media === 'youtube' ? playback === 'playing' : twitch.playing));
}

// ---- radio ---------------------------------------------------------------------
let lastRadioFocus = -1;
function renderRadio() {
  if (!el.stations.children.length) {
    STATIONS.forEach((st, i) => {
      const b = document.createElement('button');
      b.className = 'station'; b.style.setProperty('--hue', st.hue); b.setAttribute('role', 'listitem'); b.style.setProperty('--i', i);
      b.innerHTML = `<span class="bars"><i></i><i></i><i></i><i></i></span><span class="s-name"></span><span class="s-tag"></span>`;
      b.querySelector('.s-name').textContent = st.name; b.querySelector('.s-tag').textContent = st.tag;
      b.addEventListener('click', () => { focusRadio = i; playStation(st); });
      el.stations.appendChild(b);
    });
  }
  [...el.stations.children].forEach((b, i) => {
    const st = STATIONS[i];
    const isPlaying = media === 'radio' && radio.station && radio.station.id === st.id;
    b.classList.toggle('focused', i === focusRadio);
    b.classList.toggle('playing', !!isPlaying);
    b.querySelector('.bars').classList.toggle('still', !!isPlaying && !radio.playing);
    if (i === focusRadio && lastRadioFocus !== i) { b.classList.remove('glint'); void b.offsetWidth; b.classList.add('glint'); }
  });
  lastRadioFocus = focusRadio;
  if (media === 'radio' && radio.station) {
    el.radioNow.innerHTML = '';
    const bars = document.createElement('span'); bars.className = 'bars'; bars.innerHTML = '<i></i><i></i><i></i><i></i>';
    if (!radio.playing) bars.classList.add('still');
    el.radioNow.append(bars, document.createTextNode(radio.error ? `${radio.station.name}: ${radio.error}` : (radio.buffering ? `${radio.station.name} lädt` : radio.station.name)));
  } else {
    el.radioNow.textContent = 'Wähle einen Sender';
  }
}
function playStation(s) {
  if (!s) return;
  if (media !== 'none' && media !== 'radio') stopMedia(media);
  media = 'radio';
  radio.station = s; radio.error = ''; radio.buffering = true; radio.playing = false;
  audio.src = s.url; audio.muted = muted;
  audio.play().then(() => { el.tapToPlay.hidden = true; }).catch(() => {
    radio.buffering = false;
    el.tapTitle.textContent = s.name; el.tapToPlay.hidden = false;
    renderRadio(); sendState();
  });
  renderRadio(); renderHome(); sendState();
}
audio.addEventListener('playing', () => { radio.playing = true; radio.buffering = false; radio.error = ''; el.tapToPlay.hidden = true; renderRadio(); renderHome(); renderClockChip(); sendState(); });
audio.addEventListener('pause', () => { radio.playing = false; renderRadio(); renderHome(); renderClockChip(); sendState(); });
audio.addEventListener('waiting', () => { radio.buffering = true; renderRadio(); sendState(); });
audio.addEventListener('error', () => { radio.playing = false; radio.buffering = false; radio.error = 'nicht erreichbar'; renderRadio(); sendState(); });

// ---- twitch --------------------------------------------------------------------
function ensureTwitch(channel) {
  const host = location.hostname || 'localhost';
  const create = () => {
    if (twitchPlayer) { twitchPlayer.setChannel(channel); return; }
    twitchPlayer = new Twitch.Player('twitchPlayer', { channel, parent: [host], width: '100%', height: '100%', autoplay: true, muted: muted });
    const P = Twitch.Player;
    twitchPlayer.addEventListener(P.READY, () => { twitch.ready = true; try { if (!IS_IOS) twitchPlayer.setVolume(volume / 100); } catch {} });
    twitchPlayer.addEventListener(P.PLAY, () => { twitch.playing = true; el.tapToPlay.hidden = true; renderTwitch(); renderHome(); sendState(); });
    twitchPlayer.addEventListener(P.PAUSE, () => { twitch.playing = false; renderTwitch(); renderHome(); sendState(); });
    twitchPlayer.addEventListener(P.ONLINE, () => { twitch.online = true; renderTwitch(); sendState(); });
    twitchPlayer.addEventListener(P.OFFLINE, () => { twitch.online = false; twitch.playing = false; renderTwitch(); sendState(); });
  };
  if (!twitchPromise) {
    twitchPromise = new Promise((resolve) => {
      if (window.Twitch && window.Twitch.Player) return resolve();
      const s = document.createElement('script'); s.src = 'https://player.twitch.tv/js/embed/v1.js'; s.onload = resolve; document.head.appendChild(s);
    });
  }
  twitchPromise.then(create);
}
function openChannel(name) {
  const ch = String(name || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25);
  if (!ch) return;
  if (media !== 'none' && media !== 'twitch') stopMedia(media);
  media = 'twitch'; twitch.channel = ch; twitch.online = null; twitch.playing = false;
  if (!(screen === 'app' && app === 'twitch')) setScreen('app', 'twitch');
  el.twEmpty.hidden = true;
  ensureTwitch(ch);
  renderTwitch(); renderHome(); sendState();
  after('twAutoplay', 6000, () => { if (media === 'twitch' && !twitch.playing && twitch.online !== false) { el.tapTitle.textContent = `Twitch: ${ch}`; el.tapToPlay.hidden = false; sendState(); } });
}
function renderTwitch() {
  el.twChip.hidden = !twitch.channel;
  el.twChip.classList.toggle('off', twitch.online === false);
  el.twChipText.textContent = twitch.online === false ? `${twitch.channel} ist gerade offline` : twitch.channel;
}

// ---- media (shared) -------------------------------------------------------------
function stopMedia(which) {
  if (which === 'youtube') { try { if (playerReady) player.stopVideo(); } catch {} playback = 'idle'; currentKey = null; pos = 0; q = { ...q, index: -1 }; el.now.classList.remove('show'); }
  if (which === 'twitch') { try { if (twitchPlayer) twitchPlayer.pause(); } catch {} twitch.playing = false; }
  if (which === 'radio') { try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {} radio.playing = false; radio.station = null; }
  if (media === which) media = 'none';
  el.tapToPlay.hidden = true;
  renderHome(); renderClockChip();
}
function toggleMedia() {
  if (media === 'youtube' && playerReady && current()) {
    if (playback === 'playing' || playback === 'buffering') { player.pauseVideo(); osdCenter('pause'); }
    else { player.playVideo(); osdCenter('play'); }
    return;
  }
  if (media === 'twitch' && twitchPlayer) { twitch.playing ? twitchPlayer.pause() : twitchPlayer.play(); return; }
  if (media === 'radio' && radio.station) { radio.playing ? audio.pause() : audio.play().catch(() => {}); return; }
  if (media === 'none' && current()) { loadCurrent(); }
}
function applyMute() {
  try { if (playerReady) muted ? player.mute() : player.unMute(); } catch {}
  try { if (twitchPlayer) twitchPlayer.setMuted(muted); } catch {}
  audio.muted = muted;
  osdVolume();
}
function applyVolume() {
  try { if (playerReady) player.setVolume(volume); } catch {}
  try { if (twitchPlayer) twitchPlayer.setVolume(volume / 100); } catch {}
  audio.volume = volume / 100;
  if (muted && volume > 0) { muted = false; applyMute(); return; }
  osdVolume();
}
function retryMedia() {
  if (media === 'youtube') { try { player.playVideo(); } catch {} }
  else if (media === 'twitch') { try { twitchPlayer && twitchPlayer.play(); } catch {} }
  else if (media === 'radio') { audio.play().catch(() => {}); }
  el.tapToPlay.hidden = true;
}

// ---- youtube -------------------------------------------------------------------
function ensurePlayer() {
  if (playerPromise) return playerPromise;
  playerPromise = new Promise((resolve) => {
    const create = () => {
      player = new YT.Player('player', {
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin },
        events: {
          onReady: () => { playerReady = true; try { if (!IS_IOS) volume = player.getVolume(); } catch {} resolve(player); },
          onStateChange: onPlayerState,
          onError: onPlayerError,
        },
      });
    };
    if (window.YT && window.YT.Player) create();
    else {
      window.onYouTubeIframeAPIReady = create;
      const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
    }
  });
  return playerPromise;
}
function onPlayerState(e) {
  if (playback === 'idle' || !current() || media !== 'youtube') return;
  const S = YT.PlayerState;
  switch (e.data) {
    case S.PLAYING: playback = 'playing'; el.tapToPlay.hidden = true; clearTimeout(timers.autoplay); if (screen === 'app' && app === 'youtube' && yt.view === 'watch') showNow(); break;
    case S.PAUSED: playback = 'paused'; if (screen === 'app' && app === 'youtube' && yt.view === 'watch') showNow(true); break;
    case S.BUFFERING: playback = 'buffering'; break;
    case S.ENDED: apply(reduce(q, { type: 'ended' })); break;
    case S.CUED: if (playback === 'loading') { try { player.playVideo(); } catch {} } break;
    default: break;
  }
  renderHome(); renderClockChip(); sendState();
}
function onPlayerError() {
  const v = current();
  toast(`„${v ? v.title : 'Video'}“ lässt sich hier nicht abspielen`);
  after('skip', 1800, () => apply(reduce(q, { type: 'next' })));
}
function watchAutoplay() {
  after('autoplay', 3200, () => {
    if (media === 'youtube' && (playback === 'loading' || playback === 'blocked')) {
      playback = 'blocked';
      const v = current(); el.tapTitle.textContent = v ? v.title : ''; el.tapToPlay.hidden = false;
      sendState();
    }
  });
}
function seekBy(by) {
  let to = pos + by; to = Math.max(0, dur ? Math.min(to, dur - 0.5) : to);
  player.seekTo(to, true); pos = to;
  osdCenter(by < 0 ? 'back' : 'fwd', `${Math.abs(by)} s`);
  showNow(playback === 'paused'); renderProgress();
}
function loadCurrent() {
  const v = current();
  if (!v) return;
  if (media !== 'none' && media !== 'youtube') stopMedia(media);
  media = 'youtube';
  currentKey = `${q.index}:${v.id}`;
  playback = 'loading'; pos = 0; dur = v.duration || 0;
  yt.view = 'watch';
  if (!(screen === 'app' && app === 'youtube')) setScreen('app', 'youtube'); else renderYt();
  el.tapToPlay.hidden = true;
  showNow(true);
  ensurePlayer().then(() => { player.loadVideoById({ videoId: v.id, startSeconds: v.start || 0 }); watchAutoplay(); });
  renderQueue(); renderHome();
}
function apply(next) {
  const before = current();
  const restart = !!next.restart;
  q = { queue: next.queue, index: next.index };
  const v = current();
  if (!v) {
    stopMedia('youtube');
    yt.view = 'browse'; if (screen === 'app' && app === 'youtube') { loadYtRows(); renderYt(); }
    if (q.queue.length) toast('Warteschlange durchgespielt');
    renderQueue(); sendState(); return;
  }
  const key = `${q.index}:${v.id}`;
  if (key === currentKey && media === 'youtube' && !restart) { renderNow(); renderQueue(); sendState(); return; }
  if (key === currentKey && media === 'youtube' && restart) { try { player.seekTo(0, true); player.playVideo(); } catch {} osdCenter('back', 'Von vorn'); sendState(); return; }
  loadCurrent();
  if (before && before.id !== v.id) toast(`Jetzt: ${v.title}`);
  sendState();
}


// ---- YouTube on the TV: rows, fetch, focus ---------------------------------
const ytDecoder = document.createElement('textarea');
const ytDecode = (t) => { ytDecoder.innerHTML = t; return ytDecoder.value; };
function isoDuration(iso) { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || ''); return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0; }
function ytError(j) {
  const reason = j?.error?.errors?.[0]?.reason || '';
  const map = {
    quotaExceeded: 'Das Tageskontingent von Google ist aufgebraucht. Morgen geht es weiter, Links vom Handy laufen weiterhin.',
    keyInvalid: 'Der Suchschlüssel ist ungültig. Prüfe ihn in der Fernbedienung.',
    accessNotConfigured: 'Für diesen Schlüssel ist „YouTube Data API v3“ noch nicht aktiviert.',
    ipRefererBlocked: 'Der Schlüssel ist auf andere Webseiten beschränkt. Trage diese Adresse in der Google Cloud Console ein.',
  };
  return new Error(map[reason] || (j?.error?.message ? 'Google meldet: ' + j.error.message : 'Laden fehlgeschlagen'));
}
function mapVideo(i) {
  const id = typeof i.id === 'string' ? i.id : i.id?.videoId;
  return { id, title: ytDecode(i.snippet?.title || ''), channel: ytDecode(i.snippet?.channelTitle || ''), thumb: thumbFor(id), start: 0, duration: isoDuration(i.contentDetails?.duration) };
}
async function fetchYtRow(row) {
  const u = new URL('https://www.googleapis.com/youtube/v3/videos');
  const p = { part: 'snippet,contentDetails', chart: 'mostPopular', regionCode: 'DE', maxResults: '16', key: yt.key };
  if (row.id !== 'trending') p.videoCategoryId = row.id;
  u.search = new URLSearchParams(p);
  const r = await fetch(u); const j = await r.json();
  if (!r.ok) throw ytError(j);
  return (j.items || []).map(mapVideo).filter((v) => v.id);
}
async function loadYtRows(force = false) {
  if (!yt.key || yt.loading) return;
  if (!force && Date.now() - yt.loadedAt < 30 * 60 * 1000 && Object.keys(yt.rows).length) return;
  const cache = loadJSON('couchkanal.yt.cache');
  if (!force && cache && Date.now() - cache.ts < 30 * 60 * 1000 && cache.key === yt.key) { yt.rows = cache.rows; yt.loadedAt = cache.ts; renderYt(); return; }
  yt.loading = true; yt.error = ''; renderYt();
  const results = await Promise.allSettled(YT_ROWS.map((r) => fetchYtRow(r)));
  const rows = {}; let err = '';
  results.forEach((res, i) => { if (res.status === 'fulfilled') rows[YT_ROWS[i].id] = res.value; else err = res.reason?.message || 'Laden fehlgeschlagen'; });
  yt.rows = rows; yt.loading = false; yt.error = Object.keys(rows).length ? '' : err; yt.loadedAt = Date.now();
  if (Object.keys(rows).length) saveJSON('couchkanal.yt.cache', { ts: yt.loadedAt, key: yt.key, rows });
  renderYt(); sendState();
}
async function ytSearch(query) {
  query = String(query).trim().slice(0, 120);
  if (!query || !yt.key) return;
  yt.searchQ = query; yt.searchItems = []; yt.focusRow = 0;
  if (!(screen === 'app' && app === 'youtube')) openApp('youtube');
  yt.view = 'browse'; renderYt();
  try {
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    u.search = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '16', q: query, key: yt.key, relevanceLanguage: 'de' });
    const r = await fetch(u); const j = await r.json();
    if (!r.ok) throw ytError(j);
    const items = (j.items || []).map(mapVideo).filter((v) => v.id);
    try {
      const u2 = new URL('https://www.googleapis.com/youtube/v3/videos');
      u2.search = new URLSearchParams({ part: 'contentDetails', id: items.map((v) => v.id).join(','), key: yt.key });
      const r2 = await fetch(u2); const j2 = await r2.json();
      if (r2.ok) { const d = {}; for (const v of j2.items || []) d[v.id] = isoDuration(v.contentDetails?.duration); items.forEach((v) => { v.duration = d[v.id] || 0; }); }
    } catch {}
    yt.searchItems = items; yt.focusCol.search = 0;
    const rows = ytRowsList(); yt.focusRow = Math.max(0, rows.findIndex((r) => r.id === 'search'));
  } catch (e) { yt.error = e.message; yt.searchItems = null; }
  renderYt(); sendState();
}
function ytRowsList() {
  const rows = [];
  if (q.queue.length) rows.push({ id: 'queue', title: 'Warteschlange', items: q.queue, queue: true });
  if (yt.searchItems) rows.push({ id: 'search', title: `Ergebnisse für „${yt.searchQ}“`, items: yt.searchItems });
  for (const r of YT_ROWS) { const items = yt.rows[r.id] || []; if (items.length || (r.id === 'trending' && yt.key)) rows.push({ id: r.id, title: r.title, items }); }
  return rows;
}
function selectYt(row, ci) {
  const v = row.items[ci]; if (!v) return;
  if (row.queue) { if (ci === q.index && media === 'youtube') { yt.view = 'watch'; renderYt(); try { player.playVideo(); } catch {} showNow(); sendState(); return; } apply(reduce(q, { type: 'jump', index: ci })); return; }
  apply(reduce(q, { type: 'playNow', video: v }));
}
let ytDomKey = '';
function renderYt() {
  const show = screen === 'app' && app === 'youtube' && yt.view === 'browse';
  el.ytBrowse.classList.toggle('show', show);
  tv.classList.toggle('browsing', show);
  if (show) el.now.classList.remove('show');
  if (!show) return;
  const rows = ytRowsList();
  if (yt.focusRow >= rows.length) yt.focusRow = Math.max(0, rows.length - 1);
  el.ytHint.textContent = yt.key ? 'Auswählen mit dem Steuerkreuz. Suchbegriffe tippst du am Handy.' : 'Links vom Handy laufen sofort.';
  const dataKey = [yt.key ? 'k' : '', yt.error, yt.loading ? 'l' : '', media === 'youtube' ? q.index + ':' + playback : '',
    ...rows.map((r) => r.id + '=' + r.items.map((v) => v.id).join('.'))].join('|');
  if (dataKey !== ytDomKey) {
    ytDomKey = dataKey;
    el.ytRows.innerHTML = '';
    if (!yt.key) {
      const d = document.createElement('div'); d.className = 'yt-setup';
      d.innerHTML = '<h3>Angesagte Videos und Suche direkt hier auf dem Fernseher</h3><p>Dafür braucht der Fernseher deinen kostenlosen Google-Schlüssel. Trag ihn in der Fernbedienung ein (Zahnrad oben rechts), er wird automatisch hierher übertragen.</p><ol><li>Google Cloud Console öffnen, Projekt anlegen.</li><li>„YouTube Data API v3“ aktivieren.</li><li>Unter „Anmeldedaten“ einen API-Schlüssel erstellen und in der Fernbedienung speichern.</li></ol><p>Bis dahin: Links am Handy einfügen, sie laufen sofort hier.</p>';
      el.ytRows.appendChild(d);
    }
    if (yt.error) { const m = document.createElement('p'); m.className = 'yt-msg'; m.textContent = yt.error; el.ytRows.appendChild(m); }
    rows.forEach((row, ri) => {
      const sec = document.createElement('section'); sec.className = 'yt-row'; sec.dataset.row = row.id;
      const h = document.createElement('h3'); h.textContent = row.title; sec.appendChild(h);
      const track = document.createElement('div'); track.className = 'yt-track';
      if (!row.items.length) {
        if (yt.loading) for (let k = 0; k < 5; k++) { const sk = document.createElement('div'); sk.className = 'yt-card skel'; sk.innerHTML = '<span class="th"></span><span class="t"></span><span class="c"></span>'; track.appendChild(sk); }
        else { const m = document.createElement('p'); m.className = 'yt-msg'; m.textContent = 'Nichts gefunden'; track.appendChild(m); }
      }
      row.items.forEach((v, ci) => {
        const card = document.createElement('button');
        card.className = 'yt-card' + (row.queue && q.index >= 0 && ci < q.index ? ' dim' : '');
        card.innerHTML = `<span class="th"><img alt="" loading="lazy"><span class="dur" hidden></span><span class="chip" hidden></span></span><span class="t"></span><span class="c"></span>`;
        card.querySelector('img').src = v.thumb.replace('hqdefault', 'mqdefault');
        if (v.duration) { const d = card.querySelector('.dur'); d.textContent = formatTime(v.duration); d.hidden = false; }
        if (row.queue && ci === q.index && media === 'youtube') { const ch = card.querySelector('.chip'); ch.textContent = playback === 'playing' ? 'Läuft' : 'Weiter ansehen'; ch.hidden = false; }
        card.querySelector('.t').textContent = v.title; card.querySelector('.c').textContent = v.channel;
        card.addEventListener('click', () => { yt.focusRow = ri; yt.focusCol[row.id] = ci; selectYt(row, ci); });
        track.appendChild(card);
      });
      sec.appendChild(track); el.ytRows.appendChild(sec);
    });
  }
  // focus pass: classes and transforms only, so the movement glides
  const sections = [...el.ytRows.querySelectorAll('.yt-row')];
  sections.forEach((sec, ri) => {
    const row = rows[ri]; if (!row) return;
    if (row.queue && yt.focusCol.queue === undefined) yt.focusCol.queue = Math.max(0, q.index);
    const fc = Math.max(0, Math.min(yt.focusCol[row.id] ?? 0, row.items.length - 1));
    sec.classList.toggle('focused', ri === yt.focusRow);
    const cards = sec.querySelectorAll('.yt-card:not(.skel)');
    cards.forEach((c, ci) => { const on = ri === yt.focusRow && ci === fc; if (on && !c.classList.contains('focused')) { c.classList.remove('glint'); void c.offsetWidth; c.classList.add('glint'); } c.classList.toggle('focused', on); });
    sec.querySelector('.yt-track').style.transform = `translateX(${-fc * 20.4}vw)`;
  });
  requestAnimationFrame(() => { const f = sections[yt.focusRow]; el.ytRows.style.transform = `translateY(${f && yt.focusRow > 0 ? -f.offsetTop : 0}px)`; });
}
// ---- now playing / OSD / queue panel (youtube) --------------------------------
function renderNow() {
  const v = current(); if (!v) return;
  el.nowThumb.src = v.thumb; el.nowTitle.textContent = v.title; el.nowChannel.textContent = v.channel;
  const n = upcoming(); el.nowNext.hidden = !n; if (n) el.nowNextTitle.textContent = n.title;
  el.ambientArt.src = v.thumb; tv.classList.add('has-art');
}
function renderProgress() {
  el.nowFill.style.width = dur ? (pos / dur * 100).toFixed(2) + '%' : '0%';
  el.nowPos.textContent = formatTime(pos); el.nowDur.textContent = formatTime(dur);
}
function showNow(sticky = false) {
  renderNow(); renderProgress();
  el.now.classList.add('show');
  clearTimeout(timers.now);
  if (!sticky) after('now', 4200, () => el.now.classList.remove('show'));
}
function osdCenter(icon, label = '') {
  el.osdCenterIcon.setAttribute('href', '#i-' + icon); el.osdCenterLabel.textContent = label;
  el.osdCenter.classList.remove('show'); void el.osdCenter.offsetWidth; el.osdCenter.classList.add('show');
}
function osdVolume() {
  if (screen !== 'app') return;
  el.osdVolIcon.setAttribute('href', muted ? '#i-mute' : '#i-vol');
  el.osdVolFill.style.height = (muted ? 0 : volume) + '%';
  el.osdVolLabel.textContent = muted ? 'Stumm' : (IS_IOS ? 'Ton an' : String(volume));
  el.osdVolume.classList.add('show');
  after('vol', 1600, () => el.osdVolume.classList.remove('show'));
}
function renderQueue() {
  el.queueList.innerHTML = '';
  if (!q.queue.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Noch nichts in der Warteschlange.'; el.queueList.appendChild(li); return; }
  const from = Math.max(0, Math.min(q.index - 1, q.queue.length - 8));
  q.queue.slice(from, from + 8).forEach((v, k) => {
    const i = from + k;
    const li = document.createElement('li');
    li.className = i === q.index ? 'current' : (q.index >= 0 && i < q.index ? 'done' : '');
    li.innerHTML = `<span class="n">${i + 1}</span><img alt=""><div><div class="t"></div><div class="c"></div></div>`;
    li.querySelector('img').src = v.thumb; li.querySelector('.t').textContent = v.title; li.querySelector('.c').textContent = v.channel;
    el.queueList.appendChild(li);
  });
}
function showPanel(show, quiet = false) {
  panelOpen = show; renderQueue();
  el.queuePanel.classList.toggle('show', show);
  if (show) after('panel', 9000, () => { panelOpen = false; el.queuePanel.classList.remove('show'); sendState(); });
  else if (!quiet) clearTimeout(timers.panel);
}

// ---- messages ------------------------------------------------------------------
function stateMessage() {
  return {
    t: 'state', code, booted, screen, app: screen === 'app' ? app : 'home', media,
    apps: apps.map((a) => ({ id: a.id, name: a.name, hidden: !!a.hidden, kind: a.kind, url: a.url || '', web: a.web || '', mode: a.mode || 'web' })),
    yt: { view: yt.view, hasKey: !!yt.key, searchQ: yt.searchQ, error: yt.error },
    launched: Date.now() - launchedAt < 15000 ? launched : '',
    focus: { home: focusHome, radio: focusRadio },
    queue: q.queue, index: q.index, playback, pos, dur, volume, muted, volumeControl: !IS_IOS, panel: panelOpen,
    twitch: { channel: twitch.channel, playing: twitch.playing, online: twitch.online },
    radio: { station: radio.station ? radio.station.id : null, playing: radio.playing, buffering: radio.buffering, error: radio.error },
  };
}
let lastSent = 0;
function sendState(conn) {
  const msg = stateMessage();
  if (conn) { try { conn.send(msg); } catch {} return; }
  lastSent = Date.now();
  for (const c of conns) { try { c.send(msg); } catch {} }
}

function handleMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') { setStatus('ok', 'Handy verbunden'); sendState(conn); return; }
  if (msg.t === 'ping') { try { conn.send({ t: 'pong' }); } catch {} return; }
  if (msg.t !== 'cmd') return;
  if (!booted) { try { conn.send({ t: 'needsBoot' }); } catch {} }
  const ytReady = playerReady && current() && media === 'youtube';
  switch (msg.cmd) {
    case 'nav': nav(String(msg.dir)); return;
    case 'select': select(); return;
    case 'back': back(); return;
    case 'home': goHome(); return;
    case 'open': openApp(String(msg.app)); return;
    case 'apps': {
      apps = applyAppConfig(APPS, { order: msg.order, hidden: msg.hidden, launchers: msg.launchers });
      saveJSON('couchkanal.apps', { order: apps.map((a) => a.id), hidden: apps.filter((a) => a.hidden).map((a) => a.id), launchers: apps.filter((a) => a.kind === 'launch').map((a) => ({ id: a.id, name: a.name, url: a.url, web: a.web, mode: a.mode })) });
      focusHome = 0; renderHome(); toast('Apps angepasst'); break;
    }
    case 'toggle': toggleMedia(); break;
    case 'play': if (ytReady) { player.playVideo(); osdCenter('play'); } else toggleMedia(); break;
    case 'pause': if (ytReady) { player.pauseVideo(); osdCenter('pause'); } else if (media === 'twitch' && twitchPlayer) twitchPlayer.pause(); else if (media === 'radio') audio.pause(); break;
    case 'seek': {
      if (!ytReady) break;
      if (typeof msg.to === 'number') { const to = Math.max(0, dur ? Math.min(msg.to, dur - 0.5) : msg.to); player.seekTo(to, true); pos = to; showNow(playback === 'paused'); renderProgress(); }
      else seekBy(Number(msg.by) || 0);
      break;
    }
    case 'next': apply(reduce(q, { type: 'next' })); if (current()) osdCenter('next'); break;
    case 'prev': apply(reduce(q, { type: 'prev', pos })); break;
    case 'enqueue': {
      const v = sanitizeVideo(msg.video); if (!v) break;
      const wasIdle = q.index < 0 || media !== 'youtube';
      const next = reduce(q, { type: 'enqueue', video: v });
      if (wasIdle) { q = { queue: next.queue, index: q.index < 0 ? next.index : q.index }; if (media !== 'youtube') { q.index = q.index < 0 ? next.index : q.index; loadCurrent(); } }
      else { q = { queue: next.queue, index: next.index }; toast(`Angehängt: ${v.title}`); renderNow(); renderQueue(); }
      break;
    }
    case 'playNow': { const v = sanitizeVideo(msg.video); if (v) apply(reduce(q, { type: 'playNow', video: v })); break; }
    case 'jump': apply(reduce(q, { type: 'jump', index: msg.index })); break;
    case 'remove': apply(reduce(q, { type: 'remove', index: msg.index })); toast('Aus der Warteschlange entfernt'); break;
    case 'clear': apply(reduce(q, { type: 'clear' })); toast('Warteschlange geleert'); break;
    case 'volume': volume = Math.max(0, Math.min(100, Math.round(Number(msg.value) || 0))); applyVolume(); break;
    case 'mute': muted = !!msg.muted; applyMute(); break;
    case 'panel': if (screen === 'app' && app === 'youtube') showPanel(!!msg.show); break;
    case 'twitch': openChannel(msg.channel); break;
    case 'radio': { const s = stationById(String(msg.station)); if (s) { focusRadio = STATIONS.indexOf(s); if (!(screen === 'app' && app === 'radio')) setScreen('app', 'radio'); playStation(s); } break; }
    case 'stop': if (media !== 'none') { stopMedia(media); if (screen === 'app' && app === 'youtube') { yt.view = 'browse'; loadYtRows(); renderYt(); } if (screen === 'app' && app === 'radio') renderRadio(); } break;
    case 'apikey': { const k = String(msg.key || '').trim().slice(0, 80); if (k !== yt.key) { yt.key = k; try { k ? localStorage.setItem('couchkanal.apikey', k) : localStorage.removeItem('couchkanal.apikey'); } catch {} yt.rows = {}; yt.loadedAt = 0; yt.error = ''; if (screen === 'app' && app === 'youtube') { loadYtRows(); renderYt(); } } break; }
    case 'search': ytSearch(String(msg.q || '')); break;
    default: break;
  }
  sendState();
}

// ---- peer -------------------------------------------------------------------------
function startPeer() {
  code = localStorage.getItem('couchkanal.code');
  if (!isValidCode(code)) code = makeCode();
  renderCode(code, false);
  setStatus('wait', 'Verbinde mit dem Vermittler');

  peer = new Peer(peerIdFor(code), { debug: 1 });
  peer.on('open', () => {
    idRetries = 0;
    try { localStorage.setItem('couchkanal.code', code); } catch {}
    renderCode(code, true); renderQR();
    setStatus(connected() ? 'ok' : 'wait', connected() ? 'Handy verbunden' : `Warte auf das Handy · Code ${code}`);
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.add(conn);
      setStatus('ok', `Handy verbunden · Code ${code}`);
      renderHome(); sendState(conn);
      if (conns.size === 1) toast('Fernbedienung verbunden');
    });
    conn.on('data', (msg) => handleMessage(conn, msg));
    conn.on('close', () => {
      conns.delete(conn);
      if (!connected()) setStatus('wait', `Handy getrennt · Code ${code} bleibt gültig`);
      renderHome();
    });
    conn.on('error', () => {});
  });
  peer.on('disconnected', () => {
    setStatus('warn', 'Verbindung zum Vermittler verloren, versuche es erneut');
    after('reconnect', 2500, () => { if (peer && !peer.destroyed) peer.reconnect(); });
  });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      peer.destroy(); peer = null;
      if (idRetries++ < 3) { after('idRetry', 2500, startPeer); return; }
      try { localStorage.removeItem('couchkanal.code'); } catch {}
      idRetries = 0; after('idRetry', 400, startPeer); return;
    }
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      setStatus('warn', 'Kein Internet? Ich versuche es weiter');
      after('reconnect', 4000, () => { if (peer && peer.disconnected && !peer.destroyed) peer.reconnect(); });
      return;
    }
    console.warn('peer error', err);
  });
}

// ---- boot & input ------------------------------------------------------------
function silentWav() {
  // 44-byte header + 2 silent samples, enough to unlock the audio element inside the tap
  const b = new Uint8Array(48);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  const u32 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; b[o + 2] = (v >> 16) & 255; b[o + 3] = (v >> 24) & 255; };
  const u16 = (o, v) => { b[o] = v & 255; b[o + 1] = (v >> 8) & 255; };
  w(0, 'RIFF'); u32(4, 40); w(8, 'WAVE'); w(12, 'fmt '); u32(16, 16); u16(20, 1); u16(22, 1); u32(24, 8000); u32(28, 16000); u16(32, 2); u16(34, 16); w(36, 'data'); u32(40, 4);
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return 'data:audio/wav;base64,' + btoa(s);
}
async function boot() {
  if (booted) return;
  booted = true;
  try { audio.src = silentWav(); await audio.play(); audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
  setScreen('home');
  try { await ensurePlayer(); } catch {}
  try { navigator.wakeLock && (await navigator.wakeLock.request('screen')); } catch {}
  sendState();
}
el.boot.addEventListener('pointerdown', boot);
// coming back from a website opened in this tab: skip the tap, the home screen was already running
try { if (sessionStorage.getItem('couchkanal.resume') === '1') { sessionStorage.removeItem('couchkanal.resume'); booted = true; setScreen('home'); ensurePlayer().catch(() => {}); } } catch {}
el.tapToPlay.addEventListener('pointerdown', retryMedia);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && booted) { try { navigator.wakeLock && (await navigator.wakeLock.request('screen')); } catch {} }
});
document.addEventListener('keydown', (e) => {
  if (!booted) { if (e.key === 'Enter' || e.key === ' ') boot(); return; }
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) { nav(map[e.key]); e.preventDefault(); }
  else if (e.key === 'Enter') select();
  else if (e.key === 'Escape' || e.key === 'Backspace') back();
  else if (e.key === 'h' || e.key === 'H') goHome();
  else if (e.key === ' ') { toggleMedia(); e.preventDefault(); }
});

let cursorTimer;
document.addEventListener('mousemove', () => {
  tv.classList.remove('hide-cursor');
  clearTimeout(cursorTimer); cursorTimer = setTimeout(() => tv.classList.add('hide-cursor'), 3000);
});

setInterval(() => {
  if (!playerReady || !current() || media !== 'youtube') return;
  try {
    const p = player.getCurrentTime(), d = player.getDuration();
    if (Number.isFinite(p)) pos = p;
    if (Number.isFinite(d) && d > 0) dur = d;
  } catch {}
  if (el.now.classList.contains('show')) renderProgress();
  if (playback === 'playing' && Date.now() - lastSent > 900) sendState();
}, 500);

tickClock(); setInterval(tickClock, 10_000);
renderCode('····', false);
renderHome();
startPeer();
