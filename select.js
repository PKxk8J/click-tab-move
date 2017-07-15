'use strict'

const { i18n, runtime, tabs, windows } = browser

const KEY_DEBUG = 'debug'

const KEY_MOVE = 'move'
const KEY_CANCEL = 'cancel'
const KEY_MOVE_TO_X = 'moveToX'

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error(error)
  if (DEBUG && error.stack) {
    console.error(error.stack)
  }
}

// 選択ボックスのサイズ変更のための監視間隔（ミリ秒）
const RESIZE_INTERVAL = 500

// ウインドウを閉じる
async function close () {
  const id = windows.WINDOW_ID_CURRENT
  await windows.remove(id)
  debug('Select window ' + id + ' was closed')
}

// 移動対象を move.js に通知する
function sendMoveMessage () {
  const select = document.getElementById('select')
  const ids = []
  for (let option of select.childNodes) {
    if (option.selected) {
      ids.push(Number(option.id))
    }
  }
  runtime.sendMessage({type: 'move', tabIds: ids})
}

// ボタンの初期化
;[KEY_MOVE, KEY_CANCEL].forEach((key) => {
  document.getElementById('label_' + key).innerText = i18n.getMessage(key)
})
document.getElementById(KEY_MOVE).addEventListener('click', () => (async function () {
  sendMoveMessage()
  await close()
})().catch(onError))
document.getElementById(KEY_CANCEL).addEventListener('click', () => close().catch(onError))

// 選択ボックスのサイズを変更する
function resizeSelectBox () {
  const select = document.getElementById('select')
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

// 選択ボックスを監視して必要ならサイズを変更する
resizeLoop()

// 表示を更新する
async function update (fromWindowId, toWindowId, toWindowTitle) {
  const title = i18n.getMessage(KEY_MOVE_TO_X, (toWindowId ? toWindowId + ': ' : '') + toWindowTitle)
  document.title = title

  const header = document.getElementById(KEY_MOVE_TO_X)
  header.innerText = title

  const tabList = await tabs.query({windowId: fromWindowId})
  tabList.sort((tab1, tab2) => tab1.index - tab2.index)

  const select = document.getElementById('select')
  while (select.firstChild) {
    select.removeChild(select.firstChild)
  }
  for (let tab of tabList) {
    const option = document.createElement('option')
    option.id = tab.id
    option.innerText = tab.title
    select.appendChild(option)
  }
}

// move.js から起点になるメッセージを受け取る
runtime.onMessage.addListener((message, sender, sendResponse) => (async function () {
  debug('Message ' + JSON.stringify(message) + ' was received')

  switch (message.type) {
    case 'update': {
      const { fromWindowId, toWindowId, toWindowTitle } = message
      await update(fromWindowId, toWindowId, toWindowTitle)
      break
    }
  }
})().catch(onError))

// move.js に下準備が終わったことを報せる
runtime.sendMessage({type: 'started'})
