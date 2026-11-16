# Méridien — l'actualité mondiale par la carte

Plateforme bilingue (français / anglais) d'information internationale : une carte du monde interactive,
des actualités géolocalisées issues de rédactions reconnues, et l'exploration des relations entre territoires.

## Démarrer

```bash
npm install
npm run build      # génère les données géographiques + compile l'interface
npm start          # http://localhost:8787
```

Développement : `npm run dev:server` et `npm run dev:web` (http://localhost:5173). Tests : `npm test`.
Configuration : variables de `.env.example` (à exporter dans l'environnement). Node ≥ 22.13.

Le serveur doit pouvoir joindre les flux listés dans `server/src/collector/sources.json`, ainsi que
`query.wikidata.org` et `fr|en.wikipedia.org`. Sans accès réseau, le site fonctionne mais reste vide :
**aucun contenu de démonstration n'est jamais affiché**.

## Architecture

| Domaine | Emplacement | Rôle |
|---|---|---|
| Frontend | `web/` | React + MapLibre GL. Accueil éditorial, carte, panneaux, recherche, FR/EN |
| API | `server/src/api/` | REST JSON, gestion d'erreurs, API de la rédaction protégée par jeton |
| Données géographiques | `server/scripts/build-geo.js`, `server/src/geo/` | Pays, régions, villes ; géo-étiquetage des articles |
| Collecte | `server/src/collector/` | Flux RSS/Atom, état par source, tolérance aux pannes, détection des articles modifiés |
| Vérification éditoriale | `server/src/editorial/` | Recoupement entre groupes de presse, nature de l'information, importance |
| Relations | `server/src/api/routes.js` (`/relations`), `server/src/context/` | Repères, contexte encyclopédique, actualité commune, analyses sourcées |
| Traduction / synthèse | `server/src/translation/` | Optionnel (clé API), résultats mis en cache et signalés |
| Stockage | `server/src/db.js` | SQLite (module natif de Node) |

Gestion des utilisateurs : non nécessaire à ce stade (lecture publique ; seule l'API de la rédaction est authentifiée).

## Règles éditoriales appliquées par le code

- Chaque article garde son lien, sa source, sa date ; un article sans URL ni titre est écarté.
- **Recoupement** : un sujet est « recoupé » à partir de deux *groupes éditoriaux* distincts (France 24 et RFI comptent pour un), sinon « source unique ».
- **Nature** : fait rapporté / déclaration / analyse (règles lexicales, faillibles, affichées comme automatiques).
- **Importance** : nombre de rédactions indépendantes, pays concernés, couverture multilingue, thématique. Aucune mesure d'audience. La rédaction peut la fixer.
- **Textes** : seuls les extraits des sources sont affichés, étiquetés comme tels. Traductions et synthèses automatiques sont marquées « non relues ».
- **Corrections** : un article modifié par sa source est marqué « actualisé » (ancien titre conservé) ; les corrections de la rédaction s'affichent avec leur note.
- **Relations** : jamais de note chiffrée. Une analyse exige au moins deux sources liées ; les hypothèses sont isolées et signalées ; les données absentes sont listées.

### API de la rédaction (`ADMIN_TOKEN`)

```bash
curl -X POST localhost:8787/api/admin/stories/12/review -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"corrected","noteFr":"…","noteEn":"…","importance":"major"}'
```

`PUT /api/admin/relations` publie une analyse rédigée (`a`, `b`, `lang`, `body`, `sources`), `POST /api/admin/collect` force une collecte.

## Limites connues

- **Non testé en conditions réelles** : l'environnement de développement n'avait accès à aucune source. La collecte, le recoupement et l'API sont couverts par des tests sur flux fictifs ; les URL des flux, les requêtes Wikidata/Wikipédia et le module de traduction/synthèse restent à valider au premier lancement connecté (page « Sources et méthode » : état de chaque flux).
- Reuters, AP et AFP ne publient pas de flux ouvert : leur ajout suppose une licence.
- Sans clé de traduction, les titres restent dans la langue de la source (c'est signalé à l'écran). Une lecture intégralement bilingue des actualités nécessite donc ce module ou une rédaction.
- Les « résumés originaux » et les analyses de relations demandent une rédaction humaine ou la synthèse automatique ; par défaut la plateforme n'affiche que des extraits et des faits sourcés.
- Géo-étiquetage et regroupement par dictionnaire : homonymes et regroupements erronés possibles ; articles FR et EN d'un même événement pas toujours réunis.
- Régions : représentées par un point (pas de contour), noms en anglais. Villes : ≥ 100 000 habitants et capitales ; exonymes français pour ~70 grandes villes.
- Chiffres du commerce bilatéral et registre des traités : non branchés (affiché comme « données non disponibles »).
- Avant mise en production : vérifier les conditions d'utilisation de chaque flux (affichage d'extraits et d'images), ajouter limitation de débit et HTTPS en frontal.

## Données et licences

Natural Earth (domaine public) · mledoze/countries (ODbL) · GeoNames via all-the-cities (CC BY 4.0) · country-state-city (ODbL) · Wikipédia (CC BY-SA) · Wikidata (CC0).
