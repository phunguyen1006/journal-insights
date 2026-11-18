# Journal Insights 0.8.0

A theme-aware, local dashboard for daily journals. The interface is in English and previews display the original journal writing.

## Installation

Requires Obsidian 1.8.7 or later.

1. Create a `journal-insights` folder inside your vault's `.obsidian/plugins/` folder.
2. Copy `main.js`, `manifest.json`, and `styles.css` from this repository into that folder.
3. In Obsidian, open **Settings → Community plugins**, reload the plugin list if necessary, and enable **Journal Insights**.
4. Open Journal Insights and set your daily notes folder under **Settings → Folders**. The default is `01 Daily`.

This repository contains the source and tests as well as the built plugin. Personal journal notes, image attachments, and the plugin's local `data.json` settings are not included.

## Privacy

The dashboard reads notes from the configured daily folder on your device. It does not upload journal content to a service. Local images stay in the vault; loading an external image from the photo viewer contacts that image's host. Your Obsidian configuration and other plugins may have different network behavior.

## Home

- On This Day and Recent Entries come first, followed by Writing Activity and At a Glance.
- Open **Settings → Home** to show/hide sections and use the up/down buttons to reorder them. Settings persist across restarts.
- **Today** opens today's note directly when there is a single match. When no note exists, Journals handles creation using its configured Daily template. If several Daily files share the date, choose the one to open.
- **Quick Rating** saves a 1–10 score to the chosen note's **dayRating** property. When there are multiple files, select the target first.
- **Compact Home** shows Today, at most one memory and up to two recent entries. It is automatic on mobile and can be set to **Always** or **Never** in Home settings.

## Entries

- Search by title, date or journal text. Vietnamese searches work with or without accents. Results highlight the matched text in an excerpt.
- **Filters** supports a date range, photos and rating. Filters and scroll position stay in place when leaving and returning to the dashboard during a session.
- **Photo Timeline** groups pictures by month. Select a photo to open its source entry.
- Select **Periods** on a Daily card, or use **Journal periods** from a journal note's context menu. Daily notes link to existing Week, Month, Quarter and Year notes. A period note opens its range in Entries.

## On This Day

- Choose a reference date to revisit the same month/day in earlier years, grouped by year.
- Cards show a text excerpt, word count, and a compact gallery of linked images when present.
- **Read Entry** opens the original note. **Random Memory** selects an earlier nonempty note from daily notes.
- Select **Save** on a memory or entry to keep it in **On This Day → Saved**. Saved entries follow note moves in Obsidian.
- Under **Settings → Memories**, find an entry by name or date and select **Hide**. Restore individual entries or all hidden entries there. This does not modify the notes or their statistics.
- Frontmatter `private: true` or `journal-insights-hide: true` also excludes a note from Memories. These properties are not encryption and do not hide notes from Entries, search, analytics, or Obsidian itself.

## Calendar and heatmap

- Select a year and **Words**, **Writing Days**, or **Entries**.
- Words uses fixed bins: 0, 1-99, 100-299, 300-699, 700+. This makes colors comparable across years.
- Writing Days is binary: no recorded writing / some recorded writing.
- Entries counts nonempty source files (including Daily conflict versions): 0, 1, 2, 3, 4+.
- Future dates use dashed outlines and cannot be selected. Today and the selected date have distinct outlines.
- A photo-only day has an accent outline even in the Words view; hover or focus a day for its word and linked-image counts.
- Hover or focus a day for exact counts; click it to show original notes. Filters and the selected year persist.

## Pictures

- Home, Entries, Calendar results and On This Day show up to three thumbnails per note. The **+N** badge opens the remaining images; select a thumbnail to view that image, and use Previous / Next or the arrow keys to move through the full set.
- In Daily notes, image-only lines under a `Pictures` heading are arranged as a compact gallery in Reading view and Live Preview. A caption or other content ends the current group, so it stays in its original position. In Live Preview, **Edit images** returns control to Obsidian's normal editor.
- Supports Obsidian image embeds and inline Markdown images. Local files resolve using Obsidian's own link resolution. Missing local files and unresolved Day One media are shown as unavailable; their links are preserved. Day One references cannot be recovered without their original media.
- The dashboard gallery does not automatically fetch external images: select the placeholder, review the host, and choose **Load image**. Obsidian and other plugins may still load image URLs when rendering the original note.
- **Settings → Pictures** independently controls dashboard previews and note galleries. Reopen a note in Reading view after changing its setting. Picture-only entries can appear in Recent Entries and Memories; writing statistics still require text.
- The gallery is display-only: it does not move, rename, rewrite, or delete notes, image files, or links. Thumbnail crops are for display only; the viewer fits the original image.

## Insights

Switch to **Review** for a selected week or month. It shows writing days, words, the rating average with its rated-day count, the largest Wheel of Life changes against the preceding period, and entries to revisit. Each section links to its source notes where available.

Periods: last 30 days, last 90 days, selected year, all time, or custom dates. Future dates are excluded; custom end dates after today are capped at today.

**Daily ratings** summarizes valid `dayRating` values on a 1–10 scale, with monthly means, score distribution, rated-day coverage, and source-entry links. Missing and invalid values are omitted. Conflicting scores on the same date are excluded and can be inspected. A stored score of 1 is included: the plugin cannot know whether it was intentionally selected or saved as a template default.

**Wheel of Life** reads `wheelOfLife` category values from weekly notes in the configured Weekly folder. It shows a radar chart, per-category averages and a trend grouped by week, month, quarter or year. Missing category values are excluded, not interpreted as zero. Duplicate weekly notes with conflicting category values are omitted for that category. A week is assigned to the month, quarter and year containing its Thursday; the current unfinished week can appear in a range ending today. Monthly, quarterly and yearly Time Garden charts are derived from weekly data, so they are not counted a second time.

Ten metrics: estimated words, writing days, consistency, mean words per writing day, median words per active day, mean words per calendar day, longest streak within the period, longest day, nonempty files, and current streak across all time.

Eight visualizations:

1. Weekly writing rhythm (monthly for ranges exceeding 110 weeks).
2. Words by month.
3. Monthly consistency on a fixed 0-100% scale.
4. Weekday writing rates, adjusted for how many times each weekday occurs.
5. Distribution of active-day word counts.
6. Cumulative writing during the period.
7. Five most-written days.
8. Words by year, explicitly labeled as all-time context for daily notes.

Bar charts open source entries on click. Every chart has **View data**, including an explanation and keyboard-accessible Explore buttons. Line charts resize with the pane to keep labels readable. Charts use the current Obsidian accent; no external scripts, fonts, or chart services are loaded.

## Counting rules

- Word counts are estimates from journal text after removing frontmatter and common template/UI markup.
- Conflicting Daily files are counted once per date using the longest version; their text is never merged.
- A writing day has at least one estimated word. Images alone do not count as writing. Journal streaks count a day with text or at least one linked image; empty templates do not count. The current streak includes today or, when today has no entry, yesterday.
- Consistency = active dates / calendar dates in the selected range. Selected-year ranges begin January 1, even if the first note is later. All time starts at the earliest recognized nonfuture note date.
- Weekday rate = active dates on a weekday / occurrences of that weekday in the selected range.
- The previous-period comparison uses the immediately preceding equal number of calendar days. Missing dates mean no recorded writing; zero previous words displays no percentage baseline.
- Undated and future-dated notes are excluded from analytics. Current journal streak includes today, or yesterday if today has no text or linked images. The period's writing streak counts text days within the selected period.
- No mood, wellbeing, or writing duration is inferred.

## Startup and settings

**Settings** contains Home layout, hidden Memories, the startup toggle, journal folder paths, and maintenance. The hide controls and note properties also apply to Saved, Photo Timeline and Review highlights. Open at startup remains enabled by default. Folder changes require existing folders. Dashboard preferences and saved paths are stored in the plugin's own data file.

**Journal Check** lists dates with multiple Daily files, dates with conflicting ratings and notes with unresolved local or Day One images. Each issue links to the relevant note.

The in-memory index loads journal files at startup and updates affected notes on edits, renames, deletions and sync events. **Refresh** rebuilds it on demand.

## Maintenance

`core.js` handles plugin lifecycle, vault access and banner repair. `journal-index.js` manages incremental updates. `experience.js` renders the dashboard and analytics. `entry-search.js`, `journal-tools.js` and `journal-review.js` implement entry filters, journal actions, reviews and checks. Run `node build.cjs` to create the self-contained `main.js`. Run `node test.cjs`, `node analytics-test.cjs`, `node settings-test.cjs`, `node photos-test.cjs`, `node metrics-test.cjs`, `node cleanup-test.cjs`, `node integration-test.cjs` and `node journal-features-test.cjs` for regression checks. The integration test deliberately simulates a failed backup and logs that expected error before PASS.

The dashboard upgrade does not edit journal text or banner properties. The separate repair command writes a verified backup and checks for concurrent changes before modifying any note.

The optional **Clean empty Daily sections** command removes empty Quick Notes and Q&A headings from Daily notes and the standard Time Garden Daily template when present. It preserves filled sections and the hidden quick-note insertion marker. Before modifying anything, it writes and verifies a backup in `.archive`; notes changed concurrently are skipped.
