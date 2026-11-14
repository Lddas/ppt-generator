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

Le `Dockerfile` télécharge les modèles (`backend/assets_manifest.json`), les découpe en petits fichiers (`build_slices.py`) et supprime les originaux : le serveur n'ouvre que de petits fichiers, ce qui limite la mémoire. Le build échoue tant qu'une entrée du manifeste a encore une URL `REPLACE_WITH_PRESIGNED_URL` : déposer les nouveaux modèles (Dropbox, lien `?dl=1`) puis remplacer les URL.
