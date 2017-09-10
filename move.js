'use strict'

const { contextMenus, i18n, notifications, runtime, storage, tabs, windows } = browser
const storageArea = storage.sync

const KEY_DEBUG = 'debug'

const KEY_ONE = 'one'
const KEY_RIGHT = 'right'
const KEY_LEFT = 'left'
const KEY_ALL = 'all'
const KEY_SELECT = 'select'

const KEY_MENU_ITEM = 'menuItem'
const KEY_SELECT_SIZE = 'selectSize'
const KEY_SELECT_SAVE = 'selectSave'
const KEY_NOTIFICATION = 'notification'

const KEY_MOVE = 'move'
const KEY_MOVE_X = 'moveX'
const KEY_NEW_WINDOW = 'newWindow'

const KEY_NAME = 'name'
const KEY_MOVING = 'moving'
const KEY_SUCCESS_MESSAGE = 'successMessage'
const KEY_FAILURE_MESSAGE = 'failureMessage'

const DEFAULT_MENU_ITEM = [KEY_ONE, KEY_RIGHT, KEY_ALL]
const DEFAULT_SELECT_SIZE = [640, 480]
const DEFAULT_SELECT_SAVE = true
const DEFAULT_NOTIFICATION = false

const NOTIFICATION_ID = i18n.getMessage(KEY_NAME)

const SEP = '_'
const ITEM_LENGTH = 64

const POLLING_INTERVAL = 300

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error(error)
}

// 設定値を取得する
async function getValue (key, defaultValue) {
  const {
    [key]: value = defaultValue
  } = await storageArea.get(key)
  return value
}

// てきとうな長さで打ち切る
function cut (text, length) {
  if (text.length <= length) {
    return text
  }
  return text.substring(0, length) + '...'
}

// 右クリックメニューに項目を追加する
function addMenuItem (id, title, parentId) {
  contextMenus.create({
    id,
    title,
    contexts: ['tab'],
    parentId
  }, () => {
    if (runtime.lastError) {
      onError(runtime.lastError)
    } else {
      debug('Added ' + title + ' menu item')
    }
  })
}

let menuKeys = []

// タブ選択ウインドウ
// タブ選択ウインドウは1つとする
let selectWindowId

// info ウインドウ情報
// info.tab アクティブなタブの ID
// info.title アクティブなタブのタイトル

// ウインドウ ID からウインドウ情報
const windowToInfo = new Map()
// タブ ID からウインドウ ID
const tabToWindow = new Map()

let focusedWindowId

// メニューアイテムを追加する
function addItem (windowId, title) {
  if (windowId === focusedWindowId) {
    return
  }

  const text = cut(windowId + ': ' + title, ITEM_LENGTH)
  menuKeys.forEach((key) => addMenuItem(key + SEP + windowId, text, key))
}

// メニューアイテムを更新する
function updateItem (windowId, title) {
  if (windowId === focusedWindowId) {
    return
  }

  const text = cut(windowId + ': ' + title, ITEM_LENGTH)

  async function update (id) {
    await contextMenus.update(id, { title: text })
    debug('Updated ' + id + ' menu item: ' + text)
  }

  menuKeys.forEach((key) => update(key + SEP + windowId).catch(onError))
}

// メニューアイテムを削除する
function removeItem (windowId) {
  async function remove (id) {
    await contextMenus.remove(id)
    debug('Removed ' + id + ' menu item')
  }

  menuKeys.forEach((key) => remove(key + SEP + windowId).catch(onError))
}

// フォーカスしてるタブで状態を更新する
function setActiveTab (tabId, windowId, title) {
  if (windowId === selectWindowId) {
    return
  }

  let info = windowToInfo.get(windowId)
  if (info) {
    if (info.tab !== tabId) {
      tabToWindow.delete(info.tab)
      tabToWindow.set(tabId, windowId)
      info.tab = tabId
    }
    if (info.title !== title) {
      info.title = title
      updateItem(windowId, title)
    }
  } else {
    info = {
      tab: tabId,
      title: title
    }
    windowToInfo.set(windowId, info)
    tabToWindow.set(tabId, windowId)
    addItem(windowId, title)
  }
}

function unsetActiveTab (windowId) {
  const info = windowToInfo.get(windowId)
  if (info) {
    windowToInfo.delete(windowId)
    tabToWindow.delete(info.tab)
    removeItem(windowId)
  }
}

// フォーカスされたウインドウをメニューから消す
async function filterWindow (windowId) {
  debug('Window' + windowId + ' is focused')

  const old = focusedWindowId
  focusedWindowId = windowId

  if (old) {
    const info = windowToInfo.get(old)
    if (info) {
      addItem(old, info.title)
    }
  }

  removeItem(focusedWindowId)
}

// メニューを初期化
async function reset () {
  windowToInfo.clear()
  tabToWindow.clear()
  await contextMenus.removeAll()

  switch (menuKeys.length) {
    case 0: {
      break
    }
    case 1: {
      const key = menuKeys[0]
      addMenuItem(key, i18n.getMessage(KEY_MOVE_X, i18n.getMessage(key)))
      if (key !== KEY_ALL) {
        addMenuItem(key + SEP + KEY_NEW_WINDOW, i18n.getMessage(KEY_NEW_WINDOW), key)
      }
      break
    }
    default: {
      addMenuItem(KEY_MOVE, i18n.getMessage(KEY_MOVE))
      menuKeys.forEach((key) => {
        addMenuItem(key, i18n.getMessage(key), KEY_MOVE)
        if (key !== KEY_ALL) {
          addMenuItem(key + SEP + KEY_NEW_WINDOW, i18n.getMessage(KEY_NEW_WINDOW), key)
        }
      })
    }
  }

  const tabList = await tabs.query({active: true})
  for (const tab of tabList) {
    setActiveTab(tab.id, tab.windowId, tab.title)
  }

  const windowInfo = await windows.getCurrent()
  await filterWindow(windowInfo.id)
}

// 選択ウインドウをつくる
async function select (fromWindowId, toWindowId, notification) {
  function resetWindow () {
    runtime.sendMessage({
      type: 'update',
      fromWindowId,
      toWindowId,
      notification
    })
  }

  async function asleep (msec) {
    return new Promise(resolve => setTimeout(resolve, msec))
  }

  async function createSelectWindow () {
    const selectSize = await getValue(KEY_SELECT_SIZE, DEFAULT_SELECT_SIZE)
    const window = await windows.create({
      type: 'detached_panel',
      url: 'select.html',
      width: selectSize[0],
      height: selectSize[1]
    })
    debug('Select window was created')
    selectWindowId = window.id
    // 先に tabs.onUpdated が走ってしまうようなので除く
    unsetActiveTab(selectWindowId)

    // メッセージを受け取れるようになるまで待つ
    while (true) {
      const tab = await tabs.get(window.tabs[0].id)
      if (tab.url.endsWith('/select.html') && tab.status === 'complete') {
        break
      }
      await asleep(POLLING_INTERVAL)
    }

    resetWindow()
  }

  if (!selectWindowId) {
    await createSelectWindow()
    return
  }

  try {
    await windows.get(selectWindowId)
  } catch (e) {
    debug(e)
    await createSelectWindow()
    return
  }

  debug('Reuse select window')
  resetWindow()
}

// ピン留めされている最後のタブの位置を返す
async function searchLastPinnedIndex (windowId) {
  const pinnedTabList = await tabs.query({windowId, pinned: true})
  let lastIndex = -1
  for (const pinnedTab of pinnedTabList) {
    if (pinnedTab.index > lastIndex) {
      lastIndex = pinnedTab.index
    }
  }
  return lastIndex
}

// 未読み込みのタブにフォーカスが移って読み込んでしまうのを防ぐために
// 移動しないタブか末尾のタブにフォーカスする
async function activateBest (windowId, moveTabIds) {
  const moveTabIdSet = new Set(moveTabIds)

  const tabList = await tabs.query({windowId})

  let activeTab
  let lastTab
  let notMoveTabs = []
  for (const tab of tabList) {
    const move = moveTabIdSet.has(tab.id)

    if (tab.active) {
      if (!move) {
        // 元から移動しないタブにフォーカスしてる
        return
      }
      activeTab = tab
    }
    if (!lastTab || tab.index > lastTab.index) {
      lastTab = tab
    }
    if (!move) {
      notMoveTabs.push(tab)
    }
  }

  // フォーカスしているタブの後ろで最も近い動かないタブ
  let nextTab
  // フォーカスしているタブの前で最も近い動かないタブ
  let prevTab
  for (const tab of notMoveTabs) {
    if (tab.index < activeTab.index) {
      if (!prevTab || tab.index > prevTab.index) {
        prevTab = tab
      }
    } else {
      if (!nextTab || tab.index < nextTab.index) {
        nextTab = tab
      }
    }
  }

  let bestTab
  if (nextTab) {
    bestTab = nextTab
  } else if (prevTab) {
    bestTab = prevTab
  } else {
    bestTab = lastTab
  }

  if (bestTab === activeTab) {
    // 全部が移動対象で activeTab が lastTab だった
    return
  } else if (activeTab.index + 1 === bestTab.index) {
    // activeTab を移動させれば自然と bestTab にフォーカスが移る
    return
  }

  await tabs.update(bestTab.id, {active: true})
  debug('Activated tab ' + bestTab.id)
}

// ひとつ移す
async function moveOne (tab, toWindowId) {
  const index = (tab.pinned ? await searchLastPinnedIndex(toWindowId) + 1 : -1)
  const [movedTab] = await tabs.move(tab.id, {windowId: toWindowId, index})
  debug('Tab' + movedTab.id + ' moved to window' + movedTab.windowId + '[' + movedTab.index + ']')
}

// ひとつを新しいウインドウに移す
async function moveOneToNewWindow (tab) {
  const windowInfo = await windows.create({tabId: tab.id})
  if (tab.pinned) {
    await tabs.update(tab.id, {pinned: true})
  }
  debug('Tab' + tab.id + ' moved to new window' + windowInfo.id + '[0]')
  return windowInfo
}

// 移す
async function move (tabIds, toWindowId) {
  if (tabIds.length <= 0) {
    return
  } else if (toWindowId) {
    for (const tabId of tabIds) {
      const tab = await tabs.get(tabId)
      if (tab.active) {
        await activateBest(tab.windowId, tabIds)
      }
      await moveOne(tab, toWindowId)
    }
    return
  }

  const tab = await tabs.get(tabIds[0])
  if (tab.active) {
    await activateBest(tab.windowId, tabIds)
  }
  const windowInfo = await moveOneToNewWindow(tab)
  await move(tabIds.slice(1), windowInfo.id)
}

// 対象のタブを列挙する
async function listing (tabId, keyType) {
  if (keyType === KEY_ONE) {
    return [tabId]
  }

  const tab = await tabs.get(tabId)
  let tabList = await tabs.query({windowId: tab.windowId})

  switch (keyType) {
    case KEY_RIGHT: {
      tabList = tabList.filter((tab2) => tab2.index > tab.index)
      break
    }
    case KEY_LEFT: {
      tabList = tabList.filter((tab2) => tab2.index < tab.index)
      break
    }
  }

  tabList.sort((tab1, tab2) => tab1.index - tab2.index)
  return tabList.map((tab) => tab.id)
}

// 通知を表示する
async function notify (message) {
  await notifications.create(NOTIFICATION_ID, {
    'type': 'basic',
    'title': NOTIFICATION_ID,
    message: message
  })
}

// 前後処理で挟む
async function wrapMoveCore (tabIds, toWindowId, notification) {
  try {
    if (notification) {
      await notify(i18n.getMessage(KEY_MOVING))
    }

    const start = new Date()
    await move(tabIds, toWindowId)
    const seconds = (new Date() - start) / 1000
    const message = i18n.getMessage(KEY_SUCCESS_MESSAGE, [seconds, tabIds.length])

    debug(message)
    if (notification) {
      await notify(message)
    }
  } catch (e) {
    onError(e)
    if (notification) {
      await notify(i18n.getMessage(KEY_FAILURE_MESSAGE, e))
    }
  }
}

// 前後処理で挟む
async function wrapMove (tabId, keyType, toWindowId, notification) {
  const tabIds = await listing(tabId, keyType)
  await wrapMoveCore(tabIds, toWindowId, notification)
}

// 初期化
(async function () {
  // 別のタブにフォーカスを移した
  tabs.onActivated.addListener((activeInfo) => (async function () {
    debug('Tab' + activeInfo.tabId + ' became active')
    const tab = await tabs.get(activeInfo.tabId)
    setActiveTab(tab.id, tab.windowId, tab.title)
  })().catch(onError))

  // タブが変わった
  tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.title) {
      // タイトルは変わってなかった
      return
    }

    const windowId = tabToWindow.get(tabId)
    if (!windowId || windowId !== tab.windowId) {
      // フォーカスしてないタブだった
      return
    }
    // フォーカスしてるタブのタイトルが変わった
    debug('Tab' + tab.id + ' was updated')
    setActiveTab(tab.id, tab.windowId, tab.title)
  })

  // ウインドウができた
  windows.onCreated.addListener((window) => (async function () {
    const [tab] = await tabs.query({windowId: window.id, active: true})
    debug('Tab' + tab.id + ' is in new window' + tab.windowId)
    setActiveTab(tab.id, tab.windowId, tab.title)
  })().catch(onError))

  // ウインドウがなくなった
  windows.onRemoved.addListener((windowId) => {
    debug('Window' + windowId + ' was closed')
    unsetActiveTab(windowId)
  })

  // 別のウインドウにフォーカスを移した
  windows.onFocusChanged.addListener((windowId) => filterWindow(windowId).catch(onError))

  // リアルタイムで設定を反映させる
  storage.onChanged.addListener((changes, area) => (async function () {
    const menuItem = changes[KEY_MENU_ITEM]
    if (menuItem && menuItem.newValue) {
      menuKeys = menuItem.newValue
      await reset()
    }
  })().catch(onError))

  // 右クリックメニューから実行
  contextMenus.onClicked.addListener((info, tab) => (async function () {
    const [
      keyType,
      toWindowLabel
    ] = info.menuItemId.split(SEP)
    const toWindowId = (toWindowLabel === KEY_NEW_WINDOW ? undefined : Number(toWindowLabel))
    const notification = await getValue(KEY_NOTIFICATION, DEFAULT_NOTIFICATION)
    switch (keyType) {
      case KEY_ONE:
      case KEY_RIGHT:
      case KEY_LEFT:
      case KEY_ALL: {
        await wrapMove(tab.id, keyType, toWindowId, notification)
        break
      }
      case KEY_SELECT: {
        await select(tab.windowId, toWindowId, notification)
        break
      }
    }
  })().catch(onError))

  // メッセージを受け取る
  runtime.onMessage.addListener((message, sender, sendResponse) => (async function () {
    debug('Message ' + JSON.stringify(message) + ' was received')
    switch (message.type) {
      case 'selectSize': {
        // 選択ウインドウからのウインドウサイズ通知
        const selectSave = await getValue(KEY_SELECT_SAVE, DEFAULT_SELECT_SAVE)
        if (!selectSave) {
          break
        }
        const { selectSize } = message
        await storageArea.set({[KEY_SELECT_SIZE]: selectSize})
        break
      }
      case KEY_MOVE: {
        // 選択ウインドウからの選択結果
        const {
          keyType,
          toWindowId,
          notification
        } = message
        switch (keyType) {
          case KEY_SELECT: {
            const {tabIds} = message
            await wrapMoveCore(tabIds, toWindowId, notification)
            break
          }
        }
        break
      }
    }
  })().catch(onError))

  // メッセージから実行
  runtime.onMessageExternal.addListener((message, sender, sendResponse) => (async function () {
    debug('Message ' + JSON.stringify(message) + ' was received')
    switch (message.type) {
      case KEY_MOVE: {
        const {
          keyType,
          toWindowId,
          notification
        } = message
        switch (keyType) {
          case KEY_SELECT: {
            const {tabIds} = message
            await wrapMoveCore(tabIds, toWindowId, notification)
            break
          }
          default: {
            const {tabId} = message
            await wrapMove(tabId, keyType, toWindowId, notification)
            break
          }
        }
        break
      }
    }
  })().catch(onError))

  menuKeys = await getValue(KEY_MENU_ITEM, DEFAULT_MENU_ITEM)
  await reset()
})().catch(onError)
