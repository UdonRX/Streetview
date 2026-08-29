# Streetview Journey

Current version: **v0.1.27 Phase 1.4 Travel Axis Center Lock**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように見せる Journey Engine を開発するプロジェクト。

## v0.1.27 Phase 1.4 — Travel Axis Center Lock
- 0.08秒をJourney Engineの標準速度として維持
- 既存のjsfeat Worker / Similarity RANSAC / Safety Gate / Far-field / Tile Flow / edge-fillを維持
- **Stabilization（画像間の揺れ補正）とJourney Centering（進行方向の構図補正）を分離**
- GPS座標・KartaView headingで作っている既存の地理的進行方向に加え、連続画像のOptical Flowから **Visual FOE（Focus of Expansion / 進行方向の収束点）** を独立Workerで推定
- FOEが画面中央から外れている場合だけ、描画時の横cropを緩やかに移動してTravel Axisを中央へ寄せる
- Visual FOEはRANSAC系の線交点推定を使い、平行流が強いside-looking画像では横flow方向から画面外FOEを補助推定
- 5フレーム近傍のロバスト平滑化＋1フレーム最大3.6%の移動制限で、センタリング自体が新しい左右ジャンプを作らないようにする
- Travel Axis補正はrender側だけへ適用し、RANSAC/Far-fieldのcamera stabilization値には混ぜない
- v0.1.25の85ms Worker timeoutでwarm-ahead queueが`worker-pending`として固定されやすかったため、単一jsfeat Workerの待機許容を220msへ拡張。Worker失敗時のFar-field fail-softは維持
- 診断HUDへ `Axis Ready / shift / confidence` を追加し、ログには`travelAxis`スナップショットを追加
- Vercel Functionは `api/imagery.js` 1個のまま。Function追加なし

## 今回の5ルート診断から分かったこと
- Constanța郊外は平均Confidence約68%、RANSAC 70/71でも進行方向が中央に来なかったため、中心ズレの主因はRANSAC精度不足ではなく**絶対的な構図基準の不足**
- Sinaiaは強い視差と森林の大量特徴点により、背景は安定していても「進むべき道路・道筋」が画面端へ残るケースがあった
- `worker-pending`はWorker自体の失敗ではなく、warm-aheadで複数解析を一度に投げた際に85msのraceを越えることが主因
- よってPhase 1の残課題は、相対姿勢推定の追加強化よりも **Travel Axisの絶対中心化 + Worker queue耐性** を優先する

## Roadmap
1. Phase 1: 0.08秒 Camera Stabilization + Travel Axis Center Lock
2. Phase 2: MapLibre + OpenFreeMap + Mapillary/KartaView実データ地図UI
3. Phase 3: Overpass + Wikipedia/Wikimediaによる到着地選択
4. Phase 4: Journey Graph / 出発地 / 距離 / 所要時間 / 出発・到着時刻
5. Phase 5: Duplicate / Gap / Quality / Adaptive Sampling / Exposure
6. Phase 6: Depth-aware Forward Flow / Terrain-aware Motion / Elevation
7. Phase 7: TWGL/WebGL + Worker/Comlink GPU Journey Renderer
8. Phase 8: Gap / Depth Mesh / Occlusion補完
9. Phase 9: 道路・登山道・森・山・海岸・展望地・360/Fisheyeの全地形対応
10. Phase 10: 仮想現在時刻・ETA・移動距離・残距離・到着演出を含むJourney UX

> バージョンごとの複製ファイルは作らない。機能上独立したWorker/モジュールだけを安定したファイル名で追加し、Vercel Hobby内・Function 1個を維持する。
