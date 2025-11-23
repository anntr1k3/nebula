// Создание группы на отдельной странице
document.addEventListener('DOMContentLoaded', () => {
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
  
  const groupNameInput = document.getElementById('group-name-input');
  const createGroupSubmit = document.getElementById('create-group-submit');
  
  if (groupNameInput && createGroupSubmit) {
    createGroupSubmit.addEventListener('click', async () => {
      const groupName = groupNameInput.value.trim();
      
      if (groupName.length < 3) {
        showError(translations.min_chars || 'Название группы должно быть минимум 3 символа');
        return;
      }
      
      if (groupName.length > 100) {
        showError('Название группы не должно превышать 100 символов');
        return;
      }
      
      // Блокируем кнопку во время отправки
      createGroupSubmit.disabled = true;
      const originalText = createGroupSubmit.textContent;
      createGroupSubmit.textContent = translations.loading || 'Загрузка...';
      
      try {
        const response = await fetch('/api/rooms/group', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name: groupName })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to create group');
        }
        
        // Перенаправляем на главную страницу с параметром для переключения на созданную группу
        window.location.href = `/?room=${data.room_id}`;
      } catch (error) {
        console.error('Error creating group:', error);
        showError(translations.error_occurred || 'Ошибка создания группы: ' + error.message);
        
        // Разблокируем кнопку
        createGroupSubmit.disabled = false;
        createGroupSubmit.textContent = originalText;
      }
    });
    
    groupNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !createGroupSubmit.disabled) {
        createGroupSubmit.click();
      }
    });
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
