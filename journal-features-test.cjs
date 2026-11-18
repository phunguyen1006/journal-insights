'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { JournalIndex } = require('./journal-index');
const { queryText, searchEntry, excerpt, photoTimeline } = require('./entry-search');
const { periodForDate, readPeriod, readReview, readChecks } = require('./journal-review');
const { remapPaths, visibleSaved, openThroughJournals, updateRating, RatingChangedError } = require('./journal-tools');
const metrics = require('./metrics');
const { memoryEligible } = require('./experience');

const originalLoad = Module._load;
Module._load = function(name) {
  if (name === 'obsidian') return { Plugin: class {}, ItemView: class {}, PluginSettingTab: class {} };
  return originalLoad.apply(this, arguments);
};
const { aggregateDays, dateFromFile } = require('./main')._test;
Module._load = originalLoad;

function file(path) {
  return { path, basename: path.split('/').pop().replace(/\.md$/, ''), stat: { mtime: 1 } };
}
function entry(date, { words = 0, rating = null, photos = [], name = date, text = '', hidden = false } = {}) {
  return { date, kind: 'daily', words, rating, photos, text, private: hidden, file: file('daily/' + name + '.md') };
}

async function checkIndex() {
  const first = file('daily/2026-11-01.md');
  const second = file('daily/2026-11-02.md');
  const weekly = file('weekly/2026-W45.md');
  const available = [first, second, weekly, file('other/example.md')];
  const calls = [];
  let scans = 0, resolveStale, started;
  const inFlight = new Promise(resolve => { started = resolve; });
  const index = new JournalIndex({
    list: () => { scans++; return available; },
    classify: path => /^(daily|weekly)\//.exec(path)?.[1],
    load: async (note, kind, content) => {
      const path = note.path;
      calls.push([path, content]);
      if (content === 'slow') {
        started();
        await new Promise(resolve => { resolveStale = resolve; });
      }
      if (content === 'error') throw new Error('read failed');
      return kind === 'daily' ? { date: note.basename, text: content } : { period: { start: '2026-11-02' } };
    }
  });
  assert.equal((await index.update()).entries.length, 2);
  assert.equal(scans, 1);
  assert.equal(calls.length, 3);
  assert.equal((await index.update()).weekEntries.length, 1);
  assert.equal(calls.length, 3);

  first.stat.mtime++;
  index.invalidate(first);
  index.invalidate(first, 'new content', {});
  index.invalidate(first);
  assert.equal((await index.update()).entries.find(row => row.file === first).text, 'new content');
  assert.deepEqual(calls.slice(3), [[first.path, 'new content']]);
  assert.equal(scans, 1);

  index.invalidate(first, 'slow');
  const running = index.update();
  await inFlight;
  const oldPath = first.path;
  first.path = 'daily/2026-11-06.md';
  first.basename = '2026-11-06';
  index.forget(oldPath);
  index.invalidate(first, 'moved');
  const secondReader = index.update();
  assert.equal(running, secondReader);
  resolveStale();
  const moved = await running;
  assert.deepEqual(moved.entries.map(row => row.date), ['2026-11-06', '2026-11-02']);
  assert.equal(moved.entries[0].text, 'moved');
  assert.equal(index.rows.has(oldPath), false);

  index.invalidate(second, 'error');
  assert.equal((await index.update()).failed, 1);
  assert.equal(index.rows.has(second.path), false);

  index.requestScan(true);
  assert.equal((await index.update()).failed, 0);
  assert.equal(scans, 2);
  available.splice(available.indexOf(weekly), 1);
  index.requestScan();
  assert.deepEqual((await index.update()).periods, []);
}

async function checkRating() {
  const note = file('daily/2026-11-16-extra.md');
  const properties = { dayRating: 6.5, banner: 'photo.webp', private: true };
  const fileManager = { processFrontMatter: async (actual, change) => {
    assert.equal(actual, note);
    change(properties);
  }};
  const args = { file: note, fileManager, date: '2026-11-16', value: 8, expected: 6.5, dateFromFile, metrics };
  await updateRating(args);
  assert.deepEqual(properties, { dayRating: 8, banner: 'photo.webp', private: true });
  await assert.rejects(updateRating({ ...args, value: 9 }), RatingChangedError);
  await assert.rejects(updateRating({ ...args, expected: 8, date: '2026-11-17' }), RatingChangedError);
  await assert.rejects(updateRating({ ...args, expected: 8, value: 0 }), RangeError);
  assert.equal(properties.dayRating, 8);
}

(async () => {
  assert.equal(queryText('  ĐI    CHƠI '), 'di choi');
  const longText = 'Long introduction. '.repeat(25) + 'Mình đi chơi với bạn.';
  const a = entry('2026-11-16', { text: longText, rating: 8, words: 20, photos: [{ kind: 'local', target: 'missing.png' }] });
  const b = entry('2026-11-16', { name: '2026-11-16-conflict', text: 'Entry copy', rating: 6, words: 30 });
  const c = entry('2026-11-17', { rating: null, words: 5, photos: [{ kind: 'remote', target: 'https://example.org/remote.png' }] });
  const d = entry('2026-11-18', { hidden: true, photos: [{ kind: 'dayone', target: 'missing-old' }] });
  assert.equal(searchEntry(a, { query: 'di choi', year: '2026', start: '2026-11-01', end: '2026-11-16', photos: true, rating: 'min-8' }), true);
  assert.equal(searchEntry(a, { query: 'di choi', end: '2026-11-15' }), false);
  assert.equal(searchEntry(a, { query: 'di choi', rating: 'min-9' }), false);
  assert.equal(searchEntry(b, { query: '', photos: true }), false);
  assert.equal(searchEntry(c, { query: '', rating: 'unrated' }), true);
  assert.equal(excerpt(longText, 'di choi').match, 'đi chơi');
  assert.equal(excerpt('Mình đi chơi'.normalize('NFD'), 'di choi').match.normalize('NFC'), 'đi chơi');

  const periods = [
    ['2026-01-01', 'weekly', { start: '2025-12-29', end: '2026-01-04' }],
    ['2024-02-29', 'monthly', { start: '2024-02-01', end: '2024-02-29' }],
    ['2026-12-12', 'quarterly', { start: '2026-10-01', end: '2026-12-31' }],
    ['2026-12-12', 'yearly', { start: '2026-01-01', end: '2026-12-31' }]
  ];
  for (const [date, kind, range] of periods) assert.deepEqual(periodForDate(date, kind, metrics), range);
  assert.deepEqual(readPeriod(file('weekly/custom-name.md'), 'weekly', {
    'journal-start-date': '2026-11-15', 'journal-end-date': '2026-11-21'
  }, metrics), { start: '2026-11-15', end: '2026-11-21' });
  assert.deepEqual(readPeriod(file('quarterly/2026-Q4.md'), 'quarterly', {}, metrics), periods[2][2]);
  assert.equal(readPeriod(file('weekly/incomplete.md'), 'weekly', {}, metrics), null);

  const weekly = [
    { file: file('weekly/2026-W46.md'), wheel: { health: 5, career: 7 } },
    { file: file('weekly/2026-W47.md'), wheel: { health: 8, career: 6, finance: 9 } }
  ];
  const review = readReview([a, b, c, d], weekly, '2026-11-18', 'weekly', '2026-11-18', metrics, aggregateDays);
  assert.deepEqual(review.range, { start: '2026-11-16', end: '2026-11-18' });
  assert.equal(review.writing.words, 35);
  assert.equal(review.writing.active.length, 2);
  assert.equal(review.ratings.average, null);
  assert.equal(review.ratings.conflicts.length, 1);
  assert.deepEqual(review.changes.map(row => [row.key, row.change]), [['health', 3], ['career', -1]]);

  const groups = photoTimeline([d, c, b, a], row => memoryEligible(row, [c.file.path]));
  assert.deepEqual(groups.get('2026-11').map(({ entry }) => entry.file.path), [a.file.path]);
  const check = readChecks([d, c, b, a], '2026-11-18', metrics, () => false);
  assert.deepEqual(check.duplicateDates.map(row => row.date), ['2026-11-16']);
  assert.equal(check.conflicts.length, 1);
  assert.deepEqual(check.attachments.map(row => row.entry.file.path), [d.file.path, a.file.path]);

  const prefs = { savedMemories: [d.file.path, c.file.path, a.file.path], excluded: [c.file.path] };
  assert.deepEqual(visibleSaved([a, b, c, d], prefs, '2026-11-18', memoryEligible), [a]);
  assert.deepEqual(remapPaths(['daily/a.md', 'daily-extra/b.md'], 'daily', 'renamed', true), ['renamed/a.md', 'daily-extra/b.md']);
  assert.deepEqual(remapPaths(['daily/a.md', 'daily/b.md'], 'daily/a.md', 'daily/b.md'), ['daily/b.md']);

  const calls = [];
  const app = { plugins: { getPlugin: () => ({ api: { openNote: async (...args) => { calls.push(args); } } }) } };
  assert.equal(await openThroughJournals(app, '2026-11-18'), true);
  assert.deepEqual(calls, [[{ writeType: 'day' }, '2026-11-18', { openMode: 'tab' }]]);
  assert.equal(await openThroughJournals({}, '2026-11-18'), false);
  await checkRating();
  await checkIndex();
  console.log('PASS: Vietnamese search, tracked note updates and races, ratings, date windows, review, saved memories, photo timeline, journal checks and Journals handoff.');
})().catch(error => { console.error(error); process.exitCode = 1; });
