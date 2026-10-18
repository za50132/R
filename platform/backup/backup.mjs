// 客戶資料備份：把共用資料庫裡「每一家客戶」的資料各自匯出成一個資料夾。
//
// 所有客戶共用同一個 Supabase 專案，用客戶代號分開。這支程式會：
//   1. 找出所有客戶（客戶名冊 clients；還沒有名冊的舊資料庫用 shops）
//   2. 找出所有帶客戶代號的資料表：有 client_id 或 shop_id 欄位的表，加上 clients / shops 本身
//      （以後新系統的資料表只要有 client_id 欄位就會自動備份）
//   3. 每家客戶各寫一個資料夾 data/<客戶代號>/latest/：每張表一份 CSV（Excel 直接開）
//      ＋ JSON（完整型別，還原用）＋ manifest.md（這次備份了幾筆）
//   4. 每月 1 號另外留一份 data/<客戶代號>/archive/YYYY-MM/，不靠 git 也找得到月底資料
//
// latest/ 每天覆蓋；放在 git repo 裡，每天的版本都留在 git 歷史中，要找哪一天都查得到。
//
// 不備份 shop_secrets / platform_secrets（密碼雜湊值）：備份是拿來看資料、救資料、
// 交給客戶的，沒有理由讓雜湊值多一份副本。
//
// 執行：SUPABASE_DB_URL=postgresql://... node backup.mjs [輸出資料夾，預設 ./data]

import pg from "pg";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKIP_TABLES = new Set(["shop_secrets", "platform_secrets"]);
const TZ = "Asia/Taipei";

// 日期欄位（例如 tickets.day）保持「2026-10-09」原樣，不要被轉成 UTC 時間
pg.types.setTypeParser(1082, (v) => v);

function loadEnvLocal() {
  const envPath = join(__dirname, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  // 開頭加 BOM，Excel 打開中文才不會變亂碼
  return "﻿" + lines.join("\n") + "\n";
}

const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

// 今天的台北日期（GitHub 的機器是 UTC，凌晨跑會差一天）
function taipeiDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function listClientTables(client) {
  const { rows } = await client.query(`
    select c.table_name,
           array_agg(c.column_name::text order by c.ordinal_position) as columns
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
     group by c.table_name
     order by c.table_name`);
  return rows
    .filter((r) => !SKIP_TABLES.has(r.table_name))
    .filter((r) => ["clients", "shops"].includes(r.table_name) || r.columns.includes("client_id") || r.columns.includes("shop_id"))
    .map((r) => ({ ...r, key: ["clients", "shops"].includes(r.table_name) ? "id" : r.columns.includes("client_id") ? "client_id" : "shop_id" }));
}

// 排序：有時間欄位就照時間，沒有就照第一欄，備份檔比較好對照
function orderBy(columns) {
  for (const c of ["occurred_at", "created_at", "issued_at", "day", "sort", "number", "id"]) if (columns.includes(c)) return quoteIdent(c);
  return quoteIdent(columns[0]);
}

function manifestMd(shop, date, counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return [
    `# ${shop.id} 資料備份 ${date}`,
    "",
    `產生時間：${new Date().toISOString()}（台北日期 ${date}）`,
    "",
    "| 資料表 | 筆數 |",
    "|---|---:|",
    ...Object.entries(counts).map(([t, n]) => `| ${t} | ${n} |`),
    "",
    `**總計：${total} 筆**`,
    "",
    "CSV 可以直接用 Excel / Numbers / Google 試算表打開；JSON 保留完整欄位型別，還原資料時使用。",
    "",
  ].join("\n");
}

async function main() {
  loadEnvLocal();
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error("找不到 SUPABASE_DB_URL（GitHub 請設定在 Secrets；本機請寫在 .env.local）");
  const outRoot = process.argv[2] ?? join(__dirname, "data");
  const date = process.env.BACKUP_DATE ?? taipeiDate(); // BACKUP_DATE 只給測試用
  const isMonthStart = date.endsWith("-01");

  // Supabase 一定要加密連線；本機測試資料庫沒有 SSL
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const client = new pg.Client({ connectionString, ssl: local ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("set default_transaction_read_only = on"); // 備份只讀，絕不寫入
    const tables = await listClientTables(client);
    const registry = tables.some((t) => t.table_name === "clients") ? "clients" : "shops";
    const { rows: shops } = await client.query(`select id from ${registry} order by id`);
    log(`共 ${shops.length} 家客戶、${tables.length} 張資料表：${tables.map((t) => t.table_name).join(", ")}`);

    const summary = [];
    for (const shop of shops) {
      const latest = join(outRoot, shop.id, "latest");
      rmSync(latest, { recursive: true, force: true }); // 整個重寫，刪掉已不存在的資料表
      mkdirSync(latest, { recursive: true });
      const counts = {};
      for (const t of tables) {
        const where = `${quoteIdent(t.key)} = $1`;
        const { rows } = await client.query(
          `select * from ${quoteIdent(t.table_name)} where ${where} order by ${orderBy(t.columns)}`, [shop.id]);
        writeFileSync(join(latest, `${t.table_name}.csv`), toCsv(t.columns, rows), "utf8");
        writeFileSync(join(latest, `${t.table_name}.json`), JSON.stringify(rows, null, 2) + "\n", "utf8");
        counts[t.table_name] = rows.length;
      }
      writeFileSync(join(latest, "manifest.md"), manifestMd(shop, date, counts), "utf8");

      if (isMonthStart) {
        const archive = join(outRoot, shop.id, "archive", date.slice(0, 7));
        rmSync(archive, { recursive: true, force: true });
        mkdirSync(archive, { recursive: true });
        for (const f of [...tables.flatMap((t) => [`${t.table_name}.csv`, `${t.table_name}.json`]), "manifest.md"]) {
          writeFileSync(join(archive, f), readFileSync(join(latest, f)));
        }
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      summary.push(`| ${shop.id} | ${total} |`);
      log(`${shop.id}：${total} 筆`);
    }

    writeFileSync(join(outRoot, "README.md"), [
      "# 客戶資料備份",
      "",
      `最後備份：台北日期 ${date}`,
      "",
      "每家客戶一個資料夾：`latest/` 是最新一份，`archive/YYYY-MM/` 是每月 1 號的存檔。",
      "要找某一天的資料，看這個資料夾的 git 歷史（每天一個 commit）。",
      "",
      "| 客戶代號 | 總筆數 |",
      "|---|---:|",
      ...summary,
      "",
    ].join("\n"), "utf8");
    log("備份完成");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] 備份失敗：${err.stack ?? err}`);
  process.exit(1);
});
