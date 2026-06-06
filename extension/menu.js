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
import {
  isGroupedTab,
} from './tab-units.js'

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
let currentContexts = []
let currentEntries = []
let destinationEntries = {
  windows: [],
  groups: [],
}
let currentMenuItemIds = []

function cut (text, length) {
  if (text.length <= length) {
    return text
  }
  return text.substring(0, length) + '...'
}

function sortTabsByWindowAndIndex (tabList) {
  return [...tabList].sort((tab1, tab2) => {
    if (tab1.windowId !== tab2.windowId) {
      return tab1.windowId - tab2.windowId
    }
    return tab1.index - tab2.index
  })
}

function getEntryMenuId (scope, key) {
  return 'entry:' + scope + ':' + key
}

function getDestinationMenuId (scope, key, destination) {
  return getTargetMenuId('target', scope, key, destination)
}

function getFlatDestinationMenuId (scope, key, destination) {
  return getTargetMenuId('flatTarget', scope, key, destination)
}

function getTargetMenuId (prefix, scope, key, destination) {
  if (destination.type === 'newWindow') {
    return prefix + ':' + scope + ':' + key + ':newWindow'
  }
  if (destination.type === 'window') {
    return prefix + ':' + scope + ':' + key + ':window:' +
      destination.windowId
  }
  if (destination.type === 'newGroup') {
    return prefix + ':' + scope + ':' + key + ':newGroup'
  }
  return prefix + ':' + scope + ':' + key + ':group:' + destination.groupId
}

function parseTargetMenuId (id) {
  const parts = id.split(':')
  if (parts.length < 4 ||
      (parts[0] !== 'target' && parts[0] !== 'flatTarget')) {
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
    case KEY_ALL:
      return i18n.getMessage('targetGroupAll')
    case KEY_SELECT:
      return i18n.getMessage('targetGroupSelect')
  }
}

function getEntryTitle (entry, targetTab) {
  const title = entry.scope === KEY_TARGET_GROUP
    ? getGroupTitle(entry.key)
    : getGlobalTitle(entry.key, targetTab)
  return title
}

function getSingleEntryMenuTitle (entry, targetTab) {
  return i18n.getMessage(KEY_MOVE) + ': ' + getEntryTitle(entry, targetTab)
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

async function createManagedMenuItem (properties) {
  await createMenuItem(properties)
  currentMenuItemIds.push(properties.id)
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
  const groupTitle = group.title || ''
  return cut(i18n.getMessage('groupEntry',
    [group.windowId, groupTitle, group.firstTabTitle]), ITEM_LENGTH)
}

async function getGroupEntries (selectWindowId) {
  const tabList = await tabs.query({})
  const firstTabByGroupId = new Map()
  for (const tab of sortTabsByWindowAndIndex(tabList)) {
    if (!isGroupedTab(tab) || firstTabByGroupId.has(tab.groupId)) {
      continue
    }
    firstTabByGroupId.set(tab.groupId, tab)
  }

  let groups = []
  if (typeof browser.tabGroups?.query === 'function') {
    groups = await browser.tabGroups.query({})
  } else {
    const knownGroupIds = new Set()
    for (const tab of tabList) {
      if (!isGroupedTab(tab) || knownGroupIds.has(tab.groupId)) {
        continue
      }
      knownGroupIds.add(tab.groupId)
      groups.push({
        id: tab.groupId,
        windowId: tab.windowId,
        incognito: tab.incognito === true,
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
    map((group) => {
      const firstTab = firstTabByGroupId.get(group.id)
      const entry = {
        type: 'group',
        groupId: group.id,
        windowId: group.windowId,
        incognito: firstTab
          ? firstTab.incognito === true
          : group.incognito === true,
        title: group.title,
        firstTabTitle: firstTab?.title || '',
      }
      return {
        ...entry,
        title: getGroupEntryTitle(entry),
      }
    })
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
      incognito: tab.incognito === true,
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

async function createDestinationMenuItems (entry, destinations, parentId,
  getMenuId) {
  for (const destination of destinations) {
    await createManagedMenuItem({
      id: getMenuId(entry.scope, entry.key, destination),
      title: destination.title,
      contexts: currentContexts,
      parentId,
      visible: false,
    })
  }
}

async function createStaticMenuItems (entries, destinations, contexts) {
  for (const entry of entries) {
    const entryMenuId = getEntryMenuId(entry.scope, entry.key)
    await createManagedMenuItem({
      id: entryMenuId,
      title: i18n.getMessage(entry.key),
      contexts,
      parentId: KEY_MOVE,
      visible: false,
    })
    await createDestinationMenuItems(entry, destinations, KEY_MOVE,
      getFlatDestinationMenuId)
    await createDestinationMenuItems(entry, destinations, entryMenuId,
      getDestinationMenuId)
  }
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

  currentContexts = contexts
  currentEntries = entries
  destinationEntries = destinations
  currentMenuItemIds = []

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
  await createStaticMenuItems(entries, getAllDestinations(), contexts)
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

async function waitForMenuRebuild () {
  if (rebuildMenuPromise) {
    await rebuildMenuPromise
  }
}

async function getTargetSummary (entry, targetTab) {
  if (entry.scope === KEY_TARGET_GROUP && !isGroupedTab(targetTab)) {
    return { valid: false }
  }

  if (entry.key === KEY_SELECT) {
    return {
      valid: true,
      sourceWindowId: targetTab.windowId,
      sourceIncognito: targetTab.incognito === true,
      groupIds: entry.scope === KEY_TARGET_GROUP
        ? new Set([targetTab.groupId])
        : new Set(),
      blockedGroupIds: entry.scope === KEY_TARGET_GROUP
        ? new Set([targetTab.groupId])
        : new Set(),
      groupTabCounts: new Map(),
      singleWholeGroup: false,
      targetTabCount: 0,
    }
  }

  const tabIds = await listTargetTabIds(targetTab.id, entry.key, entry.scope)
  if (tabIds.length <= 0) {
    return { valid: false }
  }

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
    sourceIncognito: targetTab.incognito === true,
    groupIds,
    blockedGroupIds: entry.scope === KEY_TARGET_GROUP
      ? new Set([targetTab.groupId])
      : new Set(),
    groupTabCounts,
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

  if (destination.incognito !== undefined &&
      destination.incognito !== summary.sourceIncognito) {
    return false
  }

  if (destination.type === 'newWindow') {
    return !(entry.scope === KEY_TARGET_GLOBAL && entry.key === KEY_ALL)
  }

  if (destination.type === 'window') {
    if (destination.windowId === selectWindowId) {
      return false
    }
    if (destination.windowId === summary.sourceWindowId) {
      return entry.scope === KEY_TARGET_GROUP
    }
    return true
  }

  if (typeof tabs.group !== 'function') {
    return false
  }

  if (destination.type === 'newGroup') {
    return !summary.singleWholeGroup &&
      !(entry.scope === KEY_TARGET_GROUP && entry.key === KEY_ALL)
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

async function updateDestinationMenuItems (entry, destinations, getMenuId) {
  for (const destination of destinations) {
    await updateMenuItem(getMenuId(entry.scope, entry.key, destination), {
      visible: true,
      title: destination.title,
    })
  }
}

async function renderCurrentMenuItems (targetTab, visibleEntries) {
  for (const id of currentMenuItemIds) {
    await updateMenuItem(id, { visible: false }).catch(onError)
  }

  if (visibleEntries.length === 1) {
    const { entry, destinations } = visibleEntries[0]
    await updateDestinationMenuItems(entry, destinations,
      getFlatDestinationMenuId)
    return
  }

  for (const { entry, destinations } of visibleEntries) {
    const entryMenuId = getEntryMenuId(entry.scope, entry.key)
    await updateMenuItem(entryMenuId, {
      visible: true,
      title: getEntryTitle(entry, targetTab),
    })
    await updateDestinationMenuItems(entry, destinations, getDestinationMenuId)
  }
}

async function handleMenuShown (info, tab) {
  await waitForMenuRebuild()
  const targetTab = tab || await getCurrentTab()
  if (!targetTab || currentContexts.length <= 0 || currentEntries.length <= 0) {
    return
  }

  const selectWindowId = getSelectWindowId()
  const destinations = getAllDestinations()
  const visibleEntries = []
  for (const entry of currentEntries) {
    const summary = await getTargetSummary(entry, targetTab)
    const visibleDestinations = destinations.filter((destination) => {
      return isDestinationVisible(entry, destination, summary, selectWindowId)
    })
    if (visibleDestinations.length > 0) {
      visibleEntries.push({
        entry,
        destinations: visibleDestinations,
      })
    }
  }

  await updateMenuItem(KEY_MOVE, {
    visible: visibleEntries.length > 0,
    title: visibleEntries.length === 1
      ? getSingleEntryMenuTitle(visibleEntries[0].entry, targetTab)
      : i18n.getMessage(KEY_MOVE),
  })
  await renderCurrentMenuItems(targetTab, visibleEntries)
  await menus.refresh()
}

async function handleMenuClick (info, tab) {
  await waitForMenuRebuild()
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
    }, notification, focus, () => queueRebuildMenu().catch(onError))
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
