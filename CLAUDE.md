# CLAUDE.md — ncc-prep

This file provides guidance to Claude Code when working in this directory.

## What This App Is

A standalone single-page web app for studying NCC (Italian professional driver licence) exam questions. Bilingual Italian/Bengali interface with spaced repetition, practice tests, bookmarks, a personal notebook, and translation via the MyMemory API.

## Running the App

No build step. Serve from this directory:

```bash
python3 -m http.server 8000
# visit http://localhost:8000/
```

Always serve via HTTP — do not open `index.html` directly as a `file://` URL (Web Speech API and fetch require HTTP).

## Regenerating Question Data

If the source PDF changes, regenerate `questions.js`:

```bash
pip install pdfplumber
python3 extract_questions.py /path/to/ncc.pdf
```

Outputs a new `questions.js` with the global `QUESTIONS` array (515 questions across 6 categories). Do not edit `questions.js` manually.

## File Overview

| File | Lines | Role |
|------|-------|------|
| `app.js` | ~1900 | All application logic |
| `index.html` | ~571 | HTML shell; all views pre-rendered |
| `style.css` | ~1785 | All styling and animations |
| `questions.js` | auto-gen | `QUESTIONS` array, do not edit |
| `extract_questions.py` | — | PDF → questions.js converter |

## app.js Module Map

| # | Section | Lines | Responsibility |
|---|---------|-------|---------------|
| 1 | Constants | 8–28 | Category list, localStorage keys |
| 2 | State | 30–42 | Single `state` object shared by all modules |
| 3 | Storage | 45–117 | Read/write progress, bookmarks, settings, notes, translation cache |
| 4 | Translation | 118–185 | Async Italian→Bengali via MyMemory API; localStorage cache |
| 5 | TTS | 186–268 | Web Speech API; auto-selects best Italian voice; configurable rate |
| 6 | Spaced Repetition | 269–309 | Queue builder: unseen → wrong → least-recently-seen |
| 7 | Study Mode Controller | 310–671 | Question display, answer tracking, session stats, result screen |
| 8 | Practice Test Controller | 672–1120 | Timed exam mode, back navigation, skipped-question modal, scoring |
| 9 | Celebration Helpers | 1121–1170 | `fireConfetti()`, `showTrophyPopup()`, `showBadges()` |
| 10 | Stats Module | 1171–1223 | Per-category accuracy, hardest questions, recent wrong |
| 11 | UI Module | 1224–1525 | View switching, modals, toasts, home/stats/bookmarks refresh |
| 12 | Event Wiring | 1526–1813 | All DOM event listeners registered here |
| 13 | App Init | 1814+ | DOMContentLoaded: TTS init, wireEvents, initial view |

## Key Features & Where They Live

### Study Mode (`studyCtrl`, lines 310–671)
- Spaced repetition or sequential queue, filterable by category
- Per-session stat tracking (`sessionStats.total/correct/wrong`)
- **Exit button** (`#btn-exit-study`): 0 answers → toast+home; answers present → confirm modal → `showResult()`
- `showResult()`: animated SVG ring, score counter, stat cards, wrong list, confetti/trophy/badge celebrations
- Queue exhaustion automatically calls `showResult()` (no more endless loop)

### Practice Test (`testCtrl`, lines 672–1120)
- Setup: category, question count (10/20/30/50/all), optional 60s/question timer
- **Back button** (`#btn-test-prev`): navigate to any previous question; answered questions restore their state (locked options + feedback shown)
- **Skipped-question modal** (`checkSkippedBeforeScore()`): fires at end of test if any answers are `null`; offers "← Rispondi" (jump to first skipped) or "Termina lo stesso" (show score)
- **Exit button** (`#btn-exit-test`): confirm modal → straight to score (bypasses skipped check)
- `showScore()`: animated percentage counter, pass/fail at 70%, wrong answer list

### Result Screen (study mode only, `#study-result`)
- Emoji: 🏆 ≥90%, 🌟 ≥70%, 💪 ≥50%, 📚 <50%
- SVG progress ring with colour-coded stroke (green/yellow/red)
- Ring center: HTML `<div class="ring-center-fill">` (not SVG fill — Safari compat)
- Animated stat cards: Viste / Corrette / Errate with icons
- Celebrations: confetti ≥60%, trophy popup ≥80%, badge toasts always

### Notebook (`#view-notebook`)
- Personal notes per question or free-form
- Draggable floating note button (`makeDraggableNoteBtn()`)
- Position persisted in `localStorage` key `noteBtn_pos`

## Key Design Patterns

- **No framework, no bundler** — pure ES5-compatible vanilla JS, `<script>` tags only.
- **Global state** — single `state` object; all modules read/write it.
- **Views** — pre-rendered `<section>` elements toggled by `ui.showView(name)`. Never destroyed/recreated.
- **localStorage only** — persistence keys defined as constants in `LS` object (lines 21–27).
- **Translation is lazy** — Italian shown immediately; Bengali fetched async and cached.
- **Cache-busting** — script tags use `?v=N` query strings (currently `?v=8`); increment when deploying breaking JS/HTML changes.

## Modal System

Single shared modal (`#modal-overlay`). Two entry points:
- `ui.confirm(msg, onConfirm)` — standard confirm/cancel with default labels
- `ui.confirmCustom(msg, confirmLabel, cancelLabel, onConfirm, onCancel)` — custom button text

## CSS Animations Available for Reuse

| Name | File location | Use |
|------|--------------|-----|
| `viewEnter` | style.css ~line 97 | Fade+slide up for new views/cards |
| `optionSlideIn` | style.css ~line 600 | Staggered option entrance |
| `correctBounce` | style.css ~line 666 | Correct answer feedback |
| `wrongShake` | style.css ~line 673 | Wrong answer feedback |
| `timerUrgent` | style.css ~line 840 | Pulsing timer at ≤10s |
| `emojiBounce` | style.css ~line 1583 | Result emoji entrance |
| `confettiFall` | style.css ~line 1727 | Confetti particles |
| `trophyBounce` | style.css ~line 1749 | Trophy popup |

## Git / Deployment

- Active dev branch: `dev`
- GitHub: `xerocool36/ncc-prep`
- GitHub Pages (main branch): `https://xerocool36.github.io/ncc-prep/`
- Pages is built from `main`; merge `dev → main` to deploy publicly
