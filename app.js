const $ = (id) => document.getElementById(id);
const fieldIds = ['year','event','name','hanja','birth','gender','org','job','rank','position','address','phone','award','order','investigator','investigatorOrg','investigatorRank','recommender','docDate','career','history','gist','intro','character','reputation','matching'];
const defaultCategories = ['지역안전 및 화재예방','재난·재해 대응 및 방역','환경보호 및 자원순환','문화행사 지원','이웃사랑 실천'];
let records = [];
let groups = defaultCategories.map(title => ({title,detail:'',short:''}));
let stamp = null;
let lastImport = {files:0, imported:0, duplicates:0, rejected:0};

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const clean = value => String(value ?? '').replace(/\u00a0/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
const normalized = value => clean(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const val = id => clean($(id).value);
const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

$('docDate').value = todayLocal();
renderGroups(); renderRows(); updateCharacterCount(); updateStampSizeLabels();

function announce(message, tone='info') {
  const target = $('fileStatus'); target.textContent = message; target.className = `notice ${tone === 'error' ? 'notice-caution' : ''}`;
}
function announceExport(message, tone='info') {
  const target = $('exportStatus'); target.textContent = message; target.className = `notice ${tone === 'error' ? 'notice-caution' : ''}`;
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  if (typeof value === 'number' && value > 20000 && value < 90000) {
    const date = new Date(Date.UTC(1899,11,30) + Math.round(value) * 86400000);
    return date.toISOString().slice(0,10);
  }
  const text = clean(value);
  if (!text) return '';
  const compact = text.match(/^(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (compact) return `${compact[1]}-${compact[2].padStart(2,'0')}-${compact[3].padStart(2,'0')}`;
  const digits = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (digits) return `${digits[1]}-${digits[2]}-${digits[3]}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function hoursValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = clean(value).replace(/,/g,'');
  if (!text) return 0;
  const h = text.match(/(\d+(?:\.\d+)?)\s*(?:시간|시|h)/i);
  const m = text.match(/(\d+)\s*(?:분|m)/i);
  if (h || m) return Number(((Number(h?.[1] || 0) + Number(m?.[1] || 0) / 60)).toFixed(2));
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function classify(record) {
  const area = normalized(record.area);
  const text = `${record.area} ${record.desc}`.toLowerCase();
  if (/재난|재해|방역|소독|침수|폭우|수해|복구|감염병|산불|제설/.test(area)) return 1;
  if (/환경|생태|기후|자원순환/.test(area)) return 2;
  if (/문화|예술|행사|공연|축제/.test(area)) return 3;
  if (/이웃|생활편의|사회복지|복지|나눔/.test(area)) return 4;
  if (/재난|재해|방역|소독|침수|폭우|수해|구조|구급|복구|응급|감염병|산불|제설/.test(text)) return 1;
  if (/환경|정화|쓰레기|페트|분리배출|재활용|식목|생태|탄소|청소|하천|플로깅|해변/.test(text)) return 2;
  if (/문화|예술|공연|축제|행사|음악회|관광|전시|연주|무대|캠페인|홍보|체육|대회|축하/.test(text)) return 3;
  if (/급식|배식|반찬|도시락|돌봄|취약|장애|어르신|노인|아동|청소년|이웃|상담|세탁|목욕|말벗|나눔|배달/.test(text)) return 4;
  if (/안전|화재|소방|순찰/.test(text)) return 0;
  return 0;
}

const headerAliases = {
  area: ['활동분야','봉사분야','분야','활동영역','봉사영역'],
  date: ['봉사일자','활동일자','실적일자','봉사날짜','활동날짜','봉사일'],
  time: ['봉사시간','활동시간','인정시간','실적시간','시간(분)','봉사시간(분)'],
  desc: ['봉사내용','활동내용','실적내용','봉사활동내용','활동명','프로그램명','내용'],
  status: ['승인상태','승인여부','처리상태','상태']
};
function headerKey(value) { return normalized(value).replace(/봉사실적|자원봉사/g,''); }
function findHeader(rows) {
  let best = null;
  for (let rowIndex=0; rowIndex<Math.min(rows.length,35); rowIndex++) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const keys = row.map(headerKey);
    const match = {};
    for (const [key, aliases] of Object.entries(headerAliases)) {
      const aliasKeys = aliases.map(headerKey);
      match[key] = keys.findIndex(cell => cell && aliasKeys.some(alias => cell === alias || cell.includes(alias)));
    }
    const score = (match.desc >= 0 ? 4 : 0) + (match.date >= 0 ? 2 : 0) + (match.area >= 0 ? 1 : 0) + (match.time >= 0 ? 1 : 0) + (match.status >= 0 ? 1 : 0);
    if (score >= 4 && (!best || score > best.score)) best = {rowIndex, match, score};
  }
  return best;
}

function rowsToRecords(rows, sourceName) {
  const header = findHeader(rows);
  if (!header) return {rows:[], rejected:Math.max(rows.length,1), hasDescriptionColumn:false};
  const {rowIndex,match} = header;
  const imported = [];
  let rejected = 0;
  for (const row of rows.slice(rowIndex+1)) {
    if (!Array.isArray(row) || !row.some(value => clean(value))) continue;
    const desc = clean(row[match.desc]);
    if (!desc || /^(합계|총계|계)$/i.test(desc)) continue;
    const area = match.area >= 0 ? clean(row[match.area]) : '';
    const date = match.date >= 0 ? normalizeDate(row[match.date]) : '';
    const hours = match.time >= 0 ? hoursValue(row[match.time]) : 0;
    const status = match.status >= 0 ? clean(row[match.status]) : '';
    const approved = !status || ((/승인|완료|인정/.test(status)) && !/미승인|미인정|반려|취소|대기/.test(status));
    const record = {area,desc,date,hours,approved,included:approved,cat:0,source:sourceName||'',hasDate:Boolean(date)};
    record.cat = classify(record);
    imported.push(record);
  }
  return {rows:imported,rejected,hasDescriptionColumn:true};
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  const input = String(text).replace(/^\ufeff/,'');
  for (let i=0;i<input.length;i++) {
    const char = input[i];
    if (char === '"' && quoted && input[i+1] === '"') { value += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(value); value=''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i+1] === '\n') i++;
      row.push(value); rows.push(row); row=[]; value='';
    } else value += char;
  }
  row.push(value);
  if (row.some(cell => clean(cell)) || !rows.length) rows.push(row);
  return rows;
}

async function parseWorkbook(file) {
  if (file.name.toLowerCase().endsWith('.csv')) return rowsToRecords(parseCsv(await file.text()), file.name);
  if (!window.XLSX) throw new Error('번들된 엑셀 라이브러리를 불러오지 못했습니다. CSV로 저장해 올려주세요.');
  const workbook = XLSX.read(await file.arrayBuffer(), {type:'array',cellDates:true});
  const found = [];
  let rejected = 0, hasDescriptionColumn = false;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
    const parsed = rowsToRecords(rows,`${file.name} · ${sheetName}`);
    found.push(...parsed.rows); rejected += parsed.rejected; hasDescriptionColumn ||= parsed.hasDescriptionColumn;
  }
  return {rows:found,rejected,hasDescriptionColumn};
}

function recordKey(record, withDate=true) {
  const bits = [normalized(record.area),normalized(record.desc)];
  if (withDate) bits.push(record.date || '');
  return bits.join('|');
}
function mergeRecords(incoming) {
  let added=0,enriched=0,duplicates=0;
  for (const item of incoming) {
    const base = recordKey(item,false);
    const exact = recordKey(item,true);
    const same = records.filter(record => recordKey(record,false) === base);
    if (item.date) {
      if (records.some(record => recordKey(record,true) === exact)) { duplicates++; continue; }
      // If a date-free summary row for the same activity was imported first,
      // replace it with the dated original instead of counting it twice.
      const oldSummary = same.find(record => !record.date && record.importKind === 'summary');
      if (oldSummary) { records.splice(records.indexOf(oldSummary),1); enriched++; }
      else added++;
      item.importKind='detail'; records.push(item);
    } else {
      if (same.length) { duplicates++; continue; }
      item.importKind='summary'; records.push(item); added++;
    }
  }
  return {added,enriched,duplicates};
}

$('upload').addEventListener('change', async event => {
  const files = [...event.target.files];
  if (!files.length) return;
  let imported=0,enriched=0,duplicates=0,rejected=0,errors=[];
  for (const file of files) {
    try {
      const result = await parseWorkbook(file);
      rejected += result.rejected;
      const merged = mergeRecords(result.rows);
      imported += merged.added; enriched += merged.enriched; duplicates += merged.duplicates;
      if (!result.rows.length) errors.push(result.hasDescriptionColumn
        ? `${file.name}: 봉사내용 열은 있지만 가져올 실적 행이 없습니다.`
        : `${file.name}: 봉사내용 열이 없습니다. 활동분야·봉사내용이 있는 실적 엑셀을 선택해 주세요.`);
    } catch (error) { errors.push(`${file.name}: ${error.message}`); }
  }
  lastImport = {files:files.length,imported,enriched,duplicates,rejected};
  $('importSummary').textContent = `${files.length}개 파일 · 현재 ${records.length}건 · ${enriched}건 날짜·시간 보강 · ${duplicates}건 중복 제외`;
  renderRows(); renderReferences();
  if (errors.length) announce(errors.join(' / '), 'error');
  else announce(`${imported}건을 추가하고 요약 실적 ${enriched}건에 날짜·시간을 반영했습니다. 동일한 날짜·내용의 중복 실적 ${duplicates}건은 제외했습니다. 분야를 확인하고 초안을 작성하세요.`);
  event.target.value='';
});

function selected() { return records.filter(record => record.included); }
function periodRange() {
  const dates = selected().map(record => record.date).filter(Boolean).sort();
  return {start:dates[0]||'',end:dates.at(-1)||''};
}
function periodText() {
  const {start,end}=periodRange();
  if (!start || !end) return '실적 날짜 확인 필요';
  const a=new Date(`${start}T00:00:00`),b=new Date(`${end}T00:00:00`);
  let years=b.getFullYear()-a.getFullYear(),months=b.getMonth()-a.getMonth();
  if (b.getDate()<a.getDate()) months--;
  if (months<0) {years--;months+=12;}
  return `${years}년 ${months}개월 (${start.replaceAll('-','.')}~${end.replaceAll('-','.')} 활동)`;
}
function renderRows() {
  const visible=records.map((record,index)=>`<tr>
    <td><input type="checkbox" data-index="${index}" data-key="included" ${record.included?'checked':''} aria-label="${index+1}번 실적 포함"></td>
    <td>${esc(record.date||'날짜 없음')}</td><td>${esc(record.area||'미분류')}</td>
    <td><input type="text" data-index="${index}" data-key="desc" value="${esc(record.desc)}" aria-label="봉사내용 수정"></td>
    <td><input type="number" min="0" step="0.25" data-index="${index}" data-key="hours" value="${record.hours||''}" aria-label="봉사시간 수정"></td>
    <td><select data-index="${index}" data-key="cat" aria-label="분야 선택">${groups.map((group,cat)=>`<option value="${cat}" ${record.cat===cat?'selected':''}>${esc(group.title)}</option>`).join('')}</select></td>
    <td><button type="button" data-delete="${index}" aria-label="${index+1}번 실적 삭제">삭제</button></td>
  </tr>`).join('');
  $('rows').innerHTML=visible||'<tr><td colspan="7" class="empty-row">엑셀 또는 CSV 파일을 선택해 주세요.</td></tr>';
  const included=selected(),dates=periodRange();
  $('count').textContent=`${included.length}건`;
  $('hours').textContent=included.some(record=>record.hours>0)?`${included.reduce((sum,record)=>sum+Number(record.hours||0),0).toFixed(1)}시간`:'—';
  $('start').textContent=dates.start||'—'; $('end').textContent=dates.end||'—';
}
$('rows').addEventListener('change',event=>{
  const index=Number(event.target.dataset.index),key=event.target.dataset.key;
  if (!Number.isInteger(index)||!records[index]||!key) return;
  if (key==='included') records[index].included=event.target.checked;
  else if (key==='cat') records[index].cat=Number(event.target.value);
  else if (key==='hours') records[index].hours=hoursValue(event.target.value);
  else if (key==='desc') { records[index].desc=clean(event.target.value); records[index].cat=classify(records[index]); }
  renderRows(); renderReferences();
});
$('rows').addEventListener('click',event=>{
  const button=event.target.closest('[data-delete]'); if (!button) return;
  records.splice(Number(button.dataset.delete),1); renderRows(); renderReferences();
});
$('addRow').addEventListener('click',()=>{
  records.push({area:'',desc:'직접 입력 실적',date:'',hours:0,approved:true,included:true,cat:0,source:'직접 입력',hasDate:false,importKind:'manual'});
  renderRows();
  const input=$('rows').querySelector('tr:last-child input[type=text]'); input?.focus();
});
$('clearRows').addEventListener('click',()=>{
  if (!records.length) return;
  if (!confirm('가져오거나 직접 입력한 실적을 모두 지울까요?')) return;
  records=[]; renderRows(); renderReferences(); $('importSummary').textContent=''; announce('실적 목록을 비웠습니다.');
});

function renderGroups() {
  $('groups').innerHTML=groups.map((group,index)=>`<article class="group">
    <div class="group-head"><span class="group-index">${index+1}</span><input data-group="${index}" data-key="title" value="${esc(group.title)}" aria-label="${index+1}분야 제목"></div>
    <div class="field"><label>주요 공적사항</label><textarea data-group="${index}" data-key="detail" rows="4" placeholder="실적을 확인한 뒤 문장을 작성하세요.">${esc(group.detail)}</textarea></div>
    <div class="field"><label>공적개요서 한 줄 요약</label><textarea data-group="${index}" data-key="short" rows="2" placeholder="이 분야의 핵심 실적을 짧게 요약">${esc(group.short)}</textarea></div>
    <div class="reference" id="reference${index}"></div>
  </article>`).join('');
  renderReferences();
}
function renderReferences() {
  groups.forEach((group,index)=>{
    const rows=selected().filter(record=>record.cat===index);
    const examples=[...new Set(rows.map(record=>clean(record.desc)).filter(Boolean))].slice(0,8);
    const element=$(`reference${index}`);
    if (element) element.textContent=`실적 ${rows.length}건${examples.length?` · ${examples.join(' / ')}`:' · 해당 분야 실적 없음'}`;
  });
}
$('groups').addEventListener('input',event=>{
  const index=Number(event.target.dataset.group),key=event.target.dataset.key;
  if (!Number.isInteger(index)||!groups[index]||!key) return;
  groups[index][key]=event.target.value;
  if (key==='title') renderRows();
});
$('regroup').addEventListener('click',()=>{
  records.forEach(record=>record.cat=classify(record)); renderRows(); renderReferences();
  announce('활동내용의 단어를 바탕으로 분야를 다시 제안했습니다. 분야별 실적을 꼭 확인하세요.');
});

function draftText() {
  const included=selected();
  if (!included.length) { announce('먼저 봉사실적을 가져오거나 직접 입력해 주세요.','error'); return; }
  groups.forEach((group,index)=>{
    const rows=included.filter(record=>record.cat===index);
    const descriptions=[...new Set(rows.map(record=>clean(record.desc)).filter(Boolean))];
    if (!rows.length) {
      group.detail=''; group.short=''; return;
    }
    const examples=descriptions.slice(0,4).join('·');
    group.detail=`${group.title} 분야 봉사활동 ${rows.length}건에 참여함${examples?` (예: ${examples})`:''}.`;
    group.short=descriptions.length>1?`${descriptions.slice(0,2).join('·')} 등 ${rows.length}건`: `${descriptions[0]} 활동 ${rows.length}건`;
  });
  renderGroups();
  const active=groups.filter((group,index)=>included.some(record=>record.cat===index)).map(group=>group.title);
  $('gist').value=`${active.slice(0,3).join('·')||'자원봉사'} 분야에서 꾸준히 활동하여 지역사회 발전에 기여함.`.slice(0,50);
  $('intro').value=`상기인은 ${active.join(', ')} 분야의 자원봉사활동에 참여하여 지역사회 발전과 자원봉사 활성화에 기여함.`;
  updateCharacterCount();
  announce('실적에 적힌 내용을 바탕으로 초안을 만들었습니다. 활동 횟수와 문구를 원자료·증빙과 대조해 수정하세요.');
}
$('draft').addEventListener('click',draftText);
$('gist').addEventListener('input',updateCharacterCount);
function updateCharacterCount() {
  const count=val('gist').length,element=$('characters');
  element.textContent=`${count} / 50자`; element.classList.toggle('over',count>50);
}

$('stampFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0]; if (!file) return;
  if (!['image/png','image/jpeg'].includes(file.type)) { announceExport('PNG 또는 JPG 도장 이미지를 선택해 주세요.','error'); event.target.value=''; return; }
  if (file.size>8*1024*1024) { announceExport('도장 이미지는 8MB 이하로 선택해 주세요.','error'); event.target.value=''; return; }
  stamp={name:file.name,type:file.type,dataUrl:await readDataUrl(file)};
  $('stampImage').src=stamp.dataUrl; $('stampName').textContent=file.name; $('stampPreview').hidden=false;
  announceExport('도장 이미지를 선택했습니다. 추천관과 조사자 자리의 도장 크기를 각각 조절할 수 있습니다.');
  event.target.value='';
});
function readDataUrl(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);}); }
$('removeStamp').addEventListener('click',()=>{stamp=null;$('stampPreview').hidden=true;$('stampImage').removeAttribute('src');announceExport('도장 이미지를 지웠습니다.');});
for (const id of ['recommenderStampSize','investigatorStampSize']) $(id).addEventListener('input',updateStampSizeLabels);
function updateStampSizeLabels() {
  $('recommenderStampValue').textContent=`${$('recommenderStampSize').value} mm`;
  $('investigatorStampValue').textContent=`${$('investigatorStampSize').value} mm`;
}

function stampMarkup(kind) {
  if (!stamp) return '<span class="no-stamp">(인)</span>';
  const size=Number($(kind==='recommender'?'recommenderStampSize':'investigatorStampSize').value);
  return `<span class="seal"><span>(인)</span><img src="${stamp.dataUrl}" alt="도장" style="width:${size}mm;height:${size}mm"></span>`;
}
function documentModel() {
  const active=groups.map((group,index)=>({...group,index,rows:selected().filter(record=>record.cat===index)}));
  const date=val('docDate')||todayLocal();
  return {
    year:val('year'),event:val('event'),name:val('name')||'추천 대상자',hanja:val('hanja'),birth:val('birth'),gender:val('gender'),org:val('org'),job:val('job'),rank:val('rank'),position:val('position'),address:val('address'),phone:val('phone'),award:val('award'),order:val('order'),investigator:val('investigator'),investigatorOrg:val('investigatorOrg')||val('org'),investigatorRank:val('investigatorRank'),recommender:val('recommender')||val('org'),docDate:date,career:val('career'),history:val('history'),gist:val('gist'),intro:val('intro'),character:val('character'),reputation:val('reputation'),matching:val('matching'),period:periodText(),groups:active
  };
}
function previewPages() {
  const d=documentModel();
  const infoRows=[['성명',d.name,'한자',d.hanja],['생년월일',d.birth,'성별',d.gender],['주소',d.address,'소속',d.org],['직급·직책',d.rank,'추천 훈격',d.award],['공적기간',d.period,'추천 순위',d.order]];
  const table=rows=>`<table>${rows.map(row=>`<tr>${row.map((value,index)=>`<td class="${index%2===0?'doc-label':''}">${esc(value)}</td>`).join('')}</tr>`).join('')}</table>`;
  const page1=`<h3>공 적 조 서</h3><p class="center">${esc(d.year)}년 ${esc(d.event)}</p>${table(infoRows)}<div class="doc-section"><strong>공적요지 (50자 내외)</strong><div class="doc-block">${esc(d.gist||'입력 필요')}</div></div><p class="doc-foot">위 기록이 틀림없음을 확인합니다.<br>${esc(d.docDate)}<br><br>추천관 ${esc(d.recommender)} ${stampMarkup('recommender')}</p>`;
  const page2=`<h3>주요 학력 및 경력</h3>${table([['경력',d.career||'확인된 경력만 입력'],['과거 표창기록',d.history||'확인된 기록만 입력']])}<h3>공 적 사 항</h3><p class="doc-block">${esc(d.intro||'입력 필요')}</p>${d.groups.slice(0,3).map(g=>`<div class="doc-section"><strong>○ ${esc(g.title)}</strong><div class="doc-block">${esc(g.detail||'내용 확인 필요')}</div></div>`).join('')}`;
  const page3=`<h3>공 적 사 항 (계속)</h3>${d.groups.slice(3).map(g=>`<div class="doc-section"><strong>○ ${esc(g.title)}</strong><div class="doc-block">${esc(g.detail||'내용 확인 필요')}</div></div>`).join('')}`;
  const page4=`<h3>공 적 개 요 서</h3>${table([['소속',d.org,'직급',d.rank],['성명',d.name,'공적기간',d.period]])}<div class="doc-section"><strong>공적 개요</strong>${d.groups.map(g=>`<div class="doc-section"><strong>○ ${esc(g.title)}</strong><div class="doc-block">${esc(g.short||'해당 실적 없음 · 내용 확인 필요')}</div></div>`).join('')}</div>`;
  const page5=`<h3>현 지 조 사 확 인 서</h3><h4>1. 인적사항</h4>${table([['소속',d.org,'직위(직급)',d.rank],['성명',d.name,'생년월일(성별)',`${d.birth} (${d.gender})`]])}<h4>2. 현지조사 확인내용</h4><div class="doc-section"><strong>품성 (도덕성 흠결 여부 등)</strong><div class="doc-block">${esc(d.character||'현지조사 후 확인 필요')}</div></div><div class="doc-section"><strong>지역여론 (공·사생활 등)</strong><div class="doc-block">${esc(d.reputation||'현지조사 후 확인 필요')}</div></div><div class="doc-section"><strong>공적사항 (공적내용과 일치 여부)</strong><div class="doc-block">${esc(d.matching||'검증 후 작성')}</div></div><p class="doc-foot">${esc(d.docDate)}<br><br>현지조사자<br>소속: ${esc(d.investigatorOrg)}<br>직위: ${esc(d.investigatorRank)}　성명: ${esc(d.investigator)} ${stampMarkup('investigator')}</p>`;
  return [page1,page2,page3,page4,page5];
}
$('previewBtn').addEventListener('click',()=>{
  $('documentPreview').innerHTML=previewPages().map((html,index)=>`<article class="doc-page" aria-label="${index+1}쪽">${html}</article>`).join('');
  $('documentPreview').hidden=false; $('documentPreview').scrollIntoView({behavior:'smooth',block:'start'});
});

// HWPX is an OWPML ZIP package. All text and stamp bytes are assembled in
// memory; the volunteer workbook itself is never uploaded to a service.
const HWP_NS = {
  hs:'http://www.hancom.co.kr/hwpml/2011/section',
  hp:'http://www.hancom.co.kr/hwpml/2011/paragraph',
  hh:'http://www.hancom.co.kr/hwpml/2011/head',
  hc:'http://www.hancom.co.kr/hwpml/2011/core',
  opf:'http://www.idpf.org/2007/opf'
};
function xmlText(text) { return esc(text).replace(/\u00a0/g,'&#160;'); }
function hwpxParagraph(text, options={}) {
  const id=options.id||0, pageBreak=options.pageBreak?1:0, charId=options.charId||0;
  const content=typeof text==='string'?`<hp:t xml:space="preserve">${xmlText(text)}</hp:t>`:text;
  return `<hp:p id="${id}" paraPrIDRef="0" styleIDRef="0" pageBreak="${pageBreak}" columnBreak="0" merged="0"><hp:run charPrIDRef="${charId}">${content}</hp:run></hp:p>`;
}
function hwpxImage(id, widthMm) {
  const width=Math.round(Number(widthMm)*283.46), height=width;
  return `<hp:pic id="${id+100}" zOrder="${id}" numberingType="PICTURE" textWrap="SQUARE" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id+100}"><hp:offset x="0" y="0"/><hp:orgSz width="${width}" height="${height}"/><hp:curSz width="${width}" height="${height}"/><hp:flip horizontal="0" vertical="0"/><hp:rotationInfo angle="0" centerX="${Math.floor(width/2)}" centerY="${Math.floor(height/2)}" rotateimage="1"/><hp:renderingInfo><hp:transMatrix e1="1" e2="0" e3="0" e4="1" e5="0" e6="0"/><hp:scaMatrix e1="1" e2="0" e3="0" e4="1" e5="0" e6="0"/><hp:rotMatrix e1="1" e2="0" e3="0" e4="1" e5="0" e6="0"/></hp:renderingInfo><hp:img binaryItemIDRef="stampImage" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:imgDim dimwidth="${width}" dimheight="${height}" dimorient="1"/><hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/><hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="CENTER" horzAlign="LEFT" vertOffset="0" horzOffset="0"/><hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>도장</hp:shapeComment></hp:pic>`;
}
function withStamp(text, kind, id) {
  if (!stamp) return hwpxParagraph(text,{id});
  const size=Number($(kind==='recommender'?'recommenderStampSize':'investigatorStampSize').value);
  const marker=`<hp:t xml:space="preserve">${xmlText(text)} (인) </hp:t>${hwpxImage(id,size)}`;
  return hwpxParagraph(marker,{id});
}
function pageSection(lines, startId, pageBreak=false) {
  return lines.map((line,index)=>{
    const item=typeof line==='string'?{text:line}:line;
    return item.stamp?withStamp(item.text,item.stamp,startId+index):hwpxParagraph(item.text,{id:startId+index,pageBreak:pageBreak&&index===0,charId:item.heading?1:0});
  }).join('');
}
function createHwpxXml(model) {
  const p1=[
    {text:'공 적 조 서',heading:true},`${model.year}년 ${model.event}`,'',
    `성명: ${model.name}    한자: ${model.hanja}`,`생년월일: ${model.birth}    성별: ${model.gender}`,`주소: ${model.address}`,`소속: ${model.org}    직급·직책: ${model.rank}`,
    `추천 훈격: ${model.award}    추천 순위: ${model.order}`,`공적기간: ${model.period}`,'','공적요지 (50자 내외)',model.gist||'입력 필요','',
    `주요 경력: ${model.career||'미입력'}`,`과거 표창기록: ${model.history||'미입력'}`,'','위 기록이 틀림없음을 확인합니다.',model.docDate,
    {text:`추천관 ${model.recommender}`,stamp:'recommender'}
  ];
  const p2=[{text:'주 요 공 적 사 항',heading:true},model.intro||'상기인은 공적사항을 입력해 주세요.','주요 경력',model.career||'미입력','과거 표창기록',model.history||'미입력',...model.groups.flatMap(group=>[`○ ${group.title}`,group.detail||'해당 실적 없음 · 내용 확인 필요'])];
  const p3=[{text:'공 적 개 요 서',heading:true},`소속: ${model.org}    직급·직책: ${model.rank}`,`성명: ${model.name}    공적기간: ${model.period}`,'공적 개요',...model.groups.flatMap(group=>[`○ ${group.title}`,group.short||'해당 실적 없음 · 내용 확인 필요'])];
  const p4=[{text:'현 지 조 사 확 인 서',heading:true},'1. 인적사항',`소속: ${model.org}    직위(직급): ${model.rank}`,`성명: ${model.name}    생년월일(성별): ${model.birth} (${model.gender})`,'2. 현지조사 확인내용','품성 (도덕성 흠결 여부 등)',model.character||'현지조사 후 확인 필요','지역여론 (공·사생활 등)',model.reputation||'현지조사 후 확인 필요','공적사항 (공적내용과 일치 여부)',model.matching||'검증 후 작성','',model.docDate,`현지조사자  소속: ${model.org}  직위: ${model.investigatorRank}`,{text:`성명: ${model.investigator}`,stamp:'investigator'}];
  const sections=[pageSection(p1,0),pageSection(p2,100,true),pageSection(p3,200,true),pageSection(p4,300,true)].join('');
  const sectionXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:sec xmlns:hs="${HWP_NS.hs}" xmlns:hp="${HWP_NS.hp}" xmlns:hc="${HWP_NS.hc}" xmlns:hh="${HWP_NS.hh}" version="1.2">${sections}</hs:sec>`;
  const stampPath=stamp?.type==='image/jpeg'?'stamp.jpg':'stamp.png';
  const stampMedia=stamp?.type==='image/jpeg'?'image/jpeg':'image/png';
  const stampItem=stamp?`<hh:binDataList itemCnt="1"><hh:binItem binDataID="stampImage" href="BinData/${stampPath}" type="embedding" compress="false"/></hh:binDataList>`:'<hh:binDataList itemCnt="0"/>';
  const headerXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hh:head xmlns:hh="${HWP_NS.hh}" xmlns:hc="${HWP_NS.hc}" xmlns:hp="${HWP_NS.hp}" version="1.4" secCnt="1"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces itemCnt="1"><hh:fontface lang="Korean" fontCnt="1"><hh:font id="0" face="함초롬바탕" type="TTF" isEmbedded="0"/></hh:fontface></hh:fontfaces><hh:charProperties itemCnt="2"><hh:charPr id="0" height="1000" textColor="#000000" shadeColor="#FFFFFF" useFontSpace="0" useKerning="0"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/></hh:charPr><hh:charPr id="1" height="1600" textColor="#000000" shadeColor="#FFFFFF" useFontSpace="0" useKerning="0"><hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/><hh:bold/></hh:charPr></hh:charProperties><hh:paraProperties itemCnt="1"><hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0"><hh:align horizontal="LEFT" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/><hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/></hh:paraPr></hh:paraProperties><hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="Normal" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>${stampItem}</hh:refList></hh:head>`;
  const packageXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><opf:package xmlns:opf="${HWP_NS.opf}" version="3.0" unique-identifier="doc-id"><opf:metadata><opf:identifier id="doc-id">volunteer-merit-${Date.now()}</opf:identifier><opf:title>${xmlText(model.year)}년 자원봉사 공적조서</opf:title><opf:language>ko-KR</opf:language></opf:metadata><opf:manifest><opf:item id="header" href="header.xml" media-type="application/xml"/><opf:item id="section0" href="section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/>${stamp?`<opf:item id="stampImage" href="../BinData/${stampPath}" media-type="${stampMedia}"/>`:''}</opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>`;
  const container=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></rootfiles></container>`;
  const manifest=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/hwp+zip"/><manifest:file-entry manifest:full-path="Contents/content.hpf" manifest:media-type="application/hwpml-package+xml"/><manifest:file-entry manifest:full-path="Contents/header.xml" manifest:media-type="application/xml"/><manifest:file-entry manifest:full-path="Contents/section0.xml" manifest:media-type="application/xml"/><manifest:file-entry manifest:full-path="Contents/settings.xml" manifest:media-type="application/xml"/>${stamp?`<manifest:file-entry manifest:full-path="BinData/${stampPath}" manifest:media-type="${stampMedia}"/>`:''}</manifest:manifest>`;
  const version=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hv:version xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version" major="5" minor="0" micro="3" buildNumber="0" os="1" xmlVersion="1.5" application="Volunteer Merit Studio" appVersion="1.0"/>`;
  const settings=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hs:settings xmlns:hs="http://www.hancom.co.kr/hwpml/2011/settings"/>`;
  return {sectionXml,headerXml,packageXml,container,manifest,version,settings};
}
function stampBytes() {
  if (!stamp) return null;
  const base64=stamp.dataUrl.split(',')[1]||'';
  const binary=atob(base64),bytes=new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return bytes;
}
function patchHwpxZip(bytes) {
  const data=bytes.slice(),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const signature=(offset,value)=>offset+4<=data.length&&view.getUint32(offset,true)===value;
  let offset=0;
  while (signature(offset,0x04034b50)) {
    view.setUint16(offset+4,20,true);
    const nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),compressedSize=view.getUint32(offset+18,true);
    offset+=30+nameLength+extraLength+compressedSize;
  }
  while (signature(offset,0x02014b50)) {
    view.setUint16(offset+4,(11<<8)|23,true);
    view.setUint16(offset+6,20,true);
    view.setUint32(offset+38,0x81800020,true);
    const nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true);
    offset+=46+nameLength+extraLength+commentLength;
  }
  return data;
}
function safeFilename(text) { return String(text||'대상자').replace(/[\\/:*?"<>|]/g,'_').trim()||'대상자'; }
async function exportHwpx() {
  const button=$('downloadHwpx');
  if (!selected().some(record=>clean(record.desc))) { announceExport('한글 문서를 만들기 전에 봉사내용이 있는 실적을 한 건 이상 추가해 주세요.','error'); return; }
  if (!val('name')) { announceExport('추천 대상자 성명을 입력해 주세요.','error'); $('name').focus(); return; }
  button.disabled=true; button.textContent='한글 문서 만드는 중…';
  try {
    const model=documentModel();
    let blob, usedNativeTemplate=false;
    if (['localhost','127.0.0.1'].includes(location.hostname)) {
      try {
        const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
        if(!response.ok) throw new Error(`내보내기 서버 오류 (${response.status})`);
        blob=await response.blob();
        usedNativeTemplate=true;
      } catch (error) {
        console.warn('로컬 한글 자동화에 실패해 브라우저에서 HWPX 초안을 만듭니다.',error);
      }
    }
    if (!blob) {
      const xml=createHwpxXml(model);
      const zip=new JSZip();
      zip.file('mimetype','application/hwp+zip',{compression:'STORE',createFolders:false});
      zip.file('version.xml',xml.version,{createFolders:false});
      zip.file('META-INF/container.xml',xml.container,{createFolders:false});
      zip.file('META-INF/manifest.xml',xml.manifest,{createFolders:false});
      zip.file('Contents/content.hpf',xml.packageXml,{createFolders:false});
      zip.file('Contents/header.xml',xml.headerXml,{createFolders:false});
      zip.file('Contents/section0.xml',xml.sectionXml,{createFolders:false});
      zip.file('Contents/settings.xml',xml.settings,{createFolders:false});
      const image=stampBytes();
      if (image) zip.file(`BinData/${stamp.type==='image/jpeg'?'stamp.jpg':'stamp.png'}`,image,{createFolders:false});
      const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
      blob=new Blob([patchHwpxZip(bytes)],{type:'application/haansofthwpx'});
    }
    const filename=`${safeFilename(model.year)}_공적조서_${safeFilename(model.name)}.hwpx`;
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
    announceExport(usedNativeTemplate?`${filename}을 한글 양식으로 저장했습니다. 도장, 빈 항목, 쪽 나눔을 확인해 주세요.`:`${filename}을 이 기기의 브라우저에서 만들었습니다. 한글에서 양식, 도장, 쪽 나눔을 확인해 주세요.`);
  } catch (error) {
    console.error(error); announceExport(`HWPX를 만들지 못했습니다: ${error.message||error}`,'error');
  } finally { button.disabled=false;button.textContent='한글 문서 (.hwpx) 저장'; }
}
$('downloadHwpx').addEventListener('click',exportHwpx);

function projectData() {
  return {format:'volunteer-merit-studio',version:2,fields:Object.fromEntries(fieldIds.map(id=>[id,$(id).value])),records,groups,stamp,stampSizes:{recommender:$('recommenderStampSize').value,investigator:$('investigatorStampSize').value}};
}
function saveProject() {
  const content=JSON.stringify(projectData(),null,2);
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));link.download=`${safeFilename(val('year'))}_공적조서_${safeFilename(val('name'))}_작업.json`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
}
$('saveProject').addEventListener('click',saveProject);
$('jsonFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try {
    const data=JSON.parse(await file.text());
    const groupsToLoad=Array.isArray(data.groups)?data.groups:data.groupData;
    const supported=data.fields&&Array.isArray(data.records)&&Array.isArray(groupsToLoad)&&((data.format==='volunteer-merit-studio')||data.version===1);
    if (!supported) throw new Error('이 앱에서 저장한 작업파일이 아닙니다.');
    if (!confirm('현재 화면의 자료를 불러온 작업파일로 바꿀까요?')) return;
    fieldIds.forEach(id=>{if($(id))$(id).value=data.fields[id]??'';});
    const legacyGroups=groupsToLoad.length<5;
    records=data.records.map(record=>{
      const oldCategory=Math.max(0,Math.min(legacyGroups?3:4,Number(record.cat)||0));
      return {...record,cat:legacyGroups&&oldCategory===3?4:oldCategory};
    });
    groups=defaultCategories.map((title,index)=>{
      const sourceIndex=legacyGroups?(index===4?3:index===3?-1:index):index;
      return {...{title,detail:'',short:''},...(sourceIndex>=0?groupsToLoad[sourceIndex]||{}:{}),title};
    });
    stamp=data.stamp||null;
    if(stamp){$('stampImage').src=stamp.dataUrl;$('stampName').textContent=stamp.name||'도장 이미지';$('stampPreview').hidden=false;}else{$('stampPreview').hidden=true;}
    $('recommenderStampSize').value=data.stampSizes?.recommender||22;$('investigatorStampSize').value=data.stampSizes?.investigator||22;
    updateStampSizeLabels();renderGroups();renderRows();updateCharacterCount();announce('작업파일을 불러왔습니다.');
  } catch(error) {announce(`작업파일을 읽지 못했습니다: ${error.message}`,'error');}
  finally {event.target.value='';}
});

$('exportCSV').addEventListener('click',()=>{
  const rows=[['활동분야','봉사일자','봉사시간(시간)','봉사내용','분류']].concat(selected().map(record=>[record.area,record.date,record.hours||'',record.desc,groups[record.cat]?.title||'']));
  const csv=rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));link.download=`${safeFilename(val('year'))}_추린봉사실적_${safeFilename(val('name'))}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
});

window.addEventListener('error',event=>{if (event.message?.includes('XLSX')) announce('엑셀 라이브러리를 불러오지 못했습니다. CSV 파일로 저장해 올리거나 인터넷 연결을 확인하세요.','error');});
