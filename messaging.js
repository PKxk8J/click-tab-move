'use strict'

// メッセージインターフェース

{
  const {
    runtime,
    tabs
  } = browser
  const {
    KEY_ONE,
    KEY_RIGHT,
    KEY_LEFT,
    KEY_ALL,
    KEY_SELECT,
    KEY_RAW,
    KEY_MOVE,
    debug,
    onError
  } = common
  const {
    run,
    select,
    rawRun
  } = move

  function handler (message, sender, sendResponse) {
    (async function () {
      debug('Message ' + JSON.stringify(message) + ' was received')
      switch (message.type) {
        case KEY_MOVE: {
          const {
            keyType,
            toWindowId,
            notification,
            focus
          } = message
          switch (keyType) {
            case KEY_ONE:
            case KEY_RIGHT:
            case KEY_LEFT:
            case KEY_ALL: {
              const {tabId} = message
              await run(tabId, keyType, toWindowId, notification, focus)
              break
            }
            case KEY_SELECT: {
              const {tabId} = message
              const [tab] = await tabs.get(tabId)
              await select(tab.windowId, toWindowId, notification, focus)
              break
            }
            case KEY_RAW: {
              const {tabIds} = message
              await rawRun(tabIds, toWindowId, notification, focus)
              break
            }
          }
        }
      }
    })().catch(onError)
  }

  // 初期化
  (async function () {
    // メッセージから実行
    runtime.onMessageExternal.addListener(handler)
  })().catch(onError)
}
