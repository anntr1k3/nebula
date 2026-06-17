/**
 * ИИ-помощник: улучшение текста в композере и в модалке редактирования.
 */

import * as api from '../api.js'
import { getToken } from '../auth.js'
import { t, translateApiMessage } from '../i18n.js'
import { els, showToast } from '../app-shell.js'
import {
  fillElementWithAppleEmoji,
  plainTextFromComposerRoot,
  setComposerPlainText,
} from '../emoji-apple.js'
import { closeCtxMenuAndEmoji } from './context-menu.js'
import {
  closeComposerPopovers,
  positionComposerFloat,
  updateSendButtonState,
  autosizeTextarea,
} from './composer.js'

const AI_ACTIONS = [
  { id: 'improve', icon: 'fa-solid fa-pen', labelKey: 'aiActionImprove' },
  { id: 'grammar', icon: 'fa-solid fa-check', labelKey: 'aiActionGrammar' },
  { id: 'shorten', icon: 'fa-solid fa-hourglass-end', labelKey: 'aiActionShorten' },
  { id: 'expand', icon: 'fa-solid fa-expand', labelKey: 'aiActionExpand' },
  { id: 'formal', icon: 'fa-solid fa-shield-halved', labelKey: 'aiActionFormal' },
  { id: 'friendly', icon: 'fa-solid fa-face-smile', labelKey: 'aiActionFriendly' },
]

let aiEnabled = false
let aiBusy = false
/** @type {'composer' | 'edit'} */
let aiTarget = 'composer'

export async function refreshAiAvailability() {
  try {
    const res = await api.aiStatus(getToken())
    aiEnabled = Boolean(res.success && res.enabled)
  } catch {
    aiEnabled = false
  }
  syncAiUi()
  syncEditAiToolbarVisibility()
}

function syncAiUi() {
  const btn = els.btnAiAssist
  if (!btn) return
  btn.removeAttribute('hidden')
  btn.classList.toggle('composer-action-btn--ai-off', !aiEnabled)
  btn.setAttribute('aria-disabled', aiEnabled ? 'false' : 'true')
  if (!aiEnabled) closeComposerPopovers()
}

function getSourceText() {
  if (aiTarget === 'edit') {
    return (els.editMessageInput?.value || '').trim()
  }
  if (!els.messageInput) return ''
  return (plainTextFromComposerRoot(els.messageInput) || '').trim()
}

function applyResultText(text) {
  if (aiTarget === 'edit') {
    if (els.editMessageInput) els.editMessageInput.value = text
    els.editMessageInput?.focus()
    return
  }
  if (!els.messageInput) return
  setComposerPlainText(els.messageInput, text)
  fillElementWithAppleEmoji(els.messageInput)
  updateSendButtonState()
  autosizeTextarea()
  els.messageInput.focus()
}

function setAiBusy(busy) {
  aiBusy = busy
  els.btnAiAssist?.classList.toggle('is-busy', busy)
  els.btnAiAssist?.toggleAttribute('disabled', busy)
  els.aiPopover?.querySelectorAll('.composer-float-option').forEach((btn) => {
    btn.toggleAttribute('disabled', busy)
  })
  els.editAiToolbar?.querySelectorAll('.edit-ai-chip').forEach((btn) => {
    btn.toggleAttribute('disabled', busy)
  })
}

function rebuildAiPopover() {
  const root = els.aiPopover
  if (!root) return
  root.innerHTML = ''
  const header = document.createElement('div')
  header.className = 'composer-float-header'
  header.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i><span>${t('aiAssistTitle')}</span>`
  root.appendChild(header)

  AI_ACTIONS.forEach(({ id, icon, labelKey }) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'composer-float-option'
    b.dataset.action = id
    b.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${t(labelKey)}</span>`
    b.addEventListener('click', (ev) => {
      ev.stopPropagation()
      void runAiRewrite(id)
    })
    root.appendChild(b)
  })
}

async function runAiRewrite(action, target = aiTarget) {
  if (aiBusy) return
  if (!aiEnabled) {
    showToast(t('aiNotConfigured'), 'info')
    return
  }
  aiTarget = target
  const text = getSourceText()
  if (!text) {
    showToast(t('aiEmptyText'), 'error')
    return
  }
  setAiBusy(true)
  try {
    const res = await api.aiRewrite({ text, action }, getToken())
    if (!res.success || !res.text) {
      showToast(translateApiMessage(res.message) || t('aiFailed'), 'error')
      return
    }
    applyResultText(res.text)
    if (target === 'composer') closeComposerPopovers()
    showToast(t('aiDone'), 'info')
  } catch {
    showToast(t('aiFailed'), 'error')
  } finally {
    setAiBusy(false)
  }
}

function openAiPopoverForComposer() {
  if (!els.btnAiAssist || !els.aiPopover) return
  if (!aiEnabled) {
    showToast(t('aiNotConfigured'), 'info')
    return
  }
  aiTarget = 'composer'
  if (!els.aiPopover.hidden && els.aiPopover.classList.contains('composer-float--open')) {
    closeComposerPopovers()
    return
  }
  closeCtxMenuAndEmoji()
  closeComposerPopovers()
  rebuildAiPopover()
  positionComposerFloat(els.aiPopover, els.btnAiAssist, 'ai')
  els.btnAiAssist.setAttribute('aria-expanded', 'true')
}

function bindEditAiToolbar() {
  const wrap = els.editAiToolbar
  if (!wrap || wrap.dataset.aiBound === '1') return
  wrap.dataset.aiBound = '1'
  AI_ACTIONS.forEach(({ id, icon, labelKey }) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'edit-ai-chip glass-button-secondary'
    b.dataset.action = id
    b.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${t(labelKey)}</span>`
    b.addEventListener('click', () => {
      aiTarget = 'edit'
      void runAiRewrite(id, 'edit')
    })
    wrap.appendChild(b)
  })
}

export function bindAiAssistant() {
  refreshAiAvailability()
  bindEditAiToolbar()
  if (!els.btnAiAssist || els.btnAiAssist.dataset.aiBound === '1') return
  els.btnAiAssist.dataset.aiBound = '1'
  els.btnAiAssist.addEventListener('click', (e) => {
    e.stopPropagation()
    openAiPopoverForComposer()
  })
  window.addEventListener('nebula-locale', () => {
    if (!els.aiPopover?.hidden) rebuildAiPopover()
    bindEditAiToolbarRefresh()
  })
}

function bindEditAiToolbarRefresh() {
  const wrap = els.editAiToolbar
  if (!wrap) return
  wrap.innerHTML = ''
  wrap.dataset.aiBound = '0'
  bindEditAiToolbar()
  syncEditAiToolbarVisibility()
}

export function syncEditAiToolbarVisibility() {
  const section = els.editAiSection
  if (!section) return
  section.removeAttribute('hidden')
  section.classList.toggle('edit-ai-section--off', !aiEnabled)
}
