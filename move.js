'use strict'

const { contextMenus, i18n, runtime, storage, tabs, windows } = browser
const storageArea = storage.sync

const KEY_DEBUG = 'debug'

const KEY_MOVE = 'move'
const KEY_MOVE_X = 'moveX'
const KEY_ONE = 'one'
const KEY_ALL = 'all'
const KEY_SELECT = 'select'
const KEY_SELECT_WIDTH = 'selectWidth'
const KEY_SELECT_HEIGHT = 'selectHeight'
const KEY_NEW_WINDOW = 'newWindow'

const SEP = '_'
const ITEM_LENGTH = 64

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error(error)
}

// bool が undefined でなく false のときだけ false になるように
function falseIffFalse (bool) {
  if (typeof bool === 'undefined') {
    return true
  }
  return bool
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

let selectWidth = 640
let selectHeight = 480

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

// 別のウインドウにフォーカスを移した
windows.onFocusChanged.addListener((windowId) => filterWindow(windowId).catch(onError))

// 1つのタブを移す
async function moveOne (id, windowId, index) {
  debug('Tab' + id + ' move to window' + windowId + '[' + index + ']')
  const tab = await tabs.move(id, {windowId, index})
  debug('Tab' + tab[0].id + ' moved to window' + tab[0].windowId + '[' + tab[0].index + ']')
  return tab
}

// 複数のタブを移す
async function moveSome (ids, windowId, index) {
  let idx = index
  // 固まるのを防ぐために 1つずつ移す
  for (const id of ids) {
    await moveOne(id, windowId, idx)
    idx = (idx < 0 ? idx : idx + 1)
  }
}

// タブ選択ウインドウは1つとする

// タブ選択元のウインドウ
let fromWindowId
// 選択タブ移動先のウインドウ
let toWindowId
// タブ選択ウインドウ
let selectWindowId

// 選択ウインドウの表示を更新させる
function sendUpdateMessage () {
  const title = (toWindowId ? windowToInfo.get(toWindowId).title : i18n.getMessage(KEY_NEW_WINDOW))
  runtime.sendMessage({
    type: 'update',
    fromWindowId,
    toWindowId,
    toWindowTitle: title
  })
}

// 選択ウインドウをつくる
async function select (tab, windowId) {
  fromWindowId = tab.windowId
  toWindowId = windowId

  async function createSelectWindow () {
    const window = await windows.create({
      type: 'detached_panel',
      url: 'select.html',
      width: selectWidth,
      height: selectHeight
    })
    debug('Select window was created')
    selectWindowId = window.id
    // 先に tabs.onUpdated が走ってしまうようなので除く
    unsetActiveTab(selectWindowId)
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
  sendUpdateMessage()
}

// 未読み込みのタブにフォーカスが移って読み込んでしまうのを防ぐために
// 移動しないタブか末尾のタブにフォーカスする
async function activateBestTab (tabList, ids) {
  const idSet = new Set(ids)

  let activeTab
  let lastTab
  let notMoveTabs = []
  for (const tab of tabList) {
    const move = idSet.has(tab.id)

    if (tab.active) {
      if (!move) {
        // 移動しないタブにフォーカスしてる
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

  let id
  if (nextTab) {
    id = nextTab.id
  } else if (prevTab) {
    id = prevTab.id
  } else {
    id = lastTab.id
  }

  if (id === activeTab.id) {
    // 全部が移動対象で activeTab が lastTab だった
    return
  }

  await tabs.update(id, {active: true})
}

// ピン留めされているかどうかを考慮してどの位置に移動すれば良いか決める
// 返り値は [{ids: [...], index: .}, ...]
async function checkPin (tabList, ids, windowId) {
  const idToTab = new Map()
  tabList.forEach((tab) => idToTab.set(tab.id, tab))

  const pinneds = []
  const notPinneds = []
  ids.forEach((id) => {
    const tab = idToTab.get(id)
    if (tab.pinned) {
      pinneds.push(id)
    } else {
      notPinneds.push(id)
    }
  })

  if (pinneds.length <= 0) {
    return [{ids, index: -1}]
  }

  const pinnedTabs = await tabs.query({windowId, pinned: true})
  let lastPinnedIndex = -1
  pinnedTabs.forEach((tab) => {
    if (!lastPinnedIndex || tab.index > lastPinnedIndex) {
      lastPinnedIndex = tab.index
    }
  })

  return [{
    ids: pinneds,
    index: lastPinnedIndex + 1
  }, {
    ids: notPinneds,
    index: -1
  }]
}

// ピン留めを考慮しつつ 1つのタブを移す
async function wrapMoveOne (tab, windowId) {
  const index = (tab.pinned ? 0 : -1)
  await moveOne(tab.id, windowId, index)
}

// ピン留めを考慮しつつ 1つのタブを新しいウインドウに移す
async function wrapMoveOneToNewWindow (id) {
  const tab = await tabs.get(id)
  const windowInfo = await windows.create({tabId: id})
  if (tab.pinned) {
    await tabs.update(id, {pinned: true})
  }
  return windowInfo
}

// 未読み込みとピン留めを考慮しつつ複数のタブを移す
async function wrapMoveSome (fromWindowId, ids, windowId) {
  const tabList = await tabs.query({windowId: fromWindowId})

  await activateBestTab(tabList, ids)

  const entries = await checkPin(tabList, ids, windowId)
  for (const entry of entries) {
    await moveSome(entry.ids, windowId, entry.index)
  }
}

// 未読み込みとピン留めを考慮しつつ複数のタブを新しいウインドウに移す
async function wrapMoveSomeToNewWindow (fromWindowId, ids) {
  const tabList = await tabs.query({windowId: fromWindowId})

  await activateBestTab(tabList, ids)

  const windowInfo = await wrapMoveOneToNewWindow(ids[0])

  const entries = await checkPin(tabList, ids.slice(1), windowInfo.id)
  for (const entry of entries) {
    await moveSome(entry.ids, windowInfo.id, entry.index)
  }
}

// 未読み込みとピン留めを考慮しつつ全てのタブを移す
async function wrapMoveAll (fromWindowId, windowId) {
  const tabList = await tabs.query({windowId: fromWindowId})
  tabList.sort((tab1, tab2) => tab1.index - tab2.index)

  const lastTab = tabList[tabList.length - 1]
  if (!lastTab.active) {
    await tabs.update(lastTab.id, {active: true})
  }

  const ids = tabList.map((tab) => tab.id)
  const entries = await checkPin(tabList, ids, windowId)
  for (const entry of entries) {
    await moveSome(entry.ids, windowId, entry.index)
  }
}

// 選択ウインドウから初期化通知と移動通知を受け取る
runtime.onMessage.addListener((message, sender, sendResponse) => (async function () {
  debug('Message ' + JSON.stringify(message) + ' was received')

  switch (message.type) {
    case 'started': {
      sendUpdateMessage()
      break
    }
    case 'move': {
      const { tabIds } = message
      if (toWindowId) {
        await wrapMoveSome(fromWindowId, tabIds, toWindowId)
      } else {
        await wrapMoveSomeToNewWindow(fromWindowId, tabIds)
      }
      break
    }
  }
})().catch(onError))

async function moveToNewWindow (tab, operation) {
  switch (operation) {
    case KEY_ONE: {
      await wrapMoveOneToNewWindow(tab.id)
      break
    }
    case KEY_SELECT: {
      await select(tab)
      break
    }
  }
}

async function moveToExistWindow (tab, operation, windowId) {
  switch (operation) {
    case KEY_ONE: {
      await wrapMoveOne(tab, windowId)
      break
    }
    case KEY_ALL: {
      await wrapMoveAll(tab.windowId, windowId)
      break
    }
    case KEY_SELECT: {
      await select(tab, windowId)
      break
    }
  }
}

// 右クリックメニューからの入力を処理
contextMenus.onClicked.addListener((info, tab) => (async function () {
  const tokens = info.menuItemId.split(SEP)

  if (tokens[1] === KEY_NEW_WINDOW) {
    await moveToNewWindow(tab, tokens[0])
  } else {
    await moveToExistWindow(tab, tokens[0], Number(tokens[1]))
  }
})().catch(onError))

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

// 設定を反映させる
async function applySetting (result) {
  menuKeys = []
  if (falseIffFalse(result[KEY_ONE])) {
    menuKeys.push(KEY_ONE)
  }
  if (falseIffFalse(result[KEY_ALL])) {
    menuKeys.push(KEY_ALL)
  }
  if (falseIffFalse(result[KEY_SELECT])) {
    menuKeys.push(KEY_SELECT)
  }
  selectWidth = result[KEY_SELECT_WIDTH] || 640
  selectHeight = result[KEY_SELECT_HEIGHT] || 480

  await reset()
}

// リアルタイムで設定を反映させる
storage.onChanged.addListener((changes, area) => (async function () {
  const result = {}
  Object.keys(changes).forEach((key) => { result[key] = changes[key].newValue })
  await applySetting(result)
})().catch(onError))

// 初期化
;(async function () {
  const result = storageArea.get()
  await applySetting(result)
})().catch(onError)
