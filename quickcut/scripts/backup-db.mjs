// 每週備份腳本：把 Supabase（qingjin-quickcut 專案）裡的資料匯出成本地檔案。
// 免費方案沒有 Supabase 內建的每日自動備份（那是 Pro 以上才有），所以自己排程跑這支。
//
// 每張表各一份 JSON（保留完整型別，之後要還原用）＋ CSV（能直接用 Excel/Numbers/
// Google 試算表打開看）。另外產生一份 manifest.md 摘要報告，不用開 JSON/CSV 也能
// 一眼看出這次備份了幾筆資料。全部打包成 tar.gz 存到 _backups/，自動清掉超過保留
// 週數的舊備份。
//
// 不備份 shop_secrets（店內/店長密碼的雜湊值）：備份檔案只拿來看資料、救資料用，
// 密碼復原走「忘記密碼」流程即可，沒有理由讓雜湊值多一份副本躺在備份裡。
//
// 執行方式：cd quickcut/scripts && node backup-db.mjs（需要先準備 .env.local，見
// .env.local.example）

import { Pool } from "pg";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKUP_ROOT = join(__dirname, "_backups");
const KEEP_WEEKS = 12; // 保留最近 12 份週備份（約 3 個月）
const SHOP_ID = "qingjin";

// 匯出順序（跟資料的因果關係一致，方便對照；shop_secrets 不備份，理由見檔頭說明）。
const TABLE_ORDER = ["shops", "designers", "tickets", "days_off", "call_log", "page_views"];

function loadEnvLocal() {
  const envPath = join(__dirname, ".env.local");
  if (!existsSync(envPath)) throw new Error(`找不到 .env.local: ${envPath}（請參考 .env.local.example）`);
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(","));
  }
  return lines.join("\n");
}

async function queryTable(pool, table) {
  if (table === "shops") return pool.query(`select * from shops where id = $1`, [SHOP_ID]);
  if (table === "designers") return pool.query(`select * from designers where shop_id = $1 order by sort`, [SHOP_ID]);
  if (table === "days_off") return pool.query(`select * from days_off where shop_id = $1 order by day`, [SHOP_ID]);
  if (table === "page_views") return pool.query(`select * from page_views where shop_id = $1 order by created_at`, [SHOP_ID]);
  // tickets、call_log 量比較大：照時間排序，備份檔案裡比較好對照
  if (table === "tickets") return pool.query(`select * from tickets where shop_id = $1 order by day, number`, [SHOP_ID]);
  if (table === "call_log") return pool.query(`select * from call_log where shop_id = $1 order by created_at`, [SHOP_ID]);
  throw new Error(`未知的資料表：${table}`);
}

function buildManifestMarkdown(manifest) {
  const lines = [
    `# 快剪資料庫備份報告 ${manifest.backupDate}`,
    "",
    `生成時間：${manifest.generatedAt}`,
    "",
    "| 資料表 | 筆數 |",
    "|---|---|",
  ];
  for (const table of TABLE_ORDER) lines.push(`| ${table} | ${manifest.tables[table] ?? 0} |`);
  lines.push("", `**總計：${manifest.totalRows} 筆**`);
  return lines.join("\n");
}

async function main() {
  loadEnvLocal();
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("找不到 SUPABASE_DB_URL / DATABASE_URL");

  const pool = new Pool({ connectionString });
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dayDir = join(BACKUP_ROOT, dateStr);
  mkdirSync(dayDir, { recursive: true });

  try {
    const manifest = { backupDate: dateStr, generatedAt: new Date().toISOString(), tables: {}, totalRows: 0 };

    for (const table of TABLE_ORDER) {
      const { rows } = await queryTable(pool, table);
      writeFileSync(join(dayDir, `${table}.json`), JSON.stringify(rows, null, 2), "utf8");
      writeFileSync(join(dayDir, `${table}.csv`), toCsv(rows), "utf8");
      manifest.tables[table] = rows.length;
      manifest.totalRows += rows.length;
      log(`匯出 ${table}：${rows.length} 筆`);
    }

    writeFileSync(join(dayDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    writeFileSync(join(dayDir, "manifest.md"), buildManifestMarkdown(manifest), "utf8");

    // 打包成 tar.gz，刪掉未壓縮的資料夾
    const archiveName = `backup-${dateStr}.tar.gz`;
    execFileSync("tar", ["-czf", archiveName, dateStr], { cwd: BACKUP_ROOT });
    rmSync(dayDir, { recursive: true, force: true });
    log(`已打包：${join(BACKUP_ROOT, archiveName)}`);

    // 清掉超過保留週數的舊備份
    const archives = readdirSync(BACKUP_ROOT)
      .filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(f))
      .sort();
    const toDelete = archives.slice(0, Math.max(0, archives.length - KEEP_WEEKS));
    for (const f of toDelete) {
      rmSync(join(BACKUP_ROOT, f));
      log(`已刪除舊備份：${f}`);
    }

    log(`備份完成，共 ${manifest.totalRows} 筆資料，保留 ${archives.length - toDelete.length} 份備份。`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] 備份失敗：${err.stack ?? err}`);
  process.exit(1);
});
