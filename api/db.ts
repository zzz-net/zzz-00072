import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'canteen.db');

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 0,
      over_prep_threshold_pct REAL NOT NULL,
      over_prep_threshold_abs REAL NOT NULL,
      spoilage_temp_min REAL NOT NULL,
      spoilage_temp_max REAL NOT NULL,
      created_at TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      import_date TEXT NOT NULL,
      total_records INTEGER NOT NULL DEFAULT 0,
      valid_records INTEGER NOT NULL DEFAULT 0,
      error_records INTEGER NOT NULL DEFAULT 0,
      anomaly_count INTEGER NOT NULL DEFAULT 0,
      unresolved_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'importing',
      rule_version_id TEXT NOT NULL,
      FOREIGN KEY (rule_version_id) REFERENCES rules(id)
    );

    CREATE TABLE IF NOT EXISTS weighing_records (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      dish_name TEXT NOT NULL,
      planned_weight REAL NOT NULL,
      actual_weight REAL NOT NULL,
      temperature REAL,
      timestamp TEXT NOT NULL,
      is_valid INTEGER NOT NULL DEFAULT 1,
      error_reason TEXT,
      raw_line TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS anomalies (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      rule_version_id TEXT NOT NULL,
      anomaly_type TEXT NOT NULL,
      evidence TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unresolved',
      manual_reason TEXT,
      manual_result TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE CASCADE,
      FOREIGN KEY (record_id) REFERENCES weighing_records(id) ON DELETE CASCADE,
      FOREIGN KEY (rule_version_id) REFERENCES rules(id)
    );

    CREATE TABLE IF NOT EXISTS review_history (
      id TEXT PRIMARY KEY,
      anomaly_id TEXT NOT NULL,
      action TEXT NOT NULL,
      reason TEXT NOT NULL,
      result TEXT,
      operator TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      batch_operation_id TEXT,
      FOREIGN KEY (anomaly_id) REFERENCES anomalies(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_records_batch ON weighing_records(batch_id);
    CREATE INDEX IF NOT EXISTS idx_anomalies_batch ON anomalies(batch_id);
    CREATE INDEX IF NOT EXISTS idx_anomalies_status ON anomalies(status);
    CREATE INDEX IF NOT EXISTS idx_history_anomaly ON review_history(anomaly_id);

    CREATE TABLE IF NOT EXISTS rule_previews (
      id TEXT PRIMARY KEY,
      target_rule_id TEXT NOT NULL,
      from_active_rule_id TEXT,
      snapshot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      FOREIGN KEY (target_rule_id) REFERENCES rules(id),
      FOREIGN KEY (from_active_rule_id) REFERENCES rules(id)
    );

    CREATE TABLE IF NOT EXISTS rule_activation_logs (
      id TEXT PRIMARY KEY,
      preview_id TEXT,
      from_rule_id TEXT,
      to_rule_id TEXT NOT NULL,
      action TEXT NOT NULL,
      operator TEXT NOT NULL DEFAULT 'system',
      rollback_package_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (preview_id) REFERENCES rule_previews(id),
      FOREIGN KEY (from_rule_id) REFERENCES rules(id),
      FOREIGN KEY (to_rule_id) REFERENCES rules(id)
    );

    CREATE TABLE IF NOT EXISTS rule_rollback_packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      package_data TEXT NOT NULL,
      from_activation_log_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (from_activation_log_id) REFERENCES rule_activation_logs(id)
    );

    CREATE INDEX IF NOT EXISTS idx_previews_status ON rule_previews(status);
    CREATE INDEX IF NOT EXISTS idx_activation_logs_created ON rule_activation_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_rollback_packages_created ON rule_rollback_packages(created_at);

    CREATE TABLE IF NOT EXISTS operation_logs (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'anomaly',
      target_id TEXT,
      detail TEXT,
      operator TEXT NOT NULL DEFAULT 'admin',
      filter_snapshot TEXT,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_op_logs_timestamp ON operation_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_op_logs_action ON operation_logs(action);

    CREATE TABLE IF NOT EXISTS batch_operations (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      applied_result TEXT,
      applied_reason TEXT NOT NULL,
      applied_anomaly_type TEXT,
      filter_snapshot TEXT,
      total_submitted INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      operator TEXT NOT NULL DEFAULT 'admin',
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_batch_ops_timestamp ON batch_operations(timestamp);
    CREATE INDEX IF NOT EXISTS idx_batch_ops_action ON batch_operations(action);
  `);

  const columns = db.prepare('PRAGMA table_info(review_history)').all() as { name: string }[];
  const hasBatchOpId = columns.some(c => c.name === 'batch_operation_id');
  if (!hasBatchOpId) {
    db.exec(`ALTER TABLE review_history ADD COLUMN batch_operation_id TEXT;`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_history_batch_operation ON review_history(batch_operation_id);`);

  const ruleCount = db.prepare('SELECT COUNT(*) as cnt FROM rules').get() as { cnt: number };
  if (ruleCount.cnt === 0) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO rules (id, version, is_active, over_prep_threshold_pct, over_prep_threshold_abs, spoilage_temp_min, spoilage_temp_max, created_at, description)
      VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      'rule_v1_default',
      'v1.0',
      15.0,
      100.0,
      4.0,
      60.0,
      now,
      '默认规则：备餐过量超过计划15%或100g；温度低于4℃或高于60℃怀疑变质'
    );
  }
}

export function getActiveRule() {
  return db.prepare('SELECT * FROM rules WHERE is_active = 1').get();
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
