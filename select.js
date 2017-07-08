'use strict'

const { i18n, runtime, tabs, windows } = browser

const KEY_DEBUG = 'debug'

const KEY_MOVE = 'move'
const KEY_CANCEL = 'cancel'

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error('Error: ' + error)
}

[KEY_MOVE, KEY_CANCEL].forEach((key) => {
  document.getElementById('label_' + key).innerText = i18n.getMessage(key)
})

// ウインドウを閉じる
function close () {
  const id = windows.WINDOW_ID_CURRENT
  const removing = windows.remove(id)
  removing.then(() => debug('Window ' + id + ' was closed'), onError)
}

// 移動対象を move.js に通知する
function sendMoveMessage () {
  const select = document.getElementById('select')
  const ids = []
  for (let option of select.childNodes) {
    if (option.selected) {
      ids.push(option.id)
    }
  }
  runtime.sendMessage({type: 'move', tabIds: ids})
}

document.getElementById(KEY_MOVE).addEventListener('click', () => {
  sendMoveMessage()
  close()
})
document.getElementById(KEY_CANCEL).addEventListener('click', close)

// 表示を更新する
function update (fromWindowId) {
  const querying = tabs.query({windowId: fromWindowId})
  querying.then((tabList) => {
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
  }, onError)
}

runtime.onMessage.addListener((message, sender, sendResponse) => {
  debug('Message ' + JSON.stringify(message) + ' was received')
  switch (message.type) {
    case 'update': {
      const { fromWindowId } = message
      update(fromWindowId)
      break
    }
  }
})

runtime.sendMessage({type: 'started'})
