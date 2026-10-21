// 관리자 페이지. 데이터를 편집해 초안으로 모은 뒤 GitHub Git Data API로 한 커밋에 게시한다.
// 데이터 속 텍스트는 모두 텍스트 노드로 넣는다. innerHTML은 쓰지 않는다 (토큰이 브라우저에 있으므로 XSS가 곧 토큰 유출이다).

import { shadeLikeBlockbench } from '../shade.js';

const API = 'https://api.github.com';
const TOKEN_KEY = 'murinn-admin-token';
const REPO_KEY = 'murinn-admin-repo';
const DRAFT_PREFIX = 'murinn-admin-draft:';
const DATA_FILES = ['profile', 'plugins', 'models', 'sfx'];
const WARN_BYTES = 50 * 1024 * 1024;
const MAX_BYTES = 95 * 1024 * 1024; // GitHub 단일 파일 한도 100MB에 가까우면 막는다.

/* DOM */

// 사이트의 app.js와 같은 방식의 요소 생성기. 문자열 자식은 텍스트 노드가 된다.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// 이동 아이콘 (선 굵기 2의 화살표). dir: up | down | back
function arrow(dir) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', { up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7', back: 'M19 12H5M12 19l-7-7 7-7' }[dir]);
  svg.append(path);
  return svg;
}

const mark = (on) => h('span', { class: on ? 'mark' : 'mark off', 'aria-hidden': 'true' });
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 저장소 */

const storage = {
  get(store, key) { try { return store.getItem(key); } catch { return null; } },
  set(store, key, value) { try { store.setItem(key, value); return true; } catch { return false; } },
  remove(store, key) { try { store.removeItem(key); } catch { /* 무시 */ } },
};

/* 데이터 구조 (.docs/03-data-model.md) */

const ID_RE = /^[a-z0-9-]+$/;
const DATE_RE = /^\d{4}\.(0[1-9]|1[0-2])(\.(0[1-9]|[12]\d|3[01]))?$/;

const MEDIA = {
  image: { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp'], accept: 'image/png,image/jpeg,image/gif,image/webp', label: '이미지' },
  video: { exts: ['mp4'], accept: 'video/mp4', label: 'mp4 영상' },
  glb: { exts: ['glb'], accept: '.glb,model/gltf-binary', label: '.glb' },
};

const F = {
  id: { key: 'id', label: 'id', type: 'text', required: true, hint: '영문 소문자, 숫자, - 만' },
  credit: { key: 'credit', label: '크레딧', type: 'textarea', full: true, hint: '한 줄에 크레딧 하나씩 입력하세요.' },
  start: { key: 'start', label: '시작', type: 'date', required: true },
  end: { key: 'end', label: '끝', type: 'date' },
};

const COLLECTIONS = [
  {
    key: 'profile', label: 'Profile', single: true, folder: 'team',
    fields: [
      { key: 'name', label: '이름', type: 'text', required: true },
      { key: 'intro', label: '한 줄 소개', type: 'text' },
      { key: 'team.logo', label: '팀 로고', type: 'media', kind: 'image', file: 'logo' },
      { key: 'team.name', label: '팀 이름', type: 'text' },
      { key: 'team.url', label: '팀 링크', type: 'url' },
      { key: 'contacts', label: '연락처', type: 'contacts', full: true },
    ],
    sections: [
      { title: '기본', keys: ['name', 'intro'] },
      { title: '팀', keys: ['team.logo', 'team.name', 'team.url'], className: 'team-form' },
      { title: '연락처', keys: ['contacts'], hint: '사이트의 이름 아래 정보 줄에 이 순서대로 나옵니다.' },
    ],
  },
  {
    key: 'contributions', label: '기여 서버', titleKey: 'server', dateKey: 'start',
    list: (d) => d.profile.contributions,
    fields: [F.id, { key: 'server', label: '서버 이름', type: 'text', required: true }, { key: 'url', label: '링크', type: 'url', full: true }, F.start, F.end, { key: 'work', label: '작업 내용', type: 'text', full: true }],
    blank: () => ({ id: '', server: '', url: null, start: '', end: null, work: '' }),
  },
  {
    key: 'plugins', label: 'Plugins', titleKey: 'title', dateKey: 'start', folder: 'plugins',
    list: (d) => d.plugins,
    thumb: (it) => it.videos?.[0]?.poster,
    fields: [
      F.id, { key: 'title', label: '제목', type: 'text', required: true },
      { key: 'subtitle', label: '부제', type: 'text' }, { key: 'env', label: '플랫폼', type: 'text' },
      F.start, F.end,
      { key: 'status', label: '상태', type: 'select', options: [['done', '완료'], ['wip', '진행 중'], ['stopped', '개발 중단']] },
      { key: 'usesShader', label: '바닐라 셰이더 사용', type: 'checkbox' },
      { key: 'shaderNote', label: '셰이더 문구', type: 'text', full: true },
      { key: 'summary', label: '목록용 설명', type: 'textarea', full: true },
      { key: 'description', label: '상세 설명', type: 'textarea', full: true },
      { key: 'videos', label: '영상', type: 'videos', full: true },
    ],
    blank: () => ({ id: '', title: '', subtitle: '', start: '', end: null, status: 'done', env: '', summary: '', description: '', usesShader: false, shaderNote: '바닐라 셰이더 사용', videos: [] }),
  },
  {
    key: 'models', label: '3D 모델', titleKey: 'name', folder: 'models',
    list: (d) => d.models,
    thumb: (it) => it.poster,
    fields: [F.id, { key: 'name', label: '이름', type: 'text', required: true }, { key: 'src', label: '모델 (.glb)', type: 'media', kind: 'glb', file: 'model', required: true, full: true }, { key: 'poster', label: '썸네일', type: 'media', kind: 'image', file: 'poster', full: true }, { key: 'meta', label: '보조 정보', type: 'text', full: true }, F.credit],
    blank: () => ({ id: '', name: '', src: null, poster: null, meta: null, credit: null }),
  },
  {
    key: 'sfx', label: 'SFX', titleKey: 'title', folder: 'sfx',
    list: (d) => d.sfx,
    thumb: (it) => it.poster,
    fields: [F.id, { key: 'title', label: '제목', type: 'text', required: true }, F.credit, { key: 'description', label: '설명', type: 'textarea', full: true }, { key: 'video', label: '영상', type: 'media', kind: 'video', file: 'video', required: true, full: true }, { key: 'poster', label: '썸네일', type: 'media', kind: 'image', file: 'poster', full: true }],
    blank: () => ({ id: '', title: '', description: '', credit: null, video: null, poster: null }),
  },
];

const VIDEO_FIELDS = [
  { key: 'src', label: '영상', type: 'media', kind: 'video', required: true, full: true },
  { key: 'poster', label: '썸네일', type: 'media', kind: 'image', full: true },
  { key: 'caption', label: '캡션', type: 'text', full: true },
];

const collByKey = (key) => COLLECTIONS.find((c) => c.key === key);

const CONTACT_TYPES = {
  discord: {
    name: 'Discord', label: 'DISCORD', value: '아이디', valueRequired: true,
    target: '사용자 ID', numeric: true, pattern: /^\d{17,20}$/, error: '숫자 17~20자리로 입력하세요.',
    targetHint: '숫자 17~20자리입니다. Discord 설정의 고급에서 개발자 모드를 켜고, 내 프로필을 우클릭해 ID를 복사하세요. 비우면 링크 없이 아이디만 보입니다.',
  },
  email: {
    name: '메일', label: 'CONTACT', value: '보이는 글', valueHint: '비우면 메일 주소를 그대로 보여 줍니다.',
    target: '메일 주소', targetRequired: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, error: '메일 주소 형식으로 입력하세요.',
  },
  link: {
    name: '링크', label: '', value: '보이는 글', valueRequired: true,
    target: '주소', targetRequired: true, pattern: /^https:\/\/\S+$/, error: 'https:// 로 시작해야 합니다.',
  },
};

const contactType = (type) => (Object.hasOwn(CONTACT_TYPES, type) ? CONTACT_TYPES[type] : null);

function normalizeContacts(p, arr) {
  const list = arr(p.contacts).map((c) => {
    if (c.type) return { ...c, type: c.type, label: c.label ?? '', value: c.value ?? '', target: c.target ?? null };
    const url = typeof c.url === 'string' ? c.url : '';
    if (/^mailto:/i.test(url)) {
      const address = url.slice(7);
      return { type: 'email', label: c.label || 'CONTACT', value: c.value === address ? '' : c.value || '', target: address };
    }
    return { type: 'link', label: c.label || '', value: c.value || '', target: url || null };
  });
  if (p.discord && !list.some((c) => c.type === 'discord')) {
    list.unshift({ type: 'discord', label: 'DISCORD', value: p.discord || '', target: p.discordId || null });
  }
  return list;
}

function emptyData() {
  return {
    profile: { name: '', intro: '', team: { name: '', logo: null, url: null }, contacts: [], contributions: [] },
    plugins: [],
    models: [],
    sfx: [],
  };
}

// 원격 JSON 형태가 어긋나도 편집기가 열리도록 기본 구조에 맞춘다.
function normalize(raw) {
  const d = emptyData();
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => obj(x)) : []);
  const p = obj(raw.profile);
  if (p) {
    d.profile = { ...d.profile, ...p, team: { ...d.profile.team, ...obj(p.team) }, contacts: normalizeContacts(p, arr), contributions: arr(p.contributions) };
    delete d.profile.discord;
    delete d.profile.discordId;
  }
  d.plugins = arr(raw.plugins).map((pl) => ({ ...pl, videos: arr(pl.videos) }));
  const m = obj(raw.models);
  d.models = m ? [...arr(m.models), ...arr(m.vfx)] : arr(raw.models);
  d.sfx = arr(raw.sfx);
  return d;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

// 항목이 참조하는 미디어 경로를 모두 모은다.
function mediaRefs(value, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('media/')) out.add(value);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) mediaRefs(v, out);
  }
  return out;
}

/* 상태 */

const state = {
  repo: null, // { owner, name, branch }
  token: null,
  baseSha: null,
  baseTreeSha: null,
  basePaths: new Set(),
  baseText: new Map(),
  treeComplete: true,
  base: null,
  data: null,
  pending: new Map(), // 경로 -> { file, url }
  deletes: new Set(),
  coll: 'profile',
  index: 0,
  pane: 'collections',
  view: 'edit',
  confirm: null,
  busy: false,
  notice: null, // { text, error, actions }
};

// 브랜치 이름의 / 는 그대로 두고 나머지만 인코딩한다.
const refPath = () => state.repo.branch.split('/').map(encodeURIComponent).join('/');

const draftKey = () => `${DRAFT_PREFIX}${state.repo.owner}/${state.repo.name}@${state.repo.branch}`;

function saveDraft() {
  if (!state.data) return;
  if (same(state.data, state.base)) {
    storage.remove(localStorage, draftKey());
    return;
  }
  const ok = storage.set(localStorage, draftKey(), JSON.stringify({ v: 1, baseSha: state.baseSha, data: state.data }));
  if (!ok) setNotice('초안을 브라우저에 저장하지 못했습니다. 새로고침하면 변경이 사라집니다.', true);
}

/* GitHub API */

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body, token = state.token, repo = state.repo } = {}) {
  const res = await fetch(`${API}/repos/${repo.owner}/${repo.name}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).message || ''; } catch { /* 본문 없음 */ }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}

function explain(err) {
  if (!(err instanceof ApiError)) return `네트워크 오류: ${err.message}`;
  if (err.status === 401) return '토큰이 올바르지 않거나 만료됐습니다.';
  if (err.status === 403) return '권한이 없습니다. 토큰에 이 저장소의 Contents 읽기·쓰기 권한이 있는지 확인하세요.';
  if (err.status === 404) return '저장소나 브랜치를 찾을 수 없습니다. 이름과 토큰의 저장소 선택을 확인하세요.';
  if (err.status === 409 || err.status === 422) return `GitHub가 요청을 거부했습니다 (${err.status}): ${err.message}`;
  return `GitHub 오류 ${err.status}: ${err.message}`;
}

function decodeBase64Utf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function loadRemote() {
  const ref = await api(`/git/ref/heads/${refPath()}`);
  const commit = await api(`/git/commits/${ref.object.sha}`);
  const tree = await api(`/git/trees/${commit.tree.sha}?recursive=1`);
  const blobs = new Map(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.sha]));

  const raw = {};
  state.baseText = new Map();
  for (const name of DATA_FILES) {
    const sha = blobs.get(`data/${name}.json`);
    if (!sha) continue;
    const blob = await api(`/git/blobs/${sha}`);
    try {
      const text = decodeBase64Utf8(blob.content);
      state.baseText.set(`data/${name}.json`, text);
      raw[name] = JSON.parse(text);
    } catch {
      setNotice(`data/${name}.json을 읽지 못했습니다. 빈 값으로 엽니다.`, true);
    }
  }

  state.baseSha = ref.object.sha;
  state.baseTreeSha = commit.tree.sha;
  state.basePaths = new Set(blobs.keys());
  // 잘린 목록으로는 미디어 존재 여부를 믿을 수 없으므로 미디어 삭제를 막는다.
  state.treeComplete = !tree.truncated;
  state.base = normalize(raw);
  state.data = clone(state.base);
  state.deletes.clear();
  state.contactConfirm = null;

  const saved = storage.get(localStorage, draftKey());
  if (saved) {
    try {
      const draft = JSON.parse(saved);
      if (draft.v === 1 && draft.baseSha === state.baseSha) {
        state.data = normalize(draft.data);
        const missing = missingMedia();
        if (missing.length) setNotice(`새로고침 전에 고른 파일 ${missing.length}개는 다시 선택하세요.`, true);
      } else {
        setNotice('원격 저장소가 바뀌어서 이전 초안을 열지 않았습니다.', true, [
          ['이전 초안 지우기', () => { storage.remove(localStorage, draftKey()); clearNotice(); }],
        ]);
      }
    } catch {
      storage.remove(localStorage, draftKey());
    }
  }
}

/* 변경 계산 */

const profileOnly = (p) => ({ ...p, contributions: undefined });

// 컬렉션별로 추가, 수정, 삭제, 순서 변경을 센다.
function collectionChanges(coll) {
  if (coll.single) {
    const changed = !same(profileOnly(state.data.profile), profileOnly(state.base.profile)) || refsPending(profileOnly(state.data.profile));
    return { count: changed ? 1 : 0, items: [changed] };
  }
  const draft = coll.list(state.data);
  const base = coll.list(state.base);
  const baseById = new Map(base.map((it) => [it.id, it]));
  const draftIds = new Set(draft.map((it) => it.id));
  const items = draft.map((it) => !baseById.has(it.id) || !same(it, baseById.get(it.id)) || refsPending(it));
  const removed = base.filter((it) => !draftIds.has(it.id)).length;
  const common = (list, other) => list.map((it) => it.id).filter((id) => other.has(id));
  const order = !same(common(draft, new Set(base.map((it) => it.id))), common(base, draftIds));
  return { count: items.filter(Boolean).length + removed + (order ? 1 : 0), items };
}

function refsPending(value) {
  for (const p of mediaRefs(value)) if (state.pending.has(p)) return true;
  return false;
}

function totalChanges() {
  return COLLECTIONS.reduce((n, c) => n + collectionChanges(c).count, 0);
}

// 참조하지만 저장소에도, 이번에 고른 파일에도 없는 미디어.
function missingMedia() {
  if (!state.treeComplete) return [];
  return [...mediaRefs(state.data)].filter((p) => !state.basePaths.has(p) && !state.pending.has(p));
}

/* 검증 */

function validateFields(fields, item, errors, prefix = '') {
  for (const f of fields) {
    const v = getPath(item, f.key);
    const key = prefix + f.key;
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
    if (f.required && empty) { errors[key] = '필수 항목입니다.'; continue; }
    if (empty) continue;
    if (f.key === 'id' && !ID_RE.test(v)) errors[key] = '영문 소문자, 숫자, - 만 쓸 수 있습니다.';
    if (f.type === 'date' && !DATE_RE.test(v)) errors[key] = 'YYYY.MM.DD 또는 YYYY.MM 형식으로 입력하세요.';
    if (f.type === 'url' && !/^https:\/\//i.test(v)) errors[key] = 'https:// 로 시작해야 합니다.';
    if (f.type === 'media' && state.treeComplete && !state.basePaths.has(v) && !state.pending.has(v)) errors[key] = '파일을 다시 선택하세요.';
    if (f.type === 'videos') v.forEach((sub, i) => validateFields(VIDEO_FIELDS, sub, errors, `videos.${i}.`));
    if (f.type === 'contacts') v.forEach((c, i) => validateContact(c, errors, `${key}.${i}.`));
  }
}

function validateContact(c, errors, prefix) {
  const t = contactType(c.type);
  if (!t) return;
  if (t.valueRequired && !c.value) errors[`${prefix}value`] = '필수 항목입니다.';
  if (!c.target) {
    if (t.targetRequired) errors[`${prefix}target`] = '필수 항목입니다.';
  } else if (!t.pattern.test(c.target)) {
    errors[`${prefix}target`] = t.error;
  }
}

function validateItem(coll, item, index) {
  const errors = {};
  validateFields(coll.fields, item, errors);
  if (!coll.single && item.id && coll.list(state.data).some((other, i) => i !== index && other.id === item.id)) {
    errors.id = '같은 id가 이미 있습니다.';
  }
  return errors;
}

/* 렌더링 */

const root = document.getElementById('app');

function setNotice(text, error = false, actions = []) {
  state.notice = { text, error, actions };
  renderNotice();
}

function clearNotice() {
  state.notice = null;
  renderNotice();
}

function renderNotice() {
  const slot = document.getElementById('notice');
  if (!slot) return;
  const n = state.notice;
  slot.replaceChildren(...(n ? [h('div', { class: n.error ? 'notice error' : 'notice', role: n.error ? 'alert' : 'status' },
    h('span', null, n.text),
    n.actions.map(([label, fn]) => h('button', { type: 'button', class: 'btn small', onclick: fn }, label)),
    h('button', { type: 'button', class: 'btn small', onclick: clearNotice }, '닫기'))] : []));
}

function renderLogin(message) {
  const saved = (() => { try { return JSON.parse(storage.get(localStorage, REPO_KEY)) || {}; } catch { return {}; } })();
  const repoIn = h('input', { type: 'text', id: 'repo', value: saved.repo || '', placeholder: 'owner/repository', autocomplete: 'off', spellcheck: false });
  const branchIn = h('input', { type: 'text', id: 'branch', value: saved.branch || 'master', autocomplete: 'off', spellcheck: false });
  const tokenIn = h('input', { type: 'password', id: 'token', autocomplete: 'off', spellcheck: false });
  const remember = h('input', { type: 'checkbox', id: 'remember' });
  const status = h('p', { class: 'err', role: 'alert' }, message || '');
  const submit = h('button', { type: 'submit', class: 'btn primary' }, '들어가기');

  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      const [owner, name] = repoIn.value.trim().split('/');
      const branch = branchIn.value.trim();
      const token = tokenIn.value.trim();
      if (!/^[\w.-]+$/.test(owner || '') || !/^[\w.-]+$/.test(name || '') || !branch || !token) {
        status.textContent = '저장소(owner/repository), 브랜치, 토큰을 모두 입력하세요.';
        return;
      }
      submit.disabled = true;
      status.textContent = '확인 중…';
      try {
        await signIn({ owner, name, branch }, token, remember.checked);
      } catch (err) {
        status.textContent = explain(err);
        submit.disabled = false;
      }
    },
  },
  h('h1', null, 'MURINN 관리'),
  h('label', { class: 'field', for: 'repo' }, h('span', null, '저장소'), repoIn),
  h('label', { class: 'field', for: 'branch' }, h('span', null, '브랜치'), branchIn),
  h('label', { class: 'field', for: 'token' }, h('span', null, 'GitHub 토큰'), tokenIn),
  h('label', { class: 'check', for: 'remember' }, remember, '이 기기에서 기억'),
  h('p', { class: 'help' },
    '대상 저장소 하나만 고른 fine-grained 토큰을 쓰세요. 권한은 Contents: Read and write입니다. 토큰은 이 브라우저에만 저장되고 파일에 쓰이지 않습니다. ',
    h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, '토큰 만들기')),
  status,
  submit);

  root.replaceChildren(form);
  (saved.repo ? tokenIn : repoIn).focus();
}

async function signIn(repo, token, remember) {
  // 읽기 확인: 저장소와 브랜치.
  await api('', { token, repo });
  await api(`/git/ref/heads/${repo.branch.split('/').map(encodeURIComponent).join('/')}`, { token, repo });
  // 쓰기 확인: 작은 blob을 만든다. 어디에도 연결되지 않는 객체라 저장소 내용은 바뀌지 않는다.
  // 게시에 필요한 Contents 쓰기 권한을 확인하며, 브랜치 보호 규칙까지는 확인하지 못한다.
  await api('/git/blobs', { method: 'POST', body: { content: 'write check', encoding: 'utf-8' }, token, repo });

  state.repo = repo;
  state.token = token;
  storage.set(localStorage, REPO_KEY, JSON.stringify({ repo: `${repo.owner}/${repo.name}`, branch: repo.branch }));
  storage.remove(localStorage, TOKEN_KEY);
  storage.remove(sessionStorage, TOKEN_KEY);
  storage.set(remember ? localStorage : sessionStorage, TOKEN_KEY, JSON.stringify({ token, repo }));
  await loadRemote();
  renderApp();
}

function signOut() {
  storage.remove(localStorage, TOKEN_KEY);
  storage.remove(sessionStorage, TOKEN_KEY);
  for (const { url } of state.pending.values()) URL.revokeObjectURL(url);
  state.pending.clear();
  state.token = null;
  state.data = null;
  state.notice = null;
  renderLogin();
}

function renderApp() {
  const count = totalChanges();
  const topbar = h('header', { class: 'topbar' },
    h('span', { class: 'title' }, 'MURINN 관리'),
    h('span', { class: 'muted repo' }, `${state.repo.owner}/${state.repo.name} · ${state.repo.branch}`),
    h('span', { class: 'spacer' }),
    h('span', { class: 'changes', 'aria-live': 'polite' }, mark(count > 0), count ? `변경 ${count}건` : '변경 없음'),
    state.view === 'preview'
      ? h('button', { type: 'button', class: 'btn', onclick: () => { state.view = 'edit'; renderApp(); } }, '편집으로')
      : h('button', { type: 'button', class: 'btn', disabled: state.busy, onclick: () => { state.view = 'preview'; renderApp(); } }, '미리보기'),
    h('button', { type: 'button', class: 'btn primary', disabled: state.busy || !count, onclick: publish }, state.busy ? '게시 중…' : '게시'),
    h('button', { type: 'button', class: 'btn logout', disabled: state.busy, onclick: signOut }, '로그아웃'));

  const body = state.view === 'preview' ? renderPreview() : h('div', { class: 'workbench', 'data-pane': state.pane, 'data-single': collByKey(state.coll).single ? '' : null },
    h('nav', { class: 'pane pane-collections', 'aria-label': '컬렉션' }, renderCollections()),
    h('section', { class: 'pane pane-items', 'aria-label': '항목' }, renderItems()),
    h('section', { class: 'pane pane-editor', 'aria-label': '편집' }, renderEditor()));

  root.replaceChildren(topbar, h('div', { id: 'notice' }), body);
  renderNotice();
}

// 편집 중에는 폼을 다시 그리지 않고 막대, 컬렉션, 항목 목록만 갱신한다 (입력 포커스 유지).
function refresh() {
  saveDraft();
  if (state.view !== 'edit') return renderApp();
  const count = totalChanges();
  const changes = root.querySelector('.changes');
  changes?.replaceChildren(mark(count > 0), count ? `변경 ${count}건` : '변경 없음');
  const publishBtn = root.querySelector('.topbar .btn.primary');
  if (publishBtn) publishBtn.disabled = state.busy || !count;
  root.querySelector('.pane-collections')?.replaceChildren(renderCollections());
  root.querySelector('.pane-items')?.replaceChildren(renderItems());
}

function renderCollections() {
  return h('div', null,
    h('div', { class: 'pane-head' }, h('h2', null, '컬렉션')),
    h('ul', { class: 'collections', role: 'list' }, COLLECTIONS.map((c) => {
      const ch = collectionChanges(c);
      return h('li', null, h('button', {
        type: 'button',
        class: 'coll',
        'aria-current': String(c.key === state.coll),
        onclick: () => {
          state.coll = c.key;
          state.index = 0;
          state.confirm = null;
          state.contactConfirm = null;
          state.pane = c.single ? 'editor' : 'items';
          renderApp();
        },
      }, mark(ch.count > 0), c.label, c.single ? null : h('span', { class: 'count' }, String(c.list(state.data).length))));
    })),
    // 휴대폰에서는 상단 막대의 로그아웃을 숨기므로 여기에 둔다.
    h('div', { class: 'mobile-only' }, h('button', { type: 'button', class: 'btn', disabled: state.busy, onclick: signOut }, '로그아웃')));
}

function itemTitle(coll, it) {
  return it[coll.titleKey] || it.id || '';
}

function renderItems() {
  const coll = collByKey(state.coll);
  if (coll.single) {
    return h('div', null, h('div', { class: 'pane-head' }, h('h2', null, coll.label)), h('p', { class: 'empty-pane' }, '항목 목록이 없는 컬렉션입니다. 오른쪽에서 바로 고치세요.'));
  }
  const list = coll.list(state.data);
  const ch = collectionChanges(coll);

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    if (state.index === i) state.index = j;
    else if (state.index === j) state.index = i;
    refresh();
  };

  const rows = list.map((it, i) => {
    if (state.confirm === i) return h('li', null, renderConfirm(coll, list, i));
    const thumb = coll.thumb?.(it);
    const title = itemTitle(coll, it);
    return h('li', null, h('div', { class: 'item', 'aria-current': String(i === state.index) },
      h('button', {
        type: 'button',
        class: 'item-open',
        onclick: () => { state.index = i; state.pane = 'editor'; state.confirm = null; renderApp(); },
      },
      mark(ch.items[i]),
      coll.thumb ? h('span', { class: 'item-thumb' }, thumb ? h('img', { src: mediaUrl(thumb), alt: '' }) : null) : null,
      h('span', { style: 'min-width:0' },
        h('span', { class: title ? 'item-name' : 'item-name empty' }, title || '이름 없음'),
        h('span', { class: 'item-sub' }, [it.id, coll.dateKey && it[coll.dateKey]].filter(Boolean).join(' · ')))),
      h('span', { class: 'item-moves' },
        h('button', { type: 'button', class: 'btn small', 'aria-label': `${title || '항목'} 위로`, disabled: i === 0, onclick: () => move(i, -1) }, arrow('up')),
        h('button', { type: 'button', class: 'btn small', 'aria-label': `${title || '항목'} 아래로`, disabled: i === list.length - 1, onclick: () => move(i, 1) }, arrow('down')),
        h('button', { type: 'button', class: 'btn small', 'aria-label': `${title || '항목'} 삭제`, onclick: () => { state.confirm = i; refresh(); } }, '삭제'))));
  });

  return h('div', null,
    h('div', { class: 'pane-head' },
      h('button', { type: 'button', class: 'btn small pane-back', onclick: () => { state.pane = 'collections'; renderApp(); } }, arrow('back'), '컬렉션'),
      h('h2', null, `${coll.label} ${list.length}`),
      h('button', {
        type: 'button',
        class: 'btn small primary',
        onclick: () => {
          list.push(coll.blank());
          state.index = list.length - 1;
          state.pane = 'editor';
          saveDraft();
          renderApp();
          root.querySelector('.pane-editor input')?.focus();
        },
      }, '새로 만들기')),
    list.length ? h('ul', { class: 'items', role: 'list' }, rows) : h('p', { class: 'empty-pane' }, '아직 항목이 없습니다.'));
}

// 이 항목만 쓰고, 저장소에 실제로 있는 미디어 경로.
function exclusiveMedia(item) {
  if (!state.treeComplete) return [];
  const others = new Set();
  const all = clone(state.data);
  for (const c of COLLECTIONS) {
    if (c.single) { mediaRefs(profileOnly(all.profile), others); continue; }
    for (const it of c.list(all)) if (!same(it, item)) mediaRefs(it, others);
  }
  return [...mediaRefs(item)].filter((p) => state.basePaths.has(p) && !others.has(p));
}

function renderConfirm(coll, list, i) {
  const item = list[i];
  const media = exclusiveMedia(item);
  const remove = (withMedia) => {
    list.splice(i, 1);
    if (withMedia) media.forEach((p) => state.deletes.add(p));
    for (const p of mediaRefs(item)) {
      if (state.pending.has(p) && !mediaRefs(state.data).has(p)) {
        URL.revokeObjectURL(state.pending.get(p).url);
        state.pending.delete(p);
      }
    }
    state.confirm = null;
    state.index = Math.max(0, Math.min(state.index, list.length - 1));
    saveDraft();
    renderApp();
  };
  return h('div', { class: 'confirm', role: 'group', 'aria-label': '삭제 확인' },
    h('span', null, `"${itemTitle(coll, item) || '이름 없음'}"을 지울까?`),
    media.length ? h('span', { class: 'muted' }, `이 항목만 쓰는 미디어 ${media.length}개: ${media.join(', ')}`) : null,
    h('span', { class: 'btns' },
      media.length ? h('button', { type: 'button', class: 'btn small primary', onclick: () => remove(true) }, '미디어도 삭제') : null,
      h('button', { type: 'button', class: 'btn small', onclick: () => remove(false) }, media.length ? '항목만 삭제' : '삭제'),
      h('button', { type: 'button', class: 'btn small', onclick: () => { state.confirm = null; refresh(); } }, '취소')));
}

function currentItem() {
  const coll = collByKey(state.coll);
  if (coll.single) return { coll, item: state.data.profile, index: -1 };
  const list = coll.list(state.data);
  return { coll, item: list[state.index], index: state.index };
}

function renderEditor() {
  const { coll, item, index } = currentItem();
  if (!item) return h('p', { class: 'empty-pane' }, '왼쪽에서 항목을 고르거나 새로 만드세요.');
  const errors = validateItem(coll, item, index);
  const title = coll.single ? coll.label : itemTitle(coll, item) || '새 항목';
  return h('div', { class: 'editor' },
    h('div', { class: 'editor-head' },
      h('button', { type: 'button', class: 'btn small pane-back', onclick: () => { state.pane = coll.single ? 'collections' : 'items'; renderApp(); } }, arrow('back'), '목록'),
      h('h2', null, title)),
    coll.sections
      ? coll.sections.map((sec) => h('section', { class: 'sec' },
        h('div', { class: 'sec-head' }, h('h3', null, sec.title), sec.hint ? h('p', { class: 'muted' }, sec.hint) : null),
        h('div', { class: sec.className ? `form ${sec.className}` : 'form' },
          sec.keys.map((k) => renderField(coll.fields.find((f) => f.key === k), item, errors, '', coll)))))
      : h('div', { class: 'form' }, coll.fields.map((f) => renderField(f, item, errors, '', coll))));
}

function fieldShell(f, key, errors, control) {
  const id = `f-${key.replace(/\./g, '-')}`;
  const err = errors[key];
  return h('div', { class: `field${f.full ? ' full' : ''}${err ? ' invalid' : ''}`, 'data-hint': f.hint || null },
    h('label', { for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null),
    control(id, err ? `${id}-err` : null),
    err ? h('span', { class: 'err', id: `${id}-err` }, err) : f.hint ? h('span', { class: 'muted' }, f.hint) : null);
}

// 입력 하나가 바뀌면 값만 고치고 오류 표시를 갱신한다.
function onEdit(item, key, value) {
  setPath(item, key, value);
  refresh();
  const { coll, item: cur, index } = currentItem();
  const errors = validateItem(coll, cur, index);
  for (const field of root.querySelectorAll('.pane-editor .field[data-key]')) {
    const k = field.dataset.key;
    const msg = errors[k];
    field.classList.toggle('invalid', Boolean(msg));
    const slot = field.querySelector(':scope > .err, :scope > .muted');
    if (msg) {
      const span = slot?.classList.contains('err') ? slot : h('span', { class: 'err' });
      span.textContent = msg;
      if (!slot) field.append(span);
      else if (slot !== span) slot.replaceWith(span);
    } else if (slot?.classList.contains('err')) {
      if (field.dataset.hint) slot.replaceWith(h('span', { class: 'muted' }, field.dataset.hint));
      else slot.remove();
    }
  }
  const head = root.querySelector('.editor-head h2');
  if (head && !coll.single) head.textContent = itemTitle(coll, cur) || '새 항목';
}

function renderField(f, item, errors, prefix, coll) {
  const key = prefix + f.key;
  const value = getPath(item, f.key);
  let el;
  if (f.type === 'media') {
    el = renderMedia(f, item, key, errors, coll);
  } else if (f.type === 'videos') {
    el = renderVideos(f, item, errors, coll);
  } else if (f.type === 'contacts') {
    el = renderContacts(item, errors);
  } else if (f.type === 'checkbox') {
    el = h('label', { class: `check${f.full ? ' full' : ''}` },
      h('input', { type: 'checkbox', checked: Boolean(value), onchange: (e) => onEdit(item, f.key, e.target.checked) }), f.label);
  } else {
    el = fieldShell(f, key, errors, (id, errId) => {
      const common = { id, 'aria-invalid': errId ? 'true' : null, 'aria-describedby': errId, 'aria-required': f.required ? 'true' : null };
      // 선택 항목은 비우면 null로 저장한다 (03-data-model: 끝 날짜 없음은 null).
      const toValue = (v) => (v === '' && (f.type === 'date' || f.type === 'url' || ['credit', 'meta', 'shaderNote'].includes(f.key)) && !f.required ? null : v);
      if (f.type === 'select') {
        return h('select', { ...common, onchange: (e) => onEdit(item, f.key, e.target.value) },
          f.options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
      }
      if (f.type === 'textarea') {
        return h('textarea', { ...common, oninput: (e) => onEdit(item, f.key, e.target.value) }, value ?? '');
      }
      return h('input', {
        ...common,
        type: f.type === 'url' ? 'url' : 'text',
        value: value ?? '',
        placeholder: f.type === 'date' ? 'YYYY.MM.DD' : f.type === 'url' ? (f.mailto ? 'https:// 또는 mailto:' : 'https://') : null,
        spellcheck: f.key === 'id' || f.type === 'url' ? false : null,
        oninput: (e) => onEdit(item, f.key, toValue(e.target.value)),
      });
    });
  }
  el.dataset.key = key;
  return el;
}

/* 미디어 */

const mediaUrl = (path) => state.pending.get(path)?.url ?? `../${path}`;

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '') || 'file';
}

// 확장자와 파일 앞부분 바이트로 형식을 확인한다. 실행 가능한 문서(html, svg 등)는 받지 않는다.
async function checkFile(file, kind) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!MEDIA[kind].exts.includes(ext)) return `${MEDIA[kind].label} 파일만 올릴 수 있습니다 (${MEDIA[kind].exts.join(', ')}).`;
  if (file.size >= MAX_BYTES) return '파일이 너무 큽니다. 95MB 미만이어야 합니다 (GitHub 한도 100MB).';
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  const ok = {
    png: b[0] === 0x89 && ascii(1, 4) === 'PNG',
    jpg: b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    jpeg: b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    gif: ascii(0, 4) === 'GIF8',
    webp: ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP',
    mp4: ascii(4, 8) === 'ftyp',
    glb: ascii(0, 4) === 'glTF',
  }[ext];
  if (!ok) return '파일 내용이 확장자와 맞지 않습니다.';
  return null;
}

function renderMedia(f, item, key, errors, coll) {
  const value = getPath(item, f.key);
  const status = h('span', { class: 'muted', 'aria-live': 'polite' });
  const input = h('input', {
    type: 'file',
    accept: MEDIA[f.kind].accept,
    id: `file-${key.replace(/\./g, '-')}`,
    onchange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      const owner = coll.single ? null : currentItem().item;
      const id = coll.single ? 'logo' : owner?.id;
      if (!coll.single && !(id && ID_RE.test(id))) { status.textContent = 'id를 먼저 올바르게 입력하세요.'; return; }
      const problem = await checkFile(file, f.kind);
      if (problem) { status.textContent = problem; return; }
      const ext = file.name.split('.').pop().toLowerCase();
      const name = f.file ? `${f.file}.${ext}` : sanitizeName(file.name);
      const dir = coll.single ? `media/${coll.folder}` : `media/${coll.folder}/${id}`;
      const path = `${dir}/${name}`;
      const prev = state.pending.get(path);
      if (prev) URL.revokeObjectURL(prev.url);
      state.pending.set(path, { file, url: URL.createObjectURL(file) });
      setPath(item, f.key, path);
      dropReplaced(value);
      refresh();
      root.querySelector('.pane-editor')?.replaceChildren(renderEditor());
      if (file.size > WARN_BYTES) setNotice(`${file.name}은 ${(file.size / 1048576).toFixed(1)}MB입니다. 방문자가 받기에 큽니다.`);
      // 직접 넣은 썸네일이 없으면 새 모델로 썸네일을 만든다.
      if (f.kind === 'glb' && owner && (!owner.poster || state.pending.get(owner.poster)?.auto)) makeThumb(owner, coll);
      if (f.kind === 'video' && (!item.poster || state.pending.get(item.poster)?.auto)) makeVideoThumb(item, path);
    },
  });
  const videoPath = f.key === 'poster' ? getPath(item, VIDEO_FIELDS.includes(f) ? 'src' : 'video') : null;
  const canThumb = f.key === 'poster' && coll.fields.some((x) => x.kind === 'glb') && item.src;

  // 빈 칸은 사이트에서 이 파일이 놓일 자리의 비율로 그린다 (로고는 정사각, 나머지는 444×250).
  const preview = value ? renderMediaPreview(f.kind, value, f.label) : h('div', { class: f.file === 'logo' ? 'media-empty square' : 'media-empty' }, '파일 없음');
  return fieldShell(f, key, errors, (id) => h('div', { class: 'media' },
    preview,
    value ? h('span', { class: 'media-path' }, value, state.pending.has(value) ? ' · 게시 전' : '') : null,
    h('span', { class: 'media-actions' },
      input,
      h('button', { type: 'button', class: 'btn small', id, onclick: () => input.click() }, value ? '바꾸기' : '파일 선택'),
      value && !f.required ? h('button', {
        type: 'button',
        class: 'btn small',
        onclick: () => { setPath(item, f.key, null); refresh(); root.querySelector('.pane-editor')?.replaceChildren(renderEditor()); },
      }, '비우기') : null,
      canThumb ? h('button', { type: 'button', class: 'btn small', onclick: () => makeThumb(item, coll) }, '썸네일 다시 만들기') : null,
      canThumb ? h('button', { type: 'button', class: 'btn small', onclick: () => makeThumb(item, coll, true) }, '지금 각도로 썸네일 만들기') : null,
      videoPath ? h('button', { type: 'button', class: 'btn small', onclick: () => makeVideoThumb(item, videoPath, true) }, '지금 장면으로 썸네일 만들기') : null,
      status)));
}

let modelViewerReady;

// 사이트 뷰어와 같은 처음 각도로 모델을 한 장 찍는다 (512×512, 투명 배경 webp).
// model-viewer는 화면 안에 있는 요소만 그리므로 화면 위에 투명하게 띄워서 찍는다.
async function captureThumb(src, orbit = '225deg 75deg auto') {
  modelViewerReady ||= import('../vendor/model-viewer.min.js');
  await modelViewerReady;
  // 성능에 따라 해상도를 절반까지 낮추는 기능을 끈다 (끄지 않으면 256×256으로 찍힌다).
  customElements.get('model-viewer').minimumRenderScale = 1;
  const mv = h('model-viewer', {
    src: mediaUrl(src),
    'camera-orbit': orbit,
    'shadow-intensity': '0',
    'interaction-prompt': 'none',
    style: 'position:fixed;left:0;top:0;width:512px;height:512px;opacity:0;pointer-events:none;z-index:-1',
  });
  try {
    await new Promise((resolve, reject) => {
      mv.addEventListener('load', resolve, { once: true });
      mv.addEventListener('error', () => reject(new Error('모델을 불러오지 못했습니다.')), { once: true });
      document.body.append(mv);
    });
    shadeLikeBlockbench(mv);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await mv.toBlob({ mimeType: 'image/webp', qualityArgument: 0.92, idealAspect: false });
  } finally {
    mv.remove();
  }
}

function dropReplaced(prev) {
  if (!prev || mediaRefs(state.data).has(prev)) return;
  if (state.pending.has(prev)) {
    URL.revokeObjectURL(state.pending.get(prev).url);
    state.pending.delete(prev);
  }
  if (state.basePaths.has(prev)) state.deletes.add(prev);
}

function setAutoPoster(item, path, blob) {
  if (!blob?.size) throw new Error('빈 이미지가 나왔습니다.');
  const file = new File([blob], path.split('/').pop(), { type: blob.type });
  const prev = item.poster;
  const old = state.pending.get(path);
  if (old) URL.revokeObjectURL(old.url);
  state.pending.set(path, { file, url: URL.createObjectURL(file), auto: true });
  item.poster = path;
  dropReplaced(prev);
  clearNotice();
  refresh();
  root.querySelector('.pane-editor')?.replaceChildren(renderEditor());
}

async function makeThumb(item, coll, fromPreview) {
  if (!item.src) return;
  if (!ID_RE.test(item.id || '')) { setNotice('썸네일을 만들려면 id를 먼저 올바르게 입력하세요.', true); return; }
  const preview = fromPreview ? root.querySelector(`model-viewer[data-path="${CSS.escape(item.src)}"]`) : null;
  if (fromPreview && !preview?.loaded) { setNotice('모델 미리보기가 뜬 뒤에 다시 누르세요.', true); return; }
  const orbit = preview?.getCameraOrbit();
  setNotice('모델로 썸네일을 만드는 중…');
  try {
    setAutoPoster(item, `media/${coll.folder}/${item.id}/poster.webp`, await captureThumb(item.src, orbit && `${orbit.theta}rad ${orbit.phi}rad auto`));
  } catch (err) {
    setNotice(`썸네일을 만들지 못했습니다: ${err.message}`, true);
  }
}

const POSTER_WIDTH = 1280;
const videoThumbRuns = new WeakMap();

function waitFor(el, event, start) {
  return new Promise((resolve, reject) => {
    const done = (fn) => () => { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener('error', fail); fn(); };
    const ok = done(resolve);
    const fail = done(() => reject(new Error('영상을 불러오지 못했습니다.')));
    const timer = setTimeout(done(() => reject(new Error('영상을 읽는 데 너무 오래 걸립니다.'))), 15000);
    el.addEventListener(event, ok);
    el.addEventListener('error', fail);
    start?.();
  });
}

async function captureFrame(src, at) {
  const video = h('video', { muted: true, playsinline: true, preload: 'auto' });
  try {
    await waitFor(video, 'loadeddata', () => { video.src = mediaUrl(src); });
    const d = video.duration;
    const time = at ?? (Number.isFinite(d) ? Math.min(Math.max(d * 0.1, 0.5), Math.max(d - 0.1, 0)) : 0);
    if (Math.abs(video.currentTime - time) > 0.01) await waitFor(video, 'seeked', () => { video.currentTime = time; });
    const scale = Math.min(1, POSTER_WIDTH / video.videoWidth);
    const canvas = h('canvas', { width: Math.round(video.videoWidth * scale), height: Math.round(video.videoHeight * scale) });
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const encode = (type) => new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
    const webp = await encode('image/webp');
    return webp?.type === 'image/webp' ? webp : encode('image/jpeg');
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function makeVideoThumb(item, src, fromPreview) {
  const preview = fromPreview ? root.querySelector(`video[data-path="${CSS.escape(src)}"]`) : null;
  const run = {};
  videoThumbRuns.set(item, run);
  const poster = item.poster;
  setNotice('영상으로 썸네일을 만드는 중…');
  try {
    const blob = await captureFrame(src, preview ? preview.currentTime : undefined);
    const stale = videoThumbRuns.get(item) !== run || ![item.video, item.src].includes(src)
      || (!fromPreview && item.poster !== poster && !state.pending.get(item.poster)?.auto);
    if (stale) {
      if (videoThumbRuns.get(item) === run) clearNotice();
      return;
    }
    const ext = blob?.type === 'image/webp' ? 'webp' : 'jpg';
    setAutoPoster(item, src.replace(/\.[^./]+$/, `-poster.${ext}`), blob);
  } catch (err) {
    setNotice(`썸네일을 만들지 못했습니다: ${err.message}`, true);
  }
}

function renderMediaPreview(kind, path, label) {
  const url = mediaUrl(path);
  if (kind === 'image') return h('div', { class: 'media-preview' }, h('img', { src: url, alt: label }));
  if (kind === 'video') return h('div', { class: 'media-preview' }, h('video', { src: url, controls: true, preload: 'metadata', playsinline: true, 'data-path': path }));
  const box = h('div', { class: 'media-preview' });
  const anims = h('div', { class: 'media-anims', 'aria-live': 'polite' });
  modelViewerReady ||= import('../vendor/model-viewer.min.js');
  modelViewerReady.then(() => {
    const mv = h('model-viewer', { src: url, alt: label, 'data-path': path, 'camera-controls': true, 'camera-orbit': '225deg 75deg auto', 'interaction-prompt': 'none', autoplay: true });
    mv.addEventListener('load', () => {
      shadeLikeBlockbench(mv);
      const names = mv.availableAnimations || [];
      const pick = (name) => {
        mv.animationName = name;
        mv.play();
        for (const b of anims.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === name));
      };
      anims.replaceChildren(h('span', { class: 'muted' }, names.length ? '애니메이션' : '애니메이션 없음'),
        ...names.map((n) => h('button', { type: 'button', class: 'btn small', 'aria-pressed': 'false', onclick: () => pick(n) }, n)));
      if (names.length) pick(names[0]);
    });
    mv.addEventListener('error', () => anims.replaceChildren(h('span', { class: 'err' }, '모델을 불러오지 못했습니다.')));
    box.append(mv);
  }).catch(() => anims.replaceChildren(h('span', { class: 'err' }, '3D 뷰어를 불러오지 못했습니다.')));
  return h('div', null, box, anims);
}

function renderContacts(item, errors) {
  const list = (item.contacts ||= []);
  const rerender = (focus) => {
    refresh();
    root.querySelector('.pane-editor')?.replaceChildren(renderEditor());
    for (const sel of [focus].flat().filter(Boolean)) {
      const el = root.querySelector(`.pane-editor ${sel}`);
      if (el && !el.disabled) return el.focus();
    }
  };
  const at = (i, sel) => `.contact:nth-child(${i + 1}) ${sel}`;
  const nameOf = (c, i) => c.label || contactType(c.type)?.name || `연락처 ${i + 1}`;
  const move = (i, d) => {
    [list[i], list[i + d]] = [list[i + d], list[i]];
    state.contactConfirm = null;
    rerender([at(i + d, `.item-moves .btn:nth-child(${d < 0 ? 1 : 2})`), at(i + d, `.item-moves .btn:nth-child(${d < 0 ? 2 : 1})`)]);
  };

  const blocks = list.map((c, i) => {
    const t = contactType(c.type);
    const name = nameOf(c, i);
    const input = (key, label, opts = {}) => {
      const fieldKey = `contacts.${i}.${key}`;
      const el = fieldShell({ key, label, required: opts.required, hint: opts.hint }, fieldKey, errors, (id, errId) => h('input', {
        id,
        type: 'text',
        value: c[key] ?? '',
        inputmode: opts.numeric ? 'numeric' : null,
        spellcheck: key === 'target' ? false : null,
        'aria-invalid': errId ? 'true' : null,
        'aria-describedby': errId,
        'aria-required': opts.required ? 'true' : null,
        oninput: (e) => onEdit(c, key, key === 'target' && e.target.value === '' ? null : e.target.value),
      }));
      el.dataset.key = fieldKey;
      return el;
    };
    const confirm = state.contactConfirm === i
      ? h('div', { class: 'confirm', role: 'group', 'aria-label': '연락처 빼기 확인' },
        h('span', null, `"${name}" 연락처를 빼시겠습니까?`),
        h('span', { class: 'btns' },
          h('button', { type: 'button', class: 'btn small primary', onclick: () => { list.splice(i, 1); state.contactConfirm = null; rerender(list.length ? at(Math.min(i, list.length - 1), 'select') : '.contacts > .btn'); } }, '빼기'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { state.contactConfirm = null; rerender(at(i, '.item-moves .btn:nth-child(3)')); } }, '취소')))
      : null;
    return h('li', { class: 'contact' },
      h('div', { class: 'contact-head' },
        h('select', {
          'aria-label': `${name} 종류`,
          onchange: (e) => {
            const next = CONTACT_TYPES[e.target.value];
            if (!c.label || c.label === t?.label) c.label = next.label;
            c.type = e.target.value;
            rerender(at(i, 'select'));
          },
        }, t ? null : h('option', { value: c.type, selected: true }, c.type),
        Object.entries(CONTACT_TYPES).map(([k, type]) => h('option', { value: k, selected: k === c.type }, type.name))),
        h('span', { class: 'item-moves' },
          h('button', { type: 'button', class: 'btn small', 'aria-label': `${name} 위로`, disabled: i === 0, onclick: () => move(i, -1) }, arrow('up')),
          h('button', { type: 'button', class: 'btn small', 'aria-label': `${name} 아래로`, disabled: i === list.length - 1, onclick: () => move(i, 1) }, arrow('down')),
          h('button', { type: 'button', class: 'btn small', 'aria-label': `${name} 빼기`, onclick: () => { state.contactConfirm = i; rerender(at(i, '.confirm .btn:last-child')); } }, '빼기'))),
      confirm,
      t ? h('div', { class: 'form' },
        input('label', '라벨'),
        input('value', t.value, { required: t.valueRequired, hint: t.valueHint }),
        input('target', t.target, { required: t.targetRequired, hint: t.targetHint, numeric: t.numeric })) : null);
  });

  return h('div', { class: 'field full contacts' },
    list.length ? h('ul', { class: 'contact-list', role: 'list' }, blocks) : h('p', { class: 'muted' }, '연락처가 없습니다.'),
    h('button', {
      type: 'button',
      class: 'btn small',
      onclick: () => {
        list.push({ type: 'link', label: '', value: '', target: null });
        state.contactConfirm = null;
        rerender(at(list.length - 1, 'select'));
      },
    }, '연락처 추가'));
}

function renderVideos(f, item, errors, coll) {
  item.videos ||= [];
  const list = item.videos;
  const rerender = () => { refresh(); root.querySelector('.pane-editor')?.replaceChildren(renderEditor()); };
  return h('div', { class: 'field full' },
    h('span', null, f.label),
    h('div', { class: 'subitems' },
      list.map((v, i) => h('div', { class: 'subitem' },
        h('div', { class: 'subitem-head' },
          `영상 ${i + 1}`,
          h('span', { class: 'item-moves' },
            h('button', { type: 'button', class: 'btn small', 'aria-label': `영상 ${i + 1} 위로`, disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; rerender(); } }, arrow('up')),
            h('button', { type: 'button', class: 'btn small', 'aria-label': `영상 ${i + 1} 아래로`, disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; rerender(); } }, arrow('down')),
            h('button', { type: 'button', class: 'btn small', 'aria-label': `영상 ${i + 1} 빼기`, onclick: () => { list.splice(i, 1); rerender(); } }, '빼기'))),
        VIDEO_FIELDS.map((vf) => renderField(vf, v, errors, `videos.${i}.`, coll)))),
      h('button', { type: 'button', class: 'btn small', style: 'align-self:flex-start', onclick: () => { list.push({ src: null, poster: null, caption: '' }); rerender(); } }, '영상 추가')));
}

/* 미리보기: 같은 출처 iframe에 사이트 렌더러를 띄우고 초안을 메시지로 넘긴다. */

function renderPreview() {
  // 게시 전 파일은 이 페이지가 만든 blob 주소로 바꿔서 넘긴다.
  const swap = (v) => {
    if (typeof v === 'string') return state.pending.get(v)?.url ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  const data = swap(state.data);
  const frame = h('iframe', { src: '../index.html?preview', title: '사이트 미리보기' });
  const onMessage = (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== 'murinn-preview-ready') return;
    frame.contentWindow.postMessage({ type: 'murinn-preview', data }, location.origin);
  };
  window.addEventListener('message', onMessage);
  // 미리보기를 떠나면 리스너를 정리한다.
  new MutationObserver((_, obs) => { if (!frame.isConnected) { window.removeEventListener('message', onMessage); obs.disconnect(); } })
    .observe(root, { childList: true });
  return h('div', { class: 'preview' }, frame);
}

/* 게시 */

function changedSummary(snapshot) {
  const colls = [];
  const ids = [];
  for (const c of COLLECTIONS) {
    if (!collectionChanges(c).count) continue;
    colls.push(c.key);
    if (!c.single) {
      const base = new Map(c.list(state.base).map((it) => [it.id, it]));
      for (const it of c.list(snapshot)) if (!base.has(it.id) || !same(it, base.get(it.id))) ids.push(it.id);
    }
  }
  const idPart = ids.length ? ` (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ` 외 ${ids.length - 3}` : ''})` : '';
  return `content: update ${colls.join(', ') || 'media'}${idPart}`;
}

function dataFiles(d) {
  const files = { profile: d.profile, plugins: d.plugins, models: d.models, sfx: d.sfx };
  return Object.entries(files).map(([name, value]) => [`data/${name}.json`, `${JSON.stringify(value, null, 2)}\n`]);
}

async function publish() {
  // 모든 항목을 검증하고, 첫 오류 항목으로 이동한다.
  for (const c of COLLECTIONS) {
    const items = c.single ? [state.data.profile] : c.list(state.data);
    const bad = items.findIndex((it, i) => Object.keys(validateItem(c, it, c.single ? -1 : i)).length);
    if (bad >= 0) {
      state.coll = c.key;
      state.index = Math.max(bad, 0);
      state.pane = 'editor';
      state.view = 'edit';
      renderApp();
      setNotice(`${c.label}에 고칠 항목이 있어서 게시하지 않았습니다.`, true);
      return;
    }
  }

  const snapshot = clone(state.data);
  state.busy = true;
  renderApp();
  setNotice('게시 중입니다. 끝날 때까지 이 탭을 닫지 마세요.');

  let commitSha = null;
  try {
    const ref = await api(`/git/ref/heads/${refPath()}`);
    if (ref.object.sha !== state.baseSha) {
      state.busy = false;
      renderApp();
      setNotice('다른 곳에서 저장소가 먼저 바뀌어 게시를 멈췄습니다. 원격 내용을 다시 불러온 뒤 변경을 다시 적용하세요.', true, [
        ['원격 다시 불러오기 (초안 버림)', reloadRemote],
      ]);
      return;
    }

    const refs = mediaRefs(snapshot);
    const entries = [];
    // 미디어는 하나씩 올려 메모리 사용을 줄인다.
    for (const [path, { file }] of state.pending) {
      if (!refs.has(path)) continue;
      setNotice(`올리는 중: ${path}`);
      const blob = await api('/git/blobs', { method: 'POST', body: { content: await fileToBase64(file), encoding: 'base64' } });
      entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const [path, content] of dataFiles(snapshot)) {
      if (state.baseText.get(path) !== content) entries.push({ path, mode: '100644', type: 'blob', content });
    }
    const deleted = [...state.deletes].filter((p) => state.basePaths.has(p) && !refs.has(p));
    for (const path of deleted) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    if (!entries.length) {
      state.busy = false;
      renderApp();
      setNotice('게시할 변경이 없습니다.');
      return;
    }

    setNotice('커밋을 만드는 중입니다.');
    const tree = await api('/git/trees', { method: 'POST', body: { base_tree: state.baseTreeSha, tree: entries } });
    const commit = await api('/git/commits', { method: 'POST', body: { message: changedSummary(snapshot), tree: tree.sha, parents: [state.baseSha] } });
    commitSha = commit.sha;
    try {
      await api(`/git/refs/heads/${refPath()}`, { method: 'PATCH', body: { sha: commitSha, force: false } });
    } catch (err) {
      // 응답만 잃었을 수 있으니 원격 브랜치가 새 커밋을 가리키는지 다시 확인한다.
      const now = await api(`/git/ref/heads/${refPath()}`).catch(() => null);
      if (now?.object.sha !== commitSha) throw err;
    }

    // 게시 확인 뒤에만 기준을 옮기고 초안을 비운다.
    state.base = snapshot;
    state.baseText = new Map(dataFiles(snapshot));
    state.data = clone(snapshot);
    state.baseSha = commitSha;
    state.baseTreeSha = tree.sha;
    for (const e of entries) {
      if (e.sha === null) state.basePaths.delete(e.path);
      else state.basePaths.add(e.path);
    }
    for (const { url } of state.pending.values()) URL.revokeObjectURL(url);
    state.pending.clear();
    state.deletes.clear();
    state.busy = false;
    saveDraft();
    renderApp();
    setNotice('게시했습니다. 사이트에 반영되기까지 1~2분 걸립니다.');
  } catch (err) {
    state.busy = false;
    renderApp();
    setNotice(`게시하지 못했습니다. 초안은 그대로 남아 있습니다. ${explain(err)}`, true);
  }
}

async function reloadRemote() {
  storage.remove(localStorage, draftKey());
  for (const { url } of state.pending.values()) URL.revokeObjectURL(url);
  state.pending.clear();
  clearNotice();
  try {
    await loadRemote();
    state.index = 0;
    renderApp();
  } catch (err) {
    setNotice(explain(err), true);
  }
}

/* 시작 */

async function boot() {
  const raw = storage.get(sessionStorage, TOKEN_KEY) || storage.get(localStorage, TOKEN_KEY);
  if (!raw) return renderLogin();
  try {
    const { token, repo } = JSON.parse(raw);
    state.repo = repo;
    state.token = token;
    await api('');
    await loadRemote();
    renderApp();
  } catch (err) {
    state.token = null;
    renderLogin(err instanceof ApiError ? explain(err) : '');
  }
}

window.addEventListener('beforeunload', (e) => {
  if (state.busy || state.pending.size) e.preventDefault();
});

boot();
