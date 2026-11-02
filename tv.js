import {
  makeCode, isValidCode, peerIdFor, thumbFor, formatTime,
  reduce, initialQueue, sanitizeVideo
} from './logic.js';

const $ = (sel) => document.querySelector(sel);
const tv = $('#tv');
const el = {
  boot: $('#boot'), idle: $('#idle'), stage: $('#stage'),
  clock: $('#clock'), code: $('#code'), idleLead: $('#idleLead'), idleHint: $('#idleHint'),
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

// ---- state -----------------------------------------------------------------
let q = initialQueue();
let playback = 'idle';          // idle | loading | playing | paused | buffering | blocked
let pos = 0, dur = 0, volume = 100, muted = false;
let panelOpen = false;
let currentKey = null;          // `${index}:${id}` of the video loaded into the player
let booted = false;

let player = null, playerReady = false, playerPromise = null;
let peer = null, code = null, idRetries = 0;
const conns = new Set();

// ---- helpers ---------------------------------------------------------------
const timers = {};
function after(name, ms, fn) { clearTimeout(timers[name]); timers[name] = setTimeout(fn, ms); }
function setState(s) { tv.dataset.state = s; }
function setStatus(kind, text) {
  el.status.className = 'status ' + kind;
  el.statusText.textContent = text;
  if (kind === 'ok' && tv.dataset.state === 'play') after('statusFade', 3500, () => el.status.classList.add('fade'));
}
function toast(text) {
  el.toast.textContent = text;
  el.toast.classList.add('show');
  after('toast', 2600, () => el.toast.classList.remove('show'));
}
function tickClock() {
  const d = new Date();
  el.clock.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function current() { return q.index >= 0 ? q.queue[q.index] : null; }
function upcoming() { return q.index >= 0 ? q.queue[q.index + 1] : null; }

// ---- idle screen -------------------------------------------------------------
function renderCode(c, confirmed) {
  el.code.classList.toggle('pending', !confirmed);
  el.code.innerHTML = '';
  [...c].forEach((d, i) => {
    const s = document.createElement('span');
    s.textContent = d; s.style.setProperty('--i', i);
    el.code.appendChild(s);
  });
}
function updateIdle() {
  const connected = conns.size > 0;
  el.idle.classList.toggle('connected', connected);
  if (!connected) {
    el.idleLead.textContent = 'Öffne die Fernbedienung am Handy und gib diesen Code ein';
    el.idleHint.textContent = 'Die Fernbedienung liegt unter derselben Adresse wie diese Seite.';
  } else if (q.queue.length && q.index < 0) {
    el.idleLead.textContent = 'Warteschlange durchgespielt';
    el.idleHint.textContent = 'Such dir am Handy das nächste Video aus. Der Code bleibt gültig.';
  } else {
    el.idleLead.textContent = 'Handy verbunden. Such dir dort etwas aus.';
    el.idleHint.textContent = 'Der Code bleibt gültig, falls du dich neu verbinden musst.';
  }
}

// ---- now playing / OSD -------------------------------------------------------
function renderNow() {
  const v = current();
  if (!v) return;
  el.nowThumb.src = v.thumb; el.nowTitle.textContent = v.title; el.nowChannel.textContent = v.channel;
  const n = upcoming();
  el.nowNext.hidden = !n;
  if (n) el.nowNextTitle.textContent = n.title;
  el.ambientArt.src = v.thumb; tv.classList.add('has-art');
}
function renderProgress() {
  el.nowFill.style.width = dur ? (pos / dur * 100).toFixed(2) + '%' : '0%';
  el.nowPos.textContent = formatTime(pos);
  el.nowDur.textContent = formatTime(dur);
}
function showNow(sticky = false) {
  renderNow(); renderProgress();
  el.now.classList.add('show');
  clearTimeout(timers.now);
  if (!sticky) after('now', 4200, () => el.now.classList.remove('show'));
}
function osdCenter(icon, label = '') {
  el.osdCenterIcon.setAttribute('href', '#i-' + icon);
  el.osdCenterLabel.textContent = label;
  el.osdCenter.classList.remove('show');
  void el.osdCenter.offsetWidth; // restart the animation
  el.osdCenter.classList.add('show');
}
function osdVolume() {
  el.osdVolIcon.setAttribute('href', muted ? '#i-mute' : '#i-vol');
  el.osdVolFill.style.height = (muted ? 0 : volume) + '%';
  el.osdVolLabel.textContent = muted ? 'Stumm' : String(volume);
  el.osdVolume.classList.add('show');
  after('vol', 1600, () => el.osdVolume.classList.remove('show'));
}
function renderQueue() {
  el.queueList.innerHTML = '';
  if (!q.queue.length) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Noch nichts in der Warteschlange.';
    el.queueList.appendChild(li); return;
  }
  const from = Math.max(0, Math.min(q.index - 1, q.queue.length - 8));
  q.queue.slice(from, from + 8).forEach((v, k) => {
    const i = from + k;
    const li = document.createElement('li');
    li.className = i === q.index ? 'current' : (q.index >= 0 && i < q.index ? 'done' : '');
    li.innerHTML = `<span class="n">${i + 1}</span><img alt=""><div><div class="t"></div><div class="c"></div></div>`;
    li.querySelector('img').src = v.thumb;
    li.querySelector('.t').textContent = v.title;
    li.querySelector('.c').textContent = v.channel;
    el.queueList.appendChild(li);
  });
}
function showPanel(show) {
  panelOpen = show;
  renderQueue();
  el.queuePanel.classList.toggle('show', show);
  if (show) after('panel', 9000, () => { panelOpen = false; el.queuePanel.classList.remove('show'); sendState(); });
}

// ---- YouTube player ----------------------------------------------------------
function ensurePlayer() {
  if (playerPromise) return playerPromise;
  playerPromise = new Promise((resolve) => {
    const create = () => {
      player = new YT.Player('player', {
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin },
        events: {
          onReady: () => { playerReady = true; try { volume = player.getVolume(); muted = player.isMuted(); } catch {} resolve(player); },
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
  if (playback === 'idle' || !current()) return; // events after stopVideo() are noise
  const S = YT.PlayerState;
  switch (e.data) {
    case S.PLAYING:
      playback = 'playing'; el.tapToPlay.hidden = true; clearTimeout(timers.autoplay);
      showNow(); break;
    case S.PAUSED:
      playback = 'paused'; showNow(true); break;
    case S.BUFFERING:
      playback = 'buffering'; break;
    case S.ENDED:
      apply(reduce(q, { type: 'ended' })); break;
    case S.CUED:
      // cued but not playing: usually means autoplay was refused
      if (playback === 'loading') { try { player.playVideo(); } catch {} }
      break;
    default: break;
  }
  sendState();
}
function onPlayerError(e) {
  const v = current();
  toast(`„${v ? v.title : 'Video'}“ lässt sich hier nicht abspielen`);
  after('skip', 1800, () => apply(reduce(q, { type: 'next' })));
}
function watchAutoplay() {
  after('autoplay', 3200, () => {
    if (playback === 'loading' || playback === 'blocked') {
      playback = 'blocked';
      const v = current();
      el.tapTitle.textContent = v ? v.title : '';
      el.tapToPlay.hidden = false;
      sendState();
    }
  });
}

// ---- queue → player ----------------------------------------------------------
function apply(next) {
  const before = current();
  const restart = !!next.restart;
  q = { queue: next.queue, index: next.index };
  const v = current();
  if (!v) { stopPlayback(); broadcast(); return; }
  const key = `${q.index}:${v.id}`;
  if (key === currentKey && !restart) { renderNow(); renderQueue(); sendState(); return; }
  if (key === currentKey && restart) {
    try { player.seekTo(0, true); player.playVideo(); } catch {}
    osdCenter('back', 'Von vorn'); sendState(); return;
  }
  currentKey = key;
  playback = 'loading'; pos = 0; dur = v.duration || 0;
  setState('play'); el.status.classList.remove('fade');
  el.tapToPlay.hidden = true;
  showNow(true);
  ensurePlayer().then(() => {
    player.loadVideoById({ videoId: v.id, startSeconds: v.start || 0 });
    watchAutoplay();
  });
  if (before && before.id !== v.id) toast(`Jetzt: ${v.title}`);
  renderQueue();
  sendState();
}
function stopPlayback() {
  currentKey = null; playback = 'idle'; pos = 0; dur = 0;
  clearTimeout(timers.autoplay);
  try { if (playerReady) player.stopVideo(); } catch {}
  el.now.classList.remove('show'); el.tapToPlay.hidden = true;
  setState(booted ? 'idle' : 'boot');
  updateIdle(); renderQueue();
}

// ---- messages ------------------------------------------------------------------
function stateMessage() {
  return {
    t: 'state', code, queue: q.queue, index: q.index, playback, pos, dur, volume, muted,
    volumeControl: !IS_IOS, panel: panelOpen, booted,
  };
}
let lastSent = 0;
function sendState(conn) {
  const msg = stateMessage();
  if (conn) { try { conn.send(msg); } catch {} return; }
  lastSent = Date.now();
  for (const c of conns) { try { c.send(msg); } catch {} }
}
const broadcast = () => sendState();

function handleMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    conn.label = String(msg.name || 'Handy').slice(0, 40);
    setStatus('ok', `Verbunden mit ${conn.label}`);
    sendState(conn); return;
  }
  if (msg.t === 'ping') { try { conn.send({ t: 'pong' }); } catch {} return; }
  if (msg.t !== 'cmd') return;
  if (!booted) { try { conn.send({ t: 'needsBoot' }); } catch {} }
  const ready = playerReady && current();
  switch (msg.cmd) {
    case 'toggle':
      if (!ready) break;
      if (playback === 'playing' || playback === 'buffering') { player.pauseVideo(); osdCenter('pause'); }
      else { player.playVideo(); osdCenter('play'); }
      break;
    case 'play': if (ready) { player.playVideo(); osdCenter('play'); } break;
    case 'pause': if (ready) { player.pauseVideo(); osdCenter('pause'); } break;
    case 'seek': {
      if (!ready) break;
      let to = typeof msg.to === 'number' ? msg.to : pos + (Number(msg.by) || 0);
      to = Math.max(0, dur ? Math.min(to, dur - 0.5) : to);
      player.seekTo(to, true); pos = to;
      if (typeof msg.by === 'number') osdCenter(msg.by < 0 ? 'back' : 'fwd', `${Math.abs(msg.by)} s`);
      showNow(playback === 'paused'); renderProgress();
      break;
    }
    case 'next': apply(reduce(q, { type: 'next' })); if (current()) osdCenter('next'); break;
    case 'prev': apply(reduce(q, { type: 'prev', pos })); break;
    case 'enqueue': {
      const v = sanitizeVideo(msg.video); if (!v) break;
      const wasIdle = q.index < 0;
      apply(reduce(q, { type: 'enqueue', video: v }));
      if (!wasIdle) { toast(`Angehängt: ${v.title}`); renderNow(); }
      break;
    }
    case 'playNow': { const v = sanitizeVideo(msg.video); if (v) apply(reduce(q, { type: 'playNow', video: v })); break; }
    case 'jump': apply(reduce(q, { type: 'jump', index: msg.index })); break;
    case 'remove': apply(reduce(q, { type: 'remove', index: msg.index })); toast('Aus der Warteschlange entfernt'); break;
    case 'clear': apply(reduce(q, { type: 'clear' })); toast('Warteschlange geleert'); break;
    case 'volume': {
      if (!playerReady) break;
      volume = Math.max(0, Math.min(100, Math.round(Number(msg.value) || 0)));
      player.setVolume(volume); if (muted && volume > 0) { muted = false; player.unMute(); }
      osdVolume(); break;
    }
    case 'mute': {
      if (!playerReady) break;
      muted = !!msg.muted; muted ? player.mute() : player.unMute();
      osdVolume(); break;
    }
    case 'panel': showPanel(!!msg.show); break;
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
    renderCode(code, true);
    setStatus(conns.size ? 'ok' : 'wait', conns.size ? 'Handy verbunden' : 'Warte auf das Handy');
  });
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.add(conn);
      setStatus('ok', 'Handy verbunden');
      updateIdle(); sendState(conn);
      if (conns.size === 1) toast('Fernbedienung verbunden');
    });
    conn.on('data', (msg) => handleMessage(conn, msg));
    conn.on('close', () => {
      conns.delete(conn);
      if (!conns.size) { setStatus('wait', 'Handy getrennt. Der Code bleibt gültig'); el.status.classList.remove('fade'); }
      updateIdle();
    });
    conn.on('error', () => {});
  });
  peer.on('disconnected', () => {
    setStatus('warn', 'Verbindung zum Vermittler verloren, versuche es erneut');
    after('reconnect', 2500, () => { if (peer && !peer.destroyed) peer.reconnect(); });
  });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      // after a quick reload the old registration may linger a few seconds: retry the same code first
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

// ---- boot & loops ------------------------------------------------------------
async function boot() {
  if (booted) return;
  booted = true;
  setState('idle'); updateIdle();
  try { await ensurePlayer(); } catch {}
  try { navigator.wakeLock && (await navigator.wakeLock.request('screen')); } catch {}
  sendState();
}
el.boot.addEventListener('pointerdown', boot);
el.boot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') boot(); });
el.tapToPlay.addEventListener('pointerdown', () => { try { player.playVideo(); } catch {} });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && booted) { try { navigator.wakeLock && (await navigator.wakeLock.request('screen')); } catch {} }
});

// hide the mouse cursor when nothing moves (irrelevant on the iPad, nice on a Mac)
let cursorTimer;
document.addEventListener('mousemove', () => {
  tv.classList.remove('hide-cursor');
  clearTimeout(cursorTimer); cursorTimer = setTimeout(() => tv.classList.add('hide-cursor'), 3000);
});

setInterval(() => {
  if (!playerReady || !current()) return;
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
startPeer();
