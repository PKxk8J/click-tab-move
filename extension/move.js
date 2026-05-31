import {
  DEFAULT_SELECT_SAVE,
  DEFAULT_SELECT_SIZE,
  KEY_ALL,
  KEY_DESTINATION,
  KEY_FAILURE_MESSAGE,
  KEY_GROUP_ID,
  KEY_LEFT,
  KEY_MOVE,
  KEY_MOVING,
  KEY_ONE,
  KEY_PROGRESS,
  KEY_RAW,
  KEY_RESET,
  KEY_RIGHT,
  KEY_SELECT_SAVE,
  KEY_SELECT_SIZE,
  KEY_SUCCESS_MESSAGE,
  KEY_TARGET_GLOBAL,
  KEY_TARGET_GROUP,
  KEY_TARGET_SCOPE,
  KEY_THIS_AND_LEFT,
  KEY_THIS_AND_RIGHT,
  NOTIFICATION_ID,
  NOTIFICATION_INTERVAL,
  NOTIFICATION_PERMISSION,
  POLLING_INTERVAL,
  asleep,
  debug,
  getValue,
  normalizeFocus,
  normalizeNotification,
  normalizeSelectSave,
  normalizeSelectSize,
  onError,
  storageArea,
} from './common.js'

const {
  i18n,
  permissions,
  runtime,
  tabs,
  windows,
} = browser

let selectWindowId

export function getSelectWindowId () {
  return selectWindowId
}

async function waitSelectWindowReady (tabId) {
  while (true) {
    const tab = await tabs.get(tabId)
    if (tab.url.endsWith('/select.html') && tab.status === 'complete') {
      return
    }
    debug('Waiting select window...')
    await asleep(POLLING_INTERVAL)
  }
}

function normalizeSelectRequest (request, toWindowId) {
  if (request && typeof request === 'object') {
    return {
      fromWindowId: request.fromWindowId,
      groupId: request.groupId,
      targetScope: request.targetScope || KEY_TARGET_GLOBAL,
      destination: request.destination,
    }
  }

  return {
    fromWindowId: request,
    targetScope: KEY_TARGET_GLOBAL,
    destination: toWindowId === undefined
      ? { type: 'newWindow' }
      : { type: 'window', windowId: toWindowId },
  }
}

export async function select (
  request, toWindowId, notification, focus, onCreate) {
  const selectRequest = normalizeSelectRequest(request, toWindowId)

  function resetWindow () {
    runtime.sendMessage({
      type: KEY_RESET,
      fromWindowId: selectRequest.fromWindowId,
      [KEY_GROUP_ID]: selectRequest.groupId,
      [KEY_TARGET_SCOPE]: selectRequest.targetScope,
      [KEY_DESTINATION]: selectRequest.destination,
      notification,
      focus,
    })
  }

  async function createSelectWindow () {
    const [width, height] = normalizeSelectSize(
      await getValue(KEY_SELECT_SIZE, DEFAULT_SELECT_SIZE),
    )
    const windowInfo = await windows.create({
      type: 'detached_panel',
      url: runtime.getURL('select.html'),
      width,
      height,
    })
    debug('Select window was created')
    selectWindowId = windowInfo.id
    if (onCreate) {
      onCreate(selectWindowId)
    }

    await waitSelectWindowReady(windowInfo.tabs[0].id)
    resetWindow()
  }

  if (!selectWindowId) {
    await createSelectWindow()
    return
  }

  try {
    await windows.get(selectWindowId)
  } catch (error) {
    debug(error)
    await createSelectWindow()
    return
  }

  debug('Reuse select window')
  resetWindow()
}

async function searchLastPinnedIndex (windowId) {
  const pinnedTabList = await tabs.query({ windowId, pinned: true })
  let lastIndex = -1
  for (const pinnedTab of pinnedTabList) {
    if (pinnedTab.index > lastIndex) {
      lastIndex = pinnedTab.index
    }
  }
  return lastIndex
}

function getNoGroupId () {
  return browser.tabGroups?.TAB_GROUP_ID_NONE ?? -1
}

function getNoSplitViewId () {
  return tabs.SPLIT_VIEW_ID_NONE ?? -1
}

function isGroupedTab (tab) {
  return tab.groupId !== undefined && tab.groupId !== getNoGroupId()
}

function isSplitViewTab (tab) {
  return tab.splitViewId !== undefined &&
    tab.splitViewId !== getNoSplitViewId()
}

function sortTabsByIndex (tabList) {
  return [...tabList].sort((tab1, tab2) => tab1.index - tab2.index)
}

async function querySortedTabs (windowId) {
  return sortTabsByIndex(await tabs.query({ windowId }))
}

function getUnitTabIds (unit) {
  return unit.tabs.map((tab) => tab.id)
}

function getUnitLastTabId (unit) {
  return unit.tabs[unit.tabs.length - 1].id
}

function makeTabUnit (tab) {
  return {
    id: 'tab:' + tab.id,
    type: 'tab',
    tabs: [tab],
  }
}

function makeSplitViewUnit (tabList, startIndex) {
  const splitViewId = tabList[startIndex].splitViewId
  const unitTabs = []
  let index = startIndex
  for (; index < tabList.length; index++) {
    if (tabList[index].splitViewId !== splitViewId) {
      break
    }
    unitTabs.push(tabList[index])
  }

  return {
    nextIndex: index,
    unit: {
      id: 'splitView:' + splitViewId + ':' + unitTabs[0].id,
      type: 'splitView',
      splitViewId,
      tabs: unitTabs,
    },
  }
}

function buildTabUnits (tabList) {
  const units = []
  const sortedTabs = sortTabsByIndex(tabList)
  for (let i = 0; i < sortedTabs.length;) {
    const tab = sortedTabs[i]
    if (isSplitViewTab(tab)) {
      const { unit, nextIndex } = makeSplitViewUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    units.push(makeTabUnit(tab))
    i++
  }
  return units
}

function makeGroupUnit (tabList, startIndex) {
  const groupId = tabList[startIndex].groupId
  const groupTabs = []
  let index = startIndex
  for (; index < tabList.length; index++) {
    if (tabList[index].groupId !== groupId) {
      break
    }
    groupTabs.push(tabList[index])
  }

  return {
    nextIndex: index,
    unit: {
      id: 'group:' + groupId,
      type: 'group',
      groupId,
      tabs: groupTabs,
      units: buildTabUnits(groupTabs),
    },
  }
}

function buildTopLevelUnits (tabList) {
  const units = []
  const sortedTabs = sortTabsByIndex(tabList)
  for (let i = 0; i < sortedTabs.length;) {
    const tab = sortedTabs[i]
    if (isGroupedTab(tab)) {
      const { unit, nextIndex } = makeGroupUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    if (isSplitViewTab(tab)) {
      const { unit, nextIndex } = makeSplitViewUnit(sortedTabs, i)
      units.push(unit)
      i = nextIndex
      continue
    }

    units.push(makeTabUnit(tab))
    i++
  }
  return units
}

function findUnitIndex (units, tabId) {
  return units.findIndex((unit) => unit.tabs.some((tab) => tab.id === tabId))
}

function selectUnitsByKey (units, unitIndex, keyType) {
  switch (keyType) {
    case KEY_ONE: {
      return units.slice(unitIndex, unitIndex + 1)
    }
    case KEY_RIGHT: {
      return units.slice(unitIndex + 1)
    }
    case KEY_THIS_AND_RIGHT: {
      return units.slice(unitIndex)
    }
    case KEY_LEFT: {
      return units.slice(0, unitIndex)
    }
    case KEY_THIS_AND_LEFT: {
      return units.slice(0, unitIndex + 1)
    }
    case KEY_ALL: {
      return units
    }
    default: {
      throw new Error('Unsupported keyType: ' + keyType)
    }
  }
}

function flattenUnits (units) {
  return units.flatMap((unit) => unit.tabs)
}

function hasPinnedUnit (units) {
  return units.some((unit) => unit.tabs.some((tab) => tab.pinned))
}

function splitUnitsByPinned (units) {
  const pinnedUnits = []
  const unpinnedUnits = []
  for (const unit of units) {
    if (unit.tabs.some((tab) => tab.pinned)) {
      pinnedUnits.push(unit)
    } else {
      unpinnedUnits.push(unit)
    }
  }
  return { pinnedUnits, unpinnedUnits }
}

function normalizeDestination (destination) {
  if (destination && typeof destination === 'object') {
    if (destination.type === 'newWindow') {
      return { type: 'newWindow' }
    }
    if (destination.type === 'window') {
      const windowId = Number(destination.windowId)
      if (Number.isInteger(windowId)) {
        return { type: 'window', windowId }
      }
    }
    if (destination.type === 'newGroup') {
      return { type: 'newGroup' }
    }
    if (destination.type === 'group') {
      const groupId = Number(destination.groupId)
      if (Number.isInteger(groupId)) {
        return { type: 'group', groupId }
      }
    }
    throw new Error('Unsupported destination: ' + JSON.stringify(destination))
  }

  if (destination === undefined) {
    return { type: 'newWindow' }
  }

  const windowId = Number(destination)
  if (Number.isInteger(windowId)) {
    return { type: 'window', windowId }
  }
  throw new Error('Unsupported destination: ' + destination)
}

async function activateBest (windowId, excludedTabIds) {
  const moveTabIdSet = new Set(excludedTabIds)
  const tabList = await tabs.query({ windowId })

  let activeTab
  let lastTab
  const keepTabs = []
  for (const tab of tabList) {
    const move = moveTabIdSet.has(tab.id)

    if (tab.active) {
      if (!move) {
        return
      }
      activeTab = tab
    }
    if (!lastTab || tab.index > lastTab.index) {
      lastTab = tab
    }
    if (!move) {
      keepTabs.push(tab)
    }
  }

  if (!activeTab || !lastTab) {
    return
  }

  let nextTab
  let prevTab
  for (const tab of keepTabs) {
    if (tab.index < activeTab.index) {
      if (!prevTab || tab.index > prevTab.index) {
        prevTab = tab
      }
    } else if (!nextTab || tab.index < nextTab.index) {
      nextTab = tab
    }
  }

  const bestTab = nextTab || prevTab || lastTab
  if (bestTab === activeTab || activeTab.index + 1 === bestTab.index) {
    return
  }

  await tabs.update(bestTab.id, { active: true })
  debug('Activated tab ' + bestTab.id)
}

async function activateSourceWindows (tabInfos, movingTabIds) {
  const windowToMovingIds = new Map()
  for (const tab of tabInfos) {
    if (!windowToMovingIds.has(tab.windowId)) {
      windowToMovingIds.set(tab.windowId, [])
    }
    windowToMovingIds.get(tab.windowId).push(tab.id)
  }

  const activeWindowIds = new Set(tabInfos.
    filter((tab) => tab.active).
    map((tab) => tab.windowId))
  for (const windowId of activeWindowIds) {
    await activateBest(windowId, windowToMovingIds.get(windowId) || movingTabIds)
  }
}

async function moveTabIdsToWindow (tabIds, toWindowId, index) {
  if (tabIds.length <= 0) {
    return []
  }

  const moved = await tabs.move(
    tabIds.length === 1 ? tabIds[0] : tabIds,
    { windowId: toWindowId, index },
  )
  const movedTabs = Array.isArray(moved) ? moved : [moved]
  debug('Tabs ' + tabIds.join(',') + ' moved to window ' + toWindowId +
    ' index ' + index)
  return movedTabs
}

async function moveUnitToWindow (unit, toWindowId, index) {
  if (unit.type === 'group' &&
      typeof browser.tabGroups?.move === 'function') {
    await browser.tabGroups.move(unit.groupId, { windowId: toWindowId, index })
    debug('Group ' + unit.groupId + ' moved to window ' + toWindowId +
      ' index ' + index)
    return
  }

  await moveTabIdsToWindow(getUnitTabIds(unit), toWindowId, index)
}

async function focusMovedUnit (windowId, units, focus) {
  if (!focus || units.length <= 0) {
    return
  }

  await windows.update(windowId, { focused: true })
  await tabs.update(getUnitLastTabId(units[units.length - 1]), { active: true })
}

async function getWindowEndIndex (windowId) {
  return (await tabs.query({ windowId })).length
}

async function runWithWindow (units, toWindowId, progress, focus) {
  const { pinnedUnits, unpinnedUnits } = splitUnitsByPinned(units)

  if (pinnedUnits.length > 0) {
    const index = await searchLastPinnedIndex(toWindowId) + 1
    for (let i = pinnedUnits.length - 1; i >= 0; i--) {
      const unit = pinnedUnits[i]
      await moveUnitToWindow(unit, toWindowId, index)
      progress.done += unit.tabs.length
    }
  }

  for (const unit of unpinnedUnits) {
    const index = unit.type === 'group'
      ? await getWindowEndIndex(toWindowId)
      : -1
    await moveUnitToWindow(unit, toWindowId, index)
    progress.done += unit.tabs.length
  }

  await focusMovedUnit(toWindowId, units, focus)
}

async function runWithNewWindow (units, progress, focus) {
  const windowInfo = await windows.create()
  const placeholderTabIds = windowInfo.tabs.map((tab) => tab.id)
  await runWithWindow(units, windowInfo.id, progress, false)
  await tabs.remove(placeholderTabIds)

  await focusMovedUnit(windowInfo.id, units, focus)
}

async function queryGroupTabs (groupId) {
  const tabList = await tabs.query({})
  return sortTabsByIndex(tabList.filter((tab) => tab.groupId === groupId))
}

function getMovingTabIds (units) {
  return flattenUnits(units).map((tab) => tab.id)
}

async function runWithGroup (units, groupId, progress, focus) {
  if (hasPinnedUnit(units)) {
    throw new Error('Pinned tabs cannot be moved to a group')
  }
  if (typeof tabs.group !== 'function') {
    throw new Error('tabs.group is unavailable')
  }
  if (units.some((unit) => unit.tabs.some((tab) => tab.groupId === groupId))) {
    throw new Error('Cannot move tabs to their current group')
  }

  const groupTabs = await queryGroupTabs(groupId)
  if (groupTabs.length <= 0) {
    throw new Error('Group not found: ' + groupId)
  }

  const tabIds = getMovingTabIds(units)
  const toWindowId = groupTabs[0].windowId
  const index = groupTabs[groupTabs.length - 1].index + 1
  await moveTabIdsToWindow(tabIds, toWindowId, index)
  await tabs.group({ tabIds, groupId })
  progress.done += tabIds.length
  debug('Tabs ' + tabIds.join(',') + ' moved to group ' + groupId)
  await focusMovedUnit(toWindowId, units, focus)
}

async function runWithNewGroup (units, progress, focus) {
  if (hasPinnedUnit(units)) {
    throw new Error('Pinned tabs cannot be moved to a group')
  }
  if (typeof tabs.group !== 'function') {
    throw new Error('tabs.group is unavailable')
  }

  const tabIds = getMovingTabIds(units)
  const toWindowId = units[0].tabs[0].windowId
  if (units.some((unit) => unit.tabs.some((tab) => tab.windowId !== toWindowId))) {
    await moveTabIdsToWindow(tabIds, toWindowId, await getWindowEndIndex(
      toWindowId,
    ))
  }

  await tabs.group({ tabIds })
  progress.done += tabIds.length
  debug('Tabs ' + tabIds.join(',') + ' moved to a new group')
  await focusMovedUnit(toWindowId, units, focus)
}

async function buildSelectedUnits (tabIds) {
  const tabInfos = []
  const windowIds = []
  const knownWindowIds = new Set()
  for (const tabId of tabIds) {
    const tab = await tabs.get(tabId)
    if (!tab) {
      continue
    }
    tabInfos.push(tab)
    if (!knownWindowIds.has(tab.windowId)) {
      knownWindowIds.add(tab.windowId)
      windowIds.push(tab.windowId)
    }
  }

  const units = []
  for (const windowId of windowIds) {
    const requestedIds = new Set(tabInfos.
      filter((tab) => tab.windowId === windowId).
      map((tab) => tab.id))
    const topLevelUnits = buildTopLevelUnits(await querySortedTabs(windowId))
    for (const unit of topLevelUnits) {
      if (unit.tabs.every((tab) => requestedIds.has(tab.id))) {
        units.push(unit)
        continue
      }

      if (unit.type !== 'group') {
        if (unit.tabs.some((tab) => requestedIds.has(tab.id))) {
          units.push(unit)
        }
        continue
      }

      for (const childUnit of unit.units) {
        if (childUnit.tabs.some((tab) => requestedIds.has(tab.id))) {
          units.push(childUnit)
        }
      }
    }
  }
  return units
}

async function getTargetUnits (tabId, keyType, targetScope) {
  const targetTab = await tabs.get(tabId)
  if (!targetTab) {
    return []
  }

  if (targetScope === KEY_TARGET_GROUP) {
    if (!isGroupedTab(targetTab)) {
      return []
    }
    const units = buildTabUnits((await querySortedTabs(targetTab.windowId)).
      filter((tab) => tab.groupId === targetTab.groupId))
    const unitIndex = findUnitIndex(units, tabId)
    return unitIndex < 0 ? [] : selectUnitsByKey(units, unitIndex, keyType)
  }

  if (targetScope !== KEY_TARGET_GLOBAL) {
    throw new Error('Unsupported target scope: ' + targetScope)
  }

  const units = buildTopLevelUnits(await querySortedTabs(targetTab.windowId))
  const unitIndex = findUnitIndex(units, tabId)
  return unitIndex < 0 ? [] : selectUnitsByKey(units, unitIndex, keyType)
}

async function runRawInternal (tabIds, destination, progress, focus) {
  const units = await buildSelectedUnits(tabIds)
  if (units.length <= 0) {
    return
  }

  const movingTabIds = getMovingTabIds(units)
  progress.all = movingTabIds.length
  progress.target = movingTabIds.length

  await activateSourceWindows(flattenUnits(units), movingTabIds)

  const normalizedDestination = normalizeDestination(destination)
  switch (normalizedDestination.type) {
    case 'window': {
      await runWithWindow(units, normalizedDestination.windowId, progress, focus)
      break
    }
    case 'newWindow': {
      await runWithNewWindow(units, progress, focus)
      break
    }
    case 'group': {
      await runWithGroup(units, normalizedDestination.groupId, progress, focus)
      break
    }
    case 'newGroup': {
      await runWithNewGroup(units, progress, focus)
      break
    }
  }
}

export async function listTargetTabIds (
  tabId, keyType, targetScope = KEY_TARGET_GLOBAL) {
  return getMovingTabIds(await getTargetUnits(tabId, keyType, targetScope))
}

function normalizeTabIds (tabIds) {
  if (!Array.isArray(tabIds)) {
    return []
  }

  const normalized = []
  const knownIds = new Set()
  for (const tabId of tabIds) {
    const id = Number(tabId)
    if (!Number.isInteger(id) || knownIds.has(id)) {
      continue
    }
    knownIds.add(id)
    normalized.push(id)
  }
  return normalized
}

function startProgressNotification (progress) {
  let timerId
  let stopped = false

  const tick = () => {
    timerId = setTimeout(() => {
      if (stopped || progress.end || progress.error) {
        return
      }
      tryNotify(progress).then((notified) => {
        if (notified && !stopped) {
          tick()
        }
      }).catch(onError)
    }, NOTIFICATION_INTERVAL)
  }

  tick()
  return () => {
    stopped = true
    globalThis.clearTimeout(timerId)
  }
}

function getNotificationOptions (progress) {
  let message
  if (progress.error) {
    message = i18n.getMessage(KEY_FAILURE_MESSAGE, progress.error)
  } else if (progress.end) {
    const seconds = (progress.end - progress.start) / 1000
    message = i18n.getMessage(KEY_SUCCESS_MESSAGE,
      [seconds, progress.all, progress.done])
  } else if (progress.start && progress.target) {
    const seconds = (new Date() - progress.start) / 1000
    const percentage = Math.floor(progress.done * 100 / progress.target)
    message = i18n.getMessage(KEY_PROGRESS, [seconds, percentage])
  } else {
    message = i18n.getMessage(KEY_MOVING)
  }
  return {
    type: 'basic',
    title: NOTIFICATION_ID,
    message,
  }
}

async function notify (progress) {
  await browser.notifications.create(NOTIFICATION_ID,
    getNotificationOptions(progress))
}

async function tryNotify (progress) {
  try {
    await notify(progress)
    return true
  } catch (error) {
    onError(error)
    return false
  }
}

export async function rawRun (tabIds, destination, notification, focus) {
  const targetTabIds = normalizeTabIds(tabIds)
  const progress = {
    all: targetTabIds.length,
    target: targetTabIds.length,
    done: 0,
  }
  let notifyEnabled = false
  let stopProgressNotification
  try {
    const notificationsApi = browser.notifications
    notifyEnabled = normalizeNotification(notification) &&
      typeof notificationsApi?.create === 'function' &&
      await permissions.contains(NOTIFICATION_PERMISSION)
    if (notifyEnabled) {
      progress.start = new Date()
      stopProgressNotification = startProgressNotification(progress)
    }

    await runRawInternal(targetTabIds, destination, progress,
      normalizeFocus(focus))
    debug('Finished')

    if (notifyEnabled) {
      progress.end = new Date()
      stopProgressNotification?.()
      stopProgressNotification = undefined
      await tryNotify(progress)
    }
  } catch (error) {
    onError(error)
    if (notifyEnabled) {
      progress.error = error
      stopProgressNotification?.()
      stopProgressNotification = undefined
      await tryNotify(progress)
    }
  } finally {
    stopProgressNotification?.()
  }
}

export async function run (
  tabId, keyType, destination, notification, focus,
  targetScope = KEY_TARGET_GLOBAL) {
  try {
    const tabIds = await listTargetTabIds(tabId, keyType, targetScope)
    await rawRun(tabIds, destination, notification, focus)
  } catch (error) {
    onError(error)
  }
}

async function handleInternalMessage (message) {
  debug('Message ' + JSON.stringify(message) + ' was received')
  switch (message.type) {
    case KEY_SELECT_SIZE: {
      const selectSave = normalizeSelectSave(
        await getValue(KEY_SELECT_SAVE, DEFAULT_SELECT_SAVE),
      )
      if (!selectSave) {
        break
      }
      await storageArea.set({
        [KEY_SELECT_SIZE]: normalizeSelectSize(message.selectSize),
      })
      break
    }
    case KEY_MOVE: {
      if (message.keyType !== KEY_RAW) {
        break
      }
      await rawRun(message.tabIds,
        message[KEY_DESTINATION] ?? message.toWindowId,
        normalizeNotification(message.notification),
        normalizeFocus(message.focus))
      break
    }
  }
}

runtime.onMessage.addListener((message) => {
  return handleInternalMessage(message).catch(onError)
})
