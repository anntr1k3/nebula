// Поиск пользователей и создание чата на отдельной странице
document.addEventListener('DOMContentLoaded', () => {
  let currentLang = document.body.dataset.lang || 'ru';
  let translations = {};
  let searchTimeout = null;
  
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
  
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  
  if (searchInput && searchResults) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      
      clearTimeout(searchTimeout);
      
      if (query.length === 0) {
        searchResults.innerHTML = '';
        return;
      }
      
      if (query.length < 2) {
        searchResults.innerHTML = `<div class="no-results">${translations.min_chars || 'Введите минимум 2 символа'}</div>`;
        return;
      }
      
      searchResults.innerHTML = `<div class="loading">${translations.loading || 'Загрузка...'}</div>`;
      
      searchTimeout = setTimeout(async () => {
        try {
          const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Search failed' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
          }
          
          const users = await response.json();
          
          if (!Array.isArray(users)) {
            throw new Error('Invalid response format');
          }
          
          if (users.length === 0) {
            searchResults.innerHTML = `<div class="no-results">${translations.no_results || 'Пользователи не найдены'}</div>`;
            return;
          }
          
          searchResults.innerHTML = '';
          users.forEach(user => {
            if (!user || !user.id || !user.username) {
              console.warn('Invalid user data:', user);
              return;
            }
            
            const userDiv = document.createElement('div');
            userDiv.className = 'user-result';
            userDiv.innerHTML = `
              <span class="username">👤 ${escapeHtml(user.username)}</span>
              <span class="action">${translations.write || 'Написать'}</span>
            `;
            userDiv.addEventListener('click', () => createPrivateChat(user));
            searchResults.appendChild(userDiv);
          });
        } catch (error) {
          console.error('Search error:', error);
          searchResults.innerHTML = `<div class="no-results">${translations.error || 'Ошибка'}</div>`;
          showError(translations.error_occurred || 'Произошла ошибка при поиске');
        }
      }, 300);
    });
  }
  
  async function createPrivateChat(user) {
    if (!user || !user.id) {
      showError(translations.error_occurred || 'Неверные данные пользователя');
      return;
    }
    
    try {
      const response = await fetch(`/api/rooms/private/${user.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create chat');
      }
      
      if (!data.room_id || !data.room_name) {
        throw new Error('Неверный формат ответа сервера');
      }
      
      // Перенаправляем на главную страницу с параметром для переключения на созданный чат
      window.location.href = `/?room=${data.room_id}`;
    } catch (error) {
      console.error('Error creating private chat:', error);
      showError(translations.error_occurred || 'Ошибка создания чата: ' + error.message);
    }
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
