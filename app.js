/* OG3 Draco — one script, shared by all four pages.
   Each page runs only the bits its markup asks for. */

// ── config ────────────────────────────────────────────────────────────────
const SHEET_ID = '1YLUb8mV-QYrMMCLwyEXLeYJINz9_ZIfPFW9Qq1a-dms';

// ── sheet loading ─────────────────────────────────────────────────────────
// gviz answers with JSON wrapped in google.visualization.Query.setResponse(...)
// so we slice the wrapper off rather than hand-rolling a CSV parser.
async function sheet(tab) {
  const key = 'og3:' + tab;
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${tab}`;
    const txt = await (await fetch(url)).text();
    const t = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1)).table;
    const cols = t.cols.map(c => (c.label || '').trim().toLowerCase());
    const rows = t.rows.map(r => {
      const o = { _cells: [] };
      (r.c || []).forEach((cell, i) => {
        const v = cell ? (cell.v ?? '') : '';
        o._cells.push(v);
        if (cols[i]) o[cols[i]] = v;
      });
      o._cols = cols;
      if (o.instargram && !o.instagram) o.instagram = o.instargram;  // sheet header typo
      return o;
    });
    store(key, rows);
    return { rows, stale: false };
  } catch (e) {
    const cached = store(key);          // last good copy beats a blank page
    if (cached) return { rows: cached, stale: true };
    throw e;
  }
}

// localStorage throws outright in some private-browsing contexts
function store(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null');
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) { return null; }
}

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const inits = n => String(n).trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();

// A Google Drive share link is not an image URL — pasting one into an <img> serves
// a viewer page, not a photo. So pull the file id out and point at lh3, which is
// where Drive actually stores the bytes. Going via drive.google.com/thumbnail
// instead works from curl but 302s to lh3 and gets 429 rate-limited in a browser.
// Anything else is passed through, covering a direct .jpg/.png link from anywhere.
function photoUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{20,})/.exec(s)
    || /^([\w-]{25,})$/.exec(s);
  return m ? `https://lh3.googleusercontent.com/d/${m[1]}=w600` : s;
}

function avatar(name, photo, cls = '') {
  const src = photoUrl(photo);
  const fallback = `<div class="avatar initials ${cls}">${esc(inits(name))}</div>`;
  return src
    ? `<img class="avatar ${cls}" loading="lazy" alt="" src="${esc(src)}"
         onerror="this.outerHTML='${fallback.replace(/"/g, '&quot;')}'">`
    : fallback;
}

// Date cells come back as "Date(2003,2,12)" with a ZERO-indexed month — read it
// naively and every birthday shifts back a month.
function birthday(v) {
  if (!v) return '';
  const m = /^Date\((\d+),(\d+),(\d+)\)/.exec(String(v));
  const d = m ? new Date(+m[1], +m[2], +m[3]) : new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function openNote(name, text) {
  const d = $('#note-sheet');
  d.querySelector('h2').textContent = name;
  d.querySelector('p').textContent = text;
  d.showModal();
}

function stale(on) { $('#notice')?.classList.toggle('show', !!on); }
function fail(el, msg) { el.innerHTML = `<div class="state">${dracoSVG(84)}<p>${msg}</p></div>`; }
function dracoSVG(px) { return `<img class="draco" src="assets/brand/dragon.svg" width="${px}" height="${px}" alt="">`; }

// ── members ───────────────────────────────────────────────────────────────
async function members() {
  const box = $('#members');
  let rows;
  try { const r = await sheet('members'); rows = r.rows; stale(r.stale); }
  catch { return fail(box, '载入不到成员名单 — check your connection'); }

  const note = m => String(m.notes || m.note || '').trim();
  const ig = m => m.instagram ? `<a class="ig" target="_blank" rel="noopener"
        href="https://instagram.com/${esc(String(m.instagram).replace(/^@/, ''))}">@${esc(String(m.instagram).replace(/^@/, ''))}</a>` : '';
  // The back face clamps to a few lines; anything longer gets a button that
  // reopens the whole note in a dialog, where there is room for it.
  const moreBtn = (m, n, label) =>
    `<button class="more-btn" data-name="${esc(m.name)}" data-note="${esc(n)}">${label}</button>`;

  const card = m => {
    const n = note(m);
    return `<div class="card m-card${n ? ' flip' : ''}"${n ? ` tabindex="0" role="button" aria-label="${esc(m.name)} — 笔记 notes"` : ''}>
      <div class="face front">
        ${avatar(m.name, m.photos || m.photo)}
        <div class="name">${esc(m.name)}${n ? ' 📝' : ''}</div>
        <div class="meta">${esc(m.hall || '')}</div>
        <div style="margin:6px 0 4px"><span class="badge">${esc(m.mbti || '—')}</span></div>
        <div class="meta">🎂 ${esc(birthday(m.birthday))}</div>
        ${ig(m)}
      </div>
      ${n ? `<div class="face back">
        <div class="name">${esc(m.name)}</div>
        <p class="note-text">${esc(n)}</p>
        ${moreBtn(m, n, '查看全部 More')}
      </div>` : ''}
    </div>`;
  };

  const row = m => {
    const n = note(m);
    return `<div class="row">
      <div class="name">${esc(m.name)} <span class="badge">${esc(m.mbti || '—')}</span></div>
      <div class="meta">${esc(m.hall || '')} · 🎂 ${esc(birthday(m.birthday))}${m.instagram ? ' · ' : ''}${ig(m)}</div>
      ${n ? moreBtn(m, n, esc(n)) : ''}
    </div>`;
  };

  // One delegated handler: the More button opens the dialog, anything else on a
  // card flips it. Links keep their own behaviour.
  box.onclick = e => {
    const more = e.target.closest('.more-btn');
    if (more) return openNote(more.dataset.name, more.dataset.note);
    if (e.target.closest('a')) return;
    e.target.closest('.flip')?.classList.toggle('flipped');
  };
  box.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.flip');
    if (c && c === e.target) { e.preventDefault(); c.classList.toggle('flipped'); }
  };

  const draw = v => {
    box.className = v === 'list' ? 'card list' : 'grid';
    box.innerHTML = rows.map(v === 'list' ? row : card).join('');
    // The clamp is CSS, so only the browser knows whether it actually bit —
    // ask it, and hide the "More" button on notes that already fit.
    box.querySelectorAll('.face.back .note-text').forEach(p =>
      p.nextElementSibling.hidden = p.scrollHeight <= p.clientHeight + 1);
    document.querySelectorAll('.viewswitch button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    store('og3:view', v);
  };

  document.querySelectorAll('.viewswitch button').forEach(b =>
    b.onclick = () => draw(b.dataset.view));
  draw(store('og3:view') || 'grid');
}

// ── leaderboards ──────────────────────────────────────────────────────────
async function board(tab, el) {
  let rows;
  try { const r = await sheet(tab); rows = r.rows; stale(r.stale); }
  catch { return fail(el, '载入不到 — check your connection'); }

  rows = rows.filter(r => r.name);
  if (!rows.length) return fail(el, '还没有分数 — nobody on the board yet');

  // 最UPZ is ranked by hand (a Rank column, 1 = best); Pokémon GO is scored
  // (highest wins). One board type each, decided by which column the tab has.
  const ranked = rows.some(r => r.rank !== undefined && r.rank !== '');
  rows.sort(ranked
    ? (a, b) => (+a.rank || 1e9) - (+b.rank || 1e9)
    : (a, b) => (+b.score || 0) - (+a.score || 0));

  const medal = ['🥇', '🥈', '🥉'];
  el.innerHTML = '<ol>' + rows.map((r, i) => {
    const pos = ranked ? (+r.rank || i + 1) : i + 1;
    return `<li class="${pos <= 3 ? 'top' : ''}">
      <span class="rank">${pos <= 3 ? medal[pos - 1] : pos}</span>
      <span class="who">${esc(r.name)}${r.note ? `<span class="note">${esc(r.note)}</span>` : ''}</span>
      ${ranked ? '' : `<span class="score">${esc(r.score)}</span>`}
    </li>`;
  }).join('') + '</ol>';
}

// ── attendance ────────────────────────────────────────────────────────────
// Tick or cross. A Sheets checkbox gives TRUE/FALSE, which is the easiest thing to
// tap on a phone mid-event; the rest are what people type by hand instead.
const PRESENT = ['true', '1', 'y', 'yes', '✓', '✔', '☑', '是', 'p'];
function mark(v) {
  return PRESENT.includes(String(v ?? '').trim().toLowerCase()) ? 'yes' : 'no';
}

async function attendance() {
  const box = $('#attendance');
  let rows, events, pics = {};
  try {
    const m = await sheet('members');
    m.rows.forEach(r => r.name && (pics[String(r.name).trim()] = r.photos || r.photo));
  } catch { /* attendance still works without portraits */ }
  try {
    const r = await sheet('attendance'); stale(r.stale);
    rows = r.rows;
    const labels = (rows[0]?._cols || []).slice(1);
    if (labels.some(Boolean)) {
      events = labels;                                   // A1 had text: real headers
    } else {
      events = (rows[0]?._cells || []).slice(1);         // A1 blank: row 1 is the header
      rows = rows.slice(1);
    }
    events = events.map((e, i) => e || `Event ${i + 1}`);
  } catch { return fail(box, '载入不到出席记录 — check your connection'); }

  rows = rows.filter(r => r._cells[0]);
  if (!rows.length) return fail(box, '还没有记录 — no events logged yet');

  const people = rows.map(r => {
    const name = r._cells[0];
    const marks = events.map((_, i) => mark(r._cells[i + 1]));
    const went = marks.filter(m => m !== 'no').length;
    return { name, marks, went, pct: events.length ? Math.round(went / events.length * 100) : 0 };
  }).sort((a, b) => b.went - a.went);

  box.innerHTML = people.map(p => `<details>
      <summary>
        ${avatar(p.name, pics[String(p.name).trim()])}
        <span><span class="name">${esc(p.name)}</span>
          <span class="bar"><i style="width:${p.pct}%"></i></span></span>
        <span class="pct">${p.went}/${events.length}<br><small>${p.pct}%</small></span>
      </summary>
      <div class="events">${events.map((e, i) =>
        `<span class="ev ${p.marks[i]}">${esc(e)}</span>`).join('')}</div>
    </details>`).join('');

  // full matrix lives behind the toggle, scrolling inside its own box
  $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th>成员</th>${
    events.map(e => `<th>${esc(e)}</th>`).join('')}</tr></thead><tbody>${
    people.map(p => `<tr><td>${esc(p.name)}</td>${
      p.marks.map(m => `<td>${m === 'yes' ? '✅' : m === 'late' ? '🕒' : '·'}</td>`).join('')
    }</tr>`).join('')}</tbody></table>`;

  $('#toggle-matrix').onclick = e => {
    const on = $('#matrix-wrap').hasAttribute('hidden');
    $('#matrix-wrap').toggleAttribute('hidden', !on);
    e.target.textContent = on ? '收起 Hide full grid' : '看全表 Full grid';
  };
}

// ── photos ────────────────────────────────────────────────────────────────
// 今日精选: a random 20 rebuilt nightly by the GitHub Action. Grid uses the
// thumbnail; the lightbox pulls full size only for the photo actually opened.
async function photos() {
  const box = $('#photos');
  let list = [];
  try { list = await (await fetch('photos/manifest.json')).json(); } catch { }
  if (!list.length) return fail(box, '还没有相片 — run tools/sync_photos.py --random 20');

  box.innerHTML = list.map((p, i) =>
    `<button data-i="${i}"><img loading="lazy" alt="" width="${p.width}" height="${p.height}"
       src="photos/${esc(p.thumb)}"></button>`).join('');

  const dlg = $('#lightbox'), img = dlg.querySelector('img');
  let at = 0, timer = null;
  const show = i => { at = (i + list.length) % list.length; img.src = 'photos/' + list[at].file; };

  box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    show(+b.dataset.i); dlg.showModal();
  };
  $('#prev').onclick = () => show(at - 1);
  $('#next').onclick = () => show(at + 1);
  $('#play').onclick = e => {
    if (timer) { clearInterval(timer); timer = null; e.target.textContent = '▶'; }
    else { timer = setInterval(() => show(at + 1), 2200); e.target.textContent = '⏸'; }
  };
  dlg.onclose = () => { clearInterval(timer); timer = null; $('#play').textContent = '▶'; };
}

// ── add to home screen / share ────────────────────────────────────────────
function install() {
  const btn = $('#install'); if (!btn) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let prompt = null;

  addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; btn.hidden = false; });

  // iOS gives no install API at all, so the button opens instructions instead.
  btn.hidden = !(ios && !standalone);
  btn.onclick = () => prompt ? prompt.prompt() : $('#install-sheet').showModal();
  $('#install-close')?.addEventListener('click', () => $('#install-sheet').close());
  $('#note-close')?.addEventListener('click', () => $('#note-sheet').close());

  $('#share').onclick = async () => {
    const data = { title: 'OG3 Draco', url: location.origin + location.pathname };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(data.url); $('#share').textContent = '✓'; }
    } catch (e) { /* user dismissed the share sheet */ }
  };
}

// ── boot ──────────────────────────────────────────────────────────────────
addEventListener('DOMContentLoaded', () => {
  const here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav a').forEach(a =>
    a.getAttribute('href') === here && a.setAttribute('aria-current', 'page'));
  install();
  if ($('#members')) members();
  if ($('#upz')) { board('upz', $('#upz')); board('pokemon', $('#pokemon')); }
  if ($('#attendance')) attendance();
  if ($('#photos')) photos();
});
