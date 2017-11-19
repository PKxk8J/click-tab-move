'use strict'

// 共通処理

var _export

{
  const {
    i18n,
    storage
  } = browser

  const KEY_DEBUG = 'debug'
  const KEY_NAME = 'name'

  const KEY_ONE = 'one'
  const KEY_RIGHT = 'right'
  const KEY_LEFT = 'left'
  const KEY_ALL = 'all'
  const KEY_SELECT = 'select'

  const DEBUG = (i18n.getMessage(KEY_DEBUG) === 'debug')

  const storageArea = storage.sync

  function debug (message) {
    if (DEBUG) {
      console.log(message)
    }
  }

  // 設定値を取得する
  async function getValue (key, defaultValue) {
    const {
      [key]: value = defaultValue
    } = await storageArea.get(key)
    return value
  }

  async function asleep (msec) {
    return new Promise(resolve => setTimeout(resolve, msec))
  }

  _export = Object.freeze({
    KEY_ONE,
    KEY_RIGHT,
    KEY_LEFT,
    KEY_ALL,
    KEY_SELECT,
    KEY_RAW: 'raw',
    KEY_MOVE: 'move',
    KEY_MOVE_X: 'moveX',
    KEY_MENU_ITEMS: 'menuItems',
    KEY_SELECT_SIZE: 'selectSize',
    KEY_WIDTH: 'width',
    KEY_HEIGHT: 'height',
    KEY_SELECT_SAVE: 'selectSave',
    KEY_NOTIFICATION: 'notification',
    KEY_SAVE: 'save',
    KEY_MOVING: 'moving',
    KEY_PROGRESS: 'progress',
    KEY_SUCCESS_MESSAGE: 'successMessage',
    KEY_FAILURE_MESSAGE: 'failureMessage',
    KEY_RESET: 'reset',
    KEY_MOVE_TO_X: 'moveToX',
    KEY_NEW_WINDOW: 'newWindow',
    KEY_CANCEL: 'cancel',
    KEY_TO_WINDOW_ID: 'toWindowId',
    ALL_MENU_ITEMS: [KEY_ONE, KEY_RIGHT, KEY_LEFT, KEY_ALL, KEY_SELECT],
    DEFAULT_MENU_ITEMS: [KEY_ONE, KEY_RIGHT, KEY_ALL],
    DEFAULT_SELECT_SIZE: [640, 480],
    DEFAULT_SELECT_SAVE: true,
    DEFAULT_NOTIFICATION: false,
    NOTIFICATION_ID: i18n.getMessage(KEY_NAME),
    NOTIFICATION_INTERVAL: 10 * 1000,
    POLLING_INTERVAL: 300,
    BULK_SIZE: 5,
    DEBUG,
    storageArea,
    debug,
    onError: console.error,
    getValue,
    asleep
  })
}

const common = _export
