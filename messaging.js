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

  function handler (message, sender, sendResponse) {
    (async function () {
      debug('Message ' + JSON.stringify(message) + ' was received')
      switch (message.type) {
        case KEY_MOVE: {
          const {
            keyType,
            toWindowId,
            notification
          } = message
          switch (keyType) {
            case KEY_ONE:
            case KEY_RIGHT:
            case KEY_LEFT:
            case KEY_ALL: {
              const {tabId} = message
              await move.run(tabId, keyType, toWindowId, notification)
              break
            }
            case KEY_SELECT: {
              const {tabId} = message
              const [tab] = await tabs.get(tabId)
              await move.select(tab.windowId, toWindowId, notification)
              break
            }
            case KEY_RAW: {
              const {tabIds} = message
              await move.rawRun(tabIds, toWindowId, notification)
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
