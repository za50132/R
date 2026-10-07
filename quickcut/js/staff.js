/* 操作頁：加號、叫號（一位設計師一顆按鈕）＋店長設定 */
(function () {
  const cfg = window.QC_CONFIG;
  const { store, pad3, esc, taipeiNow, designerView, addDays, weekday, waitingTickets } = window.QC;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = `qc-staff-${cfg.shopId}`;

  let state = null;
  let session = loadSession();   // { pin }
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

  // 提示訊息；叫號後附一顆「退回」，5 秒內按錯可以馬上復原
  let toastTimer;
  function toast(msg, bad = false, undo = null) {
    const t = $('toast');
    t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button" class="toast-undo">退回</button>' : ''}`;
    t.classList.toggle('bad', bad);
    t.classList.toggle('action', Boolean(undo));
    t.classList.add('show');
    if (undo) t.querySelector('.toast-undo').onclick = () => { t.classList.remove('show'); undo(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 5000 : 2200);
  }
  const buzz = () => { try { navigator.vibrate && navigator.vibrate(40); } catch (e) { /* iOS 不支援 */ } };
  const designer = (id) => cfg.designers.find((d) => d.id === id);

  // 頁面內建的確認視窗：回傳 Promise<boolean>
  function ask(text, yes = '確定') {
    return new Promise((resolve) => {
      const dlg = $('askDialog');
      $('askText').textContent = text;
      $('askYes').textContent = yes;
      dlg.returnValue = '';
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
      dlg.showModal();
    });
  }

  function show(view) {
    for (const v of ['loginView', 'mainView', 'ownerView']) $(v).hidden = v !== view;
    $('issueBar').hidden = view !== 'mainView';
    window.scrollTo(0, 0);
  }

  // ---------- 登入：只要輸入店內密碼 ----------
  function startLogin() {
    show('loginView');
    setTimeout(() => $('pinInput').focus(), 50);
  }
  $('pinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('pinInput').value.trim();
    if (!pin) return;
    const r = await store.staff(pin, null, 'ping');
    if (!r.ok) { $('pinErr').textContent = r.message; return; }
    session = { pin };
    saveSession();
    $('pinErr').textContent = '';
    enterMain();
  });
  $('btnLogout').addEventListener('click', async () => {
    if (!await ask('確定要登出這支手機嗎？', '登出')) return;
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

  function renderMain() {
    if (!state) return;
    const now = taipeiNow();
    $('shopNum').textContent = pad3(state.lastCalled);
    $('shopIssued').textContent = pad3(state.lastIssued);
    const waitingAll = waitingTickets(state);
    $('shopWaiting').textContent = waitingAll.length;

    // 一位設計師一顆按鈕：名字＋服務中的號碼
    $('dgrid').innerHTML = cfg.designers.map((d) => {
      const v = designerView(d, state, now);
      const shown = v.kind === 'off' ? '休假' : v.kind === 'away' ? v.label : v.kind === 'break' ? '休息中' : pad3(v.number);
      return `<button class="dbtn ${v.kind}" data-id="${d.id}" aria-label="${esc(d.name)}，按一下叫下一號，長按更多操作">
        <span class="dbtn-name">${esc(d.name)}</span>
        <span class="dbtn-num num ${v.number && !['off', 'away', 'break'].includes(v.kind) ? '' : 'muted'}">${esc(shown)}</span>
      </button>`;
    }).join('');

    // 等候名單
    $('queueCount').textContent = waitingAll.length ? `${waitingAll.length} 人` : '';
    $('queue').innerHTML = waitingAll.length ? waitingAll.map((t) => {
      const who = t.designer ? designer(t.designer) : null;
      return `<button class="qchip ${who ? 'assigned' : ''}" data-num="${t.number}">
        <b class="num">${pad3(t.number)}</b><small>${who ? `指定 ${esc(who.name)}` : '不指定'}</small></button>`;
    }).join('') : '<p class="empty">目前沒有人在等</p>';
    // 過號：橘色另外列出來，客人回來時點一下
    const skipped = (state.tickets || []).filter((t) => t.status === 'skipped').sort((a, b) => a.number - b.number);
    $('skippedWrap').hidden = !skipped.length;
    $('skipped').innerHTML = skipped.map((t) => {
      const who = t.designer ? designer(t.designer) : null;
      return `<button class="qchip skip" data-num="${t.number}"><b class="num">${pad3(t.number)}</b><small>過號${who ? `・${esc(who.name)}` : ''}</small></button>`;
    }).join('');
    const last = (state.tickets || []).find((t) => t.number === state.lastIssued);
    $('btnUndoIssue').hidden = !(last && last.status === 'waiting');
    $('btnUndoIssue').textContent = `取消最後加的一號（${pad3(state.lastIssued)}）`;
  }

  async function send(who, action, number, undo = null) {
    const r = await store.staff(session.pin, who, action, number);
    toast(r.message, !r.ok, r.ok ? undo : null);
    if (!r.ok && r.message === '密碼錯誤') { session = {}; saveSession(); startLogin(); }
    return r;
  }

  // 叫號類：一次只送一個，避免連點
  async function act(who, action, number, undo = null) {
    if (busy) return null;
    busy = true;
    buzz();
    try { return await send(who, action, number, undo); } finally { busy = false; }
  }
  // 加號類：客人可能連續投幣，所以每按一次都要算，不擋連點
  function issueAct(action, number, who = null) {
    buzz();
    return send(who, action, number);
  }

  // 叫下一號；附「退回」讓按錯的人 5 秒內復原
  async function callNext(id) {
    const d = designer(id);
    const v = designerView(d, state, taipeiNow());
    if ((v.kind === 'off' || v.kind === 'away') && !await ask(`${d.name} ${v.kind === 'off' ? '今天休假' : '目前不在班'}，還是要叫號嗎？`, '叫號')) return;
    await act(id, 'next', null, () => act(id, 'undo'));
  }

  // ---------- 設計師按鈕：按一下叫號、長按開更多操作 ----------
  const LONG_MS = 550;
  let pressTimer = null, longPressed = false;
  const grid = $('dgrid');
  grid.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { longPressed = true; buzz(); openSheet(b.dataset.id); }, LONG_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => grid.addEventListener(ev, () => clearTimeout(pressTimer)));
  grid.addEventListener('contextmenu', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    e.preventDefault();
    if (!longPressed) { clearTimeout(pressTimer); longPressed = true; openSheet(b.dataset.id); }
  });
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    if (longPressed) { longPressed = false; return; }
    callNext(b.dataset.id);
  });

  // 長按選單：過號、叫指定號碼、休息、退回
  let sheetWho = null;
  function openSheet(id) {
    sheetWho = id;
    const d = designer(id);
    const live = (state && state.designers[id]) || {};
    $('dsTitle').textContent = `${d.name}・目前 ${pad3(live.number)} 號`;
    $('dsBreak').textContent = live.status === 'break' ? '回來上工' : '休息';
    $('dsSkip').disabled = !live.number;
    $('dsheet').showModal();
  }
  $('dsClose').addEventListener('click', () => $('dsheet').close());
  $('dsSkip').addEventListener('click', async () => {
    $('dsheet').close();
    const cur = (state.designers[sheetWho] || {}).number;
    if (await ask(`${pad3(cur)} 號沒出現？過號並叫下一位`, '過號')) act(sheetWho, 'skip');
  });
  $('dsBreak').addEventListener('click', () => { $('dsheet').close(); act(sheetWho, 'toggle_break'); });
  $('dsUndo').addEventListener('click', async () => {
    $('dsheet').close();
    if (await ask(`${designer(sheetWho).name}：退回上一次的叫號？`, '退回')) act(sheetWho, 'undo');
  });
  $('dsCall').addEventListener('click', () => {
    $('dsheet').close();
    $('callTitle').textContent = `${designer(sheetWho).name}・叫指定號碼`;
    $('callInput').value = '';
    $('callDialog').showModal();
    setTimeout(() => $('callInput').focus(), 50);
  });
  $('callCancel').addEventListener('click', () => $('callDialog').close());
  $('callForm').addEventListener('submit', (e) => {
    const n = parseInt($('callInput').value, 10);
    if (!n) { e.preventDefault(); return; }
    act(sheetWho, 'call', n);
  });

  // ---------- 加號 ----------
  $('btnIssue').addEventListener('click', () => issueAct('issue'));

  function pickButtons(selected, withNone) {
    const now = taipeiNow();
    const btns = cfg.designers.map((x) => {
      const v = state ? designerView(x, state, now) : { label: '' };
      return `<button class="btn ${selected === x.id ? 'on' : ''}" data-id="${x.id}">${esc(x.name)}<small>${esc(v.label)}</small></button>`;
    });
    if (withNone) btns.push(`<button class="btn none ${selected === null ? 'on' : ''}" data-id="">不指定</button>`);
    return btns.join('');
  }
  $('btnIssuePick').addEventListener('click', () => {
    $('pickTitle').textContent = `加 ${pad3((state ? state.lastIssued : 0) + 1)} 號：指定哪位設計師？`;
    $('pickGrid').innerHTML = pickButtons(undefined, false);
    $('pickDialog').showModal();
  });
  $('pickCancel').addEventListener('click', () => $('pickDialog').close());
  $('pickGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    $('pickDialog').close();
    issueAct('issue', null, b.dataset.id);
  });

  // 點等候名單的號碼：改指定、取消；過號的號碼：客人回來了
  let pickedTicket = null;
  const AFTER = cfg.skipRejoinAfter || 3;
  $('skipAfter').textContent = AFTER;
  function openTicket(e) {
    const b = e.target.closest('[data-num]');
    if (!b) return;
    pickedTicket = Number(b.dataset.num);
    const t = state.tickets.find((x) => x.number === pickedTicket);
    const isSkipped = Boolean(t && t.status === 'skipped');
    $('ticketTitle').textContent = `${pad3(pickedTicket)} 號${isSkipped ? '（過號）' : ''}`;
    $('ticketRejoin').hidden = !isSkipped;
    $('ticketRejoin').textContent = `客人回來了・排在 ${AFTER} 位後面`;
    $('assignWrap').hidden = isSkipped;
    if (!isSkipped) $('assignGrid').innerHTML = pickButtons(t ? t.designer : null, true);
    $('ticketDialog').showModal();
  }
  $('queue').addEventListener('click', openTicket);
  $('skipped').addEventListener('click', openTicket);
  $('ticketRejoin').addEventListener('click', () => { $('ticketDialog').close(); issueAct('rejoin', pickedTicket); });
  $('assignGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    $('ticketDialog').close();
    issueAct('assign', pickedTicket, b.dataset.id || null);
  });
  $('ticketCancel').addEventListener('click', async () => {
    $('ticketDialog').close();
    if (!await ask(`取消 ${pad3(pickedTicket)} 號？`, '取消這號')) return;
    issueAct('cancel_ticket', pickedTicket);
  });
  $('ticketClose').addEventListener('click', () => $('ticketDialog').close());

  $('syncForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = parseInt($('syncInput').value, 10);
    if (!n) return;
    const r = await issueAct('issue_to', n);
    if (r.ok) $('syncInput').value = '';
  });
  $('btnUndoIssue').addEventListener('click', async () => {
    if (await ask(`取消剛剛加的 ${pad3(state.lastIssued)} 號？`, '取消這號')) issueAct('undo_issue');
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
  $('btnReset').addEventListener('click', async () => {
    if (await ask('確定把今天的號碼歸零？等候名單和所有設計師的號碼都會清空。', '歸零')) ownerAct('reset_today');
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

  // QR Code
  const customerUrl = new URL('./', location.href).href;
  // QR Code 多帶 ?src=qr，才算得出有多少人是掃門口 QR Code 進來的
  const qrUrl = `${customerUrl}?src=qr`;
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
    qr.addData(qrUrl);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function enterOwner() {
    show('ownerView');
    renderOffChips();
    renderCal();
    qrTries = 0;
    renderQr();
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

  if (session.pin) enterMain();
  else startLogin();
})();
