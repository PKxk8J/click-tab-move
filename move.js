'use strict'

// 移動処理本体

var _export

{
  const {
    i18n,
    notifications,
    runtime,
    tabs,
    windows
  } = browser
  const {
    KEY_ONE,
    KEY_RIGHT,
    KEY_LEFT,
    KEY_RAW,
    KEY_MOVE,
    KEY_SELECT_SIZE,
    KEY_SELECT_SAVE,
    KEY_MOVING,
    KEY_SUCCESS_MESSAGE,
    KEY_FAILURE_MESSAGE,
    KEY_RESET,
    DEFAULT_SELECT_SIZE,
    DEFAULT_SELECT_SAVE,
    NOTIFICATION_ID,
    POLLING_INTERVAL,
    storageArea,
    debug,
    onError,
    getValue,
    asleep
  } = common

  // タブ選択ウインドウ
  // タブ選択ウインドウは1つとする
  let selectWindowId

  function getSelectWindowId () {
    return selectWindowId
  }

  // 選択ウインドウをつくる
  async function select (fromWindowId, toWindowId, notification, onCreate) {
    function resetWindow () {
      runtime.sendMessage({
        type: KEY_RESET,
        fromWindowId,
        toWindowId,
        notification
      })
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
      if (onCreate) {
        onCreate(selectWindowId)
      }

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
    // 未ロードのタブを以下のようにウインドウ作成時に渡すと失敗する (Firefox 55)
    // const windowInfo = await windows.create({tabId: tab.id})
    // if (tab.pinned) {
    //   await tabs.update(tab.id, {pinned: true})
    // }
    // debug('Tab' + tab.id + ' moved to new window' + windowInfo.id + '[0]')

    const windowInfo = await windows.create()
    const tabIds = windowInfo.tabs.map((tab) => tab.id)
    await moveOne(tab, windowInfo.id)
    await tabs.remove(tabIds)

    return windowInfo
  }

  // 移す
  async function run (tabIds, toWindowId) {
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
    await run(tabIds.slice(1), windowInfo.id)
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
  async function wrappedRawRun (tabIds, toWindowId, notification) {
    try {
      if (notification) {
        await notify(i18n.getMessage(KEY_MOVING))
      }

      const start = new Date()
      await run(tabIds, toWindowId)
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
  async function wrappedRun (tabId, keyType, toWindowId, notification) {
    const tabIds = await listing(tabId, keyType)
    await wrappedRawRun(tabIds, toWindowId, notification)
  }

  function handler (message, sender, sendResponse) {
    (async function () {
      debug('Message ' + JSON.stringify(message) + ' was received')
      switch (message.type) {
        case KEY_SELECT_SIZE: {
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
          const {
            keyType,
            toWindowId,
            notification
          } = message
          switch (keyType) {
            case KEY_RAW: {
              const {tabIds} = message
              await wrappedRawRun(tabIds, toWindowId, notification)
            }
          }
          break
        }
      }
    })().catch(onError)
  }

  // 初期化
  (async function () {
    // メッセージを受け取る
    runtime.onMessage.addListener(handler)
  })().catch(onError)

  _export = Object.freeze({
    run: wrappedRun,
    rawRun: wrappedRawRun,
    select,
    getSelectWindowId
  })
}

const move = _export
