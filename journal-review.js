'use strict';

const PERIODS = {
  weekly: 'Week',
  monthly: 'Month',
  quarterly: 'Quarter',
  yearly: 'Year'
};

function dateProperty(value, metrics) {
  const key = value instanceof Date && Number.isFinite(value.valueOf())
    ? value.toISOString().slice(0, 10)
    : String(value ?? '').slice(0, 10);
  return metrics.dayNumber(key) === null ? null : key;
}

function periodForDate(date, kind, metrics) {
  const day = metrics.dayNumber(date);
  if (day === null) return null;
  if (kind === 'weekly') {
    const weekday = (new Date(day * 86400000).getUTCDay() + 6) % 7;
    return { start: metrics.shift(date, -weekday), end: metrics.shift(date, 6 - weekday) };
  }

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (kind === 'yearly') return { start: date.slice(0, 4) + '-01-01', end: date.slice(0, 4) + '-12-31' };
  if (kind !== 'quarterly' && kind !== 'monthly') return null;
  const first = kind === 'quarterly' ? Math.floor((month - 1) / 3) * 3 + 1 : month;
  const last = kind === 'quarterly' ? first + 2 : first;
  return {
    start: date.slice(0, 4) + '-' + String(first).padStart(2, '0') + '-01',
    end: new Date(Date.UTC(year, last, 0)).toISOString().slice(0, 10)
  };
}

function readPeriod(file, kind, properties, metrics) {
  const start = dateProperty(properties['journal-start-date'], metrics);
  const end = dateProperty(properties['journal-end-date'], metrics);
  if (start && end && start <= end) return { start, end };
  if (kind === 'weekly') {
    const week = metrics.isoWeekStart(file.basename);
    if (week) return { start: week.start, end: week.end };
  }

  let named;
  if (kind === 'monthly') {
    const month = file.basename.match(/^(\d{4}-\d{2})(?:\D|$)/)?.[1];
    if (month) named = month + '-01';
  }
  if (kind === 'yearly') {
    const year = file.basename.match(/^(\d{4})(?:\D|$)/)?.[1];
    if (year) named = year + '-01-01';
  }
  if (kind === 'quarterly') {
    const match = file.basename.match(/^(\d{4})-Q([1-4])(?:\D|$)/i);
    if (match) named = match[1] + '-' + String((Number(match[2]) - 1) * 3 + 1).padStart(2, '0') + '-01';
  }
  const date = start || dateProperty(properties['journal-date'], metrics) || dateProperty(named, metrics);
  return date ? periodForDate(date, kind, metrics) : null;
}

function readReview(entries, weekly, anchor, kind, today, metrics, aggregateDays) {
  const full = periodForDate(anchor, kind, metrics);
  const range = { start: full.start, end: full.end > today ? today : full.end };
  const prior = periodForDate(metrics.shift(range.start, -1), kind, metrics);
  const records = entries.filter(entry => entry.date && entry.date >= range.start && entry.date <= range.end);
  const writing = aggregateDays(records);
  const ratings = metrics.ratings(records, range, today);
  const weeks = metrics.weekly(weekly);
  const current = metrics.selectedWeeks(weeks, range, today);
  const previous = metrics.selectedWeeks(weeks, prior, today);
  const priorScores = new Map(metrics.wheelSummary(previous).map(category => [category.key, category.value]));
  const changes = metrics.wheelSummary(current).flatMap(category => {
    const before = priorScores.get(category.key);
    if (category.value === null || before === null || before === undefined) return [];
    return [{ ...category, before, change: Math.round((category.value - before) * 10) / 10 }];
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.label.localeCompare(b.label));
  return { full, range, prior, records, writing, ratings, changes, wheelWeeks: [...current, ...previous] };
}

function readChecks(entries, today, metrics, attachmentAvailable) {
  const byDate = new Map();
  const attachments = [];
  for (const entry of entries) {
    if (entry.date) {
      if (!byDate.has(entry.date)) byDate.set(entry.date, []);
      byDate.get(entry.date).push(entry);
    }
    const missing = (entry.photos || []).filter(photo =>
      photo.kind === 'dayone' || (photo.kind === 'local' && !attachmentAvailable(photo, entry)));
    if (missing.length) attachments.push({ entry, missing });
  }
  const duplicateDates = [...byDate.entries()].filter(([, rows]) => rows.length > 1).map(([date, records]) => ({ date, records }));
  const conflicts = metrics.ratings(entries, { start: '0001-01-01', end: today }, today).conflicts.reverse();
  return { duplicateDates, conflicts, attachments };
}

function install(JournalView, { el, button, formatNumber, formatDate, localKey, metrics, aggregateDays, memoryEligible, TFile }) {
  const shortDate = date => formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' });
  const score = value => formatNumber(Math.round(value * 10) / 10);
  const setFocusKey = (node, key) => node.setAttribute('data-ji-focus', key);

  JournalView.prototype.insightsTitle = function(root) {
    const heading = this.title(root, '', 'Insights');
    const switcher = el(heading, 'div', 'ji-mode-switch');
    switcher.setAttribute('aria-label', 'Insights view');
    for (const [id, label] of [['analytics', 'Analytics'], ['review', 'Review']]) {
      const mode = button(switcher, label, () => {
        this.insightsMode = id;
        this.drill = null;
        this.clearScroll('insights');
        this.render();
        this.contentEl.querySelector?.('[data-ji-focus="insights-mode-' + id + '"]')?.focus({ preventScroll: true });
      }, 'ji-mode-button');
      setFocusKey(mode, 'insights-mode-' + id);
      mode.setAttribute('aria-pressed', String((this.insightsMode || 'analytics') === id));
    }
    return heading;
  };

  JournalView.prototype.renderReview = function(root, entries) {
    const today = localKey(new Date());
    const kind = this.reviewKind || 'weekly';
    const anchor = this.reviewDate && this.reviewDate <= today ? this.reviewDate : today;
    const review = readReview(entries, this.weekEntries, anchor, kind, today, metrics, aggregateDays);
    const { range, full, prior, records, writing, ratings, changes, wheelWeeks } = review;

    const toolbar = el(root, 'div', 'ji-review-toolbar');
    const select = el(toolbar, 'select', 'ji-select');
    select.setAttribute('aria-label', 'Review period');
    setFocusKey(select, 'review-kind');
    for (const k of ['weekly', 'monthly']) el(select, 'option', '', PERIODS[k]).value = k;
    select.value = kind;
    const repeat = () => { this.drill = null; this.render(); };
    select.addEventListener('change', () => { this.reviewKind = select.value; repeat(); });

    const move = (date, label, direction) => {
      const control = button(toolbar, label, () => { this.reviewDate = date; repeat(); });
      control.setAttribute('aria-label', label + ' ' + PERIODS[kind].toLowerCase());
      control.disabled = date > today;
      setFocusKey(control, 'review-' + direction);
    };
    move(prior.start, 'Previous', 'previous');
    const date = el(toolbar, 'input', 'ji-input');
    date.type = 'date';
    date.value = anchor;
    date.max = today;
    date.setAttribute('aria-label', 'Choose a date in the review period');
    setFocusKey(date, 'review-date');
    date.addEventListener('change', () => {
      if (date.value && date.value <= today && metrics.dayNumber(date.value) !== null) {
        this.reviewDate = date.value;
        repeat();
      }
    });
    move(metrics.shift(full.end, 1), 'Next', 'next');
    const current = button(toolbar, 'This ' + PERIODS[kind].toLowerCase(), () => { this.reviewDate = today; repeat(); });
    setFocusKey(current, 'review-current');
    el(root, 'p', 'ji-period-caption', shortDate(range.start) + ' – ' + shortDate(range.end) + (range.end < full.end ? ' · In progress' : ''));

    const group = el(root, 'div', 'ji-review-grid');
    const writingPanel = el(group, 'section', 'ji-panel ji-review-card');
    this.title(writingPanel, '', 'Writing');
    const writingDays = writing.active.length;
    el(writingPanel, 'strong', 'ji-review-value', formatNumber(writingDays) + (writingDays === 1 ? ' day' : ' days'));
    el(writingPanel, 'span', 'ji-muted', formatNumber(writing.words) + ' words');
    const writingSources = records.filter(entry => entry.words > 0);
    if (writingSources.length) button(writingPanel, 'View entries', () => this.explore('Writing entries', writingSources), 'ji-link');

    const ratingPanel = el(group, 'section', 'ji-panel ji-review-card');
    this.title(ratingPanel, '', 'Daily ratings');
    el(ratingPanel, 'strong', 'ji-review-value', ratings.average === null ? '—' : score(ratings.average) + ' / 10');
    const ratedDays = ratings.data.length;
    el(ratingPanel, 'span', 'ji-muted', formatNumber(ratedDays) + (ratedDays === 1 ? ' rated day' : ' rated days'));
    if (ratedDays) button(ratingPanel, 'View ratings', () => this.explore('Rated entries', ratings.data.flatMap(day => day.records)), 'ji-link');
    if (ratings.conflicts.length) {
      button(ratingPanel, 'Conflicting ratings', () => this.explore('Conflicting ratings', ratings.conflicts.flatMap(day => day.records)), 'ji-link');
    }

    const periodNotes = this.periods.filter(row => row.kind === kind &&
      row.period.start <= anchor && row.period.end >= anchor);
    if (periodNotes.length) {
      const links = el(root, 'div', 'ji-inline-actions');
      for (const row of periodNotes) button(links, 'Open ' + PERIODS[kind].toLowerCase() + ' note', () => this.openEntry(row));
    }
    this.renderDrill(root);

    const wheel = el(root, 'section', 'ji-panel ji-review-wheel');
    this.title(wheel, '', 'Wheel of Life', 'vs. ' + shortDate(prior.start) + ' – ' + shortDate(prior.end));
    const shown = changes.filter(category => category.change !== 0).slice(0, 3);
    if (!shown.length) {
      el(wheel, 'p', 'ji-empty', changes.length ? 'No change in comparable scores.' : 'Add ratings in both periods to compare them.');
    }
    for (const category of shown) {
      const row = el(wheel, 'div', 'ji-review-wheel-row');
      el(row, 'span', '', category.label);
      el(row, 'span', 'ji-muted', score(category.before) + ' → ' + score(category.value));
      el(row, 'strong', '', (category.change > 0 ? '+' : '') + score(category.change));
    }
    const weeklySources = new Map();
    for (const week of wheelWeeks) {
      if (!Object.values(week.values).some(value => value !== null)) continue;
      for (const row of week.records) weeklySources.set(row.file.path, row);
    }
    if (weeklySources.size) {
      const details = el(wheel, 'details', 'ji-chart-details');
      el(details, 'summary', '', 'Weekly notes');
      for (const row of weeklySources.values()) button(details, row.file.basename, () => this.openEntry(row), 'ji-link ji-period-source');
    }

    const memories = el(root, 'section', 'ji-review-memories');
    this.title(memories, '', 'Entries to revisit');
    const prefs = this.prefs(), saved = new Set(prefs.savedMemories);
    const highlights = records.filter(entry => memoryEligible(entry, prefs.excluded)).sort((a, b) =>
      Number(saved.has(b.file.path)) - Number(saved.has(a.file.path)) ||
      Number(Boolean(b.photos?.length)) - Number(Boolean(a.photos?.length)) ||
      b.words - a.words || b.date.localeCompare(a.date));
    this.cards(memories, highlights.slice(0, 3), false);
  };

  JournalView.prototype.renderJournalCheck = function(root, entries) {
    const head = this.title(root, '', 'Journal Check');
    button(head, 'Back to Settings', () => this.navigate('settings'), 'ji-button ji-quiet');
    const result = readChecks(entries, localKey(new Date()), metrics, (photo, entry) => {
      try {
        return this.app.metadataCache.getFirstLinkpathDest(photo.target, entry.file.path) instanceof TFile;
      } catch { return false; }
    });

    const groups = [
      {
        label: 'Dates with multiple Daily files', rows: result.duplicateDates,
        render: (row, record) => {
          el(row, 'span', 'ji-setting-name', shortDate(record.date));
          for (const source of record.records) button(row, source.file.path, () => this.openEntry(source), 'ji-link ji-check-source');
        }
      },
      {
        label: 'Dates with conflicting ratings', rows: result.conflicts,
        render: (row, record) => {
          el(row, 'span', 'ji-setting-name', shortDate(record.date));
          for (const source of record.records) {
            button(row, source.file.path + ' · ' + score(source.rating) + ' / 10', () => this.openEntry(source), 'ji-link ji-check-source');
          }
        }
      },
      {
        label: 'Notes with unavailable images', rows: result.attachments,
        render: (row, { entry, missing }) => {
          button(row, entry.file.path, () => this.openEntry(entry), 'ji-link ji-check-source');
          const list = el(row, 'ul', 'ji-check-images');
          for (const photo of missing) {
            el(list, 'li', 'ji-muted', (photo.kind === 'dayone' ? 'Day One media: ' : 'File not found: ') + photo.target);
          }
        }
      }
    ];

    for (const { label, rows, render } of groups) {
      const section = el(root, 'details', 'ji-panel ji-check-panel');
      el(section, 'summary', '', label + ' (' + formatNumber(rows.length) + ')');
      if (!rows.length) {
        el(section, 'p', 'ji-empty', 'None found.');
        continue;
      }
      const list = el(section, 'ul', 'ji-check-list');
      let shown = 0;
      const more = button(section, 'Show more', () => append());
      const append = () => {
        for (const record of rows.slice(shown, shown + 12)) render(el(list, 'li', 'ji-check-row'), record);
        shown += 12;
        more.hidden = shown >= rows.length;
      };
      append();
    }
  };
}

module.exports = { install, PERIODS, periodForDate, readPeriod, readReview, readChecks };
