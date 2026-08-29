# Streetview Journey

Current version: **v0.1.9 Normalized Blend Tile Flow**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.9 Normalized Blend Tile Flow
- v0.1.8のB「自転車・ドライブ風」、傾き補正、傾き平滑化、4×5 Tile Flowを維持
- seamCanvas / 境界専用オーバーレイは使用しない
- 各タイルのオーバーラップを約12pxへ拡大
- 隣接タイルはCosineフェザーマスクで実画像同士を直接ブレンド
- 色の積算Canvasと重みの積算Canvasを分離し、同じワープ量・同じフェザー重みで加算
- 最終表示前に各ピクセルを `積算色 ÷ 積算重み` で正規化し、白・黒の格子や四隅の二重露光を抑制
- 重みがほぼ0のピクセルは元の前後フレームの自然なクロスブレンドへフォールバックし、黒抜けを防止
- 隣接タイルのベクトル平滑化はv0.1.8相当を維持
- 正規化描画はiPhone負荷を抑えるため約30fpsを上限とする
- 中央シャープ＋外周ブラーを維持
- 0.10秒 / 0.12秒 / 0.15秒の速度比較を維持（標準0.12秒）
- Vercel Functionは `api/imagery.js` 1個のまま

## v0.1.8 Feathered Tile Flow
- 白いSeam Blendを撤去
- 10pxオーバーラップ＋Cosineフェザーで隣接実画像を直接合成
- ベクトル平滑化を強化

## v0.1.7 Seamless Tile Flow
- 4×5 Tile Flowのタイル境界低減を検証

## v0.1.6 Stabilized Tile Flow
- 画像の傾き補正・平滑化
- 4×5 Tile Flowで近景と遠景を別速度でワープ
- 0.10 / 0.12 / 0.15秒の速度比較

## Planned
- v0.1.9で格子が消えた後のグニャつき評価とFlow強度調整
- 必要なら4×5→5×6タイルの負荷比較
- Mapillary adapter / KartaViewとの自動切替
- より精密なDense Optical Flow / 特徴点追跡の検証
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
