
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { ask, json } = require('../ai');

const TARGET = Number.parseInt(process.argv[2], 10) || 1000;
const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 10;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getKey(value) {
  return normalize(value).split(' ').slice(0, 2).join(' ');
}

function getText(value) {
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

async function callAI(system, content, maxTokens = 8192) {
  return ask({
    system,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }]
  });
}

async function askWithRetry(system, content, maxTokens = 8192) {
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      return await callAI(system, content, maxTokens);
    } catch (error) {
      const temporary =
        /429|500|502|503|504|high demand|fetch failed|temporar/i
          .test(String(error.message || error));

      if (!temporary || attempt === 5) throw error;

      const delay = Math.min(15000 * (2 ** attempt), 120000);

      console.log(
        `AI temporarily unavailable. Retrying in ${delay / 1000}s...`
      );

      await sleep(delay);
    }
  }
}

function getCount() {
  return db.prepare(
    'SELECT COUNT(*) AS count FROM herbs'
  ).get().count;
}

// --------------------------------------------------
// 1. COLLECT PLANT NAMES
// --------------------------------------------------

async function collect() {
  console.log(`\nTarget: ${TARGET} plants`);

  let stalled = 0;

  while (getCount() < TARGET && stalled < 5) {
    const existing = db.prepare(
      'SELECT sci_key, sci FROM herbs'
    ).all();

    const existingKeys = new Set(
      existing.flatMap(row => [
        normalize(row.sci_key),
        normalize(row.sci)
      ])
    );

    const remaining = TARGET - getCount();

    const system = `
You are a botanical research assistant specializing in Indian medicinal plants.

Return only valid JSON.
Use genuine botanical scientific names.
Do not invent species.
Avoid duplicate species.
`;

    const prompt = `
Generate up to ${Math.min(40, remaining + 10)}
genuine medicinal plants found or cultivated in India.

Return a JSON array with these fields:

[
  {
    "scientific_name": "Ocimum tenuiflorum",
    "common_name_en": "Holy Basil",
    "common_name_hi": "Hindi name",
    "common_name_kn": "Kannada name"
  }
]

Avoid these existing scientific names:
${existing.map(row => row.sci).join(', ')}

Do not return multiple common names for the same species.
`;

    try {
      const response = await askWithRetry(system, prompt);
      const records = json(response);

      if (!Array.isArray(records)) {
        throw new Error('Invalid plant list returned by AI');
      }

      const insert = db.prepare(`
        INSERT OR IGNORE INTO herbs
        (sci_key, sci, en, hi, kn)
        VALUES (?, ?, ?, ?, ?)
      `);

      let added = 0;

      for (const plant of records) {
        const scientific = getText(plant.scientific_name).trim();
        const english = getText(plant.common_name_en).trim();

        if (!scientific || !english) continue;

        const key = getKey(scientific);

        if (
          existingKeys.has(normalize(scientific)) ||
          existingKeys.has(normalize(key))
        ) {
          continue;
        }

        const result = insert.run(
          key,
          scientific,
          english,
          getText(plant.common_name_hi),
          getText(plant.common_name_kn)
        );

        added += result.changes;

        existingKeys.add(normalize(scientific));
        existingKeys.add(normalize(key));
      }

      console.log(`Added ${added} plants. Total: ${getCount()}`);

      stalled = added === 0 ? stalled + 1 : 0;

      await sleep(2000);

    } catch (error) {
      console.log('Collection error:', error.message);
      stalled++;
      await sleep(5000);
    }
  }

  if (getCount() < TARGET) {
    console.log('Could not reach the target yet. Run again to resume.');
  } else {
    console.log('Plant name collection completed.');
  }
}

// --------------------------------------------------
// 2. DATABASE SAVE STATEMENTS
// --------------------------------------------------

const updateHerb = db.prepare(`
  UPDATE herbs SET
    parts = ?,
    uses = ?,
    prep = ?,
    benefits = ?,
    evidence = ?,
    precautions = ?,
    description = ?,
    enriched = 1,
    attempts = attempts + 1
  WHERE id = ?
`);

const saveTranslation = db.prepare(`
  INSERT INTO translations (herb_id, lang, scope, data)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(herb_id, lang, scope)
  DO UPDATE SET data = excluded.data
`);

const increaseAttempt = db.prepare(`
  UPDATE herbs
  SET attempts = attempts + 1
  WHERE id = ?
`);

function saveOnePlant(herb, result) {
  const english = {
    description: getText(result.description_en),
    uses: getText(result.uses_en),
    prep: getText(result.prep_en),
    benefits: getText(result.benefits_en),
    precautions: getText(result.precautions_en),
    parts: getText(result.parts),
    evidence: getText(result.evidence_en)
  };

  const hindi = {
    description: getText(result.description_hi),
    uses: getText(result.uses_hi),
    prep: getText(result.prep_hi),
    benefits: getText(result.benefits_hi),
    precautions: getText(result.precautions_hi)
  };

  const kannada = {
    description: getText(result.description_kn),
    uses: getText(result.uses_kn),
    prep: getText(result.prep_kn),
    benefits: getText(result.benefits_kn),
    precautions: getText(result.precautions_kn)
  };

  const saveTransaction = db.transaction(() => {
    // Exactly 8 values for 8 SQL parameters.
    updateHerb.run(
      english.parts,
      english.uses,
      english.prep,
      english.benefits,
      english.evidence,
      english.precautions,
      english.description,
      herb.id
    );

    // Exactly 4 values for 4 SQL parameters.
    saveTranslation.run(
      herb.id, 'en', 'details', JSON.stringify(english)
    );

    saveTranslation.run(
      herb.id, 'hi', 'details', JSON.stringify(hindi)
    );

    saveTranslation.run(
      herb.id, 'kn', 'details', JSON.stringify(kannada)
    );
  });

  saveTransaction();
}

// --------------------------------------------------
// 3. MATCH AI RESPONSES TO PLANTS
// --------------------------------------------------

function findResult(records, herb) {
  const scientificName = normalize(herb.sci);
  const commonName = normalize(herb.en);

  // First try the complete scientific name.
  let match = records.find(item =>
    normalize(item.scientific_name) === scientificName
  );

  if (match) return match;

  // Fallback: try the common English name.
  match = records.find(item => {
    const returnedName = normalize(
      item.common_name_en || item.common_name || item.name
    );

    return returnedName && returnedName === commonName;
  });

  return match || null;
}

// --------------------------------------------------
// 4. ENRICH PLANT INFORMATION
// --------------------------------------------------

async function enrichBatch(rows) {
  if (!rows.length) return;

  const system = `
You are an expert botanical information assistant.

Provide cautious, accurate information about Indian medicinal plants.

Return ONLY a valid JSON array.

For every plant return:
- scientific_name
- parts
- uses_en
- prep_en
- benefits_en
- evidence_en
- precautions_en
- description_en
- description_hi
- description_kn
- uses_hi
- uses_kn
- prep_hi
- prep_kn
- benefits_hi
- benefits_kn
- precautions_hi
- precautions_kn

Rules:
1. Use simple language.
2. Write Hindi in Devanagari.
3. Write Kannada in Kannada script.
4. Do not invent medical claims.
5. Distinguish traditional uses from proven benefits.
6. Mention uncertainty where information is unavailable.
7. Never recommend replacing prescribed medicines.
8. Copy each supplied scientific name exactly.
9. Return one object for every supplied plant.
`;

  const prompt = `
Prepare information for these plants.

IMPORTANT:
The scientific_name in each response MUST exactly match
the scientific name supplied below.

${rows.map((plant, index) =>
  `${index + 1}. Scientific name: ${plant.sci}
Common English name: ${plant.en}`
).join('\n\n')}

Return a JSON array containing one object per plant.
`;

  let records;

  try {
    const response = await askWithRetry(system, prompt, 8192);
    records = json(response);

    if (!Array.isArray(records)) {
      throw new Error('AI did not return a JSON array.');
    }

  } catch (error) {
    if (rows.length > 1) {
      console.log('Batch failed. Splitting into smaller batches:', error.message);

      const middle = Math.ceil(rows.length / 2);

      await enrichBatch(rows.slice(0, middle));
      await sleep(3000);
      await enrichBatch(rows.slice(middle));

      return;
    }

    increaseAttempt.run(rows[0].id);

    console.log(
      `Could not get AI information for ${rows[0].en}: ${error.message}`
    );

    return;
  }

  for (const herb of rows) {
    const result = findResult(records, herb);

    if (!result) {
      increaseAttempt.run(herb.id);

      console.log(
        `No matching AI response for ${herb.en}. Attempt recorded.`
      );

      continue;
    }

    try {
      saveOnePlant(herb, result);

      console.log(`Described: ${herb.en}`);

    } catch (error) {
      increaseAttempt.run(herb.id);

      console.log(
        `Database error for ${herb.en}: ${error.message}`
      );

      console.log(error.stack);
    }
  }
}

// --------------------------------------------------
// 5. ENRICH ALL PLANTS
// --------------------------------------------------

async function enrichAll() {
  console.log('\nStarting plant descriptions and translations...');

  while (true) {
    const rows = db.prepare(`
      SELECT *
      FROM herbs
      WHERE enriched = 0 AND attempts < ?
      ORDER BY id
      LIMIT ?
    `).all(MAX_ATTEMPTS, BATCH_SIZE);

    if (!rows.length) break;

    console.log(`\nProcessing ${rows.length} plants...`);

    await enrichBatch(rows);
    await sleep(3000);
  }

  console.log('\nDescription process completed.');
}

// --------------------------------------------------
// 6. DATABASE REPORT
// --------------------------------------------------

function report() {
  const total = getCount();

  const described = db.prepare(`
    SELECT COUNT(*) AS count
    FROM herbs
    WHERE enriched = 1
  `).get().count;

  const photos = db.prepare(`
    SELECT COUNT(*) AS count
    FROM herbs
    WHERE image IS NOT NULL AND image != ''
  `).get().count;

  const translations = db.prepare(`
    SELECT COUNT(*) AS count
    FROM translations
  `).get().count;

  const pending = db.prepare(`
    SELECT COUNT(*) AS count
    FROM herbs
    WHERE enriched = 0 AND attempts < ?
  `).get(MAX_ATTEMPTS).count;

  console.log('\n========== DATABASE STATUS ==========');
  console.log(`Total plants: ${total}`);
  console.log(`Described plants: ${described}`);
  console.log(`Plants with photos: ${photos}`);
  console.log(`Translation records: ${translations}`);
  console.log(`Plants still pending: ${pending}`);
  console.log('=====================================');

  if (total >= TARGET && described === total) {
    fs.writeFileSync(
      path.join(__dirname, '..', 'seeded.flag'),
      new Date().toISOString()
    );

    console.log('\nAll plants have descriptions and translations!');
  } else {
    console.log('\nSome plants still need information.');
    console.log('You can run node scripts/seed.js again to resume.');
  }
}

// --------------------------------------------------
// 7. MAIN
// --------------------------------------------------

async function main() {
  try {
    await collect();
    await enrichAll();
    report();

  } catch (error) {
    console.error('\nSEED ERROR:', error.message);
    console.error(error.stack);
    process.exitCode = 1;

  } finally {
    db.close();
  }
}

main();
