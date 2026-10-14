# Défi Bleu contre Rouge

Une webapp pour un défi de novembre : deux équipes, chaque participant déclare ses sorties de course ou de marche ; le défi repose sur la confiance, le lien Strava est facultatif. L'équipe qui cumule le plus de km le 30 novembre gagne.

Elle tourne sur un Worker Cloudflare avec une base D1. Le front est en HTML/JS sans build, dans `public/`. La connexion se fait avec Google, donc aucun e-mail n'est envoyé.

## Règles codées

- **Affectation des équipes** : chaque équipe a une distance « attendue », égale à la somme des volumes hebdo déclarés × le nombre de semaines restantes à l'arrivée de chaque membre. Le nouveau rejoint l'équipe la moins dotée. Si l'écart est négligeable, il rejoint celle qui a le moins de membres, puis l'affectation se fait au hasard. Une personne qui arrive le 20 novembre pèse donc moins qu'une personne inscrite le 1er.
- **Saisies** : uniquement des sorties datées du défi, jamais dans le futur, et un même lien Strava, s'il est donné, ne compte qu'une fois. Les saisies restent ouvertes `GRACE_DAYS` jours après la fin. Il n'y a pas de plafond par sortie, seulement une confirmation au-delà de 100 km et une limite technique à 2000 km.
- **Signalements** : n'importe quel participant peut signaler une sortie d'un autre. Les organisateurs (`ADMIN_EMAILS`) la traitent sur `/admin.html` : invalider retire les km du total.

## En local

```bash
npm install
npm run dev
```

Ouvre http://localhost:8787. `.dev.vars` active une connexion de test sans Google et ouvre le défi dès octobre.

## Mise en ligne

1. **Identifiant Google** : sur https://console.cloud.google.com, crée un projet. Dans *API et services* puis *Écran de consentement OAuth*, choisis Externe, renseigne le nom de l'app et ton e-mail, puis **Publier l'application** pour sortir du mode test, qui est limité à 100 utilisateurs. Les champs email/profil ne demandent pas de validation par Google. Dans *Identifiants*, crée un *ID client OAuth* de type « Application Web » avec comme origines JavaScript autorisées l'URL du site (et `http://localhost:8787` pour tester). Copie l'ID client dans `GOOGLE_CLIENT_ID` de `wrangler.jsonc`.
2. **Base D1** : `npx wrangler d1 create defi-db`, puis copie l'`database_id` dans `wrangler.jsonc`.
3. `npm run db:migrate`, puis `npm run deploy`.

Pour changer les dates du défi ou les organisateurs, modifie `vars` dans `wrangler.jsonc` et redéploie.
