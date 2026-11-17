# Générateur de présentations — Preference Events

Assemble un PowerPoint « Marrakech » (hôtels, restaurants, activités, agenda) à partir de modèles PPTX, selon le formulaire rempli par l'équipe.

- `frontend/` : React + Vite + Tailwind (Netlify). Assistant en 4 étapes : événement, hébergement, programme, génération.
- `backend/` : FastAPI + python-pptx (Render, Docker). `POST /generate` renvoie le `.pptx`.

## Les modèles PPTX

| Fichier | Rôle |
|---|---|
| `PRESENTATION_MARRAKECH.pptx` | La nouvelle charte : page de garde, projet, Marrakech, agendas 2/3/4 jours, plan de transport, slide « jour » |
| `liste_HOTELS.pptx`, `liste_REPAS.pptx`, `liste_ACTIVITES.pptx` | Une plage de slides par hôtel / restaurant / activité (`backend/index.json`) |
| `liste_JOUR_N.pptx` | Les photos utilisées sur la slide « jour » |
| `SLIDES_FIN.pptx` | Annexes, RSE, contact, merci |

`backend/index.json` donne, pour chaque nom, le fichier, le numéro de la première slide (`index`) et le nombre de slides (`nb_slides`). **Si une slide est ajoutée ou retirée dans un modèle, mettre à jour ces numéros.**

### Refaire un modèle dans la nouvelle charte

`migrate_to_new_da.py` reconstruit un ancien modèle slide par slide (mêmes numéros, même nombre de slides) avec les mises en page de `PRESENTATION_MARRAKECH.pptx` :

```bash
backend/.venv/bin/python migrate_to_new_da.py PPTX_PREF/liste_HOTELS.pptx PPTX_PREF/liste_HOTELS_NEW.pptx
backend/.venv/bin/python migrate_to_new_da.py PPTX_PREF/liste_REPAS.pptx PPTX_PREF/liste_REPAS_NEW.pptx
```

`--slides 120-135` ne convertit qu'une plage, pour vérifier le rendu. Les slides qui ne correspondent à aucune mise en page gardent leur ancienne géométrie (liste affichée à la fin).

## Lancer en local

```bash
./run-local.sh        # backend sur :8000, frontend sur :5173
```

Le backend cherche les modèles dans `backend/`. Pour une utilisation locale, y mettre (ou lier) les `.pptx` ci-dessus, puis :

```bash
cd backend && python build_slices.py   # optionnel : découpe les gros modèles, génération bien plus rapide
```

## Déploiement

1. Après avoir (re)fait les modèles : `cd backend && python build_slices.py && python make_bundle.py` crée `PPTX_PREF/templates_bundle.zip` (slices + petits modèles, environ 400 Mo).
2. Déposer ce zip (ou le dossier décompressé, un lien de dossier en `dl=1` donne aussi un zip) sur Dropbox, copier le lien de partage en remplaçant `dl=0` par `dl=1`, et le coller dans `backend/assets_manifest.json` (`templates_bundle.zip`).
3. Le `Dockerfile` télécharge et décompresse le bundle au build (`fetch_assets.py`). Il échoue volontairement tant qu'une URL est encore `REPLACE_WITH_PRESIGNED_URL`.

Le serveur n'ouvre que de petits fichiers : mémoire et temps de génération faibles.

## Cloud Run (alternative à Render, facturé à l'usage)

Le serveur ne travaille que quelques secondes par présentation : sur Cloud Run il s'éteint tout seul quand personne ne s'en sert (« min instances = 0 ») et on ne paie que ces secondes. Le même `Dockerfile` convient, rien à changer dans le code. Mémoire d'une génération : environ 0,5 Go, donc 2 Gio laissent de la marge.

Une fois le projet Google Cloud créé (facturation activée) et `gcloud` installé, depuis la racine du dépôt :

```bash
gcloud run deploy ppt-generator-api --source . --region europe-west1 \
  --memory 2Gi --cpu 1 --concurrency 1 --timeout 300 --min-instances 0 --max-instances 3 \
  --allow-unauthenticated \
  --set-env-vars APP_PASSWORD=...,GEMINI_API_KEY=...,ADMIN_CODE=...
```

- `--concurrency 1` : une génération par instance (elles sont gourmandes en mémoire), Cloud Run en lance une autre au besoin.
- Premier appel après une période d'inactivité : démarrage à froid de quelques secondes à une trentaine de secondes.
- Le fichier de coûts de la page admin est remis à zéro à chaque nouvelle instance (comme sur Render sans Disk).
- Le site doit ensuite pointer vers l'adresse Cloud Run : variable `VITE_API_URL` au build du site, ou la valeur par défaut dans `frontend/src/ui/App.tsx`.

## Assistant (Gemini Flash)

La page d'accueil propose un assistant qui pose des questions et remplit le formulaire (texte ou dictée avec le micro). Il appelle Gemini Flash **depuis le serveur** (`POST /agent`) : la clé ne doit jamais être dans le site, dont le code est public.

- Sur Render, onglet **Environment** : ajouter `APP_PASSWORD` (le mot de passe du site, vérifié par le serveur : sans lui, personne ne peut se connecter) et `GEMINI_API_KEY` (clé créée sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Optionnel : `GEMINI_MODEL` (par défaut `gemini-3.5-flash-lite`, rapide). Optionnel aussi : `GEMINI_VOICE` (voix de l’assistant, par défaut `Charon`, voix d’homme grave ; d’autres : `Umbriel`, `Enceladus`, `Algenib`, ou des voix de femme comme `Kore`, `Aoede`).
- En local, lancer le serveur avec un mot de passe : `APP_PASSWORD=test uvicorn main:app --port 8000`.
- En local : `GEMINI_API_KEY=... uvicorn main:app --port 8000` dans `backend/`.
- Les noms proposés par l'assistant sont vérifiés côté serveur contre `index.json` (hôtels, restaurants, activités) : rien d'inventé n'arrive dans le formulaire.
- Sans clé, l'assistant répond qu'il n'est pas configuré et le formulaire manuel reste utilisable.
- Test sans appeler Gemini : `cd backend && python test_agent.py`.
- La dictée utilise la reconnaissance vocale du navigateur (Chrome, Edge, Safari) : elle ne demande aucune clé.

### Voix de l’assistant et quota Gemini
La voix utilise Gemini TTS (`gemini-3.8-flash-lite-tts`, repli `gemini-3.8-flash-tts`), diffusée en streaming : le premier son arrive en ~1 s. **Sur l’offre gratuite Google, ces modèles sont limités à 10 requêtes par jour et par modèle**, ce qui coupe la voix très vite. Pour un usage réel, activer la facturation sur le projet Google de la clé (aistudio.google.com → Clés API → configurer la facturation) : une réponse parlée coûte environ 0,1 centime, et cela lève aussi la limite du modèle texte `gemini-3.5-flash`.

### Page admin (coûts, modèle, voix)
Le bouton graphique en haut à droite du site ouvre la page admin, protégée par un code distinct du mot de passe du site.
- Sur Render → **Environment** : ajouter `ADMIN_CODE` (le code de ton choix). Sans lui, la page admin reste fermée.
- Pour **garder l’historique des coûts** entre les déploiements : Render → service → **Disks** → *Add Disk* (nom au choix, **Mount Path `/data`**, 1 Go suffit). Sans disque, les données sont effacées à chaque déploiement (la page l’indique).
- Les coûts sont calculés avec les tarifs publics de Google (modifiables dans la page, section « Tarifs »). Ce sont des estimations : la facture réelle est dans Google AI Studio / Cloud Billing.
- Depuis la page : choix du modèle de l’assistant et de la voix, sans redéploiement. La clé API se change toujours dans Render (`GEMINI_API_KEY`).

