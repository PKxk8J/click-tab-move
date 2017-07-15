'use strict'

const { i18n, storage } = browser
const storageArea = storage.sync

const KEY_DEBUG = 'debug'

const KEY_ONE = 'one'
const KEY_ONE_RELOAD = 'oneReload'
const KEY_ALL = 'all'
const KEY_ALL_RELOAD = 'allReload'
const KEY_SELECT = 'select'
const KEY_SELECT_RELOAD = 'selectReload'

const KEY_MENU_ITEM = 'menuItem'
const KEY_SELECT_SIZE = 'selectSize'
const KEY_SELECT_WIDTH = 'selectWidth'
const KEY_SELECT_HEIGHT = 'selectHeight'
const KEY_WIDTH = 'width'
const KEY_HEIGHT = 'height'
const KEY_SAVE = 'save'
const KEY_RELOAD_DESC = 'reloadDescription'

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error(error)
}

// bool が undefined でなく false のときだけ false になるように
function falseIffFalse (bool) {
  if (typeof bool === 'undefined') {
    return true
  }
  return bool
}

[KEY_MENU_ITEM, KEY_ONE, KEY_ONE_RELOAD, KEY_ALL, KEY_ALL_RELOAD, KEY_SELECT, KEY_SELECT_RELOAD, KEY_SELECT_SIZE, KEY_WIDTH, KEY_HEIGHT, KEY_SAVE].forEach((key) => {
  document.getElementById('label_' + key).innerText = i18n.getMessage(key)
})

;[KEY_ONE_RELOAD, KEY_ALL_RELOAD, KEY_SELECT_RELOAD].forEach((key) => {
  document.getElementById('description_' + key).innerText = i18n.getMessage(KEY_RELOAD_DESC)
})

// 現在の設定を表示する
async function restore () {
  const result = await storageArea.get()
  debug('Loaded ' + JSON.stringify(result))

  const flags = {
    [KEY_ONE]: falseIffFalse(result[KEY_ONE]),
    [KEY_ONE_RELOAD]: result[KEY_ONE_RELOAD],
    [KEY_ALL]: falseIffFalse(result[KEY_ALL]),
    [KEY_ALL_RELOAD]: result[KEY_ALL_RELOAD],
    [KEY_SELECT]: falseIffFalse(result[KEY_SELECT]),
    [KEY_SELECT_RELOAD]: result[KEY_SELECT_RELOAD]
  }
  Object.keys(flags).forEach((key) => {
    document.getElementById(key).checked = flags[key]
  })

  const values = {
    [KEY_SELECT_WIDTH]: result[KEY_SELECT_WIDTH] || 640,
    [KEY_SELECT_HEIGHT]: result[KEY_SELECT_HEIGHT] || 480
  }
  Object.keys(values).forEach((key) => {
    document.getElementById(key).value = values[key]
  })
}

async function save () {
  const result = {}
  ;[KEY_ONE, KEY_ONE_RELOAD, KEY_ALL, KEY_ALL_RELOAD, KEY_SELECT, KEY_SELECT_RELOAD].forEach((key) => {
    result[key] = document.getElementById(key).checked
  })
  ;[KEY_SELECT_WIDTH, KEY_SELECT_HEIGHT].forEach((key) => {
    result[key] = Number(document.getElementById(key).value)
  })

  await storageArea.set(result)
  debug('Saved ' + JSON.stringify(result))
}

document.addEventListener('DOMContentLoaded', () => restore().catch(onError))
document.getElementById('form').addEventListener('submit', (e) => (async function () {
  e.preventDefault()
  await save()
})().catch(onError))
