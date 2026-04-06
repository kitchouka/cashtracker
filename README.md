# 💶 CashTracker

Money manager famille — simple, local, privacy-first.

## Stack

- **Backend** : Node.js + Express + better-sqlite3
- **Frontend** : Vanilla JS + Tailwind CSS (CDN) + Chart.js
- **OCR** : Mindee API (optionnel, tickets de caisse)

## Démarrage rapide

```bash
cd cashtracker
npm install
npm start
# → http://localhost:3030
```

## Configuration

Copier `.env.example` en `.env` et renseigner les variables :

```env
PORT=3030
MINDEE_API_KEY=xxxxxxxxxxxx   # optionnel — OCR tickets de caisse
```

## Fonctionnalités

- 📊 **Dashboard** mensuel — totaux perso/famille + graphe par catégorie
- 💸 **Dépenses** — ajout manuel ou via photo ticket (OCR Mindee)
- 📥 **Import relevé bancaire CSV** — Caisse d'Épargne & Boursorama auto-détectés
  - Auto-catégorisation par mots-clés (Carrefour → Alimentation, SNCF → Transport…)
  - Preview + sélection avant import
- ⚙️ **Multi-utilisateurs** — profils colorés, portée perso/famille
- 📤 **Export CSV** compatible Excel (BOM UTF-8)

## Formats d'import CSV supportés

| Banque | Colonnes | Séparateur |
|--------|----------|-----------|
| Caisse d'Épargne | Date ; Libellé ; Débit euros ; Crédit euros | `;` |
| Boursorama | dateOp ; dateVal ; label ; category ; amount | `;` |

Le format est **auto-détecté** à partir des en-têtes du fichier.

## Structure

```
cashtracker/
├── server.js        # API Express
├── db.js            # SQLite init + seed
├── public/
│   ├── index.html   # SPA
│   ├── app.js       # Frontend JS
│   └── style.css    # Styles complémentaires
├── receipts/        # Tickets OCR (ignoré par git)
└── data.db          # Base SQLite (ignorée par git)
```
