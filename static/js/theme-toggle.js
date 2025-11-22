document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const themeToggleAuth = document.getElementById('theme-toggle-auth');
  const body = document.body;
  const currentTheme = localStorage.getItem('theme') || 'light';

  body.setAttribute('data-theme', currentTheme);
  
  const updateThemeIcon = (theme) => {
    const icon = theme === 'light' ? '🌙' : '☀️';
    if (themeToggle) {
      const iconElement = themeToggle.querySelector('.theme-icon');
      if (iconElement) {
        iconElement.textContent = icon;
      } else {
        themeToggle.textContent = icon;
      }
    }
    if (themeToggleAuth) {
      themeToggleAuth.textContent = icon;
    }
  };

  updateThemeIcon(currentTheme);

  const toggleTheme = () => {
    const newTheme = body.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
  };

  if (themeToggle) {
    themeToggle.onclick = toggleTheme;
  }
  
  if (themeToggleAuth) {
    themeToggleAuth.onclick = toggleTheme;
  }
});