/**
 * 一起出遊 — Google Apps Script 後端
 *
 * 部署步驟：
 *   1. 開啟 https://script.google.com，新增專案
 *   2. 將此檔案內容貼入 Code.gs
 *   3. 點選「部署」→「新增部署作業」→ 類型選「網頁應用程式」
 *   4. 執行身分：我（你的 Google 帳號）
 *   5. 存取權：所有人
 *   6. 部署後複製產生的 URL，填入 app-config.js 對應環境的 apiUrl
 *      （一般使用者不需要設定 API）
 */

// ============================================================
// SPREADSHEET HELPER（自動建立，不需手動設定）
//
// 資料採用固定的 activities / items 兩張表。請勿為每個活動建立一張
// Sheet：新分頁的預設空白格會很快吃掉試算表容量，也會拖慢開啟速度。
// ============================================================

function getSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('SPREADSHEET_ID');

  if (!ssId) {
    const ss = SpreadsheetApp.create('一起出遊 — 資料庫');
    ssId = ss.getId();
    props.setProperty('SPREADSHEET_ID', ssId);

    const sheet = ss.getSheets()[0];
    sheet.setName('activities');
  }

  const ss = SpreadsheetApp.openById(ssId);
  ensureSchema(ss);
  return ss;
}

function styleHeader(sheet, columns) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columns)
    .setBackground('#16a34a')
    .setFontColor('white')
    .setFontWeight('bold');
}

function ensureHeader(sheet, headers) {
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  const matches = headers.every((header, index) => current[index] === header);
  if (!matches) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader(sheet, headers.length);
  }
}

function ensureSchema(ss) {
  const activities = ss.getSheetByName('activities');
  if (!activities) throw new Error('資料庫缺少 activities 工作表');

  // 舊版只建立四個標題，實際上第五欄已在儲存 schedule；第六欄用來標示
  // 已遷移至集中式 items 資料表的活動。
  ensureHeader(activities, ['activityId', 'name', 'members', 'createdAt', 'schedule', 'storageVersion']);

  let items = ss.getSheetByName('items');
  if (!items) {
    items = ss.insertSheet('items');
    items.appendRow(['activityId', 'itemId', 'name', 'claimers', 'payer', 'amount', 'sharers', 'updatedAt', 'amountSet']);
    items.setColumnWidth(1, 100);
    items.setColumnWidth(2, 90);
    items.setColumnWidth(3, 180);
    items.setColumnWidth(4, 200);
    items.setColumnWidth(5, 100);
    items.setColumnWidth(6, 80);
    items.setColumnWidth(7, 150);
    items.setColumnWidth(8, 180);
    items.setColumnWidth(9, 90);
    styleHeader(items, 9);
  } else {
    ensureHeader(items, ['activityId', 'itemId', 'name', 'claimers', 'payer', 'amount', 'sharers', 'updatedAt', 'amountSet']);
  }
}

function getActivitiesSheet(ss) {
  return ss.getSheetByName('activities');
}

function getItemsSheet(ss) {
  return ss.getSheetByName('items');
}

function findActivityRow(activitiesSheet, activityId) {
  const rows = activitiesSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(activityId)) return { row: i + 1, values: rows[i] };
  }
  return null;
}

function readItems(ss, activityId) {
  const itemSheet = getItemsSheet(ss);
  const rows = itemSheet.getDataRange().getValues();
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(activityId) || !rows[i][1]) continue;
    // 舊資料沒有 amountSet；非零金額視為已填，舊的 0 則維持「未填」。
    const amountSet = rows[i][8] === true || String(rows[i][8]).toLowerCase() === 'true' ||
      (rows[i][8] === '' && rows[i][5] !== '' && Number(rows[i][5]) !== 0);
    items.push({
      id: String(rows[i][1]), name: String(rows[i][2]),
      claimers: safeJSON(rows[i][3], []),
      payer: String(rows[i][4] || ''), amount: amountSet ? Number(rows[i][5]) || 0 : null,
      sharers: safeJSON(rows[i][6], null)
    });
  }
  return items;
}

// 保留既有活動資料：第一次讀取舊活動時，將舊活動分頁的資料複製進 items。
// 不刪除舊分頁，避免遷移時造成使用者資料遺失；確認無誤後可由擁有者手動清理。
function migrateLegacyActivityIfNeeded(ss, activityInfo, lockAlreadyHeld) {
  if (activityInfo.values[5] === 'central-v1') return;

  const lock = lockAlreadyHeld ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(15000)) throw new Error('伺服器忙碌中，請稍後再試');
  try {
    // 等待鎖期間，另一個請求可能已完成遷移；重新讀取狀態後才決定是否複製。
    const latest = findActivityRow(getActivitiesSheet(ss), activityInfo.values[0]);
    if (!latest || latest.values[5] === 'central-v1') return;

    const legacySheet = ss.getSheetByName(String(latest.values[0]));
    const itemSheet = getItemsSheet(ss);
    if (legacySheet) {
      const rows = legacySheet.getDataRange().getValues();
      const migratedRows = [];
      for (let i = 1; i < rows.length; i++) {
        if (!rows[i][0]) continue;
        migratedRows.push([
          String(latest.values[0]), String(rows[i][0]), String(rows[i][1]),
          JSON.stringify(safeJSON(rows[i][2], [])), String(rows[i][3] || ''),
          Number(rows[i][4]) || 0, JSON.stringify(safeJSON(rows[i][5], null)),
          new Date().toISOString(), Number(rows[i][4]) !== 0
        ]);
      }
      if (migratedRows.length) {
        itemSheet.getRange(itemSheet.getLastRow() + 1, 1, migratedRows.length, 9).setValues(migratedRows);
      }
    }
    getActivitiesSheet(ss).getRange(latest.row, 6).setValue('central-v1');
  } finally {
    if (lock) lock.releaseLock();
  }
}

function generateId(length) {
  // 全大寫讓使用者可以在手機上更容易輸入與辨識活動代碼。
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < (length || 8); i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str || JSON.stringify(fallback)); } catch (e) { return fallback; }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// HTTP HANDLERS
// ============================================================

function doGet(e) {
  try {
    const action = e.parameter.action;

    // Read-only endpoints
    if (action === 'ping') return respond({ status: 'ok', time: new Date().toISOString() });
    if (action === 'getActivity') return handleGetActivity(e.parameter.id);

    // Write operations: support both 'payload' (new) and 'data' base64 (legacy)
    const rawPayload = e.parameter.payload || '';
    const rawData    = e.parameter.data    || '';
    if (rawPayload || rawData) {
      let body;
      if (rawPayload) {
        body = JSON.parse(rawPayload);
      } else {
        // Legacy base64 decode (use for-loop; .map() unreliable on Apps Script byte[])
        const rawBytes = Utilities.base64Decode(rawData);
        let pctEncoded = '';
        for (let i = 0; i < rawBytes.length; i++) {
          const b = rawBytes[i];
          pctEncoded += String.fromCharCode(b < 0 ? b + 256 : b);
        }
        body = JSON.parse(decodeURIComponent(pctEncoded));
      }
      // body is now parsed
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(15000)) return respond({ error: '伺服器忙碌中，請稍後再試' });
      try {
        switch (body.action) {
          case 'createActivity': return handleCreate(body);
          case 'updateItem':     return handleUpdateItem(body);
          case 'addItem':        return handleAddItem(body);
          case 'deleteItem':     return handleDeleteItem(body);
          case 'updateSchedule': return handleUpdateSchedule(body);
          case 'reorderItems':   return handleReorderItems(body);
          default: return respond({ error: 'Unknown action: ' + body.action });
        }
      } finally { lock.releaseLock(); }
    }

    return respond({ error: 'Unknown GET action: ' + action });
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return respond({ error: '伺服器忙碌中，請稍後再試' });
    try {
      switch (body.action) {
        case 'createActivity': return handleCreate(body);
        case 'updateItem':     return handleUpdateItem(body);
        case 'addItem':        return handleAddItem(body);
        case 'deleteItem':     return handleDeleteItem(body);
        case 'updateSchedule': return handleUpdateSchedule(body);
        case 'reorderItems':   return handleReorderItems(body);
        default: return respond({ error: 'Unknown action: ' + body.action });
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return respond({ error: err.toString() });
  }
}

// ============================================================
// ACTION HANDLERS
// ============================================================

function handleCreate(body) {
  const { name, members, items, customId } = body;
  if (!name || !Array.isArray(members) || !Array.isArray(items))
    return respond({ error: '缺少必要欄位（name / members / items）' });
  if (members.length === 0) return respond({ error: '至少需要一位成員' });

  const normalMembers = members.map(m => String(m).trim()).filter(Boolean);
  const normalItems = items.map(i => String(i).trim()).filter(Boolean);
  if (normalMembers.length === 0) return respond({ error: '至少需要一位有效成員' });
  if (new Set(normalMembers).size !== normalMembers.length) return respond({ error: '成員名稱不可重複' });
  if (new Set(normalItems).size !== normalItems.length) return respond({ error: '品項名稱不可重複' });
  if (normalMembers.some(m => m.length > 50) || normalItems.some(i => i.length > 100) || String(name).trim().length > 100) {
    return respond({ error: '活動名稱最多 100 字；成員名稱最多 50 字；品項名稱最多 100 字' });
  }

  const ss = getSpreadsheet();
  const activitiesSheet = getActivitiesSheet(ss);
  let actId = String(customId || '').trim().toUpperCase();
  if (actId && !/^[A-Z0-9]{3,24}$/.test(actId)) {
    return respond({ error: '自訂活動代碼須為 3～24 位英文字母或數字' });
  }
  if (actId && findActivityRow(activitiesSheet, actId)) {
    return respond({ error: '此活動代碼已被使用，請換一個' });
  }
  if (!actId) {
    actId = generateId(8);
    while (findActivityRow(activitiesSheet, actId)) actId = generateId(8);
  }
  const now = new Date().toISOString();

  activitiesSheet.appendRow([actId, String(name).trim(), JSON.stringify(normalMembers), now, '[]', 'central-v1']);

  const itemRows = normalItems.map(itemName => [
    actId, generateId(6), itemName, '[]', '', '', 'null', now, false
  ]);
  if (itemRows.length) {
    const itemsSheet = getItemsSheet(ss);
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, 9).setValues(itemRows);
  }

  return respond({ success: true, activityId: actId });
}

function handleGetActivity(id) {
  if (!id) return respond({ error: '缺少活動 ID' });

  const ss = getSpreadsheet();
  const activitiesSheet = getActivitiesSheet(ss);
  // 自訂代碼一律儲存為大寫；保留舊版亂數代碼的精確比對相容性。
  const activityInfo = findActivityRow(activitiesSheet, id) || findActivityRow(activitiesSheet, String(id).trim().toUpperCase());
  if (!activityInfo) return respond({ error: '找不到此活動，請確認活動代碼是否正確' });

  migrateLegacyActivityIfNeeded(ss, activityInfo);
  const values = activityInfo.values;
  const activity = {
    id: values[0], name: values[1],
    members: safeJSON(values[2], []), createdAt: values[3],
    schedule: safeJSON(values[4], []), items: readItems(ss, values[0])
  };

  return respond({ success: true, activity });
}

function handleUpdateItem(body) {
  const { activityId, itemId, name, claimers, payer, amount, sharers } = body;
  if (!activityId || !itemId) return respond({ error: '缺少 activityId 或 itemId' });

  const ss = getSpreadsheet();
  const activityInfo = findActivityRow(getActivitiesSheet(ss), activityId);
  if (!activityInfo) return respond({ error: '找不到此活動' });
  migrateLegacyActivityIfNeeded(ss, activityInfo, true);
  const members = safeJSON(activityInfo.values[2], []);
  if (!Array.isArray(claimers) || (sharers !== null && sharers !== undefined && !Array.isArray(sharers))) {
    return respond({ error: '認領人與分攤人格式錯誤' });
  }
  const validClaimers = claimers.every(m => members.includes(m));
  const validPayer = !payer || members.includes(payer);
  const validSharers = !sharers || (sharers.length > 0 && sharers.every(m => members.includes(m)));
  if (!validClaimers || !validPayer || !validSharers) return respond({ error: '認領人、代墊人與分攤人必須是活動成員' });
  const amountSet = amount !== null && amount !== undefined && amount !== '';
  if (amountSet && (!Number.isFinite(Number(amount)) || Number(amount) < 0)) return respond({ error: '金額必須是非負數字' });
  if (name !== undefined && !String(name).trim()) return respond({ error: '品項名稱不可空白' });
  if (name !== undefined && String(name).trim().length > 100) return respond({ error: '品項名稱最多 100 字' });

  const sheet = getItemsSheet(ss);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(activityId) && String(rows[i][1]) === String(itemId)) {
      sheet.getRange(i + 1, 3, 1, 7).setValues([[
        String(name === undefined ? rows[i][2] : name).trim(), JSON.stringify(claimers), payer || '',
        amountSet ? Number(amount) : '', JSON.stringify(sharers || null), new Date().toISOString(), amountSet
      ]]);
      return respond({ success: true });
    }
  }

  return respond({ error: '找不到此品項' });
}

function handleAddItem(body) {
  const { activityId, name } = body;
  if (!activityId || !name || !String(name).trim()) return respond({ error: '缺少 activityId 或 name' });
  if (String(name).trim().length > 100) return respond({ error: '品項名稱最多 100 字' });

  const ss = getSpreadsheet();
  const activityInfo = findActivityRow(getActivitiesSheet(ss), activityId);
  if (!activityInfo) return respond({ error: '找不到此活動' });
  migrateLegacyActivityIfNeeded(ss, activityInfo, true);
  if (readItems(ss, activityId).some(item => item.name === String(name).trim())) {
    return respond({ error: '已有相同名稱的品項' });
  }
  const itemId = generateId(6);
  getItemsSheet(ss).appendRow([activityId, itemId, String(name).trim(), '[]', '', '', 'null', new Date().toISOString(), false]);

  return respond({ success: true, itemId });
}

function handleDeleteItem(body) {
  const { activityId, itemId } = body;
  if (!activityId || !itemId) return respond({ error: '缺少 activityId 或 itemId' });

  const ss = getSpreadsheet();
  const activityInfo = findActivityRow(getActivitiesSheet(ss), activityId);
  if (!activityInfo) return respond({ error: '找不到此活動' });
  migrateLegacyActivityIfNeeded(ss, activityInfo, true);
  const sheet = getItemsSheet(ss);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(activityId) && String(rows[i][1]) === String(itemId)) {
      sheet.deleteRow(i + 1);
      return respond({ success: true });
    }
  }

  return respond({ error: '找不到此品項' });
}

function handleUpdateSchedule(body) {
  const { activityId, schedule } = body;
  if (!activityId || !Array.isArray(schedule)) return respond({ error: '缺少 activityId 或 schedule' });
  if (schedule.length > 100 || schedule.some(s => !s || typeof s.time !== 'string' || typeof s.title !== 'string' ||
      (s.location !== undefined && typeof s.location !== 'string') ||
      (s.locationUrl !== undefined && (typeof s.locationUrl !== 'string' || (s.locationUrl && !isValidExternalUrl(s.locationUrl)))) ||
      (s.date !== undefined && (typeof s.date !== 'string' || (s.date && !isValidScheduleDate(s.date)))) ||
      s.time.length > 30 || s.location?.length > 100 || s.title.length > 200 || s.locationUrl?.length > 500)) {
    return respond({ error: '行程資料格式錯誤或超過上限' });
  }

  // date 是新版欄位；舊活動沒有 date 時保留空字串，讓前端提示補填。
  const normalizedSchedule = schedule.map(s => ({
    date: String(s.date || ''), time: s.time,
    location: String(s.location || ''), title: s.title,
    locationUrl: String(s.locationUrl || '')
  }));

  const ss = getSpreadsheet();
  const activitiesSheet = ss.getSheetByName('activities');
  if (!activitiesSheet) return respond({ error: '資料庫尚未初始化' });

  const rows = activitiesSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(activityId)) {
      activitiesSheet.getRange(i + 1, 5).setValue(JSON.stringify(normalizedSchedule));
      return respond({ success: true });
    }
  }
  return respond({ error: '找不到此活動' });
}

function isValidScheduleDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function isValidExternalUrl(value) {
  if (typeof value !== 'string') return false;
  return value.startsWith('http://') || value.startsWith('https://');
}

function handleReorderItems(body) {
  const { activityId, itemIds } = body;
  if (!activityId || !Array.isArray(itemIds)) return respond({ error: '缺少 activityId 或 itemIds' });

  const ss = getSpreadsheet();
  const activityInfo = findActivityRow(getActivitiesSheet(ss), activityId);
  if (!activityInfo) return respond({ error: '找不到此活動' });
  migrateLegacyActivityIfNeeded(ss, activityInfo, true);

  const sheet = getItemsSheet(ss);
  const rows = sheet.getDataRange().getValues();
  
  const rowIndices = [];
  const rowsData = [];
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(activityId)) {
      rowIndices.push(i);
      rowsData.push(rows[i]);
    }
  }
  
  rowsData.sort((a, b) => {
    let idxA = itemIds.indexOf(String(a[1]));
    let idxB = itemIds.indexOf(String(b[1]));
    if (idxA === -1) idxA = 9999;
    if (idxB === -1) idxB = 9999;
    return idxA - idxB;
  });
  
  for (let k = 0; k < rowIndices.length; k++) {
    const rowIndex = rowIndices[k] + 1;
    sheet.getRange(rowIndex, 1, 1, rowsData[k].length).setValues([rowsData[k]]);
  }
  return respond({ success: true });
}
