import { BY_ID, ORDER, MD_DIRS, STRUCTURE } from './bible-books.js';

const API = 'https://bible-api.com/data';
const SEARCH_API = 'https://dailybible.ca/api/search';

/* ---------- Traditional -> Simplified ---------- */
let _conv = null;
export function ready() {
  return new Promise(resolve => {
    const tick = () => {
      if (!_conv && typeof window !== 'undefined' && window.OpenCC) {
        try { _conv = window.OpenCC.Converter({ from: 'tw', to: 'cn' }); } catch (e) { _conv = null; }
      }
      if (_conv) resolve(true); else setTimeout(tick, 60);
    };
    tick();
    setTimeout(() => resolve(false), 6000);
  });
}
export function t2s(s) {
  if (!s) return '';
  try { return _conv ? _conv(s) : s; } catch (e) { return s; }
}

/* ---------- polite fetch queue ---------- */
let chain = Promise.resolve();
let last = 0;
function queued(fn) {
  const run = async () => {
    const wait = Math.max(0, 140 - (Date.now() - last));
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function getJSON(url) {
  return queued(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 14000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.status === 429) { await new Promise(x => setTimeout(x, 1400)); continue; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) {
        clearTimeout(timer);
        if (attempt === 1) throw e;
        await new Promise(x => setTimeout(x, 700));
      }
    }
    throw new Error('unreachable');
  });
}

/* ---------- ESV (optional, user-supplied key) ----------
   Crossway's terms: keys may not be shared or published, the text may not be
   cached beyond 500 verses, and every page showing it must carry the notice.
   So the key lives only in this browser and ESV text is never persisted. */
const ESV_KEY_LS = 'bibleos.esvKey.v1';
const ESV_VERSE_BUDGET = 450;
let _esvKey = null;
let _esvState = { ok: true, message: '' };

export function getEsvKey() {
  if (_esvKey === null) {
    try { _esvKey = localStorage.getItem(ESV_KEY_LS) || ''; } catch (e) { _esvKey = ''; }
  }
  return _esvKey;
}
export function setEsvKey(key) {
  _esvKey = (key || '').trim();
  try {
    if (_esvKey) localStorage.setItem(ESV_KEY_LS, _esvKey);
    else localStorage.removeItem(ESV_KEY_LS);
  } catch (e) {}
  _esvState = { ok: true, message: '' };
  cache.clear();
}
const SRC_LS = 'bibleos.englishSource.v1';
const MD_BASE = 'https://cdn.jsdelivr.net/gh/lguenth/mdbible@main/by_chapter';
let _src = null;

/* 'web' = World English Bible | 'mdesv' = local ESV markdown copy | 'esvapi' = api.esv.org */
export function englishSourceId() {
  if (_src === null) {
    try { _src = localStorage.getItem(SRC_LS) || 'web'; } catch (e) { _src = 'web'; }
  }
  return _src;
}
export function setEnglishSource(id) {
  _src = id;
  try { localStorage.setItem(SRC_LS, id); } catch (e) {}
  _esvState = { ok: true, message: '' };
  cache.clear();
}
export function englishSource() { return englishSourceId() === 'web' ? 'WEB' : 'ESV'; }
export function esvState() { return _esvState; }
/* only the API imposes a caching cap; a local copy does not */
export function esvVerseBudget() { return englishSourceId() === 'esvapi' ? ESV_VERSE_BUDGET : 1400; }

async function fetchMdEsvChapter(bookId, chapter) {
  const dir = MD_DIRS[ORDER.indexOf(bookId)];
  if (!dir) return null;
  const url = `${MD_BASE}/${dir}/Chapter_${String(chapter).padStart(2, '0')}.md`;
  try {
    const text = await queued(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 14000);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      } catch (e) { clearTimeout(timer); throw e; }
    });
    const verses = [];
    text.split('\n').forEach(line => {
      const m = line.match(/^\s*(\d+)\.\s+(.*\S)\s*$/);
      if (m) verses.push({ verse: +m[1], text: m[2] });
    });
    if (!verses.length) throw new Error('empty');
    _esvState = { ok: true, message: '' };
    return verses;
  } catch (e) {
    _esvState = { ok: false, message: 'That chapter isn’t in the local ESV copy. Showing the public-domain English text.' };
    return null;
  }
}

function fetchEnglishOverride(bookId, chapter) {
  const id = englishSourceId();
  if (id === 'esvapi') return fetchEsvChapter(bookId, chapter);
  if (id === 'mdesv') return fetchMdEsvChapter(bookId, chapter);
  return Promise.resolve(null);
}

function parseEsvPassage(text) {
  const parts = String(text || '').split(/\[(\d+)\]/);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ verse: +parts[i], text: parts[i + 1] });
  return out;
}

async function fetchEsvChapter(bookId, chapter) {
  const key = getEsvKey();
  if (!key) return null;
  const ref = `${BY_ID[bookId].name} ${chapter}`;
  const url = `https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(ref)}`
    + '&include-passage-references=false&include-verse-numbers=true&include-first-verse-numbers=true'
    + '&include-footnotes=false&include-footnote-body=false&include-headings=false'
    + '&include-short-copyright=false&include-copyright=false&include-selahs=false'
    + '&indent-paragraphs=0&indent-poetry=false&indent-declares=0&indent-psalm-doxology=0&line-length=0';
  try {
    const j = await queued(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 14000);
      try {
        const r = await fetch(url, { headers: { Authorization: 'Token ' + key }, signal: ctrl.signal });
        clearTimeout(timer);
        if (r.status === 401 || r.status === 403) throw new Error('key');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      } catch (e) { clearTimeout(timer); throw e; }
    });
    const verses = parseEsvPassage((j.passages || []).join('\n'));
    if (!verses.length) throw new Error('empty');
    _esvState = { ok: true, message: '' };
    return verses;
  } catch (e) {
    _esvState = {
      ok: false,
      message: e && e.message === 'key'
        ? 'That ESV key was refused. Showing the public-domain English text.'
        : 'The ESV service didn’t answer. Showing the public-domain English text.',
    };
    return null;
  }
}

/* keep no more than ~450 ESV verses in memory, per Crossway's caching limit */
function trimEsvCache() {
  if (englishSourceId() !== 'esvapi') return;
  let total = 0;
  const esv = [...cache.values()].filter(c => c.source === 'ESV').reverse();
  for (const c of esv) {
    total += c.numbers.length;
    if (total > ESV_VERSE_BUDGET) cache.delete(c.key);
  }
}

/* ---------- text cleanup ---------- */
const cleanEn = t => String(t || '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
const cleanZh = t => t2s(String(t || '').replace(/〔[^〕]*〕/g, '').replace(/\s+/g, '')).trim();

/* ---------- chapter assembly ---------- */
const cache = new Map();
const inflight = new Map();

export function chapterKey(bookId, chapter) { return bookId + '/' + chapter; }
export function bookSlug(bookId) { return (BY_ID[bookId] || {}).name?.replace(/\s+/g, '-') || bookId; }
export function slugToBook(slug) {
  const norm = String(slug || '').replace(/[-_+]/g, ' ').toLowerCase().trim();
  for (const id of ORDER) {
    const b = BY_ID[id];
    if (b.name.toLowerCase() === norm) return id;
    if (b.aliases.includes(norm.replace(/[\s.]/g, ''))) return id;
  }
  return null;
}
export function nextChapter(bookId, chapter) {
  const b = BY_ID[bookId]; if (!b) return null;
  if (chapter < b.chapters) return { bookId, chapter: chapter + 1 };
  const i = ORDER.indexOf(bookId);
  return i >= 0 && i < ORDER.length - 1 ? { bookId: ORDER[i + 1], chapter: 1 } : null;
}
export function prevChapter(bookId, chapter) {
  if (chapter > 1) return { bookId, chapter: chapter - 1 };
  const i = ORDER.indexOf(bookId);
  return i > 0 ? { bookId: ORDER[i - 1], chapter: BY_ID[ORDER[i - 1]].chapters } : null;
}

function structureFor(bookId, chapter, numbers) {
  const preset = STRUCTURE[chapterKey(bookId, chapter)];
  if (preset) {
    const max = numbers[numbers.length - 1] || 1;
    return preset.map(s => ({
      en: s.en, zh: s.zh,
      paras: s.paras.filter(p => p[0] <= max).map(p => [p[0], Math.min(p[1], max)]),
    })).filter(s => s.paras.length);
  }
  const paras = [];
  for (let i = 0; i < numbers.length; i += 5) {
    const chunk = numbers.slice(i, i + 5);
    paras.push([chunk[0], chunk[chunk.length - 1]]);
  }
  return [{ en: null, zh: null, paras }];
}

function buildSide(verseNums, texts, joiner) {
  let text = '';
  const verses = [];
  verseNums.forEach((n, i) => {
    const body = texts[n] || '';
    if (i > 0 && text) text += joiner;
    const off = text.length;
    text += body;
    verses.push({ n, off, end: text.length });
  });
  return { text, verses };
}

export async function getChapter(bookId, chapter) {
  const key = chapterKey(bookId, chapter);
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const [esv, web, zh] = await Promise.all([
      fetchEnglishOverride(bookId, chapter),
      getJSON(`${API}/web/${bookId}/${chapter}`).catch(() => ({ verses: [] })),
      getJSON(`${API}/cuv/${bookId}/${chapter}`).catch(() => ({ verses: [] })),
    ]);
    const source = esv ? 'ESV' : 'WEB';
    const en = esv ? { verses: esv } : web;
    const enText = {}, zhText = {};
    const seen = new Set();
    (en.verses || []).forEach(v => { enText[v.verse] = cleanEn(v.text); seen.add(v.verse); });
    (zh.verses || []).forEach(v => { zhText[v.verse] = cleanZh(v.text); seen.add(v.verse); });
    const numbers = [...seen].sort((a, b) => a - b);
    if (!numbers.length) throw new Error('empty chapter');

    const book = BY_ID[bookId];
    const blocks = [{ type: 'title', id: key + '/title', text: `${book.name} ${chapter}`, zhText: `${book.zh} 第${chapter}章` }];
    let pi = 0;
    structureFor(bookId, chapter, numbers).forEach((sec, si) => {
      if (sec.en) blocks.push({ type: 'heading', id: `${key}/h${si}`, en: sec.en, zh: sec.zh });
      sec.paras.forEach(([vs, ve]) => {
        const nums = numbers.filter(n => n >= vs && n <= ve);
        if (!nums.length) return;
        blocks.push({
          type: 'para', id: `${key}/p${pi++}`, key, bookId, chapter,
          vs: nums[0], ve: nums[nums.length - 1],
          en: buildSide(nums, enText, ' '),
          zh: buildSide(nums, zhText, ''),
        });
      });
    });
    const data = { key, bookId, chapter, source, label: `${book.name} ${chapter}`, zhLabel: `${book.zh} ${chapter}`, numbers, enText, zhText, blocks };
    cache.set(key, data);
    trimEsvCache();
    inflight.delete(key);
    return data;
  })();
  inflight.set(key, job);
  job.catch(() => inflight.delete(key));
  return job;
}

export function cachedChapters() { return [...cache.values()]; }

/* ---------- reference parsing ---------- */
const CJK = /[㐀-鿿]/;

export function parseReference(raw) {
  let q = String(raw || '').trim();
  if (!q) return null;
  if (CJK.test(q)) {
    const s = t2s(q).replace(/[：﹕]/g, ':').replace(/\s+/g, '');
    const m = s.match(/^([㐀-鿿]+?)(\d+)(?:[章篇]?[:第]?(\d+))?[章篇节節]*$/)
      || s.match(/^([㐀-鿿]+?)(\d+)(?:[章篇]?[:第]?(\d+))?/);
    if (!m) return null;
    const name = m[1];
    let hit = null;
    for (const id of ORDER) {
      const zh = BY_ID[id].zh;
      if (zh === name) { hit = id; break; }
      if (!hit && (name.startsWith(zh) || zh.startsWith(name)) && name.length >= 2) hit = id;
    }
    if (!hit) return null;
    return clampRef(hit, +m[2], m[3] ? +m[3] : null);
  }
  const m = q.match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*?)\s*\.?\s+?(\d+)(?:\s*[:.v]\s*(\d+))?\s*$/i)
    || q.match(/^((?:[1-3]\s*)?[A-Za-z][A-Za-z\s.]*?)(\d+)(?:\s*[:.]\s*(\d+))?\s*$/i);
  if (!m) return null;
  const id = slugToBook(m[1]);
  if (!id) return null;
  return clampRef(id, +m[2], m[3] ? +m[3] : null);
}

function clampRef(bookId, chapter, verse) {
  const b = BY_ID[bookId];
  return { bookId, chapter: Math.min(Math.max(1, chapter || 1), b.chapters), verse: verse || null };
}

export function refLabel(bookId, chapter, vs, ve) {
  const b = BY_ID[bookId];
  const v = !vs ? '' : (ve && ve !== vs ? `:${vs}–${ve}` : `:${vs}`);
  return `${b.name} ${chapter}${v}`;
}
export function refLabelZh(bookId, chapter, vs, ve) {
  const b = BY_ID[bookId];
  const v = !vs ? '' : (ve && ve !== vs ? `:${vs}–${ve}` : `:${vs}`);
  return `${b.zh} ${chapter}${v}`;
}

/* ---------- keyword search ---------- */
function snippet(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n).trim() + '…' : t;
}

function searchCache(query) {
  const isCJK = CJK.test(query);
  const needle = isCJK ? t2s(query).replace(/\s+/g, '') : query.toLowerCase();
  const out = [];
  for (const ch of cache.values()) {
    for (const n of ch.numbers) {
      const en = ch.enText[n] || '', zh = ch.zhText[n] || '';
      const hay = isCJK ? zh : en.toLowerCase();
      if (hay && hay.includes(needle)) {
        out.push({
          bookId: ch.bookId, chapter: ch.chapter, verse: n,
          ref: refLabel(ch.bookId, ch.chapter, n), refZh: refLabelZh(ch.bookId, ch.chapter, n),
          en: snippet(en, 150), zh: snippet(zh, 60),
        });
      }
      if (out.length >= 40) break;
    }
  }
  return out;
}

export async function keywordSearch(query, limit = 8) {
  const q = String(query || '').trim();
  if (q.length < 2) return { results: [], scope: 'none' };
  const local = searchCache(q);
  if (CJK.test(q)) {
    return { results: local.slice(0, limit), scope: 'cache' };
  }
  let remote = [];
  try {
    const j = await getJSON(`${SEARCH_API}?q=${encodeURIComponent(q)}&translation=asv&limit=24`);
    remote = (j.results || []).filter(r => BY_ID[r.book_id]).slice(0, limit);
  } catch (e) { /* fall back to cache-only */ }
  if (!remote.length) return { results: local.slice(0, limit), scope: local.length ? 'cache' : 'empty' };

  const keys = [...new Set(remote.map(r => chapterKey(r.book_id, r.chapter)))].slice(0, 6);
  await Promise.all(keys.map(k => {
    const [b, c] = k.split('/');
    return getChapter(b, +c).catch(() => null);
  }));
  return {
    scope: 'canon',
    results: remote.map(r => {
      const ch = cache.get(chapterKey(r.book_id, r.chapter));
      return {
        bookId: r.book_id, chapter: r.chapter, verse: r.verse,
        ref: refLabel(r.book_id, r.chapter, r.verse), refZh: refLabelZh(r.book_id, r.chapter, r.verse),
        en: snippet(ch ? ch.enText[r.verse] : cleanEn(r.text), 150),
        zh: snippet(ch ? ch.zhText[r.verse] : '', 60),
      };
    }),
  };
}
