(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const operationInput = $('operationFiles');
  const ledgerInput = $('ledgerFiles');
  const monthInput = $('cutoffMonth');
  const statusNode = $('status');
  const programResults = $('programResults');
  const resultSection = $('results');
  const NS = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  const TEMPLATE_URL = './templates/지도점검_사업별집행현황.hwpx';
  const WINDOW_DAYS = 14;
  let operationFiles = [];
  let ledgerFiles = [];
  let reports = [];
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
  const dateText = (date) => date ? `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.` : '';
  const dayKey = (date) => date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` : '';
  const daysBetween = (a, b) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);

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
        dateKey: dayKey(date),
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
        kind,
        sourceFile: file.name,
        matchedIds: [],
        matchedAmount: 0,
        status: 'unmatched',
      });
    }
    const summaryValues = rows.slice(0, Math.min(8, rows.length)).flat().map(money).filter((n) => n > 1000);
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
        const budgetCol = h.findIndex((x) => /예산액|예산/.test(x));
        const methodCol = h.findIndex((x) => /지출방법|결제방법|결제수단/.test(x));
        const kind = kindFromText(`${fileName} ${name} ${(rows[0] || []).join(' ')}`);
        const year = detectYear(rows, fileName, defaultYear);
        let count = 0;
        for (const row of rows.slice(r + 1)) if (parseDate(row?.[dateCol], year) && money(row?.[amountCol]) > 0) count += 1;
        candidates.push({ sheet, name, rows, headerRow: r, dateCol, amountCol, memoCol, vendorCol, budgetCol, methodCol, kind, year, score: count + (kind ? 15 : 0) });
        break;
      }
    }
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }

  function parseLedger(candidate, file) {
    const { rows, headerRow, dateCol, amountCol, memoCol, vendorCol, budgetCol, methodCol, year, kind } = candidate;
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
      const method = methodCol >= 0 ? normalizeMethod(row[methodCol]) : '';
      transactions.push({
        id: `tx-${r + 1}`,
        rowNumber: r + 1,
        date,
        dateKey: dayKey(date),
        amount,
        memo,
        merchant,
        method,
        sourceFile: file.name,
        matchedOperation: null,
      });
    }
    return { kind, year, sourceFile: file.name, sheetName: candidate.name, transactions, monthlyControl, budget };
  }

  function subsetForAmount(candidates, target, operation) {
    if (!candidates.length || target <= 0) return null;
    const sorted = candidates.slice().sort((a, b) => {
      const da = Math.abs(daysBetween(a.date, operation.date));
      const db = Math.abs(daysBetween(b.date, operation.date));
      const va = operation.items.some((it) => normalize(it.label).includes(normalize(a.merchant)) || normalize(a.merchant).includes(normalize(it.label)));
      const vb = operation.items.some((it) => normalize(it.label).includes(normalize(b.merchant)) || normalize(b.merchant).includes(normalize(it.label)));
      return (da * 10 - (va ? 4 : 0)) - (db * 10 - (vb ? 4 : 0));
    });
    let best = null;
    let bestScore = Infinity;
    const maxDepth = Math.min(6, sorted.length);
    function search(start, sum, chosen, score) {
      if (sum === target) {
        if (score < bestScore) { best = chosen.slice(); bestScore = score; }
        return;
      }
      if (sum > target || chosen.length >= maxDepth || score >= bestScore) return;
      for (let i = start; i < sorted.length; i += 1) {
        const tx = sorted[i];
        const next = sum + tx.amount;
        if (next > target) continue;
        chosen.push(tx);
        search(i + 1, next, chosen, score + Math.abs(daysBetween(tx.date, operation.date)) * 10);
        chosen.pop();
      }
    }
    search(0, 0, [], 0);
    return best;
  }

  function matchBooks(operation, ledger, cutoff) {
    const allTransactions = ledger.transactions.slice().sort((a, b) => a.date - b.date || a.rowNumber - b.rowNumber);
    for (const op of operation.entries.slice().sort((a, b) => a.date - b.date || a.rowNumber - b.rowNumber)) {
      const candidates = allTransactions.filter((tx) => !tx.matchedOperation && Math.abs(daysBetween(tx.date, op.date)) <= WINDOW_DAYS);
      const found = subsetForAmount(candidates, op.amount, op);
      if (found) {
        op.matchedIds = found.map((tx) => tx.id);
        op.matchedAmount = found.reduce((sum, tx) => sum + tx.amount, 0);
        op.status = found.every((tx) => daysBetween(tx.date, op.date) === 0) ? 'match' : 'date';
        for (const tx of found) tx.matchedOperation = op;
      }
    }
    const cutoffDate = new Date(cutoff.year, cutoff.month, 0, 23, 59, 59, 999);
    const txs = allTransactions.filter((tx) => tx.date <= cutoffDate && tx.date.getFullYear() === cutoff.year);
    const includedIds = new Set(txs.map((tx) => tx.id));
    const opThroughPeriod = operation.entries.filter((op) => op.date.getFullYear() === cutoff.year && op.date <= cutoffDate);
    const relevantOps = operation.entries.filter((op) => op.date.getFullYear() === cutoff.year && (op.date <= cutoffDate || op.matchedIds.some((id) => includedIds.has(id))));
    const matchedTransactions = txs.filter((tx) => tx.matchedOperation);
    const matchedAmount = matchedTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const total = txs.reduce((sum, tx) => sum + tx.amount, 0);
    const unmatchedTransactions = txs.filter((tx) => !tx.matchedOperation);
    const unmatchedOperations = opThroughPeriod.filter((op) => !op.matchedIds.length);
    const operationAmounts = opThroughPeriod.reduce((sum, op) => sum + op.amount, 0);
    const months = {};
    for (let m = 1; m <= cutoff.month; m += 1) {
      const key = `${cutoff.year}-${String(m).padStart(2, '0')}`;
      const monthTx = txs.filter((tx) => `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}` === key);
      const amount = monthTx.reduce((sum, tx) => sum + tx.amount, 0);
      const matched = monthTx.filter((tx) => tx.matchedOperation).reduce((sum, tx) => sum + tx.amount, 0);
      months[key] = { amount, matched, unmatched: amount - matched, control: ledger.monthlyControl[key] ?? null };
    }
    const details = txs.map((tx) => ({
      ...tx,
      operation: tx.matchedOperation,
      method: tx.method || tx.matchedOperation?.method || '',
      dateDifference: tx.matchedOperation ? daysBetween(tx.date, tx.matchedOperation.date) : null,
    }));
    return { transactions: txs, details, total, matchedAmount, unmatchedAmount: total - matchedAmount, unmatchedTransactions, unmatchedOperations, opThroughPeriod, relevantOps, operationAmounts, months, cutoffDate, budget: ledger.budget };
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
    if (!operationFiles.length || !ledgerFiles.length) {
      resultSection.hidden = true;
      setStatus('운영현황 엑셀과 집행장부를 모두 선택하면 자동 분석합니다.');
      return;
    }
    setStatus('엑셀 시트를 찾아 날짜·금액·결제 정보를 대조하고 있습니다…', 'busy');
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
      reports = pairs.map((pair) => {
        const kind = pair.kind;
        const result = matchBooks(pair.op, pair.ledger, cutoff);
        const budgetMismatch = pair.op.budget > 0 && result.budget > 0 && pair.op.budget !== result.budget;
        const detailMismatch = pair.op.entries.filter((op) => op.date.getFullYear() === cutoff.year && op.date <= result.cutoffDate && op.detailsAmount > 0 && op.declaredAmount > 0 && op.detailsAmount !== op.declaredAmount);
        const controlMismatch = Object.entries(result.months).filter(([key, month]) => month.control != null && month.control !== month.amount).map(([key, month]) => ({ key, ...month }));
        return { ...pair, kind, result, budgetMismatch, detailMismatch, controlMismatch, cutoff };
      });
      if (token !== generationToken) return;
      $('resultTitle').textContent = `${cutoff.year}년 ${cutoff.month}월 말까지`;
      renderReports();
      resultSection.hidden = false;
      setStatus(`${reports.length}개 사업을 분석했습니다. 장부의 실제 거래일 기준으로 기간을 잘라 HWPX에 반영합니다.`, 'busy');
    } catch (error) {
      if (token !== generationToken) return;
      reports = [];
      resultSection.hidden = true;
      setStatus(error.message || '파일을 읽지 못했습니다.', 'error');
    }
  }

  function setStatus(text, state = '') {
    statusNode.textContent = text;
    statusNode.className = `status${state ? ` ${state}` : ''}`;
  }

  function renderFileNames(inputFiles, node, emptyLabel) {
    node.textContent = inputFiles.length ? inputFiles.map((file) => file.name).join(' · ') : emptyLabel;
  }

  function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function renderReports() {
    programResults.innerHTML = reports.map((report, index) => renderProgram(report, index)).join('');
    programResults.querySelectorAll('[data-download]').forEach((button) => button.addEventListener('click', () => downloadReport(Number(button.dataset.download))));
  }

  function renderProgram(report, index) {
    const { op, ledger, result, kind, cutoff } = report;
    const budget = result.budget;
    const remaining = budget ? budget - result.total : null;
    const opBudgetText = op.budget ? `운영현황 ${moneyText(op.budget)}` : '운영현황 예산액 미확인';
    const ledgerBudgetText = budget ? `장부 ${moneyText(budget)}` : '장부 배정 예산 미확인';
    const alerts = buildAlerts(report);
    const monthRows = Object.entries(result.months).filter(([, m]) => m.amount || m.control != null);
    return `<article class="program-card">
      <div class="program-card-head"><div><div class="program-title"><span class="number">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(kindLabel(kind))}</h3></div><div class="sheet-info">운영현황: ${escapeHtml(op.sourceFile)} · ${escapeHtml(op.sheetName)}<br>집행장부: ${escapeHtml(ledger.sourceFile)} · ${escapeHtml(ledger.sheetName)}</div></div><button class="button download-one" type="button" data-download="${index}">이 사업 HWPX 다운로드</button></div>
      <div class="metrics">
        <div class="metric"><span>장부 예산액</span><b>${budget ? moneyText(budget) : '자료 미확인'}</b><small>${escapeHtml(opBudgetText)}</small></div>
        <div class="metric"><span>${cutoff.month}월 말 누적 집행액</span><b>${moneyText(result.total)}</b><small>집행장부 거래일 기준</small></div>
        <div class="metric"><span>운영내역과 금액 일치</span><b>${moneyText(result.matchedAmount)}</b><small>활동일 ±${WINDOW_DAYS}일 내 정확 합계 대조</small></div>
        <div class="metric"><span>미대응 장부 집행액</span><b>${moneyText(result.unmatchedAmount)}</b><small>${result.unmatchedTransactions.length}건 · 잔액 ${remaining == null ? '—' : moneyText(remaining)}</small></div>
      </div>
      <div class="audit-summary"><h4>자료 대조 알림</h4></div>
      <ul class="alerts">${alerts.map((a) => `<li class="alert ${a.type}"><b>${a.type === 'good' ? '확인' : a.type === 'error' ? '불일치' : '검토'}</b><span>${escapeHtml(a.text)}</span></li>`).join('')}</ul>
      ${monthRows.length ? `<table class="months"><thead><tr><th>거래월</th><th>장부 합계</th><th>대조된 금액</th><th>미대응</th><th>장부 월계 확인</th></tr></thead><tbody>${monthRows.map(([key, m]) => `<tr><td>${escapeHtml(key.replace('-', '년 ') + '월')}</td><td>${moneyText(m.amount)}</td><td>${moneyText(m.matched)}</td><td>${moneyText(m.unmatched)}</td><td>${m.control == null ? '장부 월계 없음' : `${moneyText(m.control)}${m.control === m.amount ? ' · 일치' : ' · 차이 확인'}`}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="detail-section"><h4>운영 날짜·금액과 실제 거래 대조</h4><div class="table-wrap"><table class="audit-table"><thead><tr><th>운영현황 활동일</th><th>운영비</th><th>장부 결제일·금액</th><th>지출처 / 내용</th><th>결제방법</th><th>결과</th></tr></thead><tbody>${renderAuditRows(report)}</tbody></table></div><p class="detail-note">장부 날짜가 활동 날짜와 다를 수 있어 실제 지출일은 집행장부 기준으로 보고서에 넣습니다. 대조용 활동일은 비고에 함께 기록합니다.</p></div>
    </article>`;
  }

  function buildAlerts(report) {
    const { op, result, budgetMismatch, detailMismatch, controlMismatch } = report;
    const alerts = [];
    if (budgetMismatch) alerts.push({ type: 'warn', text: `예산액이 서로 다릅니다. ${op.budget.toLocaleString()}원(운영현황) · ${result.budget.toLocaleString()}원(집행장부). HWPX 예산액은 장부 기준으로 넣고 차이를 비고에 남깁니다.` });
    else if (result.budget) alerts.push({ type: 'good', text: `예산액 확인: 운영현황 ${op.budget ? moneyText(op.budget) : '미기재'} · 집행장부 ${moneyText(result.budget)}.` });
    if (result.unmatchedTransactions.length) alerts.push({ type: 'warn', text: `집행장부 ${result.unmatchedTransactions.length}건 ${moneyText(result.unmatchedAmount)}은 운영 기록에서 날짜·금액을 함께 만족하는 항목을 찾지 못했습니다. HWPX에 거래를 남기고 ‘운영현황 미확인’으로 표시합니다.` });
    if (result.unmatchedOperations.length) {
      const total = result.unmatchedOperations.reduce((sum, row) => sum + row.amount, 0);
      alerts.push({ type: 'warn', text: `운영현황 ${result.unmatchedOperations.length}건 ${moneyText(total)}은 기준일까지 집행장부에서 대응 거래를 찾지 못했습니다. 외상·미집행 표시가 있는지 확인 대상입니다.` });
    }
    if (detailMismatch.length) alerts.push({ type: 'warn', text: `운영현황의 지출 상세 합과 운영비 칸이 다른 행이 ${detailMismatch.length}건 있습니다: ${detailMismatch.map((x) => `${dateText(x.date)} ${moneyText(x.amount)}(상세 ${moneyText(x.detailsAmount)})`).join(' · ')}.` });
    if (controlMismatch.length) alerts.push({ type: 'error', text: `집행장부 월계 행과 거래내역 합계가 다른 월이 ${controlMismatch.length}개 있습니다: ${controlMismatch.map((x) => `${x.key} (${moneyText(x.amount)} vs ${moneyText(x.control)})`).join(' · ')}.` });
    const methodMissing = result.details.filter((tx) => !tx.method).length;
    if (methodMissing) alerts.push({ type: 'warn', text: `결제방법을 운영현황에서 찾지 못한 거래가 ${methodMissing}건 있습니다. HWPX에는 ‘자료 미확인’으로 입력합니다.` });
    if (!alerts.some((a) => a.type !== 'good')) alerts.push({ type: 'good', text: '보고 기간의 집행장부 거래와 운영현황 금액을 자동 대조했습니다. 대조된 금액은 일치합니다.' });
    return alerts;
  }

  function renderAuditRows(report) {
    const { result } = report;
    const rows = [];
    for (const op of result.relevantOps) {
      const txs = result.transactions.filter((tx) => tx.matchedOperation?.id === op.id);
      const txAmount = txs.reduce((sum, tx) => sum + tx.amount, 0);
      const dates = txs.map((tx) => `${dateText(tx.date)} ${moneyText(tx.amount)}`).join('<br>');
      const vendors = txs.map((tx) => escapeHtml(tx.merchant || tx.memo)).join('<br>');
      const method = [...new Set(txs.map((tx) => tx.method || op.method).filter(Boolean))].join(', ') || '자료 미확인';
      const exact = txs.length && txAmount === op.amount;
      const sameDay = txs.length && txs.every((tx) => dayKey(tx.date) === op.dateKey);
      const badge = exact ? (sameDay ? '<span class="badge match">날짜·금액 일치</span>' : '<span class="badge date">금액 일치 · 날짜 차이</span>') : '<span class="badge unmatched">장부 대응 없음</span>';
      rows.push(`<tr><td>${escapeHtml(dateText(op.date))}<span class="small-text">${escapeHtml(op.activity || op.group || '')}</span></td><td class="num">${moneyText(op.amount)}</td><td>${dates || '—'}${txs.length && !sameDay ? `<span class="small-text">활동일 대비 ${Math.max(...txs.map((tx) => Math.abs(daysBetween(tx.date, op.date))))}일 이내</span>` : ''}</td><td>${vendors || escapeHtml(op.detail || '—')}</td><td><span class="badge method">${escapeHtml(method)}</span></td><td>${badge}</td></tr>`);
    }
    for (const tx of result.unmatchedTransactions) {
      rows.push(`<tr><td>운영현황 미확인</td><td class="num">—</td><td>${escapeHtml(dateText(tx.date))}<span class="small-text">${moneyText(tx.amount)}</span></td><td>${escapeHtml(tx.merchant || tx.memo || '—')}<span class="small-text">${escapeHtml(tx.memo || '')}</span></td><td><span class="badge method">${escapeHtml(tx.method || '자료 미확인')}</span></td><td><span class="badge unmatched">운영현황 미대응</span></td></tr>`);
    }
    if (!rows.length) return '<tr><td colspan="6">보고 기간에 지출된 거래가 없습니다.</td></tr>';
    return rows.join('');
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
      return;
    }
    const p = xmlElements(cell, 'p')[0];
    if (!p) return;
    let run = Array.from(p.children).find((child) => child.localName === 'run');
    if (!run) {
      run = doc.createElementNS(NS, 'hp:run');
      run.setAttribute('charPrIDRef', '18');
      const lineSegs = Array.from(p.children).find((child) => child.localName === 'linesegarray');
      p.insertBefore(run, lineSegs || null);
    }
    const t = doc.createElementNS(NS, 'hp:t');
    t.textContent = String(value ?? '');
    run.appendChild(t);
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

  function formatNote(report) {
    const items = [];
    if (report.budgetMismatch) items.push(`운영현황 예산 ${moneyCell(report.op.budget)}원 / 장부 예산 ${moneyCell(report.result.budget)}원`);
    if (report.result.unmatchedAmount) items.push(`미대응 집행 ${moneyCell(report.result.unmatchedAmount)}원 확인 필요`);
    if (report.detailMismatch.length) items.push(`운영 상세 금액 불일치 ${report.detailMismatch.length}건`);
    if (report.controlMismatch.length) items.push(`장부 월계 불일치 ${report.controlMismatch.length}개월`);
    if (!items.length) items.push(`${report.cutoff.year}. ${report.cutoff.month}월 말 누계`);
    return items.join(' · ');
  }

  function reportDetails(report) {
    const { result } = report;
    return result.details.map((tx) => {
      const op = tx.operation;
      const activity = op?.activity || op?.group || '';
      const description = [tx.memo, activity ? `활동: ${activity}` : ''].filter(Boolean).join(' · ') || tx.merchant || '운영현황 지출';
      const status = op
        ? (tx.dateDifference === 0 ? '운영일·금액 일치' : `금액 일치 · 활동일 ${dateText(op.date)} (${Math.abs(tx.dateDifference)}일 차이)`)
        : '운영현황 미확인 · 확인 필요';
      return { date: tx.date, amount: tx.amount, description, merchant: tx.merchant || '자료 미확인', method: tx.method || '자료 미확인', note: status };
    });
  }

  function appendTextToCell(doc, cell, text) {
    setCellText(doc, cell, text);
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
      const node = xmlElements(titleP, 't')[0];
      if (node) node.textContent = `4. ${report.cutoff.year}년 사업(프로그램)별 집행현황 및 내역 (${cutoffLabel})`;
      xmlElements(titleP, 't').slice(1).forEach((t) => { t.textContent = ''; });
    }

    const tables = xmlElements(doc, 'tbl');
    if (tables.length < 2) throw new Error('원본 HWPX에서 예산·집행내역 표를 찾지 못했습니다.');
    const summaryRows = directRows(tables[0]);
    const summaryCells = directCells(summaryRows[1] || summaryRows[0]);
    if (summaryCells.length >= 3) {
      setCellText(doc, summaryCells[0], moneyCell(report.result.budget));
      setCellText(doc, summaryCells[1], moneyCell(report.result.total));
      setCellText(doc, summaryCells[2], formatNote(report));
    }

    const detailTable = tables[1];
    const rows = directRows(detailTable);
    if (rows.length < 3) throw new Error('원본 HWPX의 세부 지출 표 구조를 확인할 수 없습니다.');
    const totalCells = directCells(rows[1]);
    if (totalCells.length >= 2) setCellText(doc, totalCells[1], moneyCell(report.result.total));
    const entryRows = rows.slice(2);
    const templateRow = entryRows[entryRows.length - 1];
    const details = reportDetails(report);
    while (entryRows.length < details.length) {
      const clone = templateRow.cloneNode(true);
      detailTable.appendChild(clone);
      entryRows.push(clone);
    }
    detailTable.setAttribute('rowCnt', String(directRows(detailTable).length));
    for (let i = 0; i < entryRows.length; i += 1) {
      const row = entryRows[i];
      directCells(row).forEach((cell) => {
        const address = Array.from(cell.children).find((child) => child.localName === 'cellAddr');
        if (address) address.setAttribute('rowAddr', String(i + 2));
      });
      const item = details[i];
      const cells = directCells(row);
      if (!item || cells.length < 6) continue;
      const values = [dateText(item.date), moneyCell(item.amount), item.description, item.merchant, item.method, item.note];
      cells.slice(0, 6).forEach((cell, col) => appendTextToCell(doc, cell, values[col]));
    }

    const serialized = new XMLSerializer().serializeToString(doc);
    zip.file('Contents/section0.xml', serialized);
    const previewText = [
      `${report.cutoff.year}년 사업(프로그램)별 집행현황 및 내역 (${cutoffLabel})`,
      `프로그램명 : ${kindLabel(report.kind)}`,
      `예산액 ${moneyCell(report.result.budget)}원 / 집행액 ${moneyCell(report.result.total)}원`,
      ...details.map((item) => `${dateText(item.date)} ${moneyCell(item.amount)} ${item.description} ${item.merchant} ${item.method} ${item.note}`),
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

  operationInput.addEventListener('change', () => {
    operationFiles = Array.from(operationInput.files || []);
    renderFileNames(operationFiles, $('operationNames'), '.xls 또는 .xlsx 여러 개 선택');
    analyze();
  });
  ledgerInput.addEventListener('change', () => {
    ledgerFiles = Array.from(ledgerInput.files || []);
    renderFileNames(ledgerFiles, $('ledgerNames'), '.xls 또는 .xlsx 여러 개 선택');
    analyze();
  });
  monthInput.addEventListener('change', analyze);
})();
