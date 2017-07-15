'use strict'

const { contextMenus, i18n, runtime, storage, tabs, windows } = browser
const storageArea = storage.sync

const KEY_DEBUG = 'debug'

const KEY_MOVE = 'move'
const KEY_MOVE_X = 'moveX'
const KEY_ONE = 'one'
const KEY_ONE_RELOAD = 'oneReload'
const KEY_ALL = 'all'
const KEY_ALL_RELOAD = 'allReload'
const KEY_SELECT = 'select'
const KEY_SELECT_RELOAD = 'selectReload'
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
  if (DEBUG && error.stack) {
    console.error(error.stack)
  }
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

const onReloads = new Map()
// TODO 設定に
let reloadTimeout = 60 * 1000
let selectWidth = 640
let selectHeight = 480

// info ウインドウ情報
// info.tab アクティブなタブの ID
// info.title アクティブなタブのタイトル

// ウインドウ ID からウインドウ情報
const windowToInfo = new Map()
// タブ ID からウインドウ ID
const tabToWindow = new Map()

// メニューアイテムを追加する
function addItem (windowId, title) {
  const text = cut(windowId + ': ' + title, ITEM_LENGTH)
  menuKeys.forEach((key) => addMenuItem(key + SEP + windowId, text, key))
}

// メニューアイテムを更新する
function updateItem (windowId, title) {
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
  if (changeInfo.status === 'complete' && tab.url !== 'about:blank') {
    const onReload = onReloads.get(tabId)
    if (onReload) {
      onReload()
    }
    return
  } else if (!changeInfo.title) {
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

// TODO フォーカスされているウインドウをメニューの移動先から消す
// // 別のウインドウにフォーカスを移した
// windows.onFocusChanged.addListener((windowId) => {
//   debug('Window' + windowId + ' is focused')
// })

// 1つのタブを移す
async function moveOne (id, windowId, index) {
  debug('Tab' + id + ' move to window' + windowId + '[' + index + ']')
  const tab = await tabs.move(id, {windowId, index})
  debug('Tab' + tab[0].id + ' moved to window' + tab[0].windowId + '[' + tab[0].index + ']')
  return tab
}

// 再読み込みしつつ 1つのタブを移す
function moveOneWithReload (id, windowId, index) {
  return new Promise((resolve, reject) => (async function () {
    const tab = tabs.get(id)
    if (tab.url === 'about:blank') {
      resolve(await moveOne(id, windowId, index))
      return
    }

    let timeoutExecutor
    const onReload = () => (async function () {
      clearTimeout(timeoutExecutor)
      onReloads.delete(id)
      resolve(await moveOne(id, windowId, index))
    })().catch(onError)
    onReloads.set(id, onReload)

    timeoutExecutor = () => {
      const stale = onReloads.get(id)
      if (stale === onReload) {
        onReloads.delete(id)
        onError('Reloading tab' + id + ' timed out')
        reject(new Error('timeout'))
      }
    }
    setTimeout(timeoutExecutor, reloadTimeout)

    await tabs.reload(id, {bypassCache: true})
    debug('Tab' + id + ' was reloaded')
  })().catch(reject))
}

// 複数のタブを移す
async function moveSome (ids, windowId, index, reload) {
  let idx = index
  for (const id of ids) {
    if (reload) {
      await moveOneWithReload(id, windowId, idx)
    } else {
      await moveOne(id, windowId, idx)
    }
    idx = (idx < 0 ? idx : idx + 1)
  }
}

// 全てのタブを移す
async function moveAll (fromWindowId, windowId, index, reload) {
  const tabList = await tabs.query({windowId: fromWindowId})
  tabList.sort((tab1, tab2) => tab1.index - tab2.index)
  // 未読み込みのタブにフォーカスが移って読み込んでしまうのを防ぐために末尾のタブにフォーカスする
  await tabs.update(tabList[tabList.length - 1].id, {active: true})
  await moveSome(tabList.map((tab) => tab.id), windowId, index, reload)
}

async function moveOneToNewWindow (id) {
  return windows.create({tabId: id})
}

async function moveSomeToNewWindow (ids, reload) {
  const windowInfo = await windows.create({tabId: ids[0]})
  await moveSome(ids.slice(1), windowInfo.id, -1, reload)
}

// タブ選択ウインドウは1つとする

// タブ選択元のウインドウ
let fromWindowId
// 選択タブ移動先のウインドウ
let toWindowId
// 選択タブ移動で再読み込みするか
let selectReload
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
async function select (tab, windowId, reload) {
  fromWindowId = tab.windowId
  toWindowId = windowId
  selectReload = reload

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

// 未読み込みのタブにフォーカスが移って読み込んでしまうのを防ぐために動かないタブか末尾のタブにフォーカスする
async function activateNextTab (windowId, moveIds) {
  const moveIdSet = new Set(moveIds)

  const [activeTab] = await tabs.query({windowId, active: true})
  if (!moveIdSet.has(activeTab.id)) {
    return
  }

  // 末尾のタブ
  let lastTab
  // フォーカスしているタブの後ろで最も近い動かないタブ
  let nextTab
  // フォーカスしているタブの前で最も近い動かないタブ
  let prevTab
  const tabList = await tabs.query({windowId})
  for (const tab of tabList) {
    if (!lastTab || tab.index > lastTab.index) {
      lastTab = tab
    }

    if (moveIdSet.has(tab.id)) {
      continue
    }

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
      if (tabIds.length <= 0) {
        debug('No selected tabs')
        return
      }
      await activateNextTab(fromWindowId, tabIds)
      if (toWindowId) {
        await moveSome(tabIds, toWindowId, -1, selectReload)
      } else {
        await moveSomeToNewWindow(tabIds, selectReload)
      }
      break
    }
  }
})().catch(onError))

async function moveToNewWindow (tab, operation) {
  switch (operation) {
    case KEY_ONE: {
      await moveOneToNewWindow(tab.id)
      break
    }
    case KEY_ONE_RELOAD: {
      await moveOneToNewWindow(tab.id)
      break
    }
    case KEY_ALL: {
      debug('No effect')
      break
    }
    case KEY_ALL_RELOAD: {
      debug('No effect')
      break
    }
    case KEY_SELECT: {
      await select(tab)
      break
    }
    case KEY_SELECT_RELOAD: {
      await select(tab, undefined, true)
      break
    }
  }
}

async function moveToExistWindow (tab, operation, windowId) {
  switch (operation) {
    case KEY_ONE: {
      await moveOne(tab.id, windowId, -1).catch(onError)
      break
    }
    case KEY_ONE_RELOAD: {
      await moveOneWithReload(tab.id, windowId, -1).catch(onError)
      break
    }
    case KEY_ALL: {
      await moveAll(tab.windowId, windowId, -1).catch(onError)
      break
    }
    case KEY_ALL_RELOAD: {
      await moveAll(tab.windowId, windowId, -1, true).catch(onError)
      break
    }
    case KEY_SELECT: {
      await select(tab, windowId)
      break
    }
    case KEY_SELECT_RELOAD: {
      await select(tab, windowId, true)
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
      if (![KEY_ALL, KEY_ALL_RELOAD].includes(key)) {
        addMenuItem(key + SEP + KEY_NEW_WINDOW, i18n.getMessage(KEY_NEW_WINDOW), key)
      }
      break
    }
    default: {
      addMenuItem(KEY_MOVE, i18n.getMessage(KEY_MOVE))
      menuKeys.forEach((key) => {
        addMenuItem(key, i18n.getMessage(key), KEY_MOVE)
        if (![KEY_ALL, KEY_ALL_RELOAD].includes(key)) {
          addMenuItem(key + SEP + KEY_NEW_WINDOW, i18n.getMessage(KEY_NEW_WINDOW), key)
        }
      })
    }
  }

  const tabList = await tabs.query({active: true})
  for (const tab of tabList) {
    setActiveTab(tab.id, tab.windowId, tab.title)
  }
}

// 設定を反映させる
async function applySetting (result) {
  menuKeys = []
  if (falseIffFalse(result[KEY_ONE])) {
    menuKeys.push(KEY_ONE)
  }
  if (result[KEY_ONE_RELOAD]) {
    menuKeys.push(KEY_ONE_RELOAD)
  }
  if (falseIffFalse(result[KEY_ALL])) {
    menuKeys.push(KEY_ALL)
  }
  if (result[KEY_ALL_RELOAD]) {
    menuKeys.push(KEY_ALL_RELOAD)
  }
  if (falseIffFalse(result[KEY_SELECT])) {
    menuKeys.push(KEY_SELECT)
  }
  if (result[KEY_SELECT_RELOAD]) {
    menuKeys.push(KEY_SELECT_RELOAD)
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
