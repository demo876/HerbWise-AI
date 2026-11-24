
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let lang = 'en';
try {
  lang = localStorage.getItem('lang') || 'en';
} catch {}

if (!T[lang]) lang = 'en';

const t = (k, v = {}) =>
  (T[lang][k] ?? T.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x]);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const PH = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#c9d3c4"/><text x="150" y="115" font-size="52" text-anchor="middle">🌿</text></svg>'
);

const state = {
  page: 1,
  q: '',
  type: '',
  letter: '',
  all: 0,
  favOnly: false,
  plantId: null,
  history: [],
  shown: []
};

const tr = {};

const favs = () => {
  try {
    return JSON.parse(localStorage.getItem('favs') || '[]');
  } catch {
    return [];
  }
};

const saveFavs = f => {
  try {
    localStorage.setItem('favs', JSON.stringify(f));
  } catch {}
};

const json = async r => {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
};

async function withTranslation(items, scope) {
  if (lang === 'en' || !items.length) return;

  const need = items
    .filter(h => !tr[lang + scope + h.id])
    .map(h => h.id);

  if (!need.length) return;

  $('#notice').textContent = t('translating');

  try {
    const d = await json(await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, ids: need, scope })
    }));

    for (const id of need) {
      if (d[id]) tr[lang + scope + id] = d[id];
    }

    $('#notice').textContent = '';
  } catch (e) {
    $('#notice').textContent = e.message;
  }
}

const view = (h, scope) => ({
  ...h,
  ...(tr[lang + scope + h.id] || {})
});

function card(h0) {
  const h = view(h0, 'card');
  const names = [h.kn, h.hi].filter(Boolean).join(' · ');

  return `<article class="card">
    <img loading="lazy"
      src="${esc(h.image || PH)}"
      alt="${esc(h.en)}"
      onerror="this.onerror=null;this.src='${PH}'">
    <div>
      <h2>${esc(h.en)}</h2>
      <p class="sci">${esc(h.sci)}</p>
      <p class="nm">${esc(names)}</p>
      <p>${esc(h.description)}</p>
      <p class="nm"><b>${t('uses')}:</b> ${esc(h.uses)}</p>
      <p class="nm"><b>${t('benefits')}:</b> ${esc(h.benefits)}</p>
      ${h.toxic ? `<span class="warn">⚠ ${esc(t('toxic'))}</span>` : ''}
    </div>
    <button class="more" data-id="${h.id}">${t('details')}</button>
  </article>`;
}

async function paint(el, items) {
  el.innerHTML = items.map(card).join('');
  await withTranslation(items, 'card');
  el.innerHTML = items.length
    ? items.map(card).join('')
    : `<p>${t('none')}</p>`;
}

function chips() {
  const types = [
    '', 'popular', 'ayurvedic_herb', 'tree',
    'leaf', 'root', 'flower', 'fruit',
    'spice', 'ingredient'
  ];

  $('#chips').innerHTML = types.map(k =>
    `<button data-type="${k}" aria-pressed="${state.type === k}">${t(k || 'all')}</button>`
  ).join('');

  $('#alpha').innerHTML = ['', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(l =>
    `<button data-l="${l}" aria-pressed="${state.letter === l}">${l || t('all')}</button>`
  ).join('');
}

async function load() {
  const p = new URLSearchParams({
    q: state.q,
    type: state.type,
    letter: state.letter,
    page: state.page
  });

  if (state.favOnly) {
    p.set('ids', favs().join(',') || '0');
  }

  try {
    const d = await json(await fetch('/api/herbs?' + p));

    $('#count').textContent = t('count', { n: d.total });

    $('#pager').innerHTML = d.pages > 1
      ? `<button ${state.page < 2 ? 'disabled' : ''} id="prevP">${t('prev')}</button>
         <span>${t('page', { a: state.page, b: d.pages })}</span>
         <button ${state.page >= d.pages ? 'disabled' : ''} id="nextP">${t('next')}</button>`
      : '';

    $('#prevP')?.addEventListener('click', () => {
      state.page--;
      load();
      $('#explore').scrollIntoView();
    });

    $('#nextP')?.addEventListener('click', () => {
      state.page++;
      load();
      $('#explore').scrollIntoView();
    });

    await paint($('#grid'), d.items);

  } catch (e) {
    $('#grid').innerHTML = `<p>${esc(e.message)}</p>`;
  }
}

async function loadPopular() {
  try {
    const d = await json(
      await fetch('/api/herbs?type=popular&limit=8')
    );

    await paint($('#popular'), d.items);
  } catch {}
}

function applyText() {
  document.documentElement.lang = lang;

  $$('[data-i18n]').forEach(e => {
    e.textContent = t(e.dataset.i18n, {
      n: state.all || ''
    });
  });

  $$('[data-i18n-ph]').forEach(e => {
    e.placeholder = t(e.dataset.i18nPh);
  });

  $('#msg').placeholder = t('chatPh');
  $('#lang').value = lang;
  chips();
}

async function setLang(l) {
  lang = l;

  try {
    localStorage.setItem('lang', l);
  } catch {}

  applyText();
  await Promise.all([load(), loadPopular()]);
}

async function open(id) {
  try {
    const h0 = await json(await fetch('/api/herbs/' + id));

    state.plantId = id;
    state.history = [];
    $('#log').innerHTML = '';

    $('#detail').innerHTML = `<p>${t('translating')}</p>`;

    if (!$('#dlg').open) {
      $('#dlg').showModal();
    }

    await withTranslation([h0], 'full');

    const h = view(h0, 'full');
    const saved = favs().includes(id);

    const sec = (k, v) =>
      v ? `<h3>${t(k)}</h3><p>${esc(v)}</p>` : '';

    $('#detail').innerHTML = `
      <img src="${esc(h.image || PH)}"
        alt="${esc(h.en)}"
        onerror="this.onerror=null;this.src='${PH}'">

      <h2>${esc(h.en)}</h2>
      <p class="sci">${esc(h.sci)}</p>
      <p>${esc([h.kn, h.hi].filter(Boolean).join(' · '))}</p>

      ${h.family ? `<p>${t('family')}: ${esc(h.family)}</p>` : ''}

      ${h.toxic ? `<div class="warn">⚠ ${esc(t('toxic'))}</div>` : ''}

      <p>${esc(h.description)}</p>

      ${sec('uses', h.uses)}
      <p class="ai">${t('trad')}</p>
      ${sec('parts', h.parts)}
      ${sec('prep', h.prep)}
      ${sec('benefits', h.benefits)}
      ${sec('evidence', h.evidence)}
      ${sec('prec', h.precautions)}

      <h3>${t('refs')}</h3>
      <p class="ai">${t('aiNote')}</p>

      <p>
        ${h.source_url
          ? `<a href="${esc(h.source_url)}" target="_blank" rel="noopener">Wikipedia</a> · `
          : ''}
        <a href="https://cb.imsc.res.in/imppat/" target="_blank" rel="noopener">IMPPAT</a> ·
        <a href="https://nmpb.nic.in/" target="_blank" rel="noopener">NMPB</a> ·
        <a href="https://medicinalplants.in/" target="_blank" rel="noopener">medicinalplants.in</a>
      </p>

      <button id="save" aria-pressed="${saved}">
        ${saved ? t('saved') : t('save')}
      </button>
    `;

    $('#save').onclick = ev => {
      let f = favs();
      const on = f.includes(id);

      f = on
        ? f.filter(x => x !== id)
        : [...f, id];

      saveFavs(f);
      ev.target.setAttribute('aria-pressed', !on);
      ev.target.textContent = on ? t('save') : t('saved');
    };

  } catch (e) {
    $('#detail').innerHTML = `<p>${esc(e.message)}</p>`;
  }
}

document.addEventListener('click', e => {
  const m = e.target.closest('.more');

  if (m) return open(+m.dataset.id);

  const c = e.target.closest('[data-type]');

  if (c) {
    state.type = c.dataset.type;
    state.page = 1;
    chips();
    load();
  }

  const a = e.target.closest('[data-l]');

  if (a) {
    state.letter = a.dataset.l;
    state.page = 1;
    chips();
    load();
  }
});

$('#close').onclick = () => $('#dlg').close();

$('#lang').onchange = e => setLang(e.target.value);

let timer;

$('#q').addEventListener('input', e => {
  clearTimeout(timer);

  timer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.page = 1;
    load();
  }, 300);
});

$('#favBtn').onclick = e => {
  state.favOnly = !state.favOnly;
  e.target.setAttribute('aria-pressed', state.favOnly);
  state.page = 1;
  load();
};

// ---- chat ----

function add(role, text) {
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'u' : 'a');
  d.textContent = text;
  $('#log').append(d);
  d.scrollIntoView();
}

$('#cf').addEventListener('submit', async e => {
  e.preventDefault();

  const message = $('#msg').value.trim();

  if (!message) return;

  $('#msg').value = '';
  add('user', message);

  try {
    const d = await json(await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        plantId: state.plantId,
        history: state.history,
        lang
      })
    }));

    add('assistant', d.reply);

    state.history.push(
      { role: 'user', content: message },
      { role: 'assistant', content: d.reply }
    );

  } catch (err) {
    add('assistant', err.message);
  }
});

// ---- start website ----

(async () => {
  try {
    state.all = (await json(await fetch('/api/stats'))).plants;
  } catch {}

  applyText();
  load();
  loadPopular();
})();
