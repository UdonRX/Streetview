# Streetview — MapillaryJS

このリポジトリは **MapillaryJS 4.1.2 公式 Viewer を使った旅表示**だけに整理しています。

## 現在の構成

- `index.html` — 到着地点 → 出発地点のルート選択と公式Viewer UI
- `core.js` — 共通状態・設定・Diagnostics用ユーティリティ
- `route.js` — Mapillary Graph APIによるsequence探索とGPSベースの進行方向決定
- `preload.js` — 表示Viewerと共有する公式 `GraphDataProvider` の先読み
- `viewer.js` — `TransitionMode.Default` の表示、0.8秒基準の自動再生、視点保持、逆走監視
- `app.js` — 起動とUIイベントの接続
- `manifest.webmanifest` — iPhone PWA用
- `sw.js` — 旧Journeyキャッシュを一度削除して自己解除する移行用cleanup worker

## 表示方式

表示は MapillaryJS の標準機能だけを使用します。

- `Viewer`
- `imageTiling: true`
- WebGL
- `TransitionMode.Default`
- `viewer.moveTo()`
- Mapillary `GraphDataProvider`

FOE、消失点、Optical Flow、travel-axis、pedestrian-axis、mountain-axis、CENTER LOCK、自作Canvas画像表示、自作256/1024 Overlayは使用しません。

## 先読み

出発地点が決まった時点で先読みを開始します。表示Viewerと同じ公式 `GraphDataProvider` を共有し、画像・mesh・clusterをメモリに保持します。別Viewerを走らせる方式は使用しません。

先読みは待ち時間を抑えるため、最初の少数フレームから実効ロード速度を測り、0.8秒再生に必要な範囲だけを適応的に準備します。再生中も残りをバックグラウンドで補充します。
