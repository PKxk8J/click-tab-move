import {
  DEFAULT_FOCUS,
  DEFAULT_NOTIFICATION,
  KEY_CANCEL,
  KEY_FOCUS,
  KEY_MOVE,
  KEY_MOVE_TO_X,
  KEY_NEW_WINDOW,
  KEY_NOTIFICATION,
  KEY_RAW,
  KEY_RESET,
  KEY_SELECT,
  KEY_SELECT_SIZE,
  KEY_TO_WINDOW_ID,
  debug,
  onError,
} from './common.js'

const {
  i18n,
  runtime,
  tabs,
  windows,
} = browser

async function closeWindow () {
  const windowInfo = await windows.getCurrent()
  runtime.sendMessage({
    type: KEY_SELECT_SIZE,
    selectSize: [windowInfo.width, windowInfo.height],
  })

  await windows.remove(windowInfo.id)
  debug('Select window ' + windowInfo.id + ' was closed')
}

function getSelectedTabIds () {
  const select = document.getElementById(KEY_SELECT)
  return [...select.options].
    filter((option) => option.selected).
    map((option) => Number(option.value))
}

function getOptionalWindowId () {
  const value = document.getElementById(KEY_TO_WINDOW_ID).value
  if (value === '') {
    return undefined
  }
  return Number(value)
}

function sendResult () {
  runtime.sendMessage({
    type: KEY_MOVE,
    keyType: KEY_RAW,
    tabIds: getSelectedTabIds(),
    toWindowId: getOptionalWindowId(),
    notification: document.getElementById(KEY_NOTIFICATION).value === 'true',
    focus: document.getElementById(KEY_FOCUS).value === 'true',
  })
}

async function reset (fromWindowId, toWindowId, notification, focus) {
  let title
  if (toWindowId) {
    const [tab] = await tabs.query({ windowId: toWindowId, active: true })
    title = i18n.getMessage(KEY_MOVE_TO_X, toWindowId + ': ' + tab.title)
    document.getElementById(KEY_TO_WINDOW_ID).value = String(toWindowId)
  } else {
    title = i18n.getMessage(KEY_MOVE_TO_X, i18n.getMessage(KEY_NEW_WINDOW))
    document.getElementById(KEY_TO_WINDOW_ID).value = ''
  }
  document.title = title
  document.getElementById(KEY_MOVE_TO_X).textContent = title

  document.getElementById(KEY_NOTIFICATION).value = String(notification)
  document.getElementById(KEY_FOCUS).value = String(focus)

  const tabList = await tabs.query({ windowId: fromWindowId })
  tabList.sort((tab1, tab2) => tab1.index - tab2.index)

  const select = document.getElementById(KEY_SELECT)
  select.replaceChildren()
  for (const tab of tabList) {
    const option = document.createElement('option')
    option.value = String(tab.id)
    option.textContent = tab.title
    select.appendChild(option)
  }

  select.focus()
  await windows.update(windows.WINDOW_ID_CURRENT, { focused: true })
}

async function handleMessage (message) {
  debug('Message ' + JSON.stringify(message) + ' was received')
  if (message.type !== KEY_RESET) {
    return
  }

  await reset(
    message.fromWindowId,
    message.toWindowId,
    message.notification ?? DEFAULT_NOTIFICATION,
    message.focus ?? DEFAULT_FOCUS,
  )
}

function setLabelText (id, key) {
  document.getElementById(id).textContent = i18n.getMessage(key)
}

async function init () {
  setLabelText('label_' + KEY_MOVE, KEY_MOVE)
  setLabelText('label_' + KEY_CANCEL, KEY_CANCEL)

  document.getElementById(KEY_MOVE).addEventListener('click', () => {
    ;(async () => {
      sendResult()
      await closeWindow()
    })().catch(onError)
  })
  document.getElementById(KEY_CANCEL).addEventListener('click', () => {
    closeWindow().catch(onError)
  })
  document.getElementById(KEY_SELECT).addEventListener('dblclick', () => {
    ;(async () => {
      sendResult()
      await closeWindow()
    })().catch(onError)
  })

  runtime.onMessage.addListener((message) => {
    return handleMessage(message).catch(onError)
  })
}

init().catch(onError)
