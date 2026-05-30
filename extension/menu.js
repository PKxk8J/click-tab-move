import {
  ALL_MENU_ITEMS,
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_ALL,
  KEY_CONTEXTS,
  KEY_FOCUS,
  KEY_MENU_ITEMS,
  KEY_MOVE,
  KEY_MOVE_X,
  KEY_NEW_WINDOW,
  KEY_NOTIFICATION,
  KEY_SELECT,
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
let currentMenuKeys = []
let destinationEntries = []

function cut (text, length) {
  if (text.length <= length) {
    return text
  }
  return text.substring(0, length) + '...'
}

function getKeyMenuId (key) {
  return 'key:' + key
}

function getNewWindowMenuId (key) {
  return 'target:' + key + ':new'
}

function getWindowMenuId (key, windowId) {
  return 'target:' + key + ':window:' + windowId
}

function parseTargetMenuId (id) {
  const parts = id.split(':')
  if (parts.length < 3 || parts[0] !== 'target') {
    return
  }

  const key = parts[1]
  if (!ALL_MENU_ITEMS.includes(key)) {
    return
  }

  if (parts[2] === 'new' && parts.length === 3) {
    return { key, toWindowId: undefined }
  }

  if (parts[2] !== 'window' || parts.length !== 4) {
    return
  }

  const toWindowId = Number(parts[3])
  if (!Number.isInteger(toWindowId)) {
    return
  }
  return { key, toWindowId }
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

async function getDestinationEntries () {
  const selectWindowId = getSelectWindowId()
  const activeTabs = await tabs.query({ active: true })
  return activeTabs.
    filter((tab) => tab.windowId !== selectWindowId).
    sort((tab1, tab2) => tab1.windowId - tab2.windowId).
    map((tab) => ({
      windowId: tab.windowId,
      title: cut(tab.windowId + ': ' + tab.title, ITEM_LENGTH),
    }))
}

function getKeyTitle (key, flat) {
  if (flat) {
    return i18n.getMessage(KEY_MOVE_X, i18n.getMessage(key))
  }
  return i18n.getMessage(key)
}

async function rebuildMenu () {
  const [storedContexts, storedMenuItems] = await Promise.all([
    getValue(KEY_CONTEXTS),
    getValue(KEY_MENU_ITEMS),
  ])
  const contexts = normalizeContexts(storedContexts)
  const menuKeys = normalizeMenuItems(storedMenuItems)
  const entries = await getDestinationEntries()

  currentMenuKeys = menuKeys
  destinationEntries = entries

  await menus.removeAll()
  debug('Clear menu items')

  if (contexts.length <= 0 || menuKeys.length <= 0) {
    return
  }

  const nested = menuKeys.length > 1
  if (nested) {
    await createMenuItem({
      id: KEY_MOVE,
      title: i18n.getMessage(KEY_MOVE),
      contexts,
    })
  }

  for (const key of menuKeys) {
    const keyMenuId = getKeyMenuId(key)
    await createMenuItem({
      id: keyMenuId,
      title: getKeyTitle(key, !nested),
      contexts,
      parentId: nested ? KEY_MOVE : undefined,
    })

    if (key !== KEY_ALL) {
      await createMenuItem({
        id: getNewWindowMenuId(key),
        title: i18n.getMessage(KEY_NEW_WINDOW),
        contexts,
        parentId: keyMenuId,
      })
    }

    for (const entry of entries) {
      await createMenuItem({
        id: getWindowMenuId(key, entry.windowId),
        title: entry.title,
        contexts,
        parentId: keyMenuId,
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

async function handleMenuShown (info, tab) {
  const targetTab = tab || await getCurrentTab()
  if (!targetTab) {
    return
  }

  const selectWindowId = getSelectWindowId()
  const updates = []
  for (const key of currentMenuKeys) {
    for (const entry of destinationEntries) {
      updates.push(updateMenuItem(getWindowMenuId(key, entry.windowId), {
        visible: entry.windowId !== targetTab.windowId &&
          entry.windowId !== selectWindowId,
      }).catch(onError))
    }
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
    await select(targetTab.windowId, target.toWindowId, notification, focus,
      () => queueRebuildMenu().catch(onError))
    return
  }

  await run(targetTab.id, target.key, target.toWindowId, notification, focus)
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
  if (tab.active && changeInfo.title) {
    return queueRebuildMenu().catch(onError)
  }
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

menus.onClicked.addListener((info, tab) => {
  return handleMenuClick(info, tab).catch(onError)
})

menus.onShown.addListener((info, tab) => {
  return handleMenuShown(info, tab).catch(onError)
})

queueRebuildMenu().catch(onError)
