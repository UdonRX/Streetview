# Streetview Journey

Current version: **v0.1.14 Phase 1 Multi-frame Camera Path Stabilization**

iPhone Safari/PWA向けJourney Engine。最終目標は、Mapillary / KartaViewに画像が存在する道路・登山道・山・海岸・名所・展望地などを「そこへ向かって進んでいる」ように体験できるアプリ。

## v0.1.14 Phase 1 — Multi-frame Camera Path Stabilization
- 0.08秒を今後のJourney Engine標準速度に変更。0.10 / 0.12秒は比較用として残す
- 完全無料のOpenCV.jsを外部ライブラリとして遅延ロード
- Shi-Tomasi特徴点 + pyramidal Lucas-Kanade Optical Flowで背景特徴を追跡
- 追跡点のmedian / MADで局所的な外れ値を除外し、カメラ移動のX/Yを推定
- 複数特徴点の相対位置から残留rollと微小scaleを推定
- 前後5フレーム相当（現在±2）のraw trajectoryを平滑化し、Virtual Camera Pathを生成
- Scene-axisとして既存の遠景ベース水平推定を残し、その後にCamera Path補正を適用
- OpenCVの追跡信頼度が低い場合は既存Far-field pair matchingへ自動フォールバック
- Stabilized frameを作った後に既存4×5 Tile Flow → Normalized Blend → Perceptual Bridgeを適用
- 0.08秒時は60fps相当の描画上限を維持
- OpenCV失敗時でも旧方式で再生を継続するfail-soft構成
- `window.__journeyDiagnostics` にOpenCV状態、Camera confidence、補正pose、平均pair時間を公開
- Vercel Functionは `api/imagery.js` 1個のまま

## Phase 1 acceptance criteria
1. **機能**: 開始画面が `v0.1.14 PHASE 1 CAMERA PATH` で、0.08秒が標準選択になっている。
2. **OpenCV**: 通常のテクスチャがある区間ではHUDが `CV xx%` を表示する。常時 `Mix` の場合はOpenCVロード/追跡を要確認。
3. **傾き**: 遠景の建物・水平線・道路奥などを見たとき、写真切替ごとの左右交互の傾きがv0.1.13より目立たない。
4. **中心安定**: 遠景の同じ対象が写真切替のたびに左右・上下へ跳ねる量が減っている。
5. **過補正なし**: 画面が周期的にズームイン/アウトしない、黒い端が見えない、景色が引っ張られて大きく回転しない。
6. **0.08秒維持**: 初期解析後の再生で長い停止が連発せず、v0.1.13の0.08秒の速度感を維持する。
7. **診断目安**: `window.__journeyDiagnostics.averageConfidence` がテクスチャの多い区間で概ね0.15以上ならCV追跡が実用域。`averagePairMs` が継続的に200msを大きく超える場合は次回Worker/GPU最適化対象。
8. **フォールバック**: OpenCVが読めない/特徴点が少ない空・海・壁でもJourneyが停止せず再生を継続する。

## v0.1.13 Smooth 80ms
- 0.05秒を廃止し、実時間80msを導入
- 0.08秒時は最大60fps相当で補間描画
- Far-field Lock / Tile Flow / Normalized Blend / Perceptual Bridgeを維持

## Planned phases
- Phase 2: MapLibre + OpenFreeMapで地図UI、Mapillary Vector Tiles / KartaView Coverageの実データ表示
- Phase 3: Overpass + Wikipedia/Wikimediaで山・観光地・展望地などの到着地UI
- Phase 4: Mapillary/KartaView共通Journey Graph、出発地、距離、所要時間、出発/到着予定時刻
- Phase 5: Duplicate/Gap Detection、Quality Score、Adaptive Sampling、距離正規化、色/露出安定化
- Phase 6: Depth Anything V2 SmallでDepth-aware Forward Flow、地形別Motion、標高/pitch
- Phase 7: TWGL/WebGL + Worker/ComlinkでGPUレンダリングとバックグラウンド解析
- Phase 8: Gap専用Bridge、Depth Mesh中間視点、Occlusion処理
- Phase 9: 道路・登山道・森・山・海岸・展望地・名所・360/Fisheyeの全地形Scene Model
- Phase 10: 仮想現在時刻、到着予定、移動済/残距離、到着演出を含むJourney UX完成

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン情報を更新する。Vercel Hobby内・Function 1個を維持する。
