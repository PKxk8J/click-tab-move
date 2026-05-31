import {
  ALL_MENU_SCOPES,
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_ALL,
  KEY_CONTEXTS,
  KEY_FOCUS,
  KEY_LEFT,
  KEY_MENU_ITEMS,
  KEY_MOVE,
  KEY_MOVE_X,
  KEY_NEW_GROUP,
  KEY_NEW_WINDOW,
  KEY_NOTIFICATION,
  KEY_ONE,
  KEY_RIGHT,
  KEY_SELECT,
  KEY_TARGET_GLOBAL,
  KEY_TARGET_GROUP,
  KEY_THIS_AND_LEFT,
  KEY_THIS_AND_RIGHT,
  MENU_ITEMS_BY_SCOPE,
  debug,
  getValue,
  normalizeContexts,
  normalizeFocus,
  normalizeMenuItems,
  normalizeNotification,
  onError,
} from './common.js'
import {
  getSelectWindowId,
  listTargetTabIds,
  run,
  select,
} from './move.js'

const {
  i18n,
  menus,
  runtime,
  storage,
  tabs,
  windows,
} = browser

const ITEM_LENGTH = 64

let rebuildMenuPromise
let rebuildMenuRequested = false
let currentEntries = []
let destinationEntries = {
  windows: [],
  groups: [],
}

function cut (text, length) {
  if (text.length <= length) {
    return text
  }
  return text.substring(0, length) + '...'
}

function getNoGroupId () {
  return browser.tabGroups?.TAB_GROUP_ID_NONE ?? -1
}

function isGroupedTab (tab) {
  return tab.groupId !== undefined && tab.groupId !== getNoGroupId()
}

function getEntryMenuId (scope, key) {
  return 'entry:' + scope + ':' + key
}

function getDestinationMenuId (scope, key, destination) {
  if (destination.type === 'newWindow') {
    return 'target:' + scope + ':' + key + ':newWindow'
  }
  if (destination.type === 'window') {
    return 'target:' + scope + ':' + key + ':window:' + destination.windowId
  }
  if (destination.type === 'newGroup') {
    return 'target:' + scope + ':' + key + ':newGroup'
  }
  return 'target:' + scope + ':' + key + ':group:' + destination.groupId
}

function getFlatDestinationMenuId (scope, key, destination) {
  if (destination.type === 'newWindow') {
    return 'flatTarget:' + scope + ':' + key + ':newWindow'
  }
  if (destination.type === 'window') {
    return 'flatTarget:' + scope + ':' + key + ':window:' +
      destination.windowId
  }
  if (destination.type === 'newGroup') {
    return 'flatTarget:' + scope + ':' + key + ':newGroup'
  }
  return 'flatTarget:' + scope + ':' + key + ':group:' + destination.groupId
}

function parseTargetMenuId (id) {
  const parts = id.split(':')
  if (parts.length < 4 ||
      !['target', 'flatTarget'].includes(parts[0])) {
    return
  }

  const [, scope, key, type, value] = parts
  if (!ALL_MENU_SCOPES.includes(scope) ||
      !MENU_ITEMS_BY_SCOPE[scope].includes(key)) {
    return
  }

  if (type === 'newWindow' && parts.length === 4) {
    return { scope, key, destination: { type: 'newWindow' } }
  }
  if (type === 'newGroup' && parts.length === 4) {
    return { scope, key, destination: { type: 'newGroup' } }
  }

  const idValue = Number(value)
  if (!Number.isInteger(idValue) || parts.length !== 5) {
    return
  }
  if (type === 'window') {
    return { scope, key, destination: { type: 'window', windowId: idValue } }
  }
  if (type === 'group') {
    return { scope, key, destination: { type: 'group', groupId: idValue } }
  }
}

function getMenuEntries (menuItems) {
  const entries = []
  for (const scope of ALL_MENU_SCOPES) {
    for (const key of MENU_ITEMS_BY_SCOPE[scope]) {
      if (menuItems[key]?.includes(scope)) {
        entries.push({ scope, key })
      }
    }
  }
  return entries
}

function getSettingTitle (entry) {
  return i18n.getMessage('menuItem_' + entry.scope + '_' + entry.key)
}

function getGlobalTitle (key, targetTab) {
  const subject = i18n.getMessage(isGroupedTab(targetTab)
    ? 'targetSubjectGroup'
    : 'targetSubjectTab')

  switch (key) {
    case KEY_ONE:
      return subject
    case KEY_RIGHT:
      return i18n.getMessage('targetGlobalRight', subject)
    case KEY_THIS_AND_RIGHT:
      return i18n.getMessage('targetGlobalThisAndRight', subject)
    case KEY_LEFT:
      return i18n.getMessage('targetGlobalLeft', subject)
    case KEY_THIS_AND_LEFT:
      return i18n.getMessage('targetGlobalThisAndLeft', subject)
    case KEY_ALL:
      return i18n.getMessage('targetGlobalAll')
    case KEY_SELECT:
      return i18n.getMessage('targetGlobalSelect')
  }
}

function getGroupTitle (key) {
  switch (key) {
    case KEY_ONE:
      return i18n.getMessage('targetSubjectTab')
    case KEY_RIGHT:
      return i18n.getMessage('targetGroupRight')
    case KEY_THIS_AND_RIGHT:
      return i18n.getMessage('targetGroupThisAndRight')
    case KEY_LEFT:
      return i18n.getMessage('targetGroupLeft')
    case KEY_THIS_AND_LEFT:
      return i18n.getMessage('targetGroupThisAndLeft')
    case KEY_SELECT:
      return i18n.getMessage('targetGroupSelect')
  }
}

function getEntryTitle (entry, targetTab, flat) {
  const title = entry.scope === KEY_TARGET_GROUP
    ? getGroupTitle(entry.key)
    : getGlobalTitle(entry.key, targetTab)
  if (flat) {
    return i18n.getMessage(KEY_MOVE_X, title)
  }
  return title
}

function createMenuItem (properties) {
  return new Promise((resolve, reject) => {
    menus.create(properties, () => {
      if (runtime.lastError) {
        reject(runtime.lastError)
      } else {
        debug('Added ' + properties.title + ' menu item')
        resolve()
      }
    })
  })
}

function updateMenuItem (id, properties) {
  return new Promise((resolve, reject) => {
    menus.update(id, properties, () => {
      if (runtime.lastError) {
        reject(runtime.lastError)
      } else {
        resolve()
      }
    })
  })
}

async function getCurrentTab () {
  const [tab] = await tabs.query({ active: true, currentWindow: true })
  return tab
}

function getWindowEntryTitle (tab) {
  return cut(i18n.getMessage('windowEntry', [tab.windowId, tab.title]),
    ITEM_LENGTH)
}

function getGroupEntryTitle (group) {
  const title = group.title || i18n.getMessage('untitledGroup')
  return cut(i18n.getMessage('groupEntry',
    [group.windowId, group.id, title]), ITEM_LENGTH)
}

async function getGroupEntries (selectWindowId) {
  let groups = []
  if (typeof browser.tabGroups?.query === 'function') {
    groups = await browser.tabGroups.query({})
  } else {
    const tabList = await tabs.query({})
    const knownGroupIds = new Set()
    for (const tab of tabList) {
      if (!isGroupedTab(tab) || knownGroupIds.has(tab.groupId)) {
        continue
      }
      knownGroupIds.add(tab.groupId)
      groups.push({
        id: tab.groupId,
        windowId: tab.windowId,
        title: '',
      })
    }
  }

  return groups.
    filter((group) => group.windowId !== selectWindowId).
    sort((group1, group2) => {
      if (group1.windowId !== group2.windowId) {
        return group1.windowId - group2.windowId
      }
      return group1.id - group2.id
    }).
    map((group) => ({
      type: 'group',
      groupId: group.id,
      windowId: group.windowId,
      title: getGroupEntryTitle(group),
    }))
}

async function getDestinationEntries () {
  const selectWindowId = getSelectWindowId()
  const activeTabs = await tabs.query({ active: true })
  const windowEntries = activeTabs.
    filter((tab) => tab.windowId !== selectWindowId).
    sort((tab1, tab2) => tab1.windowId - tab2.windowId).
    map((tab) => ({
      type: 'window',
      windowId: tab.windowId,
      title: getWindowEntryTitle(tab),
    }))
  return {
    windows: windowEntries,
    groups: await getGroupEntries(selectWindowId),
  }
}

function getAllDestinations () {
  return [
    { type: 'newWindow', title: i18n.getMessage(KEY_NEW_WINDOW) },
    ...destinationEntries.windows,
    { type: 'newGroup', title: i18n.getMessage(KEY_NEW_GROUP) },
    ...destinationEntries.groups,
  ]
}

async function rebuildMenu () {
  const [storedContexts, storedMenuItems] = await Promise.all([
    getValue(KEY_CONTEXTS),
    getValue(KEY_MENU_ITEMS),
  ])
  const contexts = normalizeContexts(storedContexts)
  const menuItems = normalizeMenuItems(storedMenuItems)
  const entries = getMenuEntries(menuItems)
  const destinations = await getDestinationEntries()

  currentEntries = entries
  destinationEntries = destinations

  await menus.removeAll()
  debug('Clear menu items')

  if (contexts.length <= 0 || entries.length <= 0) {
    return
  }

  await createMenuItem({
    id: KEY_MOVE,
    title: i18n.getMessage(KEY_MOVE),
    contexts,
  })

  for (const entry of entries) {
    const entryMenuId = getEntryMenuId(entry.scope, entry.key)
    await createMenuItem({
      id: entryMenuId,
      title: getSettingTitle(entry),
      contexts,
      parentId: KEY_MOVE,
    })

    for (const destination of getAllDestinations()) {
      await createMenuItem({
        id: getDestinationMenuId(entry.scope, entry.key, destination),
        title: destination.title,
        contexts,
        parentId: entryMenuId,
      })
      await createMenuItem({
        id: getFlatDestinationMenuId(entry.scope, entry.key, destination),
        title: destination.title,
        contexts,
        parentId: KEY_MOVE,
        visible: false,
      })
    }
  }
}

function queueRebuildMenu () {
  rebuildMenuRequested = true
  if (!rebuildMenuPromise) {
    rebuildMenuPromise = (async () => {
      while (rebuildMenuRequested) {
        rebuildMenuRequested = false
        await rebuildMenu()
      }
    })().finally(() => {
      rebuildMenuPromise = undefined
      if (rebuildMenuRequested) {
        queueRebuildMenu().catch(onError)
      }
    })
  }
  return rebuildMenuPromise
}

async function getTargetSummary (entry, targetTab) {
  if (entry.scope === KEY_TARGET_GROUP && !isGroupedTab(targetTab)) {
    return { valid: false }
  }

  if (entry.key === KEY_SELECT) {
    return {
      valid: true,
      sourceWindowId: targetTab.windowId,
      groupIds: entry.scope === KEY_TARGET_GROUP
        ? new Set([targetTab.groupId])
        : new Set(),
      blockedGroupIds: entry.scope === KEY_TARGET_GROUP
        ? new Set([targetTab.groupId])
        : new Set(),
      groupTabCounts: new Map(),
      hasPinned: false,
      singleWholeGroup: false,
      targetTabCount: 0,
    }
  }

  const tabIds = await listTargetTabIds(targetTab.id, entry.key, entry.scope)
  const tabInfos = []
  for (const tabId of tabIds) {
    tabInfos.push(await tabs.get(tabId))
  }
  const groupIds = new Set(tabInfos.
    filter(isGroupedTab).
    map((tab) => tab.groupId))
  const groupTabCounts = new Map()
  for (const tabInfo of tabInfos) {
    if (!isGroupedTab(tabInfo)) {
      continue
    }
    groupTabCounts.set(tabInfo.groupId,
      (groupTabCounts.get(tabInfo.groupId) || 0) + 1)
  }

  return {
    valid: true,
    sourceWindowId: targetTab.windowId,
    groupIds,
    blockedGroupIds: new Set(),
    groupTabCounts,
    hasPinned: tabInfos.some((tab) => tab.pinned),
    singleWholeGroup: entry.scope === KEY_TARGET_GLOBAL &&
      entry.key === KEY_ONE &&
      isGroupedTab(targetTab),
    targetTabCount: tabInfos.length,
  }
}

function isDestinationVisible (entry, destination, summary, selectWindowId) {
  if (!summary.valid) {
    return false
  }

  if (destination.type === 'newWindow') {
    return entry.key !== KEY_ALL
  }

  if (destination.type === 'window') {
    return destination.windowId !== summary.sourceWindowId &&
      destination.windowId !== selectWindowId
  }

  if (entry.key === KEY_ALL || summary.hasPinned ||
      typeof tabs.group !== 'function') {
    return false
  }

  if (destination.type === 'newGroup') {
    return !summary.singleWholeGroup
  }

  if (summary.blockedGroupIds.has(destination.groupId)) {
    return false
  }
  if (!summary.groupIds.has(destination.groupId)) {
    return true
  }
  return (summary.groupTabCounts.get(destination.groupId) || 0) <
    summary.targetTabCount
}

async function handleMenuShown (info, tab) {
  const targetTab = tab || await getCurrentTab()
  if (!targetTab || currentEntries.length <= 0) {
    return
  }

  const selectWindowId = getSelectWindowId()
  const destinations = getAllDestinations()
  const entryStates = []
  for (const entry of currentEntries) {
    const summary = await getTargetSummary(entry, targetTab)
    const destinationVisibilities = destinations.map((destination) => ({
      destination,
      visible: isDestinationVisible(entry, destination, summary,
        selectWindowId),
    }))
    const visibleDestinationCount = destinationVisibilities.
      filter(({ visible }) => visible).length
    entryStates.push({
      entry,
      summary,
      destinationVisibilities,
      visible: summary.valid && visibleDestinationCount > 0,
    })
  }

  const visibleEntries = entryStates.filter((state) => state.visible)
  const nested = visibleEntries.length > 1
  const updates = []
  updates.push(updateMenuItem(KEY_MOVE, {
    visible: visibleEntries.length > 0,
    title: visibleEntries.length === 1
      ? getEntryTitle(visibleEntries[0].entry, targetTab, true)
      : i18n.getMessage(KEY_MOVE),
  }).catch(onError))

  for (const state of entryStates) {
    const { entry } = state
    const entryMenuId = getEntryMenuId(entry.scope, entry.key)
    for (const { destination, visible } of state.destinationVisibilities) {
      updates.push(updateMenuItem(
        getDestinationMenuId(entry.scope, entry.key, destination),
        { visible: nested && state.visible && visible },
      ).catch(onError))
      updates.push(updateMenuItem(
        getFlatDestinationMenuId(entry.scope, entry.key, destination),
        { visible: !nested && state.visible && visible },
      ).catch(onError))
    }

    updates.push(updateMenuItem(entryMenuId, {
      visible: nested && state.visible,
      title: getEntryTitle(entry, targetTab, false),
    }).catch(onError))
  }

  await Promise.all(updates)
  await menus.refresh()
}

async function handleMenuClick (info, tab) {
  const target = parseTargetMenuId(info.menuItemId)
  if (!target) {
    return
  }

  const targetTab = tab || await getCurrentTab()
  if (!targetTab) {
    return
  }

  const notification = normalizeNotification(
    await getValue(KEY_NOTIFICATION, DEFAULT_NOTIFICATION),
  )
  const focus = normalizeFocus(await getValue(KEY_FOCUS, DEFAULT_FOCUS))
  if (target.key === KEY_SELECT) {
    await select({
      fromWindowId: targetTab.windowId,
      groupId: target.scope === KEY_TARGET_GROUP ? targetTab.groupId : undefined,
      targetScope: target.scope,
      destination: target.destination,
    }, undefined, notification, focus, () => queueRebuildMenu().catch(onError))
    return
  }

  await run(targetTab.id, target.key, target.destination, notification, focus,
    target.scope)
}

function addGroupListener (name) {
  const listener = browser.tabGroups?.[name]
  if (listener) {
    listener.addListener(() => {
      return queueRebuildMenu().catch(onError)
    })
  }
}

runtime.onInstalled.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

runtime.onStartup.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return
  }
  if (changes[KEY_CONTEXTS] || changes[KEY_MENU_ITEMS]) {
    return queueRebuildMenu().catch(onError)
  }
})

tabs.onActivated.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.title || changeInfo.pinned ||
      changeInfo.groupId !== undefined)) {
    return queueRebuildMenu().catch(onError)
  }
})

tabs.onMoved.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

tabs.onAttached.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

tabs.onDetached.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

windows.onCreated.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

windows.onRemoved.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

windows.onFocusChanged.addListener(() => {
  return queueRebuildMenu().catch(onError)
})

addGroupListener('onCreated')
addGroupListener('onRemoved')
addGroupListener('onUpdated')
addGroupListener('onMoved')

menus.onClicked.addListener((info, tab) => {
  return handleMenuClick(info, tab).catch(onError)
})

menus.onShown.addListener((info, tab) => {
  return handleMenuShown(info, tab).catch(onError)
})

queueRebuildMenu().catch(onError)
