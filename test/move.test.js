import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const state = {
  currentWindowId: 1,
  nextTabId: 100,
  nextWindowId: 10,
  tabs: [],
  moved: [],
  removed: [],
  activated: [],
  windowUpdates: [],
  notifications: [],
  notificationAllowed: true,
  notificationError: undefined,
  storageData: {},
}

function cloneTab (tab) {
  return { ...tab }
}

function getWindowTabs (windowId) {
  return state.tabs.
    filter((tab) => tab.windowId === windowId).
    sort((tab1, tab2) => tab1.index - tab2.index)
}

function getTabIds (windowId) {
  return getWindowTabs(windowId).map((tab) => tab.id)
}

function normalizeIndexes () {
  const windowIds = new Set(state.tabs.map((tab) => tab.windowId))
  for (const windowId of windowIds) {
    getWindowTabs(windowId).forEach((tab, index) => {
      tab.index = index
    })
  }
}

function resetTabs (tabs) {
  state.currentWindowId = 1
  state.nextTabId = 100
  state.nextWindowId = 10
  state.tabs = tabs.map((tab) => ({
    pinned: false,
    active: false,
    title: 'Tab ' + tab.id,
    url: 'https://example.com/' + tab.id,
    status: 'complete',
    ...tab,
  }))
  state.moved = []
  state.removed = []
  state.activated = []
  state.windowUpdates = []
  state.notifications = []
  state.notificationAllowed = true
  state.notificationError = undefined
  state.storageData = {}
  normalizeIndexes()
}

function moveTabIds (ids, properties) {
  const idList = Array.isArray(ids) ? ids : [ids]
  const idSet = new Set(idList)
  const movingTabs = idList.map((id) => state.tabs.find((tab) => tab.id === id))
  const targetWindowId = properties.windowId ?? movingTabs[0].windowId

  state.tabs = state.tabs.filter((tab) => !idSet.has(tab.id))
  for (const tab of movingTabs) {
    tab.windowId = targetWindowId
  }

  const targetTabs = getWindowTabs(targetWindowId)
  const targetIndex = properties.index === -1
    ? targetTabs.length
    : Math.max(0, Math.min(properties.index, targetTabs.length))
  targetTabs.splice(targetIndex, 0, ...movingTabs)
  targetTabs.forEach((tab, index) => {
    tab.index = index
  })

  const otherTabs = state.tabs.filter((tab) => tab.windowId !== targetWindowId)
  state.tabs = otherTabs.concat(targetTabs)
  normalizeIndexes()
  state.moved.push({ ids: idList, windowId: targetWindowId, index: properties.index })
  return movingTabs.map(cloneTab)
}

globalThis.browser = {
  i18n: {
    getMessage: (key, substitutions) => {
      if (key === 'debug') {
        return 'release'
      }
      if (key === 'name') {
        return 'ClickTabMove'
      }
      if (Array.isArray(substitutions)) {
        return key + ':' + substitutions.join(',')
      }
      if (substitutions !== undefined) {
        return key + ':' + substitutions
      }
      return key
    },
  },
  notifications: {
    create: async (id, options) => {
      if (state.notificationError) {
        throw state.notificationError
      }
      state.notifications.push({ id, options })
      return 'notification'
    },
  },
  permissions: {
    contains: async () => state.notificationAllowed,
  },
  runtime: {
    getURL: (path) => 'moz-extension://test/' + path,
    onMessage: {
      addListener: () => {},
    },
    sendMessage: async () => {},
  },
  storage: {
    sync: {
      get: async (key) => {
        if (key === undefined) {
          return { ...state.storageData }
        }
        if (typeof key === 'string') {
          return { [key]: state.storageData[key] }
        }
        return { ...state.storageData }
      },
      set: async (data) => {
        state.storageData = {
          ...state.storageData,
          ...data,
        }
      },
    },
  },
  tabs: {
    query: async (query) => {
      let result = state.tabs
      if (query.windowId !== undefined) {
        result = result.filter((tab) => tab.windowId === query.windowId)
      }
      if (query.currentWindow) {
        result = result.filter((tab) => tab.windowId === state.currentWindowId)
      }
      if (query.active !== undefined) {
        result = result.filter((tab) => tab.active === query.active)
      }
      if (query.pinned !== undefined) {
        result = result.filter((tab) => tab.pinned === query.pinned)
      }
      return result.map(cloneTab)
    },
    get: async (id) => cloneTab(state.tabs.find((tab) => tab.id === id)),
    move: async (ids, properties) => moveTabIds(ids, properties),
    remove: async (ids) => {
      const idList = Array.isArray(ids) ? ids : [ids]
      state.removed.push(...idList)
      state.tabs = state.tabs.filter((tab) => !idList.includes(tab.id))
      normalizeIndexes()
    },
    update: async (id, properties) => {
      const target = state.tabs.find((tab) => tab.id === id)
      if (properties.active && target) {
        state.tabs.forEach((tab) => {
          if (tab.windowId === target.windowId) {
            tab.active = tab.id === id
          }
        })
        state.activated.push(id)
      }
      return target && cloneTab(target)
    },
  },
  windows: {
    WINDOW_ID_CURRENT: -2,
    create: async (properties = {}) => {
      const windowId = state.nextWindowId++
      const tab = {
        id: state.nextTabId++,
        windowId,
        index: 0,
        active: true,
        pinned: false,
        title: 'New Tab',
        url: properties.url || 'about:blank',
        status: 'complete',
      }
      state.tabs.push(tab)
      return {
        id: windowId,
        width: properties.width,
        height: properties.height,
        tabs: [cloneTab(tab)],
      }
    },
    get: async (id) => {
      if (!state.tabs.some((tab) => tab.windowId === id)) {
        throw new Error('Window not found: ' + id)
      }
      return { id }
    },
    getCurrent: async () => ({
      id: state.currentWindowId,
      width: 640,
      height: 480,
    }),
    update: async (id, properties) => {
      const windowId = id === -2 ? state.currentWindowId : id
      state.currentWindowId = windowId
      state.windowUpdates.push({ id: windowId, properties })
      return { id: windowId }
    },
    remove: async (id) => {
      state.tabs = state.tabs.filter((tab) => tab.windowId !== id)
    },
  },
}

const {
  listTargetTabIds,
  rawRun,
  run,
} = await import('../extension/move.js')
const {
  normalizeContexts,
  normalizeFocus,
  normalizeMenuItems,
  normalizeNotification,
  normalizeSelectSave,
  normalizeSelectSize,
} = await import('../extension/common.js')

test('設定値を正規化する', () => {
  assert.deepEqual(normalizeContexts(undefined), ['tab'])
  assert.deepEqual(normalizeContexts(['all', 'unknown', 'tab']), ['tab', 'all'])
  assert.deepEqual(normalizeContexts('tab'), [])
  assert.deepEqual(normalizeMenuItems(undefined), ['one', 'right', 'all'])
  assert.deepEqual(normalizeMenuItems(['select', 'unknown', 'left']), [
    'left',
    'select',
  ])
  assert.equal(normalizeNotification(undefined), false)
  assert.equal(normalizeNotification(true), true)
  assert.equal(normalizeNotification('true'), false)
  assert.equal(normalizeFocus(undefined), false)
  assert.equal(normalizeFocus(true), true)
  assert.equal(normalizeSelectSave(undefined), true)
  assert.deepEqual(normalizeSelectSize([320.4, 240.6]), [320, 241])
  assert.deepEqual(normalizeSelectSize(['bad', 240]), [640, 480])
})

test('クリック位置から移動対象タブを列挙する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0 },
    { id: 2, windowId: 1, index: 1 },
    { id: 3, windowId: 1, index: 2 },
    { id: 4, windowId: 1, index: 3 },
  ])

  assert.deepEqual(await listTargetTabIds(2, 'one'), [2])
  assert.deepEqual(await listTargetTabIds(2, 'right'), [3, 4])
  assert.deepEqual(await listTargetTabIds(2, 'thisAndRight'), [2, 3, 4])
  assert.deepEqual(await listTargetTabIds(2, 'left'), [1])
  assert.deepEqual(await listTargetTabIds(2, 'thisAndLeft'), [1, 2])
  assert.deepEqual(await listTargetTabIds(2, 'all'), [1, 2, 3, 4])
})

test('固定タブを固定タブ領域へ、通常タブを末尾へ移動する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, pinned: true, active: true },
    { id: 2, windowId: 1, index: 1 },
    { id: 10, windowId: 2, index: 0, pinned: true, active: true },
    { id: 11, windowId: 2, index: 1 },
  ])

  await rawRun([1, 2], 2, false, false)

  assert.deepEqual(state.moved, [
    { ids: [1], windowId: 2, index: 1 },
    { ids: [2], windowId: 2, index: -1 },
  ])
  assert.deepEqual(getTabIds(2), [10, 1, 11, 2])
})

test('新規ウィンドウへ移動した後にプレースホルダータブを削除する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, pinned: true, active: true },
    { id: 2, windowId: 1, index: 1 },
  ])

  await rawRun([1, 2], undefined, false, false)

  assert.deepEqual(getTabIds(10), [1, 2])
  assert.deepEqual(state.removed, [100])
})

test('移動対象の active tab から近い残留タブへ事前にフォーカスを移す', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 2, windowId: 1, index: 1 },
    { id: 3, windowId: 1, index: 2 },
    { id: 10, windowId: 2, index: 0, active: true },
  ])

  await rawRun([1, 2], 2, false, false)

  assert.deepEqual(state.activated, [3])
  assert.equal(state.tabs.find((tab) => tab.id === 3).active, true)
})

test('移動後フォーカスが有効な場合は移動先ウィンドウと最後の移動タブを有効化する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 10, windowId: 2, index: 0, active: true },
  ])

  await rawRun([1], 2, false, true)

  assert.deepEqual(state.windowUpdates, [{ id: 2, properties: { focused: true } }])
  assert.equal(state.tabs.find((tab) => tab.id === 1).active, true)
})

test('通知権限がない場合は通知せずに移動する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 10, windowId: 2, index: 0, active: true },
  ])
  state.notificationAllowed = false

  await rawRun([1], 2, true, false)

  assert.deepEqual(getTabIds(2), [10, 1])
  assert.equal(state.notifications.length, 0)
})

test('通知作成に失敗しても移動は完了する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 10, windowId: 2, index: 0, active: true },
  ])
  state.notificationError = new Error('Notification unavailable')

  const errorMock = mock.method(globalThis.console, 'error', () => {})
  try {
    await rawRun([1], 2, true, false)
  } finally {
    errorMock.mock.restore()
  }

  assert.deepEqual(getTabIds(2), [10, 1])
})

test('未対応のキーではタブを移動しない', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 10, windowId: 2, index: 0, active: true },
  ])

  const errorMock = mock.method(globalThis.console, 'error', () => {})
  try {
    await run(1, 'unknown', 2, false, false)
  } finally {
    errorMock.mock.restore()
  }

  assert.deepEqual(getTabIds(1), [1])
  assert.deepEqual(getTabIds(2), [10])
  assert.deepEqual(state.moved, [])
})
