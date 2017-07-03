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

const SEP = '_'
const ITEM_LENGTH = 64

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error('Error: ' + error)
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

  function update (id) {
    const updating = contextMenus.update(id, { title: text })
    updating.then(() => debug('Updated ' + id + ' menu item: ' + text), onError)
  }

  menuKeys.forEach((key) => update(key + SEP + windowId))
}

// メニューアイテムを削除する
function removeItem (windowId) {
  function remove (id) {
    const removing = contextMenus.remove(id)
    removing.then(() => debug('Removed ' + id + ' menu item'), onError)
  }

  menuKeys.forEach((key) => remove(key + SEP + windowId))
}

// フォーカスしてるタブで状態を更新する
function setActiveTab (tabId, windowId, title) {
  const info = windowToInfo.get(windowId)
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
    const info = {
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
tabs.onActivated.addListener((activeInfo) => {
  debug('Tab ' + activeInfo.tabId + ' became active')
  const getting = tabs.get(activeInfo.tabId)
  getting.then((tab) => setActiveTab(tab.id, tab.windowId, tab.title), onError)
})

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
  debug('Tab ' + tab.id + ' was updated')
  setActiveTab(tab.id, tab.windowId, tab.title)
})

// ウインドウができた
windows.onCreated.addListener((window) => {
  const querying = tabs.query({windowId: window.id, active: true})
  querying.then((tabList) => {
    for (let tab of tabList) {
      debug('Tab ' + tab.id + ' is in new window ' + tab.windowId)
      setActiveTab(tab.id, tab.windowId, tab.title)
    }
  }, onError)
})

// ウインドウがなくなった
windows.onRemoved.addListener((windowId) => {
  debug('Window ' + windowId + ' was closed')
  unsetActiveTab(windowId)
})

// TODO フォーカスされているウインドウをメニューの移動先から消す
// // 別のウインドウにフォーカスを移した
// windows.onFocusChanged.addListener((windowId) => {
//   debug('Window ' + windowId + ' is focused')
// })

function moveOneWithoutReload (tab, windowId, callback) {
  const moving = tabs.move(tab.id, {windowId, index: -1})
  moving.then(() => {
    debug('Tab ' + tab.id + ' moved to window ' + windowId)
    if (callback) {
      callback()
    }
  }, onError)
}

function moveOneWithReload (tab, windowId, callback) {
  let timeoutExecutor
  const onReload = () => {
    clearTimeout(timeoutExecutor)
    onReloads.delete(tab.id)
    moveOneWithoutReload(tab, windowId, callback)
  }
  onReloads.set(tab.id, onReload)

  timeoutExecutor = () => {
    const stale = onReloads.get(tab.id)
    if (stale === onReload) {
      onReloads.delete(tab.id)
      onError('Reload timed out on tab ' + tab.id)
    }
  }
  setTimeout(timeoutExecutor, 60 * 1000)

  const reloading = tabs.reload(tab.id, {bypassCache: true})
  reloading.then(() => {
    debug('Tab ' + tab.id + ' was reloaded')
  }, onError)
}

// タブを別のウインドウに送る
function moveOne (tab, windowId, reload, callback) {
  if (!reload || tab.url === 'about:blank') {
    moveOneWithoutReload(tab, windowId, callback)
  } else {
    // Linux だと読み込まれてないと失敗するので discarded なら reload してから
    moveOneWithReload(tab, windowId, callback)
  }
}

// 全てのタブを別のウインドウに送る
function moveAll (fromWindowId, toWindowId, reload) {
  const querying = tabs.query({windowId: fromWindowId})
  querying.then((tabList) => {
    // 一度に大量に送ると固まるので 1 つずつ送る
    tabList.sort((tab1, tab2) => tab1.index - tab2.index)

    function step (i) {
      if (i >= tabList.length) {
        debug('Completed')
        return
      }
      moveOne(tabList[i], toWindowId, reload, () => step(i + 1))
    }

    step(0)
  }, onError)
}

function move (tab, windowId, all, reload) {
  if (all) {
    moveAll(tab.windowId, windowId, reload)
  } else {
    moveOne(tab, windowId, reload)
  }
}

contextMenus.onClicked.addListener((info, tab) => {
  const tokens = info.menuItemId.split(SEP)
  const windowId = Number(tokens[1])

  switch (tokens[0]) {
    case KEY_ONE: {
      move(tab, windowId, false, false)
      break
    }
    case KEY_ONE_RELOAD: {
      move(tab, windowId, false, true)
      break
    }
    case KEY_ALL: {
      move(tab, windowId, true, false)
      break
    }
    case KEY_ALL_RELOAD: {
      move(tab, windowId, true, true)
      break
    }
  }
})

// メニューを初期化
function reset () {
  windowToInfo.clear()
  tabToWindow.clear()
  const removing = contextMenus.removeAll()
  removing.then(() => {
    switch (menuKeys.length) {
      case 0: {
        break
      }
      case 1: {
        addMenuItem(menuKeys[0], i18n.getMessage(KEY_MOVE_X, i18n.getMessage(menuKeys[0])))
        break
      }
      default: {
        addMenuItem(KEY_MOVE, i18n.getMessage(KEY_MOVE))
        menuKeys.forEach((key) => addMenuItem(key, i18n.getMessage(key), KEY_MOVE))
      }
    }

    const querying = tabs.query({active: true})
    querying.then((tabList) => {
      for (let tab of tabList) {
        setActiveTab(tab.id, tab.windowId, tab.title)
      }
    }, onError)
  }, onError)
}

// 設定を反映させる
function applySetting (result) {
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
  reset()
}

// リアルタイムで設定を反映させる
storage.onChanged.addListener((changes, area) => {
  const result = {}
  Object.keys(changes).forEach((key) => { result[key] = changes[key].newValue })
  applySetting(result)
})

// 初期化
const getting = storageArea.get()
getting.then(applySetting, onError)
