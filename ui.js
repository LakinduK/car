// Page chrome: header style on scroll, the tabbed control dock, and wheel
// handling over the 3D viewer. The 3D viewer itself lives in main.js.

const header = document.querySelector('.masthead');
const hero = document.querySelector('.hero');

function updateHeader() {
  header.classList.toggle('is-solid', scrollY > hero.offsetHeight - header.offsetHeight - 8);
}
addEventListener('scroll', updateHeader, { passive: true });
addEventListener('resize', updateHeader);
updateHeader();

// Tabs: Doors / View / Paint / Plate.
const tabs = [...document.querySelectorAll('[role="tab"]')];

function selectTab(tab, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}

tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
  });
});

// The viewer fills the screen, so a plain mouse wheel should scroll the page.
// Zoom only with Ctrl/Cmd held; a trackpad pinch also arrives as Ctrl + wheel.
document.getElementById('stage').addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
  },
  { capture: true }
);

if (matchMedia('(pointer: coarse)').matches) {
  document.getElementById('hint').textContent = 'Drag to turn · pinch to zoom · tap a door';
}

document.getElementById('year').textContent = new Date().getFullYear();
