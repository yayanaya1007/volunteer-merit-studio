(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const operationInput = $('operationFiles');
  const ledgerInput = $('ledgerFiles');
  const monthInput = $('cutoffMonth');
  const statusNode = $('status');
  const programResults = $('programResults');
  const resultSection = $('results');
  const savedWorksList = $('savedWorksList');
  const saveWorkNameInput = $('saveWorkName');
  const saveWorkButton = $('saveWorkButton');
  const NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  const TEMPLATE_URL = './templates/지도점검_사업별집행현황.hwpx';
  const WORK_DB_NAME = 'volunteer-budget-supervision';
  const WORK_STORE_NAME = 'saved-works';
  let operationFiles = [];
  let ledgerFiles = [];
  let reports = [];
  let pendingReportStates = null;
  let currentSavedWorkId = null;
  let generationToken = 0;

  const normalize = (value) => String(value ?? '').replace(/[\s\r\n]+/g, '').toLowerCase();
  const cleanText = (value) => String(value ?? '').replace(/\r/g, '').replace(/[\t ]+/g, ' ').trim();
  const money = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const s = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  const moneyText = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
  const moneyCell = (n) => Math.round(n || 0).toLocaleString('ko-KR');
  const expenseDateText = (date) => date ? `${date.getMonth() + 1}.${date.getDate()}` : '';
  const dateText = expenseDateText;
  const monthKey = (date) => date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : '';

  function normalizeSavedDetailNotes(notes) {
    return Object.fromEntries(Object.entries(notes || {}).map(([id, note]) => [
      id,
      String(note ?? '')
        .replace(/^(?:전문봉사단|가족봉사단)\s+/, '')
        .replace(/상환\s*[:：]?\s*[\d,]+\s*원?/g, '상환'),
    ]));
  }

  function professionalNoteFromText(text) {
    const value = normalize(text);
    if (!value) return '';
    const matches = [
      /날세움|칼갈이/.test(value) ? '날세움' : '',
      /손뜨개/.test(value) ? '손뜨개' : '',
      /귀건강|귀전문봉사단|이침/.test(value) ? '귀건강' : '',
    ].filter(Boolean);
    return matches.length === 1 ? matches[0] : '';
  }

  function familyNoteFromText(text) {
    const value = normalize(text);
    const matches = ['논사니', '월드프랜드', '달보드레', '뚜기']
      .filter((name) => value.includes(name));
    return matches.length === 1 ? matches[0] : '';
  }

  function detailNote(report, tx) {
    const savedNote = Object.prototype.hasOwnProperty.call(report.detailNotes || {}, tx.id)
      ? report.detailNotes[tx.id] : null;
    const inferNote = report.kind === 'professional' ? professionalNoteFromText
      : report.kind === 'family' ? familyNoteFromText : null;
    if (!inferNote) return savedNote || '';
    const matched = tx.matchedOperation;
    const directNote = inferNote(tx.repaymentGroup)
      || inferNote(matched?.group)
      || inferNote(matched?.activity)
      || inferNote(tx.memo);
    const note = savedNote ?? directNote;
    if (report.kind !== 'family' || !tx.repaymentRecorded || /상환/.test(note)) return note;
    return [note, '상환'].filter(Boolean).join(' / ');
  }

  function normalizeSavedDetailSuffixes(suffixes) {
    return Object.fromEntries(Object.entries(suffixes || {}).map(([id, suffix]) => [
      id,
      suffix === '재료 구매' || suffix === '활동재료 구매' ? '활동 재료 구매' : suffix === '재료비 지급' ? '활동재료비 지급' : suffix,
    ]));
  }

  function inferExpensePhrase(text) {
    const value = normalize(text);
    if (!value) return '';
    if (value.includes('배너')) return '배너 제작';
    if (value.includes('현수막')) return '현수막 제작';
    if (value.includes('재료비지급')) return '활동재료비 지급';
    if (value.includes('재료구매')) return '활동 재료 구매';
    if (value.includes('간식') || value.includes('오거리할인매장')) return '활동 간식 구매';
    if ([
      '숫돌', '뽁뽁이', '수세미실', '코바늘', '기통석', '에어캡', '사포', '아가한코엄마두코',
      '아성다이소', '동진종합철물건재', '철물', '웰빙엔라이프', '핀셋',
    ].some((keyword) => value.includes(normalize(keyword)))) return '활동 재료 구매';
    return '';
  }

  function automaticExpensePhrase(tx, itemLabel = '') {
    const itemPhrase = inferExpensePhrase(itemLabel);
    if (itemPhrase) return itemPhrase;
    const memoPhrase = inferExpensePhrase(tx.memo);
    if (memoPhrase) return memoPhrase;
    const operationItems = tx.matchedOperation?.items || [];
    const itemPhrases = [...new Set(operationItems.map((item) => inferExpensePhrase(item.label)).filter(Boolean))];
    if (itemPhrases.length === 1) return itemPhrases[0];
    const operationDetailPhrase = inferExpensePhrase(tx.matchedOperation?.detail);
    if (operationItems.length <= 1 && operationDetailPhrase) return operationDetailPhrase;
    return inferExpensePhrase(tx.merchant);
  }

  function removePurchaseSourceNames(text, merchant = '') {
    let value = String(text ?? '');
    const sourceNames = [...new Set([
      cleanText(merchant), '오거리할인매장', '아가한코엄마두코', '아성다이소', '동진종합철물건재', '웰빙엔라이프',
    ].filter(Boolean))];
    for (const name of sourceNames) {
      const pattern = name.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
      if (pattern) value = value.replace(new RegExp(pattern, 'gi'), ' ');
    }
    return cleanText(value)
      .replace(/(?:구매처|거래처|지출처)\s*[:：]?/g, ' ')
      .replace(/^[\s:：·,，-]+|[\s:：·,，-]+$/g, '')
      .replace(/\s{2,}/g, ' ');
  }

  function expensePhraseForProgram(program, phrase) {
    const value = cleanText(phrase || '');
    return normalize(program).includes('활동') ? value.replace(/활동\s*(?=재료)/g, '') : value;
  }

  function expensePhraseWithItemAction(phrase, itemAction) {
    const value = cleanText(phrase || '');
    if (!value) return cleanText(itemAction || '');
    return value.replace(/(?:구매|제작|지급)$/, cleanText(itemAction || ''));
  }

  function openWorkDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('이 브라우저는 작업 저장 기능을 지원하지 않습니다.'));
        return;
      }
      const request = window.indexedDB.open(WORK_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORK_STORE_NAME)) db.createObjectStore(WORK_STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('저장 공간을 열지 못했습니다.'));
    });
  }

  async function workDbRequest(mode, requestFactory) {
    const db = await openWorkDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(WORK_STORE_NAME, mode);
      let result;
      const request = requestFactory(transaction.objectStore(WORK_STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error || new Error('저장한 작업을 처리하지 못했습니다.'));
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error || new Error('저장한 작업을 처리하지 못했습니다.')); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error('저장 작업이 취소되었습니다.')); };
    });
  }

  async function refreshSavedWorks() {
    try {
      const savedWorks = await workDbRequest('readonly', (store) => store.getAll());
      renderSavedWorks(savedWorks || []);
    } catch (error) {
      savedWorksList.innerHTML = `<p class="saved-work-empty">${escapeHtml(error.message || '저장 목록을 읽지 못했습니다.')}</p>`;
    }
  }

  function renderSavedWorks(savedWorks) {
    if (!savedWorks.length) {
      savedWorksList.innerHTML = '<p class="saved-work-empty">저장된 작업이 없습니다.</p>';
      return;
    }
    const sorted = savedWorks.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    savedWorksList.innerHTML = sorted.map((work) => {
      const savedAt = new Date(work.savedAt);
      const savedLabel = Number.isNaN(savedAt.getTime()) ? '' : savedAt.toLocaleString('ko-KR');
      const files = [...(work.operationFiles || []), ...(work.ledgerFiles || [])].map((file) => file.name).join(' · ');
      return `<article class="saved-work-item"><div class="saved-work-info"><strong>${escapeHtml(work.name)}</strong><small>${escapeHtml(savedLabel)}${files ? ` · ${escapeHtml(files)}` : ''}</small></div><div class="saved-work-actions"><button class="button button-dark" type="button" data-load-work="${escapeHtml(work.id)}">불러오기</button><button class="button button-light" type="button" data-delete-work="${escapeHtml(work.id)}">삭제</button></div></article>`;
    }).join('');
    savedWorksList.querySelectorAll('[data-load-work]').forEach((button) => button.addEventListener('click', () => loadSavedWork(button.dataset.loadWork)));
    savedWorksList.querySelectorAll('[data-delete-work]').forEach((button) => button.addEventListener('click', () => deleteSavedWork(button.dataset.deleteWork)));
  }

  async function saveCurrentWork() {
    if (!reports.length || !operationFiles.length || !ledgerFiles.length) return;
    saveWorkButton.disabled = true;
    try {
      const cutoff = monthInput.value || '2026-09';
      const defaultName = `${cutoff.slice(0, 4)}년 ${Number(cutoff.slice(5, 7))}월 지도점검`;
      const work = {
        id: currentSavedWorkId || (window.crypto?.randomUUID ? window.crypto.randomUUID() : `work-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        name: cleanText(saveWorkNameInput.value) || defaultName,
        savedAt: new Date().toISOString(),
        cutoff,
        operationFiles: await Promise.all(operationFiles.map(async (file) => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file.slice(0, file.size, file.type) }))),
        ledgerFiles: await Promise.all(ledgerFiles.map(async (file) => ({ name: file.name, type: file.type, lastModified: file.lastModified, blob: file.slice(0, file.size, file.type) }))),
        reportStates: reports.map((report) => ({
          kind: report.kind,
          detailSuffixes: report.detailSuffixes || {},
          detailItemActions: report.detailItemActions || {},
          detailDescriptions: report.detailDescriptions || {},
          detailMerchants: report.detailMerchants || {},
          detailNotes: report.detailNotes || {},
          checkedDetailIds: report.checkedDetailIds || [],
          noteKind: report.noteKind || '',
          noteSubgroup: report.noteSubgroup || '',
        })),
      };
      await workDbRequest('readwrite', (store) => store.put(work));
      currentSavedWorkId = work.id;
      saveWorkNameInput.value = work.name;
      await refreshSavedWorks();
      setStatus(`‘${work.name}’ 작업과 원본 파일을 이 브라우저에 저장했습니다.`, 'busy');
    } catch (error) {
      setStatus(error.message || '작업을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.', 'error');
    } finally {
      saveWorkButton.disabled = false;
    }
  }

  async function loadSavedWork(id) {
    try {
      const work = await workDbRequest('readonly', (store) => store.get(id));
      if (!work) throw new Error('저장한 작업을 찾지 못했습니다.');
      generationToken += 1;
      currentSavedWorkId = work.id;
      operationInput.value = '';
      ledgerInput.value = '';
      monthInput.value = work.cutoff || '2026-09';
      operationFiles = (work.operationFiles || []).map((file) => new File([file.blob], file.name, { type: file.type || '', lastModified: file.lastModified || Date.now() }));
      ledgerFiles = (work.ledgerFiles || []).map((file) => new File([file.blob], file.name, { type: file.type || '', lastModified: file.lastModified || Date.now() }));
      renderFileNames(operationFiles, $('operationNames'), '.xls 또는 .xlsx 여러 개 선택', true);
      renderFileNames(ledgerFiles, $('ledgerNames'), '.xls 또는 .xlsx 여러 개 선택', true);
      saveWorkNameInput.value = work.name || '';
      pendingReportStates = work.reportStates || [];
      await analyze();
      if (!reports.length) throw new Error('저장한 엑셀 파일에서 대조 결과를 만들지 못했습니다. 파일 내용을 확인해 주세요.');
      setStatus(`‘${work.name}’ 작업을 불러왔습니다.`, 'busy');
      resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      pendingReportStates = null;
      setStatus(error.message || '저장한 작업을 불러오지 못했습니다.', 'error');
    }
  }

  async function deleteSavedWork(id) {
    if (!window.confirm('이 저장 작업과 포함된 엑셀 파일을 이 브라우저에서 삭제할까요?')) return;
    try {
      await workDbRequest('readwrite', (store) => store.delete(id));
      if (currentSavedWorkId === id) currentSavedWorkId = null;
      await refreshSavedWorks();
      setStatus('저장한 작업을 삭제했습니다.', 'busy');
    } catch (error) {
      setStatus(error.message || '저장한 작업을 삭제하지 못했습니다.', 'error');
    }
  }

  function parseDate(value, defaultYear) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const p = XLSX.SSF.parse_date_code(value);
      if (p?.y && p?.m && p?.d) return new Date(p.y, p.m - 1, p.d);
    }
    const s = cleanText(value);
    if (!s) return null;
    let m = s.match(/(20\d{2}|\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
    if (m) {
      let year = Number(m[1]);
      if (year < 100) year += year < 70 ? 2000 : 1900;
      return validDate(year, Number(m[2]), Number(m[3]));
    }
    m = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
    if (m) return validDate(defaultYear, Number(m[1]), Number(m[2]));
    m = s.match(/(?:^|[^\d])(\d{1,2})[.\-/](\d{1,2})(?:\s*일?)?(?:[.(]|$|\s)/);
    if (m) return validDate(defaultYear, Number(m[1]), Number(m[2]));
    return null;
  }

  function validDate(year, month, day) {
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d : null;
  }

  function cellValue(cell) {
    if (!cell) return '';
    if (cell.t === 'd' || cell.v instanceof Date) return cell.v;
    return cell.w ?? cell.v ?? '';
  }

  function rowsFromSheet(sheet) {
    const ref = sheet['!ref'];
    if (!ref) return [];
    const range = XLSX.utils.decode_range(ref);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) row[c] = cellValue(sheet[XLSX.utils.encode_cell({ r, c })]);
      rows[r] = row;
    }
    return rows;
  }

  function kindFromText(text) {
    const s = String(text ?? '');
    if (/가족\s*봉사단/.test(s)) return 'family';
    if (/전문\s*봉사단/.test(s)) return 'professional';
    return '';
  }

  function kindLabel(kind) {
    return kind === 'family' ? '가족봉사단' : kind === 'professional' ? '전문봉사단' : '사업';
  }

  function detectYear(rows, fileName, defaultYear) {
    const sample = `${fileName} ${rows.slice(0, 12).flat().join(' ')}`;
    const m = sample.match(/20\d{2}/);
    return m ? Number(m[0]) : defaultYear;
  }

  async function readBook(file) {
    const data = await file.arrayBuffer();
    return XLSX.read(data, { type: 'array', cellDates: true, raw: false });
  }

  function findOperationSheet(book, fileName, defaultYear) {
    const candidates = [];
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      const rows = rowsFromSheet(sheet);
      let headerRow = -1;
      let headers = [];
      for (let i = 0; i < Math.min(rows.length, 18); i += 1) {
        const joined = (rows[i] || []).map(normalize).join('|');
        if (/운영비/.test(joined) && /(일자|일시|날짜|활동)/.test(joined)) {
          headerRow = i;
          headers = rows[i] || [];
          break;
        }
      }
      if (headerRow < 0) continue;
      const h = headers.map(normalize);
      const col = (patterns) => h.findIndex((value) => patterns.some((pattern) => pattern.test(value)));
      // "활동일수" is a count column, not the activity date. Match actual date labels only.
      const dateCol = col([/일시/, /일자/, /날짜/]);
      const amountCol = col([/운영비/]);
      if (dateCol < 0 || amountCol < 0) continue;
      // The payment-method heading can be on a neighboring header row in merged tables.
      const methodCol = findLabeledColumn(rows, headerRow, [/지출방법/, /결제방법/, /결제수단/]);
      const titleCol = col([/프로그램명/, /프로그램/]);
      const groupCol = col([/가족봉사단명/, /참여단체/, /봉사단명/, /단체명/]);
      const placeCol = col([/장소/]);
      const possibleDetails = h.map((value, index) => ({ value, index }))
        .filter(({ value, index }) => index !== amountCol && index !== dateCol && /(비고|잔액|내역|지출내용|세부)/.test(value));
      let detailCol = -1;
      let detailScore = -1;
      for (const item of possibleDetails) {
        let score = 0;
        for (const row of rows.slice(headerRow + 1, headerRow + 80)) {
          if (/[：:]\s*[\d,]+/.test(String(row?.[item.index] ?? ''))) score += 1;
        }
        if (score > detailScore) { detailScore = score; detailCol = item.index; }
      }
      const year = detectYear(rows, fileName, defaultYear);
      const title = rows.slice(0, Math.min(headerRow + 1, 8)).flat().map(cleanText).join(' ');
      const kind = kindFromText(`${fileName} ${name} ${title}`);
      let dataCount = 0;
      for (const row of rows.slice(headerRow + 1)) {
        if (parseDate(row?.[dateCol], year) && (money(row?.[amountCol]) || parseItems(row?.[detailCol]).length)) dataCount += 1;
      }
      const score = (methodCol >= 0 ? 30 : 0) + (kind ? 15 : 0) + (/2026/.test(`${name} ${title}`) ? 12 : 0) + dataCount;
      candidates.push({ sheet, name, rows, headerRow, headers, dateCol, amountCol, methodCol, titleCol, groupCol, placeCol, detailCol, year, kind, title, score, dataCount });
    }
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function parseItems(text) {
    const items = [];
    for (const line of String(text ?? '').split(/\n|\r/)) {
      const s = cleanText(line);
      if (!s) continue;
      let m = s.match(/^(.+?)\s*[:：]\s*([\d,]+)\s*(?:원)?$/);
      if (!m) m = s.match(/^([가-힣A-Za-z0-9()· _-]+?)\s+([\d,]+)\s*(?:원)?$/);
      if (m) {
        const amount = money(m[2]);
        if (amount > 0) items.push({ label: cleanText(m[1]).replace(/[:：]$/, ''), amount });
      }
    }
    return items;
  }

  function findLabeledColumn(rows, headerRow, patterns) {
    const nearby = [];
    for (let r = Math.max(0, headerRow - 2); r < Math.min(rows.length, headerRow + 3); r += 1) nearby.push(r);
    for (let r = 0; r < rows.length; r += 1) if (!nearby.includes(r)) nearby.push(r);
    for (const r of nearby) {
      const row = rows[r] || [];
      const index = row.findIndex((value) => patterns.some((pattern) => pattern.test(normalize(value))));
      if (index >= 0) return index;
    }
    return -1;
  }

  function parseOperation(candidate, file) {
    const { rows, headerRow, dateCol, amountCol, methodCol, titleCol, groupCol, placeCol, detailCol, year, kind } = candidate;
    const entries = [];
    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const date = parseDate(row[dateCol], year);
      if (!date) continue;
      const detail = detailCol >= 0 ? cleanText(row[detailCol]) : '';
      const items = parseItems(detail);
      const declared = money(row[amountCol]);
      const amount = declared || items.reduce((sum, item) => sum + item.amount, 0);
      if (amount <= 0) continue;
      const method = methodCol >= 0 ? cleanText(row[methodCol]) : '';
      const activity = titleCol >= 0 ? cleanText(row[titleCol]) : '';
      const group = groupCol >= 0 ? cleanText(row[groupCol]) : '';
      const place = placeCol >= 0 ? cleanText(row[placeCol]) : '';
      const remarks = row.map(cleanText).join(' ');
      entries.push({
        id: `op-${r + 1}`,
        rowNumber: r + 1,
        date,
        amount,
        declaredAmount: declared,
        detailsAmount: items.reduce((sum, item) => sum + item.amount, 0),
        items,
        detail,
        method: normalizeMethod(method) || (hasCardHint(candidate.title) ? '카드결제' : ''),
        activity,
        group,
        place,
        remarks,
        repaymentRecorded: kind === 'family' && /상환/.test(remarks),
        kind,
        sourceFile: file.name,
      });
    }
    const summaryValues = rows.slice(0, Math.min(headerRow + 3, rows.length))
      .filter((row) => !parseDate(row?.[dateCol], year)).flat()
      .filter((value) => typeof value === 'number' || /^\s*[\d,]+\s*(?:원)?\s*$/.test(String(value ?? '')))
      .map(money).filter((n) => n > 1000);
    const explicitBudget = rows.slice(0, 12).flat().map((v) => {
      const m = String(v ?? '').match(/(?:배정액|예산액)\s*[:：]?\s*([\d,]+)/);
      return m ? money(m[1]) : 0;
    }).find((n) => n > 0) || 0;
    const operatingBudget = explicitBudget || Math.max(0, ...summaryValues);
    return {
      kind,
      label: kindLabel(kind),
      sourceFile: file.name,
      sheetName: candidate.name,
      title: candidate.title,
      year,
      entries,
      budget: operatingBudget,
      hasMethodColumn: methodCol >= 0,
      methodCoverage: entries.filter((entry) => entry.method).length,
    };
  }

  function hasCardHint(text) {
    return /카드\s*결제|카드결제|하나카드|체크카드/.test(String(text ?? ''));
  }

  function normalizeMethod(value) {
    const s = cleanText(value);
    if (!s) return '';
    if (/카드/.test(s)) return s.includes('카드결제') ? s : `${s.replace(/\s+/g, '')}결제`;
    if (/계좌\s*이체|이체|송금/.test(s)) return '계좌이체';
    if (/현금/.test(s)) return '현금';
    return s;
  }

  function findLedgerSheet(book, fileName, defaultYear) {
    const candidates = [];
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      const rows = rowsFromSheet(sheet);
      for (let r = 0; r < Math.min(rows.length, 20); r += 1) {
        const h = (rows[r] || []).map(normalize);
        const dateCol = h.findIndex((x) => /날짜|일자|거래일/.test(x));
        const amountCol = h.findIndex((x) => /집행액|지출액|사용액/.test(x));
        if (dateCol < 0 || amountCol < 0) continue;
        const memoCol = h.findIndex((x) => /적요|지출내용|내용/.test(x));
        const vendorCol = h.findIndex((x) => /거래처|지출처|사용처/.test(x));
        const groupCol = h.findIndex((x) => /봉사단명|단체명/.test(x));
        const budgetCol = h.findIndex((x) => /예산액|예산/.test(x));
        const methodCol = h.findIndex((x) => /지출방법|결제방법|결제수단/.test(x));
        const kind = kindFromText(`${fileName} ${name} ${(rows[0] || []).join(' ')}`);
        const year = detectYear(rows, fileName, defaultYear);
        const occupied = new Set([dateCol, amountCol, memoCol, vendorCol, groupCol, budgetCol, methodCol]);
        let activityRefCol = -1;
        let activityRefCount = 0;
        const width = Math.min(20, Math.max(...rows.slice(0, 30).map((row) => row?.length || 0), 0));
        for (let c = 0; c < width; c += 1) {
          if (occupied.has(c)) continue;
          const count = rows.slice(r + 1).filter((row) => parseDate(row?.[c], year)).length;
          if (count > activityRefCount) { activityRefCount = count; activityRefCol = c; }
        }
        if (activityRefCount < 3) activityRefCol = -1;
        let count = 0;
        for (const row of rows.slice(r + 1)) if (parseDate(row?.[dateCol], year) && money(row?.[amountCol]) > 0) count += 1;
        candidates.push({ sheet, name, rows, headerRow: r, dateCol, amountCol, memoCol, vendorCol, groupCol, budgetCol, methodCol, activityRefCol, kind, year, score: count + (kind ? 15 : 0) });
        break;
      }
    }
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function parseLedger(candidate, file) {
    const { rows, headerRow, dateCol, amountCol, memoCol, vendorCol, groupCol, budgetCol, methodCol, activityRefCol, year, kind } = candidate;
    const transactions = [];
    const monthlyControl = {};
    let lastMonth = null;
    let budget = 0;
    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const memo = memoCol >= 0 ? cleanText(row[memoCol]) : '';
      const date = parseDate(row[dateCol], year);
      const amount = money(row[amountCol]);
      const budgetCell = budgetCol >= 0 ? money(row[budgetCol]) : 0;
      if (date) lastMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (budgetCell > 0 && /배정|교부|예산/.test(memo)) budget += budgetCell;
      if (/\[?월\s*계\]?/.test(memo) && lastMonth) monthlyControl[lastMonth] = amount;
      if (!date || amount <= 0 || /월\s*계|누\s*계|배정예산/.test(memo)) continue;
      const merchant = vendorCol >= 0 ? cleanText(row[vendorCol]) : '';
      const group = groupCol >= 0 ? cleanText(row[groupCol]) : '';
      const method = methodCol >= 0 ? normalizeMethod(row[methodCol]) : '';
      transactions.push({
        id: `tx-${r + 1}`,
        rowNumber: r + 1,
        date,
        amount,
        memo,
        merchant,
        group,
        method,
        activityRefDate: activityRefCol >= 0 ? parseDate(row[activityRefCol], year) : null,
        sourceFile: file.name,
        matchedOperation: null,
        amountMatchedOperation: null,
      });
    }
    const batches = new Map();
    for (const tx of transactions) {
      const key = `${monthKey(tx.date)}-${tx.date.getDate()}|${normalize(tx.memo)}`;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(tx);
    }
    for (const batch of batches.values()) {
      const references = [...new Set(batch.map((tx) => tx.activityRefDate?.getTime()).filter(Boolean))];
      if (references.length === 1) {
        for (const tx of batch) if (!tx.activityRefDate) tx.activityRefDate = new Date(references[0]);
      }
    }
    return { kind, year, sourceFile: file.name, sheetName: candidate.name, transactions, monthlyControl, budget };
  }

  function merchantMatchesItem(item, tx) {
    const itemName = normalize(item.label);
    const merchant = normalize(tx.merchant);
    return Boolean(itemName && merchant && (itemName.includes(merchant) || merchant.includes(itemName)));
  }

  function subsetForReferencedActivity(candidates, target, operation) {
    let best = null;
    let bestScore = -1;
    let tied = false;
    function search(start, sum, chosen, score) {
      if (sum === target) {
        if (score > bestScore) { best = chosen.slice(); bestScore = score; tied = false; }
        else if (score === bestScore) tied = true;
        return;
      }
      if (sum > target || chosen.length >= 8) return;
      for (let i = start; i < candidates.length; i += 1) {
        const tx = candidates[i];
        if (sum + tx.amount > target) continue;
        chosen.push(tx);
        search(i + 1, sum + tx.amount, chosen,
          score + (operation.items.some((item) => merchantMatchesItem(item, tx)) ? 2 : 0)
            + (tx.group && normalize(operation.group).includes(normalize(tx.group)) ? 1 : 0));
        chosen.pop();
      }
    }
    search(0, 0, [], 0);
    return tied ? null : best;
  }

  function matchingTransactions(operation, transactions) {
    const available = transactions.filter((tx) => !tx.amountMatchedOperation);
    if (!available.length || operation.amount <= 0) return null;
    const activityReference = available.filter((tx) => tx.activityRefDate?.getTime() === operation.date.getTime());
    if (activityReference.length) {
      const referenced = subsetForReferencedActivity(activityReference, operation.amount, operation);
      if (referenced) return { transactions: referenced, confident: true };
    }
    const possible = available.filter((tx) => !tx.activityRefDate || tx.activityRefDate.getTime() === operation.date.getTime());
    const items = operation.items || [];
    if (items.length && items.reduce((sum, item) => sum + item.amount, 0) === operation.amount) {
      const chosen = [];
      const orderedItems = items.slice().sort((a, b) =>
        possible.filter((tx) => tx.amount === a.amount).length - possible.filter((tx) => tx.amount === b.amount).length);
      for (const item of orderedItems) {
        const byAmount = possible.filter((tx) => tx.amount === item.amount && !chosen.includes(tx));
        const byMerchant = byAmount.filter((tx) => merchantMatchesItem(item, tx));
        const byGroup = byAmount.filter((tx) => tx.group && normalize(operation.group).includes(normalize(tx.group)));
        let candidate = byMerchant.length === 1 ? byMerchant[0]
          : byGroup.length === 1 ? byGroup[0] : byAmount.length === 1 ? byAmount[0] : null;
        if (!candidate && chosen.length && byAmount.length) {
          const ranked = byAmount.map((tx) => ({ tx, distance: Math.min(...chosen.map((prior) => Math.abs(tx.date - prior.date))) }))
            .sort((a, b) => a.distance - b.distance);
          if (ranked.length === 1 || ranked[0].distance < ranked[1].distance) candidate = ranked[0].tx;
        }
        if (!candidate) { chosen.length = 0; break; }
        chosen.push(candidate);
      }
      if (chosen.length === items.length) return { transactions: chosen, confident: true };
    }
    const byTotal = possible.filter((tx) => tx.amount === operation.amount);
    const byMerchant = byTotal.filter((tx) => items.some((item) => merchantMatchesItem(item, tx)));
    if (byMerchant.length === 1) return { transactions: byMerchant, confident: true };
    if (!byTotal.length) return null;
    const sameAmountCount = transactions.filter((tx) => tx.amount === operation.amount
      && (!tx.activityRefDate || tx.activityRefDate.getTime() === operation.date.getTime())).length;
    return { transactions: [byTotal[0]], confident: sameAmountCount === 1 };
  }

  function matchBooks(operation, ledger, cutoff) {
    const allTransactions = ledger.transactions.slice().sort((a, b) => a.date - b.date || a.rowNumber - b.rowNumber);
    const cutoffDate = new Date(cutoff.year, cutoff.month, 0, 23, 59, 59, 999);
    const periodTransactions = allTransactions.filter((tx) => tx.date.getFullYear() === cutoff.year && tx.date <= cutoffDate);
    const operations = operation.entries.filter((entry) => entry.date.getFullYear() === cutoff.year && !(/외상/.test(entry.remarks) && !entry.declaredAmount));
    for (const op of operations.slice().sort((a, b) => b.items.length - a.items.length || a.rowNumber - b.rowNumber)) {
      const found = matchingTransactions(op, periodTransactions);
      if (found) for (const tx of found.transactions) {
        tx.amountMatchedOperation = op;
        if (found.confident) tx.matchedOperation = op;
      }
    }
    if (operation.kind === 'family') {
      for (const op of operations.filter((entry) => entry.repaymentRecorded && entry.date <= cutoffDate)) {
        const related = periodTransactions.filter((tx) => tx.matchedOperation === op);
        if (related.length) {
          for (const tx of related) {
            tx.repaymentGroup = op.group;
          }
          const first = related.slice().sort((a, b) => a.date - b.date || a.rowNumber - b.rowNumber)[0];
          first.repaymentRecorded = true;
        }
      }
    }
    const txs = periodTransactions;
    const opThroughPeriod = [...new Set(txs.map((tx) => tx.amountMatchedOperation).filter(Boolean))];
    const matchedOperations = new Set(opThroughPeriod);
    const unlinkedOperations = operations.filter((op) => op.date <= cutoffDate && op.declaredAmount > 0 && !matchedOperations.has(op));
    const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
    const operationAmounts = txs.filter((tx) => tx.amountMatchedOperation).reduce((sum, tx) => sum + tx.amount, 0);
    const months = {};
    for (let m = 1; m <= cutoff.month; m += 1) {
      const key = `${cutoff.year}-${String(m).padStart(2, '0')}`;
      const monthTx = txs.filter((tx) => `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}` === key);
      const amount = monthTx.reduce((sum, tx) => sum + tx.amount, 0);
      const operationAmount = monthTx.filter((tx) => tx.amountMatchedOperation).reduce((sum, tx) => sum + tx.amount, 0);
      months[key] = { amount, operationAmount, difference: amount - operationAmount, control: ledger.monthlyControl[key] ?? null };
    }
    const details = txs.map((tx) => {
      const key = monthKey(tx.date);
      return {
        ...tx,
        method: tx.method || tx.matchedOperation?.method || '',
        monthKey: key,
      };
    });
    const monthMismatches = Object.entries(months).filter(([, value]) => value.difference !== 0);
    const monthlyDeviation = monthMismatches.reduce((sum, [, value]) => sum + Math.abs(value.difference), 0);
    return { transactions: txs, details, total, opThroughPeriod, unlinkedOperations, operationAmounts, months, monthMismatches, monthlyDeviation, cutoffDate, budget: ledger.budget };
  }

  function itemizedLedgerItems(result) {
    const matchedByOperation = new Map();
    for (const tx of result.details) {
      const operation = tx.matchedOperation;
      if (!operation) continue;
      if (!matchedByOperation.has(operation.id)) matchedByOperation.set(operation.id, { operation, transactions: [] });
      matchedByOperation.get(operation.id).transactions.push(tx);
    }
    const itemsByTransaction = new Map();
    for (const { operation, transactions } of matchedByOperation.values()) {
      const items = (operation.items || []).map((item, itemIndex) => ({ ...item, itemIndex }));
      const itemTotal = items.reduce((sum, item) => sum + item.amount, 0);
      if (items.length < 2 || itemTotal !== operation.amount) continue;
      if (transactions.length === 1 && transactions[0].amount === itemTotal) {
        itemsByTransaction.set(transactions[0].id, items);
        continue;
      }
      if (transactions.length === items.length) {
        const remaining = items.slice();
        const matches = [];
        for (const tx of transactions) {
          const index = remaining.findIndex((item) => item.amount === tx.amount);
          if (index < 0) break;
          matches.push([tx.id, remaining.splice(index, 1)[0]]);
        }
        if (matches.length === transactions.length && remaining.length === 0) {
          matches.forEach(([id, item]) => itemsByTransaction.set(id, [item]));
          continue;
        }
      }
      if (items.length > 20 || transactions.length > items.length) continue;
      const orderedTransactions = transactions.slice().sort((a, b) => b.amount - a.amount || a.rowNumber - b.rowNumber);
      const assignments = new Map();
      const visited = new Set();
      const assignItems = (transactionIndex, remaining) => {
        if (transactionIndex === orderedTransactions.length) return remaining.length === 0;
        const key = `${transactionIndex}:${remaining.map((item) => item.itemIndex).join(',')}`;
        if (visited.has(key)) return false;
        const tx = orderedTransactions[transactionIndex];
        const picked = [];
        const chooseSubset = (start, total) => {
          if (total === tx.amount) {
            const pickedIndexes = new Set(picked.map((item) => item.itemIndex));
            assignments.set(tx.id, picked.slice().sort((a, b) => a.itemIndex - b.itemIndex));
            const rest = remaining.filter((item) => !pickedIndexes.has(item.itemIndex));
            if (assignItems(transactionIndex + 1, rest)) return true;
            assignments.delete(tx.id);
            return false;
          }
          if (total > tx.amount) return false;
          for (let index = start; index < remaining.length; index += 1) {
            picked.push(remaining[index]);
            if (chooseSubset(index + 1, total + remaining[index].amount)) return true;
            picked.pop();
          }
          return false;
        };
        if (chooseSubset(0, 0)) return true;
        visited.add(key);
        return false;
      };
      if (assignItems(0, items)) {
        for (const [id, assignedItems] of assignments) itemsByTransaction.set(id, assignedItems);
      }
    }
    return itemsByTransaction;
  }

  function determineKind(op, ledger, opFile, ledgerFile) {
    return op.kind || ledger.kind || kindFromText(`${opFile.name} ${ledgerFile.name}`) || 'other';
  }

  function cutoffValue() {
    const [yearRaw, monthRaw] = (monthInput.value || '2026-09').split('-');
    const year = Number(yearRaw) || 2026;
    const month = Number(monthRaw) || 9;
    return { year, month };
  }

  function makePairs(opParsed, ledgerParsed, opFiles, ledFiles) {
    const pairs = [];
    const usedLedgers = new Set();
    for (const op of opParsed) {
      let index = ledgerParsed.findIndex((item, i) => !usedLedgers.has(i) && item.kind && item.kind === op.kind);
      if (index < 0) index = ledgerParsed.findIndex((_, i) => !usedLedgers.has(i));
      if (index < 0) continue;
      usedLedgers.add(index);
      const ledger = ledgerParsed[index];
      const operationFile = opFiles.find((f) => f.name === op.sourceFile);
      const ledgerFile = ledFiles.find((f) => f.name === ledger.sourceFile);
      pairs.push({ op, ledger, operationFile, ledgerFile, kind: determineKind(op, ledger, operationFile || { name: '' }, ledgerFile || { name: '' }) });
    }
    return pairs;
  }

  async function analyze() {
    const token = ++generationToken;
    const cutoff = cutoffValue();
    resultSection.hidden = true;
    if (!operationFiles.length || !ledgerFiles.length) {
      setStatus('운영현황 엑셀과 집행장부를 모두 선택하면 자동 분석합니다.');
      return;
    }
    setStatus('엑셀 시트를 찾아 운영현황 항목과 집행장부 거래를 연결하고 있습니다…', 'busy');
    try {
      const [opBooks, ledgerBooks] = await Promise.all([
        Promise.all(operationFiles.map(readBook)),
        Promise.all(ledgerFiles.map(readBook)),
      ]);
      if (token !== generationToken) return;
      const opParsed = [];
      for (let i = 0; i < opBooks.length; i += 1) {
        const candidate = findOperationSheet(opBooks[i], operationFiles[i].name, cutoff.year);
        if (candidate) opParsed.push(parseOperation(candidate, operationFiles[i]));
      }
      const ledgerParsed = [];
      for (let i = 0; i < ledgerBooks.length; i += 1) {
        const candidate = findLedgerSheet(ledgerBooks[i], ledgerFiles[i].name, cutoff.year);
        if (candidate) ledgerParsed.push(parseLedger(candidate, ledgerFiles[i]));
      }
      const pairs = makePairs(opParsed, ledgerParsed, operationFiles, ledgerFiles);
      if (!pairs.length) throw new Error('운영비와 집행액이 있는 표를 찾지 못했습니다. 파일 형식과 표 머리글을 확인해 주세요.');
      reports = pairs.map((pair, index) => {
        const kind = pair.kind;
        const savedState = pendingReportStates?.find((state) => state.kind === kind) || pendingReportStates?.[index];
        const result = matchBooks(pair.op, pair.ledger, cutoff);
        const budgetMismatch = pair.op.budget > 0 && result.budget > 0 && pair.op.budget !== result.budget;
        const detailMismatch = result.opThroughPeriod.filter((op) => op.detailsAmount > 0 && op.declaredAmount > 0 && op.detailsAmount !== op.declaredAmount);
        const controlMismatch = Object.entries(result.months).filter(([key, month]) => month.control != null && month.control !== month.amount).map(([key, month]) => ({ key, ...month }));
        return {
          ...pair,
          kind,
          result,
          budgetMismatch,
          detailMismatch,
          controlMismatch,
          cutoff,
          detailSuffixes: normalizeSavedDetailSuffixes(savedState?.detailSuffixes),
          detailItemActions: savedState?.detailItemActions || {},
          detailDescriptions: savedState?.detailDescriptions || {},
          detailMerchants: savedState?.detailMerchants || {},
          detailNotes: normalizeSavedDetailNotes(savedState?.detailNotes),
          checkedDetailIds: savedState?.checkedDetailIds || [],
          noteKind: savedState?.noteKind || '',
          noteSubgroup: savedState?.noteSubgroup || '',
        };
      });
      pendingReportStates = null;
      if (token !== generationToken) return;
      $('resultTitle').textContent = `${cutoff.year}년 ${cutoff.month}월 말까지`;
      if (!saveWorkNameInput.value.trim()) saveWorkNameInput.value = `${cutoff.year}년 ${cutoff.month}월 지도점검`;
      renderReports();
      resultSection.hidden = false;
      setStatus(`${reports.length}개 사업을 분석했습니다. 운영현황 활동일은 구매일로 쓰지 않고, 집행 날짜는 집행장부 기준으로 사용합니다.`, 'busy');
    } catch (error) {
      if (token !== generationToken) return;
      pendingReportStates = null;
      reports = [];
      resultSection.hidden = true;
      setStatus(error.message || '파일을 읽지 못했습니다.', 'error');
    }
  }

  function setStatus(text, state = '') {
    statusNode.textContent = text;
    statusNode.className = `status${state ? ` ${state}` : ''}`;
  }

  function renderFileNames(inputFiles, node, emptyLabel, savedCopy = false) {
    node.textContent = inputFiles.length ? inputFiles.map((file) => {
      const modified = Number.isFinite(file.lastModified) && file.lastModified > 0
        ? new Date(file.lastModified).toLocaleString('ko-KR')
        : '시각 미확인';
      return `${file.name} (${savedCopy ? '저장본 · ' : ''}수정 ${modified} · ${file.size.toLocaleString('ko-KR')}바이트)`;
    }).join(' · ') : emptyLabel;
  }

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function renderReports() {
    programResults.innerHTML = reports.map((report, index) => renderProgram(report, index)).join('');
    programResults.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadReport(Number(button.dataset.download))));
    programResults.querySelectorAll('[data-description-suffix]').forEach((select) => select.addEventListener('change', () => {
      const report = reports[Number(select.dataset.descriptionSuffix)];
      if (!report) return;
      const card = select.closest('.program-card');
      const selectedIds = Array.from(card.querySelectorAll('[data-detail-check]:checked')).map((input) => input.dataset.detailCheck);
      if (!selectedIds.length) {
        select.value = '';
        setStatus('문구를 적용할 지출내역 앞에 먼저 체크해 주세요.', 'error');
        return;
      }
      report.detailSuffixes ||= {};
      report.detailDescriptions ||= {};
      report.checkedDetailIds = selectedIds;
      selectedIds.forEach((id) => {
        if (select.value === '__ledger__') {
          delete report.detailSuffixes[id];
          delete report.detailItemActions?.[id];
          Object.keys(report.detailItemActions || {}).filter((key) => key.startsWith(`${id}::`)).forEach((key) => delete report.detailItemActions[key]);
        } else {
          report.detailSuffixes[id] = select.value;
        }
        delete report.detailDescriptions[id];
        Object.keys(report.detailDescriptions).filter((key) => key.startsWith(`${id}::`)).forEach((key) => delete report.detailDescriptions[key]);
      });
      setStatus(select.value === '__ledger__'
        ? `체크한 지출내역 ${selectedIds.length}건을 집행장부 적요로 되돌렸습니다.`
        : `체크한 지출내역 ${selectedIds.length}건에 ‘${select.value}’ 문구를 적용했습니다.`, 'busy');
      renderReports();
      programResults.querySelector(`[data-description-suffix="${select.dataset.descriptionSuffix}"]`)?.focus();
    }));
    programResults.querySelectorAll('[data-item-action]').forEach((select) => select.addEventListener('change', () => {
      const report = reports[Number(select.dataset.reportIndex)];
      if (!report) return;
      report.detailItemActions ||= {};
      report.detailItemActions[select.dataset.itemAction] = select.value;
      delete report.detailDescriptions?.[select.dataset.itemAction];
      renderReports();
    }));
    programResults.querySelectorAll('[data-detail-description]').forEach((input) => {
      input.addEventListener('input', () => {
        const report = reports[Number(input.dataset.reportIndex)];
        if (!report) return;
        report.detailDescriptions ||= {};
        report.detailDescriptions[input.dataset.detailDescription] = input.value;
      });
      input.addEventListener('change', () => setStatus('수정한 지출내용·지출처를 반영했습니다. 작업을 저장하면 수정 내용도 보관됩니다.', 'busy'));
    });
    programResults.querySelectorAll('[data-detail-merchant]').forEach((input) => {
      input.addEventListener('input', () => {
        const report = reports[Number(input.dataset.reportIndex)];
        if (!report) return;
        report.detailMerchants ||= {};
        report.detailMerchants[input.dataset.detailMerchant] = input.value;
      });
      input.addEventListener('change', () => setStatus('수정한 지출처를 반영했습니다. 작업을 저장하면 수정 내용도 보관됩니다.', 'busy'));
    });
    programResults.querySelectorAll('[data-note-kind]').forEach((select) => select.addEventListener('change', () => {
      const report = reports[Number(select.dataset.noteKind)];
      if (!report) return;
      report.noteKind = select.value;
      report.noteSubgroup = '';
      renderReports();
      programResults.querySelector(`[data-note-subgroup="${select.dataset.noteKind}"]`)?.focus();
    }));
    programResults.querySelectorAll('[data-note-subgroup]').forEach((select) => select.addEventListener('change', () => {
      const report = reports[Number(select.dataset.noteSubgroup)];
      if (!report) return;
      report.noteSubgroup = select.value;
      renderReports();
      programResults.querySelector(`[data-note-subgroup="${select.dataset.noteSubgroup}"]`)?.focus();
    }));
    programResults.querySelectorAll('[data-apply-note]').forEach((button) => button.addEventListener('click', () => {
      const report = reports[Number(button.dataset.applyNote)];
      if (!report) return;
      const card = button.closest('.program-card');
      const selectedIds = Array.from(card.querySelectorAll('[data-detail-check]:checked')).map((input) => input.dataset.detailCheck);
      if (!selectedIds.length || !report.noteKind || !report.noteSubgroup) return;
      const note = report.noteSubgroup;
      report.detailNotes ||= {};
      selectedIds.forEach((id) => { report.detailNotes[id] = note; });
      setStatus(`체크한 지출내역 ${selectedIds.length}건의 비고에 ‘${note}’를 적용했습니다.`, 'busy');
      renderReports();
      programResults.querySelector(`[data-apply-note="${button.dataset.applyNote}"]`)?.focus();
    }));
    programResults.querySelectorAll('[data-select-all]').forEach((input) => {
      const report = reports[Number(input.dataset.selectAll)];
      const card = input.closest('.program-card');
      if (!report || !card) return;
      updateSelectAll(card, report);
      input.addEventListener('change', () => {
        report.checkedDetailIds = input.checked ? report.result.details.map((tx) => tx.id) : [];
        const reportIndex = input.dataset.selectAll;
        renderReports();
        programResults.querySelector(`[data-select-all="${reportIndex}"]`)?.focus();
      });
    });
    programResults.querySelectorAll('[data-detail-check]').forEach((input) => input.addEventListener('change', () => {
      const report = reports[Number(input.dataset.reportIndex)];
      if (!report) return;
      const card = input.closest('.program-card');
      report.checkedDetailIds = Array.from(card.querySelectorAll('[data-detail-check]:checked')).map((item) => item.dataset.detailCheck);
      updateSelectAll(card, report);
      updateNoteApply(card, report);
    }));
  }

  function updateSelectAll(card, report) {
    const selectAll = card.querySelector('[data-select-all]');
    if (!selectAll) return;
    const total = report.result.details.length;
    const selected = report.checkedDetailIds?.length || 0;
    selectAll.disabled = total === 0;
    selectAll.checked = total > 0 && selected === total;
    selectAll.indeterminate = selected > 0 && selected < total;
  }

  function updateNoteApply(card, report) {
    const button = card.querySelector('[data-apply-note]');
    if (!button) return;
    button.disabled = !report.noteKind || !report.noteSubgroup || !(report.checkedDetailIds?.length);
  }

  function renderProgram(report, index) {
    const { op, ledger, result, kind, cutoff } = report;
    const budget = result.budget;
    const remaining = budget ? budget - result.total : null;
    const opBudgetText = op.budget ? `운영현황 ${moneyText(op.budget)}` : '운영현황 예산액 미확인';
    const ledgerBudgetText = budget ? `장부 ${moneyText(budget)}` : '장부 배정 예산 미확인';
    const alerts = buildAlerts(report);
    const monthRows = Object.entries(result.months).filter(([, m]) => m.amount || m.operationAmount || m.control != null);
    const mismatchedMonths = result.monthMismatches.length;
    const subgroups = report.noteKind === '전문봉사단'
      ? ['손뜨개', '날세움', '귀건강']
      : report.noteKind === '가족봉사단'
        ? ['월드프랜드', '논사니', '달보드레', '뚜기']
        : [];
    const subgroupOptions = subgroups.map((name) => `<option value="${escapeHtml(name)}"${report.noteSubgroup === name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('');
    const noteReady = Boolean(report.noteKind && report.noteSubgroup && report.checkedDetailIds?.length);
    const descriptionPrefix = kind === 'family' ? '가족봉사단' : '프로그램명';
    return `<article class="program-card">
      <div class="program-card-head"><div><div class="program-title"><span class="number">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(kindLabel(kind))}</h3></div><div class="sheet-info">운영현황: ${escapeHtml(op.sourceFile)} · ${escapeHtml(op.sheetName)}<br>집행장부: ${escapeHtml(ledger.sourceFile)} · ${escapeHtml(ledger.sheetName)}</div></div><button class="button download-one" type="button" data-download="${index}">이 사업 HWPX 다운로드</button></div>
      <div class="metrics">
        <div class="metric"><span>장부 예산액</span><b>${budget ? moneyText(budget) : '자료 미확인'}</b><small>${escapeHtml(opBudgetText)}</small></div>
        <div class="metric"><span>${cutoff.month}월 말 누적 집행액</span><b>${moneyText(result.total)}</b><small>집행장부 거래일 기준</small></div>
        <div class="metric"><span>운영현황 금액 일치액</span><b>${moneyText(result.operationAmounts)}</b><small>집행장부 거래일 기준</small></div>
        <div class="metric"><span>금액 확인이 필요한 지출</span><b>${mismatchedMonths ? `${mismatchedMonths}개월` : '없음'}</b><small>${moneyText(result.monthlyDeviation)} · 잔액 ${remaining == null ? '—' : moneyText(remaining)}</small></div>
      </div>
      <div class="audit-summary"><h4>자료 대조 알림</h4></div>
      <ul class="alerts">${alerts.map((a) => `<li class="alert ${a.type}"><b>${a.type === 'good' ? '확인' : a.type === 'error' ? '불일치' : '검토'}</b><span>${escapeHtml(a.text)}</span></li>`).join('')}</ul>
      ${monthRows.length ? `<table class="months"><thead><tr><th>장부 지출월</th><th>운영현황 금액 일치액</th><th>집행장부 지출 합계</th><th>금액 확인 필요</th><th>집행장부 월계</th></tr></thead><tbody>${monthRows.map(([key, m]) => `<tr><td>${escapeHtml(key.replace('-', '년 ') + '월')}</td><td>${moneyText(m.operationAmount)}</td><td>${moneyText(m.amount)}</td><td>${moneyText(m.difference)}${m.difference === 0 ? ' · 모두 일치' : ' · 확인'}</td><td>${m.control == null ? '월계 없음' : `${moneyText(m.control)}${m.control === m.amount ? ' · 일치' : ' · 차이 확인'}`}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="detail-section"><div class="detail-heading"><h4>집행엑셀 기준 지출내역</h4><label class="description-choice">체크한 지출내용에 적용 <select data-description-suffix="${index}" aria-label="${escapeHtml(kindLabel(kind))} 체크한 지출내용에 문구 적용"><option value="" selected>먼저 행을 체크하세요</option><option value="__ledger__">집행장부 적요 그대로</option><option value="활동 재료 구매">${descriptionPrefix} 활동 재료 구매</option><option value="활동재료비 지급">${descriptionPrefix} 활동재료비 지급</option><option value="간식 구매">${descriptionPrefix} 간식 구매</option><option value="배너 제작">${descriptionPrefix} 배너 제작</option><option value="현수막 제작">${descriptionPrefix} 현수막 제작</option></select></label></div><div class="note-controls"><label>비고 봉사단<select data-note-kind="${index}" aria-label="비고 봉사단 선택"><option value="">봉사단 선택</option><option value="전문봉사단"${report.noteKind === '전문봉사단' ? ' selected' : ''}>전문봉사단</option><option value="가족봉사단"${report.noteKind === '가족봉사단' ? ' selected' : ''}>가족봉사단</option></select></label><label>세부 분야<select data-note-subgroup="${index}" aria-label="비고 세부 분야 선택"${report.noteKind ? '' : ' disabled'}><option value="">세부 분야 선택</option>${subgroupOptions}</select></label><button class="button apply-note" type="button" data-apply-note="${index}"${noteReady ? '' : ' disabled'}>선택 행에 비고 적용</button><small>봉사단 이름으로 비고를 자동 입력합니다. 필요한 행은 체크 후 다른 분야를 적용할 수 있습니다.</small></div><div class="table-wrap"><table class="audit-table"><thead><tr><th><label class="select-all"><input type="checkbox" data-select-all="${index}" aria-label="${escapeHtml(kindLabel(kind))} 지출내역 전체선택">전체선택</label></th><th>집행 날짜</th><th>집행액</th><th>지출내용</th><th>지출처</th><th>결제방법</th><th>비고</th><th>운영현황 대조</th></tr></thead><tbody>${renderAuditRows(report, index)}</tbody></table></div><p class="detail-note">체크한 행에는 위 메뉴의 문구를 적용할 수 있습니다. 품목별로 구매 또는 제작을 고르고, 지출내용·지출처 칸을 직접 클릭해 수정할 수 있습니다.</p></div>
    </article>`;
  }

  function buildAlerts(report) {
    const { op, result, budgetMismatch, detailMismatch, controlMismatch } = report;
    const alerts = [];
    if (budgetMismatch) alerts.push({ type: 'warn', text: `예산액이 서로 다릅니다. ${op.budget.toLocaleString()}원(운영현황) · ${result.budget.toLocaleString()}원(집행장부). HWPX 예산액은 장부 기준으로 넣습니다.` });
    else if (result.budget) alerts.push({ type: 'good', text: `예산액 확인: 운영현황 ${op.budget ? moneyText(op.budget) : '미기재'} · 집행장부 ${moneyText(result.budget)}.` });
    if (result.monthMismatches.length) alerts.push({ type: 'warn', text: `운영현황과 같은 금액을 확인할 장부 지출이 ${result.monthMismatches.length}개월에 있습니다: ${result.monthMismatches.map(([key, month]) => `${key} ${moneyText(month.difference)}`).join(' · ')}.` });
    else if (Object.keys(result.months).length) alerts.push({ type: 'good', text: '보고 기간의 장부 지출액이 운영현황 금액과 일치합니다. 활동일은 구매일로 사용하지 않았습니다.' });
    const amountOnly = result.details.filter((tx) => tx.amountMatchedOperation && !tx.matchedOperation);
    if (amountOnly.length) alerts.push({ type: 'warn', text: `같은 금액의 거래가 여러 건이라 프로그램·봉사단 연결을 확인할 행이 ${amountOnly.length}건 있습니다. 금액은 일치로 계산했습니다.` });
    if (result.unlinkedOperations.length) alerts.push({ type: 'warn', text: `운영현황 사용액 중 장부 거래를 찾지 못한 행이 ${result.unlinkedOperations.length}건 있습니다: ${result.unlinkedOperations.map((op) => `${op.rowNumber}행 ${moneyText(op.declaredAmount)}`).join(' · ')}.` });
    if (detailMismatch.length) alerts.push({ type: 'warn', text: `운영현황의 지출 상세 합과 운영비 칸이 다른 행이 ${detailMismatch.length}건 있습니다. 해당 행의 상세 합계를 확인해 주세요.` });
    if (controlMismatch.length) alerts.push({ type: 'error', text: `집행장부 월계 행과 거래내역 합계가 다른 월이 ${controlMismatch.length}개 있습니다: ${controlMismatch.map((x) => `${x.key} (${moneyText(x.amount)} vs ${moneyText(x.control)})`).join(' · ')}.` });
    const methodMissing = result.details.filter((tx) => !tx.method).length;
    if (methodMissing) alerts.push({ type: 'warn', text: `결제방법을 운영현황에서 찾지 못한 거래가 ${methodMissing}건 있습니다. HWPX에는 ‘자료 미확인’으로 입력합니다.` });
    if (!alerts.length) alerts.push({ type: 'good', text: '보고 기간의 집행장부 거래와 운영현황 항목을 대조했습니다.' });
    return alerts;
  }

  function renderAuditRows(report, reportIndex) {
    const { result } = report;
    if (!result.details.length) return '<tr><td colspan="8">보고 기간에 지출된 거래가 없습니다.</td></tr>';
    const selectedIds = new Set(report.checkedDetailIds || []);
    const itemized = itemizedLedgerItems(result);
    return result.details.map((tx) => {
      const status = tx.matchedOperation
        ? '<span class="badge match">금액·항목 일치</span>'
        : tx.amountMatchedOperation
          ? '<span class="badge unmatched">금액 일치 · 항목 확인</span>'
          : '<span class="badge unmatched">금액 확인 필요</span>';
      const suffix = report.detailSuffixes?.[tx.id];
      const items = itemized.get(tx.id);
      const lines = items?.length ? items : [{ label: '', amount: tx.amount }];
      const sourceDetail = tx.memo || '';
      const merchant = report.detailMerchants?.[tx.id] ?? tx.merchant ?? '자료 미확인';
      const checked = selectedIds.has(tx.id) ? ' checked' : '';
      return lines.map((item, lineIndex) => {
        const itemKey = item.itemIndex == null ? tx.id : `${tx.id}::${item.itemIndex}`;
        const itemAction = itemKey ? report.detailItemActions?.[itemKey] || '' : '';
        const descriptionInfo = reportDescription({ ...tx, merchant }, result, suffix, item.label, itemAction, report.kind);
        const description = Object.prototype.hasOwnProperty.call(report.detailDescriptions || {}, itemKey)
          ? report.detailDescriptions[itemKey]
          : descriptionInfo.description;
        const review = descriptionInfo.needsReview ? ' <span class="badge unmatched">프로그램명 확인</span>' : '';
        const itemActionSelect = item.itemIndex == null ? '' : `<label class="item-action-choice">구분 <select data-item-action="${escapeHtml(itemKey)}" data-report-index="${reportIndex}" aria-label="${escapeHtml(item.label)} 구매 또는 제작 선택"><option value=""${itemAction ? '' : ' selected'}>선택</option><option value="구매"${itemAction === '구매' ? ' selected' : ''}>구매</option><option value="제작"${itemAction === '제작' ? ' selected' : ''}>제작</option></select></label>`;
        const descriptionEditor = `<input class="description-edit" type="text" data-detail-description="${escapeHtml(itemKey)}" data-report-index="${reportIndex}" aria-label="${escapeHtml(dateText(tx.date))} 지출내용·지출처 수정" value="${escapeHtml(description)}">`;
        const merchantEditor = `<input class="description-edit" type="text" data-detail-merchant="${escapeHtml(tx.id)}" data-report-index="${reportIndex}" aria-label="${escapeHtml(dateText(tx.date))} 지출처 수정" value="${escapeHtml(merchant)}">`;
        const sharedCells = lineIndex === 0;
        const rowspan = lines.length > 1 ? ` rowspan="${lines.length}"` : '';
        return `<tr>${sharedCells ? `<td${rowspan}><input type="checkbox" data-detail-check="${escapeHtml(tx.id)}" data-report-index="${reportIndex}" aria-label="${escapeHtml(dateText(tx.date))} ${moneyText(tx.amount)}원 지출내용 선택"${checked}></td><td${rowspan}>${escapeHtml(dateText(tx.date))}</td>` : ''}<td class="num">${moneyText(item.amount)}</td><td>${descriptionEditor}${review}${itemActionSelect}${sharedCells && sourceDetail && cleanText(sourceDetail) !== cleanText(description) ? `<small class="detail-note">${escapeHtml(sourceDetail)}</small>` : ''}</td>${sharedCells ? `<td${rowspan}>${merchantEditor}</td><td${rowspan}><span class="badge method">${escapeHtml(tx.method || '자료 미확인')}</span></td><td${rowspan}>${escapeHtml(detailNote(report, tx))}</td><td${rowspan}>${status}</td>` : ''}</tr>`;
      }).join('');
    }).join('');
  }

  function xmlElements(parent, localName) {
    return Array.from(parent.getElementsByTagNameNS(NS, localName));
  }

  function cellText(cell) {
    return xmlElements(cell, 't').map((node) => node.textContent || '').join('');
  }

  function setCellText(doc, cell, value) {
    const textNodes = xmlElements(cell, 't');
    if (textNodes.length) {
      textNodes[0].textContent = String(value ?? '');
      textNodes.slice(1).forEach((node) => { node.textContent = ''; });
    } else {
      const p = xmlElements(cell, 'p')[0];
      if (!p) return;
      let run = Array.from(p.children).find((child) => child.localName === 'run');
      if (!run) {
        run = doc.createElementNS(NS, 'hp:run');
        run.setAttribute('charPrIDRef', '18');
        p.appendChild(run);
      }
      const t = doc.createElementNS(NS, 'hp:t');
      t.textContent = String(value ?? '');
      run.appendChild(t);
    }
    // Cached geometry in the blank template describes only one line.
    // Hancom must lay out the inserted text again to wrap within the cell.
    xmlElements(cell, 'linesegarray').forEach((node) => node.remove());
  }

  function directRows(table) {
    return Array.from(table.children).filter((child) => child.localName === 'tr');
  }

  function directCells(row) {
    return Array.from(row.children).filter((child) => child.localName === 'tc');
  }

  function updateParagraph(doc, contains, value) {
    const paragraphs = xmlElements(doc, 'p');
    const p = paragraphs.find((candidate) => xmlElements(candidate, 't').map((t) => t.textContent || '').join('').includes(contains));
    if (!p) return false;
    const nodes = xmlElements(p, 't');
    if (!nodes.length) return false;
    nodes[0].textContent = value;
    nodes.slice(1).forEach((node) => { node.textContent = ''; });
    return true;
  }

  function operationName(operation) {
    const activity = cleanText(operation?.activity);
    return /^수세미뜨기(?:및나눔)?$/.test(normalize(activity)) ? '수세미뜨기' : activity;
  }

  function formatExpenseDescription(program, phrase, tx, result) {
    const value = cleanText(phrase);
    let group = '';
    if (/^(?:현수막|배너)\s*제작$/.test(value)) {
      group = cleanText(tx.matchedOperation?.group);
    }
    if (group && normalize(program).includes(normalize(group))) group = '';
    return [program, group, value].filter(Boolean).join(' ');
  }

  function reportDescription(tx, result, suffix, itemLabel = '', itemAction = '', kind = '') {
    const matched = tx.matchedOperation;
    const matchedProgram = operationName(matched);
    const program = kind === 'family' ? '가족봉사단' : matchedProgram || '프로그램명 확인 필요';
    const ledgerDescription = cleanText(tx.memo);
    if (!suffix && !itemAction && ledgerDescription) {
      return { description: ledgerDescription, needsReview: false };
    }
    const automaticPhrase = expensePhraseForProgram(program, automaticExpensePhrase(tx, itemLabel));
    if (itemLabel) {
      const suffixPhrase = expensePhraseForProgram(program, suffix);
      const action = itemAction
        ? expensePhraseWithItemAction(suffixPhrase || automaticPhrase, itemAction)
        : suffixPhrase || automaticPhrase;
      return {
        description: formatExpenseDescription(program, action, tx, result),
        needsReview: !matchedProgram,
      };
    }
    if (!suffix) {
      const memo = removePurchaseSourceNames(tx.memo, tx.merchant);
      return {
        description: automaticPhrase ? formatExpenseDescription(program, automaticPhrase, tx, result) : memo || '집행엑셀 지출',
        needsReview: automaticPhrase ? !matchedProgram : false,
      };
    }
    return { description: formatExpenseDescription(program, expensePhraseForProgram(program, suffix), tx, result), needsReview: !matchedProgram };
  }

  function reportDetails(report) {
    const { result } = report;
    const itemized = itemizedLedgerItems(result);
    return result.details.flatMap((tx) => (itemized.get(tx.id) || [{ label: '', amount: tx.amount }]).map((item) => {
      const itemKey = item.itemIndex == null ? tx.id : `${tx.id}::${item.itemIndex}`;
      const merchant = report.detailMerchants?.[tx.id] ?? tx.merchant ?? '자료 미확인';
      const { description: generatedDescription } = reportDescription({ ...tx, merchant }, result, report.detailSuffixes?.[tx.id], item.label, report.detailItemActions?.[itemKey] || '', report.kind);
      const description = Object.prototype.hasOwnProperty.call(report.detailDescriptions || {}, itemKey)
        ? report.detailDescriptions[itemKey]
        : generatedDescription;
      const note = detailNote(report, tx);
      return { date: tx.date, amount: item.amount, description, merchant, method: tx.method || '자료 미확인', note };
    }));
  }

  function appendTextToCell(doc, cell, text) {
    setCellText(doc, cell, text);
  }

  function detailRowHeight(item) {
    const values = [expenseDateText(item.date), moneyCell(item.amount), item.description, item.merchant, item.method, item.note];
    const charsPerLine = [7, 8, 17, 13, 7, 5];
    const lines = values.map((value, index) => {
      if (index === 5) return 1; // 비고 셀은 한 줄로 넣기 서식을 사용한다.
      const width = Array.from(String(value ?? '')).reduce((sum, char) => sum + (/[\x00-\x7f]/.test(char) ? 0.55 : 1), 0);
      return Math.max(1, Math.ceil(width / charsPerLine[index]));
    });
    return Math.max(2897, Math.max(...lines) * 1300 + 500);
  }

  function detailPages(details) {
    const pages = [[]];
    let usedHeight = 3460 + 2614;
    for (const item of details) {
      const height = detailRowHeight(item);
      const limit = pages.length === 1 ? 25000 : 56000;
      if (pages[pages.length - 1].length && usedHeight + height > limit) {
        pages.push([]);
        usedHeight = 3460;
      }
      pages[pages.length - 1].push({ ...item, rowHeight: height });
      usedHeight += height;
    }
    return pages;
  }

  function resizeTableToRows(table) {
    const size = Array.from(table.children).find((child) => child.localName === 'sz');
    if (!size) return;
    const height = directRows(table).reduce((sum, row) => {
      const cellHeights = directCells(row).map((cell) => {
        const cellSize = Array.from(cell.children).find((child) => child.localName === 'cellSz');
        return Number(cellSize?.getAttribute('height')) || 0;
      });
      return sum + Math.max(0, ...cellHeights);
    }, 0);
    size.setAttribute('height', String(height));
  }

  function setTableWidths(table, widths) {
    const size = Array.from(table.children).find((child) => child.localName === 'sz');
    if (size) size.setAttribute('width', String(widths.reduce((sum, width) => sum + width, 0)));
    table.setAttribute('noAdjust', '0');
    const position = Array.from(table.children).find((child) => child.localName === 'pos');
    if (position) position.setAttribute('treatAsChar', '1');
    directRows(table).forEach((row) => directCells(row).forEach((cell, index) => {
      const cellSize = Array.from(cell.children).find((child) => child.localName === 'cellSz');
      if (cellSize && widths[index] != null) cellSize.setAttribute('width', String(widths[index]));
    }));
  }

  function alignTableWithTextMargin(paragraph) {
    const run = Array.from(paragraph.children).find((child) => child.localName === 'run');
    const leadingText = run && Array.from(run.children).find((child) => child.localName === 't');
    if (leadingText) leadingText.textContent = '';
  }

  async function createHwpx(report) {
    const response = await fetch(TEMPLATE_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('원본 HWPX 서식을 읽지 못했습니다. 로컬 웹서버에서 앱을 열어 주세요.');
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const sectionFile = zip.file('Contents/section0.xml');
    if (!sectionFile) throw new Error('HWPX 원본에서 본문을 찾지 못했습니다.');
    const xml = await sectionFile.async('text');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('HWPX 본문 XML을 읽지 못했습니다.');
    const cutoffLabel = `${report.cutoff.year}. ${report.cutoff.month}월말 기준`;
    updateParagraph(doc, '프로그램명', `❍ 프로그램명 : ${kindLabel(report.kind)}`);
    const titleP = xmlElements(doc, 'p').find((p) => xmlElements(p, 't').map((t) => t.textContent || '').join('').includes('집행현황 및 내역'));
    if (titleP) {
      const titleNodes = xmlElements(titleP, 't');
      const mainTitle = `4. ${report.cutoff.year} 사업(프로그램)별 집행현황 및 내역`;
      const mainTitleNode = titleNodes.find((t) => (t.textContent || '').includes('집행현황 및 내역'));
      const cutoffNode = titleNodes.find((t) => (t.textContent || '').includes('기준'));
      if (mainTitleNode) mainTitleNode.textContent = mainTitle;
      if (cutoffNode) cutoffNode.textContent = `(${cutoffLabel})`;
      titleNodes.forEach((t) => {
        if (t !== mainTitleNode && t !== cutoffNode) t.textContent = '';
      });
    }

    const tables = xmlElements(doc, 'tbl');
    if (tables.length < 2) throw new Error('원본 HWPX에서 예산·집행내역 표를 찾지 못했습니다.');
    const summaryRows = directRows(tables[0]);
    const summaryCells = directCells(summaryRows[1] || summaryRows[0]);
    if (summaryCells.length >= 3) {
      setCellText(doc, summaryCells[0], moneyCell(report.result.budget));
      setCellText(doc, summaryCells[1], moneyCell(report.result.total));
      setCellText(doc, summaryCells[2], '');
      summaryCells.slice(0, 2).forEach((cell) => {
        const paragraph = xmlElements(cell, 'p')[0];
        if (paragraph) paragraph.setAttribute('paraPrIDRef', '4');
      });
    }
    setTableWidths(tables[0], [16989, 16989, 16989]);
    let summaryParagraph = tables[0].parentElement;
    while (summaryParagraph && summaryParagraph.localName !== 'p') summaryParagraph = summaryParagraph.parentElement;
    if (summaryParagraph) alignTableWithTextMargin(summaryParagraph);

    const details = reportDetails(report);
    const detailTable = tables[1];
    let detailParagraph = detailTable.parentElement;
    while (detailParagraph && detailParagraph.localName !== 'p') detailParagraph = detailParagraph.parentElement;
    if (directRows(detailTable).length < 3 || !detailParagraph) throw new Error('원본 HWPX의 세부 지출 표 구조를 확인할 수 없습니다.');
    const blankPage = detailParagraph.cloneNode(true);
    const pages = detailPages(details);
    let previousParagraph = detailParagraph;
    pages.forEach((pageItems, pageIndex) => {
      const paragraph = pageIndex === 0 ? detailParagraph : blankPage.cloneNode(true);
      if (pageIndex > 0) {
        paragraph.setAttribute('pageBreak', '1');
        previousParagraph.parentNode.insertBefore(paragraph, previousParagraph.nextSibling);
        previousParagraph = paragraph;
      }
      alignTableWithTextMargin(paragraph);
      xmlElements(paragraph, 'linesegarray').forEach((node) => node.remove());
      const table = xmlElements(paragraph, 'tbl')[0];
      if (pageIndex > 0) table.setAttribute('id', String(2000000000 + pageIndex));
      setTableWidths(table, [5102, 5669, 15874, 12756, 6236, 5330]);
      table.setAttribute('repeatHeader', '1');
      const rows = directRows(table);
      if (pageIndex === 0) {
        const totalCells = directCells(rows[1]);
        if (totalCells.length >= 2) {
          setCellText(doc, totalCells[1], moneyCell(report.result.total));
          xmlElements(totalCells[1], 'run').forEach((run) => run.setAttribute('charPrIDRef', '24'));
        }
      } else {
        table.removeChild(rows[1]);
      }
      const templateRow = rows[2];
      rows.slice(2).forEach((row) => table.removeChild(row));
      for (const [index, item] of pageItems.entries()) {
        const row = templateRow.cloneNode(true);
        table.appendChild(row);
        const cells = directCells(row);
        const values = [expenseDateText(item.date), moneyCell(item.amount), item.description, item.merchant, item.method, item.note];
        cells.slice(0, 6).forEach((cell, col) => {
          const address = Array.from(cell.children).find((child) => child.localName === 'cellAddr');
          if (address) address.setAttribute('rowAddr', String(index + (pageIndex === 0 ? 2 : 1)));
          const size = Array.from(cell.children).find((child) => child.localName === 'cellSz');
          if (size) size.setAttribute('height', String(item.rowHeight));
          appendTextToCell(doc, cell, values[col]);
          if (col === 5) {
            const subList = Array.from(cell.children).find((child) => child.localName === 'subList');
            if (subList) subList.setAttribute('lineWrap', 'SQUEEZE');
          }
          if (col === 1) xmlElements(cell, 'run').forEach((run) => run.setAttribute('charPrIDRef', '24'));
          const cellParagraph = xmlElements(cell, 'p')[0];
          if (cellParagraph) cellParagraph.setAttribute('paraPrIDRef', '4');
        });
      }
      table.setAttribute('rowCnt', String(directRows(table).length));
      resizeTableToRows(table);
    });

    const serialized = new XMLSerializer().serializeToString(doc);
    zip.file('Contents/section0.xml', serialized);
    const previewText = [
      `4. ${report.cutoff.year} 사업(프로그램)별 집행현황 및 내역(${cutoffLabel})`,
      `프로그램명 : ${kindLabel(report.kind)}`,
      `예산액 ${moneyCell(report.result.budget)}원 / 집행액 ${moneyCell(report.result.total)}원`,
      ...details.map((item) => `${expenseDateText(item.date)} ${moneyCell(item.amount)} ${item.description} ${item.merchant} ${item.method} ${item.note}`),
    ].join('\n');
    if (zip.file('Preview/PrvText.txt')) zip.file('Preview/PrvText.txt', previewText);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  async function downloadReport(index) {
    const report = reports[index];
    if (!report) return;
    const button = programResults.querySelector(`[data-download="${index}"]`);
    const oldText = button?.textContent || '';
    if (button) { button.disabled = true; button.textContent = '서식 작성 중…'; }
    try {
      const blob = await createHwpx(report);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${report.cutoff.year}_${kindLabel(report.kind)}_지도점검_사업별집행현황_${String(report.cutoff.month).padStart(2, '0')}월.hwpx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      if (button) button.textContent = '다운로드 완료';
      setStatus(`${kindLabel(report.kind)} HWPX를 만들었습니다. 한글에서 열어 내용과 페이지를 확인하세요.`, 'busy');
    } catch (error) {
      setStatus(error.message || 'HWPX 파일을 만들지 못했습니다.', 'error');
      if (button) button.textContent = oldText;
    } finally {
      if (button) button.disabled = false;
    }
  }

  operationInput.addEventListener('click', () => { operationInput.value = ''; });
  ledgerInput.addEventListener('click', () => { ledgerInput.value = ''; });
  operationInput.addEventListener('change', () => {
    if (!operationInput.files?.length) return;
    currentSavedWorkId = null;
    pendingReportStates = null;
    operationFiles = Array.from(operationInput.files || []);
    renderFileNames(operationFiles, $('operationNames'), '.xls 또는 .xlsx 여러 개 선택');
    analyze();
  });
  ledgerInput.addEventListener('change', () => {
    if (!ledgerInput.files?.length) return;
    currentSavedWorkId = null;
    pendingReportStates = null;
    ledgerFiles = Array.from(ledgerInput.files || []);
    renderFileNames(ledgerFiles, $('ledgerNames'), '.xls 또는 .xlsx 여러 개 선택');
    analyze();
  });
  monthInput.addEventListener('change', analyze);
  saveWorkButton.addEventListener('click', saveCurrentWork);
  refreshSavedWorks();
})();
