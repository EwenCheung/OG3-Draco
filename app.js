/* OG3 Draco — one script, shared by all five pages.
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
const pinyinCollator = new Intl.Collator(['zh-Hans-u-co-pinyin', 'en'], {
  sensitivity: 'base', numeric: true
});

// Existing English/pinyin names sort directly. If a Chinese display name is
// added later, an optional Pinyin / SortName sheet column keeps the order
// explicit without changing what visitors see on the card.
const memberSortName = member => String(
  member.sortname ?? member.sort_name ?? member.pinyin ?? member.name ?? ''
).trim();

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

// Date cells come back as "Date(2003,2,12)" with a ZERO-indexed month. Keep
// month/day as plain numbers so sorting and the homepage banner share exactly
// the same timezone-safe interpretation.
function birthdayParts(value) {
  if (!value) return null;
  if (typeof value === 'object' && value.month && value.day) {
    const month = Number(value.month), day = Number(value.day);
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
  }

  const text = String(value).trim();
  const googleDate = /^Date\((\d+),(\d+),(\d+)\)/.exec(text);
  if (googleDate) return { month: Number(googleDate[2]) + 1, day: Number(googleDate[3]) };

  const isoDate = /^(?:\d{4}-)?(\d{1,2})-(\d{1,2})(?:$|T)/.exec(text);
  if (isoDate) return { month: Number(isoDate[1]), day: Number(isoDate[2]) };

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime())
    ? null
    : { month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function birthday(value) {
  const parts = birthdayParts(value);
  if (!parts) return value ? String(value) : '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2000, parts.month - 1, parts.day)));
}

function compareMembers(a, b, mode = 'name') {
  if (mode === 'birthday') {
    const aBirthday = birthdayParts(a.birthday);
    const bBirthday = birthdayParts(b.birthday);
    if (aBirthday && bBirthday) {
      const dateOrder = aBirthday.month - bBirthday.month || aBirthday.day - bBirthday.day;
      if (dateOrder) return dateOrder;
    } else if (aBirthday || bBirthday) {
      return aBirthday ? -1 : 1;
    }
  }
  return pinyinCollator.compare(memberSortName(a), memberSortName(b));
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
function dracoSVG(px) { return `<img class="draco" src="assets/brand/icon-192.png" width="${px}" height="${px}" alt="">`; }

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
  const role = m => {
    const value = String(m.role || '').trim();
    const memberName = nameKey(m.name);
    if (/^ogl$/i.test(value)) return 'OGL';
    if (memberName === 'wan hao' || memberName === 'ying tong') return 'SW';
    if (/senior|\bsw\b/i.test(value)) return 'COM';
    if (/\bcom\b/i.test(value)) return 'COM';
    if (/ff/i.test(value)) return 'FF';
    if (/^ogm$/i.test(value)) return 'OGM';
    return value;
  };
  const ig = m => m.instagram ? `<a class="ig" target="_blank" rel="noopener"
        href="https://instagram.com/${esc(String(m.instagram).replace(/^@/, ''))}">@${esc(String(m.instagram).replace(/^@/, ''))}</a>` : '';

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

  // Cards stay deliberately concise. Every other existing member field remains
  // available in the detail board opened from the card or compact row.
  const card = (m, index) =>
    `<article class="card m-card member-card">
      <button class="member-open" type="button" aria-haspopup="dialog"
          aria-label="查看 ${esc(m.name)} 的详细资料" data-member="${index}">
        ${avatar(m.name, m.photos || m.photo)}
        <span class="name">${esc(m.name)}</span>
        ${role(m) ? `<span class="member-role">${esc(role(m))}</span>` : ''}
      </button>
      ${ig(m)}
    </article>`;

  const row = (m, index) => `<div class="row member-row">
    <button class="member-open member-row-open" type="button" aria-haspopup="dialog"
        aria-label="查看 ${esc(m.name)} 的详细资料" data-member="${index}">
      ${avatar(m.name, m.photos || m.photo, 'row-avatar')}
      <span class="member-row-copy">
        <span class="name">${esc(m.name)}</span>
        ${role(m) ? `<span class="badge role-badge">${esc(role(m))}</span>` : ''}
      </span>
    </button>
    ${ig(m)}
  </div>`;

  const openMember = m => {
    const dialog = $('#member-sheet');
    const detail = dialog?.querySelector('.member-detail');
    if (!dialog || !detail) return;
    const decoration = championDecorations(m);
    const facts = [
      ['居住地点', m.hall],
      ['MBTI', m.mbti],
      ['生日', birthday(m.birthday)]
    ].filter(([, value]) => value !== undefined && value !== null && String(value).trim());
    detail.innerHTML = `<div class="member-detail-head">
        <div class="member-detail-photo">${avatar(m.name, m.photos || m.photo)}</div>
        <div class="member-detail-title">
          ${role(m) ? `<span class="member-role">${esc(role(m))}</span>` : ''}
          <h2 id="member-detail-title">${esc(m.name)}</h2>
          ${ig(m)}
          ${decoration.titles}
        </div>
      </div>
      ${facts.length ? `<dl class="member-facts">${facts.map(([label, value]) =>
        `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
      ${note(m) ? `<section class="member-detail-note"><h3>成员笔记</h3><p>${esc(note(m))}</p></section>` : ''}`;
    dialog.showModal();
  };

  box.onclick = e => {
    if (e.target.closest('a')) return;
    const item = e.target.closest('[data-member]');
    if (item) openMember(rows[Number(item.dataset.member)]);
  };

  let currentView = store('og3:view') || 'grid';
  let currentSort = store('og3:member-sort') || 'name';

  const draw = v => {
    currentView = v;
    const records = rows
      .map((member, index) => ({ member, index, role: role(member) || '其他' }))
      .sort((a, b) => compareMembers(a.member, b.member, currentSort));
    const preferredRoles = ['OGL', 'SW', 'COM', 'FF', 'OGM'];
    const foundRoles = [...new Set(records.map(record => record.role))];
    const groupOrder = [
      ...preferredRoles.filter(roleName => foundRoles.includes(roleName)),
      ...foundRoles.filter(roleName => !preferredRoles.includes(roleName))
    ];
    const render = v === 'list' ? row : card;

    box.className = `member-groups ${v}-mode`;
    box.innerHTML = groupOrder.map(roleName => {
      const items = records.filter(record => record.role === roleName);
      const roleClass = String(roleName).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `<section class="member-group role-${roleClass}">
        <h3 class="member-group-title"><span>${esc(roleName)}</span></h3>
        <div class="${v === 'list' ? 'card list member-group-list' : 'member-group-grid'}">
          ${items.map(record => render(record.member, record.index)).join('')}
        </div>
      </section>`;
    }).join('');
    document.querySelectorAll('.viewswitch button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    document.querySelectorAll('.sortswitch button').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.memberSort === currentSort)));
    store('og3:view', v);
    store('og3:member-sort', currentSort);
  };

  document.querySelectorAll('.viewswitch button').forEach(b =>
    b.onclick = () => draw(b.dataset.view));
  document.querySelectorAll('.sortswitch button').forEach(b =>
    b.onclick = () => { currentSort = b.dataset.memberSort; draw(currentView); });
  draw(currentView);
}

// ── home memory ───────────────────────────────────────────────────────────
// The app icon remains the Draco mascot. The home-page frame instead chooses
// one image from the photo-wall build each time the site opens.
async function homePhoto() {
  const image = $('#home-photo');
  const frame = image?.closest('.home-photo-frame');
  if (!image || !frame) return;

  try {
    const response = await fetch('photos/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Photo manifest failed (${response.status})`);
    const list = await response.json();
    if (!Array.isArray(list) || !list.length) throw new Error('Photo manifest is empty');

    const memory = list[Math.floor(Math.random() * list.length)];
    const full = `photos/${memory.file}`;
    const thumb = memory.thumb ? `photos/${memory.thumb}` : '';
    image.addEventListener('load', () => frame.classList.add('photo-loaded'), { once: true });
    image.addEventListener('error', () => {
      if (thumb && image.getAttribute('src') !== thumb) image.src = thumb;
      else frame.classList.add('photo-unavailable');
    });
    image.src = full;
  } catch (error) {
    console.warn('[home-photo] random memory unavailable', error);
    frame.classList.add('photo-unavailable');
  }
}

// The homepage and member directory both read the same live Members sheet.
// Only month/day matters, so the banner continues to work when the sheet's
// display year changes and disappears entirely when this month has no match.
async function homeBirthdays(today = new Date()) {
  const banner = $('#birthday-banner');
  if (!banner) return;

  try {
    const result = await sheet('members');
    const currentMonth = today.getMonth() + 1;
    const people = result.rows
      .map(member => ({ member, birthday: birthdayParts(member.birthday) }))
      .filter(person => person.member.name && person.birthday?.month === currentMonth)
      .sort((a, b) => a.birthday.day - b.birthday.day
        || compareMembers(a.member, b.member, 'name'));

    if (!people.length) {
      banner.replaceChildren();
      banner.hidden = true;
      return;
    }

    banner.innerHTML = `<div class="birthday-banner-head">
        <span aria-hidden="true">🎂</span>
        <strong>本月寿星</strong>
        <small>${currentMonth}月</small>
      </div>
      <div class="birthday-list">${people.map(({ member, birthday }) =>
        `<div class="birthday-person">
          ${avatar(member.name, member.photos || member.photo, 'birthday-avatar')}
          <span><strong>${esc(member.name)}</strong><small>${birthday.month}月${birthday.day}日</small></span>
        </div>`).join('')}</div>`;
    banner.hidden = false;
  } catch (error) {
    console.warn('[home-birthdays] member data unavailable', error);
    banner.hidden = true;
  }
}

// ── leaderboards ──────────────────────────────────────────────────────────
async function board(tab, el) {
  const [scoreResult, membersResult] = await Promise.allSettled([sheet(tab), sheet('members')]);
  if (scoreResult.status !== 'fulfilled') return fail(el, '载入不到 — check your connection');

  let rows = scoreResult.value.rows;
  const pics = {};
  if (membersResult.status === 'fulfilled') membersResult.value.rows.forEach(member => {
    if (member.name) pics[nameKey(member.name)] = member.photos || member.photo;
  });
  stale(scoreResult.value.stale);

  rows = rows.filter(r => r.name);
  if (!rows.length) return fail(el, '还没有分数 — nobody on the board yet');

  const ranked = rows.some(r => r.rank !== undefined && r.rank !== '');
  rows.sort(ranked
    ? (a, b) => (+a.rank || 1e9) - (+b.rank || 1e9)
    : (a, b) => (+points(b) || 0) - (+points(a) || 0));

  const icon = tab === 'pokemon' ? '👑' : '🔥';
  const kingClass = tab === 'pokemon' ? 'pokemon-leader' : 'upz-leader';
  const kingTitle = tab === 'pokemon' ? 'Pokémon King' : 'UPZ King';

  const position = (r, i) => ranked ? (+r.rank || i + 1) : i + 1;
  const detailButton = (r, pos, compact = false) => {
    const note = String(r.note ?? '').trim();
    return tab === 'pokemon'
      ? `<button class="board-note detail-only${compact ? ' compact-note' : ''}" type="button" data-name="${esc(r.name)} · Pokémon GO${pos === 1 ? ' · Pokémon King' : ''}" data-note="${esc(note || '暂无其他详细资料。')}" aria-label="显示 ${esc(r.name)} 的详细资料"><b>显示详情</b></button>`
      : note
        ? `<button class="board-note${compact ? ' compact-note' : ''}" type="button" data-name="${esc(r.name)} · 最UPZ" data-note="${esc(note)}" aria-label="显示 ${esc(r.name)} 的详细资料">${compact ? '' : `<span class="note-copy">${esc(note)}</span>`}<b>显示详情</b></button>`
        : '';
  };

  const podiumOrder = rows.slice(0, 3);
  if (podiumOrder.length === 3) podiumOrder.splice(0, 3, podiumOrder[1], podiumOrder[0], podiumOrder[2]);
  const podium = podiumOrder.map((r, visualIndex) => {
    const sourceIndex = rows.indexOf(r);
    const pos = position(r, sourceIndex);
    return `<article class="podium-entry place-${pos}${pos === 1 ? ` ${kingClass}` : ''}">
      <span class="podium-spark" aria-hidden="true">${pos === 1 ? '✦' : '·'}</span>
      <span class="podium-position">${pos}<sup>${pos === 1 ? 'st' : pos === 2 ? 'nd' : 'rd'}</sup></span>
      ${avatar(r.name, pics[nameKey(r.name)], 'podium-avatar')}
      <strong class="podium-name">${esc(r.name)}</strong>
      ${pos === 1 ? `<span class="leader-title">${icon} ${kingTitle}</span>` : ''}
      <span class="podium-score"><b>${esc(points(r))}</b> pts</span>
      ${detailButton(r, pos, true)}
    </article>`;
  }).join('');

  const rest = rows.slice(3).map((r, i) => {
    const pos = position(r, i + 3);
    return `<li>
      <span class="rank">#${esc(pos)}</span>
      ${avatar(r.name, pics[nameKey(r.name)], 'rank-avatar')}
      <span class="who">
        <span class="leader-name"><span>${esc(r.name)}</span></span>
        ${detailButton(r, pos)}
      </span>
      <span class="score"><strong>${esc(points(r))}</strong><small>pts</small></span>
    </li>`;
  }).join('');

  el.innerHTML = `<div class="rank-podium">${podium}</div>
    ${rest ? `<div class="board-labels"><span>Rank</span><span>Name</span><span>Score</span></div><ol start="4">${rest}</ol>` : ''}`;

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
  }).sort((a, b) => b.total - a.total || b.barPct - a.barPct || String(a.name).localeCompare(String(b.name)));

  const eventDetails = p => `<div class="events">
      <span class="ev metric"><span>Total score</span><strong>${esc(p.total)}</strong></span>
      <span class="ev metric"><span>Attendance rate</span><strong>${rateDisplay(p.rate)}</strong></span>
      <span class="ev metric"><span>OGL bonus</span><strong>${p.bonus ? `+${esc(p.bonus)}` : '—'}</strong></span>
      ${p.events.map(item =>
        `<span class="ev ${item.value ? 'yes' : 'zero'}"><span>${esc(item.label)}</span><strong>${item.value ? `+${esc(item.value)}` : '—'}</strong></span>`).join('')}
    </div>`;

  const podiumOrder = people.slice(0, 3);
  if (podiumOrder.length === 3) podiumOrder.splice(0, 3, podiumOrder[1], podiumOrder[0], podiumOrder[2]);
  const podium = podiumOrder.map(p => {
    const pos = people.indexOf(p) + 1;
    return `<details class="podium-attendee place-${pos} ${p.champion.trim()}">
      <summary>
        <span class="att-place">${pos}<sup>${pos === 1 ? 'st' : pos === 2 ? 'nd' : 'rd'}</sup></span>
        ${avatar(p.name, pics[String(p.name).trim()])}
        <span class="podium-person">
          <span class="name">${esc(p.name)}</span>
          <span class="podium-attendance">${rateDisplay(p.rate)} attendance</span>
        </span>
        <span class="podium-points"><strong>${esc(p.total)}</strong><small>pts</small></span>
      </summary>
      ${eventDetails(p)}
    </details>`;
  }).join('');

  const ranking = people.slice(3).map((p, index) => `<details class="${p.champion.trim()}">
      <summary>
        <span class="att-place">#${index + 4}</span>
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
      ${eventDetails(p)}
    </details>`).join('');

  box.innerHTML = `<section class="attendance-podium" aria-label="Top three attendance">${podium}</section>
    ${ranking ? `<section class="attendance-ranking">${ranking}</section>` : ''}`;

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
  $('#member-close')?.addEventListener('click', () => $('#member-sheet').close());

  // Native dialogs already close on Escape. This adds the familiar backdrop
  // dismissal without treating clicks inside the floating board as dismissals.
  [$('#member-sheet'), $('#note-sheet')].filter(Boolean).forEach(dialog => {
    dialog.addEventListener('click', event => {
      const box = dialog.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right
        || event.clientY < box.top || event.clientY > box.bottom;
      if (outside) dialog.close();
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dialog.close();
      }
    });
  });

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
  if ($('#home-photo')) homePhoto();
  if ($('#birthday-banner')) homeBirthdays();
  if ($('#members')) members();
  if ($('#upz')) { board('upz', $('#upz')); board('pokemon', $('#pokemon')); }
  if ($('#attendance')) attendance();
  if ($('#photos')) photos();
});
