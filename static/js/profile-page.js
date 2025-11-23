// Управление профилем на отдельной странице
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
  
  // Загрузка профиля
  async function loadProfile() {
    try {
      const response = await fetch('/api/profile');
      const profile = await response.json();
      
      if (response.ok) {
        document.getElementById('current-username').textContent = profile.username;
        document.getElementById('current-avatar').textContent = profile.avatar;
        document.getElementById('new-username-input').value = '';
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  }
  
  // Изменение аватара
  const avatarOptions = document.querySelectorAll('.avatar-option');
  avatarOptions.forEach(option => {
    option.addEventListener('click', async () => {
      const avatar = option.textContent.trim();
      
      try {
        const response = await fetch('/api/profile/avatar', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ avatar })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          document.getElementById('current-avatar').textContent = data.avatar;
          showSuccess(translations.profile_updated || 'Profile updated');
          
          // Обновляем выбранный аватар
          avatarOptions.forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
        } else {
          throw new Error(data.error || 'Failed to update avatar');
        }
      } catch (error) {
        console.error('Error updating avatar:', error);
        showError(translations.error_occurred || 'Error occurred');
      }
    });
  });
  
  // Изменение никнейма
  const changeUsernameBtn = document.getElementById('change-username-btn');
  if (changeUsernameBtn) {
    changeUsernameBtn.addEventListener('click', async () => {
      const newUsername = document.getElementById('new-username-input').value.trim();
      
      if (!newUsername || newUsername.length < 3) {
        showError(translations.username_invalid || 'Username must be at least 3 characters');
        return;
      }
      
      try {
        const response = await fetch('/api/profile/username', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ username: newUsername })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          document.getElementById('current-username').textContent = data.username;
          document.getElementById('new-username-input').value = '';
          showSuccess(translations.profile_updated || 'Profile updated');
        } else {
          if (data.error === 'Username already taken') {
            showError(translations.username_taken || 'Username already taken');
          } else {
            throw new Error(data.error || 'Failed to update username');
          }
        }
      } catch (error) {
        console.error('Error updating username:', error);
        showError(translations.error_occurred || 'Error occurred');
      }
    });
  }
  
  // Вспомогательные функции
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
  
  // Загрузка переводов и профиля при старте
  loadTranslations(currentLang);
  loadProfile();
});
