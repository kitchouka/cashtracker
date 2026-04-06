try { require('dotenv').config(); } catch(e) {}
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const fetch   = require('node-fetch');
const pdfParse = require('pdf-parse');
const db      = require('./db');

const app  = express();
const PORT = process.env.PORT || 3030;

// ── Multer storages ──────────────────────────────────────────────────────────
const receiptStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'receipts');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const uploadReceipt = multer({ storage: receiptStorage });
const uploadCSV     = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/receipts', express.static(path.join(__dirname, 'receipts')));

// ── Keyword → category mapping ───────────────────────────────────────────────
const KEYWORD_RULES = [
  {
    keywords: ['CARREFOUR','LECLERC','LIDL','ALDI','INTERMARCHE','MONOPRIX',
               'CASINO','SUPER U','FRANPRIX','PICARD','AUCHAN','CORA','BIOCOOP'],
    category: 'Alimentation'
  },
  {
    keywords: ['SNCF','RATP','PARKING','TOTAL','BP','SHELL','ESSO',
               'UBER','BLABLACAR','PEAGE','AUTOROUTE','VINCI','SANEF','TRANSILIEN'],
    category: 'Transport'
  },
  {
    keywords: ['EDF','GDF','ENGIE','ORANGE','SFR','FREE','BOUYGUES',
               'LOYER','ASSURANCE','VEOLIA','SUEZ','AXA','MAIF','MAAF'],
    category: 'Maison'
  },
  {
    keywords: ['RESTAURANT','BRASSERIE','CINEMA','THEATRE','NETFLIX',
               'SPOTIFY','AMAZON PRIME','DISNEY','FNAC','CULTURE'],
    category: 'Sorties'
  },
  {
    keywords: ['PHARMACIE','MEDECIN','DOCTEUR','CLINIQUE','MUTUELLE',
               'CPAM','AMELI','HOPITAL','DENTISTE','OPHTALMO'],
    category: 'Santé'
  },
  {
    keywords: ['ZARA','H&M','HM','KIABI','DECATHLON','ADIDAS','NIKE',
               'UNIQLO','PRIMARK','JULES','CAMAIEU','ETAM'],
    category: 'Vêtements'
  },
];

function guessCategoryId(label) {
  const up = label.toUpperCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some(k => up.includes(k))) {
      const row = db.prepare('SELECT id FROM categories WHERE name = ?').get(rule.category);
      if (row) return row.id;
    }
  }
  const divers = db.prepare('SELECT id FROM categories WHERE name = ?').get('Divers');
  return divers ? divers.id : null;
}

// ── CSV bank format detection & parsing ─────────────────────────────────────
function detectBankFormat(rawText) {
  const firstLine = rawText.split(/\r?\n/)[0] || '';
  const norm = firstLine.toLowerCase().replace(/[éèê]/g,'e');
  // Boursorama: colonnes dateOp/dateVal
  if (norm.includes('dateop') || norm.includes('dateval')) return 'boursorama';
  // Caisse d'Épargne CSV : première ligne avec ";" et colonnes libelle/debit
  if (firstLine.includes(';') && (norm.includes('libelle') || norm.includes('debit'))) return 'caisse-epargne-csv';
  // Caisse d'Épargne vertical : premier champ seul sur sa ligne
  const normFull = rawText.slice(0, 1000).toLowerCase().replace(/[éèê]/g,'e');
  if (normFull.includes('libelle simplifie') || normFull.includes('pointage operation')) return 'caisse-epargne-vertical';
  if (normFull.includes('amount')) return 'boursorama';
  return null;
}

// Parse Caisse d'Épargne vertical format (1 champ par ligne, 13 champs par transaction)
function parseCaisseEpargneVertical(rawText) {
  const BLOCK_SIZE = 13; // champs par transaction
  const lines = rawText.split(/\r?\n/).map(l => l.trim());
  const rows = [];

  // Trouver le début du bloc d'en-tête
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const normalized = lines[i].toLowerCase().replace(/[éèê]/g, 'e');
    if (normalized === 'date de comptabilisation') { startIdx = i; break; }
  }
  if (startIdx === -1) return [];

  // Sauter le bloc d'en-tête, lire les transactions
  let i = startIdx + BLOCK_SIZE;
  while (i + BLOCK_SIZE <= lines.length) {
    const block = lines.slice(i, i + BLOCK_SIZE);
    // block[0] = date comptabilisation, block[1] = libellé simplifié, block[8] = débit, block[9] = crédit
    const dateStr   = block[0];
    const label     = block[1] || block[2] || '';
    const debitRaw  = block[8];

    const debit = parseFloat((debitRaw || '').replace(',', '.').replace(/\s/g, ''));
    if (!isNaN(debit) && debit < 0 && dateStr) {
      rows.push({
        date:        normalizeDate(dateStr),
        label:       label.trim(),
        amount:      Math.abs(debit),
        category_id: guessCategoryId(label),
      });
    }
    i += BLOCK_SIZE;
  }
  return rows;
}

function parseCSVLine(line, sep = ';') {
  // Basic CSV parse that handles quoted fields
  const result = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  result.push(field.trim());
  return result;
}

function parseBankCSV(rawText) {
  const format = detectBankFormat(rawText);
  if (!format) return { format: null, rows: [] };

  // Format vertical Caisse d'Épargne
  if (format === 'caisse-epargne-vertical') {
    return { format, rows: parseCaisseEpargneVertical(rawText) };
  }

  const lines = rawText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { format: null, rows: [] };

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/['"éèê]/g, c => ({'é':'e','è':'e','ê':'e'}[c]||'')).trim());

  const rows = [];

  if (format === 'boursorama') {
    // dateOp ; dateVal ; label ; category ; amount
    const idxDate   = headers.findIndex(h => h.includes('dateop') || h === 'date');
    const idxLabel  = headers.findIndex(h => h.includes('label') || h.includes('libellé') || h.includes('libelle'));
    const idxAmount = headers.findIndex(h => h.includes('amount') || h.includes('montant'));

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 3) continue;

      const rawAmount = (cols[idxAmount] || '').replace(/['" ]/g, '').replace(',', '.');
      const amount = parseFloat(rawAmount);
      if (isNaN(amount) || amount >= 0) continue; // only debits (negative)

      const dateRaw = (cols[idxDate] || '').replace(/['"]/g, '').trim();
      const label   = (cols[idxLabel] || '').replace(/['"]/g, '').trim();

      rows.push({
        date:        normalizeDate(dateRaw),
        label,
        amount:      Math.abs(amount),
        category_id: guessCategoryId(label),
      });
    }
  } else {
    // Caisse d'Épargne CSV: Date;Libelle simplifie;...;Debit;Credit;...
    // Débit = valeur négative (ex: -15,50), on prend la colonne "debit"
    const idxDate  = headers.findIndex(h => h === 'date de comptabilisation' || h.startsWith('date'));
    const idxLabel = headers.findIndex(h => h === 'libelle simplifie' || h.includes('libelle'));
    const idxDebit = headers.findIndex(h => h === 'debit');

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i], ';');
      if (cols.length < 3) continue;

      const rawDebit = (cols[idxDebit] || '').replace(/['" ]/g, '').replace(',', '.');
      const amount   = parseFloat(rawDebit);
      if (isNaN(amount) || amount >= 0) continue; // garder seulement les débits (négatifs)

      const dateRaw = (cols[idxDate] || '').replace(/['"]/g, '').trim();
      const label   = (cols[idxLabel] || '').replace(/['"]/g, '').trim();

      rows.push({
        date:        normalizeDate(dateRaw),
        label,
        amount:      Math.abs(amount),
        category_id: guessCategoryId(label),
      });
    }
  }

  return { format, rows };
}

function normalizeDate(raw) {
  // Handle DD/MM/YYYY or YYYY-MM-DD
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return raw.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// ── Users ────────────────────────────────────────────────────────────────────
app.get('/api/users', (req, res) => {
  res.json(db.prepare('SELECT * FROM users ORDER BY id').all());
});

app.post('/api/users', (req, res) => {
  const { name, email, color } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  try {
    const info = db.prepare('INSERT INTO users (name, email, color) VALUES (?, ?, ?)').run(name, email, color || '#6366f1');
    res.json(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Categories ───────────────────────────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY id').all());
});

// ── Expenses ─────────────────────────────────────────────────────────────────
app.get('/api/expenses', (req, res) => {
  const { user_id, category_id, scope, month, search } = req.query;
  let sql = `
    SELECT e.*, u.name AS user_name, u.color AS user_color,
           c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (user_id)     { sql += ' AND e.user_id = ?';     params.push(user_id); }
  if (category_id) { sql += ' AND e.category_id = ?'; params.push(category_id); }
  if (scope)       { sql += ' AND e.scope = ?';        params.push(scope); }
  if (month)       { sql += ' AND strftime(\'%Y-%m\', e.date) = ?'; params.push(month); }
  if (search)      { sql += ' AND (e.merchant LIKE ? OR e.raw_label LIKE ? OR e.note LIKE ?)';
                     const s = `%${search}%`;
                     params.push(s, s, s); }
  sql += ' ORDER BY e.date DESC, e.id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/expenses', (req, res) => {
  const { user_id, amount, currency, merchant, category_id, date, note, scope, source, raw_label } = req.body;
  if (!user_id || !amount || !date) return res.status(400).json({ error: 'user_id, amount, date required' });
  const info = db.prepare(`
    INSERT INTO expenses (user_id, amount, currency, merchant, category_id, date, note, scope, source, raw_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(user_id, amount, currency || 'EUR', merchant || null, category_id || null, date, note || null,
         scope || 'personal', source || 'manual', raw_label || null);
  res.json(db.prepare(`
    SELECT e.*, u.name AS user_name, u.color AS user_color,
           c.name AS category_name, c.icon AS category_icon, c.color AS category_color
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE e.id = ?
  `).get(info.lastInsertRowid));
});

app.delete('/api/expenses/:id', (req, res) => {
  db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/expenses/export/csv', (req, res) => {
  const { month } = req.query;
  let sql = `
    SELECT e.date, e.merchant, e.raw_label, e.amount, e.currency, e.scope,
           c.name AS category, u.name AS user, e.note
    FROM expenses e
    LEFT JOIN users u ON e.user_id = u.id
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE 1=1
  `;
  const params = [];
  if (month) { sql += " AND strftime('%Y-%m', e.date) = ?"; params.push(month); }
  sql += ' ORDER BY e.date DESC';
  const rows = db.prepare(sql).all(...params);

  const header = 'Date;Enseigne;Libellé;Montant;Devise;Catégorie;Utilisateur;Portée;Note';
  const csv = [header, ...rows.map(r =>
    [r.date, r.merchant||'', r.raw_label||'', r.amount, r.currency,
     r.category||'', r.user||'', r.scope, r.note||''].join(';')
  )].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cashtracker-${month||'export'}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel
});

// ── OCR ──────────────────────────────────────────────────────────────────────
app.post('/api/ocr', uploadReceipt.single('receipt'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const apiKey = process.env.MINDEE_API_KEY;
  if (!apiKey) {
    return res.json({ amount: null, merchant: null, date: null, suggested_category_id: null, mock: true });
  }

  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('document', fs.createReadStream(req.file.path), req.file.originalname);

    const response = await fetch(
      'https://api.mindee.net/v1/products/mindee/expense_receipts/v5/predict',
      { method: 'POST', headers: { 'Authorization': `Token ${apiKey}`, ...form.getHeaders() }, body: form }
    );
    const data = await response.json();
    const doc  = data?.document?.inference?.prediction;

    const merchant = doc?.supplier_name?.value || null;
    const amount   = doc?.total_amount?.value || null;
    const dateVal  = doc?.date?.value || null;

    const suggested_category_id = merchant ? guessCategoryId(merchant) : null;

    res.json({ amount, merchant, date: dateVal, suggested_category_id, receipt_path: `/receipts/${req.file.filename}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PDF bank statement parser (Caisse d'Épargne) ─────────────────────────────
function parseCaisseEpargnePDF(text) {
  const rows = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Caisse d'Épargne PDF format: lines like "DD/MM/YYYY  LIBELLÉ  -XX,XX" or "DD/MM/YYYY  LIBELLÉ  XX,XX"
  // We look for lines starting with a date pattern
  const dateLineRe = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-−]?\d[\d\s]*[,.]?\d{0,2})\s*€?\s*$/;
  // Simpler fallback: date + anything + amount at end
  const dateRe = /^(\d{2}\/\d{2}\/\d{4})/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const dateMatch = line.match(dateRe);
    if (dateMatch) {
      // Try to find amount — might be on same line or next
      const fullMatch = line.match(dateLineRe);
      if (fullMatch) {
        const [, dateStr, label, amountStr] = fullMatch;
        const amount = parseFloat(amountStr.replace(/\s/g, '').replace(',', '.').replace('−', '-'));
        if (!isNaN(amount) && amount < 0) {
          const [d, m, y] = dateStr.split('/');
          rows.push({
            date: `${y}-${m}-${d}`,
            label: label.trim(),
            amount: Math.abs(amount),
            category_id: guessCategoryId(label),
          });
        }
      } else {
        // Multi-line: date on this line, label continues, amount maybe on next line
        const datePart = dateMatch[1];
        let rest = line.slice(datePart.length).trim();
        // Check next lines for continuation until we find an amount
        let j = i + 1;
        while (j < lines.length && !lines[j].match(dateRe)) {
          const amountMatch = lines[j].match(/^([-−]?\d[\d\s]*[,.]\d{2})\s*€?\s*$/);
          if (amountMatch) {
            const amount = parseFloat(amountMatch[1].replace(/\s/g, '').replace(',', '.').replace('−', '-'));
            if (!isNaN(amount) && amount < 0) {
              const [d, m, y] = datePart.split('/');
              rows.push({
                date: `${y}-${m}-${d}`,
                label: rest.trim(),
                amount: Math.abs(amount),
                category_id: guessCategoryId(rest),
              });
            }
            i = j;
            break;
          }
          rest += ' ' + lines[j];
          j++;
        }
      }
    }
    i++;
  }
  return rows;
}

// ── Import CSV ───────────────────────────────────────────────────────────────
app.post('/api/import/csv', uploadCSV.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const raw = req.file.buffer.toString('utf-8').replace(/^\uFEFF/, ''); // strip BOM
  const { format, rows } = parseBankCSV(raw);

  if (!format) return res.status(400).json({ error: 'Format CSV non reconnu' });

  const formatLabel = format === 'boursorama'
    ? 'Format Boursorama détecté ✓'
    : format === 'caisse-epargne-vertical'
      ? 'Format Caisse d\'Épargne (vertical) détecté ✓'
      : 'Format Caisse d\'Épargne détecté ✓';

  res.json({ format, formatLabel, rows, count: rows.length });
});

app.post('/api/import/csv/confirm', (req, res) => {
  const { expenses, user_id, scope } = req.body;
  if (!Array.isArray(expenses) || !user_id) {
    return res.status(400).json({ error: 'expenses[] and user_id required' });
  }

  const insert = db.prepare(`
    INSERT INTO expenses (user_id, amount, currency, merchant, category_id, date, note, scope, source, raw_label)
    VALUES (?, ?, 'EUR', ?, ?, ?, NULL, ?, 'import', ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(user_id, r.amount, r.label || null, r.category_id || null,
                 r.date, scope || 'personal', r.label || null);
    }
  });

  try {
    insertMany(expenses);
    res.json({ ok: true, inserted: expenses.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Import PDF (Caisse d'Épargne) ─────────────────────────────────────────────
const uploadPDF = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/api/import/pdf', uploadPDF.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const data = await pdfParse(req.file.buffer);
    const rows = parseCaisseEpargnePDF(data.text);
    if (rows.length === 0) {
      return res.status(422).json({
        error: 'Aucune dépense détectée dans ce PDF. Vérifiez qu\'il s\'agit bien d\'un relevé Caisse d\'Épargne.',
        text_preview: data.text.slice(0, 500)
      });
    }
    res.json({ format: 'caisse_epargne_pdf', formatLabel: 'Format Caisse d\'Épargne (PDF) détecté ✓', rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lecture PDF : ' + e.message });
  }
});

// ── Stats for dashboard ───────────────────────────────────────────────────────
app.get('/api/stats/monthly', (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: 'month required (YYYY-MM)' });

  const byCategory = db.prepare(`
    SELECT c.name, c.icon, c.color, SUM(e.amount) AS total
    FROM expenses e
    LEFT JOIN categories c ON e.category_id = c.id
    WHERE strftime('%Y-%m', e.date) = ?
    GROUP BY e.category_id
    ORDER BY total DESC
  `).all(month);

  const totals = db.prepare(`
    SELECT
      SUM(amount) AS total,
      SUM(CASE WHEN scope='personal' THEN amount ELSE 0 END) AS personal,
      SUM(CASE WHEN scope='family'   THEN amount ELSE 0 END) AS family
    FROM expenses
    WHERE strftime('%Y-%m', date) = ?
  `).get(month);

  res.json({ byCategory, totals });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`💶 CashTracker running on http://localhost:${PORT}`));
