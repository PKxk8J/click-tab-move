'use strict'

// 右クリックメニュー

{
  const {
    contextMenus,
    i18n,
    runtime,
    storage,
    tabs,
    windows
  } = browser
  const {
    KEY_ONE,
    KEY_RIGHT,
    KEY_LEFT,
    KEY_ALL,
    KEY_SELECT,
    KEY_MENU_ITEM,
    KEY_NOTIFICATION,
    KEY_MOVE,
    KEY_MOVE_X,
    KEY_NEW_WINDOW,
    DEFAULT_MENU_ITEM,
    DEFAULT_NOTIFICATION,
    debug,
    onError,
    getValue
  } = common

  const SEP = '_'
  const ITEM_LENGTH = 64

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
    if (windowId === move.getSelectWindowId()) {
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
          await move.run(tab.id, keyType, toWindowId, notification)
          break
        }
        case KEY_SELECT: {
          await move.select(tab.windowId, toWindowId, notification, unsetActiveTab)
          break
        }
      }
    })().catch(onError))

    menuKeys = await getValue(KEY_MENU_ITEM, DEFAULT_MENU_ITEM)
    await reset()
  })().catch(onError)
}
