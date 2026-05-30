import {
  BULK_SIZE,
  DEFAULT_SELECT_SAVE,
  DEFAULT_SELECT_SIZE,
  KEY_ALL,
  KEY_FAILURE_MESSAGE,
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

export async function select (
  fromWindowId, toWindowId, notification, focus, onCreate) {
  function resetWindow () {
    runtime.sendMessage({
      type: KEY_RESET,
      fromWindowId,
      toWindowId,
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

async function moveTarget (tabIds, toWindowId, index, focus) {
  if (tabIds.length <= 0) {
    return []
  }

  const moved = await tabs.move(
    tabIds.length === 1 ? tabIds[0] : tabIds,
    { windowId: toWindowId, index },
  )
  const movedTabs = Array.isArray(moved) ? moved : [moved]
  if (focus && movedTabs.length > 0) {
    await windows.update(toWindowId, { focused: true })
    await tabs.update(movedTabs[movedTabs.length - 1].id, { active: true })
  }
  debug('Tabs ' + tabIds.join(',') + ' moved to window ' + toWindowId +
    ' index ' + index)
  return movedTabs
}

async function runWithWindow (
  pinnedTabIds, unpinnedTabIds, toWindowId, progress, focus) {
  async function runBatch (target, index, batchFocus) {
    await moveTarget(target, toWindowId, index, batchFocus)
    progress.done += target.length
  }

  if (pinnedTabIds.length > 0) {
    const index = await searchLastPinnedIndex(toWindowId) + 1
    for (let i = pinnedTabIds.length; i > 0; i -= BULK_SIZE) {
      const target = pinnedTabIds.slice(Math.max(i - BULK_SIZE, 0), i)
      await runBatch(target, index, focus && unpinnedTabIds.length === 0)
    }
  }

  if (unpinnedTabIds.length > 0) {
    for (let i = 0; i < unpinnedTabIds.length; i += BULK_SIZE) {
      const target = unpinnedTabIds.slice(i, i + BULK_SIZE)
      await runBatch(target, -1, focus)
    }
  }
}

async function runWithNewWindow (pinnedTabIds, unpinnedTabIds, progress, focus) {
  let target
  let index
  let nextPinnedTabIds
  let nextUnpinnedTabIds
  if (pinnedTabIds.length > 0) {
    target = pinnedTabIds.slice(0, BULK_SIZE)
    index = 0
    nextPinnedTabIds = pinnedTabIds.slice(target.length)
    nextUnpinnedTabIds = unpinnedTabIds
  } else {
    target = unpinnedTabIds.slice(0, BULK_SIZE)
    index = -1
    nextPinnedTabIds = pinnedTabIds
    nextUnpinnedTabIds = unpinnedTabIds.slice(target.length)
  }

  const windowInfo = await windows.create()
  const placeholderTabIds = windowInfo.tabs.map((tab) => tab.id)
  await moveTarget(target, windowInfo.id, index, focus)
  await tabs.remove(placeholderTabIds)

  progress.done += target.length
  await runWithWindow(nextPinnedTabIds, nextUnpinnedTabIds, windowInfo.id,
    progress, focus)
}

async function runRawInternal (tabIds, toWindowId, progress, focus) {
  if (tabIds.length <= 0) {
    return
  }

  const tabInfos = []
  const pinnedTabIds = []
  const unpinnedTabIds = []
  for (const tabId of tabIds) {
    const tab = await tabs.get(tabId)
    tabInfos.push(tab)
    if (tab.pinned) {
      pinnedTabIds.push(tabId)
    } else {
      unpinnedTabIds.push(tabId)
    }
  }

  await activateSourceWindows(tabInfos, tabIds)

  if (toWindowId) {
    await runWithWindow(pinnedTabIds, unpinnedTabIds, toWindowId, progress,
      focus)
  } else {
    await runWithNewWindow(pinnedTabIds, unpinnedTabIds, progress, focus)
  }
}

export async function listTargetTabIds (tabId, keyType) {
  if (keyType === KEY_ONE) {
    return [tabId]
  }

  const tab = await tabs.get(tabId)
  let tabList = await tabs.query({ windowId: tab.windowId })

  switch (keyType) {
    case KEY_RIGHT: {
      tabList = tabList.filter((tab2) => tab2.index > tab.index)
      break
    }
    case KEY_THIS_AND_RIGHT: {
      tabList = tabList.filter((tab2) => tab2.index >= tab.index)
      break
    }
    case KEY_LEFT: {
      tabList = tabList.filter((tab2) => tab2.index < tab.index)
      break
    }
    case KEY_THIS_AND_LEFT: {
      tabList = tabList.filter((tab2) => tab2.index <= tab.index)
      break
    }
    case KEY_ALL: {
      break
    }
    default: {
      throw new Error('Unsupported keyType: ' + keyType)
    }
  }

  tabList.sort((tab1, tab2) => tab1.index - tab2.index)
  return tabList.map((tab2) => tab2.id)
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

export async function rawRun (tabIds, toWindowId, notification, focus) {
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

    await runRawInternal(targetTabIds, toWindowId, progress,
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

export async function run (tabId, keyType, toWindowId, notification, focus) {
  try {
    const tabIds = await listTargetTabIds(tabId, keyType)
    await rawRun(tabIds, toWindowId, notification, focus)
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
      await rawRun(message.tabIds, message.toWindowId,
        normalizeNotification(message.notification),
        normalizeFocus(message.focus))
      break
    }
  }
}

runtime.onMessage.addListener((message) => {
  return handleInternalMessage(message).catch(onError)
})
