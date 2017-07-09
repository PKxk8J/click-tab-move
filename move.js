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
tabs.onActivated.addListener((activeInfo) => {
  debug('Tab' + activeInfo.tabId + ' became active')
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
  debug('Tab' + tab.id + ' was updated')
  setActiveTab(tab.id, tab.windowId, tab.title)
})

// ウインドウができた
windows.onCreated.addListener((window) => {
  const querying = tabs.query({windowId: window.id, active: true})
  querying.then((tabList) => {
    for (let tab of tabList) {
      debug('Tab' + tab.id + ' is in new window' + tab.windowId)
      setActiveTab(tab.id, tab.windowId, tab.title)
    }
  }, onError)
})

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
function moveOne (id, windowId, index) {
  debug('Tab' + id + ' move to window' + windowId + '[' + index + ']')
  return tabs.move(id, {windowId, index})
    .then((tab) => debug('Tab' + tab[0].id + ' moved to window' + tab[0].windowId + '[' + tab[0].index + ']'))
}

function moveOneToNewWindow (id) {
  return windows.create({tabId: id})
}

// 再読み込みしつつ 1つのタブを移す
function moveOneWithReload (id, windowId, index) {
  return new Promise((resolve, reject) => {
    const getting = tabs.get(id)
    getting.then((tab) => {
      if (tab.url === 'about:blank') {
        moveOne(id, windowId, index).then(resolve)
        return
      }

      let timeoutExecutor
      const onReload = () => {
        clearTimeout(timeoutExecutor)
        onReloads.delete(id)
        moveOne(id, windowId, index).then(resolve)
      }
      onReloads.set(id, onReload)

      timeoutExecutor = () => {
        const stale = onReloads.get(id)
        if (stale === onReload) {
          onReloads.delete(id)
          onError('Reloading tab' + id + ' timed out')
        }
      }
      setTimeout(timeoutExecutor, reloadTimeout)

      const reloading = tabs.reload(id, {bypassCache: true})
      reloading.then(() => {
        debug('Tab' + id + ' was reloaded')
      }, reject)
    }, reject)
  })
}

// 複数のタブを移す
function moveSome (ids, windowId, index, reload) {
  return new Promise((resolve, reject) => {
    function loop (i, idx) {
      return new Promise((resolve, reject) => {
        let moving
        if (reload) {
          moving = moveOneWithReload(ids[i], windowId, idx)
        } else {
          moving = moveOne(ids[i], windowId, idx)
        }
        moving.then((tab) => {
          const nextIdx = (idx < 0 ? idx : idx + 1)
          resolve({nextI: i + 1, nextIdx})
        }, reject)
      }).then(({nextI, nextIdx}) => {
        if (nextI < ids.length) {
          loop(nextI, nextIdx)
        } else {
          resolve()
        }
      }, reject)
    }

    loop(0, index)
  })
}

function moveSomeToNewWindow (ids, reload) {
  return windows.create({tabId: ids[0]})
    .then((windowInfo) => {
      moveSome(ids.slice(1), windowInfo.id, -1, reload)
    })
}

// 全てのタブを移す
function moveAll (fromWindowId, windowId, index, reload) {
  return tabs.query({windowId: fromWindowId}).then((tabList) => {
    tabList.sort((tab1, tab2) => tab1.index - tab2.index)
    moveSome(tabList.map((tab) => tab.id), windowId, index, reload)
  })
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

function sendUpdateMessage () {
  const title = (toWindowId ? windowToInfo.get(toWindowId).title : i18n.getMessage(KEY_NEW_WINDOW))
  runtime.sendMessage({
    type: 'update',
    fromWindowId,
    toWindowId,
    toWindowTitle: title
  })
}

function select (tab, windowId, reload) {
  fromWindowId = tab.windowId
  toWindowId = windowId
  selectReload = reload

  function createSelectWindow () {
    const creating = windows.create({
      type: 'detached_panel',
      url: 'select.html',
      width: selectWidth,
      height: selectHeight
    })
    creating.then((window) => {
      debug('Select window was created')
      selectWindowId = window.id
      // 先に tabs.onUpdated が走ってしまうようなので除く
      unsetActiveTab(selectWindowId)
    }, onError)
  }

  if (selectWindowId) {
    const getting = windows.get(selectWindowId)
    getting.then(() => {
      debug('Reuse select window')
      sendUpdateMessage()
    }, (error) => {
      debug(error)
      createSelectWindow()
    })
  } else {
    createSelectWindow()
  }
}

runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      if (toWindowId) {
        moveSome(tabIds, toWindowId, -1, selectReload)
      } else {
        moveSomeToNewWindow(tabIds, selectReload)
      }
      break
    }
  }
})

function moveToNewWindow (tab, operation) {
  switch (operation) {
    case KEY_ONE: {
      moveOneToNewWindow(tab.id).catch(onError)
      break
    }
    case KEY_ONE_RELOAD: {
      moveOneToNewWindow(tab.id).catch(onError)
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
      select(tab)
      break
    }
    case KEY_SELECT_RELOAD: {
      select(tab, undefined, true)
      break
    }
  }
}

function moveToExistWindow (tab, operation, windowId) {
  switch (operation) {
    case KEY_ONE: {
      moveOne(tab.id, windowId, -1).catch(onError)
      break
    }
    case KEY_ONE_RELOAD: {
      moveOneWithReload(tab.id, windowId, -1).catch(onError)
      break
    }
    case KEY_ALL: {
      moveAll(tab.windowId, windowId, -1).catch(onError)
      break
    }
    case KEY_ALL_RELOAD: {
      moveAll(tab.windowId, windowId, -1, true).catch(onError)
      break
    }
    case KEY_SELECT: {
      select(tab, windowId)
      break
    }
    case KEY_SELECT_RELOAD: {
      select(tab, windowId, true)
      break
    }
  }
}

contextMenus.onClicked.addListener((info, tab) => {
  const tokens = info.menuItemId.split(SEP)

  if (tokens[1] === KEY_NEW_WINDOW) {
    moveToNewWindow(tab, tokens[0])
  } else {
    moveToExistWindow(tab, tokens[0], Number(tokens[1]))
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
  if (falseIffFalse(result[KEY_SELECT])) {
    menuKeys.push(KEY_SELECT)
  }
  if (result[KEY_SELECT_RELOAD]) {
    menuKeys.push(KEY_SELECT_RELOAD)
  }
  selectWidth = result[KEY_SELECT_WIDTH] || 640
  selectHeight = result[KEY_SELECT_HEIGHT] || 480
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
