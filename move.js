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
    KEY_PROGRESS,
    KEY_SUCCESS_MESSAGE,
    KEY_FAILURE_MESSAGE,
    KEY_RESET,
    DEFAULT_SELECT_SIZE,
    DEFAULT_SELECT_SAVE,
    NOTIFICATION_ID,
    NOTIFICATION_INTERVAL,
    POLLING_INTERVAL,
    BULK_SIZE,
    storageArea,
    debug,
    onError,
    getValue,
    asleep
  } = common
  const {
    isActiveTab
  } = monitor

  // タブ選択ウインドウ
  // タブ選択ウインドウは1つとする
  let selectWindowId

  function getSelectWindowId () {
    return selectWindowId
  }

  // 選択ウインドウをつくる
  async function select (fromWindowId, toWindowId, notification, focus, onCreate) {
    function resetWindow () {
      runtime.sendMessage({
        type: KEY_RESET,
        fromWindowId,
        toWindowId,
        notification,
        focus
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
        debug('Waiting select window...')
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
  async function activateBest (windowId, ...excludeedTabIdLists) {
    const excludedTabIds = []
    for (const excludeedTabIdList of excludeedTabIdLists) {
      Array.prototype.push.apply(excludedTabIds, excludeedTabIdList)
    }
    const moveTabIdSet = new Set(excludedTabIds)

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

  async function moveTarget (tabIds, toWindowId, index, pinnedTabIds, unpinnedTabIds, focus) {
    for (const tabId of tabIds) {
      if (isActiveTab(tabId)) {
        const tab = await tabs.get(tabId)
        await activateBest(tab.windowId, pinnedTabIds, unpinnedTabIds)
        break
      }
    }
    const newTabs = await tabs.move(tabIds, {windowId: toWindowId, index})
    if (focus) {
      await windows.update(toWindowId, {focused: true})
      await tabs.update(newTabs[newTabs.length - 1].id, {active: true})
    }
    debug('Tabs' + tabIds + ' moved to window' + toWindowId + ' ' + index)
  }

  async function runWithWindow (pinnedTabIds, unpinnedTabIds, toWindowId, progress, focus) {
    async function _run (target, index, focus) {
      await moveTarget(target, toWindowId, index, pinnedTabIds, unpinnedTabIds, focus)
      progress.done += target.length
    }

    if (pinnedTabIds.length > 0) {
      const index = await searchLastPinnedIndex(toWindowId) + 1
      for (let i = pinnedTabIds.length; i > 0; i -= BULK_SIZE) {
        const target = pinnedTabIds.slice(Math.max(i - BULK_SIZE, 0), i)
        await _run(target, index, focus && unpinnedTabIds.length === 0)
      }
    }
    if (unpinnedTabIds.length > 0) {
      for (let i = 0; i < unpinnedTabIds.length; i += BULK_SIZE) {
        const target = unpinnedTabIds.slice(i, i + BULK_SIZE)
        await _run(target, -1, focus)
      }
    }
  }

  async function runWithNewWindow (pinnedTabIds, unpinnedTabIds, progress, focus) {
    // 未ロードのタブを以下のようにウインドウ作成時に渡すと失敗する (Firefox 55)
    // TODO Firefox 57 からは discarded を調べてリロードしてからやれば良い
    // const windowInfo = await windows.create({tabId})
    // if (pinned) {
    //   await tabs.update(tabId, {pinned})
    // }

    let target
    let nextPinnedTabIds
    let nextUnpinnedTabIds
    if (pinnedTabIds.length > 0) {
      target = pinnedTabIds.slice(0, BULK_SIZE)
      nextPinnedTabIds = pinnedTabIds.slice(target.length)
      nextUnpinnedTabIds = unpinnedTabIds
    } else {
      target = unpinnedTabIds.slice(0, BULK_SIZE)
      nextPinnedTabIds = pinnedTabIds
      nextUnpinnedTabIds = unpinnedTabIds.slice(target.length)
    }

    const windowInfo = await windows.create()
    const tabIds = windowInfo.tabs.map((tab) => tab.id)
    await moveTarget(target, windowInfo.id, 0, pinnedTabIds, unpinnedTabIds, focus)
    await tabs.remove(tabIds)

    progress.done += target.length
    await runWithWindow(nextPinnedTabIds, nextUnpinnedTabIds, windowInfo.id, progress, focus)
  }

  // 移す
  async function run (tabIds, toWindowId, progress, focus) {
    if (tabIds.length <= 0) {
      return
    }

    const pinnedTabIds = []
    const unpinnedTabIds = []
    for (const tabId of tabIds) {
      const tab = await tabs.get(tabId)
      if (tab.pinned) {
        pinnedTabIds.push(tabId)
      } else {
        unpinnedTabIds.push(tabId)
      }
      if (tab.active) {
        await activateBest(tab.windowId, tabIds)
      }
    }

    if (toWindowId) {
      await runWithWindow(pinnedTabIds, unpinnedTabIds, toWindowId, progress, focus)
    } else {
      await runWithNewWindow(pinnedTabIds, unpinnedTabIds, progress, focus)
    }
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

  async function startProgressNotification (progress) {
    while (true) {
      await asleep(NOTIFICATION_INTERVAL)
      if (progress.end || progress.error) {
        break
      }
      notify(progress)
    }
  }

  // 通知を表示する
  async function notify (progress) {
    let message
    if (progress.error) {
      message = i18n.getMessage(KEY_FAILURE_MESSAGE, progress.error)
    } else if (progress.end) {
      const seconds = (progress.end - progress.start) / 1000
      message = i18n.getMessage(KEY_SUCCESS_MESSAGE, [seconds, progress.all, progress.done])
    } else if (progress.start && progress.all) {
      const seconds = (new Date() - progress.start) / 1000
      const percentage = Math.floor(progress.done * 100 / progress.all)
      message = i18n.getMessage(KEY_PROGRESS, [seconds, percentage])
    } else {
      message = i18n.getMessage(KEY_MOVING)
    }
    await notifications.create(NOTIFICATION_ID, {
      'type': 'basic',
      'title': NOTIFICATION_ID,
      message
    })
  }

  // 前後処理で挟む
  async function wrappedRawRun (tabIds, toWindowId, notification, focus) {
    const progress = {
      all: tabIds.length,
      done: 0
    }
    try {
      if (notification) {
        await notify(progress)
        startProgressNotification(progress)
        progress.start = new Date()
      }

      await run(tabIds, toWindowId, progress, focus)
      debug('Finished')

      if (notification) {
        progress.end = new Date()
        await notify(progress)
      }
    } catch (e) {
      onError(e)
      if (notification) {
        progress.error = e
        await notify(progress)
      }
    }
  }

  // 前後処理で挟む
  async function wrappedRun (tabId, keyType, toWindowId, notification, focus) {
    const tabIds = await listing(tabId, keyType)
    await wrappedRawRun(tabIds, toWindowId, notification, focus)
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
            notification,
            focus
          } = message
          switch (keyType) {
            case KEY_RAW: {
              const {tabIds} = message
              await wrappedRawRun(tabIds, toWindowId, notification, focus)
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
