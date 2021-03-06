'use strict'

const {
  i18n,
  runtime,
  tabs,
  windows,
} = browser
const {
  KEY_SELECT,
  KEY_RAW,
  KEY_MOVE,
  KEY_MOVE_TO_X,
  KEY_SELECT_SIZE,
  KEY_NOTIFICATION,
  KEY_FOCUS,
  KEY_RESET,
  KEY_NEW_WINDOW,
  KEY_CANCEL,
  KEY_TO_WINDOW_ID,
  POLLING_INTERVAL,
  DEFAULT_NOTIFICATION,
  DEFAULT_FOCUS,
  debug,
  onError,
  asleep,
} = common

// ウインドウを閉じる
async function close () {
  // ウインドウサイズを通知する
  const windowInfo = await windows.getCurrent()
  runtime.sendMessage({
    type: KEY_SELECT_SIZE,
    selectSize: [windowInfo.width, windowInfo.height],
  })

  const id = windows.WINDOW_ID_CURRENT
  await windows.remove(id)
  debug('Select window ' + id + ' was closed')
}

// 移動対象の選択結果を move.js に通知する
function sendResult () {
  const select = document.getElementById(KEY_SELECT)
  const ids = []
  for (let option of select.childNodes) {
    if (option.selected) {
      ids.push(Number(option.id))
    }
  }
  const toWindowId = Number(document.getElementById(KEY_TO_WINDOW_ID).value)
  const notification = document.getElementById(KEY_NOTIFICATION).value ===
    'true'
  const focus = document.getElementById(KEY_FOCUS).value === 'true'
  runtime.sendMessage({
    type: KEY_MOVE,
    keyType: KEY_RAW,
    tabIds: ids,
    toWindowId,
    notification,
    focus,
  })
}

// 選択ボックスのサイズを変更する
function resizeSelectBox () {
  const select = document.getElementById(KEY_SELECT)
  const options = select.childNodes
  let size = 0
  if (options.length > 0) {
    const frameHeight = document.documentElement.clientHeight
    const contentHeight = document.body.offsetHeight
    const optionHeight = options[0].offsetHeight
    const overhead = contentHeight - select.size * optionHeight
    const space = frameHeight - overhead
    size = Math.floor(space / optionHeight)
  }
  size = Math.min(options.length, size)
  if (size !== select.size) {
    select.size = size
  }
}

async function startResizeLoop () {
  while (true) {
    resizeSelectBox()
    await asleep(POLLING_INTERVAL)
  }
}

// 表示を更新する
async function reset (fromWindowId, toWindowId, notification, focus) {
  let title
  if (toWindowId) {
    const [tab] = await tabs.query({ windowId: toWindowId, active: true })
    title = i18n.getMessage(KEY_MOVE_TO_X, toWindowId + ': ' + tab.title)
    document.getElementById(KEY_TO_WINDOW_ID).value = toWindowId
  } else {
    title = i18n.getMessage(KEY_MOVE_TO_X, i18n.getMessage(KEY_NEW_WINDOW))
    delete document.getElementById(KEY_TO_WINDOW_ID).value
  }
  document.title = title

  const header = document.getElementById(KEY_MOVE_TO_X)
  header.textContent = title

  const tabList = await tabs.query({ windowId: fromWindowId })
  tabList.sort((tab1, tab2) => tab1.index - tab2.index)

  document.getElementById(KEY_NOTIFICATION).value = String(notification)

  document.getElementById(KEY_FOCUS).value = String(focus)

  const select = document.getElementById(KEY_SELECT)
  while (select.firstChild) {
    select.removeChild(select.firstChild)
  }
  for (let tab of tabList) {
    const option = document.createElement('option')
    option.id = tab.id
    option.textContent = tab.title
    select.appendChild(option)
  }

  select.focus()
  await windows.update(windows.WINDOW_ID_CURRENT, { focused: true })
}

// 初期化
(async function () {
  // ボタンの初期化
  ;[KEY_MOVE, KEY_CANCEL].forEach((key) => {
    document.getElementById('label_' + key).textContent = i18n.getMessage(key)
  })
  document.getElementById(KEY_MOVE).
    addEventListener('click', (e) => (async function () {
      sendResult()
      await close()
    })().catch(onError))
  document.getElementById(KEY_CANCEL).
    addEventListener('click', (e) => close().catch(onError))

  // move.js から起点になるメッセージを受け取る
  runtime.onMessage.addListener(
    (message, sender, sendResponse) => (async function () {
      debug('Message ' + JSON.stringify(message) + ' was received')

      switch (message.type) {
        case KEY_RESET: {
          const {
            fromWindowId,
            toWindowId,
            notification = DEFAULT_NOTIFICATION,
            focus = DEFAULT_FOCUS,
          } = message
          await reset(fromWindowId, toWindowId, notification, focus)
          break
        }
      }
    })().catch(onError))

  // 選択ボックスを監視して必要ならサイズを変更する
  startResizeLoop()
})().catch(onError)
