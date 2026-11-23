// Page chrome: header style on scroll, the tabbed control dock, and wheel
// handling over the 3D viewer. The 3D viewer itself lives in main.js.

const header = document.querySelector('.masthead');
const hero = document.querySelector('.hero');

function updateHeader() {
  header.classList.toggle('is-solid', scrollY > hero.offsetHeight - header.offsetHeight - 8);
  header.classList.toggle('is-scrolled', scrollY > 8);
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

// Light / dark theme. The inline script in <head> already applied the saved or
// system theme; this keeps the button in step and remembers a manual choice.
const root = document.documentElement;
const toggle = document.getElementById('theme-toggle');
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function savedTheme() {
  try {
    return localStorage.getItem('theme');
  } catch {
    return null;
  }
}

function setTheme(theme) {
  root.dataset.theme = theme;
  toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

toggle.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  try {
    localStorage.setItem('theme', next);
  } catch {
    /* private mode: the choice just won't be remembered */
  }
});

systemDark.addEventListener('change', (e) => {
  if (!savedTheme()) setTheme(e.matches ? 'dark' : 'light');
});

setTheme(root.dataset.theme || (systemDark.matches ? 'dark' : 'light'));
