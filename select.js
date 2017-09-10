'use strict'

const { i18n, runtime, tabs, windows } = browser

const KEY_DEBUG = 'debug'

const KEY_SELECT = 'select'
const KEY_SELECT_SIZE = 'selectSize'
const KEY_RAW = 'raw'
const KEY_RESET = 'reset'
const KEY_TO_WINDOW_ID = 'toWindowId'
const KEY_NOTIFICATION = 'notification'

const KEY_MOVE = 'move'
const KEY_CANCEL = 'cancel'
const KEY_MOVE_TO_X = 'moveToX'
const KEY_NEW_WINDOW = 'newWindow'

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error(error)
}

// 選択ボックスのサイズ変更のための監視間隔（ミリ秒）
const RESIZE_INTERVAL = 300

// ウインドウを閉じる
async function close () {
  // ウインドウサイズを通知する
  const windowInfo = await windows.getCurrent()
  runtime.sendMessage({
    type: KEY_SELECT_SIZE,
    selectSize: [windowInfo.width, windowInfo.height]
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
  const notification = Boolean(document.getElementById(KEY_NOTIFICATION).value)
  runtime.sendMessage({
    type: KEY_MOVE,
    keyType: KEY_RAW,
    tabIds: ids,
    toWindowId,
    notification
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

function resizeLoop () {
  resizeSelectBox()
  setTimeout(resizeLoop, RESIZE_INTERVAL)
}

// 表示を更新する
async function reset (fromWindowId, toWindowId, notification) {
  let title
  if (toWindowId) {
    const [tab] = await tabs.query({windowId: toWindowId, active: true})
    title = i18n.getMessage(KEY_MOVE_TO_X, toWindowId + ': ' + tab.title)
    document.getElementById(KEY_TO_WINDOW_ID).value = toWindowId
  } else {
    title = i18n.getMessage(KEY_MOVE_TO_X, i18n.getMessage(KEY_NEW_WINDOW))
    delete document.getElementById(KEY_TO_WINDOW_ID).value
  }
  document.title = title

  const header = document.getElementById(KEY_MOVE_TO_X)
  header.textContent = title

  const tabList = await tabs.query({windowId: fromWindowId})
  tabList.sort((tab1, tab2) => tab1.index - tab2.index)

  document.getElementById(KEY_NOTIFICATION).value = notification

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
  await windows.update(windows.WINDOW_ID_CURRENT, {focused: true})
}

// 初期化
(async function () {
  // ボタンの初期化
  ;[KEY_MOVE, KEY_CANCEL].forEach((key) => {
    document.getElementById('label_' + key).textContent = i18n.getMessage(key)
  })
  document.getElementById(KEY_MOVE).addEventListener('click', (e) => (async function () {
    sendResult()
    await close()
  })().catch(onError))
  document.getElementById(KEY_CANCEL).addEventListener('click', (e) => close().catch(onError))

  // move.js から起点になるメッセージを受け取る
  runtime.onMessage.addListener((message, sender, sendResponse) => (async function () {
    debug('Message ' + JSON.stringify(message) + ' was received')

    switch (message.type) {
      case KEY_RESET: {
        const {
          fromWindowId,
          toWindowId,
          notification = false
        } = message
        await reset(fromWindowId, toWindowId, notification)
        break
      }
    }
  })().catch(onError))

  // 選択ボックスを監視して必要ならサイズを変更する
  resizeLoop()
})().catch(onError)
