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

## Assistant (Gemini Flash)

La page d'accueil propose un assistant qui pose des questions et remplit le formulaire (texte ou dictée avec le micro). Il appelle Gemini Flash **depuis le serveur** (`POST /agent`) : la clé ne doit jamais être dans le site, dont le code est public.

- Sur Render, onglet **Environment** : ajouter `APP_PASSWORD` (le mot de passe du site, vérifié par le serveur : sans lui, personne ne peut se connecter) et `GEMINI_API_KEY` (clé créée sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey)). Optionnel : `GEMINI_MODEL` (par défaut `gemini-3.5-flash`). Optionnel aussi : `GEMINI_VOICE` (voix de l’assistant, par défaut `Charon`, voix d’homme grave ; d’autres : `Umbriel`, `Enceladus`, `Algenib`, ou des voix de femme comme `Kore`, `Aoede`).
- En local, lancer le serveur avec un mot de passe : `APP_PASSWORD=test uvicorn main:app --port 8000`.
- En local : `GEMINI_API_KEY=... uvicorn main:app --port 8000` dans `backend/`.
- Les noms proposés par l'assistant sont vérifiés côté serveur contre `index.json` (hôtels, restaurants, activités) : rien d'inventé n'arrive dans le formulaire.
- Sans clé, l'assistant répond qu'il n'est pas configuré et le formulaire manuel reste utilisable.
- Test sans appeler Gemini : `cd backend && python test_agent.py`.
- La dictée utilise la reconnaissance vocale du navigateur (Chrome, Edge, Safari) : elle ne demande aucune clé.
