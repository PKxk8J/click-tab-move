# click-tab-move

タブ右クリックからタブを別のウインドウに移動させる Firefox アドオン。

e10s 対応。

https://addons.mozilla.org/addon/clicktabmove/


## <span id="messaging"/> Messaging

Other extensions can use this extension by using [sendMessage](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/runtime/sendMessage)

```javascript
browser.runtime.sendMessage('{2bd73814-983c-42f3-a6d5-e68c4668a4cf}', {
  type: 'move',
  keyType: 'right',
  tabId: 15,
  toWindowId: 24,
  notification: false
})
```

```javascript
browser.runtime.sendMessage('{2bd73814-983c-42f3-a6d5-e68c4668a4cf}', {
  type: 'move',
  keyType: 'select',
  tabIds: [15, 46, 2],
  toWindowId: 24,
  notification: false
})
```


#### extensionId

`{2bd73814-983c-42f3-a6d5-e68c4668a4cf}`


#### message

|Property name|Type|Description|
|:--|:--|:--|
|type|string|`move`|
|keyType|string|`one` or `right` or `left` or `all` or `select`|
|tabId|number|The ID of a selected tab when keyType is `one` or `right` or `left` or `all`|
|tabIds|Array of number|The IDs of selected tabs when keyType is `select`|
|toWindowId|number|The ID of a destination window. undefined for new window|
|notification|boolean|Whether to show notification|
