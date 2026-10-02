/* 操作頁：設計師叫號＋店長設定 */
(function () {
  const cfg = window.QC_CONFIG;
  const { store, pad3, esc, taipeiNow, designerView, addDays, weekday } = window.QC;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = `qc-staff-${cfg.shopId}`;

  let state = null;
  let session = loadSession();   // { pin, me }
  let viewing = session.me;      // 目前操作哪位設計師（可以幫別人按）
  let ownerPin = null;           // 店長密碼只存在記憶體，關掉頁面就要重輸
  let busy = false;

  if (store.mode === 'demo') $('demoBanner').hidden = false;

  // ---------- 小工具 ----------
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveSession() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(session)); } catch (e) { /* 私密瀏覽 */ }
  }
  let toastTimer;
  function toast(msg, bad = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('bad', bad);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(40); } catch (e) { /* iOS 不支援 */ } };
  const designer = (id) => cfg.designers.find((d) => d.id === id);

  function show(view) {
    for (const v of ['loginView', 'mainView', 'ownerView']) $(v).hidden = v !== view;
    window.scrollTo(0, 0);
  }

  // ---------- 登入 ----------
  function startLogin() {
    show('loginView');
    $('pinStep').hidden = false;
    $('whoStep').hidden = true;
    setTimeout(() => $('pinInput').focus(), 50);
  }

  $('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('pinInput').value.trim();
    if (!pin) return;
    const r = await store.staff(pin, null, 'ping');
    if (!r.ok) { $('pinErr').textContent = r.message; return; }
    session.pin = pin;
    $('pinErr').textContent = '';
    $('pinStep').hidden = true;
    $('whoStep').hidden = false;
  });

  $('whoList').innerHTML = cfg.designers.map((d) =>
    `<button class="btn" data-id="${d.id}">${esc(d.name)}<small>${esc(d.role === '店長' ? '店長・' : '')}${esc(d.shift)}</small></button>`
  ).join('');
  $('whoList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    session.me = b.dataset.id;
    viewing = session.me;
    saveSession();
    enterMain();
  });

  $('btnLogout').addEventListener('click', () => {
    if (!confirm('確定要登出這支手機嗎？')) return;
    session = {};
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    $('pinInput').value = '';
    startLogin();
  });

  // ---------- 叫號畫面 ----------
  function enterMain() {
    show('mainView');
    renderMain();
  }

  function renderChips() {
    $('chips').innerHTML = cfg.designers.map((d) =>
      `<button class="chip ${d.id === viewing ? 'on' : ''}" data-id="${d.id}" role="tab" aria-selected="${d.id === viewing}">${esc(d.name)}${d.id === session.me ? '（我）' : ''}</button>`
    ).join('');
  }
  $('chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    viewing = b.dataset.id;
    renderMain();
  });

  function renderMain() {
    renderChips();
    if (!state) return;
    const d = designer(viewing);
    const live = state.designers[viewing] || {};
    const v = designerView(d, state, taipeiNow());
    $('shopNum').textContent = pad3(state.lastCalled);
    $('meName').textContent = `${d.name}${viewing === session.me ? '' : '（幫忙操作中）'}`;
    $('meNum').textContent = pad3(live.number);
    $('meState').textContent = live.status === 'break' ? '休息中（客人頁顯示休息）' : v.kind === 'off' ? '今天是休假日' : live.number ? '服務中' : '等待叫號';
    $('meCard').classList.toggle('break', live.status === 'break');
    $('nextHint').textContent = state.lastCalled >= 999 ? '號碼已滿，請店長修改' : `叫 ${pad3(state.lastCalled + 1)} 號`;
    $('btnBreak').textContent = live.status === 'break' ? '回來上工' : '休息';
    $('btnBreak').classList.toggle('on', live.status === 'break');

    $('others').innerHTML = cfg.designers.map((x) => {
      const xv = designerView(x, state, taipeiNow());
      return `<div class="row"><div class="row-main"><div class="row-value"><span>${esc(x.name)}・${esc(xv.label)}</span><b class="num">${xv.number ? pad3(xv.number) : ''}</b></div></div></div>`;
    }).join('');
  }

  async function act(action, number) {
    if (busy) return;
    busy = true;
    $('btnNext').disabled = true;
    buzz();
    try {
      const r = await store.staff(session.pin, viewing, action, number);
      toast(r.message, !r.ok);
      if (!r.ok && r.message === '密碼錯誤') { session = {}; saveSession(); startLogin(); }
    } finally {
      busy = false;
      $('btnNext').disabled = false;
    }
  }

  $('btnNext').addEventListener('click', () => act('next'));
  $('btnBreak').addEventListener('click', () => act('toggle_break'));
  $('btnUndo').addEventListener('click', () => {
    if (confirm(`${designer(viewing).name}：退回上一次的叫號？`)) act('undo');
  });

  $('btnCall').addEventListener('click', () => {
    $('callTitle').textContent = `${designer(viewing).name}・叫指定號碼`;
    $('callInput').value = '';
    $('callDialog').showModal();
    setTimeout(() => $('callInput').focus(), 50);
  });
  $('callCancel').addEventListener('click', () => $('callDialog').close());
  $('callForm').addEventListener('submit', (e) => {
    const n = parseInt($('callInput').value, 10);
    if (!n) { e.preventDefault(); return; }
    act('call', n);
  });

  // ---------- 店長設定 ----------
  $('btnOwner').addEventListener('click', () => {
    if (ownerPin) { enterOwner(); return; }
    $('ownerPinInput').value = '';
    $('ownerErr').textContent = '';
    $('ownerDialog').showModal();
    setTimeout(() => $('ownerPinInput').focus(), 50);
  });
  $('ownerCancel').addEventListener('click', () => $('ownerDialog').close());
  $('ownerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('ownerPinInput').value.trim();
    const r = await store.owner(pin, 'ping');
    if (!r.ok) { $('ownerErr').textContent = r.message; return; }
    ownerPin = pin;
    $('ownerDialog').close();
    enterOwner();
  });
  $('btnOwnerBack').addEventListener('click', enterMain);

  async function ownerAct(action, args, okMsg) {
    const r = await store.owner(ownerPin, action, args);
    toast(okMsg && r.ok ? okMsg : r.message, !r.ok);
    return r;
  }

  // 排休月曆
  let offWho = cfg.designers[0].id;
  let calMonth = taipeiNow().date.slice(0, 7); // YYYY-MM

  function renderOffChips() {
    $('offChips').innerHTML = cfg.designers.map((d) =>
      `<button class="chip ${d.id === offWho ? 'on' : ''}" data-id="${d.id}">${esc(d.name)}</button>`).join('');
  }
  $('offChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    offWho = b.dataset.id;
    renderOffChips();
    renderCal();
  });

  function shiftMonth(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    return t.toISOString().slice(0, 7);
  }
  $('calPrev').addEventListener('click', () => {
    if (calMonth <= taipeiNow().date.slice(0, 7)) return;
    calMonth = shiftMonth(calMonth, -1); renderCal();
  });
  $('calNext').addEventListener('click', () => {
    // 只讀取未來 200 天的休假，最多往後排 5 個月
    if (calMonth >= shiftMonth(taipeiNow().date.slice(0, 7), 5)) return;
    calMonth = shiftMonth(calMonth, 1); renderCal();
  });

  function renderCal() {
    if (!state) return;
    const today = taipeiNow().date;
    const first = `${calMonth}-01`;
    const days = new Date(Date.UTC(+calMonth.slice(0, 4), +calMonth.slice(5, 7), 0)).getUTCDate();
    const lead = ['日', '一', '二', '三', '四', '五', '六'].indexOf(weekday(first));
    $('calTitle').textContent = `${calMonth.slice(0, 4)} 年 ${Number(calMonth.slice(5))} 月`;
    let html = ['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div class="wd">${w}</div>`).join('');
    html += '<div></div>'.repeat(lead);
    for (let i = 0; i < days; i++) {
      const day = addDays(first, i);
      const offs = state.daysOff.filter((o) => o.day === day);
      const mine = offs.some((o) => o.designer === offWho);
      const tags = offs.map((o) => esc((designer(o.designer) || {}).name || '')).join('<br>');
      html += `<button class="day ${day < today ? 'past' : ''} ${day === today ? 'today' : ''} ${mine ? 'sel' : ''}" data-day="${day}" ${day < today ? 'disabled' : ''}>
        <span class="num">${i + 1}</span><span class="tag">${tags}</span></button>`;
    }
    $('cal').innerHTML = html;
  }
  $('cal').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-day]');
    if (!b || b.disabled) return;
    const day = b.dataset.day;
    const isOff = state.daysOff.some((o) => o.designer === offWho && o.day === day);
    const name = designer(offWho).name;
    await ownerAct(isOff ? 'day_on' : 'day_off', { designer: offWho, day },
      `${name} ${Number(day.slice(5, 7))}/${Number(day.slice(8))} ${isOff ? '取消休假' : '休假'}`);
  });

  $('setNumForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = parseInt($('setNumInput').value, 10);
    if (Number.isNaN(n)) return;
    const r = await ownerAct('set_number', { number: n });
    if (r.ok) $('setNumInput').value = '';
  });
  $('btnReset').addEventListener('click', () => {
    if (confirm('確定把今天的號碼歸零？所有設計師的號碼都會清空。')) ownerAct('reset_today');
  });
  $('staffPinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('newStaffPin').value.trim();
    const r = await ownerAct('set_staff_pin', { newPin: pin });
    if (r.ok) { $('newStaffPin').value = ''; session.pin = pin; saveSession(); }
  });
  $('ownerPinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('newOwnerPin').value.trim();
    const r = await ownerAct('set_owner_pin', { newPin: pin });
    if (r.ok) { $('newOwnerPin').value = ''; ownerPin = pin; }
  });

  // QR Code 與 Apple Watch 資料
  const customerUrl = new URL('./', location.href).href;
  $('customerUrl').textContent = customerUrl;
  $('btnCopyUrl').addEventListener('click', () => {
    navigator.clipboard?.writeText(customerUrl).then(() => toast('已複製網址'), () => toast('請長按網址手動複製', true));
  });

  let qrTries = 0;
  function renderQr() {
    if (!window.qrcode) {
      $('qr').textContent = qrTries < 20 ? 'QR Code 載入中…' : 'QR Code 載入失敗，請檢查網路後重新整理';
      if (qrTries++ < 20) setTimeout(renderQr, 500);
      return;
    }
    const qr = window.qrcode(0, 'M');
    qr.addData(customerUrl);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function renderWatch() {
    if (store.mode !== 'supabase') {
      $('watchInfo').innerHTML = '<p class="hint">設定好 Supabase 之後，這裡會顯示捷徑要貼的網址和內容。</p>';
      return;
    }
    const body = (extra) => JSON.stringify({ p_shop: cfg.shopId, p_pin: '（店內密碼）', p_designer: 'jiang', ...extra });
    $('watchInfo').innerHTML = `
      <div class="kv">網址（URL）</div><div class="code">${esc(cfg.supabaseUrl.replace(/\/$/, ''))}/rest/v1/rpc/staff_action</div>
      <div class="kv">方法</div><div class="code">POST</div>
      <div class="kv">標頭（Headers）</div><div class="code">apikey: ${esc(cfg.supabaseKey)}\nContent-Type: application/json</div>
      <div class="kv">下一位</div><div class="code">${esc(body({ p_action: 'next' }))}</div>
      <div class="kv">叫指定號碼（p_number 用「要求輸入」的數字）</div><div class="code">${esc(body({ p_action: 'call', p_number: 25 }))}</div>
      <div class="kv">休息／回來</div><div class="code">${esc(body({ p_action: 'toggle_break' }))}</div>
      <div class="kv">退回上一位</div><div class="code">${esc(body({ p_action: 'undo' }))}</div>
      <div class="kv">查詢目前狀態</div><div class="code">${esc(body({ p_action: 'status' }))}</div>`;
  }

  function enterOwner() {
    show('ownerView');
    renderOffChips();
    renderCal();
    qrTries = 0;
    renderQr();
    renderWatch();
  }

  // ---------- 資料同步 ----------
  function onState(s) {
    state = s;
    if (!$('mainView').hidden) renderMain();
    if (!$('ownerView').hidden) renderCal();
  }
  store.load().then(onState).catch(() => toast('連線失敗，請檢查網路', true));
  store.subscribe(onState, (s) => { if (s === 'error') toast('連線中斷，重新連線中…', true); });
  setInterval(() => { if (state && !$('mainView').hidden) renderMain(); }, 30000);

  if (session.pin && session.me && designer(session.me)) enterMain();
  else startLogin();
})();
