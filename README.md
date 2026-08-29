# Streetview Journey

Current version: **v0.1.29 Phase 1.6 Visual Heading Calibration**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように見せる Journey Engine を開発するプロジェクト。

## v0.1.29 Phase 1.6 — Visual Heading Calibration
- 0.08秒をJourney Engineの標準速度として維持
- v0.1.28のDirection-aware sequence選択、jsfeat Motion Worker、Similarity RANSAC、Safety Gate、Far-field、Tile Flow、edge-fillを維持
- **KartaViewのheadingを「画像内で進行方向が存在するX位置」として盲信しない**。heading/GPSは初期推定とfallbackに限定する
- APIレスポンスへ画像 `width / height` を保持し、画像座標とportrait crop座標を混同しないための基礎情報を追加
- 座標検索では上位3 candidate sequenceを返し、まずmetadata最上位をフル画像でVisual Preflight。進行軸が画像端/外に寄る場合だけ他候補も解析し、metadata scoreとvisual scoreを合成して自動fallbackする
- Journey開始前に最大8組の画像ペアをフル画像のまま低解像度解析し、FOE（進行軸）を画像全幅の座標系で推定する
- フル画像FOEと既存のportrait解析結果を、confidence / coverage / inlier / errorで重み付けしてroute単位の **camera yaw bias** を自己校正する
- metadata中心とVisual Axisが継続的にずれるsequenceでは `visual-calibrated` に切り替え、フレームごとのlocal biasでカーブにも追従する
- 横向き撮影ではglobal translation優勢を検出し、通常FOEより `side-flow` を優先できるようTravel Axis Workerを強化
- residual FOEとfull-flow FOEが大きく食い違う場合はconfidenceを下げ、一方の誤推定を絶対中心として使わない
- 進行軸が画像外と推定された場合は `visual-edge-limit` として画像端まで寄せ、生成できない画角を無理に捏造しない
- Travel Axisの診断にFull解析数、camera yaw bias、calibration confidence、metadata→effective anchor、edge-limitを追加
- Vercel Functionは `api/imagery.js` 1個のまま。Function追加なし

## v0.1.28で解決したこと / Constanțaで残った原因
- v0.1.28では近いsequenceを無条件採用せず、最大5候補からGPS軌跡とheadingの整合性でsequenceとforward/reverseを選ぶようにした。Sinaiaでは `alignmentErrorDeg 3.55°` のsequence #3024を選択でき、進行方向が正面になった
- Constanțaではsequence #1937977自体のGPS/heading整合性は `16.48°` と許容範囲だったが、実画像は進行方向を正面に捉えていなかった。つまり **sequence選択が正しくても、headingメタデータだけでは画像内の光学的な正面位置を保証できない**
- さらに旧Travel Axisは、portraitにcrop済みの80×120画像で得たFOEの `centerX` をフル画像のmetadata anchorと直接比較していた。これは座標系が異なり、横向き画像ほど補正量を誤る
- v0.1.29では「sequenceの進む向き」と「画像内の進行軸」を分離し、前者はGPS/heading、後者はフル画像Visual Axisで決める

## Roadmap
1. Phase 1: 0.08秒 Camera Stabilization + Direction-aware / Visual-calibrated Travel Axis
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
