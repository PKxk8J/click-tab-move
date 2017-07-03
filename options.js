'use strict'

const { i18n, storage } = browser
// TODO sync に
const storageArea = storage.local

const KEY_DEBUG = 'debug'

const KEY_ONE = 'one'
const KEY_ONE_RELOAD = 'oneReload'
const KEY_ALL = 'all'
const KEY_ALL_RELOAD = 'allReload'

const KEY_MENU_ITEM = 'menuItem'
const KEY_SAVE = 'save'

const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')
function debug (message) {
  if (DEBUG) {
    console.log(message)
  }
}

function onError (error) {
  console.error('Error: ' + error)
}

// bool が undefined でなく false のときだけ false になるように
function falseIffFalse (bool) {
  if (typeof bool === 'undefined') {
    return true
  }
  return bool
}

[KEY_MENU_ITEM, KEY_ONE, KEY_ONE_RELOAD, KEY_ALL, KEY_ALL_RELOAD, KEY_SAVE].forEach((key) => {
  document.getElementById('label_' + key).innerText = i18n.getMessage(key)
})

// 現在の設定を表示する
function restore () {
  const getting = storageArea.get()
  getting.then((result) => {
    const flags = {
      [KEY_ONE]: falseIffFalse(result[KEY_ONE]),
      [KEY_ONE_RELOAD]: result[KEY_ONE_RELOAD],
      [KEY_ALL]: falseIffFalse(result[KEY_ALL]),
      [KEY_ALL_RELOAD]: result[KEY_ALL_RELOAD]
    }
    Object.keys(flags).forEach((key) => {
      document.getElementById(key).checked = flags[key]
    })
  }, onError)
}

function save (e) {
  e.preventDefault()

  const result = {}
  ;[KEY_ONE, KEY_ONE_RELOAD, KEY_ALL, KEY_ALL_RELOAD].forEach((key) => {
    result[key] = document.getElementById(key).checked
  })
  const setting = storageArea.set(result)
  setting.then(() => debug('Saved'), onError)
}

document.addEventListener('DOMContentLoaded', restore)
document.getElementById('form').addEventListener('submit', save)