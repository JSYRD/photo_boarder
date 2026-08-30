/* 照片加边框 —— 无框架，纯 Canvas 实现 */

const MAX_OUT = 4000;                 // 输出画布最长边上限（像素）
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const el = {
  dropZone:       document.getElementById('dropZone'),
  fileInput:      document.getElementById('fileInput'),
  sampleBtn:      document.getElementById('sampleBtn'),
  fileName:       document.getElementById('fileName'),
  sideScale:      document.getElementById('sideScale'),
  topScale:       document.getElementById('topScale'),
  bottomScale:    document.getElementById('bottomScale'),
  sideScaleVal:   document.getElementById('sideScaleVal'),
  topScaleVal:    document.getElementById('topScaleVal'),
  bottomScaleVal: document.getElementById('bottomScaleVal'),
  shadowToggle:   document.getElementById('shadowToggle'),
  photoOpacity:   document.getElementById('photoOpacity'),
  photoOpacityVal:document.getElementById('photoOpacityVal'),
  photoAngle:     document.getElementById('photoAngle'),
  photoAngleVal:  document.getElementById('photoAngleVal'),
  baseToggle:     document.getElementById('baseToggle'),
  cardOpacity:    document.getElementById('cardOpacity'),
  cardOpacityVal: document.getElementById('cardOpacityVal'),
  cardAngle:      document.getElementById('cardAngle'),
  cardAngleVal:   document.getElementById('cardAngleVal'),
  brandSelect:    document.getElementById('brandSelect'),
  logoSize:       document.getElementById('logoSize'),
  logoSizeVal:    document.getElementById('logoSizeVal'),
  logoColor:      document.getElementById('logoColor'),
  logoUploadBtn:  document.getElementById('logoUploadBtn'),
  logoInput:      document.getElementById('logoInput'),
  infoList:       document.getElementById('infoList'),
  addKindSelect:  document.getElementById('addKindSelect'),
  addInfoBtn:     document.getElementById('addInfoBtn'),
  presetBtn:      document.getElementById('presetBtn'),
  gap:            document.getElementById('gap'),
  gapVal:         document.getElementById('gapVal'),
  infoGap:        document.getElementById('infoGap'),
  infoGapVal:     document.getElementById('infoGapVal'),
  formatSelect:   document.getElementById('formatSelect'),
  jpgQuality:     document.getElementById('jpgQuality'),
  jpgQualityVal:  document.getElementById('jpgQualityVal'),
  saveCfgBtn:     document.getElementById('saveCfgBtn'),
  loadCfgBtn:     document.getElementById('loadCfgBtn'),
  cfgInput:       document.getElementById('cfgInput'),
  downloadBtn:    document.getElementById('downloadBtn'),
  canvas:         document.getElementById('canvas'),
  placeholder:    document.getElementById('placeholder'),
};

const state = {
  photo: null,            // HTMLImageElement 照片
  customLogo: null,       // 顶部自定义 Logo
  logoCache: new Map(),   // `${key}|${color}` -> Image
  infoItems: [],          // 底部信息统一内容列表（logo / param / text / image）
  gap: 0.8,               // 内容项间距（% of 输出宽）
  infoGap: 1.5,           // 底部信息与照片的距离（% of 输出宽）
};

/* ================= 品牌 Logo ================= */

// 内置矢量字标路径见 brand_paths.js（Simple Icons，CC0）。
// 库中没有的 Canon / LUMIX / OLYMPUS / OM SYSTEM 用排版字标近似。
function textSvg(text, opts) {
  const fs = 100;
  const ls = opts.letterSpacing || 0;
  const pad = fs * 0.35;
  const w = fs * 0.62 * text.length + ls * (text.length - 1) + pad * 2;
  const h = fs + pad * 2;
  const extra = ls ? ` letter-spacing="${ls}px"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<text x="${w / 2}" y="${pad + fs}" font-family="${opts.fontFamily}"` +
    ` font-size="${fs}" font-weight="${opts.fontWeight || 'normal'}"` +
    ` font-style="${opts.fontStyle || 'normal'}" fill="#161616" text-anchor="middle">` +
    `<tspan${extra}>${text}</tspan></text></svg>`;
}

const TEXT_BRANDS = {
  canon:    textSvg('Canon',     { fontWeight: '700', fontStyle: 'italic', fontFamily: 'Georgia, "Times New Roman", serif' }),
  lumix:    textSvg('LUMIX',     { fontWeight: '700', letterSpacing: 4,     fontFamily: 'Arial, Helvetica, sans-serif' }),
  olympus:  textSvg('OLYMPUS',   { fontWeight: '700', letterSpacing: 3,     fontFamily: 'Arial, Helvetica, sans-serif' }),
  omsystem: textSvg('OM SYSTEM', { fontWeight: '700', letterSpacing: 3,     fontFamily: 'Arial, Helvetica, sans-serif' }),
};

function brandSvgSource(key, color) {
  if (BRAND_PATHS[key]) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${color}" d="${BRAND_PATHS[key].d}"/></svg>`;
  }
  if (TEXT_BRANDS[key]) {
    return TEXT_BRANDS[key].replace(/fill="#[0-9a-fA-F]{6}"/, `fill="${color}"`);
  }
  return null;
}

function brandImage(key, color) {
  const src = brandSvgSource(key, color);
  if (!src) return null;
  const cacheKey = key + '|' + color;
  if (!state.logoCache.has(cacheKey)) {
    const img = new Image();
    img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(src);
    img.addEventListener('load', render);      // 加载完成后再画一次
    state.logoCache.set(cacheKey, img);
  }
  return state.logoCache.get(cacheKey);
}

function activeLogo() {
  const key = el.brandSelect.value;
  if (key === 'none') return null;
  if (key === 'custom') return state.customLogo;
  return brandImage(key, el.logoColor.value || '#161616');
}

/* ================= 统一内容项（Logo / 参数 / 文本 / 图片） ================= */

const PARAM_TYPES = {
  aperture: { label: '光圈',   def: 'ƒ/1.8' },
  shutter:  { label: '快门',   def: '1/500s' },
  iso:      { label: 'ISO',    def: 'ISO 100' },
  focal:    { label: '焦距',   def: '50mm' },
  lens:     { label: '镜头',   def: '24-70mm f/2.8' },
  custom:   { label: '自定义', def: '' },
};

let infoSeq = 0;
function newInfoItem(kind) {
  const it = { id: 'i' + (++infoSeq), kind: kind || 'param', br: false, filled: false };
  if (it.kind === 'param')      { it.ptype = 'custom'; it.pvalue = ''; it.font = 'system'; it.size = 1.5; }
  else if (it.kind === 'text')  { it.value = ''; it.font = 'system'; it.size = 1.3; }
  else if (it.kind === 'image') { it.img = null; it.name = ''; it.size = 2.8; }
  return it;
}

// 预设顺序：Logo + 光圈/快门/ISO/焦距/镜头 + 作者落款
function presetItems() {
  const param = (ptype) => {
    const it = newInfoItem('param');
    it.ptype = ptype;
    it.pvalue = PARAM_TYPES[ptype].def;
    return it;
  };
  const handle = newInfoItem('text');
  handle.value = '@photographer';
  return [newInfoItem('logo'), param('aperture'), param('shutter'), param('iso'), param('focal'), param('lens'), handle];
}

function convertItemKind(it, kind) {
  if (it.kind === kind) return;
  const fresh = newInfoItem(kind);
  fresh.id = it.id;
  fresh.br = it.br;
  if (it.kind === 'param' && kind === 'text') fresh.value = it.pvalue || '';
  if (it.kind === 'text' && kind === 'param') fresh.pvalue = it.value || '';
  const idx = state.infoItems.indexOf(it);
  state.infoItems[idx] = fresh;
}

function itemVisible(it) {
  if (it.kind === 'logo') {
    const logo = activeLogo();
    return !!(logo && logo.naturalWidth);
  }
  if (it.kind === 'image') return !!(it.img && it.img.naturalWidth);
  if (it.kind === 'param') return !!(it.pvalue && it.pvalue.trim());
  return !!(it.value && it.value.trim());
}

function renderInfoList() {
  el.infoList.innerHTML = '';
  state.infoItems.forEach((it) => {
    const defSize = it.kind === 'image' ? 2.8 : (it.kind === 'param' ? 1.5 : 1.3);

    const wrap = document.createElement('div');
    wrap.className = 'param-row info-row';
    wrap.dataset.id = it.id;

    const main = document.createElement('div');
    main.className = 'info-main';

    const handle = document.createElement('span');
    handle.className = 'drag-handle';
    handle.textContent = '⠿';
    handle.title = '按住拖拽排序';

    const sel = document.createElement('select');
    sel.className = 'param-type';
    [['logo', 'Logo'], ['param', '参数'], ['text', '文本'], ['image', '图片']].forEach(([v, l]) => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = l;
      sel.appendChild(opt);
    });
    sel.value = it.kind;
    sel.addEventListener('change', () => {
      convertItemKind(it, sel.value);
      renderInfoList();
      render();
    });

    const content = document.createElement('div');
    content.className = 'caption-content';
    if (it.kind === 'logo') {
      const hint = document.createElement('span');
      hint.className = 'info-hint';
      hint.textContent = '相机 Logo（颜色 / 大小在上方设置）';
      content.appendChild(hint);
    } else if (it.kind === 'param') {
      const psel = document.createElement('select');
      psel.className = 'param-type';
      Object.entries(PARAM_TYPES).forEach(([k, v]) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = v.label;
        psel.appendChild(opt);
      });
      psel.value = it.ptype || 'custom';
      const input = document.createElement('input');
      input.className = 'param-value';
      input.type = 'text';
      input.placeholder = (PARAM_TYPES[it.ptype] || {}).def || '输入内容';
      input.value = it.pvalue || '';
      psel.addEventListener('change', () => {
        it.ptype = psel.value;
        input.placeholder = (PARAM_TYPES[it.ptype] || {}).def || '输入内容';
        if (!input.value.trim()) { it.pvalue = (PARAM_TYPES[it.ptype] || {}).def || ''; input.value = it.pvalue; }
        it.filled = false;   // 手动修改 → 不再由 EXIF 自动覆盖
        render();
      });
      input.addEventListener('input', () => { it.pvalue = input.value; it.filled = false; render(); });
      content.append(psel, input);
    } else if (it.kind === 'text') {
      const input = document.createElement('input');
      input.className = 'param-value';
      input.type = 'text';
      input.placeholder = '输入文本';
      input.value = it.value || '';
      input.addEventListener('input', () => { it.value = input.value; render(); });
      content.appendChild(input);
    } else { // image
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'img-pick';
      btn.textContent = it.img ? '更换图片' : '选择图片';
      const name = document.createElement('span');
      name.className = 'img-name';
      name.textContent = it.name || '';
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      btn.addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        const f = file.files[0];
        if (!f || !f.type.startsWith('image/')) return;
        const r = new FileReader();
        r.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            it.img = img;
            it.name = f.name;
            renderInfoList();
            render();
          };
          img.src = e.target.result;
        };
        r.readAsDataURL(f);
      });
      content.append(btn, file);
      if (it.name) content.appendChild(name);
    }

    // 每项独立「换行」开关：勾选则此项前换行（默认全部同一行）
    const br = document.createElement('label');
    br.className = 'info-br';
    br.title = '勾选后在此项前换行';
    const brChk = document.createElement('input');
    brChk.type = 'checkbox';
    brChk.checked = !!it.br;
    brChk.addEventListener('change', () => { it.br = brChk.checked; render(); });
    br.append(brChk, '换行');

    const del = document.createElement('button');
    del.className = 'param-del';
    del.type = 'button';
    del.textContent = '×';
    del.title = '删除此项';
    del.addEventListener('click', () => {
      state.infoItems = state.infoItems.filter((x) => x.id !== it.id);
      renderInfoList();
      render();
    });

    // 首行：拖拽 + 类型 + 换行 + 删除；内容控件单独放到下一行区域
    main.append(handle, sel, br, del);
    wrap.appendChild(main);
    wrap.appendChild(content);

    // 子行：文本 / 参数有「字体 + 大小」，图片只有「大小」，Logo 无
    if (it.kind === 'param' || it.kind === 'text') {
      const frow = document.createElement('label');
      frow.className = 'caption-sub-row font-row';
      const flab = document.createElement('span');
      flab.textContent = '字体';
      const fsel = document.createElement('select');
      Object.keys(FONTS).forEach((k) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k === 'system' ? '系统默认'
          : k === 'serif' ? '衬线 Serif'
          : k === 'mono' ? '等宽 Mono'
          : k + (k === 'Great Vibes' ? '（手写体）' : '');
        fsel.appendChild(opt);
      });
      fsel.value = it.font || 'system';
      fsel.addEventListener('change', () => {
        it.font = fsel.value;
        ensureFont(it.font).then(render);
      });
      frow.append(flab, fsel);
      wrap.appendChild(frow);
    }
    if (it.kind === 'param' || it.kind === 'text' || it.kind === 'image') {
      const isImg = it.kind === 'image';
      const sub = document.createElement('label');
      sub.className = 'caption-sub-row';
      const lab = document.createElement('span');
      lab.textContent = '大小';
      const range = document.createElement('input');
      range.type = 'range';
      range.min = isImg ? 1 : 0.5;
      range.max = isImg ? 8 : 4;
      range.step = 0.1;
      range.value = it.size != null ? it.size : defSize;
      const val = document.createElement('em');
      val.textContent = (it.size != null ? it.size : defSize).toFixed(1) + '%';
      range.addEventListener('input', () => {
        it.size = parseFloat(range.value);
        val.textContent = it.size.toFixed(1) + '%';
        render();
      });
      sub.append(lab, range, val);
      wrap.appendChild(sub);
    }

    el.infoList.appendChild(wrap);
  });
}

/* ================= 列表通用拖拽排序 ================= */

function dragAfterElement(container, y) {
  const rows = [...container.querySelectorAll('.param-row:not(.dragging)')];
  return rows.reduce((closest, row) => {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: row };
    return closest;
  }, { offset: -Infinity }).element || null;
}

// 基于 Pointer 事件的手柄拖拽：只有按住 ⠿ 手柄才开始，
// 与滑块 / 输入框操作天然不冲突，也比 HTML5 DnD 更稳定。
function bindSortable(listEl, getItems, afterDrop) {
  listEl.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle || e.button !== 0) return;
    const row = handle.closest('.param-row');
    if (!row) return;
    e.preventDefault();
    row.classList.add('dragging');

    const move = (ev) => {
      const after = dragAfterElement(listEl, ev.clientY);
      if (after == null) listEl.appendChild(row);
      else listEl.insertBefore(row, after);
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      window.removeEventListener('pointercancel', done);
      row.classList.remove('dragging');
      const items = getItems();
      const order = [...listEl.querySelectorAll('.param-row')].map((r) => r.dataset.id);
      const map = new Map(items.map((i) => [i.id, i]));
      const reordered = order.map((id) => map.get(id)).filter(Boolean);
      items.length = 0;
      items.push(...reordered);
      afterDrop();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
    window.addEventListener('pointercancel', done);
  });
}

/* ================= 字体 ================= */

const FONTS = {
  system:            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif',
  serif:             'Georgia, "Times New Roman", serif',
  mono:              '"SF Mono", Menlo, Consolas, monospace',
  'Playfair Display': '"Playfair Display", Georgia, serif',
  'Cormorant Garamond': '"Cormorant Garamond", Georgia, serif',
  Lora:              '"Lora", Georgia, serif',
  Montserrat:        '"Montserrat", "Helvetica Neue", Arial, sans-serif',
  'Great Vibes':     '"Great Vibes", cursive',
};

function activeFont(key) { return FONTS[key] || FONTS.system; }

function ensureFont(key) {
  const fam = FONTS[key];
  if (!fam || !('fonts' in document)) return Promise.resolve();
  const weight = key === 'Great Vibes' ? '400' : '500';
  return Promise.all([document.fonts.load(`${weight} 40px ${fam}`), document.fonts.ready]).catch(() => {});
}

/* ================= 图片加载 ================= */

function imgFromSrc(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/* ================= EXIF 自动读取 ================= */

function formatShutter(sec) {
  if (!sec) return '';
  if (sec >= 1) return (Math.round(sec * 10) / 10) + 's';
  return '1/' + Math.round(1 / sec) + 's';
}
function formatAperture(f) { return f ? 'ƒ/' + (Math.round(f * 10) / 10) : ''; }
function formatIso(iso) { return iso ? 'ISO ' + iso : ''; }
function formatFocal(mm) { return mm ? (Math.round(mm * 10) / 10) + 'mm' : ''; }

// 用 EXIF 里的拍摄参数填充参数项。
// 会覆盖：仍为默认值的项、空项、之前由 EXIF 自动填充的项、刚导入配置的参数项（导入是一次性模板设置）；
// 不覆盖用户手动输入的内容（手动编辑会清除 filled 标记）。
function applyExif(ex) {
  if (!ex) return;
  const vals = {
    aperture: ex.aperture ? formatAperture(ex.aperture) : '',
    shutter:  ex.shutter ? formatShutter(ex.shutter) : '',
    iso:      ex.iso ? formatIso(ex.iso) : '',
    focal:    ex.focal ? formatFocal(ex.focal) : '',
    lens:     ex.lens || '',
  };
  let changed = false;
  for (const it of state.infoItems) {
    if (it.kind !== 'param') continue;
    const v = vals[it.ptype];
    if (!v) continue;
    const def = (PARAM_TYPES[it.ptype] || {}).def || '';
    if (it.pvalue === def || !it.pvalue || !it.pvalue.trim() || it.filled) {
      it.pvalue = v;
      it.filled = true;
      changed = true;
    }
  }
  if (changed) renderInfoList();
}

function loadPhoto(src, name, ex) {
  const img = new Image();
  img.onload = () => {
    state.photo = img;
    el.fileName.textContent = name || '';
    el.placeholder.hidden = true;
    el.canvas.hidden = false;
    if (ex) applyExif(ex);
    render();
  };
  img.src = src;
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // 顺便读原始字节解析 EXIF，用于自动填充拍摄参数
    const exifPromise = (window.exif && file.arrayBuffer)
      ? file.arrayBuffer().then((ab) => exif.parseExif(new Uint8Array(ab))).catch(() => null)
      : Promise.resolve(null);
    exifPromise.then((ex) => loadPhoto(dataUrl, file.name, ex));
  };
  reader.readAsDataURL(file);
}

function handleLogoFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.customLogo = img;
      el.brandSelect.value = 'custom';
      render();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ================= 示例图片 ================= */

function makeSamplePhoto() {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1000;
  const g = c.getContext('2d');

  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#7ec3e8');
  sky.addColorStop(0.6, '#cdeaf6');
  sky.addColorStop(1, '#eef6ef');
  g.fillStyle = sky;
  g.fillRect(0, 0, c.width, c.height);

  const sx = c.width * 0.78, sy = c.height * 0.30;
  const glow = g.createRadialGradient(sx, sy, 10, sx, sy, 280);
  glow.addColorStop(0, 'rgba(255,246,214,1)');
  glow.addColorStop(1, 'rgba(255,246,214,0)');
  g.fillStyle = glow; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff3cf';
  g.beginPath(); g.arc(sx, sy, 56, 0, Math.PI * 2); g.fill();

  g.fillStyle = '#8fa8b8';
  g.beginPath();
  g.moveTo(0, c.height * 0.62);
  g.lineTo(c.width * 0.18, c.height * 0.34);
  g.lineTo(c.width * 0.36, c.height * 0.50);
  g.lineTo(c.width * 0.52, c.height * 0.30);
  g.lineTo(c.width * 0.72, c.height * 0.48);
  g.lineTo(c.width * 0.90, c.height * 0.32);
  g.lineTo(c.width, c.height * 0.50);
  g.lineTo(c.width, c.height * 0.62);
  g.closePath(); g.fill();

  g.fillStyle = '#5d7d8a';
  g.beginPath();
  g.moveTo(0, c.height * 0.78);
  g.lineTo(c.width * 0.25, c.height * 0.50);
  g.lineTo(c.width * 0.50, c.height * 0.66);
  g.lineTo(c.width * 0.75, c.height * 0.48);
  g.lineTo(c.width, c.height * 0.62);
  g.lineTo(c.width, c.height * 0.78);
  g.closePath(); g.fill();

  g.fillStyle = '#3c5a49';
  g.fillRect(0, c.height * 0.78, c.width, c.height * 0.22);

  g.fillStyle = '#2c4436';
  for (let i = 0; i < 7; i++) {
    const x = c.width * (0.06 + i * 0.15);
    const th = c.height * 0.13;
    const bw = c.height * 0.05;
    g.beginPath();
    g.moveTo(x, c.height * 0.76 - th);
    g.lineTo(x - bw, c.height * 0.76);
    g.lineTo(x + bw, c.height * 0.76);
    g.closePath(); g.fill();
  }

  return c.toDataURL('image/png');
}

/* ================= 渲染 ================= */

function render() {
  const ctx = el.canvas.getContext('2d');
  if (!state.photo) return;

  const photoW = state.photo.naturalWidth;
  const photoH = state.photo.naturalHeight;
  const sidePx   = photoW * parseFloat(el.sideScale.value);
  const topPx    = photoW * parseFloat(el.topScale.value);
  const bottomPx = photoW * parseFloat(el.bottomScale.value);
  const baseOn   = el.baseToggle.checked;
  const outer    = baseOn ? Math.max(10, Math.round(photoW * 0.02)) : 0; // 白色底座外扩

  const cardW = photoW + sidePx * 2;
  const cardH = photoH + topPx + bottomPx;
  const scale = Math.min(1, MAX_OUT / Math.max(cardW, cardH));

  const W = Math.round(cardW * scale);
  const H = Math.round(cardH * scale);
  el.canvas.width  = W + outer * 2;
  el.canvas.height = H + outer * 2;

  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

  // 白色底座（外部白底）
  if (baseOn) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);
  }

  // 白色边框卡片。底座开启时：先用投影画一遍卡片，形成卡片压在白底上的层次感
  if (baseOn) {
    ctx.save();
    const op = parseInt(el.cardOpacity.value) / 100;
    const rad = parseInt(el.cardAngle.value) * Math.PI / 180;
    ctx.shadowColor = `rgba(0,0,0,${op})`;
    ctx.shadowBlur  = Math.max(4, W * 0.02);
    ctx.shadowOffsetX = Math.cos(rad) * Math.max(3, W * 0.008);
    ctx.shadowOffsetY = Math.sin(rad) * Math.max(3, W * 0.008);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(outer, outer, W, H);
    ctx.restore();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(outer, outer, W, H);

  // 照片（可带阴影）
  const px = outer + Math.round(sidePx * scale);
  const py = outer + Math.round(topPx * scale);
  const pw = Math.round(photoW * scale);
  const ph = Math.round(photoH * scale);

  if (el.shadowToggle.checked) {
    ctx.save();
    const op = parseInt(el.photoOpacity.value) / 100;
    const rad = parseInt(el.photoAngle.value) * Math.PI / 180;
    ctx.shadowColor = `rgba(0,0,0,${op})`;
    ctx.shadowBlur  = Math.max(2, W * 0.012);
    ctx.shadowOffsetX = Math.cos(rad) * Math.max(1, W * 0.004);
    ctx.shadowOffsetY = Math.sin(rad) * Math.max(1, W * 0.004);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
  }
  ctx.drawImage(state.photo, px, py, pw, ph);

  // 底部信息区（与照片底部保持可调的间距）
  const infoGapPx = clamp(W * (state.infoGap || 1.5) / 100, 0, 200);
  const infoTop = Math.min(py + ph + infoGapPx, H);
  const infoH = Math.max(10, H - infoTop + outer);
  drawInfo(ctx, infoTop, infoH, W, outer);
}

// 统一内容列表：默认同一行，每项可勾选「换行」断行；某行超宽时整行等比缩小
function drawInfo(ctx, top, h, W, ox) {
  const cx = ox + W / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fitWidth = W - Math.max(20, W * 0.04);
  const gapPx = clamp(W * (state.gap || 0.8) / 100, 2, 60);

  const items = state.infoItems.filter(itemVisible);
  const lines = [];
  let cur = [];
  for (const it of items) {
    if (it.br && cur.length) { lines.push(cur); cur = []; }
    cur.push(it);
  }
  if (cur.length) lines.push(cur);

  let y = top + Math.max(0, h * 0.02);
  for (const line of lines) {
    const met = line.map((it) => measureItem(ctx, it, W, h));
    let lineW = 0;
    met.forEach((m) => { lineW += m.w; });
    lineW += gapPx * (line.length - 1);
    let scale = 1;
    if (lineW > fitWidth && lineW > 0) scale = Math.max(0.4, fitWidth / lineW);
    const lineH = Math.max.apply(null, met.map((m) => m.h)) * scale;
    const cy = y + lineH / 2;
    let x = cx - lineW * scale / 2;
    for (let i = 0; i < line.length; i++) {
      const m = met[i];
      const bw = m.w * scale;
      const bh = m.h * scale;
      drawItem(ctx, line[i], m, scale, x, cy, bw, bh);
      x += bw + gapPx * scale;
    }
    y += lineH + gapPx;
  }
}

function measureItem(ctx, it, W, h) {
  if (it.kind === 'logo') {
    const logo = activeLogo();
    const lh = Math.min(h * 0.35, clamp(W * (parseFloat(el.logoSize.value) || 3.2) / 100, 8, 160));
    const lw = lh * (logo.naturalWidth / logo.naturalHeight);
    return { w: lw, h: lh, kind: 'logo', logo };
  }
  if (it.kind === 'image') {
    const lh = Math.min(h * 0.35, clamp(W * ((it.size != null ? it.size : 2.8) / 100), 6, 160));
    const lw = lh * (it.img.naturalWidth / it.img.naturalHeight);
    return { w: lw, h: lh, kind: 'image', img: it.img };
  }
  const isParam = it.kind === 'param';
  const val = isParam ? it.pvalue : it.value;
  const fkey = it.font || 'system';
  const fam = activeFont(fkey);
  const weight = fkey === 'Great Vibes' ? '400' : '500';
  const px = clamp(W * ((it.size != null ? it.size : (isParam ? 1.5 : 1.3)) / 100), 7, 96);
  ctx.font = `${weight} ${px}px ${fam}`;
  const tw = ctx.measureText(val).width;
  return { w: tw, h: px * 1.2, kind: it.kind, text: val, fam, weight, px };
}

function drawItem(ctx, it, m, scale, x, cy, bw, bh) {
  if (m.kind === 'logo' || m.kind === 'image') {
    ctx.drawImage(m.logo || m.img, x, cy - bh / 2, bw, bh);
  } else {
    ctx.font = `${m.weight} ${m.px * scale}px ${m.fam}`;
    ctx.fillStyle = m.kind === 'param' ? '#111111' : '#3a3a3a';
    ctx.fillText(m.text, x + bw / 2, cy);
  }
}

/* ================= 作品导出 / 导入（.boarderconf = ZIP） ================= */

// 把当前作品打包成 .boarderconf（标准 ZIP：settings.json + 自定义图片）
// 从图片字节识别真实格式（优先字节魔数，其次 data URL MIME），保证导入时按正确类型解码。
// 例如 SVG 上传后 data URL MIME 是 image/svg+xml，若不识别会被误存为 .png，导入即解码失败。
function detectImageFormat(bytes, dataUrl) {
  if (bytes.length >= 8) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';  // \x89PNG
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';                       // JPEG
    if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';                                            // BM
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';                       // GIF8
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {              // RIFF....WEBP
      const tag = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0);
      if (tag === 'WEBP') return 'webp';
    }
    // HEIC / HEIF / AVIF：ISO-BMFF 首盒为 'ftyp'，紧跟主品牌标识
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      const brand = String.fromCharCode(bytes[8] || 0, bytes[9] || 0, bytes[10] || 0, bytes[11] || 0).toLowerCase();
      if (/heic|heix|hevc|heif|mif1|msf1|avif|avis/.test(brand)) {
        if (/avif|avis/.test(brand)) return 'avif';
        return /heic|heix/.test(brand) ? 'heic' : 'heif';
      }
    }
  }
  // SVG 为文本：可能带 BOM / 前导空白 / XML 声明
  if (bytes.length >= 5) {
    const head = new TextDecoder('utf-8').decode(bytes.subarray(0, Math.min(512, bytes.length)))
      .replace(/^\uFEFF/, '').trimStart();
    if (head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!DOCTYPE svg')) return 'svg';
  }
  // 回退：data URL 的 MIME 扩展名
  const m = /^data:image\/([a-z0-9+.-]+)/i.exec(dataUrl);
  if (m) {
    let ext = m[1].toLowerCase().replace('+xml', '');   // svg+xml → svg
    if (ext === 'jpeg') ext = 'jpg';
    if (['png', 'jpg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'avif', 'ico', 'tif', 'tiff'].includes(ext)) return ext;
  }
  return 'png';
}

async function exportBoarderconf() {
  const entries = [];
  const refs = { imgs: {} };

  async function addImage(dataUrl, prefix) {
    if (!dataUrl) return null;
    const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
    const ext = detectImageFormat(bytes, dataUrl);
    const name = `images/${prefix}.${ext}`;
    entries.push({ name, data: bytes });
    return name;
  }

  // 注意：不打包主照片，只打包自定义 Logo 与内容列表里的图片 + 全部设置
  refs.logo = await addImage(state.customLogo ? state.customLogo.src : null, 'logo');
  for (const it of state.infoItems) {
    if (it.kind === 'image') refs.imgs[it.id] = await addImage(it.img ? it.img.src : null, 'img' + it.id);
  }

  const cfg = buildConfig(refs);
  entries.push({ name: 'settings.json', data: new TextEncoder().encode(JSON.stringify(cfg, null, 2)) });
  return zip.zipCreate(entries);
}

function buildConfig(refs) {
  refs = refs || {};
  return {
    version: 3,
    border: {
      side: el.sideScale.value,
      top: el.topScale.value,
      bottom: el.bottomScale.value,
    },
    effects: {
      photoShadow: el.shadowToggle.checked,
      photoOpacity: el.photoOpacity.value,
      photoAngle: el.photoAngle.value,
      base: el.baseToggle.checked,
      cardOpacity: el.cardOpacity.value,
      cardAngle: el.cardAngle.value,
    },
    logo: {
      brand: el.brandSelect.value,
      size: el.logoSize.value,
      color: el.logoColor.value,
      customLogoData: refs.logo || null,
    },
    gap: state.gap,
    infoGap: state.infoGap,
    format: el.formatSelect.value,
    jpgQuality: el.jpgQuality.value,
    items: state.infoItems.map((it) => {
      const o = { kind: it.kind, br: !!it.br };
      if (it.kind === 'param') {
        o.ptype = it.ptype;
        o.pvalue = it.pvalue;
        o.font = it.font || 'system';
        o.size = it.size;
      } else if (it.kind === 'text') {
        o.value = it.value;
        o.font = it.font || 'system';
        o.size = it.size;
      } else if (it.kind === 'image') {
        o.name = it.name || '';
        o.size = it.size;
        o.img = (refs.imgs && refs.imgs[it.id]) ? refs.imgs[it.id] : null;
      }
      return o;
    }),
  };
}

async function infoItemFromConfig(it, resolve) {
  const item = newInfoItem(it.kind || 'text');
  item.br = !!it.br;
  if (item.kind === 'param') {
    item.ptype = it.ptype || 'custom';
    item.pvalue = it.pvalue != null ? it.pvalue : ((PARAM_TYPES[item.ptype] || {}).def || '');
    item.font = it.font || 'system';
    item.size = it.size != null ? it.size : 1.5;
    item.filled = true;   // 导入配置是一次性模板设置：下一次导入照片时用 EXIF 覆盖
  } else if (item.kind === 'text') {
    item.value = it.value || '';
    item.font = it.font || 'system';
    item.size = it.size != null ? it.size : 1.3;
  } else if (item.kind === 'image') {
    item.name = it.name || '';
    item.size = it.size != null ? it.size : 2.8;
    const src = it.img ? (resolve ? await resolve(it.img) : it.img) : null;
    item.img = src ? await imgFromSrc(src) : null;
  }
  return item;
}

// 兼容 v1 / v2 旧配置：由 logo + params + caption 三个区块 + sectionOrder 组装为统一列表
async function buildItemsFromLegacy(cfg, resolve) {
  const f = cfg.fonts || {};
  const pFont = f.paramsFont || 'system';
  const pSize = f.paramsSize != null ? f.paramsSize : 1.5;

  const params = (cfg.params || []).map((p) => {
    const item = newInfoItem('param');
    item.ptype = p.type || 'custom';
    item.pvalue = p.value != null ? p.value : '';
    item.font = pFont;
    item.size = pSize;
    item.filled = true;   // 旧版配置导入同样是一次性模板设置
    return item;
  });
  if (!params.length) {
    ['aperture', 'shutter', 'iso', 'focal'].forEach((t) => {
      const item = newInfoItem('param');
      item.ptype = t;
      item.pvalue = PARAM_TYPES[t].def;
      item.font = pFont;
      item.size = pSize;
      item.filled = true;
      params.push(item);
    });
  }

  const caption = [];
  const items = ((cfg.caption || {}).items || []).slice();
  if (!items.length) items.push({ type: 'text', value: '@photographer' });
  for (const it of items) {
    if (it.type === 'image') {
      const item = newInfoItem('image');
      item.name = it.value || '';
      item.size = it.size != null ? it.size : 2.8;
      const src = it.img ? (resolve ? await resolve(it.img) : it.img) : null;
      item.img = src ? await imgFromSrc(src) : null;
      caption.push(item);
    } else {
      const item = newInfoItem('text');
      item.value = it.value || '';
      item.size = it.size != null ? it.size : 1.3;
      item.font = it.font || 'system';
      caption.push(item);
    }
  }

  const order = (Array.isArray(cfg.sectionOrder) && cfg.sectionOrder.length)
    ? cfg.sectionOrder : ['logo', 'params', 'caption'];
  const out = [];
  for (const key of order) {
    if (key === 'logo') out.push(newInfoItem('logo'));
    else if (key === 'params') out.push(...params);
    else if (key === 'caption') out.push(...caption);
  }
  return out;
}

function ensureLoadedFonts() {
  const keys = new Set();
  for (const it of state.infoItems) {
    if (it.kind === 'param' || it.kind === 'text') keys.add(it.font || 'system');
  }
  // 字体是异步加载的：加载完成后重绘一次，否则刚导入配置时画布停留在回退字体
  const pending = [...keys].map((k) => ensureFont(k));
  Promise.all(pending).then(() => render());
}

// resolve: (path) => Promise<dataUrl/objectUrl>，用于 .boarderconf 内图片；纯 JSON 旧格式时省略
async function applyConfig(cfg, resolve) {
  if (!cfg || ![1, 2, 3].includes(cfg.version)) throw new Error('版本不兼容');
  const b = cfg.border || {};
  el.sideScale.value = b.side != null ? b.side : 0.08;
  el.topScale.value = b.top != null ? b.top : 0.05;
  el.bottomScale.value = b.bottom != null ? b.bottom : 0.18;

  const e = cfg.effects || {};
  el.shadowToggle.checked = !!e.photoShadow;
  el.photoOpacity.value = e.photoOpacity != null ? e.photoOpacity : 20;
  el.photoAngle.value = e.photoAngle != null ? e.photoAngle : 90;
  el.baseToggle.checked = !!e.base;
  el.cardOpacity.value = e.cardOpacity != null ? e.cardOpacity : 28;
  el.cardAngle.value = e.cardAngle != null ? e.cardAngle : 90;

  const lg = cfg.logo || {};
  el.brandSelect.value = lg.brand || 'none';
  el.logoSize.value = lg.size != null ? lg.size : 3.2;
  el.logoColor.value = lg.color || '#161616';
  if (lg.customLogoData) {
    const src = resolve ? await resolve(lg.customLogoData) : lg.customLogoData;
    state.customLogo = src ? await imgFromSrc(src) : null;
  } else {
    state.customLogo = null;
  }

  el.gap.value = cfg.gap != null ? cfg.gap : 0.8;
  el.infoGap.value = cfg.infoGap != null ? cfg.infoGap : 1.5;
  el.formatSelect.value = cfg.format || 'png';
  el.jpgQuality.value = cfg.jpgQuality != null ? cfg.jpgQuality : 0.92;

  if (Array.isArray(cfg.items)) {
    state.infoItems = [];
    for (const it of cfg.items) state.infoItems.push(await infoItemFromConfig(it, resolve));
    if (!state.infoItems.length) state.infoItems = presetItems();
  } else {
    state.infoItems = await buildItemsFromLegacy(cfg, resolve);
  }

  ensureLoadedFonts();
  syncVals();
  renderInfoList();
  render();
}

/* ================= 事件绑定 ================= */

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
}

function syncVals() {
  state.gap = parseFloat(el.gap.value) || 0.8;   // 间距滑块 → 状态（绘制与导出共用）
  state.infoGap = parseFloat(el.infoGap.value) || 1.5;
  el.sideScaleVal.textContent   = Math.round(el.sideScale.value   * 1000) / 10 + '%';
  el.topScaleVal.textContent    = Math.round(el.topScale.value    * 1000) / 10 + '%';
  el.bottomScaleVal.textContent = Math.round(el.bottomScale.value * 1000) / 10 + '%';
  el.gapVal.textContent         = parseFloat(el.gap.value).toFixed(1) + '%';
  el.infoGapVal.textContent     = parseFloat(el.infoGap.value).toFixed(1) + '%';
  el.logoSizeVal.textContent    = parseFloat(el.logoSize.value).toFixed(1) + '%';
  el.photoOpacityVal.textContent = el.photoOpacity.value + '%';
  el.photoAngleVal.textContent  = el.photoAngle.value + '°';
  el.cardOpacityVal.textContent = el.cardOpacity.value + '%';
  el.cardAngleVal.textContent   = el.cardAngle.value + '°';
  el.jpgQualityVal.textContent  = Math.round(parseFloat(el.jpgQuality.value) * 100) + '%';
}

function bindEvents() {
  syncVals();

  // 拖拽 / 点击上传照片
  el.dropZone.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => handleFile(el.fileInput.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    el.dropZone.addEventListener(ev, (e) => { e.preventDefault(); el.dropZone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    el.dropZone.addEventListener(ev, (e) => { e.preventDefault(); el.dropZone.classList.remove('drag'); }));
  el.dropZone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  // 示例图
  el.sampleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    loadPhoto(makeSamplePhoto(), '示例图片（可替换）');
  });

  // 顶部自定义 Logo
  el.logoUploadBtn.addEventListener('click', () => el.logoInput.click());
  el.logoInput.addEventListener('change', () => handleLogoFile(el.logoInput.files[0]));

  // 统一内容列表：添加 / 重置预设 / 拖拽排序
  el.addInfoBtn.addEventListener('click', () => {
    state.infoItems.push(newInfoItem(el.addKindSelect.value));
    renderInfoList();
    render();
  });
  el.presetBtn.addEventListener('click', () => {
    state.infoItems = presetItems();
    renderInfoList();
    render();
  });
  bindSortable(el.infoList, () => state.infoItems, () => { renderInfoList(); render(); });

  // 下载（PNG / JPG）
  el.downloadBtn.addEventListener('click', () => {
    if (!state.photo) return;
    const fmt = el.formatSelect.value;
    let dataUrl;
    if (fmt === 'jpg') {
      const c = document.createElement('canvas');
      c.width = el.canvas.width;
      c.height = el.canvas.height;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';          // JPG 无透明，铺白底
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(el.canvas, 0, 0);
      dataUrl = c.toDataURL('image/jpeg', parseFloat(el.jpgQuality.value));
    } else {
      dataUrl = el.canvas.toDataURL('image/png');
    }
    const a = document.createElement('a');
    a.download = `framed_${timestamp()}.${fmt === 'jpg' ? 'jpg' : 'png'}`;
    a.href = dataUrl;
    a.click();
  });

  // 作品导出 / 导入（.boarderconf；旧版纯 JSON 设置仍可导入）
  el.saveCfgBtn.addEventListener('click', async () => {
    try {
      const bytes = await exportBoarderconf();
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.download = `frame_settings_${timestamp()}.boarderconf`;
      a.href = URL.createObjectURL(blob);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert('导出失败：' + err.message);
    }
  });
  el.loadCfgBtn.addEventListener('click', () => el.cfgInput.click());
  el.cfgInput.addEventListener('change', async () => {
    const f = el.cfgInput.files[0];
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    try {
      if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
        // .boarderconf（ZIP）
        const entries = zip.zipRead(buf);
        const map = new Map(entries.map((en) => [en.name, en.data]));
        const cfgData = map.get('settings.json');
        if (!cfgData) throw new Error('压缩包里缺少 settings.json');
        const cfg = JSON.parse(new TextDecoder('utf-8').decode(cfgData));
        const urlCache = new Map();
        const resolve = async (path) => {
          if (urlCache.has(path)) return urlCache.get(path);
          const data = map.get(path);
          if (!data) return null;
          const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1];
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                     : ext === 'gif' ? 'image/gif'
                     : ext === 'webp' ? 'image/webp'
                     : ext === 'svg' ? 'image/svg+xml'
                     : ext === 'bmp' ? 'image/bmp'
                     : ext === 'heic' ? 'image/heic'
                     : ext === 'heif' ? 'image/heif'
                     : ext === 'avif' ? 'image/avif'
                     : ext === 'ico' ? 'image/x-icon'
                     : ext === 'tif' || ext === 'tiff' ? 'image/tiff'
                     : 'image/png';
          const url = URL.createObjectURL(new Blob([data], { type: mime }));
          urlCache.set(path, url);
          return url;
        };
        await applyConfig(cfg, resolve);
      } else {
        // 兼容旧版纯 JSON 设置（v1，图片为 base64 内嵌）
        await applyConfig(JSON.parse(new TextDecoder('utf-8').decode(buf)));
      }
      el.cfgInput.value = '';
    } catch (err) {
      alert('导入失败：' + err.message);
    }
  });

  // 任意控件变化即重绘
  const controls = [el.sideScale, el.topScale, el.bottomScale, el.shadowToggle,
                    el.photoOpacity, el.photoAngle, el.baseToggle, el.cardOpacity, el.cardAngle,
                    el.brandSelect, el.logoSize, el.logoColor, el.gap, el.infoGap, el.jpgQuality];
  controls.forEach((c) => c.addEventListener('input', () => { syncVals(); render(); }));
  controls.forEach((c) => c.addEventListener('change', () => { syncVals(); render(); }));
}

/* ================= 启动 ================= */

bindEvents();
state.infoItems = presetItems();
renderInfoList();
loadPhoto(makeSamplePhoto(), '示例图片（可替换）');
