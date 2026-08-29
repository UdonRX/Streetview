# Streetview Journey

Current version: **v0.1.27 Phase 1.4 Travel Axis Center Lock — 5-route final hotfix**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように見せる Journey Engine を開発するプロジェクト。

## v0.1.27 Phase 1.4 — Travel Axis Center Lock
- 0.08秒をJourney Engineの標準速度として維持
- 既存のjsfeat Worker / Similarity RANSAC / Safety Gate / Far-field / Tile Flow / edge-fillを維持
- **Stabilization（画像間の揺れ補正）とJourney Centering（進行方向の構図補正）を分離**
- GPS座標・KartaView headingで地理的なTravel Axisを作り、連続画像のOptical Flowから **Visual FOE（Focus of Expansion / 進行方向の収束点）** を補助情報として推定
- Travel Axis補正はrender側だけへ適用し、RANSAC/Far-fieldのcamera stabilization値には混ぜない
- Visual FOEはRANSAC系の線交点推定を使い、平行流が強いside-looking画像では横flow方向から画面外FOEを補助推定
- 5フレーム近傍のロバスト平滑化で、センタリング自体が新しい左右ジャンプを作らないようにする
- Vercel Functionは `api/imagery.js` 1個のまま。Function追加なし

## 5ルート最終ログから確定した修正点
- Constanța郊外は平均Confidence約68%、RANSAC 70/71、AppliedでもRANSAC主体なのに進行方向が中央に来なかった。したがって主因はRANSAC精度不足ではなく**絶対的な構図基準**側
- 旧crop式 `x=(canvasWidth-drawWidth)*anchor` は、指定したanchorを中央へ動かす式ではなく、結果としてanchorを画面上の同じ割合に残していた。最終hotfixでは `x=canvasWidth/2-drawWidth*anchor` を基準にし、Travel Axisを数学的に中央へ置く
- 解析canvasは従来cropを使うため、Visual FOEは「0.5との差」ではなく**metadata anchorに対する残差**として使う。これによりGPS/heading補正とFOE補正の二重掛けを防止
- Camera PathのX補正はTravel Axisを再び中央から押し出すため、render時に中心点のtransformを読み、横補正の78%をTravel Axis側で相殺。roll / scale / Yの安定化は維持
- ルート終端付近でも進行方位が急変しないよう、進行方位は前方GPSだけでなく後方GPSも使って推定
- `worker-pending`はWorker失敗ではなくwarm-ahead queueが85ms raceを越えることが主因。実測のiPhoneログに合わせ、互換待機を360msへ拡張してqueued jobがFar-fieldへ固定されにくくした
- Worker/FOEが失敗してもmetadata中心化 + Far-field fail-softでJourneyは継続する

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
