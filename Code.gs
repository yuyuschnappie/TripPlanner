/**
 * 旅遊版 Apps Script 後端
 *
 * Java 對照：
 * doGet/doPost              = Application entry point
 * TravelController          = @RestController
 * TravelService             = @Service
 * SettlementService         = domain service
 * TravelRepository          = @Repository
 */

const SHEETS = Object.freeze({
  trips: ['code', 'name', 'members', 'currencies', 'createdAt', 'dates', 'rouletteEnabled'],
  wishlist: ['tripCode', 'id', 'title', 'linkUrl', 'linkLabel', 'imageUrl', 'createdBy', 'position', 'updatedAt', 'details', 'links', 'imageUrls'],
  itinerary: ['tripCode', 'id', 'date', 'time', 'title', 'location', 'linkUrl', 'updatedAt'],
  expenses: ['tripCode', 'id', 'title', 'payer', 'settlementCurrency', 'amounts', 'sharers', 'createdBy', 'position', 'updatedAt', 'date']
});

function doGet(e) {
  return TravelController.handle(Object.assign({}, e && e.parameter, {method: 'GET'}));
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (error) { return ApiResponse.error('JSON 格式錯誤'); }
  return TravelController.handle(Object.assign({}, body, {method: 'POST'}));
}

class TravelController {
  static handle(request) {
    try {
      const service = new TravelService(new TravelRepository());
      const action = String(request.action || 'ping');
      const routes = {
        ping: () => ({status: 'ok', application: 'travel-planner'}),
        createTrip: () => service.createTrip(request),
        getTrip: () => service.getTrip(request.code || request.id, request.refresh),
        saveWishlist: () => service.saveWishlist(request),
        deleteWishlist: () => service.deleteWishlist(request),
        reorderWishlist: () => service.reorder('wishlist', request),
        saveItinerary: () => service.saveItinerary(request),
        deleteItinerary: () => service.deleteItinerary(request),
        saveTripDates: () => service.saveTripDates(request),
        deleteTripDate: () => service.deleteTripDate(request),
        saveExpense: () => service.saveExpense(request),
        deleteExpense: () => service.deleteExpense(request),
        reorderExpenses: () => service.reorder('expenses', request),
        settlement: () => service.settlement(request.code),
        uploadImage: () => service.uploadImage(request)
      };
      if (!routes[action]) throw new Error('不支援的操作：' + action);
      const requiresLock = ['createTrip', 'deleteWishlist', 'reorderWishlist', 'deleteItinerary', 'deleteTripDate', 'deleteExpense', 'reorderExpenses'].includes(action);
      return ApiResponse.ok(requiresLock ? this.withShortLock(routes[action]) : routes[action]());
    } catch (error) {
      console.error(error && error.stack ? error.stack : error);
      return ApiResponse.error(error.message || '系統發生錯誤');
    }
  }

  static withShortLock(task) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) throw new Error('目前有其他資料正在更新，請稍後再試');
    try { return task(); }
    finally { lock.releaseLock(); }
  }
}

class TravelService {
  constructor(repository) { this.repository = repository; }

  createTrip(request) {
    const name = Text.required(request.name, '請輸入旅遊名稱', 100);
    const members = Model.stringList(request.members, '至少需要一位成員');
    const currencies = Model.currencies(request.currencies);
    let code = String(request.customCode || '').trim().toUpperCase();
    if (code && !/^[A-Z0-9]{3,24}$/.test(code)) throw new Error('活動代碼須為 3～24 位英數字');
    if (!code) code = this.newCode();
    if (this.repository.findTrip(code)) throw new Error('活動代碼已被使用');
    const rouletteEnabled = request.rouletteEnabled === true || String(request.rouletteEnabled).toLowerCase() === 'true';
    this.repository.append('trips', [code, name, JSON.stringify(members), JSON.stringify(currencies), new Date().toISOString(), JSON.stringify([]), rouletteEnabled]);
    const trip = {code, name, members, currencies, dates: [], rouletteEnabled, wishlist: [], itinerary: [], expenses: []};
    this.cacheTrip(trip);
    return trip;
  }

  getTrip(code, refresh) {
    code = String(code || '').trim().toUpperCase();
    const forceRefresh = refresh === true || String(refresh).toLowerCase() === 'true' || String(refresh) === '1';
    const cached = forceRefresh ? null : this.cachedTrip(code);
    if (cached) return cached;
    const trip = forceRefresh ? this.repository.findTrip(code) : this.requireTrip(code);
    if (!trip) throw new Error('找不到此旅遊活動');
    const result = Object.assign({}, trip, {
      wishlist: this.repository.findAll('wishlist', trip.code).sort(Sort.byPosition),
      itinerary: this.repository.findAll('itinerary', trip.code).sort(Sort.byDateTime),
      expenses: this.repository.findAll('expenses', trip.code).sort(Sort.byPosition)
    });
    this.cacheTrip(result);
    return result;
  }

  saveWishlist(request) {
    const trip = this.requireTrip(request.code);
    const requestedId = String(request.id || '').trim();
    const id = requestedId || Utilities.getUuid();
    const createdBy = this.requireMember(trip, request.createdBy);
    const existing = this.repository.findById('wishlist', trip.code, id);
    if (request.mode === 'update' && !existing) throw new Error('找不到要編輯的慾望卡片，請重新整理後再試');
    const links = Model.links(request.links);
    const firstLink = links[0] || {url: Text.url(request.linkUrl), label: Text.optional(request.linkLabel, 60)};
    const retainedImages = Model.imageUrls(Array.isArray(request.imageUrls) ? request.imageUrls : (existing && Array.isArray(existing.imageUrls) && existing.imageUrls.length ? existing.imageUrls : (request.imageUrl ? [request.imageUrl] : (existing && existing.imageUrl ? [existing.imageUrl] : []))));
    const imageDataUrls = Array.isArray(request.imageDataUrls) ? request.imageDataUrls.filter(Boolean) : (request.imageDataUrl ? [request.imageDataUrl] : []);
    if (retainedImages.length + imageDataUrls.length > 10) throw new Error('一張慾望卡最多可放 10 張照片');
    const uploadedImages = imageDataUrls.map(dataUrl => this.uploadImage({dataUrl}).url);
    const imageUrls = Model.imageUrls(retainedImages.concat(uploadedImages));
    const item = {
      tripCode: trip.code, id,
      title: Text.required(request.title, '請輸入標題', 160),
      linkUrl: firstLink.url || '',
      linkLabel: firstLink.label || '',
      imageUrl: imageUrls[0] || '',
      createdBy: existing ? existing.createdBy : createdBy,
      position: existing ? existing.position : this.repository.findAll('wishlist', trip.code).length,
      updatedAt: new Date().toISOString(),
      details: Text.optional(request.details, 2000),
      links, imageUrls
    };
    this.repository.upsert('wishlist', item);
    this.updateCachedCollection(trip.code, 'wishlist', item);
    return item;
  }

  deleteWishlist(request) { const trip = this.requireTrip(request.code); this.repository.remove('wishlist', trip.code, request.id); this.removeCachedItem(trip.code, 'wishlist', request.id); return {success: true}; }

  saveItinerary(request) {
    const trip = this.requireTrip(request.code);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(request.date || ''))) throw new Error('請選擇日期');
    const id = String(request.id || Utilities.getUuid());
    const existing = this.repository.findById('itinerary', trip.code, id);
    if (request.mode === 'update' && !existing) throw new Error('找不到要編輯的行程，請重新整理後再試');
    const item = {
      tripCode: trip.code, id, date: request.date,
      time: String(request.time || ''), title: Text.required(request.title, '請輸入行程內容', 160),
      location: Text.optional(request.location, 160), linkUrl: Text.url(request.linkUrl),
      updatedAt: new Date().toISOString()
    };
    this.repository.upsert('itinerary', item);
    if (!trip.dates.includes(item.date)) {
      trip.dates = [...trip.dates, item.date].sort();
      this.repository.setTripDates(trip.code, trip.dates);
      this.updateCachedDates(trip.code, trip.dates);
    }
    this.updateCachedCollection(trip.code, 'itinerary', item);
    return item;
  }

  deleteItinerary(request) { const trip = this.requireTrip(request.code); this.repository.remove('itinerary', trip.code, request.id); this.removeCachedItem(trip.code, 'itinerary', request.id); return {success: true}; }

  saveTripDates(request) {
    const trip = this.requireTrip(request.code);
    const dates = Model.dates(request.dates);
    this.repository.setTripDates(trip.code, dates);
    this.updateCachedDates(trip.code, dates);
    return dates;
  }

  deleteTripDate(request) {
    const trip = this.requireTrip(request.code);
    const date = String(request.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式錯誤');
    this.repository.removeItineraryByDate(trip.code, date);
    const dates = (trip.dates || []).filter(item => item !== date);
    this.repository.setTripDates(trip.code, dates);
    this.updateCachedDates(trip.code, dates);
    return {date, dates};
  }

  saveExpense(request) {
    const trip = this.requireTrip(request.code);
    const id = String(request.id || Utilities.getUuid());
    const existing = this.repository.findById('expenses', trip.code, id);
    if (request.mode === 'update' && !existing) throw new Error('找不到要編輯的記帳，請重新整理後再試');
    const payer = this.requireMember(trip, request.payer);
    const createdBy = this.requireMember(trip, request.createdBy);
    const sharers = Model.stringList(request.sharers, '至少選擇一位分攤人');
    sharers.forEach(member => this.requireMember(trip, member));
    const amounts = Model.amounts(request.amounts, trip.currencies);
    const settlementCurrency = amounts.length === 1 ? amounts[0].currencyCode : String(request.settlementCurrency || '').toUpperCase();
    if (!amounts.some(amount => amount.currencyCode === settlementCurrency)) throw new Error('必須填寫所選結算幣別的金額');
    const item = {
      tripCode: trip.code, id, title: Text.required(request.title, '請輸入記帳名稱', 160), payer,
      settlementCurrency, amounts, sharers, createdBy: existing ? existing.createdBy : createdBy,
      position: existing ? existing.position : this.repository.findAll('expenses', trip.code).length,
      updatedAt: new Date().toISOString(),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(request.date || '')) ? request.date : Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd')
    };
    this.repository.upsert('expenses', item);
    this.updateCachedCollection(trip.code, 'expenses', item);
    return item;
  }

  deleteExpense(request) { const trip = this.requireTrip(request.code); this.repository.remove('expenses', trip.code, request.id); this.removeCachedItem(trip.code, 'expenses', request.id); return {success: true}; }

  reorder(sheetName, request) {
    const trip = this.requireTrip(request.code);
    const ids = Model.stringList(request.ids, '排序資料不可為空');
    const current = this.repository.findAll(sheetName, trip.code);
    if (ids.length !== current.length || current.some(item => !ids.includes(String(item.id)))) throw new Error('排序資料與清單不一致');
    ids.forEach((id, position) => this.repository.updateField(sheetName, trip.code, id, 'position', position));
    this.reorderCachedCollection(trip.code, sheetName, ids);
    return {success: true};
  }

  settlement(code) {
    const trip = this.requireTrip(code);
    return SettlementService.calculate(trip, this.repository.findAll('expenses', trip.code));
  }

  uploadImage(request) {
    const dataUrl = String(request.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
    if (!match) throw new Error('圖片格式不支援');
    const bytes = Utilities.base64Decode(match[2]);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('圖片不可超過 8MB');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[match[1]];
    const folder = this.imageFolder();
    const file = folder.createFile(Utilities.newBlob(bytes, match[1], Utilities.getUuid() + '.' + extension));
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return {url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1600'};
  }

  imageFolder() {
    const properties = PropertiesService.getScriptProperties();
    const storedId = properties.getProperty('IMAGE_FOLDER_ID');
    if (storedId) { try { return DriveApp.getFolderById(storedId); } catch (ignored) {} }
    const folder = DriveApp.createFolder('一起出遊－旅遊圖片');
    properties.setProperty('IMAGE_FOLDER_ID', folder.getId());
    return folder;
  }

  requireTrip(code) {
    code = String(code || '').trim().toUpperCase();
    const trip = this.cachedTrip(code) || this.cachedTripMeta(code) || this.repository.findTrip(code);
    if (!trip) throw new Error('找不到此旅遊活動');
    this.cacheTripMeta(trip);
    return trip;
  }
  requireMember(trip, member) {
    member = String(member || '').trim();
    if (!trip.members.includes(member)) throw new Error('請先選擇旅遊成員');
    return member;
  }
  cachedTrip(code) {
    if (!code) return null;
    try {
      const value = CacheService.getScriptCache().get('trip:' + code);
      if (!value) return null;
      const trip = JSON.parse(value); trip.dates = Array.isArray(trip.dates) ? trip.dates : [];
      return trip;
    } catch (ignored) { return null; }
  }
  cachedTripMeta(code) {
    try {
      const value = CacheService.getScriptCache().get('trip-meta:' + code);
      return value ? JSON.parse(value) : null;
    } catch (ignored) { return null; }
  }
  cacheTripMeta(trip) {
    try {
      const metadata = {code: trip.code, name: trip.name, members: trip.members, currencies: trip.currencies, dates: Array.isArray(trip.dates) ? trip.dates : [], rouletteEnabled: Boolean(trip.rouletteEnabled)};
      CacheService.getScriptCache().put('trip-meta:' + trip.code, JSON.stringify(metadata), 1800);
    } catch (ignored) {}
  }
  cacheTrip(trip) {
    try {
      CacheService.getScriptCache().put('trip:' + trip.code, JSON.stringify(trip), 1800);
      this.cacheTripMeta(trip);
    }
    catch (ignored) {}
  }
  invalidateTrip(code) {
    try { CacheService.getScriptCache().remove('trip:' + code); }
    catch (ignored) {}
  }
  updateCachedCollection(code, collection, item) {
    this.invalidateTrip(code);
  }
  removeCachedItem(code, collection, id) {
    this.invalidateTrip(code);
  }
  reorderCachedCollection(code, collection, ids) {
    this.invalidateTrip(code);
  }
  updateCachedDates(code, dates) {
    try {
      const trip = this.cachedTripMeta(code);
      if (trip) { trip.dates = dates; CacheService.getScriptCache().put('trip-meta:' + code, JSON.stringify(trip), 1800); }
    } catch (ignored) {}
    this.invalidateTrip(code);
  }
  newCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
    while (this.repository.findTrip(code));
    return code;
  }
}

class SettlementService {
  static calculate(trip, expenses) {
    return trip.currencies.map(currency => {
      const selected = expenses.filter(expense => expense.settlementCurrency === currency.code);
      if (!selected.length) return null;
      const paid = Object.fromEntries(trip.members.map(member => [member, 0]));
      const balance = Object.fromEntries(trip.members.map(member => [member, 0]));
      let total = 0;
      selected.forEach(expense => {
        const money = expense.amounts.find(amount => amount.currencyCode === currency.code);
        if (!money) throw new Error(expense.title + ' 缺少結算幣別金額');
        const factor = Math.pow(10, currency.decimalPlaces);
        const amount = Math.ceil(Number(money.amount) * factor);
        paid[expense.payer] += amount; balance[expense.payer] += amount; total += amount;
        const base = Math.floor(amount / expense.sharers.length), remainder = amount % expense.sharers.length;
        expense.sharers.forEach((member, index) => balance[member] -= base + (index < remainder ? 1 : 0));
      });
      const creditors = trip.members.filter(m => balance[m] > 0).map(m => ({name:m, amount:balance[m]})).sort((a,b) => b.amount-a.amount);
      const debtors = trip.members.filter(m => balance[m] < 0).map(m => ({name:m, amount:-balance[m]})).sort((a,b) => b.amount-a.amount);
      const transfers = []; let ci = 0, di = 0;
      while (ci < creditors.length && di < debtors.length) {
        const amount = Math.min(creditors[ci].amount, debtors[di].amount);
        transfers.push({from: debtors[di].name, to: creditors[ci].name, amount: amount / Math.pow(10, currency.decimalPlaces)});
        creditors[ci].amount -= amount; debtors[di].amount -= amount;
        if (!creditors[ci].amount) ci++; if (!debtors[di].amount) di++;
      }
      return {currency, total: total / Math.pow(10, currency.decimalPlaces), transfers,
        personalCost: Object.fromEntries(trip.members.map(member => [member, (paid[member] - balance[member]) / Math.pow(10, currency.decimalPlaces)]))};
    }).filter(Boolean);
  }
}

class TravelRepository {
  constructor() { this.spreadsheet = null; this.rowCache = {}; }
  database() {
    if (this.spreadsheet) return this.spreadsheet;
    const properties = PropertiesService.getScriptProperties();
    const id = properties.getProperty('SPREADSHEET_ID');
    if (id) { this.spreadsheet = SpreadsheetApp.openById(id); return this.spreadsheet; }
    const spreadsheet = SpreadsheetApp.create('一起出遊－旅遊資料庫');
    spreadsheet.setSpreadsheetTimeZone('Asia/Taipei');
    properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
    this.spreadsheet = spreadsheet;
    return this.spreadsheet;
  }
  sheet(name) {
    const spreadsheet = this.database();
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) { sheet = spreadsheet.insertSheet(name); sheet.appendRow(SHEETS[name]); sheet.setFrozenRows(1); }
    else if (sheet.getLastColumn() < SHEETS[name].length) sheet.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    return sheet;
  }
  rows(name) {
    if (this.rowCache[name]) return this.rowCache[name];
    const values = this.sheet(name).getDataRange().getValues();
    this.rowCache[name] = values.slice(1).filter(row => row.some(value => value !== '')).map((row, index) => {
      const object = {_row: index + 2};
      SHEETS[name].forEach((header, column) => object[header] = this.parse(header, row[column]));
      return object;
    });
    return this.rowCache[name];
  }
  parse(field, value) {
    if (['members','currencies','amounts','sharers','dates','links','imageUrls'].includes(field)) { try { return JSON.parse(value || '[]'); } catch (ignored) { return []; } }
    if (field === 'rouletteEnabled') return value === true || String(value).toLowerCase() === 'true';
    if (field === 'position') return Number(value || 0);
    if (value instanceof Date) {
      const timezone = this.database().getSpreadsheetTimeZone() || 'Asia/Taipei';
      if (field === 'date') return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
      if (field === 'time') return Utilities.formatDate(value, timezone, 'HH:mm');
      return value.toISOString();
    }
    return value;
  }
  serialize(name, object) { return SHEETS[name].map(field => ['members','currencies','amounts','sharers','dates','links','imageUrls'].includes(field) ? JSON.stringify(object[field] || []) : object[field]); }
  append(name, row) {
    const sheet = this.sheet(name), rowNumber = sheet.getLastRow() + 1;
    if (name === 'itinerary') sheet.getRange(rowNumber, 3, 1, 2).setNumberFormat('@');
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    delete this.rowCache[name];
  }
  findTrip(code) {
    const row = this.rows('trips').find(item => String(item.code).toUpperCase() === code);
    return row ? {code: row.code, name: row.name, members: row.members, currencies: row.currencies, dates: row.dates || [], rouletteEnabled: Boolean(row.rouletteEnabled)} : null;
  }
  setTripDates(code, dates) {
    const existing = this.rows('trips').find(item => String(item.code).toUpperCase() === code); if (!existing) throw new Error('找不到此旅遊活動');
    this.sheet('trips').getRange(existing._row, SHEETS.trips.indexOf('dates') + 1).setValue(JSON.stringify(dates));
    delete this.rowCache.trips;
  }
  findAll(name, tripCode) { return this.rows(name).filter(item => String(item.tripCode).toUpperCase() === tripCode); }
  findById(name, tripCode, id) { return this.findAll(name, tripCode).find(item => String(item.id) === String(id)); }
  upsert(name, object) {
    const existing = this.findById(name, object.tripCode, object.id), values = this.serialize(name, object);
    const sheet = this.sheet(name);
    if (existing) {
      if (name === 'itinerary') sheet.getRange(existing._row, 3, 1, 2).setNumberFormat('@');
      sheet.getRange(existing._row, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
      if (name === 'itinerary') sheet.getRange(sheet.getLastRow(), 3, 1, 2).setNumberFormat('@');
    }
    delete this.rowCache[name];
  }
  updateField(name, tripCode, id, field, value) {
    const existing = this.findById(name, tripCode, id); if (!existing) throw new Error('找不到資料');
    this.sheet(name).getRange(existing._row, SHEETS[name].indexOf(field) + 1).setValue(value);
    delete this.rowCache[name];
  }
  remove(name, tripCode, id) {
    const existing = this.findById(name, tripCode, id); if (!existing) throw new Error('找不到資料');
    this.sheet(name).deleteRow(existing._row);
    delete this.rowCache[name];
  }
  removeItineraryByDate(tripCode, date) {
    const rows = this.findAll('itinerary', tripCode).filter(item => String(item.date) === date).sort((a, b) => b._row - a._row);
    const sheet = this.sheet('itinerary');
    rows.forEach(item => sheet.deleteRow(item._row));
    delete this.rowCache.itinerary;
  }
}

class Model {
  static stringList(value, message) {
    const list = Array.isArray(value) ? value.map(String).map(v => v.trim()).filter(Boolean) : [];
    const unique = [...new Set(list)]; if (!unique.length) throw new Error(message); return unique;
  }
  static currencies(value) {
    if (!Array.isArray(value) || !value.length) throw new Error('至少設定一種幣別');
    const result = value.map(item => ({code: String(item.code || '').trim().toUpperCase(), name: Text.required(item.name, '請輸入幣別名稱', 30), symbol: Text.required(item.symbol, '請輸入幣別符號', 8), decimalPlaces: Math.max(0, Math.min(2, Number(item.decimalPlaces || 0)))}));
    if (result.some(item => !/^[A-Z]{3,8}$/.test(item.code)) || new Set(result.map(item => item.code)).size !== result.length) throw new Error('幣別代碼須為 3～8 位英文字且不可重複');
    return result;
  }
  static amounts(value, currencies) {
    const supported = currencies.map(currency => currency.code);
    const result = (Array.isArray(value) ? value : []).filter(item => item.amount !== '' && item.amount != null).map(item => ({currencyCode: String(item.currencyCode || '').toUpperCase(), amount: Number(item.amount)}));
    if (!result.length || result.some(item => !supported.includes(item.currencyCode) || !Number.isFinite(item.amount) || item.amount <= 0) || new Set(result.map(item => item.currencyCode)).size !== result.length) throw new Error('請正確填寫至少一筆幣別金額');
    return result;
  }
  static dates(value) {
    const dates = [...new Set((Array.isArray(value) ? value : []).map(String).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
    if (!dates.length) throw new Error('至少需要一個旅遊日期');
    return dates;
  }
  static links(value) {
    if (!Array.isArray(value)) return [];
    if (value.length > 10) throw new Error('一張慾望卡最多可設定 10 個連結');
    return value.map(item => ({url: Text.url(item && item.url), label: Text.optional(item && item.label, 60)})).filter(item => item.url);
  }
  static imageUrls(value) {
    const result = [...new Set((Array.isArray(value) ? value : []).map(url => Text.url(url)).filter(Boolean))];
    if (result.length > 10) throw new Error('一張慾望卡最多可放 10 張照片');
    return result;
  }
}

class Text {
  static required(value, message, max) { const text = String(value || '').trim(); if (!text) throw new Error(message); if (text.length > max) throw new Error('文字長度不可超過 ' + max + ' 字'); return text; }
  static optional(value, max) { const text = String(value || '').trim(); if (text.length > max) throw new Error('文字長度不可超過 ' + max + ' 字'); return text; }
  static url(value) { const text = String(value || '').trim(); if (text && !/^https?:\/\//i.test(text)) throw new Error('連結必須以 http:// 或 https:// 開頭'); return text; }
}

class Sort {
  static byPosition(a, b) { return Number(a.position) - Number(b.position); }
  static byDateTime(a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')); }
}

class ApiResponse {
  static ok(data) { return this.json({success: true, data}); }
  static error(message) { return this.json({success: false, error: message}); }
  static json(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
}
