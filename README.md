# Streetview Journey

Current version: **v0.1.13 Smooth 80ms Far-field Horizon Lock**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.13 Smooth 80ms Far-field Horizon Lock
- v0.1.12のFar-field Anchor Stabilization / Horizon Lock / 遠景ベースのロール補正 / 4×5 Tile Flowを維持
- 0.05秒を廃止し、0.08 / 0.10 / 0.12秒の3速度を比較。0.10秒を標準に設定
- 0.08秒は表示だけでなく、実時間80msの補間durationとして処理
- 0.08秒時は描画上限を60fps相当にし、60Hz端末で理論上約5回の中間表示機会を確保
- Far-field Lock、Tile Flow、Normalized Blend、12px overlap、Cosine feather、Perceptual Bridgeの品質設定は0.10秒と共通
- 0.05秒で目立ったパラパラ漫画感を、時間方向の中間描画数を増やすことで軽減する狙い
- Vercel Functionは `api/imagery.js` 1個のまま

## v0.1.12 Formal 50ms Far-field Horizon Lock
- `requestAnimationFrame` の時刻先送りを使わず、実時間50msで0.05秒を検証
- 0.05秒では60Hz画面で中間表示機会が少なく、パラパラ漫画のような見え方が確認された

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
- 0.08 / 0.10 / 0.12秒の動画感・滑らかさ・処理負荷を比較
- Far-field Lockの安定性評価と、必要なら特徴点ベースの回転/射影補正
- Mapillary adapter / KartaViewとの自動切替
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
