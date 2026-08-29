# Streetview Journey

Current version: **v0.1.28 Phase 1.5 Direction-aware Travel Axis**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように見せる Journey Engine を開発するプロジェクト。

## v0.1.28 Phase 1.5 — Direction-aware Travel Axis
- 0.08秒をJourney Engineの標準速度として維持
- 既存のjsfeat Motion Worker / Similarity RANSAC / Safety Gate / Far-field / Tile Flow / edge-fillを維持
- **座標検索時に「近いsequenceを最初に採用」する方式を廃止**。周辺の最大5 sequenceを比較し、GPS軌跡とKartaView画像headingの向きが最も一致する写真列を選ぶ
- sequenceの撮影向きがGPS進行方向と約180°反対なら、画像列を反転して「カメラが向いている方向へ旅が進む」ようにする
- sequence選択では進行方向一致度、heading coverage、座標からの距離、フレーム連続性を合成して評価する
- APIレスポンスへ `selection` を追加し、採用sequence、forward/reverse、heading誤差、候補数、候補scoreを診断可能にする
- v0.1.27でSinaiaログが `Travel Axis results 1 / errors 70` だったため、Travel Axis Workerから2つ目のjsfeat解析を除去
- 新Travel Axis Workerは **80×120 grayscaleの純JavaScript Tile Flow** で粗い動き場を作り、median translationを除いた残差からFOEを推定する。外部CDN/WASM依存なし
- FOEが成立しないside-looking画像は横flowから画面外Travel Axisを補助推定。解析不能でも例外にせずconfidence 0でmetadata中心化へ戻る
- Travel AxisはGPS/headingの絶対中心化を基準にし、Tile Flowは残差補正だけを担当。Camera Path X補正の78%相殺も維持
- Workerが失敗してもmetadata中心化 + Far-field fail-softでJourneyは停止しない
- Vercel Functionは `api/imagery.js` 1個のまま。Function追加なし

## Sinaia v0.1.27ログから確定した原因
- Camera Motion側は71/71 Worker resultを返していた一方、Travel Axis専用Workerは **71ペア中1件だけ成功、70件エラー**。そのため `appliedShift=0` で、進行方向補正は実質動作していなかった
- さらに旧 `findNearby()` は最初に見つかったsequence IDを無条件採用しており、カメラが進行方向を向くsequenceか、横/後ろ向きsequenceかを判定していなかった
- 静止画cropだけでは画像の外側にある進行方向を生成できないため、**画像処理より前に正しい向きのsequenceを選ぶこと**をPhase 1の必須条件に変更

## Roadmap
1. Phase 1: 0.08秒 Camera Stabilization + Direction-aware Travel Axis
2. Phase 2: MapLibre + OpenFreeMap + Mapillary/KartaView実データ地図UI
3. Phase 3: Overpass + Wikipedia/Wikimediaによる到着地選択
4. Phase 4: Journey Graph / 出発地 / 距離 / 所要時間 / 出発・到着時刻
5. Phase 5: Duplicate / Gap / Quality / Adaptive Sampling / Exposure
6. Phase 6: Depth-aware Forward Flow / Terrain-aware Motion / Elevation
7. Phase 7: TWGL/WebGL + Worker/Comlink GPU Journey Renderer
8. Phase 8: Gap / Depth Mesh / Occlusion補完
9. Phase 9: 道路・登山道・森・山・海岸・展望地・360/Fisheyeの全地形対応
10. Phase 10: 仮想現在時刻・ETA・移動距離・残距離・到着演出を含むJourney UX

> バージョンごとの複製ファイルは作らない。機能上独立したWorker/モジュールだけを安定したファイル名で維持し、Vercel Hobby内・Function 1個を維持する。
