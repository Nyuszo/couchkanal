// Pure logic shared by the TV page, the remote and the tests. No DOM here.

export const APP_PREFIX = 'couchkanal-';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export function isValidCode(str) {
  return /^\d{4}$/.test(String(str ?? '').trim());
}

export function peerIdFor(code) {
  return APP_PREFIX + String(code).trim();
}

export function thumbFor(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

function parseStart(raw) {
  if (!raw) return 0;
  const m = String(raw).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}

// Returns {kind:'video', id, start} | {kind:'playlist', id} | {kind:'query', q} | null
export function parseYouTubeInput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const looksLikeUrl = /^(https?:\/\/)?([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(raw);
  if (!looksLikeUrl) return { kind: 'query', q: raw };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return { kind: 'query', q: raw };
  }
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const start = parseStart(url.searchParams.get('t') || url.searchParams.get('start'));

  let id = null;
  if (host === 'youtu.be') {
    id = parts[0];
  } else if (parts[0] === 'watch') {
    id = url.searchParams.get('v');
  } else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) {
    id = parts[1];
  } else if (parts[0] === 'playlist') {
    const list = url.searchParams.get('list');
    return list ? { kind: 'playlist', id: list } : { kind: 'query', q: raw };
  }
  if (id && ID_RE.test(id)) return { kind: 'video', id, start };
  return { kind: 'query', q: raw };
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
}

// ---- Queue -----------------------------------------------------------------
// state = { queue: Video[], index: number }  index -1 means nothing is playing.
// reduce returns a NEW state; a `restart: true` flag asks the player to seek to 0.

export function initialQueue() {
  return { queue: [], index: -1 };
}

export function reduce(state, action) {
  const queue = [...state.queue];
  let index = state.index;
  switch (action.type) {
    case 'enqueue': {
      queue.push(action.video);
      if (index < 0) index = queue.length - 1;
      return { queue, index };
    }
    case 'playNow': {
      if (index < 0) {
        queue.push(action.video);
        return { queue, index: queue.length - 1 };
      }
      queue.splice(index + 1, 0, action.video);
      return { queue, index: index + 1 };
    }
    case 'next':
    case 'ended': {
      if (index < 0) return { queue, index };
      return { queue, index: index + 1 < queue.length ? index + 1 : -1 };
    }
    case 'prev': {
      if (index < 0) return { queue, index };
      if ((action.pos ?? 0) > 5 || index === 0) return { queue, index, restart: true };
      return { queue, index: index - 1 };
    }
    case 'jump': {
      const i = action.index;
      if (!Number.isInteger(i) || i < 0 || i >= queue.length) return { queue, index };
      return { queue, index: i };
    }
    case 'remove': {
      const i = action.index;
      if (!Number.isInteger(i) || i < 0 || i >= queue.length) return { queue, index };
      queue.splice(i, 1);
      if (queue.length === 0) return { queue, index: -1 };
      if (i < index) index -= 1;
      else if (i === index && index >= queue.length) index = -1;
      return { queue, index };
    }
    case 'clear':
      return initialQueue();
    default:
      return { queue, index };
  }
}

// Only trust what we can verify from a remote: a real video id; text is clipped.
export function sanitizeVideo(v) {
  if (!v || typeof v !== 'object') return null;
  const id = String(v.id ?? '');
  if (!ID_RE.test(id)) return null;
  const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  return {
    id,
    title: clip(v.title, 160) || 'YouTube-Video',
    channel: clip(v.channel, 80),
    thumb: thumbFor(id),
    start: Math.max(0, Math.floor(Number(v.start) || 0)),
    duration: Math.max(0, Math.floor(Number(v.duration) || 0)),
  };
}

// ---- Apps (the TV home screen) ---------------------------------------------
export const APPS = [
  { id: 'youtube', name: 'YouTube', blurb: 'Videos suchen, anhängen, abspielen. Alles vom Handy aus.' },
  { id: 'twitch', name: 'Twitch', blurb: 'Live-Streams. Den Kanalnamen gibst du am Handy ein.' },
  { id: 'radio', name: 'Radio', blurb: 'Sechzehn Sender, vom Deutschlandfunk bis Radio Paradise.' },
  { id: 'clock', name: 'Bildschirmschoner', blurb: 'Uhr und Raumlicht. Radio läuft dabei weiter.' },
];

// Ordered list with a hidden flag, from a saved config {order:[ids], hidden:[ids]}.
// Unknown ids are dropped, missing ids are appended in default order.
export function applyAppConfig(defaults, config) {
  const known = new Map(defaults.map((a) => [a.id, a]));
  const order = Array.isArray(config?.order) ? config.order.filter((id) => known.has(id)) : [];
  const hidden = new Set(Array.isArray(config?.hidden) ? config.hidden.filter((id) => known.has(id)) : []);
  const ids = [...new Set([...order, ...defaults.map((a) => a.id)])];
  const list = ids.map((id) => ({ ...known.get(id), hidden: hidden.has(id) }));
  return list.every((a) => a.hidden) ? list.map((a) => ({ ...a, hidden: false })) : list;
}
export function visibleApps(list) { return list.filter((a) => !a.hidden); }

// Grid focus: no wrapping, rows of `cols`, the last row may be shorter.
export function moveFocus(index, dir, count, cols = count) {
  if (count <= 0) return -1;
  let i = Math.min(Math.max(index, 0), count - 1);
  const c = Math.max(1, cols);
  switch (dir) {
    case 'left': if (i % c > 0) i -= 1; break;
    case 'right': if (i % c < c - 1 && i + 1 < count) i += 1; break;
    case 'up': if (i - c >= 0) i -= c; break;
    case 'down': if (i + c < count) i += c; else if (Math.floor(i / c) < Math.floor((count - 1) / c)) i = count - 1; break;
    default: break;
  }
  return i;
}

// ---- Radio stations (checked 2026-11-03) ----------------------------------
export const STATIONS = [
  { id: 'dlf', name: 'Deutschlandfunk', tag: 'Nachrichten und Wort', hue: 212, url: 'https://st01.sslstream.dlf.de/dlf/01/128/mp3/stream.mp3' },
  { id: 'dlfkultur', name: 'DLF Kultur', tag: 'Kultur und Klassik', hue: 262, url: 'https://st02.sslstream.dlf.de/dlf/02/128/mp3/stream.mp3' },
  { id: 'dlfnova', name: 'DLF Nova', tag: 'Junges Wort', hue: 186, url: 'https://st03.sslstream.dlf.de/dlf/03/128/mp3/stream.mp3' },
  { id: '1live', name: '1LIVE', tag: 'Pop und Charts', hue: 340, url: 'https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/128/stream.mp3' },
  { id: 'wdr2', name: 'WDR 2', tag: 'Pop und Information', hue: 24, url: 'https://wdr-wdr2-rheinland.icecastssl.wdr.de/wdr/wdr2/rheinland/mp3/128/stream.mp3' },
  { id: 'wdr4', name: 'WDR 4', tag: 'Schlager und Oldies', hue: 48, url: 'https://wdr-wdr4-live.icecastssl.wdr.de/wdr/wdr4/live/mp3/128/stream.mp3' },
  { id: 'ndr2', name: 'NDR 2', tag: 'Pop aus dem Norden', hue: 200, url: 'https://icecast.ndr.de/ndr/ndr2/niedersachsen/mp3/128/stream.mp3' },
  { id: 'njoy', name: 'N-JOY', tag: 'Junge Hits', hue: 150, url: 'https://icecast.ndr.de/ndr/njoy/live/mp3/128/stream.mp3' },
  { id: 'swr3', name: 'SWR3', tag: 'Pop und Comedy', hue: 90, url: 'https://liveradio.swr.de/sw282p3/swr3/play.mp3' },
  { id: 'swr1', name: 'SWR1', tag: 'Hits aus fünf Jahrzehnten', hue: 10, url: 'https://liveradio.swr.de/sw282p3/swr1bw/play.mp3' },
  { id: 'bremen4', name: 'Bremen Vier', tag: 'Pop aus Bremen', hue: 300, url: 'https://icecast.radiobremen.de/rb/bremenvier/live/mp3/128/stream.mp3' },
  { id: 'antenne', name: 'Antenne Bayern', tag: 'Hits aus Bayern', hue: 220, url: 'https://s1-webradio.antenne.de/antenne' },
  { id: 'fm4', name: 'FM4', tag: 'Alternative aus Wien', hue: 120, url: 'https://orf-live.ors-shoutcast.at/fm4-q2a' },
  { id: 'oe3', name: 'Ö3', tag: 'Hits aus Österreich', hue: 0, url: 'https://orf-live.ors-shoutcast.at/oe3-q2a' },
  { id: 'bytefm', name: 'ByteFM', tag: 'Handverlesene Musik', hue: 170, url: 'https://bytefm.cast.addradio.de/bytefm/main/mid/stream.mp3' },
  { id: 'paradise', name: 'Radio Paradise', tag: 'Eclectic, ohne Werbung', hue: 36, url: 'https://stream.radioparadise.com/aac-320' },
];
export function stationById(id) { return STATIONS.find((s) => s.id === id) || null; }
