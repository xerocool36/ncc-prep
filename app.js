/* ═══════════════════════════════════════
   NCC Exam Prep — app.js
   ═══════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────
// 1. Constants
// ─────────────────────────────────────────
const TOTAL = (typeof QUESTIONS !== 'undefined') ? QUESTIONS.length : 0;

const CATEGORIES = [
  { slug: 'mechanics',        label: 'Meccanica',        bn: 'মেকানিক্স' },
  { slug: 'road_safety',      label: 'Sicurezza',        bn: 'রাস্তার নিরাপত্তা' },
  { slug: 'insurance',        label: 'Assicurazione',    bn: 'বীমা' },
  { slug: 'ncc_regs',         label: 'Normativa NCC',    bn: 'এনসিসি বিধিমালা' },
  { slug: 'navigation',       label: 'Navigazione',      bn: 'নেভিগেশন' },
  { slug: 'advanced_systems', label: 'Sistemi Avanzati', bn: 'উন্নত সিস্টেম' },
];

const LS = {
  PROGRESS:    'ncc_progress',
  BOOKMARKS:   'ncc_bookmarks',
  CACHE:       'ncc_trans_cache',
  SETTINGS:    'ncc_settings',
  NOTES:       'ncc_notes',
  CHAPTER_SEL: 'ncc_chapter_selection',
};

// ─────────────────────────────────────────
// 2. State
// ─────────────────────────────────────────
const state = {
  currentView: 'home',
  studyQueue: [],
  studyIndex: 0,
  activeCategory: 'all',
  spacedRepEnabled: false,
  answered: false,      // has the current study question been answered?
  testConfig: { category: 'all', count: 20, timer: false },
  testSession: null,    // { questions[], answers[], timerInterval, startTime }
  pendingTranslations: new Set(),
  chaptersSelectMode: false,
  chapterSelection: { categories: [], count: 20 },
};

// ─────────────────────────────────────────
// 3. Storage module
// ─────────────────────────────────────────
const storage = {
  getProgress() {
    return JSON.parse(localStorage.getItem(LS.PROGRESS) || '{}');
  },
  saveProgress(p) {
    localStorage.setItem(LS.PROGRESS, JSON.stringify(p));
  },
  recordAnswer(id, correct) {
    const p = this.getProgress();
    if (!p[id]) p[id] = { seen: 0, correct: 0, wrong: 0, lastSeen: 0 };
    p[id].seen++;
    if (correct) p[id].correct++; else p[id].wrong++;
    p[id].lastSeen = Date.now();
    this.saveProgress(p);
  },
  getBookmarks() {
    return JSON.parse(localStorage.getItem(LS.BOOKMARKS) || '[]');
  },
  toggleBookmark(id) {
    let bm = this.getBookmarks();
    if (bm.includes(id)) {
      bm = bm.filter(x => x !== id);
    } else {
      bm.push(id);
    }
    localStorage.setItem(LS.BOOKMARKS, JSON.stringify(bm));
    return bm.includes(id);
  },
  isBookmarked(id) {
    return this.getBookmarks().includes(id);
  },
  getSettings() {
    return Object.assign({ ttsRate: 0.85, ttsVoice: '', defaultCategory: 'all' },
      JSON.parse(localStorage.getItem(LS.SETTINGS) || '{}'));
  },
  saveSettings(s) {
    localStorage.setItem(LS.SETTINGS, JSON.stringify(s));
  },
  getCache() {
    return JSON.parse(localStorage.getItem(LS.CACHE) || '{}');
  },
  saveCache(c) {
    localStorage.setItem(LS.CACHE, JSON.stringify(c));
  },
  clearCache() {
    localStorage.removeItem(LS.CACHE);
    translationModule.memCache = {};
  },
  resetProgress() {
    localStorage.removeItem(LS.PROGRESS);
    localStorage.removeItem(LS.BOOKMARKS);
  },
  clearWrong(id) {
    const p = this.getProgress();
    if (p[id]) { p[id].wrong = 0; this.saveProgress(p); }
  },
  getNotes() {
    return JSON.parse(localStorage.getItem(LS.NOTES) || '[]');
  },
  saveNote(note) {
    const notes = this.getNotes();
    notes.unshift(note);
    localStorage.setItem(LS.NOTES, JSON.stringify(notes));
  },
  deleteNote(id) {
    const notes = this.getNotes().filter(n => n.id !== id);
    localStorage.setItem(LS.NOTES, JSON.stringify(notes));
  },
  getChapterSelection() {
    const raw = JSON.parse(localStorage.getItem(LS.CHAPTER_SEL) || 'null');
    if (!raw) return { categories: [], count: 20 };
    return {
      categories: Array.isArray(raw.categories) ? raw.categories : [],
      count: raw.count === 'all' ? 'all' : (parseInt(raw.count) || 20),
    };
  },
  saveChapterSelection(sel) {
    localStorage.setItem(LS.CHAPTER_SEL, JSON.stringify(sel));
  },
};

// ─────────────────────────────────────────
// 4. Translation module
// ─────────────────────────────────────────
const translationModule = {
  memCache: {},

  _key(id, field) {
    return `q_${id}_${field}`;
  },

  getCached(id) {
    const diskCache = storage.getCache();
    const fields = ['question', 'opt_0', 'opt_1', 'opt_2'];
    const result = {};
    for (const f of fields) {
      const k = this._key(id, f);
      result[f] = this.memCache[k] || diskCache[k] || null;
    }
    return result.question ? result : null;
  },

  async fetchTranslation(question) {
    if (state.pendingTranslations.has(question.id)) return null;
    state.pendingTranslations.add(question.id);

    const { id, it } = question;
    const parts = [it.question, ...it.options];
    const fieldNames = ['question', 'opt_0', 'opt_1', 'opt_2'];

    try {
      // Translate each part separately — joining with a separator is unreliable
      // because MyMemory often strips or translates the separator itself
      const translations = await Promise.all(parts.map(async (part) => {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(part)}&langpair=it|bn`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (data.responseData?.translatedText || '').trim();
      }));

      const diskCache = storage.getCache();
      translations.forEach((val, i) => {
        const k = this._key(id, fieldNames[i]);
        this.memCache[k] = val;
        diskCache[k] = val;
      });
      storage.saveCache(diskCache);

      return this.getCached(id);
    } catch (err) {
      console.warn('Translation failed:', err);
      return null;
    } finally {
      state.pendingTranslations.delete(question.id);
    }
  },

  async translate(question) {
    const cached = this.getCached(question.id);
    if (cached) return cached;
    return this.fetchTranslation(question);
  },

  getCacheSize() {
    return Object.keys(storage.getCache()).length;
  },
};

// ─────────────────────────────────────────
// 5. TTS module
// ─────────────────────────────────────────
const ttsModule = {
  voices: [],
  itVoice: null,
  bnVoice: null,
  initialized: false,

  init() {
    if (typeof speechSynthesis === 'undefined') return;
    const load = () => {
      this.voices = speechSynthesis.getVoices();
      // Prefer high-quality Italian voices: online/cloud first, then known macOS premium voices
      const itVoices = this.voices.filter(v => v.lang.startsWith('it'));
      const voiceScore = v => {
        if (!v.localService) return 3;                                       // online = best
        const n = v.name.toLowerCase();
        if (n.includes('enhanced') || n.includes('premium')) return 2;
        if (['alice', 'federica', 'luca'].some(k => n.includes(k))) return 1; // macOS quality voices
        return 0;
      };
      itVoices.sort((a, b) => voiceScore(b) - voiceScore(a));
      this.itVoice = itVoices[0] || null;
      this.bnVoice = this.voices.find(v => v.lang.startsWith('bn')) || null;
      this.initialized = true;
      this._populateVoiceSelect();
    };
    if (speechSynthesis.getVoices().length) load();
    else speechSynthesis.onvoiceschanged = load;
  },

  _populateVoiceSelect() {
    const sel = document.getElementById('tts-voice-select');
    if (!sel) return;
    const itVoices = this.voices.filter(v => v.lang.startsWith('it'));
    itVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.name;
      opt.textContent = v.name;
      sel.appendChild(opt);
    });
    const settings = storage.getSettings();
    if (settings.ttsVoice) sel.value = settings.ttsVoice;
  },

  speak(text, lang) {
    if (typeof speechSynthesis === 'undefined') { ui.toast('TTS non disponibile nel browser', 'error'); return; }
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    const settings = storage.getSettings();
    utt.rate = settings.ttsRate;
    utt.lang = lang;

    if (lang.startsWith('it')) {
      const sel = document.getElementById('tts-voice-select');
      const chosenName = sel?.value || settings.ttsVoice;
      const voice = chosenName ? this.voices.find(v => v.name === chosenName) : this.itVoice;
      if (voice) utt.voice = voice;
    } else if (lang.startsWith('bn')) {
      if (this.bnVoice) utt.voice = this.bnVoice;
    }

    speechSynthesis.speak(utt);
  },

  speakItalian(text) {
    this.speak(text, 'it-IT');
  },

  speakBengali(text) {
    if (!this.bnVoice) {
      ui.toast('Voce bengalese non disponibile su questo dispositivo', 'error');
      return;
    }
    this.speak(text, 'bn-BD');
  },

  hasBengali() {
    return !!this.bnVoice;
  },
};

// ─────────────────────────────────────────
// 6. Spaced Repetition module
// ─────────────────────────────────────────
const spacedRep = {
  buildQueue(categoryFilter) {
    const progress = storage.getProgress();
    const bookmarks = storage.getBookmarks();

    let pool = QUESTIONS;
    if (categoryFilter === 'bookmarks') {
      pool = QUESTIONS.filter(q => bookmarks.includes(q.id));
    } else if (categoryFilter !== 'all') {
      pool = QUESTIONS.filter(q => q.category === categoryFilter);
    }

    return pool
      .map(q => {
        const p = progress[q.id] || { seen: 0, correct: 0, wrong: 0, lastSeen: 0 };
        const daysSince = (Date.now() - p.lastSeen) / 86400000;
        const accuracy = p.seen === 0 ? 0 : p.correct / p.seen;
        const priority = p.seen === 0
          ? 999 + Math.random()  // unseen first, shuffled among themselves
          : (1 - accuracy) * 10 + Math.min(daysSince, 7);
        return { id: q.id, priority };
      })
      .sort((a, b) => b.priority - a.priority)
      .map(x => x.id);
  },

  buildSequential(categoryFilter) {
    const bookmarks = storage.getBookmarks();
    let pool = QUESTIONS;
    if (categoryFilter === 'bookmarks') {
      pool = QUESTIONS.filter(q => bookmarks.includes(q.id));
    } else if (categoryFilter !== 'all') {
      pool = QUESTIONS.filter(q => q.category === categoryFilter);
    }
    return pool.map(q => q.id);
  },
};

// ─────────────────────────────────────────
// 7. Study Mode controller
// ─────────────────────────────────────────
const studyCtrl = {
  currentTranslation: null,
  translationVisible: false,
  sessionStats: { total: 0, correct: 0, wrong: [] },

  init() {
    this.sessionStats = { total: 0, correct: 0, wrong: [] };
    this.rebuildQueue();
    this.renderQuestion();
  },

  rebuildQueue() {
    const cat = state.activeCategory;
    state.studyQueue = state.spacedRepEnabled
      ? spacedRep.buildQueue(cat)
      : spacedRep.buildSequential(cat);
    state.studyIndex = 0;
  },

  currentQuestion() {
    const id = state.studyQueue[state.studyIndex];
    return QUESTIONS.find(q => q.id === id) || null;
  },

  renderQuestion() {
    const q = this.currentQuestion();
    if (!q) {
      document.getElementById('q-text-it').textContent = 'Nessuna domanda in questa categoria.';
      return;
    }

    this.currentTranslation = null;
    this.translationVisible = false;
    state.answered = false;

    // Reset translate button
    document.getElementById('btn-translate').innerHTML =
      `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> অনুবাদ`;

    // Meta
    document.getElementById('q-number').textContent = `Q${q.id}`;
    document.getElementById('q-category-badge').textContent = q.categoryLabel;

    // Question text
    document.getElementById('q-text-it').textContent = q.it.question;

    // Hide question translation
    document.getElementById('q-text-bn').classList.add('hidden');
    document.getElementById('bn-question').textContent = '';

    // Bengali TTS hidden until translation loaded
    document.getElementById('btn-tts-bn').classList.add('hidden');

    // Bookmark state
    const bmBtn = document.getElementById('bookmark-btn');
    bmBtn.classList.toggle('active', storage.isBookmarked(q.id));

    // Feedback hidden
    const fb = document.getElementById('q-feedback');
    fb.classList.add('hidden');
    fb.classList.remove('correct-fb', 'wrong-fb');

    // Render options
    const container = document.getElementById('q-options');
    container.innerHTML = '';
    const letters = ['A', 'B', 'C'];
    q.it.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.index = i;
      btn.innerHTML = `
        <span class="option-letter">${letters[i]}</span>
        <div class="option-content">
          <div class="option-it">${opt}</div>
          <div class="option-bn hidden"></div>
        </div>`;
      btn.addEventListener('click', () => this.handleAnswer(i));
      container.appendChild(btn);
    });

    // Nav buttons
    document.getElementById('btn-next').classList.add('hidden');
    document.getElementById('btn-skip').classList.remove('hidden');
    document.getElementById('btn-prev').disabled = (state.studyIndex === 0);

    // Position label
    document.getElementById('study-pos').textContent =
      `${state.studyIndex + 1} / ${state.studyQueue.length}`;

    // Pre-populate translation DOM if cached, but keep it hidden until user clicks
    const cached = translationModule.getCached(q.id);
    if (cached) {
      this._applyTranslation(cached, q);
      // Immediately hide it — user still has to click the button to reveal
      document.getElementById('q-text-bn').classList.add('hidden');
      document.querySelectorAll('#q-options .option-btn .option-bn').forEach(el => el.classList.add('hidden'));
      document.getElementById('btn-tts-bn').classList.add('hidden');
      document.getElementById('btn-translate').innerHTML =
        `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> অনুবাদ`;
      this.translationVisible = false;
    }
  },

  handleAnswer(selectedIndex) {
    if (state.answered) return;
    state.answered = true;

    const q = this.currentQuestion();
    const correct = selectedIndex === q.correctIndex;

    storage.recordAnswer(q.id, correct);

    // Track session stats
    this.sessionStats.total++;
    if (correct) {
      this.sessionStats.correct++;
    } else {
      this.sessionStats.wrong.push({ q, ans: selectedIndex });
    }

    // Style buttons
    const btns = document.querySelectorAll('#q-options .option-btn');
    btns.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correctIndex) btn.classList.add('correct');
      else if (i === selectedIndex && !correct) btn.classList.add('wrong');
    });

    // Show feedback
    const fb = document.getElementById('q-feedback');
    fb.classList.remove('hidden', 'correct-fb', 'wrong-fb');
    if (correct) {
      fb.classList.add('correct-fb');
      document.getElementById('q-feedback-icon').textContent = '✓';
      document.getElementById('q-feedback-text').textContent = 'Corretto! সঠিক!';
    } else {
      fb.classList.add('wrong-fb');
      document.getElementById('q-feedback-icon').textContent = '✗';
      const letters = ['A', 'B', 'C'];
      document.getElementById('q-feedback-text').textContent =
        `Sbagliato. Risposta corretta: ${letters[q.correctIndex]}`;
    }

    // Show next button
    document.getElementById('btn-next').classList.remove('hidden');
    document.getElementById('btn-skip').classList.add('hidden');
  },

  async handleTranslate() {
    const q = this.currentQuestion();
    if (!q) return;

    // If already fetched, just toggle visibility
    if (this.currentTranslation) {
      this._toggleTranslation();
      return;
    }

    const btn = document.getElementById('btn-translate');
    btn.classList.add('loading');
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> অনুবাদ হচ্ছে...`;

    const result = await translationModule.translate(q);

    btn.classList.remove('loading');

    // Guard: user may have navigated to a different question while fetch was in-flight
    if (this.currentQuestion()?.id !== q.id) return;

    if (!result) {
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> অনুবাদ`;
      ui.toast('Traduzione non disponibile. Controlla la connessione.', 'error');
      return;
    }

    this._applyTranslation(result, q);
  },

  _applyTranslation(result, q) {
    this.currentTranslation = result;
    this.translationVisible = true;

    // Update button to "hide translation"
    document.getElementById('btn-translate').innerHTML =
      `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> অনুবাদ লুকান`;

    // Show question translation
    document.getElementById('bn-question').textContent = result.question || '';
    document.getElementById('q-text-bn').classList.remove('hidden');

    // Fill Bengali translation inline inside each option button
    const optBtns = document.querySelectorAll('#q-options .option-btn');
    ['opt_0', 'opt_1', 'opt_2'].forEach((key, i) => {
      const bnDiv = optBtns[i]?.querySelector('.option-bn');
      if (bnDiv && result[key]) {
        bnDiv.textContent = result[key];
        bnDiv.classList.remove('hidden');
      }
    });

    // Show Bengali TTS if available
    if (ttsModule.hasBengali()) {
      document.getElementById('btn-tts-bn').classList.remove('hidden');
    }
  },

  _toggleTranslation() {
    const btn = document.getElementById('btn-translate');
    const svgIcon = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;

    if (this.translationVisible) {
      // Hide translation
      document.getElementById('q-text-bn').classList.add('hidden');
      document.querySelectorAll('#q-options .option-btn .option-bn').forEach(el => el.classList.add('hidden'));
      document.getElementById('btn-tts-bn').classList.add('hidden');
      this.translationVisible = false;
      btn.innerHTML = `${svgIcon} অনুবাদ`;
    } else {
      // Show translation
      document.getElementById('q-text-bn').classList.remove('hidden');
      document.querySelectorAll('#q-options .option-btn .option-bn').forEach(el => {
        if (el.textContent) el.classList.remove('hidden');
      });
      if (ttsModule.hasBengali()) document.getElementById('btn-tts-bn').classList.remove('hidden');
      this.translationVisible = true;
      btn.innerHTML = `${svgIcon} অনুবাদ লুকান`;
    }
  },

  next() {
    if (state.studyIndex < state.studyQueue.length - 1) {
      state.studyIndex++;
      this.renderQuestion();
    } else {
      this.showResult();
    }
  },

  prev() {
    if (state.studyIndex > 0) {
      state.studyIndex--;
      this.renderQuestion();
    }
  },

  skip() {
    this.next();
  },

  showResult() {
    const stats = this.sessionStats;
    const total   = stats.total;
    const correct = stats.correct;
    const pct     = total > 0 ? Math.round(correct / total * 100) : 0;

    // Hide study UI
    document.getElementById('category-filter').classList.add('hidden');
    document.getElementById('study-controls-bar').classList.add('hidden');
    document.getElementById('question-card').classList.add('hidden');
    document.querySelector('#view-study .q-nav').classList.add('hidden');

    // Show result panel
    document.getElementById('study-result').classList.remove('hidden');

    // Title, subtitle, emoji, motivational
    let title, subtitle, emoji, motivational;
    if (total === 0) {
      emoji        = '📖';
      title        = 'Nessuna risposta';
      subtitle     = 'কোনো প্রশ্নের উত্তর দেওয়া হয়নি।';
      motivational = 'Inizia a rispondere per vedere i tuoi progressi!';
    } else if (pct >= 90) {
      emoji        = '🏆';
      title        = 'Eccellente!';
      subtitle     = 'অসাধারণ! তুমি প্রায় নিখুঁত!';
      motivational = 'Risultato straordinario — sei pronto per l\'esame!';
    } else if (pct >= 70) {
      emoji        = '🌟';
      title        = 'Ottimo lavoro!';
      subtitle     = 'দারুণ কাজ! তুমি ভালো করেছ!';
      motivational = 'Stai andando alla grande. Continua così!';
    } else if (pct >= 50) {
      emoji        = '💪';
      title        = 'Buon inizio!';
      subtitle     = 'ভালো শুরু! আরও অনুশীলন করো।';
      motivational = 'Sei sulla strada giusta. Ripassa le risposte errate!';
    } else {
      emoji        = '📚';
      title        = 'Continua a studiare';
      subtitle     = 'চালিয়ে যাও! অনুশীলনই সাফল্যের চাবিকাঠি।';
      motivational = 'Non arrenderti — ogni risposta sbagliata è una lezione!';
    }
    document.getElementById('result-emoji').textContent         = emoji;
    document.getElementById('study-result-title').textContent   = title;
    document.getElementById('study-result-subtitle').textContent = subtitle;
    document.getElementById('result-motivational').textContent  = motivational;

    // Stats row
    document.getElementById('rs-total').textContent   = total;
    document.getElementById('rs-correct').textContent = correct;
    document.getElementById('rs-wrong').textContent   = stats.wrong.length;

    // Animated score counter
    const scoreEl = document.getElementById('study-result-score');
    animateScoreCount(scoreEl, pct, '%');

    // SVG ring animation
    const ringCircle = document.getElementById('study-ring-circle');
    if (ringCircle) {
      const circumference = 2 * Math.PI * 45;
      const targetOffset  = circumference * (1 - pct / 100);
      const ringColor     = pct >= 70 ? 'var(--correct)' : pct >= 50 ? '#f4c430' : 'var(--wrong)';
      ringCircle.style.stroke          = ringColor;
      scoreEl.style.color              = ringColor;
      ringCircle.style.strokeDasharray  = circumference;
      ringCircle.style.strokeDashoffset = circumference;
      requestAnimationFrame(function() {
        ringCircle.style.transition      = 'stroke-dashoffset 1s ease';
        ringCircle.style.strokeDashoffset = targetOffset;
      });
    }

    // Wrong questions list
    const wrongSection = document.getElementById('study-result-wrong-section');
    const wrongList    = document.getElementById('study-result-wrong-list');
    wrongList.innerHTML = '';
    if (stats.wrong.length) {
      wrongSection.classList.remove('hidden');
      const letters = ['A', 'B', 'C'];
      stats.wrong.slice(0, 20).forEach(function(entry) {
        const q = entry.q;
        const ans = entry.ans;
        const userLine = (ans === null || ans === undefined)
          ? '<div class="score-wrong-user score-wrong-skipped">⊘ Saltata / এড়িয়ে যাওয়া</div>'
          : '<div class="score-wrong-user">✗ La tua risposta: ' + letters[ans] + '. ' + q.it.options[ans] + '</div>';
        const div = document.createElement('div');
        div.className = 'score-wrong-item';
        div.innerHTML =
          '<div class="score-wrong-q">Q' + q.id + ': ' + q.it.question + '</div>' +
          userLine +
          '<div class="score-wrong-correct">✓ Risposta corretta: ' + letters[q.correctIndex] + '. ' + q.it.options[q.correctIndex] + '</div>';
        wrongList.appendChild(div);
      });
    } else {
      wrongSection.classList.add('hidden');
    }

    // Celebrations
    if (total > 0) {
      if (pct >= 80) showTrophyPopup();
      if (pct >= 60) fireConfetti();
      showBadges(total, pct);
    }
  },

  jumpTo(questionId) {
    const idx = state.studyQueue.indexOf(questionId);
    if (idx >= 0) {
      state.studyIndex = idx;
      this.renderQuestion();
      ui.showView('study');
    }
  },
};

// ─────────────────────────────────────────
// 8. Practice Test controller
// ─────────────────────────────────────────

function animateScoreCount(el, target, suffix) {
  el.textContent = '0' + suffix;
  const duration = 800;
  const start = performance.now();
  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(eased * target) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const testCtrl = {
  session: null,

  start() {
    const { category, categories, count, timer, source } = state.testConfig;
    const bookmarks = storage.getBookmarks();

    let pool;
    if (Array.isArray(categories) && categories.length > 0) {
      pool = QUESTIONS.filter(q => categories.includes(q.category));
    } else if (category === 'errors') {
      const wrongIds = Object.entries(storage.getProgress())
        .filter(([, v]) => v.wrong > 0)
        .map(([id]) => parseInt(id));
      pool = QUESTIONS.filter(q => wrongIds.includes(q.id));
      if (!pool.length) {
        ui.toast('Nessun errore da ripassare! কোনো ভুল নেই! 🎉', 'success');
        // Hide score screen if visible, return to home
        ui.hideElement('test-score');
        ui.showView('home');
        return;
      }
    } else if (category === 'bookmarks') {
      pool = QUESTIONS.filter(q => bookmarks.includes(q.id));
    } else if (category === 'all') {
      pool = [...QUESTIONS];
    } else {
      pool = QUESTIONS.filter(q => q.category === category);
    }

    // Shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    const n = count === 'all' ? pool.length : Math.min(count, pool.length);
    const questions = pool.slice(0, n);

    this.session = {
      questions,
      answers: new Array(n).fill(null),
      currentIndex: 0,
      timerInterval: null,
      timeLeft: 60,
      useTimer: timer,
      source: source || 'test',
      isErrorMode: category === 'errors',
    };

    ui.showElement('test-active');
    ui.hideElement('test-setup');
    ui.hideElement('test-score');
    ui.updateQuickNoteBtn();

    this.renderTestQuestion();
  },

  renderTestQuestion() {
    const s = this.session;
    const q = s.questions[s.currentIndex];
    const n = s.questions.length;

    document.getElementById('test-pos').textContent = `${s.currentIndex + 1} / ${n}`;
    document.getElementById('test-q-number').textContent = `Q${q.id}`;
    document.getElementById('test-q-badge').textContent = q.categoryLabel;
    document.getElementById('test-q-text').textContent = q.it.question;

    const fb = document.getElementById('test-q-feedback');
    fb.classList.add('hidden');
    fb.classList.remove('correct-fb', 'wrong-fb');

    document.getElementById('btn-test-next').classList.add('hidden');
    document.getElementById('btn-test-skip').classList.remove('hidden');
    document.getElementById('btn-test-prev').classList.toggle('hidden', s.currentIndex === 0);

    // Translation state reset
    s.currentTranslation = null;
    s.translationVisible = false;

    const hasTranslation = s.source === 'chapters' || s.source === 'errors';
    const actionsEl = document.getElementById('test-q-actions');
    const transSvg = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;

    if (hasTranslation) {
      actionsEl.classList.remove('hidden');
      document.getElementById('test-q-text-bn').classList.add('hidden');
      document.getElementById('test-bn-question').textContent = '';
      document.getElementById('btn-test-tts-bn').classList.add('hidden');
      document.getElementById('btn-test-translate').innerHTML = `${transSvg} অনুবাদ`;
    } else {
      actionsEl.classList.add('hidden');
      document.getElementById('test-q-text-bn').classList.add('hidden');
    }

    const container = document.getElementById('test-q-options');
    container.innerHTML = '';
    const letters = ['A', 'B', 'C'];
    q.it.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.index = i;
      btn.innerHTML = `
        <span class="option-letter">${letters[i]}</span>
        <div class="option-content">
          <div class="option-it">${opt}</div>
          <div class="option-bn hidden"></div>
        </div>`;
      btn.addEventListener('click', () => this.handleTestAnswer(i));
      container.appendChild(btn);
    });

    // Restore previously answered state (when navigating back)
    const prevAnswer = s.answers[s.currentIndex];
    if (prevAnswer !== null) {
      const letters = ['A', 'B', 'C'];
      const optBtns = document.querySelectorAll('#test-q-options .option-btn');
      optBtns.forEach((btn, i) => {
        btn.disabled = true;
        if (i === q.correctIndex) btn.classList.add('correct');
        else if (i === prevAnswer && prevAnswer !== q.correctIndex) btn.classList.add('wrong');
      });
      const correct = prevAnswer === q.correctIndex;
      const fb = document.getElementById('test-q-feedback');
      fb.classList.remove('hidden', 'correct-fb', 'wrong-fb');
      if (correct) {
        fb.classList.add('correct-fb');
        document.getElementById('test-feedback-icon').textContent = '✓';
        document.getElementById('test-feedback-text').textContent = 'Corretto! সঠিক!';
      } else if (prevAnswer === null) {
        fb.classList.add('wrong-fb');
        document.getElementById('test-feedback-icon').textContent = '⏭';
        document.getElementById('test-feedback-text').textContent = `Saltato. Risposta: ${letters[q.correctIndex]}`;
      } else {
        fb.classList.add('wrong-fb');
        document.getElementById('test-feedback-icon').textContent = '✗';
        document.getElementById('test-feedback-text').textContent =
          `Sbagliato. Risposta corretta: ${letters[q.correctIndex]}`;
      }
      document.getElementById('btn-test-next').classList.remove('hidden');
      document.getElementById('btn-test-skip').classList.add('hidden');
      clearInterval(s.timerInterval);
      if (s.useTimer) document.getElementById('test-timer').classList.add('hidden');
    }

    // Pre-populate from cache if available, keep hidden
    if (hasTranslation) {
      const cached = translationModule.getCached(q.id);
      if (cached) {
        this._applyTestTranslation(cached, q);
        document.getElementById('test-q-text-bn').classList.add('hidden');
        document.querySelectorAll('#test-q-options .option-btn .option-bn').forEach(el => el.classList.add('hidden'));
        document.getElementById('btn-test-tts-bn').classList.add('hidden');
        document.getElementById('btn-test-translate').innerHTML = `${transSvg} অনুবাদ`;
        s.translationVisible = false;
      }
    }

    // Timer
    if (s.useTimer) {
      this._resetTimer();
    }
  },

  _resetTimer() {
    const s = this.session;
    clearInterval(s.timerInterval);
    s.timeLeft = 60;
    const timerEl = document.getElementById('test-timer');
    timerEl.classList.remove('hidden', 'urgent');
    timerEl.textContent = '1:00';

    s.timerInterval = setInterval(() => {
      s.timeLeft--;
      const m = Math.floor(s.timeLeft / 60);
      const sec = s.timeLeft % 60;
      timerEl.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
      if (s.timeLeft <= 10) timerEl.classList.add('urgent');
      if (s.timeLeft <= 0) {
        clearInterval(s.timerInterval);
        this.handleTestAnswer(null); // auto-skip as wrong
      }
    }, 1000);
  },

  handleTestAnswer(selectedIndex) {
    const s = this.session;
    if (s.answers[s.currentIndex] !== null) return;

    clearInterval(s.timerInterval);
    s.answers[s.currentIndex] = selectedIndex;

    const q = s.questions[s.currentIndex];
    const correct = selectedIndex === q.correctIndex;

    // Record to progress so chapter quiz + error quiz update stats/progress bars
    if (selectedIndex !== null) storage.recordAnswer(q.id, correct);

    const btns = document.querySelectorAll('#test-q-options .option-btn');
    btns.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correctIndex) btn.classList.add('correct');
      else if (i === selectedIndex && !correct) btn.classList.add('wrong');
    });

    const fb = document.getElementById('test-q-feedback');
    fb.classList.remove('hidden', 'correct-fb', 'wrong-fb');
    if (correct) {
      fb.classList.add('correct-fb');
      document.getElementById('test-feedback-icon').textContent = '✓';
      document.getElementById('test-feedback-text').textContent = 'Corretto!';
    } else {
      fb.classList.add('wrong-fb');
      document.getElementById('test-feedback-icon').textContent = '✗';
      const letters = ['A', 'B', 'C'];
      const answerText = selectedIndex === null
        ? 'Tempo scaduto!'
        : `Sbagliato. Corretto: ${letters[q.correctIndex]}`;
      document.getElementById('test-feedback-text').textContent = answerText;
    }

    document.getElementById('btn-test-skip').classList.add('hidden');
    document.getElementById('btn-test-next').classList.remove('hidden');
  },

  async handleTestTranslate() {
    const s = this.session;
    const q = s.questions[s.currentIndex];
    if (!q) return;

    if (s.currentTranslation) {
      this._toggleTestTranslation();
      return;
    }

    const btn = document.getElementById('btn-test-translate');
    const transSvg = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;
    btn.classList.add('loading');
    btn.innerHTML = `${transSvg} অনুবাদ হচ্ছে...`;

    const result = await translationModule.translate(q);

    btn.classList.remove('loading');

    // Guard: user may have moved to a different question while fetch was in-flight
    if (s.questions[s.currentIndex]?.id !== q.id) return;

    if (!result) {
      btn.innerHTML = `${transSvg} অনুবাদ`;
      ui.toast('Traduzione non disponibile. Controlla la connessione.', 'error');
      return;
    }

    this._applyTestTranslation(result, q);
  },

  _applyTestTranslation(result, q) {
    const s = this.session;
    s.currentTranslation = result;
    s.translationVisible = true;

    const transSvg = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;
    document.getElementById('btn-test-translate').innerHTML = `${transSvg} অনুবাদ লুকান`;

    document.getElementById('test-bn-question').textContent = result.question || '';
    document.getElementById('test-q-text-bn').classList.remove('hidden');

    const optBtns = document.querySelectorAll('#test-q-options .option-btn');
    ['opt_0', 'opt_1', 'opt_2'].forEach((key, i) => {
      const bnDiv = optBtns[i]?.querySelector('.option-bn');
      if (bnDiv && result[key]) {
        bnDiv.textContent = result[key];
        bnDiv.classList.remove('hidden');
      }
    });

    if (ttsModule.hasBengali()) {
      document.getElementById('btn-test-tts-bn').classList.remove('hidden');
    }
  },

  _toggleTestTranslation() {
    const s = this.session;
    const btn = document.getElementById('btn-test-translate');
    const transSvg = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`;

    if (s.translationVisible) {
      document.getElementById('test-q-text-bn').classList.add('hidden');
      document.querySelectorAll('#test-q-options .option-btn .option-bn').forEach(el => el.classList.add('hidden'));
      document.getElementById('btn-test-tts-bn').classList.add('hidden');
      s.translationVisible = false;
      btn.innerHTML = `${transSvg} অনুবাদ`;
    } else {
      document.getElementById('test-q-text-bn').classList.remove('hidden');
      document.querySelectorAll('#test-q-options .option-btn .option-bn').forEach(el => {
        if (el.textContent) el.classList.remove('hidden');
      });
      if (ttsModule.hasBengali()) document.getElementById('btn-test-tts-bn').classList.remove('hidden');
      s.translationVisible = true;
      btn.innerHTML = `${transSvg} অনুবাদ লুকান`;
    }
  },

  nextTestQuestion() {
    const s = this.session;
    if (s.currentIndex < s.questions.length - 1) {
      s.currentIndex++;
      this.renderTestQuestion();
    } else {
      this.checkSkippedBeforeScore();
    }
  },

  checkSkippedBeforeScore() {
    const s = this.session;
    const skippedIndices = s.answers.reduce((acc, ans, i) => {
      if (ans === null) acc.push(i);
      return acc;
    }, []);

    if (skippedIndices.length === 0) {
      this.showScore();
      return;
    }

    const count = skippedIndices.length;
    const msg = count === 1
      ? 'Hai 1 domanda saltata. Vuoi rispondere prima di concludere?\nএকটি প্রশ্ন এড়িয়ে গেছ। শেষ করার আগে উত্তর দিতে চাও?'
      : `Hai ${count} domande saltate. Vuoi risponderle prima di concludere?\n${count}টি প্রশ্ন এড়িয়ে গেছ। শেষ করার আগে উত্তর দিতে চাও?`;

    ui.confirmCustom(
      msg,
      '← Rispondi',
      'Termina lo stesso',
      () => {
        // Go to first skipped question
        s.currentIndex = skippedIndices[0];
        this.renderTestQuestion();
      },
      () => {
        this.showScore();
      }
    );
  },

  prevTestQuestion() {
    const s = this.session;
    if (s.currentIndex > 0) {
      clearInterval(s.timerInterval);
      s.currentIndex--;
      this.renderTestQuestion();
    }
  },

  skipTestQuestion() {
    const s = this.session;
    s.answers[s.currentIndex] = null; // skipped
    clearInterval(s.timerInterval);
    if (s.currentIndex < s.questions.length - 1) {
      s.currentIndex++;
      this.renderTestQuestion();
    } else {
      this.checkSkippedBeforeScore();
    }
  },

  showScore() {
    const s = this.session;
    clearInterval(s.timerInterval);

    let correct = 0;
    const wrongList = [];

    s.questions.forEach((q, i) => {
      const ans = s.answers[i];
      if (ans === q.correctIndex) {
        correct++;
      } else {
        wrongList.push({ q, ans });
      }
    });

    const pct = s.questions.length > 0 ? Math.round((correct / s.questions.length) * 100) : 0;
    const passed = pct >= 70;

    // In error mode: clear wrong count for each correctly answered question
    if (s.isErrorMode) {
      s.questions.forEach((q, i) => {
        if (s.answers[i] === q.correctIndex) storage.clearWrong(q.id);
      });
      document.getElementById('score-title').textContent =
        `${correct} / ${s.questions.length} ভুল সংশোধিত`;
      const dispEl1 = document.getElementById('score-display');
      dispEl1.style.color = correct > 0 ? 'var(--correct)' : 'var(--wrong)';
      animateScoreCount(dispEl1, correct, '');
      document.getElementById('score-detail').textContent = `${s.questions.length - correct} errori rimanenti / বাকি ভুল`;
    } else {
      document.getElementById('score-title').textContent = passed
        ? '✓ Promosso! উত্তীর্ণ!'
        : '✗ Non promosso. অনুত্তীর্ণ।';
      const dispEl2 = document.getElementById('score-display');
      dispEl2.style.color = passed ? 'var(--correct)' : 'var(--wrong)';
      animateScoreCount(dispEl2, pct, '%');
      document.getElementById('score-detail').textContent =
        `${correct} / ${s.questions.length} corrette`;
    }

    const wrongContainer = document.getElementById('score-wrong-list');
    wrongContainer.innerHTML = '';
    if (wrongList.length) {
      const h = document.createElement('h3');
      h.textContent = `Risposte errate (${wrongList.length}) / ভুল উত্তর`;
      h.style.marginBottom = '10px';
      wrongContainer.appendChild(h);

      wrongList.slice(0, 20).forEach(({ q, ans }) => {
        const letters = ['A', 'B', 'C'];
        const userLine = (ans === null || ans === undefined)
          ? `<div class="score-wrong-user score-wrong-skipped">⊘ Saltata / এড়িয়ে যাওয়া</div>`
          : `<div class="score-wrong-user">✗ La tua risposta: ${letters[ans]}. ${q.it.options[ans]}</div>`;
        const div = document.createElement('div');
        div.className = 'score-wrong-item';
        div.innerHTML = `
          <div class="score-wrong-q">Q${q.id}: ${q.it.question}</div>
          ${userLine}
          <div class="score-wrong-correct">✓ Risposta corretta: ${letters[q.correctIndex]}. ${q.it.options[q.correctIndex]}</div>
        `;
        wrongContainer.appendChild(div);
      });
    }

    ui.hideElement('test-active');
    ui.showElement('test-score');
    ui.updateQuickNoteBtn();
  },
};

// ─────────────────────────────────────────
// 9. Celebration helpers
// ─────────────────────────────────────────

function fireConfetti() {
  var colors = ['#1a6b3a', '#2ecc71', '#f4c430', '#e74c3c', '#3498db', '#9b59b6'];
  for (var i = 0; i < 45; i++) {
    var el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.left             = (Math.random() * 100) + 'vw';
    el.style.background       = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = (1.5 + Math.random() * 2) + 's';
    el.style.animationDelay   = (Math.random() * 0.8) + 's';
    var size = (6 + Math.random() * 8) + 'px';
    el.style.width  = size;
    el.style.height = size;
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    el.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
    document.body.appendChild(el);
    el.addEventListener('animationend', function() { this.remove(); });
  }
}

function showTrophyPopup() {
  var popup = document.createElement('div');
  popup.className = 'trophy-popup';
  popup.innerHTML = '<span class="trophy-icon">🏆</span><div class="trophy-msg">Fantastico! / অসাধারণ!</div>';
  document.body.appendChild(popup);
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      popup.classList.add('show');
    });
  });
  setTimeout(function() { popup.remove(); }, 2000);
}

function showBadges(total, pct) {
  var badges = [];
  if (!localStorage.getItem('ncc_first_session')) {
    localStorage.setItem('ncc_first_session', '1');
    badges.push('Prima sessione completata! 🎉');
  }
  badges.push(total + ' domande completate! 🎯');
  if (pct >= 70) badges.push('Accuratezza alta! 📈');

  badges.forEach(function(msg, i) {
    setTimeout(function() { ui.toast(msg, 'success'); }, 400 + i * 600);
  });
}

// ─────────────────────────────────────────
// 10. Stats module
// ─────────────────────────────────────────
const statsModule = {
  computeOverall() {
    const p = storage.getProgress();
    let seen = 0, correct = 0;
    Object.values(p).forEach(v => { seen += v.seen; correct += v.correct; });
    const answered = Object.keys(p).length;
    return { seen, correct, answered, accuracy: seen ? Math.round(correct / seen * 100) : null };
  },

  computeByCategory() {
    const p = storage.getProgress();
    const result = {};

    CATEGORIES.forEach(cat => {
      const qs = QUESTIONS.filter(q => q.category === cat.slug);
      let seen = 0, correct = 0, answered = 0;
      qs.forEach(q => {
        const pp = p[q.id];
        if (pp) { seen += pp.seen; correct += pp.correct; answered++; }
      });
      result[cat.slug] = {
        label: cat.label,
        total: qs.length,
        answered,
        accuracy: seen ? Math.round(correct / seen * 100) : null,
      };
    });

    return result;
  },

  hardestQuestions(n = 10) {
    const p = storage.getProgress();
    return Object.entries(p)
      .filter(([, v]) => v.seen >= 2)
      .map(([id, v]) => ({ id: parseInt(id), accuracy: Math.round(v.correct / v.seen * 100) }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, n);
  },

  recentWrong(n = 10) {
    const p = storage.getProgress();
    return Object.entries(p)
      .filter(([, v]) => v.wrong > 0)
      .map(([id, v]) => ({ id: parseInt(id), lastSeen: v.lastSeen, wrong: v.wrong }))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, n);
  },
};

// ─────────────────────────────────────────
// 11. UI module
// ─────────────────────────────────────────
const ui = {
  toastTimer: null,

  showView(name) {
    const prev = document.querySelector('.view.active');
    const activate = () => {
      document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.style.opacity = '';
        v.style.transition = '';
      });
      const el = document.getElementById(`view-${name}`);
      if (el) el.classList.add('active');

      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === name);
      });

      state.currentView = name;

      if (name === 'home')      this.refreshHome();
      if (name === 'stats')     this.refreshStats();
      if (name === 'bookmarks') this.refreshBookmarks();
      if (name === 'settings')  this.refreshSettings();
      if (name === 'chapters')  { state.chaptersSelectMode = false; this.refreshChapters(); }
      if (name === 'notebook')  this.refreshNotebook();
      this.updateQuickNoteBtn();
    };

    if (prev && prev.id !== `view-${name}`) {
      prev.style.transition = 'opacity 0.15s ease';
      prev.style.opacity = '0';
      setTimeout(activate, 150);
    } else {
      activate();
    }
  },

  showElement(id)  { document.getElementById(id)?.classList.remove('hidden'); },
  hideElement(id)  { document.getElementById(id)?.classList.add('hidden'); },

  toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  },

  confirm(msg, onConfirm) {
    document.getElementById('modal-confirm').textContent = 'Conferma';
    document.getElementById('modal-cancel').textContent  = 'Annulla';
    document.getElementById('modal-msg').textContent = msg;
    this.showElement('modal-overlay');
    document.getElementById('modal-confirm').onclick = () => {
      this.hideElement('modal-overlay');
      onConfirm();
    };
    document.getElementById('modal-cancel').onclick = () => {
      this.hideElement('modal-overlay');
    };
  },

  confirmCustom(msg, confirmLabel, cancelLabel, onConfirm, onCancel) {
    document.getElementById('modal-msg').textContent        = msg;
    document.getElementById('modal-confirm').textContent    = confirmLabel;
    document.getElementById('modal-cancel').textContent     = cancelLabel;
    this.showElement('modal-overlay');
    document.getElementById('modal-confirm').onclick = () => {
      this.hideElement('modal-overlay');
      onConfirm();
    };
    document.getElementById('modal-cancel').onclick = () => {
      this.hideElement('modal-overlay');
      if (onCancel) onCancel();
    };
  },

  refreshHome() {
    const overall = statsModule.computeOverall();
    const byCat = statsModule.computeByCategory();

    document.getElementById('home-seen').textContent = overall.answered;
    document.getElementById('home-correct').textContent = overall.correct;
    document.getElementById('home-accuracy').textContent =
      overall.accuracy !== null ? `${overall.accuracy}%` : '—';

    const pct = Math.round(overall.answered / TOTAL * 100);
    document.getElementById('home-progress-fill').style.width = `${pct}%`;
    document.getElementById('home-progress-label').textContent =
      `${overall.answered} / ${TOTAL} domande`;

    const barsEl = document.getElementById('home-cat-bars');
    barsEl.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const d = byCat[cat.slug];
      const accPct = d.accuracy !== null ? d.accuracy : 0;
      barsEl.innerHTML += `
        <div class="cat-bar-row">
          <span class="cat-bar-label">${d.label}</span>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${accPct}%"></div>
          </div>
          <span class="cat-bar-pct">${d.accuracy !== null ? d.accuracy + '%' : '—'}</span>
        </div>`;
    });
  },

  refreshStats() {
    const overall = statsModule.computeOverall();
    const byCat = statsModule.computeByCategory();

    document.getElementById('stats-total-seen').textContent = overall.answered;
    document.getElementById('stats-total-correct').textContent = overall.correct;
    document.getElementById('stats-accuracy').textContent =
      overall.accuracy !== null ? `${overall.accuracy}%` : '—';

    const barsEl = document.getElementById('stats-cat-bars');
    barsEl.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const d = byCat[cat.slug];
      const accPct = d.accuracy !== null ? d.accuracy : 0;
      barsEl.innerHTML += `
        <div class="cat-bar-row">
          <span class="cat-bar-label">${d.label}</span>
          <div class="cat-bar-track">
            <div class="cat-bar-fill" style="width:${accPct}%"></div>
          </div>
          <span class="cat-bar-pct">${d.accuracy !== null ? d.accuracy + '%' : '—'}</span>
        </div>`;
    });

    const hardest = statsModule.hardestQuestions();
    const hardEl = document.getElementById('stats-hardest');
    hardEl.innerHTML = '';
    if (!hardest.length) {
      hardEl.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem">Ancora nessun dato. বেশি প্রশ্নের উত্তর দিন।</p>';
    } else {
      hardest.forEach(({ id, accuracy }) => {
        const q = QUESTIONS.find(x => x.id === id);
        if (!q) return;
        hardEl.innerHTML += `
          <div class="stats-hardest-item">
            <span class="stats-item-q">Q${id}: ${q.it.question.slice(0, 60)}${q.it.question.length > 60 ? '…' : ''}</span>
            <span class="stats-item-pct">${accuracy}%</span>
          </div>`;
      });
    }

    const recent = statsModule.recentWrong();
    const recEl = document.getElementById('stats-recent-wrong');
    recEl.innerHTML = '';
    if (!recent.length) {
      recEl.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem">Nessuna risposta errata recente. ভালো!</p>';
    } else {
      recent.forEach(({ id }) => {
        const q = QUESTIONS.find(x => x.id === id);
        if (!q) return;
        recEl.innerHTML += `
          <div class="stats-recent-item">
            <span class="stats-item-q">Q${id}: ${q.it.question.slice(0, 60)}${q.it.question.length > 60 ? '…' : ''}</span>
          </div>`;
      });
    }
  },

  refreshBookmarks() {
    const bms = storage.getBookmarks();
    const listEl = document.getElementById('bookmarks-list');
    const emptyEl = document.getElementById('bookmarks-empty');

    listEl.innerHTML = '';
    if (!bms.length) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    bms.forEach(id => {
      const q = QUESTIONS.find(x => x.id === id);
      if (!q) return;
      const div = document.createElement('div');
      div.className = 'bookmark-list-item';
      div.innerHTML = `
        <div class="bookmark-q-num">Q${id} · ${q.categoryLabel}</div>
        <div class="bookmark-q-text">${q.it.question}</div>`;
      div.addEventListener('click', () => {
        state.activeCategory = 'bookmarks';
        studyCtrl.rebuildQueue();
        studyCtrl.jumpTo(id);
      });
      listEl.appendChild(div);
    });
  },

  updateQuickNoteBtn() {
    const btn = document.getElementById('btn-quick-note');
    if (!btn) return;
    const testActiveVisible = !document.getElementById('test-active')?.classList.contains('hidden');
    const visible =
      state.currentView === 'study' ||
      (state.currentView === 'test' && testActiveVisible &&
       testCtrl.session && testCtrl.session.source !== 'test');
    btn.classList.toggle('hidden', !visible);
  },

  openNoteModal(questionContext) {
    const overlay = document.getElementById('note-modal-overlay');
    document.getElementById('note-modal-text').value = '';
    const ctxEl = document.getElementById('note-modal-context');
    if (questionContext) {
      ctxEl.textContent = `Q${questionContext.id}: ${questionContext.text.slice(0, 80)}${questionContext.text.length > 80 ? '…' : ''}`;
      ctxEl.classList.remove('hidden');
      overlay.dataset.questionId = questionContext.id;
      overlay.dataset.questionSnippet = questionContext.text.slice(0, 100);
    } else {
      ctxEl.classList.add('hidden');
      delete overlay.dataset.questionId;
      delete overlay.dataset.questionSnippet;
    }
    this.showElement('note-modal-overlay');
    setTimeout(() => document.getElementById('note-modal-text').focus(), 50);
  },

  refreshNotebook() {
    const listEl = document.getElementById('notebook-list');
    if (!listEl) return;
    const notes = storage.getNotes();
    listEl.innerHTML = '';
    if (!notes.length) {
      listEl.innerHTML = `<div class="card"><p class="empty-msg">Nessuna nota. Clicca ✏ durante lo studio per aggiungerne una.<br><span class="bn-text">কোনো নোট নেই। পড়ার সময় ✏ বোতাম চাপুন।</span></p></div>`;
      return;
    }
    notes.forEach(note => {
      const div = document.createElement('div');
      div.className = 'note-item card';
      const date = new Date(note.timestamp).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
      div.innerHTML = `
        <div class="note-item-header">
          <span class="note-date">${date}</span>
          <button class="note-delete-btn" title="Elimina">✕</button>
        </div>
        ${note.questionSnippet ? `<div class="note-context">Q${note.questionId}: ${note.questionSnippet.slice(0, 80)}${note.questionSnippet.length > 80 ? '…' : ''}</div>` : ''}
        <div class="note-text">${note.text.replace(/\n/g, '<br>')}</div>`;
      div.querySelector('.note-delete-btn').addEventListener('click', () => {
        storage.deleteNote(note.id);
        this.refreshNotebook();
      });
      listEl.appendChild(div);
    });
  },

  refreshChapters() {
    const view = document.getElementById('view-chapters');
    const listEl = document.getElementById('chapters-list');
    if (!listEl || !view) return;
    view.classList.toggle('selecting', state.chaptersSelectMode);

    listEl.innerHTML = '';
    const progress = storage.getProgress();
    const sel = state.chapterSelection;

    CATEGORIES.forEach(cat => {
      const catQs = QUESTIONS.filter(q => q.category === cat.slug);
      const total = catQs.length;
      const answered = catQs.filter(q => progress[q.id]).length;
      const pct = total > 0 ? Math.round(answered / total * 100) : 0;
      const isSelected = sel.categories.includes(cat.slug);

      const div = document.createElement('div');
      div.className = 'chapter-card card' + (isSelected ? ' selected' : '');
      div.innerHTML = `
        <div class="chapter-card-header">
          <div>
            <div class="chapter-title">
              <span class="chapter-check-mark">✓</span>${cat.label}
            </div>
            <div class="chapter-bn">${cat.bn}</div>
          </div>
          <div class="chapter-count">${total} domande</div>
        </div>
        <div class="chapter-progress">
          <div class="cat-bar-track" style="flex:1">
            <div class="cat-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="cat-bar-pct">${pct}%</span>
        </div>`;
      div.addEventListener('click', () => {
        if (state.chaptersSelectMode) {
          const idx = state.chapterSelection.categories.indexOf(cat.slug);
          if (idx === -1) state.chapterSelection.categories.push(cat.slug);
          else state.chapterSelection.categories.splice(idx, 1);
          storage.saveChapterSelection(state.chapterSelection);
          this.refreshChapters();
        } else {
          state.testConfig = { category: cat.slug, count: 'all', timer: false, source: 'chapters' };
          testCtrl.start();
          ui.showView('test');
        }
      });
      listEl.appendChild(div);
    });

    this.updateChaptersBar();
  },

  updateChaptersBar() {
    const sel = state.chapterSelection;
    const summary = document.getElementById('chapters-selected-count');
    if (!summary) return;
    const totalQs = QUESTIONS.filter(q => sel.categories.includes(q.category)).length;
    summary.textContent = `${sel.categories.length} capitoli · ${totalQs} domande`;

    const startBtn = document.getElementById('btn-chapters-start');
    if (startBtn) startBtn.disabled = sel.categories.length === 0;

    document.querySelectorAll('#chapters-count-group .pill').forEach(p => {
      p.classList.toggle('active', String(p.dataset.count) === String(sel.count));
    });
  },

  setChaptersSelectMode(on) {
    state.chaptersSelectMode = !!on;
    if (!on) state.chapterSelection.categories = [];
    storage.saveChapterSelection(state.chapterSelection);
    this.refreshChapters();
  },

  refreshSettings() {
    const settings = storage.getSettings();
    const rateEl = document.getElementById('tts-rate');
    rateEl.value = settings.ttsRate;
    document.getElementById('tts-rate-val').textContent = `${settings.ttsRate}×`;

    const cacheCount = Math.floor(translationModule.getCacheSize() / 4);
    document.getElementById('cache-size').textContent = `${cacheCount} traduzioni in cache`;
  },
};

// ─────────────────────────────────────────
// 12. Event Listeners
// ─────────────────────────────────────────
function wireEvents() {
  // Nav
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => {
      const view = el.dataset.nav;
      if (view === 'study' && !state.studyQueue.length) {
        studyCtrl.init();
      }
      ui.showView(view);
    });
  });

  // Home actions
  document.getElementById('btn-quick-study').addEventListener('click', () => {
    state.spacedRepEnabled = true;
    document.getElementById('spaced-rep-toggle').checked = true;
    state.activeCategory = 'all';
    studyCtrl.init();
    ui.showView('study');
  });

  document.getElementById('btn-browse-all').addEventListener('click', () => {
    state.spacedRepEnabled = false;
    document.getElementById('spaced-rep-toggle').checked = false;
    state.activeCategory = 'all';
    studyCtrl.init();
    ui.showView('study');
  });

  document.getElementById('btn-start-test').addEventListener('click', () => {
    ui.showView('test');
    ui.showElement('test-setup');
    ui.hideElement('test-active');
    ui.hideElement('test-score');
  });

  document.getElementById('btn-error-quiz').addEventListener('click', () => {
    state.testConfig = { category: 'errors', count: 'all', timer: false, source: 'errors' };
    testCtrl.start();
    if (testCtrl.session) ui.showView('test');
  });

  // Category filter pills
  document.querySelectorAll('#category-filter .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#category-filter .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeCategory = pill.dataset.cat;
      studyCtrl.rebuildQueue();
      studyCtrl.renderQuestion();
    });
  });

  // Spaced rep toggle
  document.getElementById('spaced-rep-toggle').addEventListener('change', e => {
    state.spacedRepEnabled = e.target.checked;
    studyCtrl.rebuildQueue();
    studyCtrl.renderQuestion();
  });

  // Study actions
  document.getElementById('btn-translate').addEventListener('click', () => {
    studyCtrl.handleTranslate();
  });

  document.getElementById('btn-tts-it').addEventListener('click', () => {
    const q = studyCtrl.currentQuestion();
    if (q) ttsModule.speakItalian(q.it.question);
  });

  document.getElementById('btn-tts-bn').addEventListener('click', () => {
    const t = studyCtrl.currentTranslation;
    if (t?.question) ttsModule.speakBengali(t.question);
  });

  document.getElementById('bookmark-btn').addEventListener('click', () => {
    const q = studyCtrl.currentQuestion();
    if (!q) return;
    const isNow = storage.toggleBookmark(q.id);
    document.getElementById('bookmark-btn').classList.toggle('active', isNow);
    ui.toast(isNow ? '⭐ Salvato! / সংরক্ষিত!' : 'Rimosso dai salvati');
  });

  document.getElementById('btn-prev').addEventListener('click', () => studyCtrl.prev());
  document.getElementById('btn-skip').addEventListener('click', () => studyCtrl.skip());
  document.getElementById('btn-next').addEventListener('click', () => studyCtrl.next());

  // Study exit + result buttons
  document.getElementById('btn-exit-study').addEventListener('click', () => {
    if (studyCtrl.sessionStats.total === 0) {
      ui.toast('Nessuna risposta ancora. / এখনো কোনো উত্তর নেই।');
      ui.showView('home');
    } else {
      ui.confirm(
        'Vuoi uscire dalla sessione? I progressi sono salvati.\nসেশন শেষ করবেন? অগ্রগতি সংরক্ষিত।',
        () => studyCtrl.showResult()
      );
    }
  });

  function resetStudyView() {
    document.getElementById('study-result').classList.add('hidden');
    document.getElementById('category-filter').classList.remove('hidden');
    document.getElementById('study-controls-bar').classList.remove('hidden');
    document.getElementById('question-card').classList.remove('hidden');
    document.querySelector('#view-study .q-nav').classList.remove('hidden');
  }

  document.getElementById('btn-study-restart').addEventListener('click', () => {
    resetStudyView();
    studyCtrl.init();
  });

  document.getElementById('btn-study-result-home').addEventListener('click', () => {
    resetStudyView();
    ui.showView('home');
  });

  // Test exit button
  document.getElementById('btn-exit-test').addEventListener('click', () => {
    ui.confirm(
      'Vuoi terminare il test anticipatamente?\nপরীক্ষা শেষ করবেন?',
      () => testCtrl.showScore()
    );
  });

  // Practice test setup
  document.querySelectorAll('.count-pills .pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.count-pills .pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const val = pill.dataset.count;
      state.testConfig.count = val === 'all' ? 'all' : parseInt(val);
    });
  });

  document.getElementById('test-cat-select').addEventListener('change', e => {
    state.testConfig.category = e.target.value;
  });

  document.getElementById('test-timer-toggle').addEventListener('change', e => {
    state.testConfig.timer = e.target.checked;
  });

  // Make the whole timer row clickable (not just the small toggle)
  document.getElementById('timer-toggle-row').addEventListener('click', e => {
    if (e.target.closest('label')) return; // label handles it natively
    const cb = document.getElementById('test-timer-toggle');
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change'));
  });

  document.getElementById('btn-start-test-go').addEventListener('click', () => {
    testCtrl.start();
  });

  document.getElementById('btn-test-prev').addEventListener('click', () => {
    testCtrl.prevTestQuestion();
  });

  document.getElementById('btn-test-next').addEventListener('click', () => {
    testCtrl.nextTestQuestion();
  });

  document.getElementById('btn-test-skip').addEventListener('click', () => {
    testCtrl.skipTestQuestion();
  });

  document.getElementById('btn-test-translate').addEventListener('click', () => {
    testCtrl.handleTestTranslate();
  });

  document.getElementById('btn-test-tts-it').addEventListener('click', () => {
    const s = testCtrl.session;
    if (s) ttsModule.speakItalian(s.questions[s.currentIndex].it.question);
  });

  document.getElementById('btn-test-tts-bn').addEventListener('click', () => {
    const t = testCtrl.session?.currentTranslation;
    if (t?.question) ttsModule.speakBengali(t.question);
  });

  document.getElementById('btn-score-retry').addEventListener('click', () => {
    testCtrl.start(); // re-run with same config (errors mode rebuilds from current wrong list)
  });

  document.getElementById('btn-score-home').addEventListener('click', () => {
    const source = testCtrl.session?.source;
    if (source === 'chapters') ui.showView('chapters');
    else ui.showView('home');
  });

  function doResetProgress() {
    ui.confirm(
      'Sei sicuro? Tutti i progressi verranno cancellati.\nআপনি কি নিশ্চিত? সমস্ত অগ্রগতি মুছে যাবে।',
      () => {
        storage.resetProgress();
        studyCtrl.rebuildQueue();
        studyCtrl.renderQuestion();
        ui.refreshStats();
        ui.refreshHome();
        ui.toast('Progresso azzerato. / অগ্রগতি মুছে গেছে।');
      }
    );
  }

  // Settings
  document.getElementById('btn-reset-progress-settings').addEventListener('click', doResetProgress);

  // Bookmarks — study bookmarked
  document.getElementById('btn-study-bookmarks').addEventListener('click', () => {
    state.activeCategory = 'bookmarks';

    // Activate bookmarks pill
    document.querySelectorAll('#category-filter .pill').forEach(p => {
      p.classList.toggle('active', p.dataset.cat === 'bookmarks');
    });

    studyCtrl.init();
    ui.showView('study');
  });

  // Settings — TTS rate
  document.getElementById('tts-rate').addEventListener('input', e => {
    const val = parseFloat(e.target.value);
    document.getElementById('tts-rate-val').textContent = `${val}×`;
    const s = storage.getSettings();
    s.ttsRate = val;
    storage.saveSettings(s);
  });

  document.getElementById('tts-voice-select').addEventListener('change', e => {
    const s = storage.getSettings();
    s.ttsVoice = e.target.value;
    storage.saveSettings(s);
  });

  document.getElementById('btn-clear-cache').addEventListener('click', () => {
    ui.confirm('Svuotare la cache delle traduzioni?\nঅনুবাদ ক্যাশ মুছবেন?', () => {
      storage.clearCache();
      ui.refreshSettings();
      ui.toast('Cache svuotata. / ক্যাশ মুছে গেছে।');
    });
  });

  // Notebook — floating quick-note button
  document.getElementById('btn-quick-note').addEventListener('click', () => {
    let questionContext = null;
    if (state.currentView === 'study') {
      const q = studyCtrl.currentQuestion();
      if (q) questionContext = { id: q.id, text: q.it.question };
    } else if (state.currentView === 'test' && testCtrl.session) {
      const s = testCtrl.session;
      const q = s.questions[s.currentIndex];
      if (q) questionContext = { id: q.id, text: q.it.question };
    }
    ui.openNoteModal(questionContext);
  });

  // Notebook — note modal: save / cancel
  document.getElementById('btn-note-save').addEventListener('click', () => {
    const overlay = document.getElementById('note-modal-overlay');
    const text = document.getElementById('note-modal-text').value.trim();
    if (!text) { ui.toast('Scrivi qualcosa prima di salvare.', 'error'); return; }
    const note = { id: Date.now(), text, timestamp: Date.now() };
    if (overlay.dataset.questionId) {
      note.questionId = parseInt(overlay.dataset.questionId);
      note.questionSnippet = overlay.dataset.questionSnippet || '';
    }
    storage.saveNote(note);
    ui.hideElement('note-modal-overlay');
    ui.toast('Nota salvata! নোট সংরক্ষিত!', 'success');
    if (state.currentView === 'notebook') ui.refreshNotebook();
  });

  document.getElementById('btn-note-cancel').addEventListener('click', () => {
    ui.hideElement('note-modal-overlay');
  });

  // Notebook — add note button inside notebook view
  document.getElementById('btn-add-note').addEventListener('click', () => {
    ui.openNoteModal(null);
  });

  // Chapters — multi-chapter quiz controls
  document.getElementById('btn-chapters-multi').addEventListener('click', () => {
    ui.setChaptersSelectMode(true);
  });

  document.getElementById('btn-chapters-cancel').addEventListener('click', () => {
    ui.setChaptersSelectMode(false);
  });

  document.getElementById('btn-chapters-select-all').addEventListener('click', () => {
    state.chapterSelection.categories = CATEGORIES.map(c => c.slug);
    storage.saveChapterSelection(state.chapterSelection);
    ui.refreshChapters();
  });

  document.getElementById('btn-chapters-clear').addEventListener('click', () => {
    state.chapterSelection.categories = [];
    storage.saveChapterSelection(state.chapterSelection);
    ui.refreshChapters();
  });

  document.querySelectorAll('#chapters-count-group .pill').forEach(p => {
    p.addEventListener('click', () => {
      const v = p.dataset.count;
      state.chapterSelection.count = v === 'all' ? 'all' : parseInt(v);
      storage.saveChapterSelection(state.chapterSelection);
      ui.updateChaptersBar();
    });
  });

  document.getElementById('btn-chapters-start').addEventListener('click', () => {
    const sel = state.chapterSelection;
    if (sel.categories.length === 0) return;
    state.testConfig = {
      categories: [...sel.categories],
      count: sel.count,
      timer: false,
      source: 'chapters',
    };
    state.chaptersSelectMode = false;
    testCtrl.start();
    ui.showView('test');
  });
}

// ─────────────────────────────────────────
// 13. App init
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (typeof QUESTIONS === 'undefined' || !QUESTIONS.length) {
    document.body.innerHTML = `
      <div style="padding:40px;max-width:600px;margin:0 auto;font-family:sans-serif">
        <h2>⚠️ questions.js mancante</h2>
        <p>Le domande non sono state caricate.</p>
        <ol style="margin-top:16px;line-height:2">
          <li>Installa pdfplumber: <code>pip install pdfplumber</code></li>
          <li>Esegui: <code>python extract_questions.py /path/to/ncc.pdf</code></li>
          <li>Copia il file <code>questions.js</code> generato in questa cartella.</li>
        </ol>
        <p style="margin-top:16px;color:#666">বাংলা: questions.js ফাইল তৈরি করুন এবং এখানে রাখুন।</p>
      </div>`;
    return;
  }

  ttsModule.init();
  state.chapterSelection = storage.getChapterSelection();
  wireEvents();
  studyCtrl.init();
  makeDraggableNoteBtn();
  ui.showView('home');
});

function makeDraggableNoteBtn() {
  const el = document.getElementById('btn-quick-note');
  if (!el) return;

  // Restore saved position
  const saved = JSON.parse(localStorage.getItem('noteBtn_pos') || 'null');
  if (saved) {
    el.style.right  = Math.max(8, saved.right)  + 'px';
    el.style.bottom = Math.max(8, saved.bottom) + 'px';
  }

  let startClientX, startClientY, startRight, startBottom, moved = false;

  function dragStart(cx, cy) {
    const rect = el.getBoundingClientRect();
    startClientX = cx;
    startClientY = cy;
    startRight  = window.innerWidth  - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    moved = false;
    el.style.transition = 'none';
    el.style.animation  = 'none';
  }

  function dragMove(cx, cy) {
    const dx = cx - startClientX;
    const dy = cy - startClientY;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    el.style.right  = Math.max(8, startRight  - dx) + 'px';
    el.style.bottom = Math.max(8, startBottom - dy) + 'px';
  }

  function dragEnd() {
    if (moved) {
      const rect = el.getBoundingClientRect();
      localStorage.setItem('noteBtn_pos', JSON.stringify({
        right:  Math.max(8, window.innerWidth  - rect.right),
        bottom: Math.max(8, window.innerHeight - rect.bottom)
      }));
      el.style.transition = '';
      el.style.animation  = '';
    }
  }

  // Mouse
  el.addEventListener('mousedown', e => { dragStart(e.clientX, e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => { if (startClientX !== undefined) dragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup', () => { if (startClientX !== undefined) { dragEnd(); startClientX = undefined; } });

  // Touch
  el.addEventListener('touchstart', e => { const t = e.touches[0]; dragStart(t.clientX, t.clientY); }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (startClientX !== undefined && moved) e.preventDefault();
    if (startClientX !== undefined) { const t = e.touches[0]; dragMove(t.clientX, t.clientY); }
  }, { passive: false });
  document.addEventListener('touchend', () => { if (startClientX !== undefined) { dragEnd(); startClientX = undefined; } });

  // Swallow click if it was a drag
  el.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); moved = false; } }, true);
}
