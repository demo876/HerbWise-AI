
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'herbwise.db');
const db = new Database(DB_PATH);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const USER_AGENT = 'HerbWiseAI/1.0 (educational botanical project)';

async function searchImage(searchName, scientificName) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: searchName,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|mime|extmetadata',
    iiurlwidth: '900',
    format: 'json'
  });

  const url = `https://commons.wikimedia.org/w/api.php?${params}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(25000)
      });

      if (response.status === 429 || response.status === 503) {
        console.log('Wikimedia busy. Waiting...');
        await sleep(15000 * attempt);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const pages = Object.values(data.query?.pages || {});

      const candidates = pages.map(page => {
        const info = page.imageinfo?.[0];
        if (!info) return null;

        const title = page.title || '';
        const description =
          info.extmetadata?.ImageDescription?.value || '';

        const text = `${title} ${description}`
          .replace(/<[^>]*>/g, ' ')
          .toLowerCase();

        const mime = info.mime || '';

        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
          return null;
        }

        if (/logo|icon|flag|map|diagram|chart|symbol|screenshot/i.test(title)) {
          return null;
        }

        const sci = (scientificName || '').toLowerCase().trim();
        const genus = sci.split(/\s+/)[0];

        // Require the full scientific name or a genus match.
        if (!text.includes(sci) && !text.includes(genus)) {
          return null;
        }

        return {
          title,
          url: info.thumburl || info.url,
          exact: text.includes(sci)
        };
      }).filter(Boolean);

      if (!candidates.length) return null;

      candidates.sort((a, b) => Number(b.exact) - Number(a.exact));
      return candidates[0];

    } catch (error) {
      console.log(`Search attempt ${attempt}: ${error.message}`);
      if (attempt < 3) await sleep(5000 * attempt);
    }
  }

  return null;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error('HerbWise database not found.');
  }

  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 10;

  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Enter a valid limit.');
  }

  // Only select plants that have not been searched before.
  const plants = db.prepare(`
    SELECT id, en, sci
    FROM herbs
    WHERE (image IS NULL OR image = '')
      AND COALESCE(img_tried, 0) = 0
    ORDER BY id
    LIMIT ?
  `).all(limit);

  console.log(`New plants to check: ${plants.length}`);

  if (!plants.length) {
    console.log('No unsearched plants remain.');
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = DB_PATH.replace(/\.db$/, `-backup-${stamp}.db`);

  await db.backup(backupPath);
  console.log('Backup created:', backupPath);

  const markTried = db.prepare(`
    UPDATE herbs SET img_tried = 1 WHERE id = ?
  `);

  const saveImage = db.prepare(`
    UPDATE herbs
    SET image = ?, img_tried = 1
    WHERE id = ? AND (image IS NULL OR image = '')
  `);

  let found = 0;
  let missing = 0;

  for (let i = 0; i < plants.length; i++) {
    const plant = plants[i];

    console.log(`\n[${i + 1}/${plants.length}] ${plant.en}`);
    console.log('Scientific name:', plant.sci);

    let result = null;

    if (plant.sci) {
      result = await searchImage(`"${plant.sci}"`, plant.sci);
    }

    // Try common name if scientific-name search fails.
    if (!result && plant.en) {
      console.log('Trying common name...');
      result = await searchImage(`"${plant.en}" plant`, plant.sci);
    }

    if (result) {
      const saved = saveImage.run(result.url, plant.id);

      if (saved.changes > 0) {
        console.log('Image saved:', result.title);
        found++;
      } else {
        console.log('Image was not saved.');
        markTried.run(plant.id);
      }
    } else {
      console.log('No matching image found.');
      markTried.run(plant.id);
      missing++;
    }

    if (i < plants.length - 1) {
      await sleep(5000);
    }
  }

  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN image IS NOT NULL AND image != ''
          THEN 1 ELSE 0 END) AS withImages,
      SUM(CASE WHEN COALESCE(img_tried, 0) = 1
          THEN 1 ELSE 0 END) AS checked
    FROM herbs
  `).get();

  console.log('\n========== IMAGE REPORT ==========');
  console.log('Checked:', plants.length);
  console.log('Images saved:', found);
  console.log('Not found:', missing);
  console.log('Database:', counts);
  console.log('==================================');
}

main()
  .catch(error => {
    console.error('IMAGE ERROR:', error);
    process.exitCode = 1;
  })
  .finally(() => db.close());
