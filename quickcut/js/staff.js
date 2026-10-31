/* 操作頁：加號、叫號（一位設計師一顆按鈕）＋店長設定 */
(function () {
  const cfg = window.QC_CONFIG;
  const { store, pad3, esc, taipeiNow, designerView, shiftOf, addDays, weekday, waitingTickets, estimateWait, designerWait, waitText } = window.QC;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = `qc-staff-${cfg.shopId}`;

  let state = null;
  let session = loadSession();   // { pin }
  let ownerPin = null;           // 店長密碼只存在記憶體，關掉頁面就要重輸
  let busy = false;

  if (store.mode === 'demo') $('demoBanner').hidden = false;

  // 號碼牌上限：輸入框的 max 跟著 config.js 走，不要讓店員能打出超過上限的號碼
  const MAX_N = cfg.maxNumber || 999;
  ['numInput', 'callInput'].forEach((id) => {
    const el = $(id);
    if (el) el.max = MAX_N;
  });

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

    // 多選：已經不在名單上的號碼（被叫走、取消）自動取消勾選
    for (const n of [...picked]) {
      const t = (state.tickets || []).find((x) => x.number === n);
      if (!t || !['waiting', 'skipped'].includes(t.status)) picked.delete(n);
    }
    renderBatch();

    // 各設計師等候：指定（含指派）他的人數＋現在指定他大約要等多久；最後一列是不指定
    const eta = (m) => (m == null ? '' : waitText(m));
    const open = waitingAll.filter((t) => !t.designer).length;
    const openEta = estimateWait(cfg, state, now);
    $('wstats').innerHTML = cfg.designers.map((d) => {
      const w = designerWait(cfg, state, d, now);
      return `<div class="wrow ${w.minutes == null ? 'dim' : ''}"><span class="wrow-name">${esc(d.name)}</span>
        <span class="wrow-n"><b class="num">${w.count}</b> 人</span>
        <span class="wrow-eta">${esc(w.minutes == null ? w.label : eta(w.minutes))}</span></div>`;
    }).join('') + `<div class="wrow"><span class="wrow-name">不指定</span>
        <span class="wrow-n"><b class="num">${open}</b> 人</span>
        <span class="wrow-eta">${openEta == null ? '沒有人在班' : eta(openEta)}</span></div>`;

    // 號碼調整：顯示目前的數字，點了再改
    $('fixCalled').textContent = pad3(state.lastCalled);
    $('fixIssued').textContent = pad3(state.lastIssued);

    // 等候名單
    $('queueCount').textContent = waitingAll.length ? `${waitingAll.length} 人` : '';
    $('queue').innerHTML = waitingAll.length ? waitingAll.map((t) => {
      const who = t.designer ? designer(t.designer) : null;
      const cls = !who ? 'open' : t.assigned ? 'dispatched' : 'assigned';
      const label = !who ? '不指定' : `${t.assigned ? '指派' : '指定'} ${esc(who.name)}`;
      return `<button class="qchip ${cls} ${picked.has(t.number) ? 'sel' : ''}" data-num="${t.number}">
        <b class="num">${pad3(t.number)}</b><small>${label}</small></button>`;
    }).join('') : '<p class="empty">目前沒有人在等</p>';
    // 過號：橘色另外列出來，客人回來時點一下
    const skipped = (state.tickets || []).filter((t) => t.status === 'skipped').sort((a, b) => a.number - b.number);
    $('skippedWrap').hidden = !skipped.length;
    $('skipped').innerHTML = skipped.map((t) => {
      const who = t.designer ? designer(t.designer) : null;
      return `<button class="qchip skip ${picked.has(t.number) ? 'sel' : ''}" data-num="${t.number}"><b class="num">${pad3(t.number)}</b><small>過號${who ? `・${esc(who.name)}` : ''}</small></button>`;
    }).join('');
    const last = (state.tickets || []).find((t) => t.number === state.lastIssued);
    $('btnUndoIssue').hidden = !(last && last.status === 'waiting');
    $('btnUndoIssue').textContent = `取消最後加的一號（${pad3(state.lastIssued)}）`;
  }

  // 叫號後的提示：先說「指定（含指派）這位設計師」的還有幾位；他沒有自己的客人了，才說現場不指定有幾位。
  // 用叫號前的等候名單算，剛叫走的那一號不算（畫面可能還沒更新）
  function afterCallText(who, called) {
    const left = waitingTickets(state).filter((t) => t.number !== called);
    const mine = left.filter((t) => t.designer === who).length;
    const name = designer(who).name;
    if (mine) return `${name}${/[A-Za-z]$/.test(name) ? ' ' : ''}的客人還有 ${mine} 位`;
    const open = left.filter((t) => !t.designer).length;
    return open ? `現場不指定等 ${open} 位` : '沒有人在等';
  }

  async function send(who, action, number, undo = null) {
    const r = await store.staff(session.pin, who, action, number);
    if (r.ok && ['next', 'skip'].includes(action) && r.number != null && state) {
      r.message = r.message.replace(/・等 \d+ 人$/, `・${afterCallText(who, r.number)}`);
    }
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
    // 不在班表時段內（或手動下班）：點一下＝直接讓他上班，蓋過班表時間，不是叫號
    if (v.kind === 'away') { act(id, 'clock_in'); return; }
    if (v.kind === 'off' && !await ask(`${d.name} 今天休假，還是要叫號嗎？`, '叫號')) return;
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
    const v = designerView(d, state, taipeiNow());
    $('dsTitle').textContent = `${d.name}・目前 ${pad3(live.number)} 號`;
    $('dsShift').textContent = v.kind === 'away' ? '上班' : '下班';
    $('dsBreak').textContent = live.status === 'break' ? '回來上工' : '休息';
    $('dsBreak').disabled = v.kind === 'away';
    $('dsSkip').disabled = !live.number;
    $('dsheet').showModal();
  }
  $('dsClose').addEventListener('click', () => $('dsheet').close());
  $('dsSkip').addEventListener('click', async () => {
    $('dsheet').close();
    const cur = (state.designers[sheetWho] || {}).number;
    if (await ask(`${pad3(cur)} 號沒出現？過號並叫下一位`, '過號')) act(sheetWho, 'skip');
  });
  $('dsShift').addEventListener('click', () => {
    $('dsheet').close();
    const v = designerView(designer(sheetWho), state, taipeiNow());
    act(sheetWho, v.kind === 'away' ? 'clock_in' : 'clock_out');
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
  function nextIssueNumber() {
    const maxN = cfg.maxNumber || 999;
    return state ? (state.lastIssued % maxN) + 1 : 1;
  }
  $('btnIssuePick').addEventListener('click', () => {
    $('pickTitle').textContent = `加 ${pad3(nextIssueNumber())} 號：指定哪位設計師？`;
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

  // 點等候名單的號碼：不指定的 → 指派給設計師；客人指定的 → 改指定；都可以取消
  // 過號的號碼：客人回來了
  let pickedTicket = null;
  let assignAction = 'dispatch';
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
    // 客人自己指定的維持「改指定」；不指定或已指派的用「指派」
    const chosen = Boolean(t && t.designer && !t.assigned);
    assignAction = chosen ? 'assign' : 'dispatch';
    $('assignHint').textContent = chosen ? '客人指定的，要改成：' : '指派給哪位設計師？';
    if (!isSkipped) $('assignGrid').innerHTML = pickButtons(t ? t.designer : null, true);
    $('ticketDialog').showModal();
  }
  $('queue').addEventListener('click', onChip);
  $('skipped').addEventListener('click', onChip);
  function onChip(e) {
    if (!multi) { openTicket(e); return; }
    const b = e.target.closest('[data-num]');
    if (!b) return;
    const n = Number(b.dataset.num);
    if (picked.has(n)) picked.delete(n); else picked.add(n);
    b.classList.toggle('sel', picked.has(n));
    renderBatch();
  }

  // ---------- 多選：勾好幾號，一次指派或取消 ----------
  let multi = false;
  const picked = new Set();
  function renderBatch() {
    $('btnMulti').textContent = multi ? '完成' : '多選';
    $('batchBar').hidden = !multi;
    $('batchCount').textContent = picked.size ? `已選 ${picked.size} 號` : '點號碼勾選';
    $('batchAssign').disabled = $('batchCancel').disabled = !picked.size;
  }
  $('btnMulti').addEventListener('click', () => {
    multi = !multi;
    picked.clear();
    renderMain();
  });
  // 依排隊順序一號一號送；結果合成一則提示
  async function runBatch(list, doneMsg) {
    const fails = [];
    for (const [action, n, who] of list) {
      const r = await store.staff(session.pin, who, action, n);
      if (!r.ok) fails.push(`${pad3(n)}：${r.message}`);
      if (r.message === '密碼錯誤') { session = {}; saveSession(); startLogin(); return; }
    }
    buzz();
    toast(fails.length ? `${list.length - fails.length} 號完成；${fails.join('、')}` : doneMsg, fails.length > 0);
    multi = false;
    picked.clear();
    renderMain();
  }
  const pickedTickets = () => (state.tickets || []).filter((t) => picked.has(t.number));
  $('batchAssign').addEventListener('click', () => {
    $('batchTitle').textContent = `${[...picked].sort((a, b) => a - b).map(pad3).join('、')} 號指派給：`;
    $('batchGrid').innerHTML = pickButtons(undefined, true);
    $('batchDialog').showModal();
  });
  $('batchClose').addEventListener('click', () => $('batchDialog').close());
  $('batchGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    $('batchDialog').close();
    const who = b.dataset.id || null;
    // 一次指派只動不指定（或已指派）的號碼：客人自己指定的、過號的都跳過，
    // 要改客人指定的設計師，請單獨點那一號
    const all = pickedTickets();
    const ok = all.filter((t) => t.status === 'waiting' && !(t.designer && !t.assigned));
    const skippedNote = all.length > ok.length ? `（${all.length - ok.length} 號是客人指定或過號，沒有改）` : '';
    if (!ok.length) { toast(`選的號碼都是客人指定或過號，沒有改`, true); return; }
    const name = who ? designer(who).name : '不指定';
    runBatch(ok.map((t) => ['dispatch', t.number, who]),
      (who ? `${ok.length} 號已指派給 ${name}` : `${ok.length} 號改回不指定`) + skippedNote);
  });
  $('batchCancel').addEventListener('click', async () => {
    const nums = [...picked].sort((a, b) => a - b);
    if (!await ask(`取消 ${nums.map(pad3).join('、')} 號？`, '取消這些號')) return;
    runBatch(nums.map((n) => ['cancel_ticket', n, null]), `已取消 ${nums.length} 號`);
  });
  $('ticketRejoin').addEventListener('click', () => { $('ticketDialog').close(); issueAct('rejoin', pickedTicket); });
  $('assignGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    $('ticketDialog').close();
    issueAct(assignAction, pickedTicket, b.dataset.id || null);
  });
  $('ticketCancel').addEventListener('click', async () => {
    $('ticketDialog').close();
    if (!await ask(`取消 ${pad3(pickedTicket)} 號？`, '取消這號')) return;
    issueAct('cancel_ticket', pickedTicket);
  });
  $('ticketClose').addEventListener('click', () => $('ticketDialog').close());

  // ---------- 號碼調整（店內密碼就能用；歸零要店長密碼） ----------
  const FIX = {
    set_number: { title: '目前叫到幾號？', hint: '叫號跟現場對不上時改這裡，下一位從這個號碼 +1 開始。', value: () => state.lastCalled },
    set_issued: { title: '抽號機發到幾號？', hint: '照抽號機上的號碼輸入。比現在大：中間的號碼補成不指定。比現在小：多出來的號碼牌，在等候名單點它取消。', value: () => state.lastIssued },
    recall_ticket: { title: '叫回哪一號？', hint: '取消或剪完的號碼，放回等候名單原本的位置。', value: () => '' },
  };
  let fixAction = null;
  document.querySelector('.numfix').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fix]');
    if (!b || !state) return;
    fixAction = b.dataset.fix;
    const f = FIX[fixAction];
    $('numTitle').textContent = f.title;
    $('numHint').textContent = f.hint;
    $('numInput').value = f.value();
    $('numDialog').showModal();
    setTimeout(() => $('numInput').select(), 50);
  });
  $('numCancel').addEventListener('click', () => $('numDialog').close());
  $('numForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = parseInt($('numInput').value, 10);
    if (Number.isNaN(n)) return;
    $('numDialog').close();
    const r = await store.fix(session.pin, fixAction, n);
    toast(r.message, !r.ok);
    if (!r.ok && r.message === '密碼錯誤') { session = {}; saveSession(); startLogin(); }
  });

  $('btnReset').addEventListener('click', () => withOwner(async () => {
    if (await ask('確定把今天的號碼歸零？等候名單和所有設計師的號碼都會清空。', '歸零')) ownerAct('reset_today');
  }));
  $('btnUndoIssue').addEventListener('click', async () => {
    if (await ask(`取消剛剛加的 ${pad3(state.lastIssued)} 號？`, '取消這號')) issueAct('undo_issue');
  });

  // ---------- 店長設定 ----------
  // 要店長密碼的操作：輸入過一次就記在記憶體，關掉頁面前不用再輸
  let afterOwner = null;
  function withOwner(fn) {
    if (ownerPin) { fn(); return; }
    afterOwner = fn;
    $('ownerPinInput').value = '';
    $('ownerErr').textContent = '';
    $('ownerDialog').showModal();
    setTimeout(() => $('ownerPinInput').focus(), 50);
  }
  $('btnOwner').addEventListener('click', () => withOwner(enterOwner));
  $('ownerCancel').addEventListener('click', () => $('ownerDialog').close());
  $('ownerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('ownerPinInput').value.trim();
    const r = await store.owner(pin, 'ping');
    if (!r.ok) { $('ownerErr').textContent = r.message; return; }
    ownerPin = pin;
    $('ownerDialog').close();
    afterOwner();
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

  // 每位客人平均幾分鐘：3～60，常用的 5～30 每分鐘一格
  const AVG_OPTIONS = [...Array.from({ length: 26 }, (_, i) => i + 5), 35, 40, 45, 50, 60];
  function renderAvg() {
    if (!state) return;
    const cur = state.avgCutMinutes || cfg.avgCutMinutes || 12;
    const opts = AVG_OPTIONS.includes(cur) ? AVG_OPTIONS : [...AVG_OPTIONS, cur].sort((a, b) => a - b);
    $('avgCut').innerHTML = opts.map((m) => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('');
  }
  $('avgCut').addEventListener('change', async (e) => {
    const r = await store.avgCut(ownerPin, Number(e.target.value));
    toast(r.message, !r.ok);
    if (!r.ok) renderAvg();
  });

  // 上班時間：每半小時一格的下拉選單（手機原生的時間欄位在窄螢幕會被切掉上午／下午）。
  // 改了任一格就存，存失敗就把畫面恢復成原本的時間
  const HALF_HOURS = Array.from({ length: 36 }, (_, i) => {
    const m = 6 * 60 + i * 30;   // 06:00～23:30
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
  function timeSelect(name, k, value) {
    const opts = HALF_HOURS.includes(value) ? HALF_HOURS : [...HALF_HOURS, value].sort();
    return `<select class="field" data-k="${k}" aria-label="${esc(name)} ${k === 'start' ? '上班' : '下班'}">
      ${opts.map((v) => `<option ${v === value ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
  }
  function renderShifts() {
    if (!state) return;
    $('shifts').innerHTML = cfg.designers.map((d) => {
      const s = shiftOf(d, state);
      return `<div class="shift-row" data-id="${d.id}"><b>${esc(d.name)}</b>
        ${timeSelect(d.name, 'start', s.start)}<span>–</span>${timeSelect(d.name, 'end', s.end)}</div>`;
    }).join('');
  }
  $('shifts').addEventListener('change', async (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const [start, end] = [...row.querySelectorAll('select')].map((i) => i.value);
    const r = await store.shift(ownerPin, row.dataset.id, start, end);
    toast(r.message, !r.ok);
    if (!r.ok) renderShifts();
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

  function enterOwner() {
    show('ownerView');
    renderOffChips();
    renderCal();
    renderShifts();
    renderAvg();
  }

  // ---------- 資料同步 ----------
  function onState(s) {
    state = s;
    if (!$('mainView').hidden) renderMain();
    if (!$('ownerView').hidden) {
      renderCal();
      // 正在改的時間格不要被別支手機的更新蓋掉
      if (!$('shifts').contains(document.activeElement)) renderShifts();
      if (document.activeElement !== $('avgCut')) renderAvg();
    }
  }
  store.load().then(onState).catch(() => toast('連線失敗，請檢查網路', true));
  store.subscribe(onState, (s) => { if (s === 'error') toast('連線中斷，重新連線中…', true); });
  setInterval(() => { if (state && !$('mainView').hidden) renderMain(); }, 30000);

  if (session.pin) enterMain();
  else startLogin();
})();
