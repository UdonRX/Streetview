# Streetview Journey

Current version: **v0.1.15 Phase 1.1 Camera Path Tune**

iPhone Safari/PWA向け、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように見せる Journey Engine を開発するプロジェクト。

## v0.1.15 Phase 1.1 Camera Path Tune
- 0.08秒を今後の標準速度として固定。通常UIでは0.08秒だけを表示
- 比較基盤は残し、URLに `?compare=1` を付けたときだけ 0.08 / 0.10 / 0.12秒を選択可能
- OpenCV特徴点追跡の閾値をiPhone向けに調整し、利用できる背景特徴点を増加
- OpenCVが低〜中信頼のときに完全破棄せず、Far-field推定とconfidenceに応じて混合
- Camera Pathの平滑化を5フレーム相当から7フレーム相当へ拡張
- X/Y・残留roll・微小scaleをVirtual Camera Pathとして平滑化し、画像切替時の傾き・中心ジャンプを抑制
- Roll自体も時間方向の追従を弱め、写真単位の左右揺れを抑制
- 9% Overscanを追加し、Camera Stabilizationで露出する上下左右の黒い画面端を隠す
- Journey Engine左上に「戻る」を追加し、再読み込みせずTOPへ戻れるようにした
- HUDに現在confidenceに加えて `Avg` を表示。iPhoneのスクリーンショットだけで平均confidenceを確認可能
- OpenCVが使えない場面・特徴点が少ない場面ではFar-field + Tile Flowへ自動フォールバック
- Vercel Functionは `api/imagery.js` 1個のまま

## Phase 1.1 判定基準
- Jakartaデモのような特徴の多い場面では、`Avg` が目安として10〜15%以上に上がること。Mix表示自体は異常ではない
- 遠景の建物・道路奥・空と建物の境界を注視したとき、v0.1.14より傾きと上下左右のジャンプが明確に減ること
- 画面上下左右の黒端がほぼ見えないこと
- 0.08秒の速度感・連続感がv0.1.14から悪化しないこと
- 周期的なズーム、過度なクロップ、画面全体の漂いが新たに目立たないこと
- OpenCV低信頼区間でも停止せず、Mix/Far-fieldで再生を継続すること

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

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
