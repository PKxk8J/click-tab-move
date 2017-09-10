'use strict'

const { i18n, storage } = browser
const storageArea = storage.sync

const KEY_DEBUG = 'debug'

const KEY_ONE = 'one'
const KEY_RIGHT = 'right'
const KEY_LEFT = 'left'
const KEY_ALL = 'all'
const KEY_SELECT = 'select'

const KEY_MENU_ITEM = 'menuItem'
const KEY_SELECT_SIZE = 'selectSize'
const KEY_SELECT_SAVE = 'selectSave'
const KEY_NOTIFICATION = 'notification'

const KEY_WIDTH = 'width'
const KEY_HEIGHT = 'height'
const KEY_SAVE = 'save'

const MENU_ITEM_KEYS = [KEY_ONE, KEY_RIGHT, KEY_LEFT, KEY_ALL, KEY_SELECT]
const LABEL_KEYS = MENU_ITEM_KEYS.concat([KEY_MENU_ITEM, KEY_SELECT_SIZE, KEY_SELECT_SAVE, KEY_NOTIFICATION, KEY_WIDTH, KEY_HEIGHT, KEY_SAVE])

/*
 * {
 *   "menuItem": ["one", "all", ...],
 *   "selectSize": [640, 480],
 *   "selectSave": false,
 *   "notification": true
 * }
 */

const DEFAULT_MENU_ITEM = [KEY_ONE, KEY_RIGHT, KEY_ALL]
const DEFAULT_SELECT_SIZE = [640, 480]
const DEFAULT_SELECT_SAVE = true
const DEFAULT_NOTIFICATION = false

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error(error)
}

// 現在の設定を表示する
async function restore () {
  const data = await storageArea.get()
  debug('Loaded ' + JSON.stringify(data))

  const {
    [KEY_MENU_ITEM]: menuItem = DEFAULT_MENU_ITEM,
    [KEY_SELECT_SIZE]: selectSize = DEFAULT_SELECT_SIZE,
    [KEY_SELECT_SAVE]: selectSave = DEFAULT_SELECT_SAVE,
    [KEY_NOTIFICATION]: notification = DEFAULT_NOTIFICATION
  } = data

  const menuItemSet = new Set(menuItem)
  MENU_ITEM_KEYS.forEach((key) => {
    document.getElementById(key).checked = menuItemSet.has(key)
  })

  document.getElementById(KEY_WIDTH).value = selectSize[0]
  document.getElementById(KEY_HEIGHT).value = selectSize[1]

  document.getElementById(KEY_SELECT_SAVE).checked = selectSave

  document.getElementById(KEY_NOTIFICATION).checked = notification
}

// 設定を保存する
async function save () {
  const menuItem = []
  MENU_ITEM_KEYS.forEach((key) => {
    if (document.getElementById(key).checked) {
      menuItem.push(key)
    }
  })

  const selectSize = [
    Number(document.getElementById(KEY_WIDTH).value),
    Number(document.getElementById(KEY_HEIGHT).value)
  ]

  const selectSave = document.getElementById(KEY_SELECT_SAVE).checked

  const notification = document.getElementById(KEY_NOTIFICATION).checked

  const data = {
    [KEY_MENU_ITEM]: menuItem,
    [KEY_SELECT_SIZE]: selectSize,
    [KEY_SELECT_SAVE]: selectSave,
    [KEY_NOTIFICATION]: notification
  }
  // 古い形式のデータを消す
  await storageArea.clear()
  await storageArea.set(data)
  debug('Saved ' + JSON.stringify(data))
}

// 初期化
(async function () {
  const ul = document.getElementById(KEY_MENU_ITEM)
  MENU_ITEM_KEYS.forEach((key) => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = key
    const span = document.createElement('span')
    span.id = 'label_' + key
    const label = document.createElement('label')
    label.appendChild(input)
    label.appendChild(span)
    const li = document.createElement('li')
    li.appendChild(label)

    ul.appendChild(li)
  })

  LABEL_KEYS.forEach((key) => {
    document.getElementById('label_' + key).textContent = ' ' + i18n.getMessage(key) + ' '
  })

  document.addEventListener('DOMContentLoaded', (e) => restore().catch(onError))
  document.getElementById('save').addEventListener('click', (e) => save().catch(onError))
})().catch(onError)
