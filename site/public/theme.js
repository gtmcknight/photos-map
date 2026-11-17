// One day/night switch. Day is the default; night is the only thing remembered, under this site's own
// key (every app on taylor.fyi shares one localStorage).
const KEY = 'map-for-google-photos:theme';
const root = document.documentElement;
const button = document.querySelector('.theme');
const colour = document.querySelector('meta[name="theme-color"]');

function paint() {
  const night = root.dataset.theme === 'dark';
  button.setAttribute('aria-label', night ? 'Switch to day' : 'Switch to night');
  // (an svg has no .hidden property, so the attribute itself)
  button.querySelector('.sun').toggleAttribute('hidden', !night);
  button.querySelector('.moon').toggleAttribute('hidden', night);
  colour.content = night ? '#0e0e11' : '#ffffff';
}

button.addEventListener('click', () => {
  const night = root.dataset.theme !== 'dark';
  root.classList.add('no-transition');
  if (night) root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  try {
    if (night) localStorage.setItem(KEY, 'dark');
    else localStorage.removeItem(KEY);
  } catch { /* private window: the switch still works for this visit */ }
  paint();
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transition')));
});

paint();
