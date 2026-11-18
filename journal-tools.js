'use strict';

function remapPaths(paths, oldPath, newPath, includeChildren = false) {
  return [...new Set((paths || []).map(path => {
    if (path === oldPath) return newPath;
    if (includeChildren && path.startsWith(oldPath + '/')) return newPath + path.slice(oldPath.length);
    return path;
  }))];
}

function visibleSaved(entries, prefs, today, memoryEligible) {
  const byPath = new Map(entries.map(entry => [entry.file.path, entry]));
  return prefs.savedMemories.flatMap(path => {
    const entry = byPath.get(path);
    return entry && entry.date <= today && memoryEligible(entry, prefs.excluded) ? [entry] : [];
  });
}

function journalsApi(app) {
  return app.plugins?.getPlugin?.('journals')?.api ?? app.plugins?.plugins?.journals?.api;
}

async function openThroughJournals(app, day) {
  const api = journalsApi(app);
  if (typeof api?.openNote !== 'function') return false;
  await api.openNote({ writeType: 'day' }, day, { openMode: 'tab' });
  return true;
}

class RatingChangedError extends Error {}

async function updateRating({ fileManager, file, date, value, expected, dateFromFile, metrics }) {
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    throw new RangeError('Choose an integer rating from 1 to 10.');
  }
  if (!fileManager?.processFrontMatter) throw new Error('Note properties are unavailable.');
  await fileManager.processFrontMatter(file, properties => {
    if (dateFromFile(file, properties) !== date || metrics.score(properties.dayRating) !== expected) {
      throw new RatingChangedError('The note date or rating changed before saving.');
    }
    properties.dayRating = value;
  });
}

function install(JournalView, { el, button, formatDate, localKey, TFile, Modal, Notice,
  metrics, review, dateFromFile, memoryEligible, Platform }) {
  const eligible = (view, entry) => entry.date <= localKey(new Date()) && memoryEligible(entry, view.prefs().excluded);

  JournalView.prototype.openEntry = async function(entry) {
    const path = entry.file.path;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice('This journal note is no longer available.');
      return false;
    }
    try {
      const workspace = this.app.workspace;
      const existing = workspace.getLeavesOfType?.('markdown').find(leaf => leaf.view?.file === file);
      if (existing) await workspace.revealLeaf(existing);
      else await workspace.getLeaf('tab').openFile(file);
      return true;
    } catch {
      new Notice('Could not open the journal note.');
      return false;
    }
  };

  JournalView.prototype.withToday = async function(action) {
    if (this.todayBusy) return;
    this.todayBusy = true;
    try { await action(); }
    finally { this.todayBusy = false; }
  };

  JournalView.prototype.todayEntries = async function(date) {
    const snapshot = await this.plugin.journalIndex.update();
    return snapshot.entries.filter(entry => entry.date === date);
  };

  JournalView.prototype.pickDaily = function(title, entries, onPick) {
    const modal = new Modal(this.app);
    modal.onOpen = () => {
      const root = modal.contentEl;
      root.empty();
      el(root, 'h2', 'ji-modal-heading', title);
      const list = el(root, 'div', 'ji-modal-list');
      for (const entry of entries) {
        const label = entry.file.path + (entry.rating === null ? '' : ' · ' + entry.rating + ' / 10');
        button(list, label, () => { modal.close(); onPick(entry); }, 'ji-button ji-note-choice');
      }
    };
    modal.open();
  };

  JournalView.prototype.openToday = function() {
    return this.withToday(async () => {
      const today = localKey(new Date());
      try {
        const entries = await this.todayEntries(today);
        if (entries.length === 1) await this.openEntry(entries[0]);
        else if (entries.length > 1) this.pickDaily('Choose today’s note', entries, entry => this.openEntry(entry));
        else if (!await openThroughJournals(this.app, today)) {
          new Notice('Enable the Journals plugin to create today’s note from its template.');
        }
      } catch (error) {
        if (error?.code !== 'cancelled' && error?.code !== 'canceled') {
          new Notice('Journals could not open or create today’s note. Check its Daily journal settings.');
        }
      }
    });
  };

  JournalView.prototype.quickRating = function() {
    return this.withToday(async () => {
      try {
        const today = localKey(new Date());
        const entries = await this.todayEntries(today);
        if (!entries.length) {
          new Notice('Use Today to open or create your note first.');
          return;
        }
        if (entries.length === 1) this.rateEntry(entries[0]);
        else this.pickDaily('Choose the note to rate', entries, entry => this.rateEntry(entry));
      } catch {
        new Notice('Could not find today’s notes.');
      }
    });
  };

  JournalView.prototype.rateEntry = function(entry) {
    const modal = new Modal(this.app);
    modal.onOpen = () => {
      const root = modal.contentEl;
      root.empty();
      el(root, 'h2', 'ji-modal-heading', 'Quick Rating');
      el(root, 'p', 'ji-muted ji-modal-path', entry.file.path);
      const label = el(root, 'label', 'ji-date-label');
      el(label, 'span', '', 'Day rating');
      const input = el(label, 'select', 'ji-select');
      el(input, 'option', '', 'Choose a rating').value = '';
      if (entry.rating !== null && !Number.isInteger(entry.rating)) {
        el(input, 'option', '', 'Current: ' + entry.rating + ' / 10').value = String(entry.rating);
      }
      for (let n = 1; n <= 10; n++) el(input, 'option', '', n + ' / 10').value = String(n);
      input.value = entry.rating === null ? '' : String(entry.rating);
      const status = el(root, 'p', 'ji-settings-error');
      status.setAttribute('role', 'alert');
      const save = button(root, 'Save rating', async () => {
        const value = Number(input.value);
        const file = this.app.vault.getAbstractFileByPath(entry.file.path);
        if (file !== entry.file || this.plugin.journalKind(file?.path || '') !== 'daily') {
          status.textContent = 'This note moved or changed. Reopen Quick Rating and choose the note again.';
          return;
        }
        save.disabled = input.disabled = true;
        try {
          await updateRating({ fileManager: this.app.fileManager, file, date: entry.date,
            value, expected: entry.rating, dateFromFile, metrics });
          modal.close();
          new Notice('Rating saved.');
        } catch (error) {
          status.textContent = error instanceof RatingChangedError
            ? 'The note changed. Reopen Quick Rating to see its latest rating.'
            : 'Could not save the rating.';
          input.disabled = false;
          if (!(error instanceof RatingChangedError)) syncSave();
        }
      });
      const syncSave = () => {
        const value = Number(input.value);
        save.disabled = !Number.isInteger(value) || value < 1 || value > 10 || value === entry.rating;
      };
      input.addEventListener('change', () => { status.textContent = ''; syncSave(); });
      syncSave();
    };
    modal.open();
  };

  JournalView.prototype.renderHomeActions = function(root, today, entries) {
    el(root, 'span', 'ji-home-date', formatDate(today));
    const actions = el(root, 'div', 'ji-inline-actions');
    button(actions, 'Today', () => this.openToday(), 'ji-button ji-primary');
    if (entries.some(entry => entry.date === today)) {
      button(actions, 'Quick Rating', () => this.quickRating(), 'ji-button');
    }
  };

  JournalView.prototype.isCompactHome = function(prefs) {
    return prefs.compactHome === 'on' || (prefs.compactHome !== 'off' && Boolean(Platform?.isMobile));
  };

  JournalView.prototype.renderSaveMemory = function(root, entry) {
    if (!eligible(this, entry)) return;
    const path = entry.file.path;
    const setLabel = (control, saved) => {
      control.textContent = saved ? 'Saved' : 'Save';
      control.setAttribute('aria-pressed', String(saved));
      control.setAttribute('aria-label', saved ? 'Remove saved memory for ' + entry.date : 'Save memory for ' + entry.date);
    };
    const control = button(root, '', async () => {
      if (!eligible(this, entry)) return;
      const old = this.prefs().savedMemories;
      const add = !old.includes(path);
      const paths = add ? [path, ...old] : old.filter(item => item !== path);
      control.disabled = true;
      try {
        if (!await this.savePrefs({ savedMemories: paths })) return;
        if (this.tab === 'memories' && this.memoriesMode === 'saved') {
          this.render();
          this.contentEl.querySelector?.('[data-ji-focus="memory-saved"]')?.focus({ preventScroll: true });
          return;
        }
        for (const matching of this.contentEl.querySelectorAll('.ji-save-memory')) {
          if (matching.getAttribute('data-ji-path') === path) setLabel(matching, add);
        }
      } finally { control.disabled = false; }
    }, 'ji-link ji-save-memory');
    control.setAttribute('data-ji-path', path);
    setLabel(control, this.prefs().savedMemories.includes(path));
  };

  JournalView.prototype.renderEntryActions = function(root, entry) {
    const actions = el(root, 'div', 'ji-entry-actions');
    this.renderSaveMemory(actions, entry);
    if (entry.date) button(actions, 'Periods', () => this.showPeriods(entry.file), 'ji-link');
    if (!actions.children.length) actions.remove();
  };

  JournalView.prototype.renderMemoryNavigation = function(root, entries) {
    const heading = this.title(root, '', 'On This Day');
    const switcher = el(heading, 'div', 'ji-mode-switch');
    switcher.setAttribute('aria-label', 'Memory view');
    const mode = this.memoriesMode || 'day';
    for (const [id, label] of [['day', 'By date'], ['saved', 'Saved']]) {
      const control = button(switcher, label, () => {
        this.memoriesMode = id;
        this.clearScroll('memories');
        this.render();
        this.contentEl.querySelector?.('[data-ji-focus="memory-' + id + '"]')?.focus({ preventScroll: true });
      }, 'ji-mode-button');
      control.setAttribute('data-ji-focus', 'memory-' + id);
      control.setAttribute('aria-pressed', String(mode === id));
    }
    if (mode === 'day') return false;
    const today = localKey(new Date());
    const entriesToShow = visibleSaved(entries, this.prefs(), today, memoryEligible);
    if (entriesToShow.length) {
      const limit = this.savedLimit || 18;
      this.memoryCards(root, entriesToShow.slice(0, limit), today, false);
      if (entriesToShow.length > limit) {
        const more = button(root, 'Load more', () => {
          this.savedLimit = limit + 18;
          this.render();
          this.contentEl.querySelectorAll('.ji-memory-card .ji-button')[limit]?.focus();
        });
        more.setAttribute('data-ji-focus', 'saved-more');
      }
    } else {
      el(root, 'p', 'ji-empty', 'Save an entry to find it here.');
    }
    return true;
  };

  JournalView.prototype.showEntriesForPeriod = function(period) {
    this.query = '';
    this.entryYear = 'all';
    this.limit = 36;
    this.entryFiltersOpen = true;
    this.entryFilters = { start: period.start, end: period.end };
    this.entriesMode = 'entries';
    this.clearScroll('entries');
    this.navigate('entries');
  };

  JournalView.prototype.showPeriods = async function(file) {
    try {
      const kind = this.plugin.journalKind(file.path);
      const snapshot = await this.plugin.journalIndex.update();
      const daily = kind === 'daily' && snapshot.entries.find(row => row.file.path === file.path);
      const current = snapshot.periods.find(row => row.file.path === file.path);
      if (!daily?.date && !current?.period) {
        new Notice('This note has no recognized journal date.');
        return;
      }

      const modal = new Modal(this.app);
      modal.onOpen = () => {
        const root = modal.contentEl;
        root.empty();
        el(root, 'h2', 'ji-modal-heading', 'Journal Periods');
        if (daily) {
          el(root, 'p', 'ji-muted', formatDate(daily.date));
          for (const [key, label] of Object.entries(review.PERIODS)) {
            const row = el(root, 'div', 'ji-period-row');
            el(row, 'span', 'ji-setting-name', label);
            const matches = snapshot.periods.filter(item =>
              item.kind === key && item.period.start <= daily.date && item.period.end >= daily.date);
            for (const item of matches) {
              const link = button(row, item.file.basename, () => { modal.close(); this.openEntry(item); }, 'ji-link');
              link.title = item.file.path;
            }
            if (!matches.length) el(row, 'span', 'ji-muted', 'No note');
          }
        } else {
          const { start, end } = current.period;
          const date = value => formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
          el(root, 'p', 'ji-muted', date(start) + ' – ' + date(end));
          button(root, 'View daily entries', () => {
            modal.close();
            this.app.workspace.revealLeaf(this.leaf);
            this.showEntriesForPeriod(current.period);
          }, 'ji-button');
        }
      };
      modal.open();
    } catch { new Notice('Could not open journal periods.'); }
  };
}

module.exports = { install, remapPaths, visibleSaved, openThroughJournals, updateRating, RatingChangedError };
