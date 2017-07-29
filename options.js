'use strict'

const { i18n, storage } = browser
const storageArea = storage.sync

const KEY_DEBUG = 'debug'

const KEY_ONE = 'one'
const KEY_ALL = 'all'
const KEY_SELECT = 'select'

const KEY_MENU_ITEM = 'menuItem'
const KEY_SELECT_SIZE = 'selectSize'

const KEY_WIDTH = 'width'
const KEY_HEIGHT = 'height'
const KEY_SAVE = 'save'

/*
 * {
 *   "menuItem": ["one", "all", ...],
 *   "selectSize": [640, 480]
 * }
 */

const DEFAULT_MENU_ITEM = [KEY_ONE, KEY_ALL, KEY_SELECT]
const DEFAULT_SELECT_SIZE = [640, 480]

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
  const {
    menuItem = DEFAULT_MENU_ITEM,
    selectSize = DEFAULT_SELECT_SIZE
  } = await storageArea.get()
  debug('Loaded ' + JSON.stringify({menuItem, selectSize}))

  const menuItemSet = new Set(menuItem)
  ;[KEY_ONE, KEY_ALL, KEY_SELECT].forEach((key) => {
    document.getElementById(key).checked = menuItemSet.has(key)
  })

  document.getElementById(KEY_WIDTH).value = selectSize[0]
  document.getElementById(KEY_HEIGHT).value = selectSize[1]
}

// 設定を保存する
async function save () {
  const menuItem = []
  ;[KEY_ONE, KEY_ALL, KEY_SELECT].forEach((key) => {
    if (document.getElementById(key).checked) {
      menuItem.push(key)
    }
  })

  const selectSize = [
    Number(document.getElementById(KEY_WIDTH).value),
    Number(document.getElementById(KEY_HEIGHT).value)
  ]

  await storageArea.set({menuItem, selectSize})
  debug('Saved ' + JSON.stringify({menuItem, selectSize}))
}

// 初期化
(async function () {
  [KEY_MENU_ITEM, KEY_ONE, KEY_ALL, KEY_SELECT, KEY_SELECT_SIZE, KEY_WIDTH, KEY_HEIGHT, KEY_SAVE].forEach((key) => {
    document.getElementById('label_' + key).innerText = i18n.getMessage(key)
  })

  document.addEventListener('DOMContentLoaded', () => restore().catch(onError))
  document.getElementById('form').addEventListener('submit', (e) => (async function () {
    e.preventDefault()
    await save()
  })().catch(onError))
})().catch(onError)
