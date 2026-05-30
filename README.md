# click-tab-move

タブ右クリックからタブを別のウィンドウへ移動させる Firefox 専用アドオン。

https://addons.mozilla.org/addon/clicktabmove/

## 機能

- このタブを移動
- 右側のタブを移動
- ここから右のタブを移動
- 左側のタブを移動
- ここから左のタブを移動
- すべてのタブを別ウィンドウへ移動
- ポップアップで選択したタブを移動
- 固定タブは固定タブのまま移動
- 設定で右クリックメニューの表示場所と項目を選択
- 通知は設定で有効にした場合のみ使用

すべてのタブを別ウィンドウへ移動すると、2 つのウィンドウを統合できます。

タブグループや分割ビューは特別扱いせず、Firefox の通常のタブ移動 API に従って移動します。

## 動作要件

- Firefox 142 以降
- Node.js 現行 LTS

## 開発

```sh
npm install
npm run lint
npm run test
npm run build
```

アドオンのバージョンは `extension/manifest.json` で管理します。
`npm run build` は `web-ext-artifacts/clicktabmove-<version>.zip` を作成します。

`npm run run` は、この拡張機能を一時的に読み込んだ Firefox を起動します。
拡張機能のソースは `extension/` にあります。

## プライバシー

この拡張機能はユーザーデータを収集または送信しません。
