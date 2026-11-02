// Small SVG column charts with an optional average line and a hover readout.
// Colors are validated for the white card surface (dataviz validate_palette):
// --chart-line #1F4FD0 and --chart-col #93AEF2. The light column color is below 3:1
// against white, so every chart also has a legend and a table view.

const SVG = 'http://www.w3.org/2000/svg';

// Top of the y-axis: four clean gridline steps just above the largest value.
function niceMax(value) {
  if (value <= 0) return 1;
  const raw = value / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * exp >= raw) * exp;
  return step * 4;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// A column with a 4px rounded top, square at the baseline.
function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Draw a column chart into `box` (a div), sized to its width.
 * points: [{ label, axisLabel?, value (number|null), line? (number|null), tip: [[label, text], ...] }]
 * options: { height, money, lineLabel, colLabel }
 */
export function drawColumns(box, points, { height = 220, money = false, unitPrefix = money ? '$' : '', strong = false } = {}) {
  if (!box || !box.isConnected) return;
  box.textContent = '';
  box.classList.add('chart');
  const width = Math.max(280, box.clientWidth || 600);
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...points.map((p) => Math.max(p.value ?? 0, p.line ?? 0))));
  const y = (v) => pad.top + plotH - (v / max) * plotH;
  const slot = plotW / Math.max(1, points.length);
  const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
  const barW = Math.max(1, Math.min(24, slot - gap));

  const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img' });
  // Gridlines and y-axis labels (hairline, recessive).
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    const gy = y(v);
    svg.append(el('line', { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy, class: i === 0 ? 'chart__base' : 'chart__grid' }));
    const t = el('text', { x: pad.left - 6, y: gy + 4, 'text-anchor': 'end', class: 'chart__tick' });
    t.textContent = `${unitPrefix}${compact.format(v)}`;
    svg.append(t);
  }
  // X labels: only where the point asks for one.
  points.forEach((p, i) => {
    if (!p.axisLabel) return;
    const t = el('text', { x: pad.left + slot * i + slot / 2, y: height - 8, 'text-anchor': 'middle', class: 'chart__tick' });
    t.textContent = p.axisLabel;
    svg.append(t);
  });
  // Columns.
  points.forEach((p, i) => {
    if (p.value == null || p.value <= 0) return;
    const x = pad.left + slot * i + (slot - barW) / 2;
    svg.append(el('path', { d: columnPath(x, y(p.value), barW, plotH - (y(p.value) - pad.top)), class: strong ? 'chart__col chart__col--strong' : 'chart__col' }));
  });
  // Average line (2px), broken where there's no value.
  if (points.some((p) => p.line != null)) {
    let d = '';
    let pen = false;
    points.forEach((p, i) => {
      if (p.line == null) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${pad.left + slot * i + slot / 2},${y(p.line)}`;
      pen = true;
    });
    svg.append(el('path', { d, class: 'chart__line' }));
  }
  // Crosshair + hover readout.
  const cross = el('line', { y1: pad.top, y2: pad.top + plotH, class: 'chart__cross', visibility: 'hidden' });
  const dot = el('circle', { r: 4, class: 'chart__dot', visibility: 'hidden' });
  svg.append(cross, dot);
  const hit = el('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: 'transparent', tabindex: 0 });
  svg.append(hit);
  box.append(svg);

  const tip = document.createElement('div');
  tip.className = 'chart__tip';
  tip.hidden = true;
  box.append(tip);

  const show = (i) => {
    const p = points[i];
    if (!p) return;
    const cx = pad.left + slot * i + slot / 2;
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    if (p.line != null) {
      dot.setAttribute('cx', cx);
      dot.setAttribute('cy', y(p.line));
      dot.setAttribute('visibility', 'visible');
    } else dot.setAttribute('visibility', 'hidden');
    tip.textContent = '';
    const head = document.createElement('p');
    head.className = 'chart__tip-head';
    head.textContent = p.label;
    tip.append(head);
    for (const [label, text] of p.tip || []) {
      const row = document.createElement('p');
      const strong = document.createElement('strong');
      strong.textContent = text;
      row.append(strong, ` ${label}`);
      tip.append(row);
    }
    tip.hidden = false;
    const left = Math.min(Math.max(cx + 12, 0), width - tip.offsetWidth - 4);
    tip.style.left = `${cx + 12 + tip.offsetWidth > width ? cx - tip.offsetWidth - 12 : left}px`;
    tip.style.top = `${pad.top}px`;
  };
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
  };
  let current = points.length - 1;
  hit.addEventListener('pointermove', (event) => {
    const rect = svg.getBoundingClientRect();
    current = Math.min(points.length - 1, Math.max(0, Math.floor((event.clientX - rect.left - pad.left) / slot)));
    show(current);
  });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => show(current));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') current = Math.max(0, current - 1);
    else if (event.key === 'ArrowRight') current = Math.min(points.length - 1, current + 1);
    else return;
    event.preventDefault();
    show(current);
  });
}

// Redraw charts when the window width changes.
export function keepSized(draws) {
  let timer;
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(() => draws.forEach((d) => d()), 150);
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
