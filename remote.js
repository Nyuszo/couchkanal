import { isValidCode, peerIdFor, parseYouTubeInput, thumbFor, formatTime } from './logic.js';

const $ = (s) => document.querySelector(s);
const root = $('#remote');
const el = {
  conn: $('#conn'), connText: $('#connText'), settingsBtn: $('#settingsBtn'),
  pairForm: $('#pairForm'), codeInput: $('#codeInput'), pairBtn: $('#pairBtn'), pairError: $('#pairError'),
  control: $('#controlView'), notice: $('#notice'),
  nowCard: $('#nowCard'), nowGlow: $('#nowGlow'), nowThumb: $('#nowThumb'), nowTitle: $('#nowTitle'), nowChannel: $('#nowChannel'),
  scrub: $('#scrub'), tPos: $('#tPos'), tDur: $('#tDur'),
  playBtn: $('#playBtn'), playIcon: $('#playIcon'),
  volumeRow: $('#volumeRow'), volume: $('#volume'), muteBtn: $('#muteBtn'), muteIcon: $('#muteIcon'), volNote: $('#volNote'),
  tabs: $('.tabs'), tabSearch: $('#tabSearch'), tabQueue: $('#tabQueue'), queueCount: $('#queueCount'),
  searchForm: $('#searchForm'), searchInput: $('#searchInput'), searchBtn: $('#searchBtn'), searchHint: $('#searchHint'), results: $('#results'),
  queueList: $('#queueList'), queueEmpty: $('#queueEmpty'), showOnTv: $('#showOnTv'), clearQueue: $('#clearQueue'),
  settings: $('#settings'), apiKeyInput: $('#apiKeyInput'), saveKey: $('#saveKey'), keyStatus: $('#keyStatus'), tvCode: $('#tvCode'), unpair: $('#unpair'),
  toast: $('#toast'),
};

const LS = { code: 'couchkanal.remote.code', key: 'couchkanal.apikey' };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

let peer = null, conn = null, code = null;
let wantConnected = false, retryDelay = 2000, retryTimer = null, dialTimer = null;
let tv = null, tvAt = 0;           // last state from the TV and when it arrived
let scrubbing = false;
let apiKey = store.get(LS.key) || '';
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };
const timers = {};
function after(name, ms, fn) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }

function toast(text) {
  el.toast.textContent = text; el.toast.classList.add('show');
  after('toast', 2200, () => el.toast.classList.remove('show'));
}
function setConn(kind, text) { el.conn.className = 'conn ' + kind; el.connText.textContent = text; }
function setView(v) { root.dataset.view = v; }
function send(msg) { if (conn && conn.open) { try { conn.send(msg); return true; } catch {} } return false; }
function cmd(c, extra = {}) {
  buzz();
  if (!send({ t: 'cmd', cmd: c, ...extra })) toast('Nicht verbunden');
}

// ---- connection ----------------------------------------------------------------
function connect(c) {
  code = c; wantConnected = true;
  el.pairError.hidden = true;
  setConn('busy', 'Verbinde');
  el.pairBtn.disabled = true;
  if (!peer || peer.destroyed) {
    peer = new Peer({ debug: 1 });
    peer.on('open', dial);
    peer.on('error', onPeerError);
    peer.on('disconnected', () => { if (wantConnected && !peer.destroyed) after('peerReconnect', 2000, () => peer.reconnect()); });
  } else if (peer.open) dial();
}
function dial() {
  if (!wantConnected) return;
  if (conn) { try { conn.close(); } catch {} conn = null; }
  setConn('busy', 'Verbinde');
  const c = peer.connect(peerIdFor(code), { reliable: true, serialization: 'json' });
  conn = c;
  clearTimeout(dialTimer);
  dialTimer = setTimeout(() => { if (conn === c && !c.open) fail('Der Fernseher antwortet nicht. Läuft die Seite auf dem iPad?'); }, 9000);
  c.on('open', () => {
    clearTimeout(dialTimer); retryDelay = 2000;
    store.set(LS.code, code);
    el.pairBtn.disabled = false;
    setView('control'); setConn('ok', 'Verbunden'); el.tvCode.textContent = code;
    send({ t: 'hello', name: 'Handy' });
    toast('Mit dem Fernseher verbunden');
  });
  c.on('data', onData);
  c.on('close', () => { if (conn !== c) return; conn = null; onLost('Verbindung verloren'); });
  c.on('error', () => { if (conn !== c) return; onLost('Verbindung gestört'); });
}
function onPeerError(err) {
  if (err.type === 'peer-unavailable') {
    fail(`Kein Fernseher mit dem Code ${code}. Stimmt der Code, und läuft die Seite auf dem iPad?`);
  } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
    onLost('Kein Internet?');
  } else {
    console.warn('peer error', err);
  }
}
function fail(message) {
  clearTimeout(dialTimer);
  el.pairBtn.disabled = false;
  if (root.dataset.view === 'pair') {
    setConn('off', 'Nicht verbunden');
    el.pairError.textContent = message; el.pairError.hidden = false;
    wantConnected = false;
  } else {
    onLost('Fernseher nicht erreichbar');
  }
}
function onLost(text) {
  if (!wantConnected) return;
  setConn('off', text);
  showNotice(`${text}. Ich versuche es weiter.`);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    if (!wantConnected) return;
    if (peer && peer.disconnected && !peer.destroyed) peer.reconnect();
    if (peer && peer.open) dial();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 1.5, 10000);
}
function disconnect() {
  wantConnected = false; clearTimeout(retryTimer); clearTimeout(dialTimer);
  if (conn) { try { conn.close(); } catch {} conn = null; }
  if (peer) { try { peer.destroy(); } catch {} peer = null; }
  tv = null; store.set(LS.code, null);
  setConn('off', 'Nicht verbunden'); setView('pair');
  el.codeInput.value = ''; el.codeInput.focus();
}

function onData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'state') { tv = msg; tvAt = Date.now(); render(); return; }
  if (msg.t === 'needsBoot') { showNotice('Tippe einmal auf das iPad, damit der Fernseher startet.'); return; }
}

// ---- rendering -----------------------------------------------------------------
function showNotice(text) {
  el.notice.textContent = text; el.notice.hidden = false;
  after('notice', 6000, () => { el.notice.hidden = true; });
}
function currentVideo() { return tv && tv.index >= 0 ? tv.queue[tv.index] : null; }

let lastPlayIcon = '';
function render() {
  if (!tv) return;
  const v = currentVideo();
  const playing = tv.playback === 'playing' || tv.playback === 'buffering';
  setConn('ok', 'Verbunden');

  // now card
  el.nowCard.classList.toggle('has-video', !!v);
  if (v) {
    if (el.nowThumb.src !== v.thumb) { el.nowThumb.src = v.thumb; el.nowGlow.src = v.thumb; }
    el.nowTitle.textContent = v.title;
    el.nowChannel.textContent = tv.playback === 'blocked' ? 'Wartet auf einen Tipp am iPad' : (v.channel || ' ');
  } else {
    el.nowTitle.textContent = tv.queue.length ? 'Warteschlange durchgespielt' : 'Nichts läuft';
    el.nowChannel.textContent = tv.booted ? 'Such dir unten etwas aus.' : 'Tippe einmal auf das iPad, um den Fernseher zu starten.';
  }
  el.control.classList.toggle('inactive', !v);
  el.scrub.disabled = !v;

  // play button
  const icon = playing ? '#i-pause' : '#i-play';
  if (icon !== lastPlayIcon) {
    el.playIcon.setAttribute('href', icon); lastPlayIcon = icon;
    el.playBtn.classList.remove('pop'); void el.playBtn.offsetWidth; el.playBtn.classList.add('pop');
  }

  // volume
  const hw = tv.volumeControl === false;
  el.volume.hidden = hw; el.volNote.hidden = !hw;
  if (!hw && document.activeElement !== el.volume) { el.volume.value = tv.volume; el.volume.style.setProperty('--pct', tv.volume + '%'); }
  el.muteIcon.setAttribute('href', tv.muted ? '#i-mute' : '#i-vol');

  // notices
  if (tv.playback === 'blocked') showNotice('Das iPad braucht einmal einen Tipp auf den Bildschirm, dann startet das Video.');

  renderQueue();
  renderTimes();
}

function livePos() {
  if (!tv) return 0;
  const extra = tv.playback === 'playing' ? (Date.now() - tvAt) / 1000 : 0;
  return Math.min(tv.dur || Infinity, tv.pos + extra);
}
function renderTimes() {
  if (!tv) return;
  const v = currentVideo();
  const p = v ? livePos() : 0, d = v ? (tv.dur || 0) : 0;
  if (!scrubbing) {
    const val = d ? Math.round(p / d * 1000) : 0;
    el.scrub.value = val; el.scrub.style.setProperty('--pct', (val / 10) + '%');
    el.tPos.textContent = formatTime(p);
  }
  el.tDur.textContent = d ? formatTime(d) : (v && v.duration ? formatTime(v.duration) : '0:00');
}
(function loop() { renderTimes(); requestAnimationFrame(loop); })();

function rowHTML(v, side) {
  return `<button class="row-main"><span class="thumb-wrap"><img alt="" loading="lazy"><span class="dur" hidden></span></span><span class="row-text"><span class="t"></span><span class="c"></span></span></button>${side}`;
}
function fillRow(li, v) {
  li.querySelector('img').src = v.thumb;
  const d = li.querySelector('.dur'); if (v.duration) { d.textContent = formatTime(v.duration); d.hidden = false; }
  li.querySelector('.t').textContent = v.title;
  li.querySelector('.c').textContent = v.channel || '';
}
function renderQueue() {
  const n = tv ? tv.queue.length : 0;
  const prev = el.queueCount.textContent;
  el.queueCount.textContent = n; el.queueCount.hidden = !n;
  if (String(n) !== prev && n) { el.queueCount.classList.remove('bump'); void el.queueCount.offsetWidth; el.queueCount.classList.add('bump'); }
  el.queueEmpty.hidden = !!n;
  el.queueList.innerHTML = '';
  if (!tv) return;
  tv.queue.forEach((v, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', Math.min(i, 12));
    li.className = i === tv.index ? 'current' : (tv.index >= 0 && i < tv.index ? 'done' : '');
    li.innerHTML = rowHTML(v, `<button class="row-side" aria-label="Entfernen"><svg class="icon"><use href="#i-trash"/></svg></button>`);
    fillRow(li, v);
    if (i === tv.index) li.querySelector('.c').innerHTML = `<span class="chip">Läuft</span>`;
    li.querySelector('.row-main').addEventListener('click', () => { if (i !== tv.index) cmd('jump', { index: i }); });
    li.querySelector('.row-side').addEventListener('click', () => cmd('remove', { index: i }));
    el.queueList.appendChild(li);
  });
}
function renderResults(list, heading) {
  el.results.innerHTML = '';
  setHint(heading, '');
  list.forEach((v, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', Math.min(i, 12));
    li.innerHTML = rowHTML(v, `<button class="row-side" aria-label="An die Warteschlange anhängen"><svg class="icon"><use href="#i-plus"/></svg></button>`);
    fillRow(li, v);
    li.querySelector('.row-main').addEventListener('click', () => { cmd('playNow', { video: v }); toast(`Läuft jetzt: ${v.title}`); });
    li.querySelector('.row-side').addEventListener('click', (e) => {
      cmd('enqueue', { video: v }); toast(`Angehängt: ${v.title}`);
      e.currentTarget.innerHTML = '<svg class="icon"><use href="#i-plus"/></svg>';
    });
    el.results.appendChild(li);
  });
}
function setHint(text, kind) {
  el.searchHint.className = 'hint ' + kind;
  el.searchHint.innerHTML = '';
  if (text) el.searchHint.textContent = text;
}
function hintNoKey(q) {
  el.searchHint.className = 'hint';
  el.searchHint.innerHTML = '';
  el.searchHint.append(q ? `Für die Suche nach „${q}“ fehlt noch der kostenlose Suchschlüssel. ` : 'Suchen braucht einmalig einen kostenlosen Schlüssel von Google, Links funktionieren sofort. ');
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Suche einrichten';
  b.addEventListener('click', openSettings);
  el.searchHint.appendChild(b);
}

// ---- search ----------------------------------------------------------------------
const decoder = document.createElement('textarea');
const decode = (s) => { decoder.innerHTML = s; return decoder.value; };
function isoDuration(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
}
async function describeVideo(id, start) {
  let title = 'YouTube-Video', channel = '';
  try {
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    const j = await r.json();
    if (j.title) title = j.title;
    if (j.author_name) channel = j.author_name;
  } catch {}
  return { id, title, channel, thumb: thumbFor(id), start, duration: 0 };
}
function apiError(j) {
  const reason = j?.error?.errors?.[0]?.reason || '';
  const map = {
    quotaExceeded: 'Das Tageskontingent der Suche ist aufgebraucht. Morgen geht es weiter, Links funktionieren weiterhin.',
    keyInvalid: 'Der Suchschlüssel ist ungültig. Prüfe ihn in den Einstellungen.',
    accessNotConfigured: 'Für diesen Schlüssel ist „YouTube Data API v3“ noch nicht aktiviert.',
    ipRefererBlocked: 'Der Schlüssel ist auf andere Webseiten beschränkt. Entferne die Einschränkung in der Google Cloud Console.',
  };
  return new Error(map[reason] || (j?.error?.message ? 'Google meldet: ' + j.error.message : 'Suche fehlgeschlagen'));
}
async function searchYouTube(q, key) {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.search = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '20', q, key, relevanceLanguage: 'de' });
  const r = await fetch(u); const j = await r.json();
  if (!r.ok) throw apiError(j);
  const items = (j.items || []).filter(i => i.id && i.id.videoId);
  const durations = {};
  try {
    const u2 = new URL('https://www.googleapis.com/youtube/v3/videos');
    u2.search = new URLSearchParams({ part: 'contentDetails', id: items.map(i => i.id.videoId).join(','), key });
    const r2 = await fetch(u2); const j2 = await r2.json();
    if (r2.ok) for (const v of j2.items || []) durations[v.id] = isoDuration(v.contentDetails?.duration);
  } catch {}
  return items.map(i => ({
    id: i.id.videoId, title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle || ''),
    thumb: thumbFor(i.id.videoId), start: 0, duration: durations[i.id.videoId] || 0,
  }));
}
async function runSearch(text) {
  const p = parseYouTubeInput(text);
  if (!p) return;
  el.searchInput.blur();
  if (p.kind === 'playlist') { setHint('Playlists kann ich noch nicht. Kopiere den Link eines einzelnen Videos.', 'error'); return; }
  el.searchBtn.disabled = true;
  try {
    if (p.kind === 'video') {
      setHint('Lese den Link', 'busy');
      const v = await describeVideo(p.id, p.start);
      renderResults([v], 'Gefunden. Antippen spielt es sofort, das Plus hängt es an.');
      return;
    }
    if (!apiKey) { el.results.innerHTML = ''; hintNoKey(p.q); return; }
    setHint(`Suche nach „${p.q}“`, 'busy');
    const list = await searchYouTube(p.q, apiKey);
    renderResults(list, list.length ? `${list.length} Treffer für „${p.q}“` : `Nichts gefunden für „${p.q}“`);
  } catch (e) {
    el.results.innerHTML = '';
    setHint(e.message || 'Suche fehlgeschlagen', 'error');
  } finally {
    el.searchBtn.disabled = false;
  }
}

// ---- settings ----------------------------------------------------------------------
function openSettings() {
  el.apiKeyInput.value = apiKey;
  el.keyStatus.textContent = apiKey ? 'Ein Schlüssel ist gespeichert. Die Suche ist aktiv.' : 'Noch kein Schlüssel gespeichert.';
  el.tvCode.textContent = code || '----';
  if (typeof el.settings.showModal === 'function') el.settings.showModal(); else el.settings.setAttribute('open', '');
}
el.settingsBtn.addEventListener('click', () => { buzz(); openSettings(); });
el.saveKey.addEventListener('click', () => {
  apiKey = el.apiKeyInput.value.trim();
  store.set(LS.key, apiKey || null);
  el.keyStatus.textContent = apiKey ? 'Gespeichert. Die Suche ist aktiv.' : 'Schlüssel entfernt. Links funktionieren weiterhin.';
  if (!apiKey) hintNoKey(''); else setHint('Suche bereit.', '');
  toast(apiKey ? 'Suchschlüssel gespeichert' : 'Suchschlüssel entfernt');
});
el.unpair.addEventListener('click', () => { el.settings.close(); disconnect(); });

// ---- wiring --------------------------------------------------------------------------
el.pairForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = el.codeInput.value.trim();
  if (!isValidCode(c)) { el.pairError.textContent = 'Der Code hat vier Ziffern.'; el.pairError.hidden = false; return; }
  buzz(); connect(c);
});
el.codeInput.addEventListener('input', () => {
  el.codeInput.value = el.codeInput.value.replace(/\D/g, '').slice(0, 4);
  if (el.codeInput.value.length === 4) el.pairForm.requestSubmit();
});

document.querySelectorAll('.t-btn').forEach((b) => {
  b.addEventListener('click', () => {
    const c = b.dataset.cmd;
    if (c === 'back10') cmd('seek', { by: -10 });
    else if (c === 'fwd10') cmd('seek', { by: 10 });
    else if (c === 'toggle') {
      // optimistic flip, the TV confirms with its next state
      const playing = tv && (tv.playback === 'playing' || tv.playback === 'buffering');
      if (tv) { tv.playback = playing ? 'paused' : 'playing'; tv.pos = livePos(); tvAt = Date.now(); render(); }
      cmd('toggle');
    } else cmd(c);
  });
});
el.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
el.scrub.addEventListener('input', () => {
  scrubbing = true;
  const d = tv?.dur || 0; const p = el.scrub.value / 1000 * d;
  el.scrub.style.setProperty('--pct', (el.scrub.value / 10) + '%');
  el.tPos.textContent = formatTime(p);
});
el.scrub.addEventListener('change', () => {
  const d = tv?.dur || 0; const to = el.scrub.value / 1000 * d;
  scrubbing = false;
  if (tv) { tv.pos = to; tvAt = Date.now(); }
  cmd('seek', { to });
});
el.volume.addEventListener('input', () => {
  el.volume.style.setProperty('--pct', el.volume.value + '%');
  after('vol', 90, () => cmd('volume', { value: Number(el.volume.value) }));
});
el.muteBtn.addEventListener('click', () => cmd('mute', { muted: !(tv && tv.muted) }));

el.tabs.querySelectorAll('[role="tab"]').forEach((b) => {
  b.addEventListener('click', () => {
    buzz();
    const t = b.dataset.tab;
    el.tabs.dataset.active = t;
    el.tabs.querySelectorAll('[role="tab"]').forEach((x) => x.setAttribute('aria-selected', x === b));
    el.tabSearch.hidden = t !== 'search'; el.tabQueue.hidden = t !== 'queue';
    const panel = t === 'search' ? el.tabSearch : el.tabQueue;
    panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
  });
});
el.searchForm.addEventListener('submit', (e) => { e.preventDefault(); runSearch(el.searchInput.value); });
el.searchInput.addEventListener('paste', () => setTimeout(() => {
  const p = parseYouTubeInput(el.searchInput.value);
  if (p && p.kind === 'video') runSearch(el.searchInput.value);
}, 0));
el.showOnTv.addEventListener('click', () => cmd('panel', { show: !(tv && tv.panel) }));
let clearArmed = false;
el.clearQueue.addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true; el.clearQueue.classList.add('confirm'); el.clearQueue.lastChild.textContent = 'Wirklich leeren?';
    after('clearArm', 3000, () => { clearArmed = false; el.clearQueue.classList.remove('confirm'); el.clearQueue.lastChild.textContent = 'Leeren'; });
    return;
  }
  clearArmed = false; el.clearQueue.classList.remove('confirm'); el.clearQueue.lastChild.textContent = 'Leeren';
  cmd('clear');
});

// ---- start ---------------------------------------------------------------------------
if (!apiKey) hintNoKey(''); else setHint('Suche bereit. Tipp ein Stichwort oder füge einen Link ein.', '');
const saved = store.get(LS.code);
if (isValidCode(saved)) { el.codeInput.value = saved; connect(saved); }
else setTimeout(() => el.codeInput.focus(), 300);
