# Streetview Journey

Current version: **v0.1.16 Phase 1.2 Similarity RANSAC**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように見せる Journey Engine を開発するプロジェクト。

## v0.1.16 Phase 1.2 — Similarity RANSAC
- 0.08秒をJourney Engineの標準速度として維持。通常UIは0.08秒のみ、`?compare=1`で比較UIを再表示可能
- Shi-Tomasi特徴点 + Pyramidal Lucas-Kanade Optical Flowを継続
- **Forward-Backward tracking validation** を追加し、A→Bで追えた点をB→Aへ戻して一致しない特徴点を除外
- **Pairwise Similarity RANSAC** を追加。複数特徴点からX/Y・回転・scaleを1つの幾何変換としてロバスト推定
- RANSAC inlierだけでSimilarity transformを最小二乗再フィットし、動く車・人や局所的な誤追跡の影響を低減
- 特徴点の **spatial coverage** をconfidenceに入れ、画面の一部分だけで姿勢を決めにくくした
- Metadata由来のcrop centerも前後5フレームで平滑化し、heading揺れによる中心ジャンプを抑制
- RANSACが中信頼のときはFar-fieldと重み付き統合、低信頼時は従来Far-fieldへfail-soft fallback
- 7フレーム相当のVirtual Camera PathでX/Y・roll・scaleを平滑化
- 描画側はforegroundを16% Overscanし、さらに38%拡大したedge-fill背景を敷いて、回転/平行移動で下端・角に黒領域が露出するのを防止
- HUDは `RS xx% / Mix xx%` と `Avg` を表示。`RS`はRANSACベースの追跡がCamera Pathへ主に採用されている状態
- `window.__journeyDiagnostics` にRANSAC inlier ratio、spatial coverage、reprojection error、Forward-Backward errorも保持
- Vercel Functionは `api/imagery.js` 1個のまま

## Phase 1.2 判定基準
- Jakartaデモでは `RS` が継続的に現れ、`Avg` がPhase 1.1の9%から明確に上がること。目安は **20%以上、できれば30%以上**
- 遠景の建物・道路奥など一点を見続けた際、画像切替ごとの傾きがPhase 1.1より明確に小さいこと
- 同じ遠景対象の左右・上下への「カクッ」という中心ジャンプが明確に小さいこと
- 画面下端を含め黒い画面端が見えないこと。極端な補正時も黒ではなくedge-fillで継続すること
- 0.08秒の速度感・連続感を維持し、解析追加による長い停止が連発しないこと
- 周期的なズーム呼吸や強い画角変化が新たに目立たないこと
- RANSACが成立しない空・海・白壁などでもMix/Far-fieldへ戻ってJourneyが停止しないこと

## Roadmap
1. Phase 1: 0.08秒 Camera Stabilization
2. Phase 2: MapLibre + OpenFreeMap + Mapillary/KartaView実データ地図UI
3. Phase 3: Overpass + Wikipedia/Wikimediaによる到着地選択
4. Phase 4: Journey Graph / 出発地 / 距離 / 所要時間 / 出発・到着時刻
5. Phase 5: Duplicate / Gap / Quality / Adaptive Sampling / Exposure
6. Phase 6: Depth-aware Forward Flow / Terrain-aware Motion / Elevation
7. Phase 7: TWGL/WebGL + Worker/Comlink GPU Journey Renderer
8. Phase 8: Gap / Depth Mesh / Occlusion補完
9. Phase 9: 道路・登山道・森・山・海岸・展望地・360/Fisheyeの全地形対応
10. Phase 10: 仮想現在時刻・ETA・移動距離・残距離・到着演出を含むJourney UX

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する。Vercel Hobby内・Function 1個を維持する。
