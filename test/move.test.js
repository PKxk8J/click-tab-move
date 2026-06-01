import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

const state = {
  currentWindowId: 1,
  nextTabId: 100,
  nextWindowId: 10,
  tabs: [],
  moved: [],
  grouped: [],
  groupMoved: [],
  removed: [],
  activated: [],
  windowUpdates: [],
  notifications: [],
  notificationAllowed: true,
  notificationError: undefined,
  storageData: {},
  nextGroupId: 1000,
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
    groupId: -1,
    splitViewId: -1,
    title: 'Tab ' + tab.id,
    url: 'https://example.com/' + tab.id,
    status: 'complete',
    ...tab,
  }))
  state.moved = []
  state.grouped = []
  state.groupMoved = []
  state.removed = []
  state.activated = []
  state.windowUpdates = []
  state.notifications = []
  state.notificationAllowed = true
  state.notificationError = undefined
  state.storageData = {}
  state.nextGroupId = 1000
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

function moveGroup (groupId, properties) {
  const groupTab = state.tabs.find((tab) => tab.groupId === groupId)
  const windowId = properties.windowId ?? groupTab.windowId
  const ids = getWindowTabs(groupTab.windowId).
    filter((tab) => tab.groupId === groupId).
    map((tab) => tab.id)
  moveTabIds(ids, { windowId, index: properties.index })
  state.groupMoved.push({ groupId, windowId, index: properties.index })
}

function groupTabs (tabIds, groupId) {
  const idList = Array.isArray(tabIds) ? tabIds : [tabIds]
  const targetGroupId = groupId ?? state.nextGroupId++
  const targetGroupTab = state.tabs.find((tab) => tab.groupId === targetGroupId)
  const targetWindowId = targetGroupTab?.windowId
  state.tabs.forEach((tab) => {
    if (!idList.includes(tab.id)) {
      return
    }
    tab.groupId = targetGroupId
    if (targetWindowId !== undefined) {
      tab.windowId = targetWindowId
    }
  })
  normalizeIndexes()
  state.grouped.push({ ids: idList, groupId: targetGroupId })
  return targetGroupId
}

function getMemberships () {
  return [...state.tabs].
    sort((tab1, tab2) => tab1.id - tab2.id).
    map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      groupId: tab.groupId,
      splitViewId: tab.splitViewId,
    }))
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
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    move: async (groupId, properties) => {
      moveGroup(groupId, properties)
      return { id: groupId }
    },
    query: async () => {
      const groups = []
      const knownGroupIds = new Set()
      for (const tab of state.tabs) {
        if (tab.groupId === -1 || knownGroupIds.has(tab.groupId)) {
          continue
        }
        knownGroupIds.add(tab.groupId)
        groups.push({
          id: tab.groupId,
          windowId: tab.windowId,
          title: 'Group ' + tab.groupId,
        })
      }
      return groups
    },
  },
  tabs: {
    SPLIT_VIEW_ID_NONE: -1,
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
    group: async (properties) => {
      return groupTabs(properties.tabIds, properties.groupId)
    },
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
  assert.deepEqual(normalizeMenuItems(undefined), {
    one: ['global'],
    right: ['global'],
    all: ['global'],
  })
  assert.deepEqual(normalizeMenuItems(['select', 'unknown', 'left']), {
    left: ['global'],
    select: ['global'],
  })
  assert.deepEqual(normalizeMenuItems({
    one: ['group', 'unknown', 'global'],
    all: ['group'],
  }), {
    one: ['global', 'group'],
  })
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

test('全体ではグループと分割ビューを単位にして移動対象タブを列挙する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0 },
    { id: 2, windowId: 1, index: 1, groupId: 10 },
    { id: 3, windowId: 1, index: 2, groupId: 10 },
    { id: 4, windowId: 1, index: 3, splitViewId: 7 },
    { id: 5, windowId: 1, index: 4, splitViewId: 7 },
    { id: 6, windowId: 1, index: 5 },
  ])

  assert.deepEqual(await listTargetTabIds(2, 'one'), [2, 3])
  assert.deepEqual(await listTargetTabIds(2, 'right'), [4, 5, 6])
  assert.deepEqual(await listTargetTabIds(4, 'one'), [4, 5])
  assert.deepEqual(await listTargetTabIds(4, 'thisAndLeft'), [1, 2, 3, 4, 5])
})

test('グループではグループ内のタブと分割ビューを単位にして移動対象タブを列挙する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0 },
    { id: 2, windowId: 1, index: 1, groupId: 10 },
    { id: 3, windowId: 1, index: 2, groupId: 10, splitViewId: 7 },
    { id: 4, windowId: 1, index: 3, groupId: 10, splitViewId: 7 },
    { id: 5, windowId: 1, index: 4, groupId: 10 },
    { id: 6, windowId: 1, index: 5 },
  ])

  assert.deepEqual(await listTargetTabIds(3, 'one', 'group'), [3, 4])
  assert.deepEqual(await listTargetTabIds(3, 'right', 'group'), [5])
  assert.deepEqual(await listTargetTabIds(3, 'thisAndLeft', 'group'), [2, 3, 4])
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

test('グループ全体をウィンドウへ移す場合はグループのまま移動する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, groupId: 10, active: true },
    { id: 2, windowId: 1, index: 1, groupId: 10 },
    { id: 20, windowId: 2, index: 0, active: true },
  ])

  await rawRun([1, 2], 2, false, false)

  assert.deepEqual(state.groupMoved, [{ groupId: 10, windowId: 2, index: 1 }])
  assert.deepEqual(getTabIds(2), [20, 1, 2])
  assert.deepEqual(getMemberships().filter((tab) => [1, 2].includes(tab.id)), [
    { id: 1, windowId: 2, groupId: 10, splitViewId: -1 },
    { id: 2, windowId: 2, groupId: 10, splitViewId: -1 },
  ])
})

test('グループをグループへ移す場合は移動先グループへ統合する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, groupId: 10, active: true },
    { id: 2, windowId: 1, index: 1, groupId: 10 },
    { id: 20, windowId: 2, index: 0, groupId: 30, active: true },
  ])

  await rawRun([1, 2], { type: 'group', groupId: 30 }, false, false)

  assert.deepEqual(state.grouped, [{ ids: [1, 2], groupId: 30 }])
  assert.deepEqual(getTabIds(2), [20, 1, 2])
  assert.deepEqual(getMemberships().filter((tab) => [1, 2, 20].includes(tab.id)), [
    { id: 1, windowId: 2, groupId: 30, splitViewId: -1 },
    { id: 2, windowId: 2, groupId: 30, splitViewId: -1 },
    { id: 20, windowId: 2, groupId: 30, splitViewId: -1 },
  ])
})

test('移動先グループが移動対象に含まれる場合はそのグループ以外を統合する', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 2, windowId: 1, index: 1, groupId: 10 },
    { id: 3, windowId: 1, index: 2, groupId: 10 },
    { id: 4, windowId: 1, index: 3, groupId: 20 },
    { id: 5, windowId: 1, index: 4, groupId: 20 },
    { id: 6, windowId: 1, index: 5 },
  ])

  await rawRun([2, 3, 4, 5, 6], { type: 'group', groupId: 20 }, false, false)

  assert.deepEqual(state.grouped, [{ ids: [2, 3, 6], groupId: 20 }])
  assert.deepEqual(getMemberships().filter((tab) => [2, 3, 4, 5, 6].includes(tab.id)), [
    { id: 2, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 3, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 4, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 5, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 6, windowId: 1, groupId: 20, splitViewId: -1 },
  ])
})

test('全てのタブ・グループを移動先グループへまとめ直す', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 2, windowId: 1, index: 1, groupId: 10 },
    { id: 3, windowId: 1, index: 2, groupId: 10 },
    { id: 4, windowId: 1, index: 3, groupId: 20 },
    { id: 5, windowId: 1, index: 4, groupId: 20 },
    { id: 6, windowId: 1, index: 5 },
  ])

  const tabIds = await listTargetTabIds(1, 'all')
  await rawRun(tabIds, { type: 'group', groupId: 20 }, false, false)

  assert.deepEqual(state.grouped, [{ ids: [1, 2, 3, 6], groupId: 20 }])
  assert.deepEqual(getMemberships().filter((tab) => [1, 2, 3, 4, 5, 6].includes(tab.id)), [
    { id: 1, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 2, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 3, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 4, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 5, windowId: 1, groupId: 20, splitViewId: -1 },
    { id: 6, windowId: 1, groupId: 20, splitViewId: -1 },
  ])
})

test('固定タブはグループへ移動しない', async () => {
  resetTabs([
    { id: 1, windowId: 1, index: 0, pinned: true, active: true },
    { id: 20, windowId: 2, index: 0, groupId: 30, active: true },
  ])

  const errorMock = mock.method(globalThis.console, 'error', () => {})
  try {
    await rawRun([1], { type: 'group', groupId: 30 }, false, false)
  } finally {
    errorMock.mock.restore()
  }

  assert.deepEqual(getTabIds(1), [1])
  assert.deepEqual(getTabIds(2), [20])
  assert.deepEqual(state.grouped, [])
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
