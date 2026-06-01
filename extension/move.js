import {
  DEFAULT_SELECT_SAVE,
  DEFAULT_SELECT_SIZE,
  DEFAULT_PINNED_GROUP_ACTION,
  KEY_ALL,
  KEY_DESTINATION,
  KEY_FAILURE_MESSAGE,
  KEY_GROUP_ID,
  KEY_LEFT,
  KEY_MOVE,
  KEY_MOVING,
  KEY_ONE,
  KEY_PINNED_GROUP_ACTION,
  KEY_PINNED_GROUP_ASK,
  KEY_PINNED_GROUP_CANCEL,
  KEY_PINNED_GROUP_DECISION,
  KEY_PINNED_GROUP_SKIP,
  KEY_PINNED_GROUP_UNPIN,
  KEY_PROGRESS,
  KEY_RAW,
  KEY_RESET,
  KEY_REQUEST_ID,
  KEY_RIGHT,
  KEY_SELECT_SAVE,
  KEY_SELECT_SIZE,
  KEY_SOURCE_WINDOW_ID,
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
  normalizeDestination,
  normalizeFocus,
  normalizeInteger,
  normalizeNotification,
  normalizePinnedGroupAction,
  normalizeRequiredInteger,
  normalizeSelectSave,
  normalizeSelectSize,
  normalizeTargetScope,
  onError,
  storageArea,
} from './common.js'
import {
  buildTabUnits,
  buildTopLevelUnits,
  isGroupedTab,
  sortTabsByIndex,
} from './tab-units.js'

const {
  i18n,
  permissions,
  runtime,
  tabs,
  windows,
} = browser

let selectWindowId
let nextPinnedRequestId = 1
const pinnedConfirmations = new Map()

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

function normalizeSelectRequest (request) {
  return {
    fromWindowId: normalizeRequiredInteger(request.fromWindowId,
      'fromWindowId'),
    groupId: normalizeInteger(request.groupId),
    targetScope: normalizeTargetScope(request.targetScope),
    destination: normalizeDestination(request.destination),
  }
}

export async function select (
  request, notification, focus, onCreate) {
  const selectRequest = normalizeSelectRequest(request)

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

async function querySortedTabs (windowId) {
  return sortTabsByIndex(await tabs.query({ windowId }))
}

function getUnitTabIds (unit) {
  return unit.tabs.map((tab) => tab.id)
}

function getUnitLastTabId (unit) {
  return unit.tabs[unit.tabs.length - 1].id
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

function normalizeRunContext (context) {
  if (!context || typeof context !== 'object') {
    return {
      targetScope: KEY_TARGET_GLOBAL,
    }
  }

  return {
    targetScope: normalizeTargetScope(context[KEY_TARGET_SCOPE]),
    groupId: normalizeInteger(context[KEY_GROUP_ID]),
    sourceWindowId: normalizeInteger(context[KEY_SOURCE_WINDOW_ID]),
  }
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

async function ungroupTabIds (tabIds) {
  if (tabIds.length <= 0) {
    return
  }
  if (typeof tabs.ungroup !== 'function') {
    throw new Error('tabs.ungroup is unavailable')
  }

  await tabs.ungroup(tabIds.length === 1 ? tabIds[0] : tabIds)
  debug('Tabs ' + tabIds.join(',') + ' ungrouped')
}

async function getIndexAroundTabAfterRemoving (
  windowId, tabId, movingTabIdSet, position) {
  const tabList = await querySortedTabs(windowId)
  const referenceTab = tabList.find((tab) => tab.id === tabId)
  if (!referenceTab) {
    return -1
  }

  return tabList.filter((tab) => {
    if (movingTabIdSet.has(tab.id)) {
      return false
    }
    return position === 'before'
      ? tab.index < referenceTab.index
      : tab.index <= referenceTab.index
  }).length
}

async function runGroupUnitsWithSourceWindow (
  units, groupId, windowId, progress, focus) {
  const movingTabIds = getMovingTabIds(units)
  const movingTabIdSet = new Set(movingTabIds)
  const groupTabs = (await queryGroupTabs(groupId)).
    filter((tab) => tab.windowId === windowId)
  const selectedGroupTabIds = movingTabIds.
    filter((tabId) => groupTabs.some((tab) => tab.id === tabId))

  if (selectedGroupTabIds.length <= 0) {
    progress.done += movingTabIds.length
    return
  }

  const selectedGroupTabIdSet = new Set(selectedGroupTabIds)
  const allGroupTabsSelected = selectedGroupTabIds.length === groupTabs.length
  const selectedPositions = groupTabs.
    map((tab, index) => selectedGroupTabIdSet.has(tab.id) ? index : -1).
    filter((index) => index >= 0)
  const selectedPrefix = selectedPositions.
    every((position, index) => position === index)

  await ungroupTabIds(selectedGroupTabIds)

  if (!allGroupTabsSelected) {
    const remainingGroupTabs = (await queryGroupTabs(groupId)).
      filter((tab) => tab.windowId === windowId)
    const referenceTab = selectedPrefix
      ? remainingGroupTabs[0]
      : remainingGroupTabs[remainingGroupTabs.length - 1]
    const position = selectedPrefix ? 'before' : 'after'
    const index = referenceTab
      ? await getIndexAroundTabAfterRemoving(windowId, referenceTab.id,
        movingTabIdSet, position)
      : -1

    await moveTabIdsToWindow(selectedGroupTabIds, windowId, index)
    await ungroupTabIds(selectedGroupTabIds)
  }

  progress.done += selectedGroupTabIds.length
  await focusMovedUnit(windowId, units, focus)
}

function getMovingTabIds (units) {
  return flattenUnits(units).map((tab) => tab.id)
}

function filterDestinationGroupUnits (units, groupId) {
  return units.filter((unit) => {
    return !unit.tabs.every((tab) => tab.groupId === groupId)
  })
}

function getPinnedTabs (units) {
  return flattenUnits(units).filter((tab) => tab.pinned)
}

function filterPinnedTabsFromUnits (units) {
  const filtered = []
  for (const unit of units) {
    const unitTabs = unit.tabs.filter((tab) => !tab.pinned)
    if (unitTabs.length <= 0) {
      continue
    }
    filtered.push({
      ...unit,
      tabs: unitTabs,
    })
  }
  return filtered
}

async function unpinTabsInUnits (units) {
  for (const tab of getPinnedTabs(units)) {
    await tabs.update(tab.id, { pinned: false })
    tab.pinned = false
  }
}

function resolvePinnedConfirmation (requestId, decision) {
  const confirmation = pinnedConfirmations.get(requestId)
  if (!confirmation) {
    return
  }

  pinnedConfirmations.delete(requestId)
  confirmation.resolve(decision)
}

async function confirmPinnedGroupAction (pinnedCount) {
  const requestId = String(nextPinnedRequestId++)
  const params = new globalThis.URLSearchParams({
    [KEY_REQUEST_ID]: requestId,
    count: String(pinnedCount),
  })
  const url = runtime.getURL('pinned.html') + '?' + params.toString()

  const windowInfo = await windows.create({
    type: 'detached_panel',
    url,
    width: 520,
    height: 320,
  })

  return new Promise((resolve) => {
    pinnedConfirmations.set(requestId, {
      resolve,
      windowId: windowInfo.id,
    })
  })
}

async function getPinnedGroupAction (pinnedCount) {
  const storedAction = normalizePinnedGroupAction(
    await getValue(KEY_PINNED_GROUP_ACTION, DEFAULT_PINNED_GROUP_ACTION),
  )
  if (storedAction !== KEY_PINNED_GROUP_ASK) {
    return storedAction
  }

  const decision = await confirmPinnedGroupAction(pinnedCount)
  if (decision?.remember &&
      [KEY_PINNED_GROUP_SKIP, KEY_PINNED_GROUP_UNPIN].includes(
        decision.action,
      )) {
    await storageArea.set({
      [KEY_PINNED_GROUP_ACTION]: decision.action,
    })
  }
  return decision?.action || KEY_PINNED_GROUP_CANCEL
}

async function prepareUnitsForGroupMove (units) {
  const pinnedTabs = getPinnedTabs(units)
  if (pinnedTabs.length <= 0) {
    return units
  }

  const action = await getPinnedGroupAction(pinnedTabs.length)
  if (action === KEY_PINNED_GROUP_CANCEL) {
    return []
  }
  if (action === KEY_PINNED_GROUP_SKIP) {
    return filterPinnedTabsFromUnits(units)
  }
  if (action === KEY_PINNED_GROUP_UNPIN) {
    await unpinTabsInUnits(units)
    return units
  }

  return []
}

async function runWithGroup (units, groupId, progress, focus) {
  if (units.length <= 0) {
    return
  }

  if (typeof tabs.group !== 'function') {
    throw new Error('tabs.group is unavailable')
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

  await tabs.group({
    tabIds,
    createProperties: {
      windowId: toWindowId,
    },
  })
  progress.done += tabIds.length
  debug('Tabs ' + tabIds.join(',') + ' moved to a new group')
  await focusMovedUnit(toWindowId, units, focus)
}

async function buildSelectedUnits (tabIds, { preserveFullGroups = true } = {}) {
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
      if (preserveFullGroups &&
          unit.tabs.every((tab) => requestedIds.has(tab.id))) {
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

async function runRawInternal (
  tabIds, destination, progress, focus, context = {}) {
  const normalizedDestination = normalizeDestination(destination)
  const normalizedContext = normalizeRunContext(context)
  const selectedUnits = await buildSelectedUnits(tabIds, {
    preserveFullGroups: normalizedContext.targetScope !== KEY_TARGET_GROUP,
  })
  const destinationFilteredUnits = normalizedDestination.type === 'group'
    ? filterDestinationGroupUnits(selectedUnits, normalizedDestination.groupId)
    : selectedUnits
  const units = ['group', 'newGroup'].includes(normalizedDestination.type)
    ? await prepareUnitsForGroupMove(destinationFilteredUnits)
    : destinationFilteredUnits
  if (units.length <= 0) {
    progress.all = 0
    progress.target = 0
    return
  }

  const movingTabIds = getMovingTabIds(units)
  progress.all = movingTabIds.length
  progress.target = movingTabIds.length

  const groupScopeWindowMove = normalizedContext.targetScope ===
    KEY_TARGET_GROUP && ['window', 'newWindow'].includes(
    normalizedDestination.type,
  )
  const sourceWindowExtraction = groupScopeWindowMove &&
    normalizedDestination.type === 'window' &&
    normalizedDestination.windowId === normalizedContext.sourceWindowId &&
    normalizedContext.groupId !== undefined

  if (!sourceWindowExtraction) {
    await activateSourceWindows(flattenUnits(units), movingTabIds)
  }

  switch (normalizedDestination.type) {
    case 'window': {
      if (sourceWindowExtraction) {
        await runGroupUnitsWithSourceWindow(units, normalizedContext.groupId,
          normalizedDestination.windowId, progress, focus)
      } else {
        await runWithWindow(units, normalizedDestination.windowId, progress,
          focus)
        if (groupScopeWindowMove) {
          await ungroupTabIds(movingTabIds)
        }
      }
      break
    }
    case 'newWindow': {
      await runWithNewWindow(units, progress, focus)
      if (groupScopeWindowMove) {
        await ungroupTabIds(movingTabIds)
      }
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

export async function rawRun (
  tabIds, destination, notification, focus, context = {}) {
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
      normalizeFocus(focus), context)
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
    const targetTab = await tabs.get(tabId)
    const tabIds = await listTargetTabIds(tabId, keyType, targetScope)
    await rawRun(tabIds, destination, notification, focus, {
      [KEY_TARGET_SCOPE]: targetScope,
      [KEY_GROUP_ID]: targetScope === KEY_TARGET_GROUP
        ? targetTab?.groupId
        : undefined,
      [KEY_SOURCE_WINDOW_ID]: targetTab?.windowId,
    })
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
        message[KEY_DESTINATION],
        normalizeNotification(message.notification),
        normalizeFocus(message.focus), {
          [KEY_TARGET_SCOPE]: message[KEY_TARGET_SCOPE],
          [KEY_GROUP_ID]: message[KEY_GROUP_ID],
          [KEY_SOURCE_WINDOW_ID]: message[KEY_SOURCE_WINDOW_ID],
        })
      break
    }
    case KEY_PINNED_GROUP_DECISION: {
      resolvePinnedConfirmation(message[KEY_REQUEST_ID], {
        action: message.action,
        remember: message.remember === true,
      })
      break
    }
  }
}

runtime.onMessage.addListener((message) => {
  return handleInternalMessage(message).catch(onError)
})

windows.onRemoved?.addListener((windowId) => {
  for (const [requestId, confirmation] of pinnedConfirmations) {
    if (confirmation.windowId === windowId) {
      resolvePinnedConfirmation(requestId, {
        action: KEY_PINNED_GROUP_CANCEL,
        remember: false,
      })
    }
  }
})
