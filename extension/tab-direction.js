const {
  browserSettings,
} = browser

const VERTICAL_DIRECTION_KEYS = {
  right: 'below',
  thisAndRight: 'thisAndBelow',
  left: 'above',
  thisAndLeft: 'thisAndAbove',
}

export function getDirectionMessageKey (key, verticalTabsEnabled) {
  return verticalTabsEnabled ? VERTICAL_DIRECTION_KEYS[key] || key : key
}

export async function getVerticalTabsEnabled () {
  const setting = await browserSettings.verticalTabs.get({})
  return setting.value === true
}

export function addVerticalTabsChangeListener (listener) {
  browserSettings.verticalTabs.onChange.addListener((setting) => {
    return listener(setting.value === true)
  })
}
