'use strict';

// One index serves all dashboard views. A batch of vault and metadata events
// only queues each changed path once, even when brought in by sync.
class JournalIndex {
  constructor({ list, classify, load }) {
    this.list = list;
    this.classify = classify;
    this.load = load;
    this.rows = new Map();
    this.errors = new Set();
    this.pending = new Map();
    this.requestScan();
  }

  requestScan(force = false) {
    this.needsScan = true;
    this.forceScan = this.forceScan || force;
  }

  invalidate(file, data, metadata) {
    if (!this.classify(file.path)) return false;
    const queued = this.pending.get(file.path);
    const stamp = file.stat?.mtime;
    if (!(data === undefined && queued?.data !== undefined && queued.file === file && queued.stamp === stamp)) {
      this.pending.set(file.path, { file, data, metadata, stamp });
    }
    return true;
  }

  forget(path) {
    if (!this.classify(path) && !this.rows.has(path) && !this.pending.has(path)) return false;
    this.pending.set(path, null);
    return true;
  }

  update() {
    if (!this.running) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    return this.running;
  }

  reconcile() {
    const force = this.forceScan;
    this.needsScan = this.forceScan = false;
    const paths = new Set();
    for (const file of this.list()) {
      const kind = this.classify(file.path);
      if (!kind) continue;
      paths.add(file.path);
      const previous = this.rows.get(file.path);
      if (!this.pending.get(file.path) &&
          (force || !previous || previous.file !== file || previous.kind !== kind ||
           previous.stamp !== file.stat?.mtime)) {
        this.invalidate(file);
      }
    }
    for (const path of [...this.rows.keys(), ...this.errors, ...this.pending.keys()]) {
      if (!paths.has(path)) this.pending.set(path, null);
    }
  }

  async drain() {
    do {
      if (this.needsScan) this.reconcile();
      const jobs = [...this.pending];
      this.pending.clear();
      let cursor = 0;
      const worker = async () => {
        while (cursor < jobs.length) {
          const [path, change] = jobs[cursor++];
          const kind = change && this.classify(path);
          if (!kind || change.file.path !== path) {
            this.rows.delete(path);
            this.errors.delete(path);
            continue;
          }
          const { file, data, metadata, stamp } = change;
          try {
            const row = await this.load(file, kind, data, metadata);
            if (!this.pending.has(path) && file.path === path) {
              this.rows.set(path, { ...row, file, kind, stamp });
              this.errors.delete(path);
            }
          } catch {
            if (!this.pending.has(path)) {
              this.rows.delete(path);
              this.errors.add(path);
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, worker));
    } while (this.needsScan || this.pending.size);

    const entries = [], weekEntries = [], periods = [];
    for (const row of this.rows.values()) {
      if (row.kind === 'daily') entries.push(row);
      else {
        if (row.kind === 'weekly') weekEntries.push(row);
        if (row.period) periods.push(row);
      }
    }
    entries.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.file.path.localeCompare(b.file.path));
    periods.sort((a, b) => a.period.start.localeCompare(b.period.start) || a.file.path.localeCompare(b.file.path));
    return { entries, weekEntries, periods, failed: this.errors.size };
  }
}

module.exports = { JournalIndex };
