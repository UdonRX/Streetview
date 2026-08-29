# Streetview Journey

Current version: **v0.1.12 Formal 50ms Far-field Horizon Lock**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.12 Formal 50ms Far-field Horizon Lock
- v0.1.11のFar-field Anchor Stabilization / Horizon Lock / 遠景ベースのロール補正 / 4×5 Tile Flowを維持
- 0.05 / 0.10 / 0.12秒の3速度を比較し、0.10秒を標準に設定
- 旧0.05秒テストで使っていた `requestAnimationFrame` の時刻先送りを完全撤去
- 0.05秒は実時間50msの補間durationとして処理
- 0.05秒でも0.10秒と同じNormalised Blend、12px overlap、Cosine feather、Perceptual Bridgeを使用
- 0.05秒時のみ描画上限を60fps相当にし、50ms内の中間描画機会を確保
- 画像解析解像度やTile Flowの品質設定は0.10秒と共通で、公平な速度比較を優先
- Vercel Functionは `api/imagery.js` 1個のまま

## v0.1.11 Far-field Horizon Lock
- 画像上側〜中央の遠景を優先してロール角を推定し、近景の車・人に引っ張られにくくした
- 前フレームと次フレームの遠景エッジを比較し、X/Yの残差をFar-field Anchorとして推定
- Far-field Anchorを時間方向に平滑化し、画面全体の位置を先に固定
- Horizon / Vanishing Point Lockとして遠景の上下・左右位置と水平を安定化
- グローバルな遠景補正後の画像に対して既存4×5 Tile Flowを適用

## Recent history
- v0.1.10: Perceptual Bridgeで写真間の飛びを前進として知覚しやすく調整
- v0.1.9: Normalized Blendで白・黒のタイル格子を抑制
- v0.1.8: Cosine featherによる隣接タイルの直接合成
- v0.1.6: 傾き補正・平滑化・4×5 Tile Flow・速度比較

## Planned
- 正式50msと0.10秒の見え方・処理落ち・早送り感を比較
- Far-field Lockの安定性評価と、必要なら特徴点ベースの回転/射影補正
- Mapillary adapter / KartaViewとの自動切替
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
