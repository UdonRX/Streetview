# Streetview Journey

Current version: **v0.1.6 Stabilized Tile Flow**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.6 Stabilized Tile Flow
- B「自転車・ドライブ風」をベースに再構成
- 各画像の低解像度エッジ方向からロール角を推定し、±3.5°以内で傾きを補正
- 補正角はEMA＋1フレーム最大0.72°の変化制限で平滑化し、左右の揺れを低減
- 画面を4×5＝20タイルに分割し、前後画像を簡易ブロックマッチングしてローカル移動量を推定
- 遠景（上・中央）は小さく、近景（下・左右端）は大きく動かす深度重み付きTile Flow
- 画像解析できない場合はGPS/撮影方位ベースのタイルワープへ自動フォールバック
- 中央はシャープに保ち、画面外周だけ約0.85pxの弱いブラーを適用
- 再生速度を0.10秒 / 0.12秒 / 0.15秒から比較可能（標準0.12秒）
- CORS解析画像はService Workerのopaque画像キャッシュを経由しないよう修正
- Vercel Functionは `api/imagery.js` 1個のまま

## v0.1.5 Motion Lab
- A Street View Step / B Drive Flowを比較
- BにFlow-Liteを導入

## v0.1.4 Smooth Motion
- 0.5秒/枚、短いクロスフェード、微ブラー、前進ズーム、軽量位置合わせ

## Planned
- Mapillary adapter / KartaViewとの自動切替
- より精密なDense Optical Flow / 特徴点追跡の検証
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
