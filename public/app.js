// Interface du défi : la course, l'inscription, la saisie des sorties et les signalements.

const TEAM_LABEL = { bleu: 'Bleu', rouge: 'Rouge' };
const KIND_LABEL = { course: 'Course', marche: 'Marche' };

const $ = (id) => document.getElementById(id);
let config = null;
let me = null;
let reportId = null;

const kmFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const km = (n) => `${kmFmt.format(n)} km`;
const frDate = (iso, opts = { day: 'numeric', month: 'long' }) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Erreur réseau.'), { status: res.status });
  return data;
}

// ---------- La course ----------

// Les deux coureurs ont le sexe du participant connecté. Sans réponse (ou pas connecté) : un de chaque.
let drawnFor = null;
const runnerImage = (gender, team) => `img/${gender}-${team}.png`;
function renderRunners() {
  const gender = me?.gender || null;
  if (drawnFor === (gender || 'mixte')) return;
  drawnFor = gender || 'mixte';
  $('runner-bleu').querySelector('img').src = runnerImage(gender || 'homme', 'bleu');
  $('runner-rouge').querySelector('img').src = runnerImage(gender || 'femme', 'rouge');
}

const START = 7;      // position de départ, en % de la piste
const FRONT = 84;     // position du coureur en tête
const MIN_GAP = 12;   // écart visuel minimum quand une équipe mène

async function loadState() {
  const state = await api('/api/state');
  const { bleu, rouge } = state.teams;
  const pos = { bleu: START, rouge: START };
  let leader = null;

  if (bleu.km !== rouge.km) {
    leader = bleu.km > rouge.km ? 'bleu' : 'rouge';
    const follower = leader === 'bleu' ? 'rouge' : 'bleu';
    const ratio = state.teams[follower].km / state.teams[leader].km;
    pos[leader] = FRONT;
    pos[follower] = Math.min(START + (FRONT - START) * ratio, FRONT - MIN_GAP);
  } else if (bleu.km > 0) {
    pos.bleu = pos.rouge = FRONT;
  }

  for (const team of ['bleu', 'rouge']) {
    const runner = $(`runner-${team}`);
    runner.style.left = `${pos[team]}%`;
    runner.classList.toggle('edge-left', pos[team] < 14);
    runner.classList.toggle('edge-right', pos[team] > 78);
    $(`km-${team}`).textContent = km(state.teams[team].km);
    const t = state.teams[team];
    $(`stat-${team}`).textContent =
      `${t.members} membre${t.members > 1 ? 's' : ''} · ${t.activities} sortie${t.activities > 1 ? 's' : ''}`;
  }

  const diff = Math.abs(bleu.km - rouge.km);
  const gap = $('gap');
  gap.style.left = `${Math.min(pos.bleu, pos.rouge)}%`;
  gap.style.width = `${Math.abs(pos.bleu - pos.rouge)}%`;
  gap.classList.toggle('hidden', !leader);
  $('gap-label').textContent = leader ? `${km(diff)} d'écart` : '';

  const started = config.today >= config.start;
  const over = config.today > config.end;
  $('race').classList.toggle('idle', !started || over);
  if (leader) {
    const verb = over ? 'gagne avec' : 'mène de';
    $('lead-line').innerHTML = `<span class="t-${leader}">Équipe ${TEAM_LABEL[leader]}</span> ${verb} ${km(diff)} d'avance`;
  } else {
    $('lead-line').textContent = bleu.km > 0 ? 'Égalité parfaite !' : started ? 'Premier kilomètre à prendre !' : "La course n'a pas encore commencé.";
  }
  $('updated').textContent = `Mis à jour à ${new Date(state.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderCountdown() {
  const day = 86400e3;
  const toDate = (iso) => new Date(iso + 'T12:00:00Z');
  const today = toDate(config.today);
  $('period').textContent = `Du ${frDate(config.start)} au ${frDate(config.end)}`;
  let text;
  if (today < toDate(config.start)) {
    const n = Math.round((toDate(config.start) - today) / day);
    text = `Départ dans ${n} jour${n > 1 ? 's' : ''}`;
  } else if (today <= toDate(config.end)) {
    const n = Math.round((toDate(config.end) - today) / day);
    text = n === 0 ? 'Dernier jour !' : `Encore ${n} jour${n > 1 ? 's' : ''}`;
  } else {
    text = 'Défi terminé';
  }
  $('countdown').textContent = text;
}

// ---------- Connexion et inscription ----------

function show(view) {
  for (const id of ['view-login', 'view-onboard', 'view-reveal', 'view-member']) $(id).hidden = id !== view;
}

async function loadMe() {
  try {
    me = await api('/api/me');
  } catch (err) {
    if (err.status !== 401) throw err;
    me = null;
  }
  renderRunners();
  $('logout').hidden = !me;
  $('admin-link').hidden = !me?.isAdmin;

  if (!me) {
    show('view-login');
    setupLogin();
  } else if (!me.team) {
    show('view-onboard');
  } else {
    show('view-member');
    renderMine();
    loadFeed();
  }
}

function setupLogin() {
  if (config.devLogin) $('dev-login').hidden = false;
  if (!config.googleClientId) return;
  const tryRender = () => {
    if (!window.google?.accounts?.id) return setTimeout(tryRender, 200);
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async ({ credential }) => {
        await api('/api/auth/google', { method: 'POST', body: { credential } });
        loadMe();
      },
    });
    google.accounts.id.renderButton($('google-btn'), { theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'pill', locale: 'fr' });
  };
  tryRender();
}

$('dev-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  await api('/api/auth/dev', { method: 'POST', body: { email: e.target.email.value } });
  loadMe();
});

$('onboard-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  $('onboard-error').textContent = '';
  try {
    const gender = f.gender.value;
    const { team } = await api('/api/onboard', { method: 'POST', body: { pseudo: f.pseudo.value, weeklyKm: f.weeklyKm.value, gender } });
    $('reveal-figure').src = runnerImage(gender || (team === 'bleu' ? 'homme' : 'femme'), team);
    $('reveal-team').textContent = TEAM_LABEL[team];
    $('reveal-team').className = `reveal-team t-${team}`;
    show('view-reveal');
    loadState();
  } catch (err) {
    $('onboard-error').textContent = err.message;
  }
});

$('reveal-ok').addEventListener('click', loadMe);

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: {} });
  window.google?.accounts?.id?.disableAutoSelect();
  loadMe();
});

// ---------- Participant ----------

function renderMine() {
  $('mine').className = `card mine ${me.team}`;
  $('my-pseudo').textContent = `${me.pseudo}, équipe ${TEAM_LABEL[me.team]}`;
  $('my-km').textContent = km(me.myKm);
  const pct = Math.round(me.share * 1000) / 10;
  $('share-fill').style.width = `${Math.min(100, me.share * 100)}%`;
  $('share-text').textContent = me.teamKm > 0
    ? `${kmFmt.format(pct)} % des ${km(me.teamKm)} de l'équipe ${TEAM_LABEL[me.team]}`
    : `L'équipe ${TEAM_LABEL[me.team]} n'a encore aucun kilomètre. À toi d'ouvrir le compteur !`;

  const list = $('my-list');
  list.innerHTML = me.activities.length
    ? me.activities.map((a) => `
      <li class="${a.status === 'invalide' ? 'invalid' : ''}">
        <span class="dot ${me.team}"></span>
        <span class="what"><strong>${KIND_LABEL[a.kind]}</strong> · ${frDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })}
          ${a.stravaUrl ? `<span class="meta"><a href="${esc(a.stravaUrl)}" target="_blank" rel="noopener">Voir sur Strava</a></span>` : ''}</span>
        ${a.status === 'invalide' ? '<span class="tag">Invalidée</span>' : ''}
        <span class="km">${km(a.km)}</span>
        <button class="btn btn-small" data-delete="${a.id}" aria-label="Supprimer cette sortie">Suppr.</button>
      </li>`).join('')
    : '<li class="empty">Aucune sortie pour l\'instant.</li>';

  const form = $('activity-form');
  const max = config.today < config.end ? config.today : config.end;
  form.date.min = config.start;
  form.date.max = max;
  if (!form.date.value) form.date.value = config.today < config.start ? config.start : max;
  const closed = config.today < config.start || config.today > config.submitUntil;
  $('activity-submit').disabled = closed;
  $('activity-error').textContent = config.today < config.start
    ? `Les saisies ouvrent le ${frDate(config.start)}.`
    : config.today > config.submitUntil ? 'Le défi est terminé, les saisies sont fermées.' : '';
}

$('my-list').addEventListener('click', async (e) => {
  const id = e.target.dataset.delete;
  if (!id || !confirm('Supprimer cette sortie ?')) return;
  await api(`/api/activities/${id}`, { method: 'DELETE' });
  await Promise.all([loadMe(), loadState()]);
});

$('activity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const distance = Number(f.distanceKm.value.replace(',', '.'));
  $('activity-error').textContent = '';
  $('activity-success').textContent = '';
  if (distance > 100 && !confirm(`${km(distance)} en une seule sortie, c'est bien ça ?`)) return;

  const btn = $('activity-submit');
  btn.disabled = true;
  try {
    await api('/api/activities', {
      method: 'POST',
      body: { kind: f.kind.value, distanceKm: f.distanceKm.value, date: f.date.value, stravaUrl: f.stravaUrl.value },
    });
    f.distanceKm.value = '';
    f.stravaUrl.value = '';
    $('activity-success').textContent = `+${km(distance)} pour l'équipe ${TEAM_LABEL[me.team]} !`;
    await Promise.all([loadMe(), loadState()]);
  } catch (err) {
    $('activity-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

async function loadFeed() {
  const { activities } = await api('/api/feed');
  $('feed').innerHTML = activities.length
    ? activities.map((a) => `
      <li>
        <span class="dot ${a.team}"></span>
        <span class="what"><strong>${esc(a.pseudo)}</strong> · ${KIND_LABEL[a.kind]}
          <span class="meta">${frDate(a.date, { day: 'numeric', month: 'short' })}${a.stravaUrl ? ` · <a href="${esc(a.stravaUrl)}" target="_blank" rel="noopener">Strava</a>` : ''}</span></span>
        <span class="km">${km(a.km)}</span>
        ${a.mine ? '' : a.reported
          ? '<span class="tag">Signalée</span>'
          : `<button class="btn btn-small" data-report="${a.id}" data-label="${esc(`${a.pseudo}, ${KIND_LABEL[a.kind].toLowerCase()} de ${km(a.km)} le ${frDate(a.date)}`)}">Signaler</button>`}
      </li>`).join('')
    : '<li class="empty">Pas encore de sortie.</li>';
}

$('feed').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-report]');
  if (!btn) return;
  reportId = btn.dataset.report;
  $('report-what').textContent = btn.dataset.label;
  $('report-form').reason.value = '';
  $('report-dialog').showModal();
});

$('report-dialog').addEventListener('close', async () => {
  if ($('report-dialog').returnValue !== 'send' || !reportId) return;
  await api(`/api/activities/${reportId}/report`, { method: 'POST', body: { reason: $('report-form').reason.value } });
  reportId = null;
  loadFeed();
});

// ---------- Démarrage ----------

(async function init() {
  config = await api('/api/config');
  renderCountdown();
  await Promise.all([loadState(), loadMe()]);

  // Suivi en direct : on rafraîchit tant que l'onglet est visible.
  setInterval(() => { if (!document.hidden) loadState(); }, 20000);
  setInterval(() => { if (!document.hidden && me?.team) loadFeed(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadState(); });
})();
