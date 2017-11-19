'use strict'

const {
  i18n
} = browser
const {
  KEY_MENU_ITEMS,
  KEY_SELECT_SIZE,
  KEY_WIDTH,
  KEY_HEIGHT,
  KEY_SELECT_SAVE,
  KEY_NOTIFICATION,
  KEY_SAVE,
  ALL_MENU_ITEMS,
  DEFAULT_MENU_ITEMS,
  DEFAULT_SELECT_SIZE,
  DEFAULT_SELECT_SAVE,
  DEFAULT_NOTIFICATION,
  storageArea,
  debug,
  onError
} = common

const LABEL_KEYS = ALL_MENU_ITEMS.concat([KEY_MENU_ITEMS, KEY_SELECT_SIZE, KEY_SELECT_SAVE, KEY_NOTIFICATION, KEY_WIDTH, KEY_HEIGHT, KEY_SAVE])

/*
 * {
 *   "menuItems": ["one", "all", ...],
 *   "selectSize": [640, 480],
 *   "selectSave": false,
 *   "notification": true
 * }
 */

// 現在の設定を表示する
async function restore () {
  const data = await storageArea.get()
  debug('Loaded ' + JSON.stringify(data))

  const {
    [KEY_MENU_ITEMS]: menuItems = DEFAULT_MENU_ITEMS,
    [KEY_SELECT_SIZE]: selectSize = DEFAULT_SELECT_SIZE,
    [KEY_SELECT_SAVE]: selectSave = DEFAULT_SELECT_SAVE,
    [KEY_NOTIFICATION]: notification = DEFAULT_NOTIFICATION
  } = data

  const menuItemSet = new Set(menuItems)
  ALL_MENU_ITEMS.forEach((key) => {
    document.getElementById(key).checked = menuItemSet.has(key)
  })

  document.getElementById(KEY_WIDTH).value = selectSize[0]
  document.getElementById(KEY_HEIGHT).value = selectSize[1]

  document.getElementById(KEY_SELECT_SAVE).checked = selectSave

  document.getElementById(KEY_NOTIFICATION).checked = notification
}

// 設定を保存する
async function save () {
  const menuItems = []
  ALL_MENU_ITEMS.forEach((key) => {
    if (document.getElementById(key).checked) {
      menuItems.push(key)
    }
  })

  const selectSize = [
    Number(document.getElementById(KEY_WIDTH).value),
    Number(document.getElementById(KEY_HEIGHT).value)
  ]

  const selectSave = document.getElementById(KEY_SELECT_SAVE).checked

  const notification = document.getElementById(KEY_NOTIFICATION).checked

  const data = {
    [KEY_MENU_ITEMS]: menuItems,
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
  const ul = document.getElementById(KEY_MENU_ITEMS)
  ALL_MENU_ITEMS.forEach((key) => {
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
  document.getElementById(KEY_SAVE).addEventListener('click', (e) => save().catch(onError))
})().catch(onError)
