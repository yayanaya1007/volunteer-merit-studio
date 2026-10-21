const $ = (id) => document.getElementById(id);
const fieldIds = ['year','event','name','hanja','birth','gender','serviceNo','nationality','org','job','rank','position','meritField','address','phone','award','order','investigator','investigatorOrg','investigatorRank','recommender','docDate','education','career','history','gist','intro','character','reputation','matching'];
const MAX_GROUPS = 5;
let records = [];
let groups = []; // 분야는 미리 채우지 않고 업로드된 봉사실적에서 도출한다.
let stamp = null;
let timeAuthFile = null;
let lastAutoName = '';
let lastImport = {files:0, imported:0, duplicates:0, rejected:0};
let personalAPIKey = '';

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
const isLocalAI = ['127.0.0.1','localhost'].includes(location.hostname);
const publicAIUrl = String(window.MERIT_API_URL || '').replace(/\/$/, '');
const nativeDocumentApiUrl = 'http://127.0.0.1:8769';
if (isLocalAI) {
  $('aiMode').closest('.ai-access-row').hidden = true;
  $('sharedAIControls').hidden = true;
  $('personalAIControls').hidden = true;
  $('personalAIPrivacy').hidden = true;
  $('personalAIHelp').hidden = true;
  $('aiConnectionStatus').textContent = '이 PC의 로컬 AI 서버를 사용합니다.';
} else if (!publicAIUrl) {
  $('aiConnectionStatus').textContent = '공개 AI 서버가 아직 연결되지 않았습니다.';
}
if (sessionStorage.getItem('merit-ai-access-code')) {
  $('aiConnectionStatus').textContent = '이 기기에서 연결됨';
}
$('aiMode').addEventListener('change', () => {
  const usePersonalKey = $('aiMode').value === 'personal';
  $('sharedAIControls').hidden = usePersonalKey;
  $('personalAIControls').hidden = !usePersonalKey;
  $('personalAIPrivacy').hidden = !usePersonalKey;
  if (usePersonalKey) $('personalAPIKeyInput').focus();
});
$('usePersonalAPIKey').addEventListener('click', () => {
  const candidate = $('personalAPIKeyInput').value.trim();
  if (!candidate) { $('personalAIStatus').textContent = '복사한 API 키를 먼저 붙여 넣어 주세요.'; $('personalAPIKeyInput').focus(); return; }
  if (!/^sk-[A-Za-z0-9_-]{16,500}$/.test(candidate)) { $('personalAIStatus').textContent = '키 형식을 확인해 주세요. OpenAI API 키를 다시 복사해 붙여 넣어 주세요.'; return; }
  personalAPIKey = candidate;
  $('personalAPIKeyInput').value = '';
  $('personalAIStatus').textContent = '사용 준비됨 · 이 탭에만 임시 보관 중';
  $('clearPersonalAPIKey').hidden = false;
});
$('clearPersonalAPIKey').addEventListener('click', () => {
  personalAPIKey = '';
  $('personalAPIKeyInput').value = '';
  $('personalAIStatus').textContent = '키를 지웠습니다. 다시 사용하려면 키를 입력해 주세요.';
  $('clearPersonalAPIKey').hidden = true;
});
$('connectAI').addEventListener('click', async () => {
  if (!publicAIUrl) { $('aiConnectionStatus').textContent = '서버 배포가 끝나면 연결할 수 있습니다.'; return; }
  const code = clean($('aiAccessCode').value);
  if (!code) { $('aiConnectionStatus').textContent = '접근 코드를 입력해 주세요.'; return; }
  $('connectAI').disabled = true;
  $('aiConnectionStatus').textContent = '코드를 확인하고 있습니다…';
  try {
    const response = await fetch(`${publicAIUrl}/api/authorize`, { method:'POST', headers:{'Authorization':`Bearer ${code}`} });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '접근 코드를 확인하지 못했습니다.');
    sessionStorage.setItem('merit-ai-access-code', code);
    $('aiAccessCode').value = '';
    $('aiConnectionStatus').textContent = '이 기기에서 연결됨';
  } catch (error) {
    sessionStorage.removeItem('merit-ai-access-code');
    $('aiConnectionStatus').textContent = error.message || '서버에 연결하지 못했습니다.';
  } finally { $('connectAI').disabled = false; }
});
$('chooseRecords').addEventListener('click',()=> $('timeAuthUpload').click());

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

// 내부 분석 단서는 여러 활동 유형을 포괄하지만, 화면에 고정된 분야는 없다.
// 제목은 각 봉사자의 엑셀에 실제로 기재된 '활동분야'와 '봉사내용'에서 도출한다.
const themeCues = [
  {key:'environment',words:['환경','정화','청소','쓰레기','분리배출','재활용','플로깅','하천','산림','생태','자원순환']},
  {key:'arts',words:['공연','위안공연','연주','합창','음악회','예술','문화','축제','전시','무대']},
  {key:'disaster',words:['재난','재해','수해','복구','침수','폭우','산불','제설','방역','소독','감염병']},
  {key:'care',words:['어르신','노인','장애','돌봄','말벗','요양','취약','아동','청소년','독거']},
  {key:'meal',words:['급식','배식','반찬','도시락','식사','떡국','빵나눔','김장','무료급식']},
  {key:'safety',words:['안전','소방','화재','순찰','교통','예방','응급','구조','구급']},
  {key:'education',words:['교육','학습','멘토','지도','강의','교실','독서','도서관']},
  {key:'donation',words:['기부','나눔','후원','물품','전달','카네이션','기증','성금']},
  {key:'event',words:['행사','안내','운영','캠페인','홍보','접수','축하','대회','체육']},
  {key:'rural',words:['농촌','농가','일손','수확','모내기','농작업']},
  {key:'medical',words:['헌혈','보건','의료','건강','병원','검진']},
  {key:'animal',words:['동물','유기견','유기묘','보호소','반려동물']}
];
function themeKey(record) {
  const area=clean(record.area).toLowerCase(),desc=clean(record.desc).toLowerCase();
  let best='',score=0;
  for(const theme of themeCues) {
    const areaHits=theme.words.filter(word=>area.includes(word)).length;
    const descHits=theme.words.filter(word=>desc.includes(word)).length;
    const value=areaHits*3+descHits;
    if(value>score){score=value;best=theme.key;}
  }
  return best||('activity:'+normalized(record.area||record.desc).slice(0,16));
}
function titleForRows(rows) {
  const areas=new Map();
  for(const row of rows){
    const name=clean(row.area).replace(/^(봉사활동|활동분야)\s*[:：]?\s*/,'');
    if(name && name.length<=30 && !/^(기타|자원봉사|일반|활동|봉사)$/.test(name)) areas.set(name,(areas.get(name)||0)+1);
  }
  const ranked=[...areas].sort((a,b)=>b[1]-a[1]);
  if(ranked.length && ranked[0][1]>=Math.max(1,Math.ceil(rows.length*0.45))) return ranked[0][0];
  if(ranked.length>1) return ranked.slice(0,2).map(([name])=>name).join('·').slice(0,36);
  if(ranked.length) return ranked[0][0];
  const desc=clean(rows.find(row=>clean(row.desc))?.desc||'');
  return desc.replace(/\([^)]*\)/g,'').replace(/^(?:\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\s*)/,'').slice(0,28)||'봉사활동';
}
function autoGroupRecords() {
  const buckets=new Map();
  for(const record of records.filter(row=>row.included)) {
    const key=themeKey(record);
    if(!buckets.has(key)) buckets.set(key,[]);
    buckets.get(key).push(record);
  }
  const sorted=[...buckets].sort((a,b)=>b[1].length-a[1].length);
  const picked=sorted.length<=MAX_GROUPS?sorted:sorted.slice(0,MAX_GROUPS-1).concat([['combined',sorted.slice(MAX_GROUPS-1).flatMap(([,items])=>items)]]);
  groups=picked.map(([key,items])=>({key,title:key==='combined' ? sorted.slice(MAX_GROUPS-1).slice(0,2).map(([,rows])=>titleForRows(rows)).join('·').slice(0,34)+' 등' : titleForRows(items),detail:'',short:''}));
  const keys=new Map();
  picked.forEach(([key,items],index)=>items.forEach(item=>keys.set(item,index)));
  records.forEach(record=>{record.cat=keys.get(record)??Math.max(0,groups.findIndex(group=>group.key===themeKey(record)));});
  return groups;
}
function classify(record) {
  const index=groups.findIndex(group=>group.key===themeKey(record));
  return index<0?0:index;
}

const headerAliases = {
  area: ['활동분야','봉사분야','분야','활동영역','봉사영역'],
  date: ['봉사일자','활동일자','실적일자','봉사날짜','활동날짜','봉사일','활동일시','봉사일시','봉사활동일자','봉사시작일','활동일','활동기간'],
  time: ['봉사시간','활동시간','인정시간','실적시간','시간(분)','봉사시간(분)','인증시간','인정봉사시간','총봉사시간','활동시간(분)'],
  desc: ['봉사내용','활동내용','실적내용','봉사활동내용','활동명','프로그램명','내용','봉사활동명','실적명'],
  status: ['승인상태','승인여부','처리상태','상태','인증상태','실적상태']
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
    const rawTime=match.time >= 0 ? row[match.time] : '';
    const timeHeader=match.time >= 0 ? clean(rows[rowIndex]?.[match.time]) : '';
    const timeIsMinutes=/(?:\(분\)|분$)/.test(timeHeader);
    const isPlainNumber=typeof rawTime==='number'||/^\d+(?:\.\d+)?$/.test(clean(rawTime));
    const hours=match.time>=0 ? (timeIsMinutes&&isPlainNumber ? Number(rawTime)/60 : hoursValue(rawTime)) : 0;
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

// 원본 파일의 명시적인 인적사항만 추출한다. 활동기관명 등은 소속으로 추정하지 않는다.
const personalFieldLabels={
  name:['성명','봉사자명','회원명','이름'],
  birth:['생년월일','생일','출생일'],
  gender:['성별'],
  org:['소속단체','소속기관','소속'],
  address:['주소','거주지'],
  phone:['휴대전화','휴대폰번호','휴대폰','연락처','전화번호'],
  job:['직업'],
  rank:['직급'],
  position:['직위']
};
function extractPersonalFields(rows){
  const found={};
  const identify=label=>{
    const key=normalized(label).replace(/[:：]/g,'');
    return Object.entries(personalFieldLabels).find(([,aliases])=>aliases.some(alias=>normalized(alias)===key))?.[0];
  };
  for(const row of rows.slice(0,45)){
    if(!Array.isArray(row))continue;
    for(let i=0;i<row.length;i++){
      const cell=clean(row[i]);
      const inline=cell.match(/^([^:：]{1,12})[:：]\s*(.+)$/);
      if(inline){const field=identify(inline[1]);if(field&&!found[field])found[field]=clean(inline[2]);}
      const field=identify(cell);
      if(field&&!found[field]){
        const next=clean(row[i+1]);
        if(next&&!identify(next))found[field]=next;
      }
    }
  }
  return found;
}
function nameFromWorkbookFilename(filename){
  // iOS 공유파일은 TalkFile_ 접두사와 분해된 한글 자모(NFD)가 함께 올 수 있다.
  const basename=String(filename||'').normalize('NFC').split(/[\\/]/).pop()
    .replace(/\.(?:xlsx|xls|csv)$/i,'').replace(/^(?:TalkFile[_\-\s]+)+/i,'').trim();
  const numbered=basename.match(/(?:^|[_\-\s])([가-힣]{2,5})\s*\(\s*\d{4,}\s*\)/);
  if(numbered)return numbered[1];
  const leading=basename.match(/^([가-힣]{2,5})(?=\s*\(|[_\-\s]|$)/);
  return leading?.[1]||'';
}
function applyPersonalFields(info){
  let filled=0;
  for(const [id,raw] of Object.entries(info||{})){
    const input=$(id);if(!input||!raw||id==='hanja')continue;
    let value=clean(raw);
    if(id==='gender'){if(/^(여|여성|여자)$/.test(value))value='여';else if(/^(남|남성|남자)$/.test(value))value='남';else continue;}
    if(id==='name'&&!/^[가-힣]{2,5}$/.test(value))continue;
    if(id==='birth'&&/^[0-9]{8}$/.test(value))value=value.slice(0,4)+'.'+value.slice(4,6)+'.'+value.slice(6);
    if(input.value&&!(id==='name'&&input.value===lastAutoName))continue;
    input.value=value;filled++;
    if(id==='name')lastAutoName=value;
  }
  return filled;
}
async function parseWorkbook(file) {
  if (file.name.toLowerCase().endsWith('.csv')) return {...rowsToRecords(parseCsv(await file.text()), file.name),personal:extractPersonalFields(parseCsv(await file.text()))};
  if (!window.XLSX) throw new Error('번들된 엑셀 라이브러리를 불러오지 못했습니다. CSV로 저장해 올려주세요.');
  const workbook = XLSX.read(await file.arrayBuffer(), {type:'array',cellDates:true});
  const found = [];
  let rejected = 0, hasDescriptionColumn = false, personal={};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
    const parsed = rowsToRecords(rows,`${file.name} · ${sheetName}`);
    personal={...extractPersonalFields(rows),...personal};
    found.push(...parsed.rows); rejected += parsed.rejected; hasDescriptionColumn ||= parsed.hasDescriptionColumn;
  }
  return {rows:found,rejected,hasDescriptionColumn,personal};
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

async function importSingleWorkbook() {
  if (!timeAuthFile) { announce('날짜·시간·봉사내용이 있는 1365 원본 엑셀을 선택해 주세요.'); return; }
  records=[];groups=[];
  ['gist','intro','character','reputation','matching'].forEach(id=>$(id).value='');
  renderRows();renderGroups();updateCharacterCount();
  announce('원본 엑셀에서 날짜, 시간, 봉사내용과 승인 상태를 분석하고 있습니다…');
  try {
    const parsed=await parseWorkbook(timeAuthFile);
    if (!parsed.rows.length) throw new Error('활동분야·봉사내용이 있는 표를 찾지 못했습니다. 1365 원본 시간인증 엑셀을 확인해 주세요.');
    if (!parsed.rows.some(row=>row.date && row.hours>0)) throw new Error('봉사 날짜와 시간 정보를 찾지 못했습니다. 날짜·시간이 포함된 시간인증 원본 파일을 선택해 주세요.');
    const valid=parsed.rows.filter(row=>row.approved && row.date && row.hours>0);
    const excluded=parsed.rows.length-valid.length;
    if (!valid.length) throw new Error('날짜·시간이 있는 승인 실적을 찾지 못했습니다.');
    // 1365 시간인증 원본은 이름이 표 내부에 없고 파일명에만 있는 경우가 많다.
    // 명시적인 성명 셀을 우선하고, 없으면 파일명 첫 부분의 한글 이름을 사용한다.
    const filenameName=nameFromWorkbookFilename(timeAuthFile.name);
    const personal={...parsed.personal};
    // 성명은 반드시 적용 버튼의 확인을 받은 이름만 사용한다.
    delete personal.name;
    const filledPersonal=applyPersonalFields(personal);
    records=valid; // 같은 날짜와 내용의 기록도 실제 실적일 수 있으므로 임의로 중복 제거하지 않는다.
    autoGroupRecords();
    lastImport={files:1,imported:records.length,duplicates:0,rejected:parsed.rejected+excluded};
    $('importSummary').textContent=`원본 ${parsed.rows.length}건 · 분석 대상 ${records.length}건 · 제외 ${excluded}건 · 자동 분류 ${groups.length}개 분야 · 인적사항 자동 입력 ${filledPersonal}개`;
    renderRows();renderReferences();
    draftText({announceResult:false});
    announce(`원본 엑셀 한 개에서 ${records.length}건, 총 ${records.reduce((sum,row)=>sum+row.hours,0).toFixed(1)}시간을 확인했습니다. 실제 활동에 맞는 ${groups.length}개 분야와 공적조서 초안을 자동 작성했습니다.`);
  } catch(error) { announce(error.message||'원본 엑셀을 읽지 못했습니다.','error'); }
}
$('timeAuthUpload').addEventListener('change',event=>{
  timeAuthFile=event.target.files?.[0]||null;
  $('timeAuthFileName').textContent=timeAuthFile?.name||'선택 안 됨';
  if(timeAuthFile) announce('엑셀을 선택했습니다. 적용 버튼을 누르면 성명을 확인한 후 반영합니다.');
  $('applyWorkbook').disabled=!timeAuthFile;
  if(timeAuthFile) announce('엑셀파일을 선택했습니다. ‘엑셀 분석·반영하기’를 누르면 공적내용을 작성합니다.');
});
function confirmWorkbookNominee(){
  const filenameName=nameFromWorkbookFilename(timeAuthFile?.name||'');
  if(!filenameName){
    announce('파일명에서 성명을 찾지 못했습니다. 파일명을 확인해 주세요.','error');
    return false;
  }
  if(!window.confirm(filenameName+'이(가) 맞습니까?'))return false;
  $('name').value=filenameName;
  lastAutoName=filenameName;
  const status=$('nameAutoStatus');
  if(status)status.textContent='확인한 성명: '+filenameName;
  return true;
}
$('applyAllWorkbook').addEventListener('click',async()=>{
  if(!timeAuthFile){announce('먼저 원본 봉사실적 엑셀 파일을 선택해 주세요.','error');$('timeAuthUpload').click();return;}
  if(!confirmWorkbookNominee())return;
  const button=$('applyAllWorkbook');button.disabled=true;button.textContent='전체 내용 적용 중…';
  try {await importSingleWorkbook();}
  finally {button.disabled=false;button.textContent='전체 내용에 적용';}
});
$('applyWorkbook').addEventListener('click',async()=>{
  if(!timeAuthFile){announce('먼저 원본 엑셀을 선택해 주세요.','error');return;}
  if(!confirmWorkbookNominee())return;
  const button=$('applyWorkbook');button.disabled=true;button.textContent='엑셀 분석 중…';
  try {await importSingleWorkbook();}
  finally {button.disabled=false;button.textContent='엑셀 분석·반영하기';}
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
    <td><select data-index="${index}" data-key="cat" aria-label="분야 선택">${groups.length?groups.map((group,cat)=>`<option value="${cat}" ${record.cat===cat?'selected':''}>${esc(group.title)}</option>`).join(''):'<option>자동분류 전</option>'}</select></td>
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
  renderRows(); renderReferences(); draftText({announceResult:false});
});
$('rows').addEventListener('click',event=>{
  const button=event.target.closest('[data-delete]'); if (!button) return;
  records.splice(Number(button.dataset.delete),1); renderRows(); renderReferences(); draftText({announceResult:false});
});
$('addRow').addEventListener('click',()=>{
  records.push({area:'',desc:'직접 입력 실적',date:'',hours:0,approved:true,included:true,cat:0,source:'직접 입력',hasDate:false,importKind:'manual'});
  if(!groups.length)autoGroupRecords();
  renderRows();
  const input=$('rows').querySelector('tr:last-child input[type=text]'); input?.focus();
});
$('clearRows').addEventListener('click',()=>{
  if (!records.length && !timeAuthFile) return;
  if (!confirm('가져오거나 직접 입력한 실적을 모두 지울까요?')) return;
  records=[]; groups=[]; timeAuthFile=null; lastAutoName='';
  $('timeAuthUpload').value='';
  $('timeAuthFileName').textContent='선택 안 됨'; $('applyWorkbook').disabled=true;
  ['gist','intro','character','reputation','matching'].forEach(id=>$(id).value=''); updateCharacterCount();
  renderRows(); renderGroups(); $('importSummary').textContent=''; announce('실적 목록과 선택한 엑셀을 비웠습니다.');
});

function renderGroups() {
  $('groups').innerHTML=groups.length?groups.map((group,index)=>`<article class="group">
    <div class="group-head"><span class="group-index">${index+1}</span><input data-group="${index}" data-key="title" value="${esc(group.title)}" aria-label="${index+1}분야 제목"></div>
    <div class="field"><label>1. 공적조서 — 주요 공적내용 (핵심 활동 2개)</label><textarea data-group="${index}" data-key="detail" rows="4" placeholder="실적을 확인한 뒤 문장을 작성하세요.">${esc(group.detail)}</textarea></div>
    <div class="field"><label>2. 공적개요서 — 분야별 최종 한 줄 요약</label><textarea data-group="${index}" data-key="short" rows="2" placeholder="이 분야의 핵심 실적을 짧게 요약">${esc(group.short)}</textarea></div>
    <div class="reference" id="reference${index}"></div>
  </article>`).join(''):'<p class="hint">원본 엑셀을 올리면 실제 봉사활동을 분석해 분야 제목과 내용을 자동으로 작성합니다.</p>';
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
  autoGroupRecords(); renderRows(); draftText({announceResult:false});
  announce(`실제 활동내용을 다시 분석해 ${groups.length}개 분야의 제목과 공적내용을 작성했습니다. 확인 후 필요한 부분만 수정하세요.`);
});

const FIXED_MATCHING = '공적내용은 제출된 봉사실적을 근거로 작성하였으며, 원본 및 증빙자료와 최종 대조하여 일치 여부를 확인함.';
function fieldInvestigationDraft(rows) {
  const count=rows.length;
  return {
    character:`제출된 봉사실적 ${count}건이 확인됨. 품성과 도덕성은 현지조사 자료로 확인 필요.`,
    reputation:'주민 여론과 사생활은 제출된 봉사실적만으로 확인할 수 없어 현지조사 확인 필요.'
  };
}
// 공적문장은 봉사활동 원본에 등장하는 내용만 활용하며 임의의 행사·수혜자를 추가하지 않는다.
function meritPhrases(rows) {
  const seen=new Set(),items=[];
  for(const row of rows){
    const raw=clean(row.desc).replace(/^[0-9]{4}[.\/-][0-9]{1,2}[.\/-][0-9]{1,2}\s*/,'').replace(/\s+/g,' ');
    if(!raw)continue;
    const phrase=raw.replace(/[.。]+$/,'').slice(0,90);
    const key=normalized(phrase);
    if(!key||seen.has(key))continue;
    seen.add(key);items.push(phrase);
  }
  return items;
}
// 실적 문장의 공통 핵심어를 기준으로 비슷한 활동을 묶고 중복된 표현을 줄인다.
function compactActivity(raw){
  return clean(raw).replace(/^[0-9]{4}[.\/-][0-9]{1,2}[.\/-][0-9]{1,2}\s*/,'')
    .replace(/\([^)]*\)/g,' ').replace(/\[[^\]]*\]/g,' ')
    .replace(/\b\d{1,2}:\d{2}\b/g,' ')
    .replace(/(?:자원봉사활동|자원봉사|봉사활동|봉사자|활동지원|봉사지원)/g,' ')
    .replace(/(?:참여|실시|진행|지원함|실시함|진행함|참여함|보조함)[.。]?$/,'')
    .replace(/\s+/g,' ').replace(/^[·,\s]+|[·,\s.。]+$/g,'').slice(0,65);
}
function activityTokens(value){
  const ignore=new Set(['봉사','활동','지원','지역','사회','진행','참여','운영','관리','관련','기타','대한','위한','행사','주민','대상','프로그램']);
  return compactActivity(value).split(/[^가-힣A-Za-z0-9]+/).filter(word=>word.length>=2&&!ignore.has(word));
}
function meaningfulActivity(label,area){
  const value=clean(label).replace(/\s/g,'');
  const category=clean(area).replace(/\s/g,'');
  return value && value!==category && !/^(환경정화|환경보호|문화예술|생활편의|재난재해|지역안전|교통안전|봉사|자원봉사|기타)(활동|봉사)?$/.test(value);
}
function compactMeritSummary(rows,maxItems=2){
  const items=summarizedActivities(rows,maxItems+3).filter(item=>meaningfulActivity(item,rows[0]?.area||''));
  return items.slice(0,maxItems);
}
function summarizedActivities(rows,maxItems=3){
  const clusters=[];
  for(const row of rows){
    const label=compactActivity(row.desc);
    if(!label || label.replace(/\s/g,'')===clean(row.area).replace(/\s/g,''))continue;
    const tokens=activityTokens(label);
    let target=clusters.find(cluster=>{
      const shared=tokens.filter(token=>cluster.tokens.includes(token));
      return (shared.length>=2)||(shared.length>=1&&tokens.length<=2&&cluster.tokens.length<=2);
    });
    if(!target){target={label,tokens,count:0,examples:[]};clusters.push(target);}
    target.count++;target.examples.push(label);
    if(label.length<target.label.length&&label.length>=4)target.label=label;
  }
  clusters.sort((a,b)=>b.count-a.count);
  return clusters.slice(0,maxItems).map(cluster=>cluster.label);
}
function contributionFor(rows,title){
  const text=rows.map(row=>`${row.area||''} ${row.desc||''}`).join(' ');
  if(/환경|정화|재활용|분리배출|탄소|자원순환/.test(text))return '쾌적한 생활환경 조성과 환경보호 인식 확산';
  if(/재난|수해|복구|방역|소방|화재|안전/.test(text))return '지역사회 안전과 재난 대응';
  if(/문화|축제|행사|공연|예술/.test(text))return '지역문화 활성화와 원활한 행사 운영';
  if(/급식|나눔|어르신|돌봄|취약|건강|의료/.test(text))return '이웃사랑 실천과 주민 복지 증진';
  if(/교육|학습|멘토/.test(text))return '교육 지원과 지역사회 발전';
  return '지역사회 발전과 자원봉사 활성화';
}
function readableHours(value){
  const minutes=Math.round(value*60);
  return `${Math.floor(minutes/60)}시간${minutes%60?` ${minutes%60}분`:''}`;
}
function draftText({announceResult=true}={}) {
  const included=selected();
  if (!included.length) { if (announceResult) announce('먼저 봉사실적을 가져오거나 직접 입력해 주세요.','error'); return false; }
  if (!groups.length) autoGroupRecords();
  groups.forEach((group,index)=>{
    const rows=included.filter(record=>record.cat===index);
    if(!rows.length){group.detail='';group.short='';return;}
    const summary=compactMeritSummary(rows,2).map(item=>String(item).replace(/\s*활동을 통해.*$/,'').trim()).filter(Boolean);
    const concise=summary.map(item=>item.replace(/[.。]+$/,'').trim()).filter(Boolean);
    // 분야별 1~2개의 핵심 내용만 짧게 작성하고 같은 기여 문구를 반복하지 않는다.
    group.detail=concise.length?concise.map(item=>'• '+item).join('\n'):'';
    group.short=concise.length?concise.slice(0,2).join(' 및 ')+' 참여':'';

  });
  renderGroups();
  const active=groups.filter((group,index)=>included.some(record=>record.cat===index)).map(group=>group.title);
  $('gist').value=`${active.slice(0,2).join('·')||'자원봉사'} 활동으로 지역사회 발전과 나눔문화 확산에 기여함.`.slice(0,50);
  const {start,end}=periodRange();
  const period=start&&end?`${start.slice(0,4)}년부터 ${end.slice(0,4)}년까지`:'확인된 공적기간 동안';
  const totalHours=included.reduce((sum,record)=>sum+Number(record.hours||0),0);
  $('intro').value=`상기인은 ${period} ${active.slice(0,3).join('·')} 등 자원봉사활동에 성실히 참여하여 지역사회 발전에 기여한 사람임.`;
  const investigation=fieldInvestigationDraft(included);
  $('character').value=investigation.character;
  $('reputation').value=investigation.reputation;
  $('matching').value=FIXED_MATCHING;
  updateCharacterCount();
  if (announceResult) announce('실적에 적힌 내용을 바탕으로 초안을 만들었습니다. 활동 횟수와 문구를 원자료·증빙과 대조해 수정하세요.');
  return true;
}
async function generateAIDraft({announceResult=true}={}) {
  if (!selected().length) return false;
  const local = ['127.0.0.1','localhost'].includes(location.hostname);
  if (!local && !publicAIUrl) {
    if (announceResult) announce('공개 AI 서버가 아직 연결되지 않았습니다. 기본 초안은 계속 AI 없이 사용할 수 있습니다.','error');
    return false;
  }
  const personalMode = !local && $('aiMode').value === 'personal';
  const personalKey = personalMode ? personalAPIKey : '';
  const accessCode = local || personalMode ? '' : sessionStorage.getItem('merit-ai-access-code');
  if (!local && personalMode && !personalKey) {
    if (announceResult) announce('먼저 API 키 사용방법에 따라 내 OpenAI API 키를 입력해 주세요.','error');
    $('personalAPIKeyInput').focus();
    return false;
  }
  if (!local && !personalMode && !accessCode) {
    if (announceResult) announce('먼저 AI 접근 코드를 입력하고 이 기기에서 연결해 주세요.','error');
    $('aiAccessCode').focus();
    return false;
  }
  try {
    const response=await fetch(`${local?'':publicAIUrl}/api/draft`,{method:'POST',headers:{'Content-Type':'application/json',...(accessCode?{'Authorization':`Bearer ${accessCode}`}:{}) ,...(personalKey?{'X-OpenAI-API-Key':personalKey}:{})},body:JSON.stringify({categories:groups.map(group=>group.title),records:selected().map(record=>({area:record.area,desc:record.desc,date:record.date,hours:record.hours,category:groups[record.cat]?.title||groups[0].title}))})});
    const rawBody=await response.text();
    let resultBody;
    try { resultBody=JSON.parse(rawBody); } catch { resultBody={error:rawBody}; }
    if (!response.ok) throw new Error(resultBody.error||'AI 초안을 만들지 못했습니다.');
    const result=resultBody;
    if (!Array.isArray(result.groups)||result.groups.length!==groups.length||typeof result.gist!=='string'||typeof result.intro!=='string'||typeof result.character!=='string'||typeof result.reputation!=='string'||typeof result.matching!=='string') throw new Error('AI 응답 형식을 확인하지 못했습니다.');
    groups=groups.map((group,index)=>({...group,detail:clean(result.groups[index]?.detail),short:clean(result.groups[index]?.short)}));
    $('gist').value=clean(result.gist).slice(0,50); $('intro').value=clean(result.intro);
    const investigation=fieldInvestigationDraft(selected());
    $('character').value=investigation.character;
    $('reputation').value=investigation.reputation;
    $('matching').value=FIXED_MATCHING;
    renderGroups(); updateCharacterCount();
    if (announceResult) announce('AI가 승인된 시간인증 실적만 바탕으로 초안을 만들었습니다. 문구와 실적을 증빙자료와 대조해 주세요.');
    return true;
  } catch (error) {
    if (announceResult) announce(`AI 연결을 사용할 수 없어 기본 초안을 유지했습니다. ${error.message}`,'error');
    return false;
  }
}
$('draft').addEventListener('click',async()=>{
  if (!selected().length) { announce('먼저 1365 원본 엑셀 하나를 선택해 주세요.','error'); return; }
  if (!isLocalAI && !publicAIUrl) { announce('공개 AI 서버 연결이 아직 준비 중입니다. 기본 초안은 AI 없이 사용할 수 있습니다.','error'); return; }
  if (!isLocalAI && $('aiMode').value==='personal' && !personalAPIKey) { announce('API 키 사용방법을 열고 내 OpenAI API 키를 입력한 뒤 다시 눌러 주세요.','error'); $('personalAPIKeyInput').focus(); return; }
  if (!isLocalAI && $('aiMode').value==='shared' && !sessionStorage.getItem('merit-ai-access-code')) { announce('AI 접근 코드를 입력하고 이 기기에서 연결해 주세요.','error'); $('aiAccessCode').focus(); return; }
  const aiUsed=await generateAIDraft({announceResult:false});
  if (!aiUsed) draftText({announceResult:false});
  announce(aiUsed?'AI가 근거 실적만 바탕으로 문장을 작성했습니다. 사실과 다른 내용이 없는지 원자료와 대조해 주세요.':'AI 서버를 사용할 수 없습니다. 엑셀 읽기와 기본 초안은 계속 AI 없이 사용할 수 있습니다.','error');
});
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
    year:val('year'),event:val('event'),name:val('name'),hanja:val('hanja'),birth:val('birth'),gender:val('gender'),serviceNo:val('serviceNo'),nationality:val('nationality'),org:val('org'),job:val('job'),rank:val('rank'),position:val('position'),meritField:val('meritField'),address:val('address'),phone:val('phone'),award:val('award'),order:val('order'),investigator:val('investigator'),investigatorOrg:val('investigatorOrg'),investigatorRank:val('investigatorRank'),recommender:val('recommender'),docDate:date,education:val('education'),career:val('career'),history:val('history'),gist:val('gist'),intro:val('intro'),character:val('character'),reputation:val('reputation'),matching:FIXED_MATCHING,period:periodText(),groups:active
  };
}
let previewObjectUrl='';
$('previewBtn').addEventListener('click',async()=>{
  const status=$('exportStatus'),button=$('previewBtn');
  const localPage=['localhost','127.0.0.1'].includes(location.hostname);
  const previewUrl=`${nativeDocumentApiUrl}/api/preview`;
  button.disabled=true;button.textContent='한글 서식으로 렌더링 중…';
  try{
    const response=await fetch(previewUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:documentModel()})});
    if(!response.ok)throw new Error(await response.text()||`미리보기 생성 오류 (${response.status})`);
    const blob=await response.blob();
    if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl=URL.createObjectURL(blob);
    $('documentPreview').innerHTML=`<iframe title="원본 한글 서식 미리보기" src="${previewObjectUrl}"></iframe>`;
    $('documentPreview').hidden=false;$('documentPreview').scrollIntoView({behavior:'smooth',block:'start'});
    status.textContent='원본 한글 문서를 PDF로 렌더링한 미리보기입니다. 표·글꼴·간격은 저장 문서와 같은 한글 서식을 사용합니다.';status.classList.remove('notice-caution');
  }catch(error){
    const message=localPage
      ?`원본 한글 서식 미리보기를 만들지 못했습니다. ${error.message}`
      :'정확한 원본 서식 미리보기는 이 PC의 로컬 미리보기 도구와 한컴오피스 한글이 필요합니다. 로컬 도구를 실행한 뒤 다시 눌러 주세요.';
    status.textContent=message;status.classList.add('notice-caution');
  }
  finally{button.disabled=false;button.textContent='문서 미리보기';}
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
function cleanTemplateValue(value) { return String(value??'').replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ').trim(); }
function changeParagraphRange(nodes, start, end, replacement) {
  let offset=0, first=null, last=null, firstOffset=0, lastOffset=0;
  for (const node of nodes) {
    const text=node.textContent||'', next=offset+text.length;
    if (!first&&start<next) { first=node; firstOffset=offset; }
    if (end<=next) { last=node; lastOffset=offset; break; }
    offset=next;
  }
  if (!first||!last) return false;
  const firstText=first.textContent||'', lastText=last.textContent||'';
  if (first===last) first.textContent=firstText.slice(0,start-firstOffset)+replacement+firstText.slice(end-firstOffset);
  else {
    first.textContent=firstText.slice(0,start-firstOffset)+replacement;
    for (const node of nodes.slice(nodes.indexOf(first)+1,nodes.indexOf(last))) node.textContent='';
    last.textContent=lastText.slice(end-lastOffset);
  }
  return true;
}
function replaceTemplateText(doc, search, replacement, exactOnly=false) {
  for (const paragraph of doc.getElementsByTagNameNS(HWP_NS.hp,'p')) {
    const nodes=[];
    const collectOwnText=node=>{
      for(const child of node.childNodes){
        if(child.nodeType!==1)continue;
        if(child.namespaceURI===HWP_NS.hp&&child.localName==='p')continue;
        if(child.namespaceURI===HWP_NS.hp&&child.localName==='t')nodes.push(child);
        else collectOwnText(child);
      }
    };
    collectOwnText(paragraph);
    const joined=nodes.map(node=>node.textContent||'').join('');
    if(exactOnly){if(joined===search)changeParagraphRange(nodes,0,joined.length,cleanTemplateValue(replacement));continue;}
    const index=joined.indexOf(search);
    if (index>=0) changeParagraphRange(nodes,index,index+search.length,cleanTemplateValue(replacement));
  }
}
async function createTemplateHwpx(model) {
  const response=await fetch(new URL('template-native.hwpx',document.baseURI));
  if(!response.ok)throw new Error(`한글 원본 서식을 불러오지 못했습니다 (${response.status}).`);
  const zip=await JSZip.loadAsync(await response.arrayBuffer());
  const entry=zip.file('Contents/section0.xml');
  if(!entry)throw new Error('원본 서식에서 문서 내용을 찾지 못했습니다.');
  const xml=await entry.async('string');
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('원본 한글 서식을 읽지 못했습니다.');
  const marker=id=>String.fromCharCode(0xE000+id);
  const documentDate=new Date(`${model.docDate}T00:00:00`);
  const dateKor=`${documentDate.getFullYear()}년  ${documentDate.getMonth()+1}월   ${documentDate.getDate()}일`;
  const age=(()=>{const match=String(model.birth||'').match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);if(!match)return '';let year=Number(match[1]);if(year<100)year+=year<=30?2000:1900;const born=new Date(year,Number(match[2])-1,Number(match[3]));let value=documentDate.getFullYear()-year;if(documentDate<new Date(documentDate.getFullYear(),born.getMonth(),born.getDate()))value--;return String(Math.max(0,value));})();
  const values={
    [marker(0)]:model.name,[marker(1)]:model.hanja,[marker(2)]:model.birth,[marker(3)]:model.gender,[marker(4)]:age,
    [marker(5)]:model.serviceNo,[marker(6)]:model.nationality,[marker(7)]:model.address,[marker(8)]:model.phone,[marker(9)]:model.job,
    [marker(10)]:model.org,[marker(11)]:model.rank,[marker(12)]:model.position,[marker(13)]:model.period,[marker(14)]:model.meritField,
    [marker(15)]:model.gist||model.intro,[marker(16)]:model.award,[marker(17)]:model.order,[marker(18)]:model.investigatorRank,
    [marker(19)]:model.investigator,[marker(20)]:model.recommender,[marker(21)]:dateKor,[marker(22)]:'',[marker(23)]:model.education,
    [marker(24)]:'',[marker(25)]:model.career,[marker(26)]:model.org,[marker(27)]:model.history,[marker(28)]:model.intro,
    [marker(29)]:model.character,[marker(30)]:model.reputation,[marker(31)]:model.matching,[marker(32)]:model.investigatorOrg
  };
  for(let index=0;index<5;index++){
    const group=model.groups[index];
    values[marker(33+index)]=group?.title||'';
    values[marker(38+index)]=group?.detail||'';
    values[marker(43+index)]=group?.short||'';
  }
  for(const [token,value] of Object.entries(values))replaceTemplateText(doc,token,cleanTemplateValue(value));
  zip.file('Contents/section0.xml',new XMLSerializer().serializeToString(doc));
  const preview=zip.file('Preview/PrvText.txt');
  if(preview)zip.file('Preview/PrvText.txt','공적조서 양식');
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}});
  return new Blob([patchHwpxZip(bytes)],{type:'application/haansofthwpx'});
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
  const p4=[{text:'현 지 조 사 확 인 서',heading:true},'1. 인적사항',`소속: ${model.org}    직위(직급): ${model.rank}`,`성명: ${model.name}    생년월일(성별): ${model.birth} (${model.gender})`,'2. 현지조사 확인내용','품성 (도덕성 흠결 여부 등)',model.character||'—','지역여론 (공·사생활 등)',model.reputation||'—','공적사항 (공적내용과 일치 여부)',model.matching||'검증 후 작성','',model.docDate,`현지조사자  소속: ${model.org}  직위: ${model.investigatorRank}`,{text:`성명: ${model.investigator}`,stamp:'investigator'}];
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
    try {
      const response=await fetch(`${nativeDocumentApiUrl}/api/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
      if(!response.ok) throw new Error(`내보내기 서버 오류 (${response.status})`);
      blob=await response.blob();
      usedNativeTemplate=true;
    } catch (error) {
      console.warn('로컬 한글 자동화에 연결하지 못해 원본 HWPX 템플릿을 브라우저에서 채웁니다.',error);
    }
    if (!blob) {
      blob=await createTemplateHwpx(model);
    }
    const filename=`${safeFilename(model.year)}_공적조서_${safeFilename(model.name)}.hwpx`;
    const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
    announceExport(usedNativeTemplate?`${filename}을 제공된 한글 원본 서식으로 저장했습니다. 도장과 입력 내용을 확인해 주세요.`:`${filename}을 제공된 한글 원본 서식으로 저장했습니다. 한글에서 입력 내용을 확인해 주세요.`);
  } catch (error) {
    console.error(error); announceExport(`HWPX를 만들지 못했습니다: ${error.message||error}`,'error');
  } finally { button.disabled=false;button.textContent='한글 문서 (.hwpx) 저장'; }
}
$('downloadHwpx').addEventListener('click',exportHwpx);

function projectData() {
  return {format:'volunteer-merit-studio',version:3,fields:Object.fromEntries(fieldIds.map(id=>[id,$(id).value])),records,groups,stamp,stampSizes:{recommender:$('recommenderStampSize').value,investigator:$('investigatorStampSize').value}};
}
const SAVED_PROJECTS_KEY='volunteer-merit-studio-saved-projects-v1';
function savedProjects(){
  try {return JSON.parse(localStorage.getItem(SAVED_PROJECTS_KEY)||'[]');}
  catch {return [];}
}
function renderSavedProjects(){
  const list=$('savedProjectsList');if(!list)return;
  const items=savedProjects();list.replaceChildren();
  if(!items.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='이 기기에 저장된 작업이 없습니다.';list.append(empty);return;}
  for(const item of items){
    const row=document.createElement('div');row.className='saved-project-row';
    const label=document.createElement('span');label.textContent=`${item.name||'이름 미입력'} · ${item.year||''}년 · ${new Date(item.savedAt).toLocaleString('ko-KR')}`;
    const open=document.createElement('button');open.className='button button-light';open.type='button';open.textContent='불러오기';open.addEventListener('click',()=>{if(confirm('현재 작업을 저장된 작업으로 바꿀까요?'))loadProjectData(item.data);});
    const remove=document.createElement('button');remove.className='button button-text';remove.type='button';remove.textContent='삭제';remove.addEventListener('click',()=>{if(!confirm('이 기기의 저장 목록에서 삭제할까요?'))return;localStorage.setItem(SAVED_PROJECTS_KEY,JSON.stringify(savedProjects().filter(saved=>saved.id!==item.id)));renderSavedProjects();});
    row.append(label,open,remove);list.append(row);
  }
}
function loadProjectData(data){
  const groupsToLoad=Array.isArray(data.groups)?data.groups:data.groupData;
  const supported=data.fields&&Array.isArray(data.records)&&Array.isArray(groupsToLoad)&&((data.format==='volunteer-merit-studio')||data.version===1);
  if(!supported)throw new Error('이 앱에서 저장한 작업파일이 아닙니다.');
  fieldIds.forEach(id=>{if($(id))$(id).value=data.fields[id]??'';});
  records=data.records.map(record=>({...record,cat:Math.max(0,Number(record.cat)||0)}));
  if(data.version>=3&&groupsToLoad.length>=1&&groupsToLoad.length<=MAX_GROUPS){
    groups=groupsToLoad.map(group=>({key:group.key||'',title:clean(group.title)||'봉사활동',detail:group.detail||'',short:group.short||''}));
    records.forEach(record=>{record.cat=Math.min(groups.length-1,record.cat);});
  }else{
    autoGroupRecords();if(records.length)draftText({announceResult:false});
  }
  stamp=data.stamp||null;
  if(stamp){$('stampImage').src=stamp.dataUrl;$('stampName').textContent=stamp.name||'도장 이미지';$('stampPreview').hidden=false;}
  else $('stampPreview').hidden=true;
  $('recommenderStampSize').value=data.stampSizes?.recommender||22;
  $('investigatorStampSize').value=data.stampSizes?.investigator||22;
  updateStampSizeLabels();renderGroups();renderRows();updateCharacterCount();
  announce('저장된 작업을 불러왔습니다. 계속 수정할 수 있습니다.');
}
function saveProject(){
  const data=projectData();
  const content=JSON.stringify(data,null,2);
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type:'application/json'}));
  link.download=`${safeFilename(val('year'))}_공적조서_${safeFilename(val('name'))}_작업.json`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
  try{
    const items=savedProjects(),now=new Date().toISOString();
    items.unshift({id:now+'-'+Math.random().toString(36).slice(2),name:val('name'),year:val('year'),savedAt:now,data});
    localStorage.setItem(SAVED_PROJECTS_KEY,JSON.stringify(items.slice(0,30)));
    renderSavedProjects();
    announce('작업파일을 다운로드하고 이 기기의 저장 목록에도 보관했습니다.');
  }catch(error){
    announce('작업파일은 다운로드했습니다. 이 기기의 저장 공간이 부족하거나 차단되어 목록 저장은 되지 않았습니다.','error');
  }
}
$('saveProject').addEventListener('click',saveProject);
$('jsonFile').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!confirm('현재 화면의 자료를 불러온 작업파일로 바꿀까요?'))return;
    loadProjectData(data);
  }catch(error){announce(`작업파일을 읽지 못했습니다: ${error.message}`,'error');}
  finally{event.target.value='';}
});
renderSavedProjects();

$('exportCSV').addEventListener('click',()=>{
  const rows=[['활동분야','봉사일자','봉사시간(시간)','봉사내용','분류']].concat(selected().map(record=>[record.area,record.date,record.hours||'',record.desc,groups[record.cat]?.title||'']));
  const csv=rows.map(row=>row.map(value=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\r\n');
  const link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}));link.download=`${safeFilename(val('year'))}_추린봉사실적_${safeFilename(val('name'))}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),30000);
});

window.addEventListener('error',event=>{if (event.message?.includes('XLSX')) announce('엑셀 라이브러리를 불러오지 못했습니다. CSV 파일로 저장해 올리거나 인터넷 연결을 확인하세요.','error');});
