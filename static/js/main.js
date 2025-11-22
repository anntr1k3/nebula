document.addEventListener('DOMContentLoaded', () => {
  // Проверка наличия Socket.IO
  if (typeof io === 'undefined') {
    console.error('Socket.IO library not loaded');
    alert('Ошибка загрузки библиотеки Socket.IO. Пожалуйста, обновите страницу.');
    return;
  }
  
  const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });
  
  const messages = document.getElementById('messages');
  const input = document.getElementById('message-input');
  const sendButton = document.getElementById('send-button');
  const charCount = document.getElementById('char-count');
  const connectionStatus = document.getElementById('connection-status');
  const typingIndicator = document.getElementById('typing-indicator');
  const roomsList = document.getElementById('rooms-list');
  const roomTitle = document.getElementById('room-title');
  const inviteBtn = document.getElementById('invite-btn');
  const membersBtn = document.getElementById('members-btn');
  
  // Кнопки действий
  const searchUserBtn = document.getElementById('search-user-btn');
  const createGroupBtn = document.getElementById('create-group-btn');
  
  // Модальные окна
  const searchModal = document.getElementById('search-modal');
  const groupModal = document.getElementById('group-modal');
  const inviteModal = document.getElementById('invite-modal');
  const membersModal = document.getElementById('members-modal');
  
  let currentRoomId = null;
  let currentRoomData = null;
  let typingTimeout = null;
  let notificationSound = null;
  let searchTimeout = null;
  let currentPage = 1;
  let isLoadingMessages = false;
  
  // Создание звука уведомления
  try {
    if (window.AudioContext || window.webkitAudioContext) {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      notificationSound = () => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
        
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
      };
    }
  } catch (e) {
    console.warn('Audio notifications not available:', e);
  }
  
  // Обработка подключения
  socket.on('connect', () => {
    console.log('Подключено к серверу');
    updateConnectionStatus('connected');
    
    if (currentRoomId) {
      socket.emit('join_room', { room_id: currentRoomId });
    }
  });

  socket.on('disconnect', () => {
    console.log('Отключено от сервера');
    updateConnectionStatus('disconnected');
  });

  socket.on('connect_error', (error) => {
    console.error('Ошибка подключения:', error);
    updateConnectionStatus('disconnected');
    showUserError('Ошибка подключения к серверу');
  });
  
  function updateConnectionStatus(status) {
    connectionStatus.className = status;
    connectionStatus.textContent = status === 'connected' ? 
      '🟢 Подключено' : '🔴 Отключено';
  }
  
  // Переключение комнат
  roomsList.addEventListener('click', (e) => {
    const roomItem = e.target.closest('li[data-room-id]');
    if (roomItem) {
      const roomId = parseInt(roomItem.dataset.roomId);
      const isGroup = roomItem.dataset.isGroup === 'true';
      const isPrivate = roomItem.dataset.isPrivate === 'true';
      switchRoom(roomId, roomItem.textContent.trim(), isGroup, isPrivate);
    }
  });
  
  function switchRoom(roomId, roomName, isGroup, isPrivate) {
    if (currentRoomId) {
      socket.emit('leave_room', { room_id: currentRoomId });
      document.querySelector(`li[data-room-id="${currentRoomId}"]`)?.classList.remove('active');
    }
    
    currentRoomId = roomId;
    currentRoomData = { isGroup, isPrivate };
    currentPage = 1;
    socket.emit('join_room', { room_id: roomId });
    document.querySelector(`li[data-room-id="${roomId}"]`)?.classList.add('active');
    
    // Обновляем заголовок и кнопки
    roomTitle.textContent = roomName;
    
    if (isGroup) {
      inviteBtn.style.display = 'block';
      membersBtn.style.display = 'block';
    } else {
      inviteBtn.style.display = 'none';
      membersBtn.style.display = isPrivate ? 'none' : 'none';
    }
    
    messages.innerHTML = '';
    loadMessageHistory(roomId);
    input.focus();
  }
  
  // Загрузка истории сообщений с пагинацией
  async function loadMessageHistory(roomId, page = 1) {
    if (isLoadingMessages) return;
    
    isLoadingMessages = true;
    try {
      const response = await fetch(`/api/messages/${roomId}?page=${page}&per_page=50`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const messageHistory = await response.json();
      
      if (Array.isArray(messageHistory)) {
        if (page === 1) {
          messages.innerHTML = '';
        }
        
        messageHistory.forEach(msg => {
          displayMessage(msg, page > 1);
        });
        
        if (page === 1) {
          scrollToBottom();
        }
      }
    } catch (error) {
      console.error('Ошибка загрузки истории:', error);
      showUserError('Не удалось загрузить историю сообщений');
    } finally {
      isLoadingMessages = false;
    }
  }
  
  // Прокрутка для загрузки старых сообщений
  messages.addEventListener('scroll', () => {
    if (messages.scrollTop === 0 && !isLoadingMessages && currentRoomId) {
      currentPage++;
      loadMessageHistory(currentRoomId, currentPage);
    }
  });
  
  // Отображение сообщения
  function displayMessage(data, prepend = false) {
    if (!data || !data.text) return;
    
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', data.is_own ? 'sent' : 'received');
    msgDiv.dataset.messageId = data.id || '';
    
    if (!data.is_own && data.user) {
      const userSpan = document.createElement('div');
      userSpan.classList.add('message-user');
      userSpan.textContent = data.user;
      msgDiv.appendChild(userSpan);
    }
    
    const textP = document.createElement('p');
    textP.classList.add('message-text');
    textP.textContent = data.text;
    msgDiv.appendChild(textP);
    
    if (data.timestamp) {
      const timeSpan = document.createElement('div');
      timeSpan.classList.add('message-time');
      timeSpan.textContent = data.timestamp;
      msgDiv.appendChild(timeSpan);
    }
    
    if (prepend) {
      messages.insertBefore(msgDiv, messages.firstChild);
    } else {
      messages.appendChild(msgDiv);
    }
  }
  
  // Отправка сообщения
  const sendMessage = () => {
    const text = input.value.trim();
    
    if (!text || !currentRoomId) {
      return;
    }
    
    if (text.length > 500) {
      showUserError('Сообщение слишком длинное (максимум 500 символов)');
      return;
    }
    
    if (!socket.connected) {
      showUserError('Нет подключения к серверу');
      return;
    }
    
    try {
      socket.emit('send_message', { 
        text: text, 
        room_id: currentRoomId 
      });
      
      input.value = '';
      updateCharCount();
      sendButton.disabled = true;
      
      socket.emit('typing', { room_id: currentRoomId, is_typing: false });
    } catch (error) {
      console.error('Error sending message:', error);
      showUserError('Ошибка отправки сообщения');
    }
  };

  sendButton.onclick = sendMessage;

  // Получение сообщения
  socket.on('receive_message', (data) => {
    if (!data || !data.text || !data.user) return;
    
    displayMessage(data);
    scrollToBottom();
    
    if (!data.is_own && typeof notificationSound === 'function' && typeof document.hidden !== 'undefined' && document.hidden) {
      try {
        notificationSound();
      } catch (e) {
        console.warn('Failed to play notification sound:', e);
      }
    }
    
    if (!data.is_own && typeof document.hidden !== 'undefined' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`${data.user}`, {
          body: data.text.substring(0, 100),
          icon: '/static/favicon.ico',
          tag: 'nebula-chat'
        });
      } catch (e) {
        console.warn('Failed to show notification:', e);
      }
    }
  });
  
  // Обработка ошибок
  socket.on('error', (data) => {
    console.error('Socket error:', data);
    if (data && data.message) {
      showUserError(data.message);
    }
  });
  
  // Уведомления о присоединении/выходе
  socket.on('user_joined', (data) => {
    showSystemMessage(`${data.user} присоединился к чату`);
  });
  
  socket.on('user_left', (data) => {
    showSystemMessage(`${data.user} покинул чат`);
  });
  
  socket.on('user_invited', (data) => {
    showSystemMessage(`${data.invited_by} пригласил ${data.user} в группу`);
    
    // Обновляем список комнат, если это текущая комната
    if (data.room_id === currentRoomId) {
      loadRoomMembers(currentRoomId);
    }
  });
  
  function showSystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'system-message';
    msgDiv.style.textAlign = 'center';
    msgDiv.style.opacity = '0.6';
    msgDiv.style.fontSize = '0.85rem';
    msgDiv.style.margin = '0.5rem 0';
    msgDiv.style.padding = '0.5rem';
    msgDiv.textContent = text;
    messages.appendChild(msgDiv);
    scrollToBottom();
    
    setTimeout(() => {
      if (msgDiv.parentNode) {
        msgDiv.style.transition = 'opacity 0.3s';
        msgDiv.style.opacity = '0';
        setTimeout(() => msgDiv.remove(), 300);
      }
    }, 10000);
  }
  
  function showUserError(text) {
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
    errorDiv.textContent = `⚠️ ${text}`;
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
      errorDiv.style.transition = 'opacity 0.3s';
      errorDiv.style.opacity = '0';
      setTimeout(() => errorDiv.remove(), 300);
    }, 5000);
  }
  
  // Индикатор печати
  socket.on('user_typing', (data) => {
    if (data.is_typing) {
      typingIndicator.textContent = `${data.user} печатает...`;
    } else {
      typingIndicator.textContent = '';
    }
  });
  
  // Отправка индикатора печати
  input.addEventListener('input', () => {
    updateCharCount();
    
    if (currentRoomId && socket.connected) {
      try {
        socket.emit('typing', { room_id: currentRoomId, is_typing: true });
        
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          socket.emit('typing', { room_id: currentRoomId, is_typing: false });
        }, 1000);
      } catch (error) {
        console.warn('Error sending typing indicator:', error);
      }
    }
  });
  
  // Счетчик символов
  function updateCharCount() {
    const length = input.value.length;
    charCount.textContent = `${length}/500`;
    charCount.style.color = length > 450 ? '#f44336' : '';
    sendButton.disabled = length === 0 || length > 500;
  }
  
  // Отправка с Enter
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // Прокрутка вниз
  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }
  
  // Запрос разрешения на уведомления
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  
  // === ФУНКЦИОНАЛ ПОИСКА И ГРУПП ===
  
  // Универсальная функция поиска пользователей
  function setupUserSearch(inputElement, resultsElement, onUserClick) {
    inputElement.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      
      clearTimeout(searchTimeout);
      
      if (query.length < 2) {
        resultsElement.innerHTML = '<div class="no-results">Введите минимум 2 символа</div>';
        return;
      }
      
      resultsElement.innerHTML = '<div class="loading">Поиск...</div>';
      
      searchTimeout = setTimeout(async () => {
        try {
          const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
          const users = await response.json();
          
          if (!response.ok) {
            throw new Error(users.error || 'Search failed');
          }
          
          if (users.length === 0) {
            resultsElement.innerHTML = '<div class="no-results">Пользователи не найдены</div>';
            return;
          }
          
          resultsElement.innerHTML = '';
          users.forEach(user => {
            const userDiv = document.createElement('div');
            userDiv.className = 'user-result';
            userDiv.innerHTML = `
              <span class="username">👤 ${escapeHtml(user.username)}</span>
              <span class="action">${onUserClick.actionText}</span>
            `;
            userDiv.addEventListener('click', () => onUserClick.handler(user));
            resultsElement.appendChild(userDiv);
          });
        } catch (error) {
          console.error('Search error:', error);
          resultsElement.innerHTML = '<div class="no-results">Ошибка поиска</div>';
          showUserError('Ошибка поиска пользователей');
        }
      }, 300);
    });
  }
  
  // Экранирование HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Поиск пользователей для личного чата
  searchUserBtn.addEventListener('click', () => {
    openModal(searchModal);
    document.getElementById('search-input').focus();
  });
  
  setupUserSearch(
    document.getElementById('search-input'),
    document.getElementById('search-results'),
    {
      actionText: 'Написать',
      handler: createPrivateChat
    }
  );
  
  async function createPrivateChat(user) {
    try {
      const response = await fetch(`/api/rooms/private/${user.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      }).catch(err => {
        throw new Error('Ошибка сети: ' + err.message);
      });
      
      if (!response) {
        throw new Error('Нет ответа от сервера');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create chat');
      }
      
      closeModal(searchModal);
      
      // Добавляем комнату в список, если её там нет
      if (!data.existed) {
        addRoomToList(data.room_id, data.room_name, false, true);
      }
      
      // Переключаемся на комнату
      switchRoom(data.room_id, data.room_name, false, true);
      
      if (!data.existed) {
        showSystemMessage('Личный чат создан');
      }
    } catch (error) {
      console.error('Error creating private chat:', error);
      showUserError('Ошибка создания чата: ' + error.message);
    }
  }
  
  // Создание группы
  createGroupBtn.addEventListener('click', () => {
    openModal(groupModal);
    document.getElementById('group-name-input').focus();
  });
  
  const groupNameInput = document.getElementById('group-name-input');
  const createGroupSubmit = document.getElementById('create-group-submit');
  
  createGroupSubmit.addEventListener('click', async () => {
    const groupName = groupNameInput.value.trim();
    
    if (groupName.length < 3) {
      showUserError('Название группы должно быть минимум 3 символа');
      return;
    }
    
    try {
      const response = await fetch('/api/rooms/group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: groupName })
      }).catch(err => {
        throw new Error('Ошибка сети: ' + err.message);
      });
      
      if (!response) {
        throw new Error('Нет ответа от сервера');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create group');
      }
      
      closeModal(groupModal);
      groupNameInput.value = '';
      
      // Добавляем группу в список
      addRoomToList(data.room_id, data.room_name, true, false);
      
      // Переключаемся на группу
      switchRoom(data.room_id, data.room_name, true, false);
      
      showSystemMessage('Группа создана');
    } catch (error) {
      console.error('Error creating group:', error);
      showUserError('Ошибка создания группы: ' + error.message);
    }
  });
  
  groupNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      createGroupSubmit.click();
    }
  });
  
  // Приглашение в группу
  inviteBtn.addEventListener('click', () => {
    openModal(inviteModal);
    document.getElementById('invite-search-input').focus();
  });
  
  setupUserSearch(
    document.getElementById('invite-search-input'),
    document.getElementById('invite-search-results'),
    {
      actionText: 'Пригласить',
      handler: inviteUserToGroup
    }
  );
  
  async function inviteUserToGroup(user) {
    try {
      const response = await fetch(`/api/rooms/${currentRoomId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ user_id: user.id })
      }).catch(err => {
        throw new Error('Ошибка сети: ' + err.message);
      });
      
      if (!response) {
        throw new Error('Нет ответа от сервера');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to invite user');
      }
      
      closeModal(inviteModal);
      document.getElementById('invite-search-input').value = '';
      document.getElementById('invite-search-results').innerHTML = '';
      
      showSystemMessage(`${user.username} приглашен в группу`);
    } catch (error) {
      console.error('Error inviting user:', error);
      showUserError('Ошибка приглашения: ' + error.message);
    }
  }
  
  // Просмотр участников
  membersBtn.addEventListener('click', async () => {
    openModal(membersModal);
    await loadRoomMembers(currentRoomId);
  });
  
  async function loadRoomMembers(roomId) {
    const membersList = document.getElementById('members-list');
    membersList.innerHTML = '<div class="loading">Загрузка...</div>';
    
    try {
      const response = await fetch(`/api/rooms/${roomId}/members`).catch(err => {
        throw new Error('Ошибка сети: ' + err.message);
      });
      
      if (!response) {
        throw new Error('Нет ответа от сервера');
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load members');
      }
      
      membersList.innerHTML = '';
      data.members.forEach(member => {
        const memberDiv = document.createElement('div');
        memberDiv.className = 'member-item';
        memberDiv.innerHTML = `
          <span class="username">👤 ${escapeHtml(member.username)}</span>
          ${member.is_creator ? '<span class="badge">Создатель</span>' : ''}
        `;
        membersList.appendChild(memberDiv);
      });
    } catch (error) {
      console.error('Error loading members:', error);
      membersList.innerHTML = '<div class="no-results">Ошибка загрузки участников</div>';
      showUserError('Ошибка загрузки участников');
    }
  }
  
  // Добавление комнаты в список
  function addRoomToList(roomId, roomName, isGroup, isPrivate) {
    const existingRoom = document.querySelector(`li[data-room-id="${roomId}"]`);
    if (existingRoom) return;
    
    const li = document.createElement('li');
    li.dataset.roomId = roomId;
    li.dataset.isGroup = isGroup;
    li.dataset.isPrivate = isPrivate;
    
    const icon = isPrivate ? '💬' : (isGroup ? '👥' : '#');
    li.textContent = `${icon} ${roomName}`;
    
    roomsList.insertBefore(li, roomsList.firstChild);
  }
  
  // Управление модальными окнами
  function openModal(modal) {
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    
    // Перемещаем фокус на первый input в модальном окне
    const firstInput = modal.querySelector('input');
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }
  
  function closeModal(modal) {
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
  }
  
  // Закрытие модальных окон по клику на крестик
  document.querySelectorAll('.modal .close').forEach(closeBtn => {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeModal(closeBtn.closest('.modal'));
    });
    
    // Добавляем поддержку Enter и Space для кнопки закрытия
    closeBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        closeModal(closeBtn.closest('.modal'));
      }
    });
  });
  
  // Закрытие модальных окон по клику вне контента
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal(modal);
      }
    });
  });
  
  // Закрытие модальных окон по Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.show').forEach(modal => {
        closeModal(modal);
      });
    }
  });
  
  // Синхронизация темы между вкладками
  window.addEventListener('storage', (e) => {
    if (e.key === 'theme' && e.newValue) {
      document.body.setAttribute('data-theme', e.newValue);
      const themeToggle = document.getElementById('theme-toggle');
      if (themeToggle) {
        const icon = e.newValue === 'light' ? '🌙' : '☀️';
        const iconElement = themeToggle.querySelector('.theme-icon');
        if (iconElement) {
          iconElement.textContent = icon;
        }
      }
    }
  });
  
  // Автоматическое присоединение к первой комнате
  const firstRoom = roomsList.querySelector('li[data-room-id]');
  if (firstRoom) {
    const roomId = parseInt(firstRoom.dataset.roomId);
    const isGroup = firstRoom.dataset.isGroup === 'true';
    const isPrivate = firstRoom.dataset.isPrivate === 'true';
    switchRoom(roomId, firstRoom.textContent.trim(), isGroup, isPrivate);
  }
  
  input.focus();
  updateCharCount();
});
