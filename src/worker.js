// API du défi Bleu contre Rouge. Les fichiers statiques de public/ sont servis directement par Cloudflare.

const SESSION_DAYS = 60;
const TEAMS = ['bleu', 'rouge'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method !== 'GET' && !(request.headers.get('content-type') || '').includes('application/json')) {
        return json({ error: 'Requête invalide.' }, 415);
      }
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Erreur serveur.' }, 500);
    }
  },
};

async function route(request, env, url) {
  const { pathname: path } = url;
  const method = request.method;

  if (path === '/api/config' && method === 'GET') return json(config(env, url));
  if (path === '/api/state' && method === 'GET') return json(await raceState(env));
  if (path === '/api/auth/google' && method === 'POST') return googleLogin(request, env, url);
  if (path === '/api/auth/dev' && method === 'POST') return devLogin(request, env, url);
  if (path === '/api/logout' && method === 'POST') return logout(request, env, url);

  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, 'Connecte-toi pour continuer.');

  if (path === '/api/me' && method === 'GET') return json(await me(env, user));
  if (path === '/api/onboard' && method === 'POST') return json(await onboard(request, env, user));

  if (!user.team) throw new HttpError(403, "Termine ton inscription d'abord.");

  if (path === '/api/feed' && method === 'GET') return json(await feed(env, user));
  if (path === '/api/activities' && method === 'POST') return json(await addActivity(request, env, user));

  let m = path.match(/^\/api\/activities\/(\d+)$/);
  if (m && method === 'DELETE') return json(await deleteActivity(env, user, Number(m[1])));
  m = path.match(/^\/api\/activities\/(\d+)\/report$/);
  if (m && method === 'POST') return json(await reportActivity(request, env, user, Number(m[1])));

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(env, user)) throw new HttpError(403, 'Réservé aux organisateurs.');
    if (path === '/api/admin/reports' && method === 'GET') return json(await adminReports(env));
    m = path.match(/^\/api\/admin\/activities\/(\d+)$/);
    if (m && method === 'POST') return json(await adminSetActivity(request, env, Number(m[1])));
    m = path.match(/^\/api\/admin\/reports\/(\d+)$/);
    if (m && method === 'POST') return json(await adminCloseReport(env, Number(m[1])));
  }

  throw new HttpError(404, 'Introuvable.');
}

// ---------- Configuration et dates ----------

function config(env, url) {
  const c = challenge(env);
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    devLogin: devLoginAllowed(env, url),
    start: c.start,
    end: c.end,
    submitUntil: c.submitUntil,
    today: c.today,
  };
}

function challenge(env) {
  const start = env.CHALLENGE_START || '2026-11-01';
  const end = env.CHALLENGE_END || '2026-11-30';
  const submitUntil = addDays(end, Number(env.GRACE_DAYS || 0));
  return { start, end, submitUntil, today: parisToday() };
}

function parisToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- Connexion ----------

function devLoginAllowed(env, url) {
  return env.DEV_LOGIN === '1' && ['localhost', '127.0.0.1'].includes(url.hostname);
}

async function googleLogin(request, env, url) {
  if (!env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'Connexion Google non configurée.');
  const { credential } = await request.json();
  const claims = await verifyGoogleToken(String(credential || ''), env.GOOGLE_CLIENT_ID);
  return startSession(env, url, `google:${claims.sub}`, claims.email);
}

async function devLogin(request, env, url) {
  if (!devLoginAllowed(env, url)) throw new HttpError(404, 'Introuvable.');
  const { email } = await request.json();
  const clean = String(email || '').trim().toLowerCase();
  if (!clean.includes('@')) throw new HttpError(400, 'E-mail invalide.');
  return startSession(env, url, `dev:${clean}`, clean);
}

async function startSession(env, url, sub, email) {
  await env.DB.prepare(
    'INSERT INTO users (google_sub, email) VALUES (?, ?) ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email'
  ).bind(sub, email).run();
  const user = await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind(sub).first();

  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86400e3;
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, user.id, expires).run();

  return json({ ok: true }, 200, {
    'set-cookie': cookie(url, 'sid', token, SESSION_DAYS * 86400),
  });
}

async function logout(request, env, url) {
  const token = readCookie(request, 'sid');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true }, 200, { 'set-cookie': cookie(url, 'sid', '', 0) });
}

async function currentUser(request, env) {
  const token = readCookie(request, 'sid');
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).bind(token, Date.now()).first();
}

function isAdmin(env, user) {
  const admins = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(user.email.toLowerCase());
}

let googleKeys = null;
let googleKeysAt = 0;

async function verifyGoogleToken(token, clientId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Jeton Google invalide.');
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));

  if (!googleKeys || Date.now() - googleKeysAt > 3600e3) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    googleKeys = (await res.json()).keys;
    googleKeysAt = Date.now();
  }
  const jwk = googleKeys.find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Jeton Google invalide.');

  const key = await crypto.subtle.importKey(
    'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`)
  );
  const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
  const issuerOk = ['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss);
  if (!valid || !issuerOk || claims.aud !== clientId || claims.exp * 1000 < Date.now() || !claims.email_verified) {
    throw new HttpError(401, 'Jeton Google invalide.');
  }
  return claims;
}

// ---------- Inscription et équipes ----------

async function onboard(request, env, user) {
  if (user.team) return { team: user.team };
  const body = await request.json();
  const pseudo = String(body.pseudo || '').trim().replace(/\s+/g, ' ');
  const weekly = Number(String(body.weeklyKm ?? '').replace(',', '.'));
  if (pseudo.length < 2 || pseudo.length > 30) throw new HttpError(400, 'Le pseudo doit faire entre 2 et 30 caractères.');
  if (!Number.isFinite(weekly) || weekly < 0 || weekly > 300) throw new HttpError(400, 'Volume hebdomadaire invalide.');
  const gender = ['homme', 'femme'].includes(body.gender) ? body.gender : null;

  const c = challenge(env);
  const joinedOn = c.today > c.start ? c.today : c.start;
  const team = await pickTeam(env, c, joinedOn, weekly);

  await env.DB.prepare('UPDATE users SET pseudo = ?, weekly_km = ?, gender = ?, team = ?, joined_on = ? WHERE id = ? AND team IS NULL')
    .bind(pseudo, weekly, gender, team, joinedOn, user.id).run();
  const saved = await env.DB.prepare('SELECT team FROM users WHERE id = ?').bind(user.id).first();
  return { team: saved.team };
}

// Chaque équipe a une distance « attendue » : pour chaque membre, son volume hebdo déclaré
// multiplié par le nombre de semaines qu'il lui reste à courir depuis son arrivée.
// Le nouveau rejoint l'équipe la moins dotée, puis celle qui a le moins de membres, puis au hasard.
async function pickTeam(env, c, joinedOn, weeklyKm) {
  const { results } = await env.DB.prepare(
    `SELECT team, COUNT(*) AS members,
            SUM(weekly_km * (julianday(?1) - julianday(joined_on) + 1) / 7.0) AS expected
     FROM users WHERE team IS NOT NULL GROUP BY team`
  ).bind(c.end).all();
  const stats = Object.fromEntries(TEAMS.map((t) => [t, { members: 0, expected: 0 }]));
  for (const r of results) stats[r.team] = { members: r.members, expected: r.expected || 0 };

  const [a, b] = TEAMS;
  // Écart négligeable devant l'apport du nouveau : on départage au nombre de membres.
  const tolerance = Math.max(0.5, weeklyKm * 0.05);
  const diff = stats[a].expected - stats[b].expected;
  if (Math.abs(diff) > tolerance) return diff < 0 ? a : b;
  if (stats[a].members !== stats[b].members) return stats[a].members < stats[b].members ? a : b;
  return crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? a : b;
}

// ---------- Course ----------

async function raceState(env) {
  const [members, distances] = await env.DB.batch([
    env.DB.prepare('SELECT team, COUNT(*) AS n FROM users WHERE team IS NOT NULL GROUP BY team'),
    env.DB.prepare(`SELECT team, SUM(distance_m) AS m, COUNT(*) AS n FROM activities WHERE status = 'ok' GROUP BY team`),
  ]);
  const teams = Object.fromEntries(TEAMS.map((t) => [t, { members: 0, km: 0, activities: 0 }]));
  for (const r of members.results) teams[r.team].members = r.n;
  for (const r of distances.results) {
    teams[r.team].km = round1(r.m / 1000);
    teams[r.team].activities = r.n;
  }
  return { teams, updatedAt: new Date().toISOString() };
}

async function me(env, user) {
  const base = {
    pseudo: user.pseudo,
    email: user.email,
    team: user.team,
    gender: user.gender,
    weeklyKm: user.weekly_km,
    joinedOn: user.joined_on,
    isAdmin: isAdmin(env, user),
  };
  if (!user.team) return base;

  const [mine, teamTotal] = await env.DB.batch([
    env.DB.prepare(
      `SELECT id, kind, distance_m, activity_date, strava_url, status FROM activities
       WHERE user_id = ? ORDER BY activity_date DESC, id DESC`
    ).bind(user.id),
    env.DB.prepare(`SELECT SUM(distance_m) AS m FROM activities WHERE team = ? AND status = 'ok'`).bind(user.team),
  ]);
  const activities = mine.results.map(publicActivity);
  const myKm = round1(mine.results.filter((a) => a.status === 'ok').reduce((s, a) => s + a.distance_m, 0) / 1000);
  const teamKm = round1((teamTotal.results[0]?.m || 0) / 1000);
  return { ...base, myKm, teamKm, share: teamKm > 0 ? myKm / teamKm : 0, activities };
}

async function feed(env, user) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.kind, a.distance_m, a.activity_date, a.strava_url, a.status, a.team, u.pseudo,
            a.user_id = ?1 AS mine,
            EXISTS (SELECT 1 FROM reports r WHERE r.activity_id = a.id AND r.reporter_id = ?1) AS reported
     FROM activities a JOIN users u ON u.id = a.user_id
     WHERE a.status = 'ok'
     ORDER BY a.id DESC LIMIT 50`
  ).bind(user.id).all();
  return {
    activities: results.map((a) => ({ ...publicActivity(a), team: a.team, pseudo: a.pseudo, mine: !!a.mine, reported: !!a.reported })),
  };
}

async function addActivity(request, env, user) {
  const body = await request.json();
  const c = challenge(env);

  if (c.today < c.start) throw new HttpError(400, `Le défi commence le ${frDate(c.start)}.`);
  if (c.today > c.submitUntil) throw new HttpError(400, 'Le défi est terminé, les saisies sont fermées.');

  const kind = body.kind;
  if (!['course', 'marche'].includes(kind)) throw new HttpError(400, 'Choisis course ou marche.');

  const km = Number(String(body.distanceKm ?? '').replace(',', '.'));
  if (!Number.isFinite(km) || km <= 0 || km > 2000) throw new HttpError(400, 'Distance invalide.');

  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Date invalide.');
  if (date < c.start || date > c.end) throw new HttpError(400, `La sortie doit dater du défi (${frDate(c.start)} au ${frDate(c.end)}).`);
  if (date > c.today) throw new HttpError(400, 'La sortie ne peut pas être dans le futur.');

  const strava = await parseStravaLink(String(body.stravaUrl || ''));

  try {
    await env.DB.prepare(
      `INSERT INTO activities (user_id, team, kind, distance_m, activity_date, strava_url, strava_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(user.id, user.team, kind, Math.round(km * 1000), date, strava.url, strava.key).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) throw new HttpError(409, 'Cette sortie Strava a déjà été enregistrée.');
    throw err;
  }
  return { ok: true };
}

// Accepte strava.com/activities/123 et les liens courts de l'app mobile (strava.app.link/…),
// qu'on essaie de déplier. Si on n'y arrive pas, le lien lui-même sert d'identifiant anti-doublon.
async function parseStravaLink(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Colle le lien de ta sortie Strava.');
  }
  const host = url.hostname.toLowerCase();
  const activityId = (u) => u.match(/strava\.com\/activities\/(\d+)/)?.[1];

  if (host === 'strava.com' || host.endsWith('.strava.com')) {
    const id = activityId(url.href);
    if (!id) throw new HttpError(400, 'Ce lien Strava ne pointe pas vers une sortie (strava.com/activities/…).');
    return { url: `https://www.strava.com/activities/${id}`, key: `strava:${id}` };
  }

  if (host === 'strava.app.link') {
    try {
      const res = await fetch(url.href, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0' } });
      const id = activityId(res.url) || activityId(await res.text());
      if (id) return { url: `https://www.strava.com/activities/${id}`, key: `strava:${id}` };
    } catch {
      // On garde le lien court tel quel.
    }
    const clean = `https://strava.app.link${url.pathname}`;
    return { url: clean, key: `link:${clean}` };
  }

  throw new HttpError(400, 'Le lien doit venir de Strava.');
}

async function deleteActivity(env, user, id) {
  const res = await env.DB.prepare('DELETE FROM activities WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!res.meta.changes) throw new HttpError(404, 'Sortie introuvable.');
  await env.DB.prepare('DELETE FROM reports WHERE activity_id = ?').bind(id).run();
  return { ok: true };
}

async function reportActivity(request, env, user, id) {
  const { reason } = await request.json();
  const activity = await env.DB.prepare('SELECT user_id FROM activities WHERE id = ?').bind(id).first();
  if (!activity) throw new HttpError(404, 'Sortie introuvable.');
  if (activity.user_id === user.id) throw new HttpError(400, 'Tu ne peux pas signaler ta propre sortie.');
  await env.DB.prepare('INSERT OR IGNORE INTO reports (activity_id, reporter_id, reason) VALUES (?, ?, ?)')
    .bind(id, user.id, String(reason || '').trim().slice(0, 300) || null).run();
  return { ok: true };
}

// ---------- Administration ----------

async function adminReports(env) {
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.reason, r.created_at, rep.pseudo AS reporter,
            a.id AS activity_id, a.kind, a.distance_m, a.activity_date, a.strava_url, a.status, a.team,
            u.pseudo, u.email
     FROM reports r
     JOIN activities a ON a.id = r.activity_id
     JOIN users u ON u.id = a.user_id
     JOIN users rep ON rep.id = r.reporter_id
     WHERE r.status = 'ouvert'
     ORDER BY r.id DESC`
  ).all();
  return {
    reports: results.map((r) => ({
      id: r.id, reason: r.reason, createdAt: r.created_at, reporter: r.reporter,
      activity: { ...publicActivity({ ...r, id: r.activity_id }), team: r.team, pseudo: r.pseudo, email: r.email },
    })),
  };
}

async function adminSetActivity(request, env, id) {
  const { status } = await request.json();
  if (!['ok', 'invalide'].includes(status)) throw new HttpError(400, 'Statut invalide.');
  await env.DB.batch([
    env.DB.prepare('UPDATE activities SET status = ? WHERE id = ?').bind(status, id),
    env.DB.prepare(`UPDATE reports SET status = 'traite' WHERE activity_id = ?`).bind(id),
  ]);
  return { ok: true };
}

async function adminCloseReport(env, id) {
  await env.DB.prepare(`UPDATE reports SET status = 'traite' WHERE id = ?`).bind(id).run();
  return { ok: true };
}

// ---------- Utilitaires ----------

function publicActivity(a) {
  return {
    id: a.id,
    kind: a.kind,
    km: round1(a.distance_m / 1000),
    date: a.activity_date,
    stravaUrl: a.strava_url,
    status: a.status,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function frDate(iso) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

function cookie(url, name, value, maxAge) {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
