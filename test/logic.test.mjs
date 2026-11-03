import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCode, isValidCode, peerIdFor,
  parseYouTubeInput, thumbFor, formatTime,
  reduce, initialQueue
} from '../logic.js';

test('makeCode gives four digits and a matching peer id', () => {
  for (let i = 0; i < 50; i++) {
    const c = makeCode();
    assert.match(c, /^\d{4}$/);
    assert.ok(isValidCode(c));
    assert.equal(peerIdFor(c), `couchkanal-${c}`);
  }
  assert.equal(isValidCode('12'), false);
  assert.equal(isValidCode('12a4'), false);
  assert.equal(isValidCode(' 1234 '), true, 'surrounding spaces are tolerated');
});

test('parseYouTubeInput recognises the common link shapes', () => {
  const id = 'dQw4w9WgXcQ';
  const links = [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc123`,
    `https://www.youtube.com/shorts/${id}`,
    `https://m.youtube.com/watch?v=${id}&feature=share`,
    `youtube.com/watch?v=${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`,
    `  https://youtu.be/${id}  `,
  ];
  for (const l of links) {
    assert.deepEqual(parseYouTubeInput(l), { kind: 'video', id, start: 0 }, l);
  }
});

test('parseYouTubeInput keeps a start time', () => {
  assert.deepEqual(
    parseYouTubeInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s'),
    { kind: 'video', id: 'dQw4w9WgXcQ', start: 90 });
  assert.deepEqual(
    parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ?t=125'),
    { kind: 'video', id: 'dQw4w9WgXcQ', start: 125 });
});

test('parseYouTubeInput treats everything else as a search or nothing', () => {
  assert.deepEqual(parseYouTubeInput('lofi hip hop radio'), { kind: 'query', q: 'lofi hip hop radio' });
  assert.deepEqual(parseYouTubeInput('Tagesschau2'), { kind: 'query', q: 'Tagesschau2' });
  assert.equal(parseYouTubeInput('   '), null);
  assert.equal(parseYouTubeInput(''), null);
  assert.deepEqual(parseYouTubeInput('https://www.youtube.com/playlist?list=PL123'), { kind: 'playlist', id: 'PL123' });
});

test('thumbFor and formatTime', () => {
  assert.equal(thumbFor('abc'), 'https://i.ytimg.com/vi/abc/hqdefault.jpg');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(formatTime(-3), '0:00');
  assert.equal(formatTime(59.8), '0:59');
});

const v = (id) => ({ id, title: 'Video ' + id, channel: 'Kanal', thumb: thumbFor(id) });

test('enqueue on an empty queue starts that video', () => {
  const s = reduce(initialQueue(), { type: 'enqueue', video: v('a') });
  assert.deepEqual(s.queue.map(x => x.id), ['a']);
  assert.equal(s.index, 0);
});

test('enqueue while playing appends without changing the current item', () => {
  let s = reduce(initialQueue(), { type: 'enqueue', video: v('a') });
  s = reduce(s, { type: 'enqueue', video: v('b') });
  assert.deepEqual(s.queue.map(x => x.id), ['a', 'b']);
  assert.equal(s.index, 0);
});

test('playNow inserts after the current item and jumps to it', () => {
  let s = reduce(initialQueue(), { type: 'enqueue', video: v('a') });
  s = reduce(s, { type: 'enqueue', video: v('b') });
  s = reduce(s, { type: 'playNow', video: v('c') });
  assert.deepEqual(s.queue.map(x => x.id), ['a', 'c', 'b']);
  assert.equal(s.index, 1);
});

test('playNow on an empty queue simply starts the video', () => {
  const s = reduce(initialQueue(), { type: 'playNow', video: v('c') });
  assert.deepEqual(s.queue.map(x => x.id), ['c']);
  assert.equal(s.index, 0);
});

test('next and ended advance, and stop at the end with index -1', () => {
  let s = initialQueue();
  s = reduce(s, { type: 'enqueue', video: v('a') });
  s = reduce(s, { type: 'enqueue', video: v('b') });
  s = reduce(s, { type: 'next' });
  assert.equal(s.index, 1);
  s = reduce(s, { type: 'ended' });
  assert.equal(s.index, -1);
  assert.equal(s.queue.length, 2, 'queue is kept for jumping back');
});

test('prev restarts when more than 5 seconds in, otherwise goes back', () => {
  let s = initialQueue();
  s = reduce(s, { type: 'enqueue', video: v('a') });
  s = reduce(s, { type: 'enqueue', video: v('b') });
  s = reduce(s, { type: 'next' });
  const late = reduce(s, { type: 'prev', pos: 12 });
  assert.equal(late.index, 1);
  assert.equal(late.restart, true);
  const early = reduce(s, { type: 'prev', pos: 2 });
  assert.equal(early.index, 0);
  assert.equal(early.restart, undefined);
  const first = reduce(reduce(initialQueue(), { type: 'enqueue', video: v('a') }), { type: 'prev', pos: 1 });
  assert.equal(first.index, 0);
  assert.equal(first.restart, true, 'at the first item prev restarts it');
});

test('remove keeps the index pointing at the same video', () => {
  let s = initialQueue();
  for (const id of ['a', 'b', 'c']) s = reduce(s, { type: 'enqueue', video: v(id) });
  s = reduce(s, { type: 'next' }); // playing b
  const r1 = reduce(s, { type: 'remove', index: 0 }); // remove a
  assert.deepEqual(r1.queue.map(x => x.id), ['b', 'c']);
  assert.equal(r1.index, 0);
  const r2 = reduce(s, { type: 'remove', index: 2 }); // remove c
  assert.equal(r2.index, 1);
  const r3 = reduce(s, { type: 'remove', index: 1 }); // remove current → next one plays
  assert.deepEqual(r3.queue.map(x => x.id), ['a', 'c']);
  assert.equal(r3.index, 1);
  const last = reduce(reduce(initialQueue(), { type: 'enqueue', video: v('a') }), { type: 'remove', index: 0 });
  assert.equal(last.index, -1);
  assert.equal(last.queue.length, 0);
});

test('jump, clear and resuming after the end', () => {
  let s = initialQueue();
  for (const id of ['a', 'b']) s = reduce(s, { type: 'enqueue', video: v(id) });
  s = reduce(s, { type: 'jump', index: 1 });
  assert.equal(s.index, 1);
  s = reduce(s, { type: 'ended' });
  assert.equal(s.index, -1);
  s = reduce(s, { type: 'enqueue', video: v('c') });
  assert.equal(s.index, 2, 'enqueue after the end starts the new video');
  s = reduce(s, { type: 'clear' });
  assert.deepEqual(s, initialQueue());
  assert.equal(reduce(s, { type: 'jump', index: 5 }).index, -1, 'out of range jump is ignored');
});

test('reduce never mutates its input', () => {
  const s0 = reduce(initialQueue(), { type: 'enqueue', video: v('a') });
  const frozen = Object.freeze({ ...s0, queue: Object.freeze([...s0.queue]) });
  assert.doesNotThrow(() => reduce(frozen, { type: 'enqueue', video: v('b') }));
  assert.doesNotThrow(() => reduce(frozen, { type: 'remove', index: 0 }));
});

test('sanitizeVideo only accepts real ids and never trusts a thumbnail url', async () => {
  const { sanitizeVideo } = await import('../logic.js');
  assert.equal(sanitizeVideo(null), null);
  assert.equal(sanitizeVideo({ id: 'nope' }), null);
  const v = sanitizeVideo({ id: 'dQw4w9WgXcQ', title: '  Hello \n world  ', channel: 'X', thumb: 'https://evil.example/x.png', start: '12.7', duration: -5 });
  assert.equal(v.title, 'Hello world');
  assert.equal(v.thumb, thumbFor('dQw4w9WgXcQ'));
  assert.equal(v.start, 12);
  assert.equal(v.duration, 0);
  assert.equal(sanitizeVideo({ id: 'dQw4w9WgXcQ' }).title, 'YouTube-Video');
});

test('applyAppConfig orders, hides and never hides everything', async () => {
  const { APPS, applyAppConfig, visibleApps } = await import('../logic.js');
  const def = applyAppConfig(APPS, null);
  assert.deepEqual(def.map((a) => a.id), APPS.map((a) => a.id));
  assert.deepEqual(def.slice(0, 4).map((a) => a.id), ['youtube', 'twitch', 'radio', 'clock']);
  assert.ok(def.every((a) => a.hidden === false));
  const custom = applyAppConfig(APPS, { order: ['radio', 'bogus', 'youtube'], hidden: ['twitch', 'bogus'] });
  assert.deepEqual(custom.slice(0, 4).map((a) => a.id), ['radio', 'youtube', 'twitch', 'clock']);
  assert.deepEqual(visibleApps(custom).slice(0, 3).map((a) => a.id), ['radio', 'youtube', 'clock']);
  const all = applyAppConfig(APPS, { hidden: APPS.map((a) => a.id) });
  assert.equal(visibleApps(all).length, APPS.length, 'hiding every app falls back to showing all');
});

test('moveFocus walks a grid without wrapping', async () => {
  const { moveFocus } = await import('../logic.js');
  // single row of 4
  assert.equal(moveFocus(0, 'left', 4), 0);
  assert.equal(moveFocus(0, 'right', 4), 1);
  assert.equal(moveFocus(3, 'right', 4), 3);
  assert.equal(moveFocus(2, 'up', 4), 2);
  // 4 columns, 10 items (last row has 2)
  assert.equal(moveFocus(3, 'right', 10, 4), 3, 'end of row stays');
  assert.equal(moveFocus(4, 'left', 10, 4), 4, 'start of row stays');
  assert.equal(moveFocus(1, 'down', 10, 4), 5);
  assert.equal(moveFocus(7, 'down', 10, 4), 9, 'down into a shorter row lands on its last item');
  assert.equal(moveFocus(9, 'down', 10, 4), 9);
  assert.equal(moveFocus(9, 'up', 10, 4), 5);
  assert.equal(moveFocus(-3, 'up', 10, 4), 0, 'out of range index is clamped');
  assert.equal(moveFocus(0, 'up', 0), -1);
});

test('stations have unique ids and https streams', async () => {
  const { STATIONS, stationById } = await import('../logic.js');
  assert.equal(new Set(STATIONS.map((s) => s.id)).size, STATIONS.length);
  assert.ok(STATIONS.every((s) => s.url.startsWith('https://')));
  assert.equal(stationById('swr3').name, 'SWR3');
  assert.equal(stationById('nope'), null);
});

test('launchers can be renamed, re-pointed, added and never accept unsafe urls', async () => {
  const { APPS, applyAppConfig, isLaunchUrl, isWebUrl, launchTarget } = await import('../logic.js');
  assert.ok(isWebUrl('https://www.netflix.com/browse'));
  assert.equal(isWebUrl('nflx://'), false);
  assert.ok(isLaunchUrl('nflx://'));
  assert.ok(isLaunchUrl('spotify:'));
  assert.equal(isLaunchUrl('javascript:alert(1)'), false);
  assert.equal(isLaunchUrl('no scheme'), false);
  const cfg = {
    launchers: [
      { id: 'disney', name: 'Disney Plus', url: 'disneyplus://home' },
      { id: 'custom-1', name: 'ARD', url: 'ardmediathek://' },
      { id: 'custom-2', name: 'Böse', url: 'javascript:alert(1)' },
      { id: 'youtube', name: 'Nope', url: 'x://' },
    ],
    order: ['custom-1', 'youtube'],
  };
  const list = applyAppConfig(APPS, cfg);
  assert.equal(list[0].id, 'custom-1');
  assert.equal(list[0].kind, 'launch');
  assert.equal(list[1].id, 'youtube');
  assert.equal(list[1].name, 'YouTube', 'built-in apps cannot be renamed');
  const disney = list.find((a) => a.id === 'disney');
  assert.equal(disney.name, 'Disney Plus');
  assert.equal(disney.url, 'disneyplus://home');
  assert.ok(!list.some((a) => a.id === 'custom-2'), 'unsafe custom launcher is dropped');
  assert.equal(list.length, APPS.length + 1);
  // websites are the default target, the app only when chosen and available
  const netflix = list.find((a) => a.id === 'netflix');
  assert.equal(launchTarget(netflix), 'nflx://', 'services with an app open the app by default');
  const asWeb = applyAppConfig(APPS, { launchers: [{ id: 'netflix', mode: 'web' }] }).find((a) => a.id === 'netflix');
  assert.equal(launchTarget(asWeb), 'https://www.netflix.com/browse');
  const ard = applyAppConfig(APPS, { launchers: [{ id: 'ard', mode: 'app' }] }).find((a) => a.id === 'ard');
  assert.equal(launchTarget(ard), 'https://www.ardmediathek.de', 'no app address falls back to the website');
  const web = applyAppConfig(APPS, { launchers: [{ id: 'custom-9', name: 'Mediathek', web: 'https://example.org/tv' }] }).find((a) => a.id === 'custom-9');
  assert.equal(launchTarget(web), 'https://example.org/tv');
  assert.equal(launchTarget({ kind: 'app' }), '');
});

test('websites typed on the phone are normalised and remembered', async () => {
  const { normalizeWebUrl, hostLabel, rememberSite } = await import('../logic.js');
  assert.equal(normalizeWebUrl('wetter.com'), 'https://wetter.com/');
  assert.equal(normalizeWebUrl(' https://www.ardmediathek.de/live '), 'https://www.ardmediathek.de/live');
  assert.equal(normalizeWebUrl('nur text'), '');
  assert.equal(normalizeWebUrl('javascript:alert(1)'), '');
  assert.equal(normalizeWebUrl('ftp://x.de'), '');
  assert.equal(normalizeWebUrl(''), '');
  assert.equal(normalizeWebUrl('localhost:8787/index.html'), 'http://localhost:8787/index.html', 'local test addresses stay http');
  assert.equal(hostLabel('https://www.tagesschau.de/x'), 'tagesschau.de');
  let list = rememberSite([], 'tagesschau.de');
  list = rememberSite(list, 'https://wetter.com');
  list = rememberSite(list, 'tagesschau.de');
  assert.deepEqual(list.map((e) => e.host), ['tagesschau.de', 'wetter.com'], 'reopening moves a site to the front without duplicates');
  assert.equal(rememberSite(list, 'kaputt').length, 2);
  assert.equal(rememberSite(Array.from({ length: 14 }, (_, i) => ({ url: `https://s${i}.de/`, host: `s${i}.de` })), 'neu.de').length, 12);
});
