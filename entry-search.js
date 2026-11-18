'use strict';

const ENTRY_PAGE = 36;
const PHOTO_PAGE = 36;

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/đ/g, 'd');
}

function queryText(value) {
  return fold(value).trim().replace(/\s+/g, ' ');
}

function searchEntry(entry, filters) {
  const { query, year, start, end, photos, rating } = filters;
  const date = entry.date;
  if (year && year !== 'all' && !date?.startsWith(year + '-')) return false;
  if ((start && (!date || date < start)) || (end && (!date || date > end))) return false;
  if (photos && !entry.photos?.length) return false;
  const score = entry.rating ?? null;
  if (rating === 'rated' && score === null) return false;
  if (rating === 'unrated' && score !== null) return false;
  if (rating?.startsWith('min-') && (score === null || score < Number(rating.slice(4)))) return false;
  return !query || (entry.searchText ?? fold(entry.text)).includes(query) ||
    fold(entry.file.basename).includes(query) || Boolean(date?.includes(query));
}

function excerpt(text, query, length = 220) {
  if (!text) return { before: '', match: '', after: '' };
  if (!query) return {
    before: text.slice(0, length) + (text.length > length ? '…' : ''),
    match: '', after: ''
  };

  // Build offsets in the original spelling so precomposed Vietnamese and
  // decomposed combining marks are highlighted without altering the preview.
  let folded = '', offset = 0;
  const positions = [];
  for (const symbol of text) {
    const next = offset + symbol.length;
    const part = fold(symbol);
    folded += part;
    if (!part && positions.length) positions[positions.length - 1].end = next;
    for (let i = 0; i < part.length; i++) positions.push({ start: offset, end: next });
    offset = next;
  }
  const hit = folded.indexOf(query);
  if (hit < 0) return excerpt(text, '', length);
  const start = positions[hit].start, end = positions[hit + query.length - 1].end;
  const from = Math.max(0, start - Math.floor(length / 4));
  const through = Math.min(text.length, Math.max(end, from + length));
  return {
    before: (from ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, through) + (through < text.length ? '…' : '')
  };
}

function photoTimeline(entries, eligible) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.date || !entry.photos?.length || !eligible(entry)) continue;
    const month = entry.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    for (const photo of entry.photos) groups.get(month).push({ entry, photo });
  }
  return groups;
}

function install(JournalView, { el, button, formatNumber, formatDate, localKey, memoryEligible }) {
  const tabTitle = (view, root, mode) => {
    const title = view.title(root, '', 'Entries');
    const switcher = el(title, 'div', 'ji-mode-switch');
    switcher.setAttribute('aria-label', 'Entries view');
    for (const [id, label] of [['entries', 'Entries'], ['photos', 'Photo Timeline']]) {
      const control = button(switcher, label, () => {
        view.entriesMode = id;
        view.clearScroll('entries');
        view.render();
        view.contentEl.querySelector?.('[data-ji-focus="entries-mode-' + id + '"]')?.focus({ preventScroll: true });
      }, 'ji-mode-button');
      control.setAttribute('aria-pressed', String(mode === id));
      control.setAttribute('data-ji-focus', 'entries-mode-' + id);
    }
  };

  JournalView.prototype.renderEntries = function(root, entries) {
    const mode = this.entriesMode || 'entries';
    tabTitle(this, root, mode);
    if (mode === 'photos') {
      this.renderPhotoTimeline(root, entries);
      return;
    }

    const toolbar = el(root, 'div', 'ji-entry-tools');
    const search = el(toolbar, 'input', 'ji-input');
    search.type = 'search';
    search.placeholder = 'Search entries…';
    search.value = this.query;
    search.setAttribute('aria-label', 'Search entries');
    search.setAttribute('data-ji-focus', 'entry-search');

    const years = ['all', ...[...new Set(entries.flatMap(entry => entry.date ? [entry.date.slice(0, 4)] : []))].sort().reverse()];
    if (!years.includes(this.entryYear)) this.entryYear = 'all';
    const year = el(toolbar, 'select', 'ji-select');
    year.setAttribute('aria-label', 'Filter entries by year');
    year.setAttribute('data-ji-focus', 'entry-year');
    for (const value of years) el(year, 'option', '', value === 'all' ? 'All years' : value).value = value;
    year.value = this.entryYear;

    const filters = this.entryFilters || (this.entryFilters = {});
    const advanced = el(root, 'details', 'ji-entry-filters');
    advanced.open = this.entryFiltersOpen ?? Boolean(filters.start || filters.end || filters.photos || filters.rating);
    el(advanced, 'summary', '', 'Filters');
    advanced.addEventListener('toggle', () => {
      if (advanced.isConnected) this.entryFiltersOpen = advanced.open;
    });
    const fields = el(advanced, 'div', 'ji-filter-fields');
    const dates = {};
    for (const [key, label] of [['start', 'From'], ['end', 'Through']]) {
      const lab = el(fields, 'label', 'ji-date-label');
      el(lab, 'span', '', label);
      const input = el(lab, 'input', 'ji-input');
      input.type = 'date';
      input.value = filters[key] || '';
      input.setAttribute('data-ji-focus', 'entry-' + key);
      dates[key] = input;
    }

    const ratingLabel = el(fields, 'label', 'ji-date-label');
    el(ratingLabel, 'span', '', 'Rating');
    const rating = el(ratingLabel, 'select', 'ji-select');
    rating.setAttribute('data-ji-focus', 'entry-rating');
    for (const [value, label] of [['', 'Any rating'], ['rated', 'Rated'], ['unrated', 'Unrated']]) {
      el(rating, 'option', '', label).value = value;
    }
    for (let min = 2; min <= 10; min++) el(rating, 'option', '', min + ' or higher').value = 'min-' + min;
    rating.value = filters.rating || '';

    const photoLabel = el(fields, 'label', 'ji-toggle-label ji-filter-photos');
    const photos = el(photoLabel, 'input');
    photos.type = 'checkbox';
    photos.checked = Boolean(filters.photos);
    photos.setAttribute('data-ji-focus', 'entry-photos');
    el(photoLabel, 'span', '', 'Has photos');

    const results = el(root, 'div', 'ji-results');
    const status = el(results, 'p', 'ji-result-count');
    status.setAttribute('role', 'status');
    const list = el(results, 'div', 'ji-filter-list');
    const draw = () => {
      list.empty();
      if (filters.start && filters.end && filters.start > filters.end) {
        status.textContent = 'Choose an end date on or after the start date.';
        return;
      }
      const query = queryText(this.query);
      const found = entries.filter(entry => searchEntry(entry, { ...filters, query, year: this.entryYear }));
      status.textContent = formatNumber(found.length) + (found.length === 1 ? ' entry' : ' entries');
      this.cards(list, found.slice(0, this.limit), false, { query });
      if (found.length > this.limit) {
        button(list, 'Load more', () => {
          this.limit += ENTRY_PAGE;
          draw();
          list.querySelector?.('.ji-card-item:nth-child(' + (this.limit - ENTRY_PAGE + 1) + ') .ji-card')?.focus();
        }, 'ji-button ji-more');
      }
    };
    const resetPage = () => { this.limit = ENTRY_PAGE; draw(); };
    search.addEventListener('input', () => { this.query = search.value; resetPage(); });
    year.addEventListener('change', () => { this.entryYear = year.value; resetPage(); });
    dates.start.addEventListener('change', () => { filters.start = dates.start.value; resetPage(); });
    dates.end.addEventListener('change', () => { filters.end = dates.end.value; resetPage(); });
    rating.addEventListener('change', () => { filters.rating = rating.value; resetPage(); });
    photos.addEventListener('change', () => { filters.photos = photos.checked; resetPage(); });
    button(fields, 'Clear filters', () => {
      this.query = search.value = '';
      this.entryYear = year.value = 'all';
      dates.start.value = dates.end.value = rating.value = '';
      photos.checked = false;
      Object.assign(filters, { start: '', end: '', rating: '', photos: false });
      resetPage();
    }, 'ji-button ji-quiet');
    draw();
  };

  JournalView.prototype.renderPhotoTimeline = function(root, entries) {
    if (this.prefs().showPhotoPreviews === false) {
      el(root, 'p', 'ji-empty', 'Photo previews are turned off.');
      button(root, 'Picture settings', () => this.navigate('settings'), 'ji-button');
      return;
    }
    const today = localKey(new Date()), { excluded } = this.prefs();
    const groups = photoTimeline(entries, entry => entry.date <= today && memoryEligible(entry, excluded));
    const months = [...groups.keys()].sort().reverse();
    if (!months.length) {
      el(root, 'p', 'ji-empty', 'No journal photos to show yet.');
      return;
    }

    const label = el(root, 'label', 'ji-date-label ji-photo-month-label');
    el(label, 'span', '', 'Month');
    const selector = el(label, 'select', 'ji-select');
    selector.setAttribute('data-ji-focus', 'photo-month');
    el(selector, 'option', '', 'All months').value = 'all';
    const monthLabel = month => formatDate(month + '-01', { month: 'long', year: 'numeric' });
    for (const month of months) el(selector, 'option', '', monthLabel(month)).value = month;
    if (!this.photoMonth || (this.photoMonth !== 'all' && !months.includes(this.photoMonth))) this.photoMonth = 'all';
    selector.value = this.photoMonth;
    selector.addEventListener('change', () => {
      this.photoMonth = selector.value;
      this.photoLimit = PHOTO_PAGE;
      this.clearScroll('entries');
      this.render();
    });

    const shownMonths = this.photoMonth === 'all' ? months : [this.photoMonth];
    let remaining = this.photoLimit || PHOTO_PAGE;
    for (const month of shownMonths) {
      if (remaining <= 0) break;
      const section = el(root, 'section', 'ji-timeline-month');
      this.title(section, '', monthLabel(month));
      const grid = el(section, 'div', 'ji-timeline-grid');
      for (const { entry, photo } of groups.get(month).slice(0, remaining)) {
        const item = el(grid, 'article', 'ji-timeline-item');
        const dateLabel = formatDate(entry.date, { month: 'short', day: 'numeric' });
        this.plugin.photoController.gallery(item, [photo], entry.file.path, {
          limit: 1, className: 'ji-timeline-photo', onOpen: () => this.openEntry(entry),
          label: 'Open journal entry for ' + entry.date
        });
        el(item, 'span', 'ji-timeline-date', dateLabel);
        remaining--;
      }
    }
    const total = shownMonths.reduce((sum, month) => sum + groups.get(month).length, 0);
    if (total > (this.photoLimit || PHOTO_PAGE)) {
      const more = button(root, 'Load more photos', () => {
        const oldLimit = this.photoLimit || PHOTO_PAGE;
        this.photoLimit = oldLimit + PHOTO_PAGE;
        this.render();
        this.contentEl.querySelectorAll?.('.ji-timeline-photo .ji-photo-tile')[oldLimit]?.focus();
      }, 'ji-button ji-more');
      more.setAttribute('data-ji-focus', 'photo-more');
    }
  };
}

module.exports = { install, fold, queryText, searchEntry, excerpt, photoTimeline };
