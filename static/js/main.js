document.addEventListener('DOMContentLoaded', () => {
  // Проверка наличия Socket.IO
  if (typeof io === 'undefined') {
    console.error('Socket.IO library not loaded');
    alert('Ошибка загрузки библиотеки Socket.IO. Пожалуйста, обновите страницу.');
    return;
  }
  
  // Получение текущего языка и переводов
  const currentLang = document.body.dataset.lang || 'ru';
  let translations = {};
  
  // Загрузка переводов
  async function loadTranslations() {
    try {
      const response = await fetch(`/api/translations/${currentLang}`);
      translations = await response.json();
    } catch (error) {
      console.error('Error loading translations:', error);
    }
  }
  
  // Вызываем загрузку переводов
  loadTranslations();
  
  // Функция для получения перевода
  function t(key) {
    return translations[key] || key;
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
  
  // Модальные окна (только для приглашения и участников)
  const inviteModal = document.getElementById('invite-modal');
  const membersModal = document.getElementById('members-modal');
  
  let currentRoomId = null;
  let currentRoomData = null;
  let typingTimeout = null;
  let notificationSound = null;
  let searchTimeout = null;
  let currentPage = 1;
  let isLoadingMessages = false;
  let replyToMessage = null;
  let onlineUsers = new Set();
  
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
    
    // Показываем окно чата
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) {
      chatContainer.style.display = 'flex';
    }
    
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
    
    // Аватар и имя пользователя
    if (!data.is_own && data.user) {
      const userSpan = document.createElement('div');
      userSpan.classList.add('message-user');
      userSpan.textContent = `${data.user_avatar || '👤'} ${data.user}`;
      msgDiv.appendChild(userSpan);
    }
    
    // Ответ на сообщение
    if (data.reply_to) {
      const replyDiv = document.createElement('div');
      replyDiv.classList.add('message-reply');
      replyDiv.innerHTML = `
        <div class="reply-indicator">↩️</div>
        <div class="reply-content">
          <div class="reply-user">${escapeHtml(data.reply_to.user)}</div>
          <div class="reply-text">${escapeHtml(data.reply_to.text)}</div>
        </div>
      `;
      replyDiv.addEventListener('click', () => {
        const originalMsg = document.querySelector(`[data-message-id="${data.reply_to.id}"]`);
        if (originalMsg) {
          originalMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
          originalMsg.classList.add('highlight');
          setTimeout(() => originalMsg.classList.remove('highlight'), 2000);
        }
      });
      msgDiv.appendChild(replyDiv);
    }
    
    // Обработка упоминаний
    let textContent = data.text;
    const mentionRegex = /@(\w+)/g;
    textContent = textContent.replace(mentionRegex, '<span class="mention">@$1</span>');
    
    const textP = document.createElement('p');
    textP.classList.add('message-text');
    textP.innerHTML = textContent;
    msgDiv.appendChild(textP);
    
    // Реакции
    const reactionsDiv = document.createElement('div');
    reactionsDiv.classList.add('message-reactions');
    reactionsDiv.dataset.messageId = data.id;
    updateReactions(reactionsDiv, data.reactions || {});
    msgDiv.appendChild(reactionsDiv);
    
    // Время и действия
    const footerDiv = document.createElement('div');
    footerDiv.classList.add('message-footer');
    
    if (data.timestamp) {
      const timeSpan = document.createElement('span');
      timeSpan.classList.add('message-time');
      timeSpan.textContent = data.timestamp;
      footerDiv.appendChild(timeSpan);
    }
    
    // Кнопки действий
    const actionsDiv = document.createElement('div');
    actionsDiv.classList.add('message-actions');
    
    const replyBtn = document.createElement('button');
    replyBtn.classList.add('action-btn');
    replyBtn.innerHTML = '↩️';
    replyBtn.title = 'Ответить';
    replyBtn.addEventListener('click', () => setReplyTo(data));
    actionsDiv.appendChild(replyBtn);
    
    const reactBtn = document.createElement('button');
    reactBtn.classList.add('action-btn');
    reactBtn.innerHTML = '👍';
    reactBtn.title = 'Реакция';
    reactBtn.addEventListener('click', (e) => showReactionPicker(e, data.id));
    actionsDiv.appendChild(reactBtn);
    
    footerDiv.appendChild(actionsDiv);
    msgDiv.appendChild(footerDiv);
    
    if (prepend) {
      messages.insertBefore(msgDiv, messages.firstChild);
    } else {
      messages.appendChild(msgDiv);
    }
  }
  
  // Обновление реакций
  function updateReactions(container, reactions) {
    container.innerHTML = '';
    for (const [emoji, users] of Object.entries(reactions)) {
      if (users.length > 0) {
        const reactionBtn = document.createElement('button');
        reactionBtn.classList.add('reaction-item');
        reactionBtn.innerHTML = `${emoji} ${users.length}`;
        reactionBtn.title = users.join(', ');
        reactionBtn.addEventListener('click', () => {
          const messageId = container.dataset.messageId;
          reactToMessage(messageId, emoji);
        });
        container.appendChild(reactionBtn);
      }
    }
  }
  
  // Установка ответа на сообщение
  function setReplyTo(messageData) {
    replyToMessage = messageData;
    
    // Показываем индикатор ответа
    let replyIndicator = document.getElementById('reply-indicator');
    if (!replyIndicator) {
      replyIndicator = document.createElement('div');
      replyIndicator.id = 'reply-indicator';
      replyIndicator.classList.add('reply-indicator-bar');
      document.getElementById('input-area').insertBefore(replyIndicator, input);
    }
    
    replyIndicator.innerHTML = `
      <div class="reply-info">
        <span class="reply-label">↩️ Ответ на:</span>
        <span class="reply-preview">${escapeHtml(messageData.user)}: ${escapeHtml(messageData.text.substring(0, 50))}</span>
      </div>
      <button class="cancel-reply" onclick="cancelReply()">✕</button>
    `;
    replyIndicator.style.display = 'flex';
    input.focus();
  }
  
  // Отмена ответа
  window.cancelReply = function() {
    replyToMessage = null;
    const replyIndicator = document.getElementById('reply-indicator');
    if (replyIndicator) {
      replyIndicator.style.display = 'none';
    }
  };
  
  // Показать выбор реакций
  function showReactionPicker(event, messageId) {
    event.stopPropagation();
    
    // Удаляем предыдущий пикер
    const existingPicker = document.querySelector('.reaction-picker');
    if (existingPicker) existingPicker.remove();
    
    const picker = document.createElement('div');
    picker.classList.add('reaction-picker');
    
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];
    emojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        reactToMessage(messageId, emoji);
        picker.remove();
      });
      picker.appendChild(btn);
    });
    
    document.body.appendChild(picker);
    
    const rect = event.target.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.top - picker.offsetHeight - 5}px`;
    picker.style.left = `${rect.left}px`;
    
    // Закрытие при клике вне пикера
    setTimeout(() => {
      document.addEventListener('click', function closePicker() {
        picker.remove();
        document.removeEventListener('click', closePicker);
      });
    }, 0);
  }
  
  // Отправка реакции
  async function reactToMessage(messageId, emoji) {
    try {
      const response = await fetch(`/api/messages/${messageId}/react`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ emoji })
      });
      
      if (!response.ok) {
        throw new Error('Failed to react');
      }
    } catch (error) {
      console.error('Error reacting:', error);
      showUserError('Ошибка добавления реакции');
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
      const messageData = { 
        text: text, 
        room_id: currentRoomId 
      };
      
      // Добавляем reply_to_id если отвечаем на сообщение
      if (replyToMessage) {
        messageData.reply_to_id = replyToMessage.id;
      }
      
      socket.emit('send_message', messageData);
      
      input.value = '';
      updateCharCount();
      sendButton.disabled = true;
      
      // Отменяем ответ
      if (replyToMessage) {
        cancelReply();
      }
      
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
  
  // Обновление реакций
  socket.on('message_reaction', (data) => {
    const reactionsContainer = document.querySelector(`[data-message-id="${data.message_id}"] .message-reactions`);
    if (reactionsContainer) {
      updateReactions(reactionsContainer, data.reactions);
    }
  });
  
  // Обновление статуса пользователей
  socket.on('user_status', (data) => {
    if (data.is_online) {
      onlineUsers.add(data.username);
    } else {
      onlineUsers.delete(data.username);
    }
    
    // Обновляем индикаторы онлайн статуса
    updateOnlineIndicators();
  });
  
  // Обновление индикаторов онлайн
  function updateOnlineIndicators() {
    document.querySelectorAll('.message-user').forEach(userEl => {
      const username = userEl.textContent.split(' ').slice(1).join(' ');
      if (onlineUsers.has(username)) {
        userEl.classList.add('online');
      } else {
        userEl.classList.remove('online');
      }
    });
  }
  
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
  
  // === ФУНКЦИОНАЛ ПРИГЛАШЕНИЯ И УЧАСТНИКОВ ===
  
  // Универсальная функция поиска пользователей
  function setupUserSearch(inputElement, resultsElement, onUserClick) {
    if (!inputElement || !resultsElement) {
      console.error('setupUserSearch: inputElement or resultsElement is null');
      return;
    }
    
    inputElement.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      
      clearTimeout(searchTimeout);
      
      if (query.length === 0) {
        resultsElement.innerHTML = '';
        return;
      }
      
      if (query.length < 2) {
        resultsElement.innerHTML = `<div class="no-results">${t('min_chars') || 'Введите минимум 2 символа'}</div>`;
        return;
      }
      
      resultsElement.innerHTML = `<div class="loading">${t('loading') || 'Загрузка...'}</div>`;
      
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
            resultsElement.innerHTML = `<div class="no-results">${t('no_results') || 'Пользователи не найдены'}</div>`;
            return;
          }
          
          resultsElement.innerHTML = '';
          users.forEach(user => {
            if (!user || !user.id || !user.username) {
              console.warn('Invalid user data:', user);
              return;
            }
            
            const userDiv = document.createElement('div');
            userDiv.className = 'user-result';
            userDiv.innerHTML = `
              <span class="username">👤 ${escapeHtml(user.username)}</span>
              <span class="action">${onUserClick.actionText || 'Выбрать'}</span>
            `;
            userDiv.addEventListener('click', () => {
              if (onUserClick && onUserClick.handler) {
                onUserClick.handler(user);
              }
            });
            resultsElement.appendChild(userDiv);
          });
        } catch (error) {
          console.error('Search error:', error);
          resultsElement.innerHTML = `<div class="no-results">${t('error') || 'Ошибка'}</div>`;
          showUserError(t('error_occurred') || 'Произошла ошибка при поиске');
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
  
  // Приглашение в группу
  if (inviteBtn && inviteModal) {
    const inviteSearchInput = document.getElementById('invite-search-input');
    const inviteSearchResults = document.getElementById('invite-search-results');
    
    if (inviteSearchInput && inviteSearchResults) {
      inviteBtn.addEventListener('click', () => {
        // Очищаем поле ввода и результаты при открытии
        inviteSearchInput.value = '';
        inviteSearchResults.innerHTML = '';
        openModal(inviteModal);
        setTimeout(() => inviteSearchInput.focus(), 150);
      });
      
      setupUserSearch(
        inviteSearchInput,
        inviteSearchResults,
        {
          get actionText() { return t('invite'); },
          handler: inviteUserToGroup
        }
      );
    }
  }
  
  async function inviteUserToGroup(user) {
    if (!user || !user.id) {
      showUserError(t('error_occurred') || 'Неверные данные пользователя');
      return;
    }
    
    if (!currentRoomId) {
      showUserError(t('error_occurred') || 'Комната не выбрана');
      return;
    }
    
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
      
      // Очищаем поле поиска
      const inviteSearchInput = document.getElementById('invite-search-input');
      const inviteSearchResults = document.getElementById('invite-search-results');
      if (inviteSearchInput) inviteSearchInput.value = '';
      if (inviteSearchResults) inviteSearchResults.innerHTML = '';
      
      showSystemMessage(`${user.username} ${t('invite') || 'приглашен в группу'}`);
    } catch (error) {
      console.error('Error inviting user:', error);
      showUserError(t('error_occurred') || 'Ошибка приглашения: ' + error.message);
    }
  }
  
  // Просмотр участников
  if (membersBtn && membersModal) {
    membersBtn.addEventListener('click', async () => {
      if (!currentRoomId) {
        showUserError(t('error_occurred') || 'Комната не выбрана');
        return;
      }
      openModal(membersModal);
      await loadRoomMembers(currentRoomId);
    });
  }
  
  async function loadRoomMembers(roomId) {
    const membersList = document.getElementById('members-list');
    if (!membersList) {
      console.error('loadRoomMembers: members-list element not found');
      return;
    }
    
    if (!roomId) {
      membersList.innerHTML = `<div class="no-results">${t('error') || 'Ошибка'}</div>`;
      return;
    }
    
    membersList.innerHTML = `<div class="loading">${t('loading') || 'Загрузка...'}</div>`;
    
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
      
      if (!data.members || !Array.isArray(data.members)) {
        throw new Error('Invalid response format');
      }
      
      membersList.innerHTML = '';
      
      if (data.members.length === 0) {
        membersList.innerHTML = `<div class="no-results">${t('no_results') || 'Участники не найдены'}</div>`;
        return;
      }
      
      data.members.forEach(member => {
        if (!member || !member.username) {
          console.warn('Invalid member data:', member);
          return;
        }
        
        const memberDiv = document.createElement('div');
        memberDiv.className = 'member-item';
        memberDiv.innerHTML = `
          <span class="username">${escapeHtml(member.avatar || '👤')} ${escapeHtml(member.username)}</span>
          ${member.is_creator ? `<span class="badge">${t('creator') || 'Создатель'}</span>` : ''}
        `;
        membersList.appendChild(memberDiv);
      });
    } catch (error) {
      console.error('Error loading members:', error);
      membersList.innerHTML = `<div class="no-results">${t('error') || 'Ошибка'}</div>`;
      showUserError(t('error_occurred') || 'Произошла ошибка при загрузке участников');
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
  let modalOpening = false;
  
  function openModal(modal) {
    if (!modal) {
      console.error('openModal: modal is null');
      return;
    }
    
    modalOpening = true;
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    
    // Предотвращаем прокрутку body при открытом модальном окне
    document.body.style.overflow = 'hidden';
    
    // Перемещаем фокус на первый input в модальном окне
    const firstInput = modal.querySelector('input');
    if (firstInput) {
      setTimeout(() => {
        firstInput.focus();
        modalOpening = false;
      }, 150);
    } else {
      setTimeout(() => {
        modalOpening = false;
      }, 150);
    }
  }
  
  function closeModal(modal) {
    if (!modal) {
      console.error('closeModal: modal is null');
      return;
    }
    
    if (modalOpening) return; // Предотвращаем закрытие во время открытия
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    
    // Восстанавливаем прокрутку body
    document.body.style.overflow = '';
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
      if (e.target === modal && !modalOpening) {
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
  
  // Скрываем окно чата до выбора комнаты
  const chatContainer = document.getElementById('chat-container');
  if (chatContainer) {
    chatContainer.style.display = 'none';
  }
  
  // Автоматическое переключение на комнату при возврате с других страниц
  if (typeof window.selectedRoomId !== 'undefined' && window.selectedRoomId) {
    const roomElement = document.querySelector(`li[data-room-id="${window.selectedRoomId}"]`);
    if (roomElement) {
      const roomId = parseInt(roomElement.dataset.roomId);
      const isGroup = roomElement.dataset.isGroup === 'true';
      const isPrivate = roomElement.dataset.isPrivate === 'true';
      const roomName = roomElement.textContent.trim();
      
      // Небольшая задержка для корректной инициализации
      setTimeout(() => {
        switchRoom(roomId, roomName, isGroup, isPrivate);
      }, 100);
    }
  }
  
  updateCharCount();
});
