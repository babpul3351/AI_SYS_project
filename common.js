/**
 * 의약품 정보 웹앱 - 공통 스크립트
 * 모든 HTML 페이지가 이 파일을 먼저 불러옴
 */

// ===== 설정 =====
// TODO: 본인 Worker 주소로 바꿀 것 (끝에 / 없이)
const WORKER_URL = 'https://aisysproject.swells200483.workers.dev';

const CABINET_KEY = 'medcabinet.v1';
const PLACEHOLDER_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120">' +
    '<rect width="160" height="120" fill="#eef4f3"/>' +
    '<rect x="50" y="42" width="60" height="26" rx="13" fill="#cfe3e0"/>' +
    '<rect x="80" y="42" width="30" height="26" rx="13" fill="#b3d4cf"/>' +
    '<text x="80" y="98" font-size="11" text-anchor="middle" fill="#6b8582" font-family="sans-serif">이미지 없음</text></svg>'
  );

// ===== API 호출 =====
class ApiError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail || '';
  }
}

/**
 * Worker를 거쳐 공공데이터포털 API 호출
 * @param {string} api    worker.js ROUTES 별칭 (easy, pill, otc)
 * @param {object} params 그대로 전달할 요청 파라미터
 * @param {'json'|'xml'} format 요청 형식
 * @returns {Promise<{items: object[], totalCount: number, format: 'JSON'|'XML'}>}
 */
async function apiGet(api, params = {}, format = 'json') {
  const qs = new URLSearchParams({ api, ...params, type: format });
  let res;
  try {
    res = await fetch(`${WORKER_URL}/?${qs.toString()}`);
  } catch (err) {
    throw new ApiError('네트워크 오류로 서버에 연결하지 못했습니다.', String(err));
  }
  const text = (await res.text()).trim();

  // 응답 형식은 요청값이 아니라 실제 응답 내용으로 판단
  if (text.startsWith('<')) return parseXmlResponse(text);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError('응답을 해석할 수 없습니다.', text.slice(0, 200));
  }
  if (data.ok === false) throw new ApiError(data.error, data.detail);
  return parseJsonResponse(data);
}

/** XML로 먼저 요청하고, 실패하면 JSON으로 다시 요청 */
async function apiGetPreferXml(api, params = {}) {
  try {
    return await apiGet(api, params, 'xml');
  } catch (err) {
    return await apiGet(api, params, 'json');
  }
}

function parseJsonResponse(data) {
  const header = data.header || (data.response && data.response.header) || {};
  const body = data.body || (data.response && data.response.body) || {};
  if (header.resultCode && header.resultCode !== '00') {
    throw new ApiError(header.resultMsg || 'API 오류', header.resultCode);
  }
  return {
    items: normalizeItems(body.items),
    totalCount: Number(body.totalCount) || 0,
    format: 'JSON'
  };
}

/** items가 배열 / {item: 배열} / {item: 객체} / 빈 값 등 어떤 형태여도 배열로 변환 */
function normalizeItems(items) {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (items.item) return Array.isArray(items.item) ? items.item : [items.item];
  return [];
}

function parseXmlResponse(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new ApiError('XML을 해석할 수 없습니다.', text.slice(0, 200));
  }
  // 게이트웨이 오류 형식
  const errMsg = doc.querySelector('errMsg');
  if (errMsg) {
    const reason = doc.querySelector('returnAuthMsg');
    throw new ApiError(errMsg.textContent, reason ? reason.textContent : '');
  }
  const code = doc.querySelector('resultCode');
  if (code && code.textContent.trim() !== '00') {
    const msg = doc.querySelector('resultMsg');
    throw new ApiError(msg ? msg.textContent : 'API 오류', code.textContent);
  }
  const items = Array.from(doc.querySelectorAll('items > item')).map((node) => {
    const obj = {};
    Array.from(node.children).forEach((child) => {
      obj[child.tagName] = child.textContent;
    });
    return obj;
  });
  const total = doc.querySelector('totalCount');
  return {
    items,
    totalCount: total ? Number(total.textContent) || 0 : items.length,
    format: 'XML'
  };
}

/** 응답 항목 중 값으로 품목 코드를 가진 항목 찾기 (필드명이 API마다 달라서 값으로 비교) */
function findBySeq(items, seq) {
  return items.find((item) => Object.values(item).some((v) => String(v) === String(seq))) || null;
}

// ===== DOM 도우미 =====
/** 요소 생성. 텍스트는 항상 textContent로 넣어 HTML 주입을 막음 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (v === null || v === undefined || v === false) return;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return node;
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name) || '';
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function clean(text) {
  return (text || '').trim();
}

function summarize(text, max = 70) {
  const t = clean(text).replace(/\s+/g, ' ');
  return t.length > max ? t.slice(0, max) + '…' : t;
}

function imgEl(src, alt) {
  const img = el('img', { src: src || PLACEHOLDER_IMG, alt: alt || '', loading: 'lazy' });
  img.addEventListener('error', () => { img.src = PLACEHOLDER_IMG; }, { once: true });
  return img;
}

function showStatus(container, message, kind = 'info') {
  container.replaceChildren(el('p', { class: `status status-${kind}`, text: message }));
}

/** 불러오는 동안 카드 모양의 회색 자리표시를 보여줌 */
function showSkeleton(container, count = 6) {
  const cards = Array.from({ length: count }, () =>
    el('div', { class: 'card skeleton-card', 'aria-hidden': 'true' }, [
      el('div', { class: 'sk sk-img' }),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'sk sk-line sk-w80' }),
        el('div', { class: 'sk sk-line sk-w50' }),
        el('div', { class: 'sk sk-line sk-w90' })
      ])
    ])
  );
  container.replaceChildren(
    el('p', { class: 'sr-only', role: 'status', text: '불러오는 중입니다' }),
    el('div', { class: 'grid' }, cards)
  );
}

/** 상세 페이지용 문단형 자리표시 */
function showSkeletonBlock(container, lines = 6) {
  container.replaceChildren(
    el('p', { class: 'sr-only', role: 'status', text: '불러오는 중입니다' }),
    el('div', { class: 'section', 'aria-hidden': 'true' },
      Array.from({ length: lines }, (_, i) => el('div', { class: `sk sk-line ${i % 3 === 2 ? 'sk-w50' : 'sk-w90'}` })))
  );
}

/** 응답 형식 배지 (JSON / XML 색 구분) */
function formatBadge(format) {
  const f = String(format || '').toUpperCase();
  return el('span', { class: `badge ${f === 'XML' ? 'badge-xml' : 'badge-json'}`, text: `응답 형식 ${f || '-'}` });
}

/** 전문의약품 / 일반의약품 배지 */
function typeBadge(etcOtcName) {
  const t = clean(etcOtcName);
  if (!t) return null;
  return el('span', { class: `badge ${t.includes('전문') ? 'badge-etc' : 'badge-otc'}`, text: t });
}

function errorMessage(err) {
  const map = {
    SERVICE_KEY_NOT_SET: '서버에 인증키가 설정되지 않았습니다.',
    UNKNOWN_API: '허용되지 않은 API 요청입니다.',
    SERVICE_KEY_IS_NOT_REGISTERED_ERROR: '이 API는 아직 이용 승인이 반영되지 않았습니다.'
  };
  const base = map[err.message] || err.message || '알 수 없는 오류';
  return `데이터를 불러오지 못했습니다: ${base}`;
}

// ===== 성분 추출 (이름 괄호 기반) =====
/** "타이레놀정500밀리그람(아세트아미노펜)" → "아세트아미노펜". 이름에 성분이 없으면 빈 문자열 */
function extractIngredient(name) {
  const m = clean(name).match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : '';
}

// ===== 내 약 보관함 (localStorage) =====
function loadCabinet() {
  try {
    const raw = localStorage.getItem(CABINET_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveCabinet(list) {
  try {
    localStorage.setItem(CABINET_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

function inCabinet(seq) {
  return loadCabinet().some((m) => m.seq === String(seq));
}

/** 보관함에 있으면 빼고, 없으면 넣음. 결과로 현재 포함 여부 반환 */
function toggleCabinet(med) {
  const list = loadCabinet();
  const idx = list.findIndex((m) => m.seq === String(med.seq));
  if (idx >= 0) {
    list.splice(idx, 1);
    saveCabinet(list);
    return false;
  }
  list.push({
    seq: String(med.seq),
    name: med.name,
    entp: med.entp || '',
    image: med.image || '',
    savedAt: new Date().toISOString()
  });
  saveCabinet(list);
  return true;
}

function cabinetButton(med) {
  const btn = el('button', { type: 'button', class: 'btn btn-ghost' });
  const sync = () => {
    const saved = inCabinet(med.seq);
    btn.textContent = saved ? '보관함에서 빼기' : '보관함에 담기';
    btn.classList.toggle('is-saved', saved);
    btn.setAttribute('aria-pressed', saved ? 'true' : 'false');
  };
  btn.addEventListener('click', () => {
    toggleCabinet(med);
    sync();
  });
  sync();
  return btn;
}

/** 보관함 안에서 같은 성분을 가진 약 묶음 찾기 */
function findDuplicateIngredients(list) {
  const groups = {};
  list.forEach((m) => {
    const ing = extractIngredient(m.name);
    if (!ing) return;
    (groups[ing] = groups[ing] || []).push(m.name);
  });
  return Object.entries(groups).filter(([, names]) => names.length > 1);
}

// ===== 공통 레이아웃 =====
function renderLayout(active) {
  const pages = [
    ['index.html', '약 이름 검색'],
    ['identify.html', '알약 모양 찾기'],
    ['cabinet.html', '내 약 보관함']
  ];
  const header = document.getElementById('site-header');
  if (header) {
    header.replaceChildren(
      el('div', { class: 'wrap header-inner' }, [
        el('a', { href: 'index.html', class: 'brand' }, [
          el('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
          el('span', { text: '약 알아보기' })
        ]),
        el('nav', { 'aria-label': '주요 메뉴' }, pages.map(([href, label]) =>
          el('a', { href, class: href === active ? 'active' : '', 'aria-current': href === active ? 'page' : null, text: label })
        ))
      ])
    );
  }
  const footer = document.getElementById('site-footer');
  if (footer) {
    footer.replaceChildren(
      el('div', { class: 'wrap footer-inner' }, [
        el('p', { class: 'footer-title', text: '약 알아보기' }),
        el('p', { text: '데이터 출처: 식품의약품안전처 (공공데이터포털 OpenAPI · e약은요, 의약품 낱알식별, 안전상비의약품)' }),
        el('p', { text: '이 서비스는 학습용 웹앱이며 의사·약사의 진단이나 처방을 대신하지 않습니다. 복용 전 반드시 전문가와 상의하세요.' })
      ])
    );
  }
}
