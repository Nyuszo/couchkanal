import { isValidCode, peerIdFor, parseYouTubeInput, thumbFor, formatTime, APPS, STATIONS, stationById, normalizeWebUrl, loadFirst, PEER_URLS } from './logic.js?v=202611032107';

const $ = (s) => document.querySelector(s);
const root = $('#remote');
const el = {
  conn: $('#conn'), connText: $('#connText'), settingsBtn: $('#settingsBtn'),
  pairForm: $('#pairForm'), codeInput: $('#codeInput'), boxes: [...document.querySelectorAll('.boxes span')], pairBtn: $('#pairBtn'), pairError: $('#pairError'),
  control: $('#controlView'), notice: $('#notice'),
  appstrip: $('#appstrip'),
  sysToggleIcon: $('#sysToggleIcon'), sysToggleLabel: $('#sysToggleLabel'), muteBtn: $('#muteBtn'), muteIcon: $('#muteIcon'), muteLabel: $('#muteLabel'),
  volumeRow: $('#volumeRow'), volume: $('#volume'),
  panels: { home: $('#panelHome'), youtube: $('#panelYoutube'), twitch: $('#panelTwitch'), radio: $('#panelRadio'), clock: $('#panelClock'), web: $('#panelWeb') },
  webForm: $('#webForm'), webInput: $('#webInput'), webError: $('#webError'), webRecent: $('#webRecent'),
  nowMini: $('#nowMini'), miniArt: $('#miniArt'), miniImg: $('#miniImg'), miniWord: $('#miniWord'), miniKicker: $('#miniKicker'), miniTitle: $('#miniTitle'), miniPlay: $('#miniPlay'), miniPlayIcon: $('#miniPlayIcon'),
  ytDial: $('#ytDial'), ytBrowseHint: $('#ytBrowseHint'), scrubWrap: document.querySelector('#panelYoutube .scrub'), transport: document.querySelector('#panelYoutube .transport'), addLauncher: $('#addLauncher'),
  hero: $('#hero'), nowCard: $('#nowCard'), nowGlow: $('#nowGlow'), nowThumb: $('#nowThumb'), nowTitle: $('#nowTitle'), nowChannel: $('#nowChannel'), emptyTitle: $('#emptyTitle'), emptyText: $('#emptyText'),
  scrub: $('#scrub'), tPos: $('#tPos'), tDur: $('#tDur'),
  playBtn: $('#playBtn'), playIcon: $('#playIcon'),
  tabs: $('.tabs'), tabSearch: $('#tabSearch'), tabQueue: $('#tabQueue'), queueCount: $('#queueCount'),
  searchForm: $('#searchForm'), searchInput: $('#searchInput'), searchBtn: $('#searchBtn'), searchHint: $('#searchHint'), results: $('#results'),
  queueList: $('#queueList'), queueEmpty: $('#queueEmpty'), showOnTv: $('#showOnTv'), clearQueue: $('#clearQueue'),
  twHero: $('#twHero'), twCard: $('#twCard'), twGlow: $('#twGlow'), twThumb: $('#twThumb'), twTitle: $('#twTitle'), twSub: $('#twSub'), twForm: $('#twForm'), twInput: $('#twInput'), twFavs: $('#twFavs'),
  radioHero: $('#radioHero'), radioBars: $('#radioBars'), radioTitle: $('#radioTitle'), radioSub: $('#radioSub'), radioStop: $('#radioStop'), stationList: $('#stationList'),
  settings: $('#settings'), appsConfig: $('#appsConfig'), applyApps: $('#applyApps'), apiKeyInput: $('#apiKeyInput'), saveKey: $('#saveKey'), keyStatus: $('#keyStatus'), tvCode: $('#tvCode'), unpair: $('#unpair'),
  toast: $('#toast'),
};
const CHIP_COLORS = { youtube: '#ff0000', twitch: '#a970ff', radio: '#ffb454', clock: '#8f9bff', web: '#5aa0ff', netflix: '#e50914', prime: '#00a8e1', disney: '#6b8cff', appletv: '#c7c7cc', spotify: '#1ed760', ard: '#6b8cff', zdf: '#f27e1a', arte: '#ff5200', joyn: '#00d4c8' };

const LS = { code: 'couchkanal.remote.code', key: 'couchkanal.apikey', twFavs: 'couchkanal.twitch.favs' };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  json(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
};

let peer = null, conn = null, code = null;
let wantConnected = false, retryDelay = 2000, retryTimer = null, dialTimer = null;
let tv = null, tvAt = 0;
let scrubbing = false;
let apiKey = store.get(LS.key) || '';
let twFavs = Array.isArray(store.json(LS.twFavs)) ? store.json(LS.twFavs) : [];
let appsDraft = null;
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };
const timers = {};
function after(name, ms, fn) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }

function toast(text) { el.toast.textContent = text; el.toast.classList.add('show'); after('toast', 2200, () => el.toast.classList.remove('show')); }
function setConn(kind, text) { el.conn.className = 'conn ' + kind; el.connText.textContent = text; }
function setView(v) { root.dataset.view = v; }
function send(msg) { if (conn && conn.open) { try { conn.send(msg); return true; } catch {} } return false; }
function cmd(c, extra = {}) { buzz(); if (!send({ t: 'cmd', cmd: c, ...extra })) toast('Nicht verbunden'); }

// ---- connection ----------------------------------------------------------------
async function connect(c) {
  code = c; wantConnected = true;
  el.pairError.hidden = true;
  setConn('busy', 'Verbinde'); el.pairBtn.disabled = true;
  if (typeof window.Peer !== 'function') {
    try { await loadFirst(PEER_URLS, () => typeof window.Peer === 'function'); }
    catch (e) { wantConnected = false; fail('Der Verbindungs-Baustein konnte nicht geladen werden. Internet prüfen, Inhaltsblocker für diese Seite ausschalten.'); return; }
    if (!wantConnected) return;
  }
  if (!peer || peer.destroyed) {
    peer = new Peer({ debug: 0 });
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
    store.set(LS.code, code); el.pairBtn.disabled = false;
    setView('control'); setConn('ok', 'Verbunden'); el.tvCode.textContent = code;
    send({ t: 'hello', name: 'Handy' });
    if (apiKey) send({ t: 'cmd', cmd: 'apikey', key: apiKey });
    toast('Mit dem Fernseher verbunden');
  });
  c.on('data', onData);
  c.on('close', () => { if (conn !== c) return; conn = null; onLost('Verbindung verloren'); });
  c.on('error', () => { if (conn !== c) return; onLost('Verbindung gestört'); });
}
function onPeerError(err) {
  if (err.type === 'peer-unavailable') fail(`Kein Fernseher mit dem Code ${code}. Stimmt der Code, und läuft die Seite auf dem iPad?`);
  else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) onLost('Kein Internet?');
  else console.warn('peer error', err);
}
function fail(message) {
  clearTimeout(dialTimer); el.pairBtn.disabled = false;
  if (root.dataset.view === 'pair') { setConn('off', 'Nicht verbunden'); el.pairError.textContent = message; el.pairError.hidden = false; wantConnected = false; }
  else onLost('Fernseher nicht erreichbar');
}
function onLost(text) {
  if (!wantConnected) return;
  setConn('off', text); showNotice(`${text}. Ich versuche es weiter.`);
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
  el.codeInput.value = ''; renderBoxes(); el.codeInput.focus();
}
function onData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'state') { tv = msg; tvAt = Date.now(); render(); return; }
  if (msg.t === 'needsBoot') { showNotice('Tippe einmal auf das iPad, damit der Fernseher startet.'); }
}

// ---- rendering -----------------------------------------------------------------
function showNotice(text) { el.notice.textContent = text; el.notice.hidden = false; after('notice', 6000, () => { el.notice.hidden = true; }); }
function currentVideo() { return tv && tv.index >= 0 ? tv.queue[tv.index] : null; }
function mediaPlaying() {
  if (!tv) return false;
  if (tv.media === 'youtube') return tv.playback === 'playing' || tv.playback === 'buffering';
  if (tv.media === 'twitch') return !!tv.twitch?.playing;
  if (tv.media === 'radio') return !!tv.radio?.playing;
  return false;
}
let lastPanel = '', lastPlayIcon = '', lastLaunched = '', lastYtError = '';
function render() {
  if (!tv) return;
  setConn('ok', 'Verbunden');
  const app = tv.screen === 'app' ? tv.app : 'home';

  // app strip
  renderStrip(app);

  // panel
  if (app !== lastPanel) {
    for (const [id, p] of Object.entries(el.panels)) p.hidden = id !== app;
    const p = el.panels[app]; if (p) { p.style.animation = 'none'; void p.offsetWidth; p.style.animation = ''; }
    lastPanel = app;
  }

  // system row
  const playing = mediaPlaying();
  el.sysToggleIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
  el.sysToggleLabel.textContent = playing ? 'Pause' : 'Play';
  el.muteIcon.setAttribute('href', tv.muted ? '#i-mute' : '#i-vol');
  el.muteLabel.textContent = tv.muted ? 'Stumm' : 'Ton';
  el.muteBtn.classList.toggle('on', !!tv.muted);
  const hw = tv.volumeControl === false;
  el.volumeRow.hidden = hw || tv.media === 'none';
  if (!hw && document.activeElement !== el.volume) { el.volume.value = tv.volume; el.volume.style.setProperty('--pct', tv.volume + '%'); }

  if (!tv.booted) showNotice('Der Fernseher ist noch nicht gestartet: einmal auf das iPad tippen.');
  if (tv.launched && tv.launched !== lastLaunched) {
    lastLaunched = tv.launched;
    const la = (tv.apps || []).find((a) => a.name === tv.launched);
    const asApp = la && la.mode === 'app' && la.url;
    showNotice(asApp
      ? `${tv.launched} läuft jetzt als App auf dem iPad. Zurück zu Couchkanal über den Home-Bildschirm des iPads.`
      : `${tv.launched} ist auf dem iPad geöffnet. Zurück zu Couchkanal mit „Fertig“ oben links, in Safari mit der Zurück-Taste.`);
  }
  if (!tv.launched) lastLaunched = '';
  const browsing = app === 'youtube' && tv.yt && tv.yt.view === 'browse';
  el.ytDial.hidden = !browsing; el.ytBrowseHint.hidden = !browsing;
  el.scrubWrap.hidden = browsing; el.transport.hidden = browsing;
  if (tv.yt && tv.yt.error && tv.yt.error !== lastYtError) { lastYtError = tv.yt.error; showNotice('Fernseher: ' + tv.yt.error); }

  renderYoutube(playing);
  renderTwitch();
  renderRadio();
  renderMini(playing);
  renderWeb();
  renderTimes();
}
function renderWeb() {
  const list = (tv.web && Array.isArray(tv.web.recent)) ? tv.web.recent : [];
  const key = list.map((e) => e.url).join('|');
  if (el.webRecent.dataset.key === key) return;
  el.webRecent.dataset.key = key; el.webRecent.innerHTML = '';
  list.forEach((e) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip-btn'; b.textContent = e.host;
    b.addEventListener('click', () => { cmd('web', { url: e.url }); toast(`Öffne ${e.host} auf dem iPad`); });
    el.webRecent.appendChild(b);
  });
}
function renderMini(playing) {
  const m = tv.media;
  el.nowMini.hidden = m === 'none';
  if (m === 'none') return;
  let title = '', img = '', word = '', hue = null;
  if (m === 'youtube') { const v = currentVideo(); title = v ? v.title : ''; img = v ? v.thumb : ''; }
  if (m === 'twitch') { title = `Twitch: ${tv.twitch?.channel || ''}`; img = tv.twitch?.channel ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${tv.twitch.channel}-320x180.jpg?t=${Math.floor(Date.now() / 60000)}` : ''; }
  if (m === 'radio') { const st = tv.radio?.station ? stationById(tv.radio.station) : null; title = st ? st.name : ''; word = st ? st.name.slice(0, 3) : ''; hue = st ? st.hue : 36; }
  el.miniTitle.textContent = title;
  el.miniKicker.textContent = playing ? 'Läuft gerade' : 'Pausiert';
  if (img) { if (el.miniImg.getAttribute('src') !== img) el.miniImg.src = img; el.miniImg.hidden = false; el.miniWord.hidden = true; }
  else { el.miniImg.hidden = true; el.miniWord.hidden = false; el.miniWord.textContent = word; }
  el.miniArt.style.setProperty('--hue', hue == null ? 36 : hue);
  el.miniArt.classList.toggle('word', !img);
  el.miniPlayIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
}
function renderStrip(app) {
  const items = [{ id: 'home', name: 'Start' }, ...(tv.apps || APPS).filter((a) => !a.hidden)];
  const key = items.map((a) => a.id + ':' + a.name).join(',') + '|' + app + '|' + tv.media;
  if (el.appstrip.dataset.key === key) return;
  el.appstrip.dataset.key = key;
  el.appstrip.innerHTML = '';
  items.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'app-chip' + (a.id === app ? ' current' : '') + (tv.media === a.id ? ' live' : '');
    b.style.setProperty('--chip', a.id === 'home' ? 'var(--paper-dim)' : CHIP_COLORS[a.id] || 'var(--paper-dim)');
    const icon = a.id === 'home' ? '#i-home' : (a.kind === 'launch' ? '#i-open' : '#l-' + a.id);
    b.innerHTML = `<svg class="icon"><use href="${icon}"/></svg><span></span><span class="live-dot"></span>`;
    b.querySelector('span').textContent = a.name;
    b.addEventListener('click', () => { a.id === 'home' ? cmd('home') : cmd('open', { app: a.id }); });
    el.appstrip.appendChild(b);
  });
  const cur = el.appstrip.querySelector('.current'); if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function renderYoutube(playing) {
  const v = currentVideo();
  const has = !!v && tv.media === 'youtube';
  el.hero.classList.toggle('has-video', has); el.nowCard.classList.toggle('has-video', has);
  if (has) {
    if (el.nowThumb.getAttribute('src') !== v.thumb) { el.nowThumb.src = v.thumb; el.nowGlow.src = v.thumb; }
    el.nowTitle.textContent = v.title;
    el.nowChannel.textContent = tv.playback === 'blocked' ? 'Wartet auf einen Tipp am iPad' : (v.channel || ' ');
  } else {
    el.emptyTitle.textContent = tv.queue.length ? 'Warteschlange durchgespielt' : 'Nichts läuft';
    el.emptyText.textContent = 'Such dir unten etwas aus oder füge einen Link ein.';
  }
  el.panels.youtube.classList.toggle('inactive', !has);
  el.scrub.disabled = !has;
  const ytPlaying = has && (tv.playback === 'playing' || tv.playback === 'buffering');
  const icon = ytPlaying ? '#i-pause' : '#i-play';
  if (icon !== lastPlayIcon) { el.playIcon.setAttribute('href', icon); lastPlayIcon = icon; el.playBtn.classList.remove('pop'); void el.playBtn.offsetWidth; el.playBtn.classList.add('pop'); }
  if (tv.playback === 'blocked') showNotice('Das iPad braucht einmal einen Tipp auf den Bildschirm, dann startet das Video.');
  renderQueue();
}
function renderTwitch() {
  const t = tv.twitch || {};
  const has = !!t.channel;
  el.twHero.classList.toggle('has-video', has); el.twCard.classList.toggle('has-video', has); el.twCard.classList.toggle('offline', t.online === false);
  if (has) {
    const src = `https://static-cdn.jtvnw.net/previews-ttv/live_user_${t.channel}-640x360.jpg?t=${Math.floor(Date.now() / 60000)}`;
    if (el.twThumb.getAttribute('src') !== src) { el.twThumb.src = src; el.twGlow.src = src; }
    el.twTitle.textContent = t.channel;
    el.twSub.textContent = t.online === false ? 'Gerade offline' : (t.playing ? 'Live auf dem Fernseher' : 'Stream geladen, auf Play warten');
  }
  renderTwFavs(t.channel);
}
function renderTwFavs(current) {
  el.twFavs.innerHTML = '';
  twFavs.forEach((ch) => {
    const b = document.createElement('button'); b.className = 'chip-btn' + (ch === current ? ' current' : ''); b.textContent = ch; b.type = 'button';
    let hold;
    b.addEventListener('pointerdown', () => { hold = setTimeout(() => { twFavs = twFavs.filter((x) => x !== ch); store.set(LS.twFavs, JSON.stringify(twFavs)); renderTwFavs(current); toast(`${ch} entfernt`); hold = null; }, 650); });
    const cancel = () => { if (hold) { clearTimeout(hold); } };
    b.addEventListener('pointerup', () => { if (hold) { cancel(); openTwitch(ch); } });
    b.addEventListener('pointerleave', cancel); b.addEventListener('pointercancel', cancel);
    el.twFavs.appendChild(b);
  });
}
function openTwitch(name) {
  const ch = String(name || '').trim().toLowerCase().replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').replace(/[^a-z0-9_]/g, '').slice(0, 25);
  if (!ch) return;
  cmd('twitch', { channel: ch });
  twFavs = [ch, ...twFavs.filter((x) => x !== ch)].slice(0, 8);
  store.set(LS.twFavs, JSON.stringify(twFavs));
  el.twInput.value = ''; el.twInput.blur();
  toast(`Öffne ${ch} auf dem Fernseher`);
}
function renderRadio() {
  const r = tv.radio || {};
  const st = r.station ? stationById(r.station) : null;
  const live = !!st && tv.media === 'radio';
  el.radioHero.style.setProperty('--hue', live ? st.hue : 36);
  el.radioBars.classList.toggle('still', !(live && r.playing));
  el.radioTitle.textContent = live ? st.name : 'Kein Sender';
  el.radioSub.textContent = live ? (r.error ? `Sender ${r.error}` : (r.buffering ? 'Lädt' : (r.playing ? 'Läuft auf dem Fernseher' : 'Pausiert'))) : 'Tippe unten auf einen Sender.';
  el.radioStop.hidden = !live;
  const key = (live ? st.id : '') + '|' + (live && r.playing ? '1' : '0');
  if (el.stationList.dataset.key === key) return;
  el.stationList.dataset.key = key;
  el.stationList.innerHTML = '';
  STATIONS.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'station-btn' + (live && st.id === s.id ? ' playing' : ''); b.type = 'button';
    b.style.setProperty('--hue', s.hue); b.style.setProperty('--i', i);
    b.innerHTML = `<span class="bars${live && st.id === s.id && !r.playing ? ' still' : ''}"><i></i><i></i><i></i><i></i></span><span class="s-name"></span><span class="s-tag"></span>`;
    b.querySelector('.s-name').textContent = s.name; b.querySelector('.s-tag').textContent = s.tag;
    b.addEventListener('click', () => { cmd('radio', { station: s.id }); toast(`${s.name} läuft gleich`); });
    li.appendChild(b); el.stationList.appendChild(li);
  });
}

function livePos() {
  if (!tv) return 0;
  const extra = tv.playback === 'playing' ? (Date.now() - tvAt) / 1000 : 0;
  return Math.min(tv.dur || Infinity, tv.pos + extra);
}
function renderTimes() {
  if (!tv) return;
  const v = currentVideo();
  const has = !!v && tv.media === 'youtube';
  const p = has ? livePos() : 0, d = has ? (tv.dur || 0) : 0;
  if (!scrubbing) {
    const val = d ? Math.round(p / d * 1000) : 0;
    el.scrub.value = val; el.scrub.style.setProperty('--pct', (val / 10) + '%');
    el.tPos.textContent = formatTime(p);
  }
  el.tDur.textContent = d ? formatTime(d) : (has && v.duration ? formatTime(v.duration) : '0:00');
}
(function loop() { renderTimes(); requestAnimationFrame(loop); })();

function rowHTML(side) {
  return `<button class="row-main"><span class="thumb-wrap"><img alt="" loading="lazy"><span class="dur" hidden></span></span><span class="row-text"><span class="t"></span><span class="c"></span></span></button>${side}`;
}
function fillRow(li, v) {
  li.querySelector('img').src = v.thumb;
  const d = li.querySelector('.dur'); if (v.duration) { d.textContent = formatTime(v.duration); d.hidden = false; }
  li.querySelector('.t').textContent = v.title; li.querySelector('.c').textContent = v.channel || '';
}
let lastQueueKey = '';
function renderQueue() {
  const n = tv ? tv.queue.length : 0;
  const prev = el.queueCount.textContent;
  el.queueCount.textContent = n; el.queueCount.hidden = !n;
  if (String(n) !== prev && n) { el.queueCount.classList.remove('bump'); void el.queueCount.offsetWidth; el.queueCount.classList.add('bump'); }
  el.queueEmpty.hidden = !!n;
  const key = tv ? tv.queue.map((v) => v.id).join(',') + '|' + tv.index : '';
  if (key === lastQueueKey) return;
  lastQueueKey = key;
  el.queueList.innerHTML = '';
  if (!tv) return;
  tv.queue.forEach((v, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', Math.min(i, 12));
    li.className = i === tv.index ? 'current' : (tv.index >= 0 && i < tv.index ? 'done' : '');
    li.innerHTML = rowHTML(`<button class="row-side" aria-label="Entfernen"><svg class="icon"><use href="#i-trash"/></svg></button>`);
    fillRow(li, v);
    if (i === tv.index) li.querySelector('.c').innerHTML = `<span class="chip">Läuft</span>`;
    li.querySelector('.row-main').addEventListener('click', () => { if (i !== tv.index) cmd('jump', { index: i }); });
    li.querySelector('.row-side').addEventListener('click', () => cmd('remove', { index: i }));
    el.queueList.appendChild(li);
  });
}
function renderResults(list, heading) {
  el.results.innerHTML = ''; setHint(heading, '');
  list.forEach((v, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', Math.min(i, 12));
    li.innerHTML = rowHTML(`<button class="row-side" aria-label="An die Warteschlange anhängen"><svg class="icon"><use href="#i-plus"/></svg></button>`);
    fillRow(li, v);
    li.querySelector('.row-main').addEventListener('click', () => { cmd('playNow', { video: v }); toast(`Läuft jetzt: ${v.title}`); });
    li.querySelector('.row-side').addEventListener('click', () => { cmd('enqueue', { video: v }); toast(`Angehängt: ${v.title}`); });
    el.results.appendChild(li);
  });
}
function setHint(text, kind) { el.searchHint.className = 'hint ' + kind; el.searchHint.innerHTML = ''; if (text) el.searchHint.textContent = text; }
function hintNoKey(q) {
  el.searchHint.className = 'hint'; el.searchHint.innerHTML = '';
  el.searchHint.append(q ? `Für die Suche nach „${q}“ fehlt noch der kostenlose Suchschlüssel. ` : 'Suchen braucht einmalig einen kostenlosen Schlüssel von Google, Links funktionieren sofort. ');
  const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Suche einrichten'; b.addEventListener('click', openSettings);
  el.searchHint.appendChild(b);
}

// ---- search ----------------------------------------------------------------------
const decoder = document.createElement('textarea');
const decode = (s) => { decoder.innerHTML = s; return decoder.value; };
function isoDuration(iso) { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || ''); return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0; }
async function describeVideo(id, start) {
  let title = 'YouTube-Video', channel = '';
  try {
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
    const j = await r.json(); if (j.title) title = j.title; if (j.author_name) channel = j.author_name;
  } catch {}
  return { id, title, channel, thumb: thumbFor(id), start, duration: 0 };
}
function apiError(j) {
  const reason = j?.error?.errors?.[0]?.reason || '';
  const map = {
    quotaExceeded: 'Das Tageskontingent der Suche ist aufgebraucht. Morgen geht es weiter, Links funktionieren weiterhin.',
    keyInvalid: 'Der Suchschlüssel ist ungültig. Prüfe ihn in den Einstellungen.',
    accessNotConfigured: 'Für diesen Schlüssel ist „YouTube Data API v3“ noch nicht aktiviert.',
    ipRefererBlocked: 'Der Schlüssel ist auf andere Webseiten beschränkt. Trage diese Adresse in der Google Cloud Console ein.',
  };
  return new Error(map[reason] || (j?.error?.message ? 'Google meldet: ' + j.error.message : 'Suche fehlgeschlagen'));
}
async function searchYouTube(q, key) {
  const u = new URL('https://www.googleapis.com/youtube/v3/search');
  u.search = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '20', q, key, relevanceLanguage: 'de' });
  const r = await fetch(u); const j = await r.json();
  if (!r.ok) throw apiError(j);
  const items = (j.items || []).filter((i) => i.id && i.id.videoId);
  const durations = {};
  try {
    const u2 = new URL('https://www.googleapis.com/youtube/v3/videos');
    u2.search = new URLSearchParams({ part: 'contentDetails', id: items.map((i) => i.id.videoId).join(','), key });
    const r2 = await fetch(u2); const j2 = await r2.json();
    if (r2.ok) for (const v of j2.items || []) durations[v.id] = isoDuration(v.contentDetails?.duration);
  } catch {}
  return items.map((i) => ({ id: i.id.videoId, title: decode(i.snippet.title), channel: decode(i.snippet.channelTitle || ''), thumb: thumbFor(i.id.videoId), start: 0, duration: durations[i.id.videoId] || 0 }));
}
async function runSearch(text) {
  const p = parseYouTubeInput(text);
  if (!p) return;
  el.searchInput.blur();
  if (p.kind === 'playlist') { setHint('Playlists kann ich noch nicht. Kopiere den Link eines einzelnen Videos.', 'error'); return; }
  el.searchBtn.disabled = true;
  try {
    if (p.kind === 'video') { setHint('Lese den Link', 'busy'); const v = await describeVideo(p.id, p.start); renderResults([v], 'Gefunden. Antippen spielt es sofort, das Plus hängt es an.'); return; }
    if (!apiKey) { el.results.innerHTML = ''; hintNoKey(p.q); return; }
    send({ t: 'cmd', cmd: 'search', q: p.q });
    setHint(`Suche nach „${p.q}“`, 'busy');
    const list = await searchYouTube(p.q, apiKey);
    renderResults(list, list.length ? `${list.length} Treffer für „${p.q}“` : `Nichts gefunden für „${p.q}“`);
  } catch (e) { el.results.innerHTML = ''; setHint(e.message || 'Suche fehlgeschlagen', 'error'); }
  finally { el.searchBtn.disabled = false; }
}

// ---- settings ----------------------------------------------------------------------
function renderAppsConfig() {
  el.appsConfig.innerHTML = '';
  appsDraft.forEach((a, i) => {
    const li = document.createElement('li');
    const launch = a.kind === 'launch';
    li.className = launch ? 'launch' : '';
    li.style.setProperty('--chip', CHIP_COLORS[a.id] || 'var(--paper-dim)');
    const icon = launch ? '#i-open' : '#l-' + a.id;
    li.innerHTML = `<svg class="icon"><use href="${icon}"/></svg><span class="fields"></span><span class="mini-group"></span><button type="button" class="switch${a.hidden ? '' : ' on'}" role="switch" aria-checked="${!a.hidden}" aria-label="Anzeigen"></button>`;
    const f = li.querySelector('.fields');
    if (launch) {
      const n = document.createElement('input'); n.value = a.name; n.placeholder = 'Name'; n.setAttribute('aria-label', 'Name'); n.autocapitalize = 'words';
      const w = document.createElement('input'); w.value = a.web || ''; w.placeholder = 'Webseite, z. B. https://www.netflix.com'; w.className = 'url'; w.setAttribute('aria-label', 'Webseite'); w.autocapitalize = 'off'; w.spellcheck = false; w.inputMode = 'url';
      const u = document.createElement('input'); u.value = a.url || ''; u.placeholder = 'App-Adresse, optional, z. B. nflx://'; u.className = 'url'; u.setAttribute('aria-label', 'App-Adresse'); u.autocapitalize = 'off'; u.spellcheck = false;
      const m = document.createElement('div'); m.className = 'mode';
      const mw = document.createElement('button'); mw.type = 'button'; mw.textContent = 'Webseite'; mw.className = a.mode === 'app' ? '' : 'on';
      const ma = document.createElement('button'); ma.type = 'button'; ma.textContent = 'App'; ma.className = a.mode === 'app' ? 'on' : '';
      mw.addEventListener('click', () => { a.mode = 'web'; mw.className = 'on'; ma.className = ''; });
      ma.addEventListener('click', () => { a.mode = 'app'; ma.className = 'on'; mw.className = ''; });
      m.append(mw, ma);
      n.addEventListener('input', () => { a.name = n.value; });
      w.addEventListener('input', () => { a.web = w.value; });
      u.addEventListener('input', () => { a.url = u.value; });
      f.append(n, w, u, m);
    } else {
      const n = document.createElement('span'); n.className = 'name' + (a.hidden ? ' off' : ''); n.textContent = a.name; f.appendChild(n);
    }
    const g = li.querySelector('.mini-group'); g.style.display = 'inline-flex'; g.style.gap = '4px';
    const up = document.createElement('button'); up.type = 'button'; up.className = 'mini'; up.innerHTML = '<svg class="icon"><use href="#i-up"/></svg>'; up.disabled = i === 0; up.setAttribute('aria-label', 'Nach oben');
    const dn = document.createElement('button'); dn.type = 'button'; dn.className = 'mini'; dn.innerHTML = '<svg class="icon"><use href="#i-down"/></svg>'; dn.disabled = i === appsDraft.length - 1; dn.setAttribute('aria-label', 'Nach unten');
    up.addEventListener('click', () => { [appsDraft[i - 1], appsDraft[i]] = [appsDraft[i], appsDraft[i - 1]]; renderAppsConfig(); });
    dn.addEventListener('click', () => { [appsDraft[i + 1], appsDraft[i]] = [appsDraft[i], appsDraft[i + 1]]; renderAppsConfig(); });
    g.append(up, dn);
    li.querySelector('.switch').addEventListener('click', () => { a.hidden = !a.hidden; renderAppsConfig(); });
    el.appsConfig.appendChild(li);
  });
}
function openSettings() {
  appsDraft = (tv?.apps || APPS.map((a) => ({ ...a, hidden: false }))).map((a) => ({ ...a, kind: a.kind || 'app', url: a.url || '', web: a.web || '', mode: a.mode || 'web' }));
  renderAppsConfig();
  el.apiKeyInput.value = apiKey;
  el.keyStatus.textContent = apiKey ? 'Ein Schlüssel ist gespeichert. Die Suche ist aktiv.' : 'Noch kein Schlüssel gespeichert.';
  el.tvCode.textContent = code || '----';
  if (typeof el.settings.showModal === 'function') el.settings.showModal(); else el.settings.setAttribute('open', '');
}
el.settingsBtn.addEventListener('click', () => { buzz(); openSettings(); });
el.applyApps.addEventListener('click', () => {
  if (appsDraft.every((a) => a.hidden)) { toast('Mindestens eine App bleibt sichtbar'); return; }
  const launchers = appsDraft.filter((a) => a.kind === 'launch' && String(a.name).trim() && (String(a.web || '').trim() || String(a.url || '').trim())).map((a) => ({ id: a.id, name: a.name, url: a.url || '', web: a.web || '', mode: a.mode || 'web' }));
  cmd('apps', { order: appsDraft.map((a) => a.id), hidden: appsDraft.filter((a) => a.hidden).map((a) => a.id), launchers });
  toast('An den Fernseher geschickt');
});
el.saveKey.addEventListener('click', () => {
  apiKey = el.apiKeyInput.value.trim(); store.set(LS.key, apiKey || null);
  send({ t: 'cmd', cmd: 'apikey', key: apiKey });
  el.keyStatus.textContent = apiKey ? 'Gespeichert. Die Suche ist aktiv.' : 'Schlüssel entfernt. Links funktionieren weiterhin.';
  if (!apiKey) hintNoKey(''); else setHint('Suche bereit.', '');
  toast(apiKey ? 'Suchschlüssel gespeichert' : 'Suchschlüssel entfernt');
});
el.unpair.addEventListener('click', () => { el.settings.close(); disconnect(); });
el.addLauncher.addEventListener('click', () => {
  appsDraft.push({ id: 'custom-' + Date.now().toString(36), name: '', web: '', url: '', mode: 'web', kind: 'launch', hidden: false });
  renderAppsConfig();
  const inputs = el.appsConfig.querySelectorAll('li:last-child input'); if (inputs[0]) inputs[0].focus();
});

// ---- pairing boxes --------------------------------------------------------------------
function renderBoxes() {
  const v = el.codeInput.value;
  const focused = document.activeElement === el.codeInput;
  el.boxes.forEach((b, i) => {
    const ch = v[i] || '';
    if (b.textContent !== ch) { b.textContent = ch; if (ch) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }
    b.classList.toggle('filled', !!ch);
    b.classList.toggle('active', focused && i === Math.min(v.length, 3) && !(v.length === 4 && i < 3));
  });
}
el.codeInput.addEventListener('input', () => {
  el.codeInput.value = el.codeInput.value.replace(/\D/g, '').slice(0, 4);
  renderBoxes();
  if (el.codeInput.value.length === 4) { if (el.pairForm.requestSubmit) el.pairForm.requestSubmit(); else el.pairForm.dispatchEvent(new Event('submit', { cancelable: true })); }
});
el.codeInput.addEventListener('focus', renderBoxes);
el.codeInput.addEventListener('blur', renderBoxes);
document.getElementById('codeEntry').addEventListener('click', () => el.codeInput.focus());
el.pairForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = el.codeInput.value.trim();
  if (!isValidCode(c)) { el.pairError.textContent = 'Der Code hat vier Ziffern.'; el.pairError.hidden = false; return; }
  buzz(); connect(c);
});

// ---- wiring --------------------------------------------------------------------------
document.querySelectorAll('[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => {
    const c = b.dataset.cmd;
    if (c === 'back10') cmd('seek', { by: -10 });
    else if (c === 'fwd10') cmd('seek', { by: 10 });
    else if (c === 'toggle') {
      if (tv && tv.media === 'youtube') { const playing = tv.playback === 'playing' || tv.playback === 'buffering'; tv.playback = playing ? 'paused' : 'playing'; tv.pos = livePos(); tvAt = Date.now(); render(); }
      cmd('toggle');
    } else cmd(c);
  });
});
document.querySelectorAll('.dial-btn').forEach((b) => b.addEventListener('click', () => cmd('nav', { dir: b.dataset.dir })));
el.nowMini.addEventListener('click', () => { if (tv && tv.media !== 'none') cmd('open', { app: tv.media }); });
el.miniPlay.addEventListener('click', (e) => { e.stopPropagation(); cmd('toggle'); });
document.querySelectorAll('.dial-ok').forEach((b) => b.addEventListener('click', () => cmd('select')));
document.addEventListener('keydown', (e) => {
  if (root.dataset.view !== 'control' || e.target.matches('input, textarea')) return;
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[e.key]) { cmd('nav', { dir: map[e.key] }); e.preventDefault(); }
  else if (e.key === 'Enter') cmd('select');
  else if (e.key === 'Escape') cmd('back');
});
el.scrub.addEventListener('pointerdown', () => { scrubbing = true; });
el.scrub.addEventListener('input', () => { scrubbing = true; const d = tv?.dur || 0; el.scrub.style.setProperty('--pct', (el.scrub.value / 10) + '%'); el.tPos.textContent = formatTime(el.scrub.value / 1000 * d); });
el.scrub.addEventListener('change', () => { const d = tv?.dur || 0; const to = el.scrub.value / 1000 * d; scrubbing = false; if (tv) { tv.pos = to; tvAt = Date.now(); } cmd('seek', { to }); });
el.volume.addEventListener('input', () => { el.volume.style.setProperty('--pct', el.volume.value + '%'); after('vol', 90, () => cmd('volume', { value: Number(el.volume.value) })); });
el.muteBtn.addEventListener('click', () => cmd('mute', { muted: !(tv && tv.muted) }));

el.tabs.querySelectorAll('[role="tab"]').forEach((b) => {
  b.addEventListener('click', () => {
    buzz();
    const t = b.dataset.tab; el.tabs.dataset.active = t;
    el.tabs.querySelectorAll('[role="tab"]').forEach((x) => x.setAttribute('aria-selected', x === b));
    el.tabSearch.hidden = t !== 'search'; el.tabQueue.hidden = t !== 'queue';
    const panel = t === 'search' ? el.tabSearch : el.tabQueue; panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = '';
  });
});
el.searchForm.addEventListener('submit', (e) => { e.preventDefault(); runSearch(el.searchInput.value); });
el.searchInput.addEventListener('paste', () => setTimeout(() => { const p = parseYouTubeInput(el.searchInput.value); if (p && p.kind === 'video') runSearch(el.searchInput.value); }, 0));
el.showOnTv.addEventListener('click', () => cmd('panel', { show: !(tv && tv.panel) }));
let clearArmed = false;
el.clearQueue.addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true; el.clearQueue.classList.add('confirm'); el.clearQueue.lastChild.textContent = 'Wirklich leeren?';
    after('clearArm', 3000, () => { clearArmed = false; el.clearQueue.classList.remove('confirm'); el.clearQueue.lastChild.textContent = 'Leeren'; });
    return;
  }
  clearArmed = false; el.clearQueue.classList.remove('confirm'); el.clearQueue.lastChild.textContent = 'Leeren'; cmd('clear');
});
el.twForm.addEventListener('submit', (e) => { e.preventDefault(); openTwitch(el.twInput.value); });
el.webForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const clean = normalizeWebUrl(el.webInput.value);
  if (!clean) { el.webError.textContent = 'Das sieht nicht nach einer Webadresse aus. Beispiel: wetter.com'; el.webError.className = 'hint error'; el.webError.hidden = false; return; }
  el.webError.hidden = true;
  cmd('web', { url: clean }); el.webInput.value = ''; el.webInput.blur();
  toast(`Öffne ${clean.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')} auf dem iPad`);
});
el.radioStop.addEventListener('click', () => cmd('stop'));

// ---- start ---------------------------------------------------------------------------
if (!apiKey) hintNoKey(''); else setHint('Suche bereit. Tipp ein Stichwort oder füge einen Link ein.', '');
renderTwFavs('');
const fromUrl = new URLSearchParams(location.search).get('code');
if (isValidCode(fromUrl)) { history.replaceState(null, '', location.pathname); el.codeInput.value = fromUrl.trim(); renderBoxes(); connect(fromUrl.trim()); }
else {
  const saved = store.get(LS.code);
  if (isValidCode(saved)) { el.codeInput.value = saved; renderBoxes(); connect(saved); }
  else setTimeout(() => el.codeInput.focus(), 300);
}
