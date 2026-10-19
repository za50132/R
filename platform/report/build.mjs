// 客戶數據報表產生器：把 query.sql / raw.sql 查回來的 JSON 做成檔案。
//
//   node build.mjs <report.json> <raw.json|-> <輸出資料夾>
//
// 輸出（輸出資料夾通常是 client-backups/reports/<日期>/）：
//   總覽.xlsx / 總覽.pdf / 總覽.png      所有客戶一張總表
//   <客戶代號>/報告.pdf、圖表.png         每家一份圖表報告
//   <客戶代號>/數據.xlsx                  每日數據、時段、設計師三張工作表
//   <客戶代號>/原始資料/*.csv             期間內的原始資料（raw.json 給 - 就略過）
//
// 客戶名稱在 clients.json；資料庫裡有、clients.json 沒寫的客戶，用代號當名稱。
// PDF / PNG 用 Playwright 的 Chromium 產生；字型用 Google Fonts 的 Noto Sans TC，
// 連不到時用系統字型。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const playwright = (() => {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(p); } catch { /* 試下一個 */ }
  }
  throw new Error("找不到 playwright（PDF / PNG 需要）");
})();

const [reportPath, rawPath, outDir] = process.argv.slice(2);
if (!reportPath || !rawPath || !outDir) {
  console.error("用法：node build.mjs <report.json> <raw.json|-> <輸出資料夾>");
  process.exit(1);
}

// 支援直接貼 Supabase 查詢結果（[{report: {...}}]）或純物件
const unwrap = (x, key) => (Array.isArray(x) ? x[0]?.[key] ?? x[0] : x?.[key] ?? x);
const report = unwrap(JSON.parse(readFileSync(reportPath, "utf8")), "report");
const raw = rawPath === "-" ? null : unwrap(JSON.parse(readFileSync(rawPath, "utf8")), "raw");
const clients = existsSync(join(__dirname, "clients.json")) ? JSON.parse(readFileSync(join(__dirname, "clients.json"), "utf8")) : {};
const nameOf = (id) => clients[id]?.name ?? id;

// ---------- 計算 ----------
const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const dow = (d) => WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()];
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function kpis(shop) {
  const d = shop.daily ?? [];
  const tickets = sum(d, "tickets"), opens = sum(d, "opens"), qr = sum(d, "qr"), lookups = sum(d, "lookups");
  const waits = d.filter((x) => x.avg_wait != null);
  return {
    tickets, opens, qr, lookups,
    skips: sum(d, "skips"),
    activeDays: d.filter((x) => x.tickets > 0).length,
    viewDays: d.filter((x) => x.opens > 0).length,
    avgWait: waits.length ? Math.round(waits.reduce((s, x) => s + x.avg_wait * x.called, 0) / Math.max(1, sum(waits, "called"))) : null,
    skipRate: pct(sum(d, "skips"), tickets),
    lookupRate: pct(lookups, tickets),
    qrShare: pct(qr, opens),
  };
}

// ---------- 圖表（單一顏色長條圖，SVG） ----------
const C = "#3f8f86", INK = "#1d1f22", SOFT = "#5d646c", GRID = "#e3e7ea";
function bars({ labels, sub, values, w = 1000, h = 260 }) {
  const L = 44, R = 12, T = 22, B = sub ? 52 : 34, pw = w - L - R, ph = h - T - B;
  const max = Math.max(0, ...values), top = Math.max(4, Math.ceil(max / 4) * 4), step = top / 4;
  const n = Math.max(1, values.length), slot = pw / n, bw = Math.max(2, Math.min(40, slot * 0.62));
  const every = n > 45 ? 7 : n > 20 ? 2 : 1; // 天數多時隔幾天標一次日期
  let s = `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Noto Sans TC, sans-serif">`;
  for (let i = 0; i <= 4; i++) {
    const y = T + ph - (i * step / top) * ph;
    s += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="${GRID}"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="12" fill="${SOFT}">${i * step}</text>`;
  }
  values.forEach((v, i) => {
    const x = L + slot * i + (slot - bw) / 2, bh = (v / top) * ph, y = T + ph - bh, r = Math.min(4, bw / 2);
    if (v > 0) s += `<path d="M${x} ${T + ph}V${y + r}q0 -${r} ${r} -${r}h${bw - 2 * r}q${r} 0 ${r} ${r}V${T + ph}z" fill="${C}"><title>${labels[i]}：${v}</title></path>`;
    if (v === max && v > 0) s += `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" font-size="13" font-weight="700" fill="${INK}">${v}</text>`;
    if (i % every === 0) {
      s += `<text x="${x + bw / 2}" y="${T + ph + 18}" text-anchor="middle" font-size="12" fill="${SOFT}">${labels[i]}</text>`;
      if (sub) s += `<text x="${x + bw / 2}" y="${T + ph + 34}" text-anchor="middle" font-size="11" fill="${SOFT}">${sub[i]}</text>`;
    }
  });
  return s + `<line x1="${L}" x2="${w - R}" y1="${T + ph}" y2="${T + ph}" stroke="#c9d0d4"/></svg>`;
}
const hours24 = (arr) => Array.from({ length: 24 }, (_, h) => Number(arr.find((x) => x.hour === h)?.n ?? 0));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, unit = "") => (v == null ? "—" : `${v}${unit}`);

const CSS = `body{margin:0;background:#f3f5f5;font-family:'Noto Sans TC',-apple-system,'PingFang TC',sans-serif;color:${INK}}
.page{width:1040px;padding:28px 36px 32px;box-sizing:border-box}
h1{margin:0;font-size:26px;font-weight:900;letter-spacing:.04em}.sub{margin:4px 0 18px;color:${SOFT};font-size:14px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.kpi{background:#fff;border-radius:12px;padding:12px 16px}.kpi b{display:block;font-size:30px;font-weight:900;line-height:1.2}.kpi span{font-size:13px;color:${SOFT}}
.card{background:#fff;border-radius:12px;padding:14px 18px 8px;margin-bottom:12px;break-inside:avoid}.card h2{margin:0 0 2px;font-size:17px;font-weight:900}.card p{margin:0 0 6px;font-size:12px;color:${SOFT}}
table{width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 8px}th,td{padding:7px 8px;border-bottom:1px solid ${GRID};text-align:right}th:first-child,td:first-child{text-align:left}th{color:${SOFT};font-weight:500;font-size:12px}
.foot{font-size:12px;color:${SOFT};margin-top:6px}`;

function shopHtml(shop) {
  const k = kpis(shop), d = shop.daily ?? [];
  const designerRows = (shop.designers ?? []).map((x) =>
    `<tr><td>${esc(x.name)}</td><td>${x.served}</td><td>${x.chosen}</td><td>${x.dispatched}</td><td>${fmt(pct(x.chosen, x.served), "%")}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>${esc(nameOf(shop.id))} 數據報告</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet"><style>${CSS}</style>
<div class="page"><h1>${esc(nameOf(shop.id))}・數據報告</h1>
<div class="sub">${report.from} ～ ${report.to}（台北時間）・產生於 ${String(report.generated_at).slice(0, 16).replace("T", " ")} UTC</div>
<div class="kpis">
<div class="kpi"><b>${k.opens}</b><span>打開客人頁（人次）</span></div>
<div class="kpi"><b>${k.qr}</b><span>掃 QR Code 進來（${fmt(k.qrShare, "%")}）</span></div>
<div class="kpi"><b>${k.lookups}</b><span>查我的號碼（查號比例 ${fmt(k.lookupRate, "%")}）</span></div>
<div class="kpi"><b>${k.activeDays} 天</b><span>有用系統發號</span></div>
<div class="kpi"><b>${k.tickets}</b><span>發號總數（內部參考）</span></div>
<div class="kpi"><b>${fmt(k.avgWait, " 分")}</b><span>平均等候</span></div>
<div class="kpi"><b>${fmt(k.skipRate, "%")}</b><span>過號率（${k.skips} 次）</span></div>
<div class="kpi"><b>${k.viewDays} 天</b><span>有人看客人頁</span></div></div>
<div class="card"><h2>每天打開客人頁的人數</h2><p>同一支手機同一天開好幾次只算 1 次</p>${bars({ labels: d.map((x) => md(x.day)), sub: d.map((x) => dow(x.day)), values: d.map((x) => x.opens) })}</div>
<div class="card"><h2>客人頁在幾點被打開</h2><p>期間內加總</p>${bars({ labels: [...Array(24).keys()], values: hours24(shop.open_hours ?? []), h: 220 })}</div>
<div class="card"><h2>每天發號數</h2><p>內部參考，不對外公開</p>${bars({ labels: d.map((x) => md(x.day)), sub: d.map((x) => dow(x.day)), values: d.map((x) => x.tickets) })}</div>
<div class="card"><h2>幾點來的客人最多（發號時間）</h2><p>期間內加總</p>${bars({ labels: [...Array(24).keys()], values: hours24(shop.ticket_hours ?? []), h: 220 })}</div>
${designerRows ? `<div class="card"><h2>設計師</h2><table><tr><th>設計師</th><th>服務人數</th><th>客人指定</th><th>店內指派</th><th>指定率</th></tr>${designerRows}</table></div>` : ""}
<div class="foot">資料來源：Supabase・只統計，不含任何客人身分資料</div></div></html>`;
}

function overviewHtml(rows) {
  const body = rows.map(({ shop, k }) => `<tr><td>${esc(nameOf(shop.id))}<br><small style="color:${SOFT}">${esc(shop.id)}</small></td>
<td>${k.opens}</td><td>${k.qr}</td><td>${k.lookups}</td><td>${fmt(k.lookupRate, "%")}</td><td>${k.activeDays}</td><td>${k.tickets}</td><td>${fmt(k.avgWait, " 分")}</td><td>${fmt(k.skipRate, "%")}</td></tr>`).join("");
  const chart = bars({ labels: rows.map(({ shop }) => nameOf(shop.id)), values: rows.map(({ k }) => k.opens), h: 240 });
  return `<!doctype html><html lang="zh-TW"><meta charset="utf-8"><title>所有客戶總覽</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet"><style>${CSS}</style>
<div class="page"><h1>所有客戶・數據總覽</h1><div class="sub">${report.from} ～ ${report.to}（台北時間）・共 ${rows.length} 家</div>
<div class="card"><h2>各家打開客人頁的人次</h2><p>期間內加總</p>${chart}</div>
<div class="card"><h2>各家指標</h2><table><tr><th>客戶</th><th>開頁</th><th>掃QR</th><th>查號</th><th>查號比例</th><th>使用天數</th><th>發號</th><th>平均等候</th><th>過號率</th></tr>${body}</table></div>
<div class="foot">發號數、等候時間為內部參考，對外展示請用比例與趨勢。</div></div></html>`;
}

// ---------- Excel ----------
const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F8F86" } } };
function addSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map(([header, key, width]) => ({ header, key, width: width ?? 12 }));
  ws.addRows(rows);
  ws.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  return ws;
}
const DAILY_COLS = [["日期", "day", 12], ["星期", "dow", 6], ["開客人頁", "opens"], ["掃QR", "qr"], ["查號", "lookups"],
  ["發號", "tickets"], ["已叫號", "called"], ["平均等候(分)", "avg_wait", 13], ["過號", "skips"]];
const dailyRows = (shop) => (shop.daily ?? []).map((x) => ({ ...x, dow: dow(x.day) }));

// ---------- CSV ----------
const csvCell = (v) => { if (v == null) return ""; const s = typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCsv(rows) {
  if (!rows.length) return "﻿";
  const cols = Object.keys(rows[0]);
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

// ---------- 主程式 ----------
const fontCache = new Map();
function fetchFont(url) {
  if (!fontCache.has(url)) {
    try {
      fontCache.set(url, execFileSync("curl", ["-sSf", "-m", "20", "-A", "Mozilla/5.0 (Macintosh) Chrome/120", url], { maxBuffer: 50e6 }));
    } catch { fontCache.set(url, null); } // 連不到就用系統字型
  }
  return fontCache.get(url);
}

async function render(browser, html, pdfPath, pngPath) {
  const page = await browser.newPage({ viewport: { width: 1040, height: 900 }, deviceScaleFactor: 2 });
  // 只放行 Google Fonts，用 curl 抓（curl 會走系統的 proxy 設定，瀏覽器不一定會）
  await page.route("**/*", (r) => {
    const url = r.request().url();
    if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return r.abort();
    const body = fetchFont(url);
    return body ? r.fulfill({ body, contentType: url.includes("googleapis") ? "text/css" : "font/woff2" }) : r.abort();
  });
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  await Promise.race([page.evaluate(() => document.fonts.ready), new Promise((r) => setTimeout(r, 4000))]);
  await page.locator(".page").screenshot({ path: pngPath });
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true, scale: 0.72, margin: { top: "8mm", bottom: "8mm", left: "6mm", right: "6mm" } });
  await page.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const shops = report.shops ?? [];
  const rows = shops.map((shop) => ({ shop, k: kpis(shop) }));
  const browser = await playwright.chromium.launch();
  try {
    // 總覽
    const wb = new ExcelJS.Workbook();
    addSheet(wb, "總覽", [["客戶", "name", 16], ["代號", "id", 12], ["開客人頁", "opens"], ["掃QR", "qr"], ["查號", "lookups"],
      ["查號比例%", "lookupRate"], ["使用天數", "activeDays"], ["發號", "tickets"], ["平均等候(分)", "avgWait", 13], ["過號率%", "skipRate"]],
      rows.map(({ shop, k }) => ({ name: nameOf(shop.id), id: shop.id, ...k })));
    for (const { shop } of rows) addSheet(wb, nameOf(shop.id), DAILY_COLS, dailyRows(shop));
    await wb.xlsx.writeFile(join(outDir, "總覽.xlsx"));
    await render(browser, overviewHtml(rows), join(outDir, "總覽.pdf"), join(outDir, "總覽.png"));

    // 每一家
    for (const { shop } of rows) {
      const dir = join(outDir, shop.id);
      mkdirSync(dir, { recursive: true });
      const swb = new ExcelJS.Workbook();
      addSheet(swb, "每日", DAILY_COLS, dailyRows(shop));
      addSheet(swb, "時段", [["時段", "hour", 8], ["開客人頁", "opens"], ["發號", "tickets"]],
        [...Array(24).keys()].map((h) => ({ hour: `${h}:00`, opens: hours24(shop.open_hours ?? [])[h], tickets: hours24(shop.ticket_hours ?? [])[h] })));
      addSheet(swb, "設計師", [["設計師", "name", 12], ["服務人數", "served"], ["客人指定", "chosen"], ["店內指派", "dispatched"]], shop.designers ?? []);
      await swb.xlsx.writeFile(join(dir, "數據.xlsx"));
      await render(browser, shopHtml(shop), join(dir, "報告.pdf"), join(dir, "圖表.png"));

      if (raw) {
        const rawDir = join(dir, "原始資料");
        mkdirSync(rawDir, { recursive: true });
        for (const [table, list] of Object.entries(raw)) {
          writeFileSync(join(rawDir, `${table}.csv`), toCsv((list ?? []).filter((r) => r.shop_id === shop.id)), "utf8");
        }
      }
      console.log(`✓ ${nameOf(shop.id)}（${shop.id}）`);
    }
  } finally {
    await browser.close();
  }
  console.log(`完成：${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
