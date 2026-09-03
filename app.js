/* OG3 Draco — one script, shared by all four pages.
   Each page runs only the bits its markup asks for. */

// ── config ────────────────────────────────────────────────────────────────
const SHEET_ID = '1YLUb8mV-QYrMMCLwyEXLeYJINz9_ZIfPFW9Qq1a-dms';

// ── sheet loading ─────────────────────────────────────────────────────────
// gviz answers with JSON wrapped in google.visualization.Query.setResponse(...)
// so we slice the wrapper off rather than hand-rolling a CSV parser.
async function sheetText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Sheet request failed (${response.status})`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function sheet(tab) {
  const key = 'og3:' + tab;
  const cached = store(key);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}`;
  try {
    let txt;
    try {
      txt = await sheetText(url, cached ? 5000 : 8000);
    } catch (firstError) {
      // Google occasionally leaves a gviz request pending. Retry once with a
      // cache-buster; both attempts are bounded so the UI can never spin forever.
      txt = await sheetText(`${url}&_=${Date.now()}`, cached ? 3000 : 6000);
    }
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('Invalid Sheet response');
    const t = JSON.parse(txt.slice(start, end + 1)).table;
    if (!t?.cols || !t?.rows) throw new Error('Missing Sheet table');
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
    console.warn(`[sheet:${tab}] live data unavailable`, e);
    if (cached) return { rows: cached, stale: true }; // last good copy beats a blank page
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
const nameKey = n => String(n ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const points = r => r.score ?? r.marks ?? r.points ?? r.total ?? '';

// Prefer the sheet's explicit Rank column so ties remain exactly as the editor
// intended. If a board has no Rank column, everyone tied at the highest score wins.
function winners(rows) {
  const valid = rows.filter(r => r.name);
  const ranked = valid.filter(r => r.rank !== undefined && r.rank !== '');
  if (ranked.length) {
    const best = Math.min(...ranked.map(r => +r.rank || Infinity));
    return new Set(ranked.filter(r => +r.rank === best).map(r => nameKey(r.name)));
  }
  const best = Math.max(...valid.map(r => +points(r) || 0));
  return new Set(valid.filter(r => (+points(r) || 0) === best).map(r => nameKey(r.name)));
}

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
  if (!d) return;
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
  let rows, upzWinners = new Set(), pokemonWinners = new Set();
  try {
    const memberResult = await sheet('members');
    rows = memberResult.rows;
    stale(memberResult.stale);

    // The spreadsheet formulas are authoritative for both boards. The UPZ tab
    // already contains only OGM members, so the website does not filter it again.
    try { upzWinners = winners((await sheet('upz')).rows); } catch { }
    try { pokemonWinners = winners((await sheet('pokemon')).rows); } catch { }
  }
  catch { return fail(box, '载入不到成员名单 — check your connection'); }

  const note = m => String(m.notes || m.note || '').trim();
  const ig = m => m.instagram ? `<a class="ig" target="_blank" rel="noopener"
        href="https://instagram.com/${esc(String(m.instagram).replace(/^@/, ''))}">@${esc(String(m.instagram).replace(/^@/, ''))}</a>` : '';
  // The back face clamps to a few lines; anything longer gets a button that
  // reopens the whole note in a dialog, where there is room for it.
  const moreBtn = (m, n, label) =>
    `<button class="more-btn" data-name="${esc(m.name)}" data-note="${esc(n)}">${label}</button>`;

  const championDecorations = m => {
    const key = nameKey(m.name);
    const isUpzKing = upzWinners.has(key);
    const isPokemonKing = pokemonWinners.has(key);
    const champion = `${isUpzKing ? ' upz-champion' : ''}${isPokemonKing ? ' pokemon-champion' : ''}${isUpzKing && isPokemonKing ? ' dual-champion' : ''}`;
    return {
      champion,
      title: `<span class="champion-name${champion}">
      ${isUpzKing ? '<span class="champ-icon fire" title="UPZ King" aria-label="UPZ King">🔥</span>' : ''}
      <span>${esc(m.name)}</span>
      ${isPokemonKing ? '<span class="champ-icon crown" title="Pokémon King" aria-label="Pokémon King">👑</span>' : ''}
    </span>`,
      titles: isUpzKing || isPokemonKing ? `<div class="member-titles">
      ${isUpzKing ? '<span class="member-title upz-title">🔥 UPZ King</span>' : ''}
      ${isPokemonKing ? '<span class="member-title pokemon-title">👑 Pokémon King</span>' : ''}
    </div>` : ''
    };
  };

  const card = m => {
    const n = note(m);
    const decoration = championDecorations(m);
    return `<div class="card m-card${n ? ' flip' : ''}${decoration.champion}"${n ? ` tabindex="0" role="button" aria-expanded="false" aria-label="${esc(m.name)} — 笔记 notes"` : ''}>
      <div class="face front">
        ${avatar(m.name, m.photos || m.photo)}
        <div class="name">${decoration.title}${n ? '<span class="note-mark" aria-label="Has notes">📝</span>' : ''}</div>
        ${decoration.titles}
        ${m.role ? `<div class="member-role">${esc(m.role)}</div>` : ''}
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
    const decoration = championDecorations(m);
    return `<div class="row${decoration.champion}">
      <div class="name">${decoration.title} ${m.role ? `<span class="badge role-badge">${esc(m.role)}</span>` : ''} <span class="badge">${esc(m.mbti || '—')}</span></div>
      ${decoration.titles}
      <div class="meta">${esc(m.hall || '')} · 🎂 ${esc(birthday(m.birthday))}${m.instagram ? ' · ' : ''}${ig(m)}</div>
      ${n ? moreBtn(m, n, esc(n)) : ''}
    </div>`;
  };

  // One delegated handler: the More button opens the dialog, anything else on a
  // card flips it. Links keep their own behaviour.
  const toggleCard = card => {
    const open = card.classList.toggle('flipped');
    card.setAttribute('aria-expanded', String(open));
  };

  box.onclick = e => {
    const more = e.target.closest('.more-btn');
    if (more) return openNote(more.dataset.name, more.dataset.note);
    if (e.target.closest('a')) return;
    const card = e.target.closest('.flip');
    if (card) toggleCard(card);
  };
  box.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const c = e.target.closest('.flip');
    if (c && c === e.target) { e.preventDefault(); toggleCard(c); }
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

  const ranked = rows.some(r => r.rank !== undefined && r.rank !== '');
  rows.sort(ranked
    ? (a, b) => (+a.rank || 1e9) - (+b.rank || 1e9)
    : (a, b) => (+points(b) || 0) - (+points(a) || 0));

  const icon = tab === 'pokemon' ? '👑' : '🔥';
  const kingClass = tab === 'pokemon' ? 'pokemon-leader' : 'upz-leader';
  const kingTitle = tab === 'pokemon' ? 'Pokémon King' : 'UPZ King';
  el.innerHTML = '<div class="board-labels"><span>Rank</span><span>Name</span><span>Score</span></div><ol>' + rows.map((r, i) => {
    const pos = ranked ? (+r.rank || i + 1) : i + 1;
    const note = String(r.note ?? '').trim();
    return `<li class="${pos <= 3 ? 'top' : ''}${pos === 1 ? ` ${kingClass}` : ''}">
      <span class="rank">#${esc(pos)}</span>
      <span class="who">
        <span class="leader-name">${pos === 1 && tab === 'upz' ? `<span aria-hidden="true">${icon}</span>` : ''}<span>${esc(r.name)}</span>${pos === 1 && tab === 'pokemon' ? `<span aria-hidden="true">${icon}</span>` : ''}</span>
        ${pos === 1 ? `<span class="leader-title">${icon} ${kingTitle}</span>` : ''}
        ${note ? `<button class="board-note" data-name="${esc(r.name)} · ${tab === 'pokemon' ? 'Pokémon GO' : '最UPZ'}" data-note="${esc(note)}" aria-label="View full note for ${esc(r.name)}"><span class="note-copy">${esc(note)}</span><b>… 查看详情</b></button>` : ''}
      </span>
      <span class="score"><strong>${esc(points(r))}</strong><small>pts</small></span>
    </li>`;
  }).join('') + '</ol>';

  el.onclick = e => {
    const note = e.target.closest('.board-note');
    if (note) openNote(note.dataset.name, note.dataset.note);
  };
}

// ── attendance ────────────────────────────────────────────────────────────
const DEFAULT_RULES = `IMPORTANT NOTICE ‼️‼️
- 最UPZ 排行榜 如果自己jio +3分
- 参加OGM 的OG jio +2分
- 参加OGL/COM 的OG jio +1分
- 如果我没有算对你的分数，可以来PM我`;

async function attendance() {
  const box = $('#attendance');
  const rulesBox = $('#attendance-rules');
  let rows, columns, pics = {}, upzWinners = new Set(), pokemonWinners = new Set();

  const [rulesResult, membersResult, upzResult, pokemonResult, attendanceResult] = await Promise.allSettled([
    sheet('Rules'), sheet('members'), sheet('upz'), sheet('pokemon'), sheet('attendance')
  ]);

  if (rulesResult.status === 'fulfilled') {
    const ruleText = rulesResult.value.rows.flatMap(row => row._cells).map(String).find(Boolean);
    rulesBox.querySelector('p').textContent = (ruleText || DEFAULT_RULES)
      .replace(/^IMPORTANT NOTICE[^\n]*\n?/i, '').trim();
  } else {
    rulesBox.querySelector('p').textContent = DEFAULT_RULES
      .replace(/^IMPORTANT NOTICE[^\n]*\n?/i, '').trim();
  }

  if (membersResult.status === 'fulfilled') membersResult.value.rows.forEach(r =>
    r.name && (pics[String(r.name).trim()] = r.photos || r.photo));
  if (upzResult.status === 'fulfilled') upzWinners = winners(upzResult.value.rows);
  if (pokemonResult.status === 'fulfilled') pokemonWinners = winners(pokemonResult.value.rows);
  if (attendanceResult.status !== 'fulfilled') return fail(box, '载入不到出席记录 — check your connection');

  stale(attendanceResult.value.stale);
  rows = attendanceResult.value.rows;
  columns = (rows[0]?._cols || []).map((label, index) => ({ label, index })).filter(c => c.label);

  rows = rows.filter(r => r._cells[0]);
  if (!rows.length) return fail(box, '还没有记录 — no events logged yet');

  // Spreadsheet formulas are authoritative: A name, B weighted attendance score,
  // C attendance rate, D OGL bonus, E+ event values. The website only formats them.
  const totalColumn = columns.find(c => c.index === 1)
    || columns.find(c => /total.*score|score.*total/i.test(c.label));
  const rateColumn = columns.find(c => c.index === 2)
    || columns.find(c => /attendance.*rate/i.test(c.label));
  const bonusColumn = columns.find(c => c.index === 3)
    || columns.find(c => /ogl.*bonus/i.test(c.label));
  const eventColumns = columns.filter(c => c.index >= 4);
  const number = v => Number.isFinite(+v) ? +v : 0;
  const rateDisplay = value => {
    const n = number(value);
    const pct = Math.abs(n) <= 1 ? n * 100 : n;
    return `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(pct)}%`;
  };
  const people = rows.map(r => {
    const name = r._cells[0];
    const events = eventColumns.map(c => ({ label: c.label, value: number(r._cells[c.index]) }));
    const bonus = bonusColumn ? number(r._cells[bonusColumn.index]) : 0;
    const total = totalColumn ? number(r._cells[totalColumn.index]) : 0;
    const rate = rateColumn ? number(r._cells[rateColumn.index]) : 0;
    const barPct = Math.max(0, Math.min(100, Math.abs(rate) <= 1 ? rate * 100 : rate));
    const key = nameKey(name);
    const isUpzKing = upzWinners.has(key);
    const isPokemonKing = pokemonWinners.has(key);
    const champion = `${isUpzKing ? ' upz-champion' : ''}${isPokemonKing ? ' pokemon-champion' : ''}${isUpzKing && isPokemonKing ? ' dual-champion' : ''}`;
    return { name, events, bonus, total, rate, barPct, isUpzKing, isPokemonKing, champion };
  });

  box.innerHTML = people.map(p => `<details class="${p.champion.trim()}">
      <summary>
        ${avatar(p.name, pics[String(p.name).trim()])}
        <span class="att-person"><span class="name"><span class="champion-name${p.champion}">
          ${p.isUpzKing ? '<span class="champ-icon fire" aria-hidden="true">🔥</span>' : ''}
          <span>${esc(p.name)}</span>
          ${p.isPokemonKing ? '<span class="champ-icon crown" aria-hidden="true">👑</span>' : ''}
        </span></span>
          ${p.isUpzKing || p.isPokemonKing ? `<span class="att-king-titles">
            ${p.isUpzKing ? '<span class="member-title upz-title">🔥 UPZ King</span>' : ''}
            ${p.isPokemonKing ? '<span class="member-title pokemon-title">👑 Pokémon King</span>' : ''}
          </span>` : ''}
          <span class="bar"><i style="width:${p.barPct}%"></i></span></span>
        <span class="att-rate"><strong>${rateDisplay(p.rate)}</strong><small>Attendance</small></span>
        <span class="att-score"><strong>${esc(p.total)}</strong><small>${p.total === 1 ? 'pt' : 'pts'}</small></span>
      </summary>
      <div class="events">
        <span class="ev metric"><span>Total score</span><strong>${esc(p.total)}</strong></span>
        <span class="ev metric"><span>Attendance rate</span><strong>${rateDisplay(p.rate)}</strong></span>
        <span class="ev metric"><span>OGL bonus</span><strong>${p.bonus ? `+${esc(p.bonus)}` : '—'}</strong></span>
        ${p.events.map(item =>
          `<span class="ev ${item.value ? 'yes' : 'zero'}"><span>${esc(item.label)}</span><strong>${item.value ? `+${esc(item.value)}` : '—'}</strong></span>`).join('')}
      </div>
    </details>`).join('');

  // full matrix lives behind the toggle, scrolling inside its own box
  $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th>成员 Name</th><th>Total attendance score</th><th>Attendance rate</th><th>OGL bonus</th>${
    eventColumns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
    people.map(p => `<tr class="${p.champion.trim()}"><td>${p.isUpzKing ? '🔥 ' : ''}${esc(p.name)}${p.isPokemonKing ? ' 👑' : ''}</td><td><strong>${esc(p.total)}</strong></td><td>${rateDisplay(p.rate)}</td><td>${p.bonus || '·'}</td>${
      p.events.map(item => `<td>${item.value ? esc(item.value) : '·'}</td>`).join('')
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
    `<button type="button" data-i="${i}" aria-label="Open photo ${i + 1}"><img loading="lazy" alt="" width="${p.width}" height="${p.height}"
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
    if (timer) {
      clearInterval(timer); timer = null; e.target.textContent = '▶';
      e.target.setAttribute('aria-label', 'Play slideshow');
    }
    else {
      timer = setInterval(() => show(at + 1), 2200); e.target.textContent = '⏸';
      e.target.setAttribute('aria-label', 'Pause slideshow');
    }
  };
  dlg.onclose = () => {
    clearInterval(timer); timer = null; $('#play').textContent = '▶';
    $('#play').setAttribute('aria-label', 'Play slideshow');
  };
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
