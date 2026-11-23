// Analog instrument dials for the key figures, drawn as SVG. When they scroll
// into view the needles do an "ignition check": sweep to full scale, then
// settle on the real value, while the digital readout counts up.

import { specs } from './specs.js';

const START = 135; // degrees, 0 = pointing right, clockwise
const SWEEP = 270;
const C = 100; // centre of the 200 x 200 view box

const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
};

function arc(r, a0, a1) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function gaugeSvg(g, i) {
  const angle = (v) => START + (SWEEP * (v - g.min)) / (g.max - g.min);
  const id = `g${i}`;
  let ticks = '';
  let labels = '';
  for (let t = 0; t <= g.ticks; t++) {
    const v = g.min + ((g.max - g.min) * t) / g.ticks;
    const a = angle(v);
    const major = t % g.majorEvery === 0;
    const red = g.redFrom !== undefined && v >= g.redFrom - 1e-9 && v <= g.redTo + 1e-9;
    const [x0, y0] = polar(major ? 70 : 76, a);
    const [x1, y1] = polar(85, a);
    ticks += `<line class="g-tick${major ? ' major' : ''}${red ? ' red' : ''}" x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}"/>`;
    if (major) {
      const [lx, ly] = polar(57, a);
      const text = g.labels ? g.labels[t / g.majorEvery] : Math.round(v);
      labels += `<text class="g-label${red ? ' red' : ''}" x="${lx.toFixed(2)}" y="${(ly + 4).toFixed(2)}">${text}</text>`;
    }
  }
  const red =
    g.redFrom !== undefined ? `<path class="g-red" d="${arc(81, angle(g.redFrom), angle(g.redTo))}"/>` : '';
  return `
  <svg viewBox="0 0 200 200" role="img" aria-label="${g.caption}: ${g.readout} ${g.unit}">
    <defs>
      <radialGradient id="${id}-face" cx="50%" cy="38%" r="65%">
        <stop offset="0" stop-color="#25262b"/><stop offset="1" stop-color="#0b0c0e"/>
      </radialGradient>
      <linearGradient id="${id}-bezel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6b6d73"/><stop offset=".5" stop-color="#2a2b30"/><stop offset="1" stop-color="#8a8c92"/>
      </linearGradient>
    </defs>
    <circle cx="100" cy="100" r="97" fill="url(#${id}-face)" stroke="url(#${id}-bezel)" stroke-width="4"/>
    <path class="g-track" d="${arc(86, START, START + SWEEP)}"/>
    ${red}
    ${ticks}
    ${labels}
    ${g.legend ? `<text class="g-legend" x="100" y="76">${g.legend}</text>` : ''}
    <text class="g-value" x="100" y="174" data-value>${g.readout}</text>
    <text class="g-unit" x="100" y="188">${g.unit}</text>
    <g class="needle" style="transform: rotate(${START}deg)">
      <path d="M82 100 L100 96.6 L178 100 L100 103.4 Z"/>
    </g>
    <circle class="g-cap" cx="100" cy="100" r="9"/>
  </svg>`;
}

const host = document.querySelector('[data-gauges]');
const gauges = specs.gauges ?? [];
host.innerHTML = gauges
  .map(
    (g, i) => `
    <figure class="gauge">
      ${gaugeSvg(g, i)}
      <figcaption><strong>${g.caption}</strong><span>${g.sub}</span></figcaption>
    </figure>`
  )
  .join('');

const figures = [...host.querySelectorAll('.gauge')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const angleOf = (g, v) => START + (SWEEP * (v - g.min)) / (g.max - g.min);

function settle(fig, g) {
  fig.querySelector('.needle').style.transform = `rotate(${angleOf(g, g.value)}deg)`;
  fig.querySelector('[data-value]').textContent = g.readout;
}

function ignition(fig, g, delay) {
  const needle = fig.querySelector('.needle');
  const readout = fig.querySelector('[data-value]');
  const target = Number(String(g.readout).replace(/,/g, ''));
  const up = 520;
  const down = 900;

  setTimeout(() => {
    needle.style.transition = `transform ${up}ms cubic-bezier(0.65, 0, 0.35, 1)`;
    needle.style.transform = `rotate(${START + SWEEP}deg)`;
    setTimeout(() => {
      needle.style.transition = `transform ${down}ms cubic-bezier(0.23, 1, 0.32, 1)`;
      needle.style.transform = `rotate(${angleOf(g, g.value)}deg)`;
    }, up + 60);

    const t0 = performance.now();
    const total = up + 60 + down;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / total);
      const eased = 1 - Math.pow(1 - k, 3);
      readout.textContent = Math.round(target * eased).toLocaleString('en-US');
      if (k < 1) requestAnimationFrame(tick);
      else readout.textContent = g.readout;
    };
    requestAnimationFrame(tick);
  }, delay);
}

if (reduceMotion || !('IntersectionObserver' in window)) {
  figures.forEach((fig, i) => settle(fig, gauges[i]));
} else {
  figures.forEach((fig) => (fig.querySelector('[data-value]').textContent = '0'));
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      figures.forEach((fig, i) => ignition(fig, gauges[i], i * 90));
    },
    { threshold: 0.45 }
  );
  io.observe(host);
}
