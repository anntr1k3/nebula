import * as api from './api.js'
import { getToken, getUsername } from './auth.js'
import { t } from './i18n.js'
import { els } from './app-shell.js'
import { fillElementWithAppleEmoji } from './emoji-apple.js'
import { openChat } from './chat.js'
import {
  getSidebarDropdownBody,
  hideSidebarDropdown,
  revealSidebarDropdown,
} from './sidebar-dropdown.js'

let searchDebounce = null

export function runGlobalSearch(q) {
  if (!q || q.length < 2) {
    hideSidebarDropdown(els.searchResults, { clear: true })
    return
  }
  void (async () => {
    const data = await api.searchGlobal(getUsername(), q, getToken())
    const results = data.results || []
    const body = getSidebarDropdownBody(els.searchResults)
    if (!body) return
    body.innerHTML = ''
    if (!results.length) {
      const empty = document.createElement('div')
      empty.className = 'search-result-row'
      empty.textContent = t('noSearchResults')
      body.appendChild(empty)
    } else {
      results.forEach((r) => {
        const row = document.createElement('div')
        row.className = 'search-result-row'
        const t1 = document.createElement('div')
        fillElementWithAppleEmoji(t1, (r.text || '').slice(0, 160))
        const meta = document.createElement('div')
        meta.className = 'search-result-meta'
        meta.textContent = `${r.username} · ${r.room || ''}`
        row.appendChild(t1)
        row.appendChild(meta)
        row.addEventListener('click', () => {
          hideSidebarDropdown(els.searchResults, { clear: true })
          const isGroup = r.room?.startsWith('room_')
          openChat(r.room, isGroup ? 'group' : 'private')
        })
        body.appendChild(row)
      })
    }
    revealSidebarDropdown(els.searchResults)
  })()
}

export function bindSearchInputListeners() {
  els.globalSearch.addEventListener('input', () => {
    const q = els.globalSearch.value.trim()
    clearTimeout(searchDebounce)
    searchDebounce = setTimeout(() => runGlobalSearch(q), 320)
  })
  els.globalSearch.addEventListener('focus', () => {
    const q = els.globalSearch.value.trim()
    if (q.length >= 2) runGlobalSearch(q)
  })
}
