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
    KEY_THIS_AND_RIGHT,
    KEY_LEFT,
    KEY_THIS_AND_LEFT,
    KEY_ALL,
    KEY_SELECT,
    KEY_CONTEXTS,
    KEY_MENU_ITEMS,
    KEY_NOTIFICATION,
    KEY_FOCUS,
    KEY_MOVE,
    KEY_MOVE_X,
    KEY_NEW_WINDOW,
    DEFAULT_CONTEXTS,
    DEFAULT_MENU_ITEMS,
    DEFAULT_NOTIFICATION,
    DEFAULT_FOCUS,
    debug,
    onError,
    getValue
  } = common
  const {
    run,
    select,
    getSelectWindowId
  } = move
  const {
    setActiveTabCallbacks
  } = monitor

  const SEP = '_'
  const ITEM_LENGTH = 64

  // てきとうな長さで打ち切る
  function cut (text, length) {
    if (text.length <= length) {
      return text
    }
    return text.substring(0, length) + '...'
  }

  let menuContexts = DEFAULT_CONTEXTS

  // 右クリックメニューに項目を追加する
  function addMenuItem (id, title, parentId) {
    if (menuContexts.length <= 0) {
      return
    }
    contextMenus.create({
      id,
      title,
      contexts: menuContexts,
      parentId
    }, () => {
      if (runtime.lastError) {
        onError(runtime.lastError)
      } else {
        debug('Added ' + title + ' menu item')
      }
    })
  }

  let menuKeys = DEFAULT_MENU_ITEMS

  // ウインドウ ID からウインドウでフォーカスされてるタブのタイトル
  const windowToTitle = new Map()

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

  // ウインドウの表示名を更新する
  function setWindowTitle (windowId, title) {
    if (windowId === getSelectWindowId()) {
      return
    }

    let oldTitle = windowToTitle.get(windowId)
    if (oldTitle) {
      if (oldTitle !== title) {
        windowToTitle.set(windowId, title)
        updateItem(windowId, title)
      }
    } else {
      windowToTitle.set(windowId, title)
      addItem(windowId, title)
    }
  }

  function unsetWindowTitle (windowId) {
    const title = windowToTitle.get(windowId)
    if (title) {
      windowToTitle.delete(windowId)
      removeItem(windowId)
    }
  }

  // フォーカスされたウインドウをメニューから消す
  async function filterWindow (windowId) {
    debug('Window' + windowId + ' is focused')

    const oldWindowId = focusedWindowId
    focusedWindowId = windowId

    if (oldWindowId) {
      const title = windowToTitle.get(oldWindowId)
      if (title) {
        addItem(oldWindowId, title)
      }
    }

    removeItem(focusedWindowId)
  }

  // メニューを初期化
  async function reset () {
    windowToTitle.clear()
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

    const tabList = await tabs.query({ active: true })
    for (const tab of tabList) {
      setWindowTitle(tab.windowId, tab.title)
    }

    const windowInfo = await windows.getCurrent()
    await filterWindow(windowInfo.id)
  }

  // 初期化
  (async function () {
    setActiveTabCallbacks((windowId, tabId) => (async function () {
      const tab = await tabs.get(tabId)
      setWindowTitle(windowId, tab.title)
    })().catch(onError), unsetWindowTitle)

    // タブが変わった
    tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab.active) {
        // フォーカスしてないタブだった
        return
      } else if (!changeInfo.title) {
        // タイトルは変わってなかった
        return
      }

      // フォーカスしてるタブのタイトルが変わった
      debug('Title of window' + tab.windowId + ' was changed')
      setWindowTitle(tab.windowId, tab.title)
    })

    // 別のウインドウにフォーカスを移した
    windows.onFocusChanged.addListener((windowId) => filterWindow(windowId).catch(onError))

    // リアルタイムで設定を反映させる
    storage.onChanged.addListener((changes, area) => (async function () {
      const contexts = changes[KEY_CONTEXTS]
      const items = changes[KEY_MENU_ITEMS]

      const hasContexts = contexts && contexts.newValue
      const hasItems = items && items.newValue
      if (hasContexts) {
        menuContexts = contexts.newValue
      }
      if (hasItems) {
        menuKeys = items.newValue
      }
      if (hasContexts || hasItems) {
        await reset()
      }
    })().catch(onError))

    // 右クリックメニューから実行
    contextMenus.onClicked.addListener((info, tab) => (async function () {
      const [
        keyType,
        toWindowLabel
      ] = info.menuItemId.split(SEP)
      tab = tab || (await tabs.query({ active: true, currentWindow: true }))[0]
      const toWindowId = (toWindowLabel === KEY_NEW_WINDOW ? undefined : Number(toWindowLabel))
      const notification = await getValue(KEY_NOTIFICATION, DEFAULT_NOTIFICATION)
      const focus = await getValue(KEY_FOCUS, DEFAULT_FOCUS)
      switch (keyType) {
        case KEY_ONE:
        case KEY_RIGHT:
        case KEY_THIS_AND_RIGHT:
        case KEY_LEFT:
        case KEY_THIS_AND_LEFT:
        case KEY_ALL: {
          await run(tab.id, keyType, toWindowId, notification, focus)
          break
        }
        case KEY_SELECT: {
          await select(tab.windowId, toWindowId, notification, focus, unsetWindowTitle)
          break
        }
      }
    })().catch(onError))

    menuContexts = await getValue(KEY_CONTEXTS, DEFAULT_CONTEXTS)
    menuKeys = await getValue(KEY_MENU_ITEMS, DEFAULT_MENU_ITEMS)
    await reset()
  })().catch(onError)
}
