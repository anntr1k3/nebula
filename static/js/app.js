import * as api from './api.js'
import {
  getToken,
  getUsername,
  isAuthenticated,
  isModerator,
  markServerRoleConfirmed,
  setAuth,
  clearAuth,
} from './auth.js'
import { t, setLocale, getLocale, applyI18nToDom, translateApiMessage } from './i18n.js'
import { disconnectSocket } from './socket.js'
import { readStoredTheme, normalizeTheme, isLightTheme, THEME_META_COLOR } from './themes.js'
import { bindLowVisionControls } from './accessibility.js'
import { els, state, collectEls, showToast } from './app-shell.js'
import { openSmoothModal, closeSmoothModal } from './modal-smooth.js'
import { hideSidebarDropdown } from './sidebar-dropdown.js'
import {
  initMediaViewer,
  closeMediaViewer,
  isMediaViewerOpen,
  applyMediaViewerI18n,
} from './media-viewer.js'
import { $ } from './dom.js'
import { refreshBlockedSet, refreshInbox, clearInboxUi } from './inbox.js'
import { ensureAdminStyles } from './lazy-css.js'
import {
  openChat,
  closeCurrentChat,
  syncMobileMessengerLayout,
  syncTtlSelectLabels,
  updateSendButtonState,
  autosizeTextarea,
  handleComposerInput,
  sendMessage,
  updateReplyPreview,
  clearPendingMedia,
  onInputTyping,
  scheduleDraftSave,
  closeContextMenus,
  closeComposerPopovers,
  openCreateRoomModal,
  closeCreateRoomModal,
  closePinnedListModal,
  closeScheduledListModal,
  submitCreateRoom,
  refreshMessengerHeader,
  bootstrapMessenger,
  bindUserDirectoryUi,
  hidePrivateUserSuggest,
  resetMessengerAfterLogout,
} from './chat.js'
import {
  loadSettingsProfile,
  saveSettingsProfile,
  refreshBlockedList,
  refreshSidebarProfileLabel,
  bindProfileAvatarUi,
} from './settings.js'
import { bindSearchInputListeners } from './search.js'
import { fillElementWithAppleEmoji, syncComposerEmptyAttr } from './emoji-apple.js'
import { bindE2eeUi } from './e2ee.js'

function normalizePath() {
  let p = window.location.pathname.replace(/\/+$/, '') || '/'
  if (p === '') p = '/'
  return p
}

function routeFromPath() {
  const p = normalizePath()
  if (p === '/login') return 'login'
  if (p === '/admin') return 'admin'
  return 'messenger'
}

function navigatePath(path, replace = false) {
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  void applyRoute()
}

async function applyRoute() {
  let route = routeFromPath()

  if (!isAuthenticated()) {
    if (route !== 'login') {
      history.replaceState(null, '', '/login')
      route = 'login'
    }
  } else {
    if (route === 'login') {
      history.replaceState(null, '', '/')
      route = 'messenger'
    }
    if (route === 'admin' && !isModerator()) {
      history.replaceState(null, '', '/')
      route = 'messenger'
    }
  }

  els.viewAuth.hidden = route !== 'login'
  els.viewMessenger.hidden = route !== 'messenger'
  els.viewAdmin.hidden = route !== 'admin'

  if (route !== 'login') closeAuthQuickPopovers()
  else syncAuthQuickControls()

  if (route === 'messenger') {
    if (!state.messengerBootstrapped) {
      await bootstrapMessenger(applyThemeToBody, applyLocaleToSettings)
    } else {
      refreshMessengerHeader()
    }
  } else {
    disconnectSocket()
    state.messengerBootstrapped = false
    if (state.usersPollTimer) {
      clearInterval(state.usersPollTimer)
      state.usersPollTimer = null
    }
  }

  if (route === 'login') {
    setAuthFormsVisibility()
  }
  if (route === 'admin') {
    try {
      await ensureAdminStyles()
    } catch {
      showToast(t('adminLoadFailed'), 'error')
    }
    els.adminUsername.textContent = getUsername() || ''
    void loadAdminPanel()
  }
}

async function loadAdminPanel() {
  if (!els.adminReportsList || !isModerator()) return
  const token = getToken()
  try {
    const sort = els.adminReportSort?.value || 'date'
    const data = await api.getReportsDashboard(token, { sort, dir: 'desc', status: 'pending' })
    if (data && data.success === false) {
      showToast(translateApiMessage(data.message) || t('requestFailed'), 'error')
      return
    }
    const grouped = data.grouped || []
    els.adminReportsList.innerHTML = ''
    if (!grouped.length) {
      const empty = document.createElement('div')
      empty.className = 'admin-empty'
      empty.textContent = t('adminNoReports')
      els.adminReportsList.appendChild(empty)
    }
    grouped.forEach((g) => {
      const h = document.createElement('h3')
      h.className = 'admin-group-title'
      h.textContent = g.room_title || g.room_id
      els.adminReportsList.appendChild(h)
      ;(g.reports || []).forEach((rep) => {
        const card = document.createElement('div')
        card.className = 'admin-report-card'
        const meta = document.createElement('p')
        const strong = document.createElement('strong')
        strong.textContent = `#${rep.id}`
        meta.appendChild(strong)
        meta.appendChild(document.createTextNode(` · ${rep.reported_user} · ${rep.report_type || ''}`))
        card.appendChild(meta)
        const msgP = document.createElement('p')
        msgP.className = 'admin-report-msg'
        fillElementWithAppleEmoji(msgP, (rep.message_text || '').slice(0, 280))
        card.appendChild(msgP)
        const actions = document.createElement('div')
        actions.className = 'admin-report-actions'
        const mk = (label, action) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'glass-button-secondary'
          b.textContent = label
          b.addEventListener('click', async () => {
            const r = await api.moderationReportAction({ report_id: rep.id, action }, token)
            if (r.success) void loadAdminPanel()
            else showToast(translateApiMessage(r.message) || t('requestFailed'), 'error')
          })
          actions.appendChild(b)
        }
        mk(t('reportDismiss'), 'dismiss')
        mk(t('reportWarn'), 'warn')
        mk(t('reportBan1d'), 'ban_1d')
        mk(t('reportBanPerm'), 'ban_perm')
        const view = document.createElement('button')
        view.type = 'button'
        view.className = 'glass-button-small'
        view.textContent = t('reportViewMsg')
        view.addEventListener('click', async () => {
          const ctx = await api.moderationMessageContext(rep.message_id, token)
          if (ctx.success && ctx.message) {
            const text = [ctx.message.room_title, ctx.message.text || ''].filter(Boolean).join(': ')
            showToast(text || t('reportViewMsg'), 'info')
          } else if (ctx && ctx.success === false) {
            showToast(translateApiMessage(ctx.message) || t('requestFailed'), 'error')
          }
        })
        actions.appendChild(view)
        card.appendChild(actions)
        els.adminReportsList.appendChild(card)
      })
    })
    const logs = await api.getModerationLogs(token, 80)
    if (els.adminLogsList) {
      if (logs && logs.success === false) {
        showToast(translateApiMessage(logs.message) || t('requestFailed'), 'error')
      } else if (logs.logs) {
        els.adminLogsList.innerHTML = ''
        if (!logs.logs.length) {
          const empty = document.createElement('div')
          empty.className = 'admin-empty'
          empty.textContent = t('adminNoLogs')
          els.adminLogsList.appendChild(empty)
        }
        logs.logs.forEach((log) => {
          const p = document.createElement('div')
          p.className = 'admin-log-row'
          p.textContent = `${log.created_at} · ${log.moderator_username} · ${log.action_type} · ${log.target_username || ''}`
          els.adminLogsList.appendChild(p)
        })
      }
    }
  } catch {
    showToast(t('adminLoadFailed'), 'error')
  }
}

const PASSWORD_RULE_LETTER_RE = /\p{L}/u

function updateRegisterPasswordRuleState() {
  const list = document.querySelector('#register-password-rules .auth-password-rules-list')
  if (!list) return
  const password = $('#reg-pass')?.value ?? ''
  const len = password.length
  for (const li of list.querySelectorAll('[data-password-rule]')) {
    const rule = li.dataset.passwordRule
    let met = false
    if (rule === 'min-len') met = len >= 8
    else if (rule === 'max-len') met = len <= 128
    else if (rule === 'letter') met = PASSWORD_RULE_LETTER_RE.test(password)
    else if (rule === 'digit') met = /\d/.test(password)
    li.classList.toggle('is-met', met)
  }
}

function setAuthFormsVisibility() {
  if (state.authMode === 'login') {
    els.authLogin.classList.add('active')
    els.authRegister.classList.remove('active')
  } else {
    els.authLogin.classList.remove('active')
    els.authRegister.classList.add('active')
    updateRegisterPasswordRuleState()
  }
}

function applyThemeToBody() {
  state.theme = normalizeTheme(state.theme)
  document.body.dataset.theme = state.theme
  document.body.className = isLightTheme(state.theme) ? 'light-theme' : 'dark-theme'
  const meta = document.getElementById('meta-theme-color')
  if (meta) meta.setAttribute('content', THEME_META_COLOR[state.theme] || '#0c1220')
  document.querySelectorAll('.theme-option').forEach((btn) => {
    const on = btn.dataset.theme === state.theme
    btn.classList.toggle('active', on)
    btn.classList.toggle('is-active', on)
  })
  syncAuthQuickControls()
}

function applyLocaleToSettings() {
  const loc = getLocale()
  document.querySelectorAll('.language-option').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.locale === loc)
    btn.classList.toggle('is-active', btn.dataset.locale === loc)
  })
}

function closeAuthQuickPopovers() {
  const themePop = document.getElementById('auth-theme-popover')
  const btnTheme = document.getElementById('auth-btn-theme')
  if (themePop) themePop.hidden = true
  btnTheme?.setAttribute('aria-expanded', 'false')
}

function syncAuthQuickControls() {
  const loc = getLocale()
  const display = document.getElementById('auth-locale-display')
  if (display) display.textContent = loc === 'en' ? 'EN' : 'RU'
  const icon = document.getElementById('auth-theme-icon')
  if (icon) {
    icon.className = isLightTheme(state.theme) ? 'fa-solid fa-sun' : 'fa-solid fa-moon'
  }
  document.querySelectorAll('#auth-theme-popover .theme-option').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.theme === state.theme)
  })
}

function toggleAuthThemePopover() {
  const themePop = document.getElementById('auth-theme-popover')
  const btnTheme = document.getElementById('auth-btn-theme')
  if (!themePop) return
  const themeWasOpen = !themePop.hidden
  closeAuthQuickPopovers()
  if (!themeWasOpen) {
    themePop.hidden = false
    btnTheme?.setAttribute('aria-expanded', 'true')
    syncAuthQuickControls()
  }
}

function bindAuthQuickControls() {
  const btnLocale = document.getElementById('auth-btn-locale')
  const btnTheme = document.getElementById('auth-btn-theme')
  if (!btnLocale || !btnTheme || btnLocale.dataset.authQuickBound === '1') return
  btnLocale.dataset.authQuickBound = '1'
  btnTheme.dataset.authQuickBound = '1'
  btnLocale.addEventListener('click', (e) => {
    e.stopPropagation()
    closeAuthQuickPopovers()
    setLocale(getLocale() === 'en' ? 'ru' : 'en')
  })
  btnTheme.addEventListener('click', (e) => {
    e.stopPropagation()
    toggleAuthThemePopover()
  })
}

function openProfileEditModal() {
  openSmoothModal(els.modalProfileEdit)
  void loadSettingsProfile()
}

function closeProfileEditModal() {
  closeSmoothModal(els.modalProfileEdit)
}

function openAppSettingsModal() {
  applyThemeToBody()
  applyLocaleToSettings()
  openSmoothModal(els.modalAppSettings)
  void refreshBlockedList()
}

function closeAppSettingsModal() {
  closeSmoothModal(els.modalAppSettings)
}

/** Обновить роль из БД (устраняет устаревшее значение роли до ответа сервера). */
async function refreshSessionRole() {
  const token = getToken()
  const username = getUsername()
  if (!token || !username) return
  try {
    const me = await api.getMe(token)
    if (me.success) {
      setAuth({
        token,
        username: me.username || username,
        role: me.role,
      })
      markServerRoleConfirmed()
    }
  } catch {
    /* офлайн / ошибка — оставляем кэш */
  }
}

async function doLogin() {
  const username = $('#login-user').value.trim()
  const password = $('#login-pass').value
  if (!username || !password) {
    showToast(t('fillAllFields'), 'error')
    return
  }
  try {
    const data = await api.login(username, password)
    if (data.success) {
      let role = data.role ?? 'user'
      try {
        const me = await api.getMe(data.token)
        if (me.success && me.role != null) role = me.role
      } catch {
        /* оставляем role из ответа login */
      }
      setAuth({
        token: data.token,
        username: data.username,
        role,
      })
      markServerRoleConfirmed()
      navigatePath('/', true)
    } else {
      showToast(translateApiMessage(data.message) || t('loginError'), 'error')
    }
  } catch {
    showToast(t('loginError'), 'error')
  }
}

async function doRegister() {
  const username = $('#reg-user').value.trim()
  const password = $('#reg-pass').value
  if (!username || !password) {
    showToast(t('fillAllFields'), 'error')
    return
  }
  try {
    const data = await api.register(username, password)
    if (data.success) {
      showToast(t('registrationSuccess'), 'success')
      state.authMode = 'login'
      setAuthFormsVisibility()
    } else {
      showToast(translateApiMessage(data.message) || t('registrationError'), 'error')
    }
  } catch {
    showToast(t('registrationError'), 'error')
  }
}

function bindEvents() {
  initMediaViewer(els)
  bindProfileAvatarUi()

  window.addEventListener('nebula-auth-lost', () => {
    resetMessengerAfterLogout()
    clearInboxUi()
    disconnectSocket()
    state.privateChatsMeta = []
    clearAuth()
    state.messengerBootstrapped = false
    if (state.usersPollTimer) {
      clearInterval(state.usersPollTimer)
      state.usersPollTimer = null
    }
    navigatePath('/login', true)
  })

  $('#link-to-register').addEventListener('click', () => {
    state.authMode = 'register'
    setAuthFormsVisibility()
  })
  $('#link-to-login').addEventListener('click', () => {
    state.authMode = 'login'
    setAuthFormsVisibility()
  })
  $('#btn-login').addEventListener('click', doLogin)
  $('#login-pass').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') doLogin()
  })
  $('#btn-register').addEventListener('click', doRegister)
  const regPassEl = $('#reg-pass')
  regPassEl.addEventListener('input', updateRegisterPasswordRuleState)
  regPassEl.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') doRegister()
  })

  $('#btn-logout').addEventListener('click', () => {
    resetMessengerAfterLogout()
    clearInboxUi()
    disconnectSocket()
    state.privateChatsMeta = []
    clearAuth()
    state.messengerBootstrapped = false
    if (state.usersPollTimer) {
      clearInterval(state.usersPollTimer)
      state.usersPollTimer = null
    }
    navigatePath('/login', true)
  })

  $('#btn-admin').addEventListener('click', () => {
    if (!isModerator()) return
    void ensureAdminStyles()
    navigatePath('/admin')
  })
  $('#btn-admin')?.addEventListener('mouseenter', () => {
    if (isModerator()) void ensureAdminStyles()
  })
  $('#btn-back-messenger').addEventListener('click', () => navigatePath('/'))
  if (els.adminReportsRefresh) els.adminReportsRefresh.addEventListener('click', () => void loadAdminPanel())
  if (els.adminReportSort) els.adminReportSort.addEventListener('change', () => void loadAdminPanel())

  const sidebarProfile = $('#sidebar-user-profile')
  sidebarProfile.addEventListener('click', () => openProfileEditModal())
  sidebarProfile.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openProfileEditModal()
    }
  })

  els.btnAppSettings.addEventListener('click', () => openAppSettingsModal())

  $('#btn-profile-modal-cancel').addEventListener('click', () => closeProfileEditModal())
  $('#btn-app-settings-done').addEventListener('click', () => closeAppSettingsModal())

  els.modalProfileEdit.addEventListener('click', (e) => {
    if (e.target === els.modalProfileEdit) closeProfileEditModal()
  })
  els.modalAppSettings.addEventListener('click', (e) => {
    if (e.target === els.modalAppSettings) closeAppSettingsModal()
  })

  document.querySelectorAll('.language-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      setLocale(btn.dataset.locale)
    })
  })

  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.theme = normalizeTheme(btn.dataset.theme)
      localStorage.setItem('theme', state.theme)
      applyThemeToBody()
      syncAuthQuickControls()
      if (btn.closest('#auth-theme-popover')) closeAuthQuickPopovers()
    })
  })

  bindAuthQuickControls()
  bindLowVisionControls()

  $('#btn-save-profile').addEventListener('click', async () => {
    const ok = await saveSettingsProfile()
    if (ok) closeProfileEditModal()
  })
  $('#btn-block-user').addEventListener('click', async () => {
    const u = els.blockUsernameInput.value.trim()
    if (!u || u === getUsername()) return
    const r = await api.blockUser(getUsername(), u, getToken())
    if (r.success) {
      els.blockUsernameInput.value = ''
      refreshBlockedSet().then(() => {
        refreshBlockedList()
        refreshInbox()
      })
    } else showToast(translateApiMessage(r.message) || t('genericError'), 'error')
  })

  $('#btn-open-create-room').addEventListener('click', openCreateRoomModal)
  $('#btn-create-room-cancel').addEventListener('click', closeCreateRoomModal)
  $('#btn-create-room-submit').addEventListener('click', submitCreateRoom)
  els.modalCreate.addEventListener('click', (e) => {
    if (e.target === els.modalCreate) closeCreateRoomModal()
  })

  els.inboxList.addEventListener('click', (e) => {
    const item = e.target.closest('.inbox-row')
    if (!item || !item.dataset.roomId) return
    openChat(item.dataset.roomId, item.dataset.chatType || 'private')
  })

  $('#btn-send').addEventListener('click', sendMessage)
  els.messageInput.addEventListener('input', handleComposerInput)
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  $('#btn-cancel-reply').addEventListener('click', () => {
    state.replyTo = null
    updateReplyPreview()
  })

  els.btnClearPendingMedia?.addEventListener('click', () => {
    clearPendingMedia()
  })

  els.btnAttach.addEventListener('click', () => els.fileInput.click())
  els.fileInput.addEventListener('change', async () => {
    const f = els.fileInput.files?.[0]
    els.fileInput.value = ''
    if (!f) return
    const token = getToken()
    let mediaType = 'file'
    if (f.type.startsWith('image/')) mediaType = 'image'
    else if (f.type.startsWith('video/')) mediaType = 'video'
    else if (f.type.startsWith('audio/')) mediaType = 'audio'
    const up = await api.uploadMedia(f, mediaType, token)
    if (up.success && up.path) {
      state.pendingMedia = { type: up.type || mediaType, data: up.path, name: up.name || f.name }
      updateSendButtonState()
    } else {
      showToast(translateApiMessage(up.message) || t('uploadFailed'), 'error')
    }
  })

  bindSearchInputListeners()
  bindE2eeUi()

  els.emojiPickerBackdrop?.addEventListener('click', (e) => {
    e.stopPropagation()
    closeContextMenus()
  })

  /* Закрытие полоски реакций: capture, чтобы клик доходил даже при перекрытии слоями / stopPropagation внизу */
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const emojiBarOpen = !els.emojiBar.hidden
      const expandedOpen = els.emojiPickerExpanded && !els.emojiPickerExpanded.hidden
      if (!emojiBarOpen && !expandedOpen) return
      const t = e.target
      if (els.emojiBar?.contains(t)) return
      if (els.emojiPickerExpanded?.contains(t)) return
      closeContextMenus()
    },
    true,
  )

  document.addEventListener('click', (e) => {
    if (!els.viewAuth.hidden) {
      const inAuthQuick =
        e.target.closest('#auth-quick-bar') || e.target.closest('#auth-theme-popover')
      if (!inAuthQuick) closeAuthQuickPopovers()
    }
    if (!els.searchResults.contains(e.target) && e.target !== els.globalSearch) {
      hideSidebarDropdown(els.searchResults, { clear: true })
    }
    if (!els.ctxMenu.hidden && !els.ctxMenu.contains(e.target)) {
      closeContextMenus()
    }
    const emojiBarOpen = !els.emojiBar.hidden
    const expandedOpen = els.emojiPickerExpanded && !els.emojiPickerExpanded.hidden
    const inEmojiUi =
      (emojiBarOpen && els.emojiBar.contains(e.target)) ||
      (expandedOpen && els.emojiPickerExpanded.contains(e.target))
    if ((emojiBarOpen || expandedOpen) && !inEmojiUi) {
      closeContextMenus()
    }
    const ttlOpen = els.ttlPopover && !els.ttlPopover.hidden
    const schedOpen = els.schedulePopover && !els.schedulePopover.hidden
    const aiOpen = els.aiPopover && !els.aiPopover.hidden
    if (ttlOpen || schedOpen || aiOpen) {
      const inTtlZone =
        !ttlOpen ||
        els.composerTtlWrap?.contains(e.target) ||
        els.ttlPopover?.contains(e.target)
      const inSchedZone =
        !schedOpen ||
        els.btnScheduleSend?.contains(e.target) ||
        els.schedulePopover?.contains(e.target)
      const inAiZone =
        !aiOpen ||
        els.btnAiAssist?.contains(e.target) ||
        els.aiPopover?.contains(e.target)
      if (!(inTtlZone && inSchedZone && inAiZone)) closeComposerPopovers()
    }
  })

  bindUserDirectoryUi()

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isMediaViewerOpen()) {
        closeMediaViewer()
        e.preventDefault()
        return
      }
      hidePrivateUserSuggest()
      if (!els.modalCreate.hidden) {
        closeCreateRoomModal()
        e.preventDefault()
        return
      }
      if (els.modalPinnedList && !els.modalPinnedList.hidden) {
        closePinnedListModal()
        e.preventDefault()
        return
      }
      if (els.modalScheduledList && !els.modalScheduledList.hidden) {
        closeScheduledListModal()
        e.preventDefault()
        return
      }
      if (!els.modalProfileEdit.hidden) {
        closeProfileEditModal()
        e.preventDefault()
        return
      }
      if (!els.modalAppSettings.hidden) {
        closeAppSettingsModal()
        e.preventDefault()
        return
      }
      if (!els.viewAuth.hidden) {
        const themePop = document.getElementById('auth-theme-popover')
        if (themePop && !themePop.hidden) {
          closeAuthQuickPopovers()
          e.preventDefault()
          return
        }
      }
      if (els.localSearchPanel && !els.localSearchPanel.hidden) {
        els.localSearchPanel.hidden = true
        e.preventDefault()
        return
      }
      const hadOverlay =
        (els.ctxMenu && !els.ctxMenu.hidden) ||
        (els.emojiBar && !els.emojiBar.hidden) ||
        (els.emojiPickerExpanded && !els.emojiPickerExpanded.hidden) ||
        (els.ttlPopover && !els.ttlPopover.hidden) ||
        (els.schedulePopover && !els.schedulePopover.hidden)
      closeContextMenus()
      if (hadOverlay) {
        e.preventDefault()
        return
      }
      let mobile = false
      try {
        mobile = window.matchMedia('(max-width: 720px)').matches
      } catch {
        mobile = window.innerWidth <= 720
      }
      if (
        mobile &&
        state.currentRoom &&
        els.viewMessenger &&
        !els.viewMessenger.hidden
      ) {
        closeCurrentChat()
        e.preventDefault()
      }
    }
  })

  window.addEventListener('popstate', () => void applyRoute())
  window.addEventListener('nebula-locale', () => {
    applyI18nToDom(document, { animate: true }).then(() => {
      applyMediaViewerI18n()
      applyLocaleToSettings()
      syncAuthQuickControls()
      refreshMessengerHeader()
      void refreshSidebarProfileLabel()
      syncTtlSelectLabels()
      syncMobileMessengerLayout()
      if (els.messageInput) syncComposerEmptyAttr(els.messageInput)
      if (els.profileAvatar) syncComposerEmptyAttr(els.profileAvatar)
    })
  })
}

async function init() {
  collectEls()
  state.theme = readStoredTheme()
  applyThemeToBody()
  bindEvents()
  void applyI18nToDom(document, { animate: false }).then(() => applyMediaViewerI18n())
  if (els.messageInput) syncComposerEmptyAttr(els.messageInput)
  if (els.profileAvatar) syncComposerEmptyAttr(els.profileAvatar)
  applyLocaleToSettings()
  syncAuthQuickControls()
  if (isAuthenticated()) await refreshSessionRole()
  await applyRoute()
  syncTtlSelectLabels()
  syncMobileMessengerLayout()
}

init()
