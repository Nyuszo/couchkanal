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
