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
