// Переключение языка на главной странице
document.addEventListener('DOMContentLoaded', () => {
  const languageBtn = document.getElementById('language-btn');
  let currentLang = document.body.dataset.lang || 'ru';
  let translations = {};
  
  // Загрузка переводов
  async function loadTranslations(lang) {
    try {
      const response = await fetch(`/api/translations/${lang}`);
      translations = await response.json();
      updateUITranslations();
    } catch (error) {
      console.error('Error loading translations:', error);
    }
  }
  
  // Обновление переводов в интерфейсе
  function updateUITranslations() {
    document.querySelectorAll('[data-i18n]').forEach(element => {
      const key = element.dataset.i18n;
      if (translations[key]) {
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.placeholder = translations[key];
        } else {
          element.textContent = translations[key];
        }
      }
    });
  }
  
  // Переключение языка
  if (languageBtn) {
    languageBtn.addEventListener('click', async () => {
      const newLang = currentLang === 'ru' ? 'en' : 'ru';
      
      try {
        const response = await fetch('/api/profile/language', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ language: newLang })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          currentLang = newLang;
          document.body.dataset.lang = newLang;
          await loadTranslations(newLang);
          updateLanguageButton();
          showSuccess(translations.success || 'Success');
        } else {
          throw new Error(data.error || 'Failed to change language');
        }
      } catch (error) {
        console.error('Error changing language:', error);
        showError(translations.error_occurred || 'Error occurred');
      }
    });
  }
  
  function updateLanguageButton() {
    const langText = languageBtn.querySelector('.lang-text');
    if (langText) {
      langText.textContent = currentLang === 'ru' ? 'EN' : 'RU';
    }
  }
  
  function showSuccess(message) {
    const successDiv = document.createElement('div');
    successDiv.className = 'user-success-message';
    successDiv.style.cssText = `
      position: fixed;
      top: 5rem;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(76, 175, 80, 0.9);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      z-index: 2000;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      animation: slideDown 0.3s ease-out;
    `;
    successDiv.textContent = `✓ ${message}`;
    document.body.appendChild(successDiv);
    
    setTimeout(() => {
      successDiv.style.transition = 'opacity 0.3s';
      successDiv.style.opacity = '0';
      setTimeout(() => successDiv.remove(), 300);
    }, 3000);
  }
  
  function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'user-error-message';
    errorDiv.style.cssText = `
      position: fixed;
      top: 5rem;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(244, 67, 54, 0.9);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      z-index: 2000;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      animation: slideDown 0.3s ease-out;
    `;
    errorDiv.textContent = `⚠️ ${message}`;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
      errorDiv.style.transition = 'opacity 0.3s';
      errorDiv.style.opacity = '0';
      setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
  }
  
  // Загрузка переводов при старте
  loadTranslations(currentLang);
});
