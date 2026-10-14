// Page organisateur : traiter les sorties signalées.

const kmFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const frDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur réseau.');
  return data;
}

async function load() {
  const list = document.getElementById('reports');
  try {
    const { reports } = await api('/api/admin/reports');
    list.innerHTML = reports.length
      ? reports.map(({ id, reason, reporter, activity: a }) => `
        <li>
          <span class="dot ${a.team}"></span>
          <span class="what"><strong>${esc(a.pseudo)}</strong> · ${a.kind} · ${frDate(a.date)}
            <span class="meta">${esc(a.email)}${a.stravaUrl ? ` · <a href="${esc(a.stravaUrl)}" target="_blank" rel="noopener">Strava</a>` : ' · sans lien Strava'}</span>
            <span class="meta">Signalé par ${esc(reporter)}${reason ? ` : « ${esc(reason)} »` : ''}</span></span>
          <span class="km">${kmFmt.format(a.km)} km</span>
          <button class="btn btn-small btn-danger" data-invalidate="${a.id}">Invalider</button>
          <button class="btn btn-small" data-dismiss="${id}">Rejeter</button>
        </li>`).join('')
      : '<li class="empty">Aucun signalement en attente.</li>';
  } catch (err) {
    document.getElementById('error').textContent = err.message;
  }
}

document.getElementById('reports').addEventListener('click', async (e) => {
  const { invalidate, dismiss } = e.target.dataset;
  if (invalidate) await api(`/api/admin/activities/${invalidate}`, { status: 'invalide' });
  if (dismiss) await api(`/api/admin/reports/${dismiss}`, {});
  if (invalidate || dismiss) load();
});

load();
