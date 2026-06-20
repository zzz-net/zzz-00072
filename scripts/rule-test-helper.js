import Database from 'better-sqlite3';

const dbPath = process.argv[2];
const action = process.argv[3];

if (!dbPath || !action) {
  console.error('Usage: node rule-test-helper.js <db-path> <insert|delete|get-active|count-by-version> [args...]');
  process.exit(1);
}

const db = new Database(dbPath);

try {
  if (action === 'insert') {
    const [id, version, pct, abs, tmin, tmax, desc] = process.argv.slice(4);
    const stmt = db.prepare(`
      INSERT INTO rules (id, version, is_active, over_prep_threshold_pct, over_prep_threshold_abs, spoilage_temp_min, spoilage_temp_max, created_at, description)
      VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(id, version, Number(pct), Number(abs), Number(tmin), Number(tmax), new Date().toISOString(), desc);
    console.log(JSON.stringify({ success: true, changes: result.changes }));
  } else if (action === 'delete') {
    const id = process.argv[4];
    const result = db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    console.log(JSON.stringify({ success: true, changes: result.changes }));
  } else if (action === 'get-active') {
    const row = db.prepare('SELECT id, version FROM rules WHERE is_active = 1 LIMIT 1').get();
    console.log(JSON.stringify({ success: true, active: row || null }));
  } else if (action === 'count-by-version') {
    const version = process.argv[4];
    const row = db.prepare('SELECT COUNT(*) as cnt FROM rules WHERE version = ?').get(version);
    console.log(JSON.stringify({ success: true, count: row.cnt }));
  } else {
    console.error('Unknown action:', action);
    process.exit(1);
  }
} catch (e) {
  console.log(JSON.stringify({ success: false, error: e.message }));
  process.exit(0);
} finally {
  db.close();
}
