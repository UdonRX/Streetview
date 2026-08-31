# Streetview Journey

MapillaryJS公式Viewerを中核にした、iPhone Safari/PWA向けの旅行UI。

## 現在のUIフロー
1. 地図上の観光地・展望地・山アイコン、または検索から到着地点を選ぶ。
2. `旅をはじめる` で到着地点付近のMapillary sequenceを候補ルートとして強調表示。
3. 実画像ルートをタップし、`出発地登録` で出発地点を決定。
4. 出発地登録と同時に、Mapillary先読みと標高取得を並列開始。
5. ボトムシートに総距離、標高プロファイル、出発時刻、到着予定時刻、上り量を表示。
6. `旅をはじめる` でMapillaryJS Viewerを開き、そのまま自動再生開始。
7. Journey中は距離ベースの再生バー、出発/到着時刻、進んだ距離、残距離、1フレーム移動距離を表示。
8. 再生バーはスワイプ/ドラッグで任意位置へ移動。再生/一時停止を切替可能。
9. 到着後は `旅を完了させる` で地図へ戻る。

## 表示方式（固定）
- MapillaryJS 4.1.2
- `imageTiling: true`
- WebGL
- `TransitionMode.Default`
- 画像切替は公式 `viewer.moveTo()`
- 自作Canvas画像表示、FOE、Optical Flow、travel-axis等は使用しない。

## 外部サービス
- MapLibre GL JS + OpenFreeMap: 地図
- Mapillary Graph API / MapillaryJS: 実画像ルートとViewer
- Overpass API: 観光地・展望地・山
- Open-Meteo Elevation API: 標高プロファイル
- Nominatim: 場所検索

## 再生継続性
- 出発地登録中に同じMapillary DataProviderへ先読み。
- 再生中も前方を継続先読み。
- `moveTo()` は複数回リトライし、失敗フレームはスキップして再生ループを継続する。
- ネットワーク断など外部要因まで完全無停止を保証することはできないが、単一画像の取得失敗ではJourneyを停止しない。
