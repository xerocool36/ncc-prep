/* ═══════════════════════════════════════
   NCC Exam Prep — app.js
   ═══════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────
// 1. Constants
// ─────────────────────────────────────────
const TOTAL = (typeof QUESTIONS !== 'undefined') ? QUESTIONS.length : 0;

const CATEGORIES = [
  { slug: 'mechanics',        label: 'Meccanica' },
  { slug: 'road_safety',      label: 'Sicurezza' },
  { slug: 'insurance',        label: 'Assicurazione' },
  { slug: 'ncc_regs',         label: 'Normativa NCC' },
  { slug: 'navigation',       label: 'Navigazione' },
  { slug: 'advanced_systems', label: 'Sistemi Avanzati' },
];

const LS = {
  PROGRESS: 'ncc_progress',
  BOOKMARKS: 'ncc_bookmarks',
  CACHE:     'ncc_trans_cache',
  SETTINGS:  'ncc_settings',
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
    const joined = parts.join('|||');

    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(joined)}&langpair=it|bn`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const translated = data.responseData?.translatedText || '';
      const bnParts = translated.split('|||');

      const diskCache = storage.getCache();
      const fieldNames = ['question', 'opt_0', 'opt_1', 'opt_2'];

      for (let i = 0; i < fieldNames.length; i++) {
        const k = this._key(id, fieldNames[i]);
        const val = (bnParts[i] || '').trim();
        this.memCache[k] = val;
        diskCache[k] = val;
      }
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

  init() {
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
    state.answered = false;

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

    // If already had a cached translation, show it pre-loaded
    const cached = translationModule.getCached(q.id);
    if (cached) this._applyTranslation(cached, q);
  },

  handleAnswer(selectedIndex) {
    if (state.answered) return;
    state.answered = true;

    const q = this.currentQuestion();
    const correct = selectedIndex === q.correctIndex;

    storage.recordAnswer(q.id, correct);

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

    const btn = document.getElementById('btn-translate');
    btn.classList.add('loading');
    btn.textContent = 'অনুবাদ হচ্ছে...';

    const result = await translationModule.translate(q);

    btn.classList.remove('loading');
    btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg> অনুবাদ`;

    if (!result) {
      ui.toast('Traduzione non disponibile. Controlla la connessione.', 'error');
      return;
    }

    this._applyTranslation(result, q);
  },

  _applyTranslation(result, q) {
    this.currentTranslation = result;

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

  next() {
    if (state.studyIndex < state.studyQueue.length - 1) {
      state.studyIndex++;
      this.renderQuestion();
    } else {
      ui.toast('Fine della lista! দারুণ! সব প্রশ্ন শেষ।', 'success');
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
const testCtrl = {
  session: null,

  start() {
    const { category, count, timer } = state.testConfig;
    const bookmarks = storage.getBookmarks();

    let pool;
    if (category === 'bookmarks') {
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
    };

    ui.showElement('test-active');
    ui.hideElement('test-setup');
    ui.hideElement('test-score');

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

    const container = document.getElementById('test-q-options');
    container.innerHTML = '';
    const letters = ['A', 'B', 'C'];
    q.it.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.dataset.index = i;
      btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${opt}</span>`;
      btn.addEventListener('click', () => this.handleTestAnswer(i));
      container.appendChild(btn);
    });

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

  nextTestQuestion() {
    const s = this.session;
    if (s.currentIndex < s.questions.length - 1) {
      s.currentIndex++;
      this.renderTestQuestion();
    } else {
      this.showScore();
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
      this.showScore();
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

    const pct = Math.round((correct / s.questions.length) * 100);
    const passed = pct >= 70;

    document.getElementById('score-title').textContent = passed
      ? '✓ Promosso! উত্তীর্ণ!'
      : '✗ Non promosso. অনুত্তীর্ণ।';
    document.getElementById('score-display').textContent = `${pct}%`;
    document.getElementById('score-display').style.color = passed ? 'var(--correct)' : 'var(--wrong)';
    document.getElementById('score-detail').textContent =
      `${correct} / ${s.questions.length} corrette`;

    const wrongContainer = document.getElementById('score-wrong-list');
    wrongContainer.innerHTML = '';
    if (wrongList.length) {
      const h = document.createElement('h3');
      h.textContent = `Risposte errate (${wrongList.length}) / ভুল উত্তর`;
      h.style.marginBottom = '10px';
      wrongContainer.appendChild(h);

      wrongList.slice(0, 20).forEach(({ q, ans }) => {
        const letters = ['A', 'B', 'C'];
        const div = document.createElement('div');
        div.className = 'score-wrong-item';
        div.innerHTML = `
          <div class="score-wrong-q">Q${q.id}: ${q.it.question}</div>
          <div class="score-wrong-correct">✓ ${letters[q.correctIndex]}. ${q.it.options[q.correctIndex]}</div>
        `;
        wrongContainer.appendChild(div);
      });
    }

    ui.hideElement('test-active');
    ui.showElement('test-score');
  },
};

// ─────────────────────────────────────────
// 9. Stats module
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
// 10. UI module
// ─────────────────────────────────────────
const ui = {
  toastTimer: null,

  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
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
// 11. Event Listeners
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

  document.getElementById('btn-start-test-go').addEventListener('click', () => {
    testCtrl.start();
  });

  document.getElementById('btn-test-next').addEventListener('click', () => {
    testCtrl.nextTestQuestion();
  });

  document.getElementById('btn-test-skip').addEventListener('click', () => {
    testCtrl.skipTestQuestion();
  });

  document.getElementById('btn-score-retry').addEventListener('click', () => {
    testCtrl.start(); // re-run with same config
  });

  document.getElementById('btn-score-home').addEventListener('click', () => {
    ui.showView('home');
  });

  // Stats
  document.getElementById('btn-reset-progress').addEventListener('click', () => {
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
  });

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
}

// ─────────────────────────────────────────
// 12. App init
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
  wireEvents();
  studyCtrl.init();
  ui.showView('home');
});
