import assert from 'node:assert/strict'
import test from 'node:test'

const state = {
  tabs: [],
  storageData: {},
  menuItems: new Map(),
  refreshCount: 0,
  storageGetWait: undefined,
}

function createEvent () {
  const listeners = []
  return {
    addListener: (listener) => {
      listeners.push(listener)
    },
    listeners,
  }
}

const events = {
  menusClicked: createEvent(),
  menusShown: createEvent(),
  runtimeInstalled: createEvent(),
  runtimeMessage: createEvent(),
  runtimeStartup: createEvent(),
  storageChanged: createEvent(),
  tabGroupsCreated: createEvent(),
  tabGroupsMoved: createEvent(),
  tabGroupsRemoved: createEvent(),
  tabGroupsUpdated: createEvent(),
  tabsActivated: createEvent(),
  tabsAttached: createEvent(),
  tabsDetached: createEvent(),
  tabsMoved: createEvent(),
  tabsUpdated: createEvent(),
  windowsCreated: createEvent(),
  windowsFocusChanged: createEvent(),
  windowsRemoved: createEvent(),
}

function cloneTab (tab) {
  return { ...tab }
}

function finishMenuCallback (callback, error) {
  globalThis.browser.runtime.lastError = error
  callback?.()
  globalThis.browser.runtime.lastError = undefined
}

function removeMenuItemAndChildren (id) {
  for (const [childId, item] of [...state.menuItems]) {
    if (item.parentId === id) {
      removeMenuItemAndChildren(childId)
    }
  }
  state.menuItems.delete(id)
}

function resetState ({ menuItems, tabs }) {
  state.tabs = tabs.map((tab) => ({
    active: false,
    groupId: -1,
    pinned: false,
    splitViewId: -1,
    title: 'Tab ' + tab.id,
    ...tab,
  }))
  state.storageData = {
    contexts: ['tab'],
    menuItems,
  }
  state.menuItems.clear()
  state.refreshCount = 0
  state.storageGetWait = undefined
}

globalThis.browser = {
  i18n: {
    getMessage: (key, substitutions) => {
      if (key === 'debug') {
        return 'release'
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
  menus: {
    create: (properties, callback) => {
      if (state.menuItems.has(properties.id)) {
        finishMenuCallback(callback, new Error('Duplicate menu id'))
        return
      }
      state.menuItems.set(properties.id, { ...properties })
      finishMenuCallback(callback)
    },
    update: (id, properties, callback) => {
      const item = state.menuItems.get(id)
      if (!item) {
        finishMenuCallback(callback, new Error('Unknown menu id'))
        return
      }
      state.menuItems.set(id, { ...item, ...properties })
      finishMenuCallback(callback)
    },
    remove: (id, callback) => {
      if (!state.menuItems.has(id)) {
        finishMenuCallback(callback, new Error('Unknown menu id'))
        return
      }
      removeMenuItemAndChildren(id)
      finishMenuCallback(callback)
    },
    removeAll: async () => {
      state.menuItems.clear()
    },
    refresh: async () => {
      state.refreshCount += 1
    },
    onClicked: events.menusClicked,
    onShown: events.menusShown,
  },
  notifications: {
    create: async () => {},
  },
  permissions: {
    contains: async () => true,
  },
  runtime: {
    lastError: undefined,
    getURL: (path) => 'moz-extension://test/' + path,
    onInstalled: events.runtimeInstalled,
    onMessage: events.runtimeMessage,
    onStartup: events.runtimeStartup,
    sendMessage: async () => {},
  },
  storage: {
    sync: {
      get: async (key) => {
        await state.storageGetWait?.()
        if (typeof key === 'string') {
          return { [key]: state.storageData[key] }
        }
        return { ...state.storageData }
      },
      set: async (data) => {
        state.storageData = { ...state.storageData, ...data }
      },
    },
    onChanged: events.storageChanged,
  },
  tabGroups: {
    TAB_GROUP_ID_NONE: -1,
    move: async (groupId) => ({ id: groupId }),
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
    onCreated: events.tabGroupsCreated,
    onMoved: events.tabGroupsMoved,
    onRemoved: events.tabGroupsRemoved,
    onUpdated: events.tabGroupsUpdated,
  },
  tabs: {
    SPLIT_VIEW_ID_NONE: -1,
    get: async (id) => {
      const tab = state.tabs.find((entry) => entry.id === id)
      return tab ? cloneTab(tab) : undefined
    },
    group: async () => 100,
    move: async () => [],
    query: async (query = {}) => {
      let result = state.tabs
      if (query.windowId !== undefined) {
        result = result.filter((tab) => tab.windowId === query.windowId)
      }
      if (query.currentWindow) {
        result = result.filter((tab) => tab.windowId === 1)
      }
      if (query.active !== undefined) {
        result = result.filter((tab) => tab.active === query.active)
      }
      if (query.pinned !== undefined) {
        result = result.filter((tab) => tab.pinned === query.pinned)
      }
      return result.map(cloneTab)
    },
    remove: async () => {},
    ungroup: async () => {},
    update: async (id, properties) => ({ id, ...properties }),
    onActivated: events.tabsActivated,
    onAttached: events.tabsAttached,
    onDetached: events.tabsDetached,
    onMoved: events.tabsMoved,
    onUpdated: events.tabsUpdated,
  },
  windows: {
    create: async () => ({ id: 10, tabs: [{ id: 10 }] }),
    get: async (id) => ({ id }),
    update: async (id, properties) => ({ id, ...properties }),
    onCreated: events.windowsCreated,
    onFocusChanged: events.windowsFocusChanged,
    onRemoved: events.windowsRemoved,
  },
}

resetState({
  menuItems: { one: ['global'] },
  tabs: [
    { id: 1, windowId: 1, index: 0, active: true },
    { id: 2, windowId: 2, index: 0, active: true },
  ],
})
await import('../extension/menu.js?menu-test')
await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

async function rebuildMenu () {
  await events.runtimeStartup.listeners[0]()
}

async function showMenu (tabId) {
  const tab = state.tabs.find((entry) => entry.id === tabId)
  await events.menusShown.listeners[0]({}, cloneTab(tab))
}

function getChildIds (parentId) {
  return [...state.menuItems.entries()].
    filter(([, item]) => item.parentId === parentId).
    filter(([, item]) => item.visible !== false).
    map(([id]) => id)
}

function getAllChildIds (parentId) {
  return [...state.menuItems.entries()].
    filter(([, item]) => item.parentId === parentId).
    map(([id]) => id)
}

function hasVisibleMenuIdPrefix (prefix) {
  return [...state.menuItems.entries()].
    some(([id, item]) => id.startsWith(prefix) && item.visible !== false)
}

test('load rebuilds menu', async () => {
  assert.ok(state.menuItems.has('move'))
  assert.notEqual(state.menuItems.get('move').visible, false)
  assert.deepEqual(getAllChildIds('move'), [
    'entry:global:one',
    'flatTarget:global:one:newWindow',
    'flatTarget:global:one:window:1',
    'flatTarget:global:one:window:2',
    'flatTarget:global:one:newGroup',
  ])
})

test('menu shown waits for an in-progress menu rebuild', async () => {
  let releaseStorage = () => {}
  const storageReady = new Promise((resolve) => {
    releaseStorage = resolve
  })
  resetState({
    menuItems: { one: ['global'] },
    tabs: [
      { id: 1, windowId: 1, index: 0, active: true },
      { id: 2, windowId: 2, index: 0, active: true },
    ],
  })
  state.storageGetWait = async () => storageReady

  const rebuildPromise = rebuildMenu()
  const showPromise = showMenu(1)
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

  assert.equal(state.refreshCount, 0)

  releaseStorage()
  await Promise.all([rebuildPromise, showPromise])

  assert.equal(state.menuItems.get('move').title, 'move: targetSubjectTab')
  assert.deepEqual(getChildIds('move'), [
    'flatTarget:global:one:newWindow',
    'flatTarget:global:one:window:2',
    'flatTarget:global:one:newGroup',
  ])
  assert.equal(state.refreshCount, 1)
})

test('rebuild precreates both flat and nested destination layouts', async () => {
  resetState({
    menuItems: { one: ['global'] },
    tabs: [
      { id: 1, windowId: 1, index: 0, active: true },
      { id: 2, windowId: 2, index: 0, active: true },
    ],
  })
  await rebuildMenu()

  assert.deepEqual(getAllChildIds('move'), [
    'entry:global:one',
    'flatTarget:global:one:newWindow',
    'flatTarget:global:one:window:1',
    'flatTarget:global:one:window:2',
    'flatTarget:global:one:newGroup',
  ])
  assert.deepEqual(getAllChildIds('entry:global:one'), [
    'target:global:one:newWindow',
    'target:global:one:window:1',
    'target:global:one:window:2',
    'target:global:one:newGroup',
  ])
  assert.deepEqual(getChildIds('move'), [])
})

test('single visible entry renders destinations directly under root', async () => {
  resetState({
    menuItems: { one: ['global'] },
    tabs: [
      { id: 1, windowId: 1, index: 0, active: true },
      { id: 2, windowId: 2, index: 0, active: true },
    ],
  })
  await rebuildMenu()
  await showMenu(1)

  assert.equal(state.menuItems.get('move').title, 'move: targetSubjectTab')
  assert.equal(state.menuItems.get('entry:global:one').visible, false)
  assert.deepEqual(getChildIds('move'), [
    'flatTarget:global:one:newWindow',
    'flatTarget:global:one:window:2',
    'flatTarget:global:one:newGroup',
  ])
  assert.equal(hasVisibleMenuIdPrefix('target:global:one:'), false)
  assert.equal(state.refreshCount, 1)
})

test('multiple visible entries render destinations under entry submenus', async () => {
  resetState({
    menuItems: {
      one: ['global'],
      right: ['global'],
    },
    tabs: [
      { id: 1, windowId: 1, index: 0, active: true },
      { id: 3, windowId: 1, index: 1 },
      { id: 2, windowId: 2, index: 0, active: true },
    ],
  })
  await rebuildMenu()
  await showMenu(1)

  assert.equal(state.menuItems.get('move').title, 'move')
  assert.deepEqual(getChildIds('move'), [
    'entry:global:one',
    'entry:global:right',
  ])
  assert.equal(
    state.menuItems.get('target:global:one:newWindow').parentId,
    'entry:global:one',
  )
  assert.equal(
    state.menuItems.get('target:global:right:newWindow').parentId,
    'entry:global:right',
  )
  assert.equal(hasVisibleMenuIdPrefix('flatTarget:'), false)
})

test('menu shown rebuild clears the previous dynamic layout', async () => {
  resetState({
    menuItems: {
      one: ['global'],
      right: ['global'],
    },
    tabs: [
      { id: 1, windowId: 1, index: 0, active: true },
      { id: 3, windowId: 1, index: 1 },
      { id: 2, windowId: 2, index: 0, active: true },
    ],
  })
  await rebuildMenu()
  await showMenu(1)
  await showMenu(3)

  assert.equal(state.menuItems.get('entry:global:one').visible, false)
  assert.equal(state.menuItems.get('entry:global:right').visible, false)
  assert.deepEqual(getChildIds('move'), [
    'flatTarget:global:one:newWindow',
    'flatTarget:global:one:window:2',
    'flatTarget:global:one:newGroup',
  ])
  assert.equal(
    state.menuItems.get('target:global:right:newWindow').visible,
    false,
  )
  assert.equal(hasVisibleMenuIdPrefix('target:global:'), false)
  assert.equal(state.refreshCount, 2)
})
