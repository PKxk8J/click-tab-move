'use strict'

const { contextMenus, i18n, runtime, tabs, windows } = browser

const KEY_DEBUG = 'debug'

const KEY_MOVE = 'move'
const KEY_MOVE_X = 'moveX'
const KEY_ONE = 'one'
const KEY_ALL = 'all'

const ITEM_LENGTH = 30

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error('Error: ' + error)
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

// 単体操作を使えるようにするか
let oneEnabled = false
// 全体操作を使えるようにするか
let allEnabled = true

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

  if (oneEnabled) {
    addMenuItem('one_' + windowId, text, KEY_ONE)
  }
  if (allEnabled) {
    addMenuItem('all_' + windowId, text, KEY_ALL)
  }
}

// メニューアイテムを更新する
function updateItem (windowId, title) {
  const text = cut(windowId + ': ' + title, ITEM_LENGTH)

  function update (id) {
    const updating = contextMenus.update(id, { title: text })
    updating.then(() => debug('Updated ' + id + ' menu item: ' + text), onError)
  }

  if (oneEnabled) {
    update('one_' + windowId)
  }
  if (allEnabled) {
    update('all_' + windowId)
  }
}

// メニューアイテムを削除する
function removeItem (windowId) {
  function remove (id) {
    const removing = contextMenus.remove(id)
    removing.then(() => debug('Removed ' + id + ' menu item'), onError)
  }

  if (oneEnabled) {
    remove('one_' + windowId)
  }
  if (allEnabled) {
    remove('all_' + windowId)
  }
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
  const getting = tabs.get(activeInfo.tabId)
  getting.then((tab) => setActiveTab(tab.id, tab.windowId, tab.title), onError)
})

// タブが変わった
tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const windowId = tabToWindow.get(tabId)
  if (!windowId) {
    // フォーカスしてないタブだった
    return
  } else if (!changeInfo.title) {
    // タイトルは変わってなかった
    return
  }

  // フォーカスしてるタブのタイトルが変わった
  setActiveTab(tab.id, tab.windowId, tab.title)
})

// ウインドウが開いた
windows.onCreated.addListener((window) => {
  const querying = tabs.query({windowId: window.id, active: true})
  querying.then((tabList) => {
    for (let tab of tabList) {
      setActiveTab(tab.id, tab.windowId, tab.title)
    }
  }, onError)
})

// ウインドウが閉じられた
windows.onRemoved.addListener((windowId) => {
  unsetActiveTab(windowId)
})

// 別のウインドウにフォーカスを移した
windows.onFocusChanged.addListener((windowId) => {
  // TODO フォーカスされているウインドウをメニューの移動先から消す
  debug('Window ' + windowId + ' is focused')
})

function move (windowId, all) {
  // TODO 実装
}

contextMenus.onClicked.addListener((info, tab) => {
  const tokens = info.menuItemId.split('_')
  const all = tokens[0] === 'all'
  const windowId = Number(tokens[1])

  move(windowId, all)
})

// メニューを初期化
function reset () {
  windowToInfo.clear()
  tabToWindow.clear()
  const removing = contextMenus.removeAll()
  removing.then(() => {
    if (oneEnabled && allEnabled) {
      addMenuItem(KEY_MOVE, i18n.getMessage(KEY_MOVE))
      addMenuItem(KEY_ONE, i18n.getMessage(KEY_ONE), KEY_MOVE)
      addMenuItem(KEY_ALL, i18n.getMessage(KEY_ALL), KEY_MOVE)
    } else if (oneEnabled) {
      addMenuItem(KEY_ONE, i18n.getMessage(KEY_MOVE_X, i18n.getMessage(KEY_ONE)))
    } else if (allEnabled) {
      addMenuItem(KEY_ALL, i18n.getMessage(KEY_MOVE_X, i18n.getMessage(KEY_ALL)))
    }

    const querying = tabs.query({active: true})
    querying.then((tabList) => {
      for (let tab of tabList) {
        setActiveTab(tab.id, tab.windowId, tab.title)
      }
    }, onError)
  }, onError)
}

reset()
