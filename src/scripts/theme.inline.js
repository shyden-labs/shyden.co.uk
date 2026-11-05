(() => {
  const root = document.documentElement;
  const os = matchMedia('(prefers-color-scheme: dark)');
  const saved = () => {
    try {
      const theme = localStorage.getItem('theme');
      return theme === 'light' || theme === 'dark' ? theme : null;
    } catch {
      return null;
    }
  };
  const apply = () => {
    const theme = saved();
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  const showing = () => root.dataset.theme ?? (os.matches ? 'dark' : 'light');
  const press = () => {
    for (const toggle of document.querySelectorAll('[data-theme-toggle]'))
      toggle.setAttribute('aria-pressed', String(showing() === 'dark'));
  };
  apply();
  root.dataset.themeSwitch = '';
  document.addEventListener('DOMContentLoaded', press);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest('[data-theme-toggle]')) return;
    const theme = showing() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {}
    press();
  });
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    apply();
    press();
  });
  os.addEventListener?.('change', press);
})();
