# Streetview Journey

Current milestone: **Phase 2 — Real Coverage Map UI**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路を地図から見つけ、Phase 1で固めたJourney Engineへつなぐプロジェクト。

## Phase 2 — 実データ＋地図UI
- 起動画面 `/` を MapLibre GL JS + OpenFreeMap の実地図UIへ変更
- KartaView Coverage Tile を認証なしで起動直後から表示
- Mapillary `mly1_public` Vector Tiles の sequence / image レイヤーを実装
- Mapillary Access Token は端末の localStorage のみに保存し、GitHubへ埋め込まない
- 撮影済みルートはKartaViewとMapillaryで色を分け、発光するよう重ねて表示
- 現在地・ズーム・回転操作をMapLibre標準Controlで利用可能
- Phase 1のJourney画面は `/journey.html` にそのまま保存して凍結
- Vercel Functionは `api/imagery.js` 1個のまま。Phase 2地図UIは静的ファイルのみ

## Phase 1 — Frozen
目標は「画像が変わった瞬間の傾き」を大幅に消すこと。Jakarta / Brașov / Sinaiaで検証し、Visual Override Guard、分散Preflight、Local Heading補正を含むv0.1.30で凍結。

## Roadmap
1. Phase 1: Camera Stabilization / Direction-aware Travel Axis — **Frozen**
2. Phase 2: MapLibre + OpenFreeMap + Mapillary/KartaView実データ地図UI — **Current**
3. Phase 3: Overpass + Wikipedia/Wikimediaによる到着地選択
4. Phase 4: Journey Graph / 出発地 / 距離 / 所要時間 / 出発・到着時刻
5. Phase 5: Duplicate / Gap / Quality / Adaptive Sampling / Exposure
6. Phase 6: Depth-aware Forward Flow / Terrain-aware Motion / Elevation
7. Phase 7: TWGL/WebGL + Worker/Comlink GPU Journey Renderer
8. Phase 8: Gap / Depth Mesh / Occlusion補完
9. Phase 9: 道路・登山道・森・山・海岸・展望地・360/Fisheyeの全地形対応
10. Phase 10: 仮想現在時刻・ETA・移動距離・残距離・到着演出を含むJourney UX

> バージョンごとの複製ファイルは作らない。機能上独立したモジュールだけ安定したファイル名で維持し、Vercel Hobby内・Function 1個を維持する。
