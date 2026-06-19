import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  bumpUnread,
  clearUnread,
  readUnreadMap,
  clearRoomLocalCaches,
} from '../../static/js/read-maps.js'

beforeEach(() => clearRoomLocalCaches())

test('bumpUnread: увеличивает счётчик непрочитанных', () => {
  bumpUnread('r1', 'active', new Set())
  bumpUnread('r1', 'active', new Set())
  assert.equal(readUnreadMap().r1, 2)
})

test('bumpUnread: не считает активную комнату', () => {
  bumpUnread('active', 'active', new Set())
  assert.equal(readUnreadMap().active, undefined)
})

test('bumpUnread: игнорирует приглушённые (muted) комнаты', () => {
  bumpUnread('r1', 'active', new Set(['r1']))
  assert.equal(readUnreadMap().r1, undefined)
})

test('bumpUnread: счётчик не превышает 99', () => {
  for (let i = 0; i < 150; i++) bumpUnread('r1', 'active', new Set())
  assert.equal(readUnreadMap().r1, 99)
})

test('clearUnread: сбрасывает счётчик комнаты', () => {
  bumpUnread('r1', 'active', new Set())
  clearUnread('r1')
  assert.equal(readUnreadMap().r1, undefined)
})
