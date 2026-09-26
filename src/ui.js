(function () {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const inr = n => '₹' + Math.round(n).toLocaleString('en-IN');
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NS = 'http://www.w3.org/2000/svg';

  /* ---------- savings calculator (indicative numbers) ---------- */
  const TARIFF = 7.2;          // ₹ per unit, blended Kerala domestic slab (indicative)
  const COST_PER_KW = 58000;   // ₹ per kW installed (indicative)
  function plan(bill) {
    const units = Math.max(90, bill / TARIFF);
    let kw = Math.round((units / 118) * 2) / 2; kw = Math.min(10, Math.max(1, kw));
    const gen = kw * 112;
    const covered = Math.min(units, gen);
    const saved = Math.min(bill - 120, covered * TARIFF * .96);
    const newBill = Math.max(120, bill - saved);
    const subsidy = kw <= 2 ? 30000 * kw : Math.min(78000, 60000 + 18000 * (kw - 2));
    const payback = (kw * COST_PER_KW - subsidy) / Math.max(1, saved * 12);
    return { units, kw, saved, newBill, subsidy, payback };
  }
  function initCalc() {
    const inp = $('#billIn'), rng = $('#billRange');
    if (!inp) return;
    const set = (bill, from) => {
      bill = Math.min(15000, Math.max(800, bill || 800));
      const p = plan(bill);
      if (from !== 'input') inp.value = Math.round(bill).toLocaleString('en-IN');
      if (from !== 'range') rng.value = bill;
      rng.style.setProperty('--p', ((bill - 800) / (15000 - 800) * 100).toFixed(1) + '%');
      $('#rKw').textContent = (p.kw % 1 ? p.kw.toFixed(1) : p.kw) + ' kW';
      $('#rSave').textContent = inr(p.saved);
      $('#rSub').textContent = inr(p.subsidy);
      $('#rPay').textContent = p.payback.toFixed(1) + ' yrs';
      $('#vNow').textContent = inr(bill); $('#vNew').textContent = inr(p.newBill);
      $('#bNew').style.width = Math.max(4, p.newBill / bill * 100).toFixed(1) + '%';
      yearChart.set({ kw: p.kw, units: p.units });
    };
    rng.addEventListener('input', () => set(+rng.value, 'range'));
    inp.addEventListener('input', () => { const v = +inp.value.replace(/[^\d]/g, ''); if (v >= 800) set(v, 'input'); });
    inp.addEventListener('blur', () => set(+inp.value.replace(/[^\d]/g, ''), 'blur'));
    set(3500);
  }

  /* ---------- the roof's year: one block per module's worth of units ---------- */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const GEN_PER_KW = [124, 128, 140, 134, 118, 84, 78, 88, 102, 106, 106, 114];   // kWh per kW per month (Kerala, indicative)
  const USE_SHAPE = [.95, 1, 1.1, 1.18, 1.14, .96, .9, .9, .94, .98, .97, .98];
  const yearChart = (() => {
    const svg = $('#ycSvg'); let cur = null, target = null, shown = 0, raf = 0, plan = { kw: 4, units: 480 };
    const Wv = 640, Hv = 220, top = 20, base = 196, left = 6, colW = (Wv - left * 2) / 12, bw = 34, gap = 2.2;
    const build = () => {
      if (!svg) return;
      const gen = GEN_PER_KW.map(g => g * plan.kw), use = USE_SHAPE.map(s => s * plan.units);
      const max = Math.max(900, ...gen, ...use), blocks = 13, unit = max / blocks, pitch = (base - top) / blocks;
      target = { gen, use, unit, pitch };
      if (!cur) cur = { gen: gen.map(() => 0), use: use.map(() => 0) };
      $('#ycKw') && ($('#ycKw').textContent = `${plan.kw % 1 ? plan.kw.toFixed(1) : plan.kw} kW system`);
      const tg = gen.reduce((a, b) => a + b, 0), tu = use.reduce((a, b) => a + b, 0);
      $('#ycTot') && ($('#ycTot').textContent = `≈ ${Math.round(tg).toLocaleString('en-IN')} units a year · ${Math.round(tg / tu * 100)}% of use`);
    };
    const draw = () => {
      if (!svg || !target) return;
      const { unit, pitch } = target; let s = '';
      for (let i = 0; i < 12; i++) {
        const x = left + i * colW + (colW - bw) / 2, v = cur.gen[i], n = v / unit, full = Math.floor(n), fr = n - full;
        s += `<g class="col"><rect class="hit" x="${(left + i * colW).toFixed(1)}" y="${top - 16}" width="${colW.toFixed(1)}" height="${base - top + 34}"/>`;
        for (let k = 0; k <= full; k++) {
          const hgt = (k < full ? 1 : fr) * (pitch - gap); if (hgt < .6) continue;
          const y = base - k * pitch - hgt;
          s += `<rect class="mod" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${hgt.toFixed(1)}" rx="1.2"/><path class="modl" d="M${(x + bw / 3).toFixed(1)} ${y.toFixed(1)}v${hgt.toFixed(1)}M${(x + bw * 2 / 3).toFixed(1)} ${y.toFixed(1)}v${hgt.toFixed(1)}"/>`;
        }
        const yt = base - n * pitch;
        if (n > .05) s += `<rect class="ycap" x="${x.toFixed(1)}" y="${(yt - 1.4).toFixed(1)}" width="${bw}" height="1.6" rx=".8" fill="#E7C27A"/>`;
        s += `<text class="val" x="${(x + bw / 2).toFixed(1)}" y="${(yt - 7).toFixed(1)}" text-anchor="middle">${Math.round(target.gen[i])}</text>`;
        s += `<text x="${(x + bw / 2).toFixed(1)}" y="${Hv - 6}" text-anchor="middle">${MONTHS[i]}</text></g>`;
      }
      const pts = cur.use.map((u, i) => [left + i * colW + colW / 2, base - u / unit * pitch]);
      let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 0; i < 11; i++) { const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(11, i + 2)]; d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`; }
      s += `<path class="use" d="${d}" opacity="${Math.min(1, shown * 1.4).toFixed(2)}"/>`;
      pts.forEach(p => { s += `<circle class="udot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" opacity="${Math.min(1, shown * 1.4).toFixed(2)}"/>`; });
      s += `<line x1="0" x2="${Wv}" y1="${base + .5}" y2="${base + .5}" stroke="rgba(20,23,27,.25)"/>`;
      svg.innerHTML = s;
    };
    const animate = () => {
      cancelAnimationFrame(raf); const from = { gen: cur.gen.slice(), use: cur.use.slice() }, t0 = performance.now(), dur = reduce ? 1 : 1100;
      const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        for (let i = 0; i < 12; i++) { const stag = Math.min(1, Math.max(0, e * 1.35 - i * .03)); cur.gen[i] = from.gen[i] + (target.gen[i] * shown - from.gen[i]) * stag; cur.use[i] = from.use[i] + (target.use[i] * shown - from.use[i]) * e; }
        draw(); if (k < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    };
    if (svg) new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !shown) { shown = 1; animate(); } }), { threshold: .35 }).observe(svg);
    return { set(p) { plan = p; build(); if (shown) animate(); else draw(); } };
  })();

  /* ---------- nav theme follows the section beneath it ---------- */
  function initNav() {
    const nav = $('#nav'), secs = $$('[data-theme]');
    let raf = 0;
    const check = () => {
      raf = 0; const y = 38;
      for (const s of secs) { const r = s.getBoundingClientRect(); if (r.top <= y && r.bottom > y) { nav.classList.toggle('dark', s.dataset.theme === 'dark'); break; } }
    };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(check); }, { passive: true });
    check();
  }

  /* ---------- reveal + counters ---------- */
  function initReveal() {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$('.reveal').forEach(el => io.observe(el));
    const cio = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return; cio.unobserve(e.target);
      const el = e.target, to = +el.dataset.count, dec = +(el.dataset.dec || 0), t0 = performance.now();
      const tick = now => { const k = Math.min(1, (now - t0) / 1600), v = to * (1 - Math.pow(1 - k, 3)); el.textContent = dec ? v.toFixed(dec) : Math.round(v).toLocaleString('en-IN'); if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), { threshold: .6 });
    $$('[data-count]').forEach(el => cio.observe(el));
  }

  /* ---------- live hero reading ---------- */
  function initLive() {
    const el = $('#liveKw'); if (!el) return;
    let v = 3.84; setInterval(() => { v = Math.min(4.3, Math.max(3.4, v + (Math.random() - .5) * .08)); el.textContent = v.toFixed(2); }, 1800);
  }

  /* ---------- the hero card steps aside while you explore the scene ---------- */
  function initExplore() {
    const card = $('.hero-card'), hero = $('#hero'); if (!card || !hero) return;
    let acc = 0, lastT = 0, last = null, timer = 0;
    const calm = () => { root.classList.remove('exploring'); acc = 0; };
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const hr = hero.getBoundingClientRect(); if (hr.bottom < innerHeight * .6) return calm();
      const r = card.getBoundingClientRect(), pad = 48;
      const near = e.clientX > r.left - pad && e.clientX < r.right + pad && e.clientY > r.top - pad && e.clientY < r.bottom + pad;
      if (near || (e.target.closest && e.target.closest('.nav, a, button'))) { calm(); last = null; return; }
      const now = performance.now(); if (now - lastT > 350) acc = 0; lastT = now;
      if (last) acc += Math.hypot(e.clientX - last.x, e.clientY - last.y); last = { x: e.clientX, y: e.clientY };
      if (acc > 110) root.classList.add('exploring');
      clearTimeout(timer); timer = setTimeout(calm, 2400);
    }, { passive: true });
    document.addEventListener('pointerleave', calm);
  }

  /* ---------- liquid glass: the pane bends what's behind it at the rim (Chromium renders the refraction) ---------- */
  function initLiquidGlass() {
    const ua = navigator.userAgentData, chromium = ua ? ua.brands.some(b => /Chromium/i.test(b.brand)) : /Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent);
    if (!chromium || reduce) return;
    const defs = $('#lg-defs'); if (!defs) return;
    let n = 0;
    const mapURL = (w, h, rad) => {
      const s = 2, cw = Math.ceil(w / s), ch = Math.ceil(h / s), c = document.createElement('canvas'); c.width = cw; c.height = ch;
      const g = c.getContext('2d'), img = g.createImageData(cw, ch), d = img.data, band = Math.min(26, Math.min(w, h) * .32), hx = w / 2, hy = h / 2, r = Math.min(rad, hx, hy);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const px = x * s + s / 2 - hx, py = y * s + s / 2 - hy, qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
        const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r, di = -out;
        let nx, ny; if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; } else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
        nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
        const m = di < band ? Math.pow(1 - Math.max(0, di) / band, 2.2) : 0, i = (y * cw + x) * 4;
        d[i] = 128 - nx * m * 127; d[i + 1] = 128 - ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0); return c.toDataURL();
    };
    const apply = el => {
      const w = el.offsetWidth, h = el.offsetHeight; if (w < 24 || h < 24) return;
      const cs = getComputedStyle(el), rad = parseFloat(cs.borderTopLeftRadius) || 16;
      const key = w + 'x' + h + 'r' + rad; if (el.dataset.lgKey === key) return; el.dataset.lgKey = key;
      const id = el.dataset.lg || (el.dataset.lg = 'lg' + (n++));
      let f = document.getElementById(id);
      if (!f) { f = document.createElementNS(NS, 'filter'); f.id = id; f.setAttribute('color-interpolation-filters', 'sRGB'); f.setAttribute('filterUnits', 'userSpaceOnUse');
        const im = document.createElementNS(NS, 'feImage'); im.setAttribute('result', 'map'); im.setAttribute('preserveAspectRatio', 'none');
        const dm = document.createElementNS(NS, 'feDisplacementMap'); dm.setAttribute('in', 'SourceGraphic'); dm.setAttribute('in2', 'map'); dm.setAttribute('xChannelSelector', 'R'); dm.setAttribute('yChannelSelector', 'G');
        f.append(im, dm); defs.append(f); }
      for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) f.setAttribute(k, v);
      const im = f.querySelector('feImage'); for (const [k, v] of [['x', 0], ['y', 0], ['width', w], ['height', h]]) im.setAttribute(k, v);
      im.setAttribute('href', mapURL(w, h, rad));
      f.querySelector('feDisplacementMap').setAttribute('scale', Math.min(46, Math.max(18, Math.min(w, h) * .16)).toFixed(0));
      const night = el.classList.contains('night') || el.closest('.dark');
      const bf = `url(#${id}) blur(14px) saturate(${night ? 1.5 : 1.7}) brightness(${night ? .86 : 1.12})`;
      el.style.backdropFilter = bf; el.style.webkitBackdropFilter = bf;
    };
    const els = $$('.glass').filter(el => !el.classList.contains('tag')), ro = new ResizeObserver(es => es.forEach(e => apply(e.target)));
    els.forEach(el => { apply(el); ro.observe(el); });
  }

  /* ---------- Kerala: an old chart of the Malabar coast ---------- */
  const OUTLINE = [[74.86, 12.79], [74.93, 12.62], [74.99, 12.5], [75.1, 12.25], [75.2, 12.08], [75.35, 11.87], [75.49, 11.75], [75.57, 11.6], [75.7, 11.44], [75.77, 11.25], [75.85, 11.05], [75.92, 10.78], [76.0, 10.57], [76.12, 10.3], [76.22, 10.0], [76.3, 9.7], [76.33, 9.49], [76.44, 9.2], [76.58, 8.9], [76.72, 8.73], [76.9, 8.5], [77.06, 8.33], [77.16, 8.28], [77.21, 8.4], [77.17, 8.6], [77.26, 8.82], [77.16, 9.0], [77.22, 9.4], [77.2, 9.62], [77.36, 9.95], [77.25, 10.2], [77.2, 10.36], [76.95, 10.45], [76.85, 10.6], [76.9, 10.8], [76.7, 11.0], [76.75, 11.2], [76.55, 11.4], [76.45, 11.62], [76.25, 11.86], [75.96, 11.95], [75.8, 12.1], [75.55, 12.3], [75.36, 12.55], [75.1, 12.75], [74.95, 12.8]];
  const DIST = [
    ['Thiruvananthapuram', 76.94, 8.52, 142], ['Kollam', 76.61, 8.89, 96], ['Pathanamthitta', 76.78, 9.26, 58], ['Alappuzha', 76.36, 9.5, 88],
    ['Kottayam', 76.52, 9.59, 104], ['Idukki', 76.97, 9.85, 41], ['Ernakulam', 76.3, 9.98, 186], ['Thrissur', 76.21, 10.53, 152],
    ['Palakkad', 76.65, 10.78, 97], ['Malappuram', 76.07, 11.07, 110], ['Kozhikode', 75.8, 11.26, 128], ['Wayanad', 76.08, 11.61, 36],
    ['Kannur', 75.39, 11.87, 84], ['Kasaragod', 75.02, 12.5, 45],
  ];
  function initMap() {
    const host = $('#kerala'); if (!host) return;
    // an old chart of the Malabar coast — the engraving conventions of antique maps, drawn in the site's gold on backwater teal
    const k = 118, lon0 = 74.7, lat0 = 12.95, P = ([lo, la]) => [(lo - lon0) * k, (lat0 - la) * k];
    const f1 = v => v.toFixed(1);
    const pts = OUTLINE.map(P), coast = 'M' + pts.map(p => p.map(f1).join(' ')).join('L') + 'Z';
    const X0 = -190, Y0 = -34, SW = 560, SH = 640, GOLD = '#E7C27A', CREAM = '#EEF0EA', SEA = '#0C1B1A';
    const rnd = (() => { let a = 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    let s = `<svg viewBox="${X0} ${Y0} ${SW} ${SH}" role="img" aria-label="Map of Kerala marking Arka homes in all 14 districts">
      <defs>
        <linearGradient id="mp-gilt" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#B98A35"/><stop offset=".35" stop-color="#F6DEA6"/><stop offset=".6" stop-color="#C9963A"/><stop offset="1" stop-color="#F0D08E"/></linearGradient>
        <pattern id="mp-land" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0v5" stroke="${GOLD}" stroke-opacity=".09" stroke-width=".7"/></pattern>
        <clipPath id="mp-frame"><rect x="${X0 + 22}" y="${Y0 + 22}" width="${SW - 44}" height="${SH - 44}"/></clipPath>
        <mask id="mp-seamask"><rect x="${X0}" y="${Y0}" width="${SW}" height="${SH}" fill="#fff"/><path d="${coast}" fill="#000"/></mask>
      </defs>
      <g clip-path="url(#mp-frame)">
        <g mask="url(#mp-seamask)">`;
    const cr = [-112, 468];
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; s += `<path d="M${cr[0]} ${cr[1]}L${f1(cr[0] + Math.cos(a) * 900)} ${f1(cr[1] + Math.sin(a) * 900)}" stroke="${GOLD}" stroke-opacity="${i % 4 ? .07 : .14}" stroke-width="${i % 4 ? .45 : .6}"/>`; }
    s += `</g>`;
    // water-lining: engraved lines following the coast out to sea
    for (const d of [30, 23, 17, 12, 8, 4.5]) s += `<path d="${coast}" fill="none" stroke="${GOLD}" stroke-opacity="${(.3 - d * .007).toFixed(2)}" stroke-width="${2 * d + .7}" stroke-linejoin="round"/><path d="${coast}" fill="none" stroke="${SEA}" stroke-width="${2 * d - .7}" stroke-linejoin="round"/>`;
    s += `<path d="${coast}" fill="#12302D"/><path d="${coast}" fill="url(#mp-land)"/>`;
    // Vembanad + rivers
    const V1 = P([76.36, 9.62]), V2 = P([76.32, 9.93]);
    s += `<path d="M${f1(V1[0])} ${f1(V1[1])}C${f1(V1[0] + 9)} ${f1(V1[1] - 12)} ${f1(V2[0] + 8)} ${f1(V2[1] + 8)} ${f1(V2[0])} ${f1(V2[1])}C${f1(V2[0] - 6)} ${f1(V2[1] + 12)} ${f1(V1[0] - 5)} ${f1(V1[1] - 8)} ${f1(V1[0])} ${f1(V1[1])}Z" fill="${SEA}" stroke="${GOLD}" stroke-width=".6" stroke-opacity=".6"/>`;
    const rivers = [[[77.12, 9.62], [76.8, 9.9], [76.5, 10.05], [76.26, 10.12]], [[76.72, 10.78], [76.4, 10.82], [76.12, 10.8], [75.93, 10.8]], [[77.1, 9.34], [76.8, 9.36], [76.55, 9.4], [76.37, 9.44]], [[76.32, 11.4], [76.1, 11.3], [75.95, 11.22], [75.8, 11.18]], [[75.75, 12.02], [75.55, 11.98], [75.38, 11.93]]];
    for (const r of rivers) { const q = r.map(P); let d = `M${f1(q[0][0])} ${f1(q[0][1])}`; for (let i = 1; i < q.length; i++) { const m = [(q[i - 1][0] + q[i][0]) / 2 + (rnd() - .5) * 8, (q[i - 1][1] + q[i][1]) / 2 + (rnd() - .5) * 8]; d += `Q${f1(m[0])} ${f1(m[1])} ${f1(q[i][0])} ${f1(q[i][1])}`; } s += `<path d="${d}" fill="none" stroke="#6FB3A7" stroke-width=".9" stroke-opacity=".7" stroke-linecap="round"/>`; }
    // the Western Ghats, hachured
    const east = OUTLINE.slice(22, 45).map(P);
    for (let i = 0; i < east.length - 1; i++) for (let j = 0; j < 3; j++) {
      const t = (j + rnd() * .6) / 3, a = east[i], b = east[i + 1], x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      const inw = 11 + rnd() * 16, dx = -(b[1] - a[1]), dy = b[0] - a[0], l = Math.hypot(dx, dy) || 1, cx = x - dx / l * inw, cy = y - dy / l * inw, sz = 5 + rnd() * 3.5;
      s += `<g transform="translate(${f1(cx)} ${f1(cy)})" stroke="${CREAM}" fill="none" stroke-width=".6" stroke-opacity=".45"><path d="M${f1(-sz)} 2Q${f1(-sz * .35)} ${f1(-sz * 1.1)} 0 ${f1(-sz * 1.15)}Q${f1(sz * .4)} ${f1(-sz * 1.05)} ${f1(sz)} 2"/><path d="M1 ${f1(-sz * .8)}l1.6 ${f1(sz * .7)}M${f1(sz * .35)} ${f1(-sz * .55)}l1.4 ${f1(sz * .55)}" stroke-opacity=".3"/></g>`;
    }
    s += `<path d="${coast}" fill="none" stroke="${GOLD}" stroke-width="1.3" stroke-linejoin="round"/>`;
    const hub = P([76.3, 9.98]);
    DIST.forEach(([n, lo, la]) => { if (n === 'Ernakulam') return; const [x, y] = P([lo, la]); const mx = (x + hub[0]) / 2 - (y - hub[1]) * .2, my = (y + hub[1]) / 2 + (x - hub[0]) * .2; s += `<path class="route" d="M${f1(hub[0])} ${f1(hub[1])}Q${f1(mx)} ${f1(my)} ${f1(x)} ${f1(y)}" fill="none" stroke="${GOLD}" stroke-width=".8" stroke-opacity=".5"/>`; });
    const lab = (txt, x, y, size, opts = '') => `<text x="${f1(x)}" y="${f1(y)}" font-family="Tenor Sans, sans-serif" font-size="${size}" fill="${CREAM}" ${opts}>${txt}</text>`;
    const side = { Thiruvananthapuram: [-10, 14, 'end'], Kollam: [-10, 4, 'end'], Pathanamthitta: [10, 4, 'start'], Alappuzha: [-10, 5, 'end'], Kottayam: [10, 6, 'start'], Idukki: [10, 4, 'start'], Ernakulam: [-12, 2, 'end'], Thrissur: [-11, 4, 'end'], Palakkad: [10, 4, 'start'], Malappuram: [-10, 6, 'end'], Kozhikode: [-10, 4, 'end'], Wayanad: [10, 4, 'start'], Kannur: [-10, 4, 'end'], Kasaragod: [10, 5, 'start'] };
    DIST.forEach(([n, lo, la]) => { const [x, y] = P([lo, la]), [dx, dy, an] = side[n]; s += lab(n, x + dx, y + dy, n === 'Ernakulam' ? 12 : 10.5, `text-anchor="${an}" opacity="${n === 'Ernakulam' ? .95 : .75}"`); });
    // district seals: small gilt suns, the brand's own mark
    DIST.forEach(([n, lo, la, c], i) => {
      const [x, y] = P([lo, la]), r = 3.2 + Math.sqrt(c) * .4; let rays = '';
      for (let q = 0; q < 12; q++) { const a = q / 12 * Math.PI * 2, r1 = r + 1.4, r2 = r + (q % 2 ? 3 : 4.6); rays += `M${f1(Math.cos(a) * r1)} ${f1(Math.sin(a) * r1)}L${f1(Math.cos(a) * r2)} ${f1(Math.sin(a) * r2)}`; }
      s += `<g class="dist" tabindex="0" data-i="${i}" transform="translate(${f1(x)} ${f1(y)})"><g class="seal"><circle r="${f1(r + 7)}" fill="${GOLD}" fill-opacity=".1"/><path d="${rays}" stroke="${GOLD}" stroke-width=".9" stroke-linecap="round"/><circle r="${f1(r)}" fill="url(#mp-gilt)"/><circle r="${f1(r * .55)}" fill="none" stroke="#6b4a1c" stroke-width=".5"/></g><circle r="${f1(r + 8)}" fill="transparent"/></g>`;
    });
    s += lab('The Arabian Sea', -120, 250, 17, `letter-spacing="4" transform="rotate(-62 -120 250)" opacity=".45"`);
    s += `<text x="250" y="120" font-family="Geist Mono, monospace" font-size="8" letter-spacing="3" fill="${CREAM}" opacity=".35" transform="rotate(58 250 120)">WESTERN GHATS</text>`;
    s += `<g transform="translate(-58 330) scale(.9)" stroke="${GOLD}" stroke-width=".8" fill="none" opacity=".7"><path d="M-22 6Q0 14 22 5L18 9Q0 15 -18 10Z"/><path d="M-2 6L-2 -26M-2 -24Q14 -14 20 4L-2 4"/><path d="M-2 -20Q-14 -10 -18 3L-2 3"/><path d="M-30 13q6 -2 12 0t12 0M4 15q6 -2 12 0t12 0" stroke-opacity=".5"/></g>`;
    { const [cx, cy] = cr; let pts16 = '';
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 - Math.PI / 2, L = i % 4 === 0 ? 44 : i % 2 === 0 ? 30 : 19, w = i % 4 === 0 ? 6.5 : i % 2 === 0 ? 5 : 3.5, ax = Math.cos(a), ay = Math.sin(a), px = -ay, py = ax;
        pts16 += `<path d="M${f1(px * w)} ${f1(py * w)}L${f1(ax * L)} ${f1(ay * L)}L${f1(-px * w)} ${f1(-py * w)}" fill="${i % 4 === 0 ? 'rgba(231,194,122,.22)' : 'none'}" stroke="${GOLD}" stroke-width=".6"/><path d="M0 0L${f1(ax * L)} ${f1(ay * L)}" stroke="${GOLD}" stroke-width=".4" stroke-opacity=".7"/>`; }
      let ticks = ''; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, r1 = 50, r2 = i % 4 ? 53 : 56; ticks += `M${f1(Math.cos(a) * r1)} ${f1(Math.sin(a) * r1)}L${f1(Math.cos(a) * r2)} ${f1(Math.sin(a) * r2)}`; }
      s += `<g transform="translate(${cx} ${cy})" opacity=".85"><circle r="58" fill="none" stroke="${GOLD}" stroke-width=".7"/><circle r="50" fill="none" stroke="${GOLD}" stroke-width=".45"/><path d="${ticks}" stroke="${GOLD}" stroke-width=".5"/>${pts16}<circle r="3.5" fill="url(#mp-gilt)"/>
        <text y="-64" text-anchor="middle" font-family="Geist Mono, monospace" font-size="10" letter-spacing="1" fill="${GOLD}">N</text></g>`; }
    { const x = -168, y = 575, km = k / 111; let bar = ''; for (let i = 0; i < 4; i++) bar += `<rect x="${f1(x + i * 12.5 * km)}" y="${y}" width="${f1(12.5 * km)}" height="3" fill="${i % 2 ? 'none' : GOLD}" stroke="${GOLD}" stroke-width=".5"/>`;
      s += `${bar}<text x="${x}" y="${y - 6}" font-family="Geist Mono, monospace" font-size="7.5" letter-spacing="1.4" fill="${CREAM}" opacity=".55">KILOMETRES</text><text x="${x - 1}" y="${y + 13}" font-family="Geist Mono, monospace" font-size="7.5" fill="${CREAM}" opacity=".55">0</text><text x="${f1(x + 50 * km - 6)}" y="${y + 13}" font-family="Geist Mono, monospace" font-size="7.5" fill="${CREAM}" opacity=".55">50</text>`; }
    s += `<g transform="translate(-160 6)"><text font-family="Geist Mono, monospace" font-size="8.5" letter-spacing="2.4" fill="${GOLD}">KERALA · MALABAR COAST</text><text y="22" font-family="Tenor Sans, sans-serif" font-size="15" fill="${CREAM}" opacity=".85">Arka homes, 2026</text></g>`;
    s += `</g>`;
    { const ix = X0 + 22, iy = Y0 + 22, iw = SW - 44, ih = SH - 44;
      s += `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" fill="none" stroke="${GOLD}" stroke-opacity=".7" stroke-width=".8"/><rect x="${ix - 7}" y="${iy - 7}" width="${iw + 14}" height="${ih + 14}" fill="none" stroke="${GOLD}" stroke-opacity=".45" stroke-width=".8"/>`;
      let segs = '';
      for (let la = 8.5; la < 13; la += .25) { const y = (lat0 - la) * k; if (y < iy || y + .25 * k > iy + ih) continue; if (Math.round(la * 4) % 2) segs += `<rect x="${ix - 7}" y="${f1(y)}" width="7" height="${f1(.25 * k)}" fill="${GOLD}" fill-opacity=".45"/><rect x="${ix + iw}" y="${f1(y)}" width="7" height="${f1(.25 * k)}" fill="${GOLD}" fill-opacity=".45"/>`; if (Math.abs(la - Math.round(la)) < .01) segs += `<text x="${ix + 5}" y="${f1(y + 3)}" font-family="Geist Mono, monospace" font-size="7.5" fill="${CREAM}" opacity=".45">${la}°N</text>`; }
      for (let lo = 73.25; lo < 78; lo += .25) { const x = (lo - lon0) * k; if (x < ix || x + .25 * k > ix + iw) continue; if (Math.round(lo * 4) % 2) segs += `<rect x="${f1(x)}" y="${iy - 7}" width="${f1(.25 * k)}" height="7" fill="${GOLD}" fill-opacity=".45"/><rect x="${f1(x)}" y="${iy + ih}" width="${f1(.25 * k)}" height="7" fill="${GOLD}" fill-opacity=".45"/>`; if (Math.abs(lo - Math.round(lo)) < .01) segs += `<text x="${f1(x + 3)}" y="${iy + 12}" font-family="Geist Mono, monospace" font-size="7.5" fill="${CREAM}" opacity=".45">${lo}°E</text>`; }
      s += segs; }
    s += `</svg>`;
    host.insertAdjacentHTML('beforeend', s);
    const tip = $('#tip');
    const show = g => { const [n, , , c] = DIST[+g.dataset.i]; const r = g.querySelector('.seal').getBoundingClientRect(), hr = host.getBoundingClientRect(); tip.innerHTML = `${n}<small>${c} Arka homes</small>`; tip.style.left = (r.left + r.width / 2 - hr.left) + 'px'; tip.style.top = (r.top - hr.top) + 'px'; tip.style.opacity = 1; };
    $$('.dist', host).forEach(g => { g.addEventListener('mouseenter', () => show(g)); g.addEventListener('focus', () => show(g)); g.addEventListener('mouseleave', () => tip.style.opacity = 0); g.addEventListener('blur', () => tip.style.opacity = 0); });
  }

  /* ---------- footer: one Kerala day on a loop ---------- */
  function initDayLoop() {
    const cv = $('#dayloop'); if (!cv) return;
    const g = cv.getContext('2d'); let W = 0, H = 0, dpr = 1, on = false, raf = 0, lastDraw = 0;
    const rs = () => { dpr = Math.min(devicePixelRatio || 1, 1.6); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); build(); };
    let stars = [], palms = [], hillsA = [], hillsB = [];
    const R = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    function build() {
      stars = Array.from({ length: 140 }, () => [R() * W, R() * H * .55, R() * 1.2 + .3, R() * 6]);
      palms = []; for (let x = -20; x < W + 20; x += 14 + R() * 30) { if (Math.abs(x - W * .6) < 120) continue; palms.push([x, 26 + R() * 34, (R() - .5) * .5, R()]); }
      const ridge = (amp, seed) => Array.from({ length: 40 }, (_, i) => Math.sin(i * .7 + seed) * .4 + Math.sin(i * 1.9 + seed * 2) * .25 + Math.sin(i * .23 + seed) * .6).map(v => v * amp);
      hillsA = ridge(12, 1.3); hillsB = ridge(8, 4.1);
    }
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), rgb = (c, a = 1) => `rgba(${c.map(v => Math.round(v)).join(',')},${a})`;
    const SKY = { night: [hex('#051318'), hex('#0e2a31')], dawn: [hex('#27465e'), hex('#f2b27a')], day: [hex('#5f9fb9'), hex('#d4e9e6')] };
    const PERIOD = 22;
    function draw(ts) {
      const t = ts / 1000, u = (t / PERIOD) % 1, hz = H * .64;
      const day = u < .58, s = day ? u / .58 : (u - .58) / .42, a = Math.PI * s, elev = day ? Math.sin(a) : -Math.sin(a);
      const low = day ? 1 - Math.min(1, elev / .45) : 0, dark = day ? 0 : Math.min(1, Math.sin(a) * 3);
      const top = day ? mix(SKY.dawn[0], SKY.day[0], 1 - low) : mix(SKY.dawn[0], SKY.night[0], dark), bot = day ? mix(SKY.dawn[1], SKY.day[1], 1 - low) : mix(mix(SKY.dawn[1], SKY.night[1], .6), SKY.night[1], dark);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      let gr = g.createLinearGradient(0, 0, 0, hz); gr.addColorStop(0, rgb(top)); gr.addColorStop(1, rgb(bot)); g.fillStyle = gr; g.fillRect(0, 0, W, hz);
      // stars
      if (!day) for (const [x, y, r, p] of stars) { g.fillStyle = `rgba(240,236,220,${(.35 + .35 * Math.sin(t * 2 + p)) * dark})`; g.fillRect(x, y, r, r); }
      // sun (day) / moon (night) travel east → west
      const bx = W * .5 - Math.cos(a) * W * .44, by = hz + 14 - Math.sin(a) * (hz * .82);
      if (day) { const glow = g.createRadialGradient(bx, by, 0, bx, by, 120 + low * 90); glow.addColorStop(0, `rgba(255,225,160,${.55 + low * .3})`); glow.addColorStop(1, 'rgba(255,190,120,0)'); g.fillStyle = glow; g.fillRect(0, 0, W, hz);
        g.fillStyle = low > .5 ? '#FFD28A' : '#FFF4D8'; g.beginPath(); g.arc(bx, by, 15, 0, 7); g.fill(); }
      else { g.fillStyle = 'rgba(230,236,245,.95)'; g.beginPath(); g.arc(bx, by, 10, 0, 7); g.fill(); g.fillStyle = rgb(top); g.beginPath(); g.arc(bx + 4, by - 3, 9, 0, 7); g.fill(); }
      // far ghats
      const hillCol = (base, k) => rgb(mix(mix(hex(base), top, .45), [4, 16, 18], day ? 0 : .55 * dark), 1);
      for (const [arr, off, col] of [[hillsA, 44, '#4e7473'], [hillsB, 26, '#2f5553']]) { g.fillStyle = hillCol(col); g.beginPath(); g.moveTo(0, hz); arr.forEach((v, i) => g.lineTo(i / (arr.length - 1) * W, hz - off - v)); g.lineTo(W, hz); g.fill(); }
      // the bank: palms, neighbours, the tharavadu
      const sil = rgb(mix([14, 38, 36], [4, 12, 12], day ? .2 + low * .5 : 1));
      g.fillStyle = sil; g.fillRect(0, hz - 7, W, 8);
      g.strokeStyle = sil; g.lineCap = 'round';
      for (const [x, h, lean, ph] of palms) {
        const sway = Math.sin(t * 1.1 + ph * 6) * 1.5, tx = x + lean * h + sway, ty = hz - 6 - h;
        g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, hz - 6); g.quadraticCurveTo(x + lean * h * .3, hz - 6 - h * .5, tx, ty); g.stroke();
        g.lineWidth = 1.6; for (let f = 0; f < 7; f++) { const fa = f / 7 * Math.PI * 2 + ph, fl = 11 + (f % 3) * 3; g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + Math.cos(fa) * fl * .6, ty - 4, tx + Math.cos(fa) * fl, ty + 5 + Math.abs(Math.sin(fa)) * 3); g.stroke(); }
      }
      // night story: neighbours lose power late in the night; the tharavadu stays lit
      const nightP = day ? 0 : s, cut = nightP > .42 && nightP < .9, lit = day ? Math.max(0, low - .55) * 2 : 1;
      for (const [nx, nw] of [[W * .16, 34], [W * .3, 28], [W * .84, 30]]) {
        g.fillStyle = sil; g.beginPath(); g.moveTo(nx - nw / 2 - 4, hz - 16); g.lineTo(nx, hz - 30); g.lineTo(nx + nw / 2 + 4, hz - 16); g.fill(); g.fillRect(nx - nw / 2, hz - 17, nw, 12);
        if (lit > .02 && !cut) { g.fillStyle = `rgba(255,190,110,${.85 * lit})`; g.fillRect(nx - nw / 4, hz - 13, 4, 4); g.fillRect(nx + nw / 5, hz - 13, 4, 4); }
      }
      { const hx = W * .6, hw = 120;
        g.fillStyle = sil;
        g.beginPath(); g.moveTo(hx - hw / 2 - 14, hz - 30); g.lineTo(hx - hw * .3, hz - 58); g.lineTo(hx + hw * .3, hz - 58); g.lineTo(hx + hw / 2 + 14, hz - 30); g.fill();
        g.beginPath(); g.moveTo(hx - 13, hz - 58); g.lineTo(hx, hz - 70); g.lineTo(hx + 13, hz - 58); g.fill();
        g.lineWidth = 2; g.beginPath(); g.moveTo(hx - hw * .3, hz - 58); g.quadraticCurveTo(hx - hw * .3 - 8, hz - 62, hx - hw * .3 - 9, hz - 70); g.moveTo(hx + hw * .3, hz - 58); g.quadraticCurveTo(hx + hw * .3 + 8, hz - 62, hx + hw * .3 + 9, hz - 70); g.stroke();
        g.fillRect(hx - hw / 2, hz - 31, hw, 26);
        // solar modules on the roof: they catch the sun by day
        const glint = day ? Math.max(0, Math.sin(a)) : 0;
        for (let i = 0; i < 6; i++) { const px = hx - hw * .36 + i * 13.5; g.fillStyle = `rgb(${24 + glint * 150},${46 + glint * 120},${72 + glint * 80})`; g.beginPath(); g.moveTo(px, hz - 34); g.lineTo(px + 11, hz - 34); g.lineTo(px + 9, hz - 47); g.lineTo(px + 2, hz - 47); g.fill(); }
        // windows: lit from dusk on, and through the outage — the battery at work
        const wl = day ? Math.max(0, low - .5) * 2 : 1;
        if (wl > .02) { g.fillStyle = `rgba(255,${176 + 20 * Math.sin(t * 3)},96,${wl})`; for (let i = 0; i < 5; i++) g.fillRect(hx - hw * .38 + i * hw * .19, hz - 24, 7, 9);
          const gl = g.createRadialGradient(hx, hz - 18, 0, hx, hz - 18, 90); gl.addColorStop(0, `rgba(255,170,90,${.22 * wl})`); gl.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gl; g.fillRect(hx - 100, hz - 110, 200, 110); }
      }
      // the water: a darker mirror of the sky, a light path, ripples
      gr = g.createLinearGradient(0, hz, 0, H); gr.addColorStop(0, rgb(mix(bot, [8, 30, 30], .45))); gr.addColorStop(1, rgb(mix(top, [4, 16, 16], .6))); g.fillStyle = gr; g.fillRect(0, hz, W, H - hz);
      const path = (x, col, w) => { for (let yy = hz + 4; yy < H; yy += 5) { const k = (yy - hz) / (H - hz), wob = Math.sin(yy * .35 + t * 3) * (2 + k * 10), len = w * (1 + k * 2.4) * (.6 + .4 * Math.sin(yy * 1.7 + t * 5)); g.fillStyle = col(1 - k * .6); g.fillRect(x - len / 2 + wob, yy, len, 1.4); } };
      if (by < hz + 10) path(bx, k => day ? `rgba(255,214,150,${.5 * k * (.4 + low * .6)})` : `rgba(220,230,245,${.22 * k})`, 16);
      if (!day || low > .5) path(W * .6, k => `rgba(255,178,100,${.3 * k * (day ? (low - .5) * 2 : 1)})`, 26);
      g.strokeStyle = 'rgba(220,235,230,.08)'; g.lineWidth = 1; for (let i = 0; i < 16; i++) { const yy = hz + 8 + i * i * 1.3, x = ((i * 137 + t * 12 * (1 + i * .1)) % (W + 200)) - 100; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 40 + i * 6, yy); g.stroke(); }
      // a houseboat drifts past
      { const x = ((t * 14) % (W + 300)) - 150, y = hz + 22; g.fillStyle = rgb(mix(sil.match(/\d+/g).slice(0, 3).map(Number), [0, 0, 0], .1)); g.beginPath(); g.moveTo(x - 40, y); g.quadraticCurveTo(x, y + 9, x + 40, y); g.lineTo(x + 30, y + 5); g.lineTo(x - 30, y + 5); g.fill(); g.beginPath(); g.ellipse(x - 4, y - 2, 26, 8, 0, Math.PI, 0); g.fill(); if (!day || low > .6) { g.fillStyle = 'rgba(255,190,110,.8)'; for (let i = 0; i < 4; i++) g.fillRect(x - 22 + i * 11, y - 5, 3, 3); } }
      // the time, in the corner
      const mins = Math.round((6 * 60 + u * 1440)) % 1440, hh = Math.floor(mins / 60), mm = mins % 60;
      g.fillStyle = 'rgba(238,240,234,.75)'; g.font = '500 11px "Geist Mono", monospace'; g.fillText(`${(hh % 12) || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}  ·  ${cut ? 'GRID OFF · BATTERY ON' : day ? (elev > .15 ? 'SOLAR ON' : 'LOW SUN') : 'BATTERY'}`, 16, 24);
    }
    const loop = ts => { if (!on) return; raf = requestAnimationFrame(loop); if (ts - lastDraw < 32) return; lastDraw = ts; draw(ts); };
    new IntersectionObserver(es => es.forEach(e => { on = e.isIntersecting; if (on) { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); } })).observe(cv);
    addEventListener('resize', rs); rs(); draw(reduce ? 9000 : 0);
  }

  /* ---------- FAQ: one open at a time ---------- */
  function initFaq() { $$('#faq details').forEach(d => d.addEventListener('toggle', () => { if (d.open) $$('#faq details').forEach(o => { if (o !== d) o.open = false; }); })); }

  /* ---------- lead form ---------- */
  function initForm() {
    const f = $('#leadForm'); if (!f) return;
    const sel = $('#fDist'); DIST.map(d => d[0]).sort().forEach(n => sel.insertAdjacentHTML('beforeend', `<option>${n}</option>`));
    const err = $('#fErr'), next = $('#fNext'), back = $('#fBack'), lbl = $('#fNext .lbl');
    const go = n => { f.dataset.step = n; $('#pLbl').textContent = `${Math.min(n, 2)} / 2`; $('#pFill').style.width = (n >= 2 ? 100 : 50) + '%'; back.hidden = n !== 2; lbl.textContent = n === 2 ? 'Request my free survey' : 'Next'; err.textContent = ''; };
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (f.dataset.step === '1') {
        const name = $('#fName').value.trim(), phone = $('#fPhone').value.replace(/[^\d]/g, ''), pin = $('#fPin').value.trim();
        if (!name) return err.textContent = 'Please tell us your name.', $('#fName').focus();
        if (phone.length < 10) return err.textContent = 'Please enter a 10-digit phone number.', $('#fPhone').focus();
        if (!/^6[7-9]\d{4}$/.test(pin)) return err.textContent = 'Kerala PIN codes start with 67, 68 or 69.', $('#fPin').focus();
        if (!sel.value) return err.textContent = 'Please choose your district.', sel.focus();
        go(2); $('#fBill').focus();
      } else if (f.dataset.step === '2') { go(3); }
    });
    back.addEventListener('click', () => go(1));
    void next;
    const bill = $('#billIn'); if (bill) $('#fBill').placeholder = bill.value;
  }

  /* ---------- images (embedded placeholders) ---------- */
  function initImages() {
    let data = {}; try { data = JSON.parse(document.getElementById('img-data').textContent); } catch (e) { }
    $$('img[data-img]').forEach(img => { const src = data[img.dataset.img]; if (src) img.src = src; });
  }

  // deep links like ?at=energy jump straight to a scene (handy for sharing a section)
  function initDeepLink() {
    const q = new URLSearchParams(location.search), at = q.get('at'); if (!at) return;
    const go = () => { const el = document.getElementById(at); if (el) { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, el.offsetTop + (+q.get('off') || 0)); } };
    go(); addEventListener('load', go);
  }
  function boot() { initImages(); initCalc(); initNav(); initReveal(); initLive(); initExplore(); initMap(); initFaq(); initForm(); initDeepLink(); initDayLoop(); initLiquidGlass(); setTimeout(() => document.documentElement.classList.add('world-ready'), 9000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
