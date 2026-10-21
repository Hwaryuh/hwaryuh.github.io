// data/*.json을 읽어 페이지를 그린다.
// 데이터 속 텍스트는 모두 텍스트 노드로 넣는다. innerHTML은 쓰지 않는다.

const SVG_NS = 'http://www.w3.org/2000/svg';

// 요소를 만든다. 문자열 자식은 텍스트 노드가 된다.
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

function icon(paths, size, filled) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  if (!filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const ICON = {
  external: () => icon(['M14 4h6v6', 'M20 4L10 14', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'], 14),
  back: () => icon(['M15 6l-6 6 6 6'], 18),
  play: () => icon(['M7 4.8v14.4L19 12z'], 20),
  pause: () => icon(['M8.5 5v14', 'M15.5 5v14'], 20),
  sound: () => icon(['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M15.5 9a4 4 0 0 1 0 6', 'M18.5 6a8.5 8.5 0 0 1 0 12'], 20),
  muted: () => icon(['M4 9.5h3.5L12 5.5v13l-4.5-4H4z', 'M16 9.5l5 5', 'M21 9.5l-5 5'], 20),
  full: () => icon(['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'], 20),
  exitFull: () => icon(['M9 4v5H4', 'M15 4v5h5', 'M15 20v-5h5', 'M9 20v-5H4'], 20),
};

// 링크는 https:// 주소만 쓴다.
// Discord 사용자 ID (숫자 17~20자리). JSON에서 숫자로 두면 자릿수가 깨지므로 문자열로 둔다.
const DISCORD_ID_RE = /^\d{17,20}$/;
const safeUrl = (url) => (typeof url === 'string' && /^https:\/\//i.test(url) ? url : null);

const STATUS = { wip: '진행 중', stopped: '개발 중단' };

// 기간 문자열 (2025.01.18 – 2025.01.23, 끝이 없으면 상태).
function period(start, end, status) {
  if (!start) return '';
  if (end) return `${start} – ${end}`;
  return STATUS[status] ? `${start} – ${STATUS[status]}` : start;
}

const joinDot = (...parts) => parts.filter(Boolean).join(' · ');

// JSON 형태가 어긋나도 렌더링이 멈추지 않게 객체와 배열을 걸러낸다.
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// 다른 영상이 재생되면 나머지는 멈춘다.
document.addEventListener('play', (e) => {
  for (const v of document.querySelectorAll('video')) if (v !== e.target) v.pause();
}, true);

function animateTheater(el, rect, open) {
  const quick = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const last = el.getBoundingClientRect();
  const away = { transform: `translate(${rect.left - last.left}px, ${rect.top - last.top}px) scale(${rect.width / last.width})` };
  const home = { transform: 'none' };
  const ms = open ? 420 : 320;
  el.style.transformOrigin = '0 0';
  const move = el.animate(open ? [away, home] : [home, away], {
    duration: quick ? 0 : ms,
    easing: open ? 'cubic-bezier(0.16, 1, 0.3, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
    fill: open ? 'none' : 'forwards',
  });
  el.animate(open ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration: quick ? 0 : 240, easing: 'linear', fill: open ? 'none' : 'forwards', pseudoElement: '::backdrop' });
  el.querySelector('.bar').animate(open
    ? [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }]
    : [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }],
  { duration: quick ? 0 : ms, easing: 'linear', fill: open ? 'none' : 'forwards' });
  return move.finished;
}

function player({ src, poster, label }) {
  if (!src) return null;
  let video = null;
  let muted = false;
  const img = h('img', { class: 'poster', alt: '', loading: 'lazy' });
  const pic = h('div', { class: 'pic', onclick: () => toggle() }, img);
  const ctl = () => h('button', { type: 'button', class: 'ctl' });
  const playBtn = ctl();
  const muteBtn = ctl();
  const fullBtn = ctl();
  const time = h('span', { class: 'time' }, h('b'), h('span'));
  const seek = h('input', { type: 'range', class: 'seek', min: 0, max: 1000, step: 1, value: 0, disabled: true, 'aria-label': '재생 위치' });
  const screen = h('div', { class: 'screen' }, pic,
    h('div', { class: 'bar' }, seek, h('div', { class: 'ctlrow' }, playBtn, time, muteBtn, fullBtn)));
  const frame = h('dialog', { class: 'frame' }, screen);
  const box = h('div', { class: 'player' }, frame);

  const set = (btn, ic, name) => { btn.replaceChildren(ic()); btn.setAttribute('aria-label', name); };
  const playing = () => video && !video.paused && !video.ended;
  const paintPlay = () => (playing() ? set(playBtn, ICON.pause, `${label} 일시 정지`) : set(playBtn, ICON.play, `${label} 재생`));
  const paintSound = () => (muted ? set(muteBtn, ICON.muted, '소리 켜기') : set(muteBtn, ICON.sound, '소리 끄기'));
  const theater = () => frame.matches(':modal');
  const paintFull = () => (theater() ? set(fullBtn, ICON.exitFull, '크게 보기 끝내기') : set(fullBtn, ICON.full, '크게 보기'));
  let seeking = false;
  function paintTime() {
    const d = video?.duration;
    const now = video?.currentTime || 0;
    const known = Number.isFinite(d) && d > 0;
    time.firstChild.textContent = known ? formatTime(Math.floor(now)) : '';
    time.lastChild.textContent = known ? ` / ${formatTime(d)}` : '';
    if (!seeking) seek.value = known ? Math.round((now / d) * 1000) : 0;
    seek.style.setProperty('--p', `${seek.value / 10}%`);
  }

  function makeVideo(preload) {
    if (video) return video;
    video = h('video', { src, preload, playsinline: true });
    video.muted = muted;
    for (const e of ['play', 'pause', 'ended']) video.addEventListener(e, paintPlay);
    for (const e of ['timeupdate', 'loadedmetadata', 'durationchange', 'emptied']) video.addEventListener(e, paintTime);
    video.addEventListener('volumechange', () => { muted = video.muted; paintSound(); });
    video.addEventListener('dblclick', fullscreen);
    pic.prepend(video);
    seek.disabled = false;
    return video;
  }
  function start() {
    makeVideo('auto');
    box.classList.add('started');
    video.play().catch(() => {});
  }
  function toggle() {
    if (playing()) video.pause();
    else start();
  }

  seek.addEventListener('input', () => {
    seeking = true;
    if (video?.duration) video.currentTime = (seek.value / 1000) * video.duration;
    paintTime();
  });
  seek.addEventListener('change', () => { seeking = false; });
  playBtn.addEventListener('click', toggle);
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    if (video) video.muted = muted;
    paintSound();
  });
  function fullscreen() {
    if (document.fullscreenElement === screen) return void document.exitFullscreen();
    closeTheater(true);
    if (screen.requestFullscreen) screen.requestFullscreen().catch(() => {});
    else video?.webkitEnterFullscreen?.();
  }
  let closing = null;
  function openTheater() {
    const from = frame.getBoundingClientRect();
    box.style.height = `${box.offsetHeight}px`;
    frame.showModal();
    paintFull();
    animateTheater(frame, from, true);
  }
  function closeTheater(now) {
    if (!theater() || (closing && !now)) return;
    const done = () => {
      closing = null;
      if (theater()) frame.close();
      for (const a of frame.getAnimations({ subtree: true })) a.cancel();
      if (!now && !reduceMotion.matches) frame.querySelector('.bar').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
    };
    if (now) return done();
    closing = animateTheater(frame, box.getBoundingClientRect(), false).then(done, done);
  }
  fullBtn.addEventListener('click', () => {
    if (!frame.showModal) return fullscreen();
    if (theater()) closeTheater();
    else openTheater();
  });
  frame.addEventListener('cancel', (e) => { e.preventDefault(); closeTheater(); });
  frame.addEventListener('click', (e) => { if (e.target === frame) closeTheater(); });
  frame.addEventListener('close', () => { box.style.height = ''; paintFull(); });

  box.addEventListener('keydown', (e) => {
    if (!video || e.target.type === 'range' || e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'k' || (k === ' ' && e.target.tagName !== 'BUTTON')) toggle();
    else if (k === 'arrowleft') video.currentTime -= 5;
    else if (k === 'arrowright') video.currentTime += 5;
    else if (k === 'm') muteBtn.click();
    else if (k === 'f') fullBtn.click();
    else return;
    e.preventDefault();
  });

  box.reset = () => {
    closeTheater(true);
    if (video) {
      video.pause();
      video.remove();
      video.removeAttribute('src');
      video.load();
      video = null;
      seek.disabled = true;
    }
    box.classList.remove('started');
    paintTime();
    paintPlay();
  };

  box.load = (next, autoplay) => {
    ({ src, poster, label } = next);
    box.reset();
    img.hidden = !poster;
    if (poster) img.src = poster;
    else img.removeAttribute('src');
    if (autoplay) start();
  };

  box.load({ src, poster, label }, false);
  paintPlay();
  paintSound();
  paintFull();
  return box;
}

/* Profile */

function renderProfile(p) {
  const logo = p.team?.logo
    ? h('img', { class: 'team-logo', src: p.team.logo, alt: '' })
    : h('span', { class: 'team-logo empty', 'aria-hidden': 'true' });
  const teamUrl = safeUrl(p.team?.url);
  // 한 번 올린 뒤에만 되돌아가는 글리치를 켠다 (처음 그릴 때 되돌아가는 글리치가 재생되지 않게).
  const touch = (e) => e.currentTarget.classList.add('touched');

  const contribs = arr(p.contributions).map((c) => {
    const url = safeUrl(c.url);
    const server = url
      ? h('a', { class: 'ext', href: url, target: '_blank', rel: 'noopener' }, c.server, ICON.external())
      : c.server;
    return h('li', { class: 'contrib' },
      h('span', { class: 'contrib-server' }, server),
      h('span', { class: 'contrib-period' }, period(c.start, c.end)),
      h('span', { class: 'contrib-work' }, c.work));
  });

  return h('section', { class: 'profile wrap', 'aria-label': 'Profile' },
    h('div', { class: 'identity' },
      h('div', { class: 'identity-main' },
        h('h1', { class: 'name' }, p.name),
        p.intro ? h('p', { class: 'intro' }, p.intro) : null),
      p.team?.name ? h('div', { class: 'team' }, logo, h(teamUrl ? 'a' : 'p', {
        class: 'team-name', onpointerenter: touch, onfocus: touch,
        ...(teamUrl ? { href: teamUrl, target: '_blank', rel: 'noopener' } : {}),
      },
        h('span', { class: 'base' }, p.team.name),
        h('span', { class: 'px', 'aria-hidden': 'true' }, p.team.name))) : null),
    h('div', null,
      p.discord ? h('p', { class: 'discord' }, h('span', { class: 'small' }, 'DISCORD'), ' ',
        DISCORD_ID_RE.test(p.discordId || '') ? h('a', { href: `https://discord.com/users/${p.discordId}`, target: '_blank', rel: 'noopener' }, p.discord) : p.discord) : null,
      contribs.length ? h('ul', { class: 'contribs', role: 'list' }, contribs) : null));
}

/* Plugins 목록 */

function renderPlugins(list) {
  return h('section', { id: 'plugins', class: 'section wrap' },
    h('div', { class: 'section-head' }, h('h2', null, '플러그인')),
    h('div', { class: 'rows' }, list.map((pl) => {
      const first = arr(pl.videos)[0];
      return h('article', { class: 'row' },
        player({ src: first?.src, poster: first?.poster, label: pl.title }),
        h('div', { class: 'row-text' },
          h('h3', null, pl.title),
          pl.summary ? h('p', { class: 'desc' }, pl.summary) : null,
          h('a', { class: 'more', href: `#/plugins/${encodeURIComponent(pl.id)}` }, '자세히 보기 →')));
    })));
}

/* Plugins 상세 */

function renderDetail(list, id) {
  const i = list.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const pl = list[i];
  const videos = arr(pl.videos);
  const prev = list[i - 1];
  const next = list[i + 1];

  const stage = videos.length ? player(videos[0]) : null;
  stage?.classList.add('stage');
  const caption = h('p', { class: 'stage-caption' });
  const thumbs = videos.map((v, n) => h('button', {
    type: 'button',
    class: 'thumb',
    // 모바일에서는 캡션을 숨기므로 버튼 이름을 직접 준다.
    'aria-label': v.caption || `영상 ${n + 1}`,
    onclick: () => select(n, true),
  },
  h('span', { class: 'thumb-img' }, v.poster ? h('img', { src: v.poster, alt: '', loading: 'lazy' }) : null),
  h('span', { class: 'thumb-cap' }, v.caption || `영상 ${n + 1}`)));

  function select(n, play) {
    const v = videos[n];
    stage?.load({ src: v.src, poster: v.poster, label: v.caption || pl.title }, play);
    caption.textContent = joinDot(v.caption, `${n + 1} / ${videos.length}`);
    thumbs.forEach((t, k) => t.setAttribute('aria-pressed', String(k === n)));
  }
  if (videos.length) select(0, false);

  const infoRow = (label, value) => (value ? h('div', { class: 'info-row' }, h('dt', null, label), h('dd', null, value)) : null);
  const pagerLink = (p, label, cls) => (p
    ? h('a', { class: cls, href: `#/plugins/${encodeURIComponent(p.id)}` }, h('span', { class: 'label' }, label), h('span', { class: 'title' }, p.title))
    : null);

  return h('article', { class: 'detail wrap' },
    h('div', { class: 'detail-top' },
      h('a', { class: 'back', href: './', onclick: backHome, 'aria-label': '플러그인 목록으로' }, ICON.back())),
    h('div', { class: 'detail-title' },
      h('h1', { tabindex: '-1' }, pl.title),
      pl.subtitle ? h('p', { class: 'sub' }, pl.subtitle) : null),
    h('div', { class: videos.length ? 'detail-body' : 'detail-body no-media' },
      videos.length
        ? h('div', { class: 'detail-media' },
          stage,
          caption,
          videos.length > 1 ? h('div', { class: 'thumbs' }, thumbs) : null)
        : null,
      h('aside', { class: 'info' },
        h('dl', null,
          infoRow('제작 기간', period(pl.start, pl.end, pl.status)),
          infoRow('플랫폼', pl.env)),
        pl.description || (pl.usesShader && pl.shaderNote)
          ? h('div', { class: 'info-desc' },
            pl.description ? h('p', { class: 'desc' }, pl.description) : null,
            pl.usesShader && pl.shaderNote ? h('p', { class: 'note' }, pl.shaderNote) : null)
          : null)),
    h('nav', { class: 'pager', 'aria-label': '이전, 다음 플러그인' },
      pagerLink(prev, '이전', 'prev'),
      pagerLink(next, '다음', 'next')));
}

/* Models */

let modelViewerReady;
let resizeObserver = null;
const loadModelViewer = () => (modelViewerReady ||= import('./vendor/model-viewer.min.js'));

const OPEN_MS = 420;
const CLOSE_MS = 280;
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// 높이를 from에서 to로 바꾼다. min-height를 잠시 풀어야 0까지 줄어든다.
function slide(el, from, to, ms, easing) {
  return el.animate(
    [{ height: `${from}px`, minHeight: '0px' }, { height: `${to}px`, minHeight: '0px' }],
    { duration: reduceMotion.matches ? 0 : ms, easing },
  );
}

function renderModels(items) {
  let openTile = null;
  let panel = null;

  const grid = h('div', { class: 'grid' });

  // 패널이 아래로 펼쳐지고 접힌다. 타일이 늘어나는 것은 CSS 전환이 같은 시간으로 맞춘다.
  function collapse(p) {
    p.classList.add('closing');
    slide(p, p.offsetHeight, 0, CLOSE_MS, EASE_IN).finished.then(() => p.remove(), () => p.remove());
  }

  function close() {
    if (!openTile) return;
    openTile.setAttribute('aria-expanded', 'false');
    openTile = null;
    if (panel) collapse(panel);
    panel = null;
    grid.classList.remove('has-open');
  }

  // 선택 카드가 맨 왼쪽, 맨 오른쪽 열인지에 따라 패널 위 모서리를 정한다.
  function updateCorners() {
    if (!panel || !openTile) return;
    const g = grid.getBoundingClientRect();
    const t = openTile.getBoundingClientRect();
    panel.classList.toggle('first', Math.abs(t.left - g.left) < 1);
    panel.classList.toggle('last', Math.abs(t.right - g.right) < 1);
  }

  function open(tile, item) {
    if (openTile === tile) return close();
    // 같은 줄의 다른 카드로 옮길 때는 패널을 접지 않고 높이만 바꾼다.
    const sameRow = openTile && panel && openTile.offsetTop === tile.offsetTop;
    // 같은 줄에서 접히는 중인 패널이 있으면 그 높이에서 다시 펼친다 (패널이 두 겹으로 보이지 않게).
    const ghost = [...grid.querySelectorAll('.panel.closing')].find((p) => p.previousElementSibling?.offsetTop === tile.offsetTop);
    const fromHeight = sameRow ? panel.offsetHeight : ghost ? ghost.offsetHeight : 0;
    ghost?.remove();
    if (openTile) openTile.setAttribute('aria-expanded', 'false');
    if (sameRow) panel.remove();
    else if (panel) collapse(panel);
    openTile = tile;
    tile.setAttribute('aria-expanded', 'true');
    grid.classList.add('has-open');
    // 패널은 선택 카드 바로 뒤에 두고, grid-auto-flow: dense가 같은 줄의 나머지 카드를 패널 위 줄로 채운다.
    panel = buildPanel(item);
    tile.after(panel);
    updateCorners();
    slide(panel, fromHeight, panel.offsetHeight, OPEN_MS, EASE_OUT);
  }

  grid.append(...items.map((item) => {
    const tile = h('button', {
      type: 'button',
      class: 'tile',
      'aria-label': item.name,
      'aria-expanded': 'false',
      onclick: () => open(tile, item),
    }, item.poster ? h('img', { src: item.poster, alt: '', loading: 'lazy' }) : null);
    return tile;
  }));

  // 패널이 열려 있으면 Esc로 닫고 선택했던 카드로 포커스를 돌린다.
  grid.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !openTile) return;
    const tile = openTile;
    close();
    tile.focus();
  });

  resizeObserver = new ResizeObserver(updateCorners);
  resizeObserver.observe(grid);

  return h('section', { id: 'models', class: 'section wrap' },
    h('div', { class: 'section-head' }, h('h2', null, '3D 모델')),
    grid);
}

function buildPanel(item) {
  const viewer = h('div', { class: 'viewer' });
  const animLabel = h('p', { class: 'panel-label', hidden: true }, '애니메이션');
  const anims = h('div', { class: 'anims', hidden: true });

  const showPoster = () => {
    if (item.poster && !viewer.querySelector(':scope > img')) viewer.prepend(h('img', { src: item.poster, alt: item.name }));
  };

  if (item.src) {
    loadModelViewer().then(() => {
      const mv = h('model-viewer', {
        src: item.src,
        // 모델을 받는 동안 썸네일을 보여준다.
        poster: item.poster,
        alt: item.name,
        'camera-controls': true,
        // 처음 보이는 각도: 비스듬한 3/4 시점
        'camera-orbit': '225deg 75deg auto',
        'interaction-prompt': 'none',
        'shadow-intensity': '0',
        autoplay: true,
      });
      mv.addEventListener('load', () => {
        const names = mv.availableAnimations || [];
        if (!names.length) return;
        const pick = (name) => {
          mv.animationName = name;
          mv.play();
          for (const b of anims.children) b.setAttribute('aria-pressed', String(b.textContent === name));
        };
        anims.replaceChildren(...names.map((name) => h('button', { type: 'button', class: 'anim', onclick: () => pick(name) }, name)));
        animLabel.hidden = false;
        anims.hidden = false;
        pick(names[0]);
      });
      // 모델을 불러오지 못하면 뷰어 대신 썸네일을 둔다.
      mv.addEventListener('error', () => { mv.remove(); showPoster(); });
      viewer.prepend(mv);
    }).catch(showPoster);
  } else {
    showPoster();
  }

  return h('div', { class: 'panel', role: 'region', 'aria-label': item.name },
    viewer,
    h('div', { class: 'panel-info' },
      h('h3', null, item.name),
      item.meta ? h('p', { class: 'panel-meta' }, item.meta) : null,
      animLabel,
      anims,
      item.credit ? h('p', { class: 'panel-credit' }, item.credit) : null));
}

/* SFX */

function renderSfx(list) {
  return h('section', { id: 'sfx', class: 'section wrap' },
    h('div', { class: 'section-head' }, h('h2', null, 'Sound / BGM')),
    h('div', { class: 'rows' }, list.map((s) => {
      return h('article', { class: 'row' },
        player({ src: s.video, poster: s.poster, label: s.title }),
        h('div', { class: 'row-text' },
          h('h3', null, s.title),
          s.description ? h('p', { class: 'desc' }, s.description) : null,
          s.credit ? h('p', { class: 'note credit' }, s.credit) : null));
    })));
}

// 불러오는 동안 보여주는 회색 줄. failed가 참이면 반짝임을 멈추고 다시 시도 버튼을 둔다.
function renderSkeleton(failed, retry) {
  const line = (cls = '') => h('span', { class: `skel ${cls}` });
  const row = () => h('div', { class: 'row' },
    h('div', { class: 'player' }, h('div', { class: 'pic skel-media' })),
    h('div', { class: 'row-text' }, line('w30'), line('skel-title w50'), line('w90'), line('w70')));
  return h('div', { class: failed ? 'skeleton failed' : 'skeleton' },
    h('div', { class: 'profile wrap', 'aria-hidden': 'true' },
      h('div', { class: 'identity' },
        h('div', { class: 'identity-main' }, line('skel-name'), line('w30'))),
      h('div', null, line('w90'), line('w70'))),
    // 다시 시도는 첫 화면 안에 보이도록 Profile 자리 바로 아래에 둔다.
    failed ? h('div', { class: 'wrap skel-retry' }, h('button', { type: 'button', class: 'pill', onclick: retry }, '다시 시도')) : null,
    h('div', { class: 'section wrap', 'aria-hidden': 'true' },
      h('div', { class: 'rows' }, row(), row())));
}

function renderFooter(p) {
  if (!p.name) return [];
  return [
    h('span', null, `© ${new Date().getFullYear()} ${p.name.toLowerCase()}`),
    h('p', { class: 'powered' }, h('span', { class: 'powered-by' }, 'Powered by'), h('span', { class: 'powered-name' }, 'Semicolon Studio')),
  ];
}

/* 라우팅 */

const homeEl = document.getElementById('home');
const detailEl = document.getElementById('detail');
const footerEl = document.getElementById('footer');
let site = null;
let homeScroll = null;
let homeShown = false;
let onDetail = false;
let lastDetailId = null;

function detailId() {
  const m = location.hash.match(/^#\/plugins\/([^/]+)$/);
  try {
    const id = m && decodeURIComponent(m[1]);
    return site?.plugins.some((p) => p.id === id) ? id : null;
  } catch { return null; }
}

function route() {
  if (!site) return;
  const id = detailId();
  const view = id && renderDetail(site.plugins, id);

  if (view) {
    if (!onDetail && !homeEl.hidden) homeScroll = homeShown ? window.scrollY : null;
    onDetail = true;
    lastDetailId = id;
    for (const p of homeEl.querySelectorAll('.player')) p.reset();
    detailEl.replaceChildren(view);
    homeEl.hidden = true;
    footerEl.hidden = true;
    detailEl.hidden = false;
    window.scrollTo(0, 0);
    // 누른 링크가 숨겨지므로 포커스를 상세 제목으로 옮긴다.
    detailEl.querySelector('h1')?.focus({ preventScroll: true });
    return;
  }

  const wasDetail = onDetail;
  onDetail = false;
  detailEl.replaceChildren();
  detailEl.hidden = true;
  homeEl.hidden = false;
  footerEl.hidden = false;
  const target = location.hash.length > 1 && !location.hash.startsWith('#/')
    ? document.getElementById(location.hash.slice(1))
    : null;
  // 보던 플러그인의 줄과 '자세히 보기' 링크를 찾는다.
  const link = wasDetail && lastDetailId
    ? homeEl.querySelector(`a.more[href="#/plugins/${CSS.escape(encodeURIComponent(lastDetailId))}"]`)
    : null;
  if (wasDetail && homeScroll !== null) window.scrollTo(0, homeScroll);
  else if (link) link.closest('.row').scrollIntoView({ block: 'center' });
  else if (target) target.scrollIntoView();
  else if (wasDetail) window.scrollTo(0, 0);
  link?.focus({ preventScroll: true });
  homeShown = true;
}

let navTransition = null;

function backHome(e) {
  if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  history.pushState(null, '', location.pathname + location.search);
  onHashChange();
}

function onHashChange() {
  const id = detailId();
  const between = !!id && onDetail && id !== lastDetailId;
  if ((!between && !!id === onDetail) || !document.startViewTransition || reduceMotion.matches) return route();
  if (!between) return void document.startViewTransition(route);
  const root = document.documentElement;
  const ids = site.plugins.map((p) => p.id);
  root.dataset.nav = ids.indexOf(id) < ids.indexOf(lastDetailId) ? 'prev' : 'next';
  detailEl.style.viewTransitionName = 'detail-old';
  const t = navTransition = document.startViewTransition(() => {
    detailEl.style.viewTransitionName = '';
    route();
  });
  t.finished.finally(() => { if (navTransition === t) delete root.dataset.nav; });
}

// 데이터를 받아 페이지 전체를 그린다. 관리자 페이지 미리보기도 이 함수를 쓴다.
export function render(data) {
  data = obj(data);
  site = {
    profile: obj(data.profile),
    plugins: arr(data.plugins),
    models: arr(data.models),
    sfx: arr(data.sfx),
  };
  const models = site.models;
  resizeObserver?.disconnect();
  resizeObserver = null;
  homeEl.replaceChildren(...[
    renderProfile(site.profile),
    site.plugins.length ? renderPlugins(site.plugins) : null,
    models.length ? renderModels(models) : null,
    site.sfx.length ? renderSfx(site.sfx) : null,
  ].filter(Boolean));
  footerEl.replaceChildren(...renderFooter(site.profile));
  onDetail = false;
  route();
}

async function loadJson(name) {
  const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name}.json ${res.status}`);
  return res.json();
}

async function boot() {
  history.scrollRestoration = 'manual';
  window.addEventListener('hashchange', onHashChange);
  // 관리자 페이지 미리보기: 같은 출처의 부모 창이 보낸 초안으로 그린다.
  if (new URLSearchParams(location.search).has('preview')) {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== 'murinn-preview') return;
      render(e.data.data);
    });
    window.parent.postMessage({ type: 'murinn-preview-ready' }, location.origin);
    return;
  }
  await load();
}

async function load() {
  homeEl.replaceChildren(renderSkeleton(false));
  homeEl.setAttribute('aria-busy', 'true');
  footerEl.replaceChildren();
  // 파일 하나가 실패해도 나머지 섹션은 그린다.
  const names = ['profile', 'plugins', 'models', 'sfx'];
  const results = await Promise.allSettled(names.map(loadJson));
  homeEl.removeAttribute('aria-busy');
  const data = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') data[names[i]] = r.value;
    else console.error(r.reason);
  });
  // 모두 실패하면 멈춘 회색 줄과 다시 시도 버튼만 남긴다.
  if (!Object.keys(data).length) {
    homeEl.replaceChildren(renderSkeleton(true, load));
    homeEl.querySelector('.skel-retry button')?.focus({ preventScroll: true });
    return;
  }
  render(data);
}

/* 배경 디더링 */

// 8×8 Bayer 행렬로 3px 칸을 찍는다. 가장자리에서 진하고, 화면 폭의 36% 안쪽으로 들어오면 기존 점만 남는다.
// 무늬는 가로 위치에만 달라지므로 화면 폭 × 24px 타일 하나를 그려 세로로 반복한다.
// 칸은 기존 점(24px 칸의 (10, 10)에 놓인 3px 점)과 같은 격자, 같은 색이다. 행렬을 돌려 기존 점 자리가 0번이 되게 했으므로
// 가운데로 갈수록 칸이 6px → 12px → 24px 격자로 성겨지다가 기존 점으로 이어진다. 기존 점 자리는 배경 점이 맡으므로 비운다.
const BAYER = [
  [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
];
const DITHER = { cell: 3, alpha: 0.05, max: 0.5, zone: 0.36 };
let ditherWidth = 0;

function drawDither() {
  // documentElement.clientWidth는 스크롤바가 없을 때 비워 둔 스크롤바 자리까지 세므로 body 폭을 쓴다.
  const w = Math.round(document.body.getBoundingClientRect().width);
  if (!w || w === ditherWidth) return;
  ditherWidth = w;
  const { cell, alpha, max, zone } = DITHER;
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: cell * 8 });
  const g = canvas.getContext('2d');
  g.fillStyle = `rgb(21 20 17 / ${alpha})`; // 잉크 #151411
  const DOT = 3; // 기존 점은 8칸 중 네 번째 칸 (10 = 1 + 3 × 3)
  for (let i = -1; i < Math.ceil(w / cell); i++) {
    const x0 = 1 + i * cell;
    const x = x0 + cell / 2;
    const t = Math.min(x, w - x) / (w * zone);
    const cover = t >= 1 ? 0 : max * (1 - t) ** 1.6;
    if (!cover) continue;
    const col = (i + 8) % 8;
    for (let j = 0; j < 8; j++) {
      const rank = BAYER[(j + 8 - DOT) % 8][(col + 8 - DOT) % 8];
      if (!rank || cover <= (rank + 0.5) / 64) continue;
      const y0 = 1 + j * cell;
      g.fillRect(x0, y0, cell, cell);
      if (y0 + cell > cell * 8) g.fillRect(x0, y0 - cell * 8, cell, cell); // 타일 아래로 넘친 부분은 위에서 이어진다
    }
  }
  document.body.style.setProperty('--dither', `url(${canvas.toDataURL()})`);
}

drawDither();
window.addEventListener('resize', () => requestAnimationFrame(drawDither));

boot().catch((err) => console.error(err));
