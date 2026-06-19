import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  normalizeMessage,
  normalizeScheduledMessage,
  privatePeer,
} from '../../static/js/message-model.js'

test('normalizeMessage: подставляет дефолты для отсутствующих полей', () => {
  const out = normalizeMessage({ id: 42, username: 'kami' })
  assert.equal(out.message_id, 42)
  assert.equal(out.username, 'kami')
  assert.equal(out.text, '')
  assert.deepEqual(out.read_by, [])
  assert.deepEqual(out.reactions, {})
  assert.equal(out.edited, false)
})

test('normalizeMessage: message_id имеет приоритет над id', () => {
  const out = normalizeMessage({ id: 1, message_id: 99, username: 'a' })
  assert.equal(out.message_id, 99)
})

test('normalizeMessage: created_at как Date превращается в ISO timestamp', () => {
  const d = new Date('2026-06-19T08:00:00.000Z')
  const out = normalizeMessage({ id: 1, username: 'a', created_at: d })
  assert.equal(out.timestamp, '2026-06-19T08:00:00.000Z')
})

test('normalizeMessage: некорректные read_by/reactions заменяются безопасными значениями', () => {
  const out = normalizeMessage({ id: 1, username: 'a', read_by: 'nope', reactions: null })
  assert.deepEqual(out.read_by, [])
  assert.deepEqual(out.reactions, {})
})

test('normalizeScheduledMessage: помечает сообщение как отложенное и строит fallback id', () => {
  const out = normalizeScheduledMessage({ scheduled_id: 7, username: 'a', scheduled_at: 'X' })
  assert.equal(out.is_scheduled, true)
  assert.equal(out.scheduled_id, 7)
  assert.equal(out.message_id, 'scheduled_7')
  assert.equal(out.timestamp, 'X')
})

test('privatePeer: возвращает собеседника из id комнаты', () => {
  assert.equal(privatePeer('private_alice_bob', 'alice'), 'bob')
  assert.equal(privatePeer('private_alice_bob', 'bob'), 'alice')
})

test('privatePeer: null для не приватных комнат', () => {
  assert.equal(privatePeer('group_123', 'alice'), null)
  assert.equal(privatePeer(null, 'alice'), null)
})
