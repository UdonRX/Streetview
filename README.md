# Streetview Journey

Current version: **v0.1.7 Seamless Tile Flow**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.7 Seamless Tile Flow
- v0.1.6のB「自転車・ドライブ風」、傾き補正、傾き平滑化、4×5 Tile Flowを維持
- 隣接タイルの移動ベクトルを2段階で空間平滑化し、タイル間の動き量の段差を低減
- 各タイルを約4px重ねて描画し、ワープ時に背景が線状に露出する境界を抑制
- タイル境界周辺だけを別Canvasへ抽出し、約1.1pxの弱いブラーで重ねるSeam Blendを追加
- Seam Blendは補間中間で強く、実画像フレーム付近では弱くなるよう自動調整
- 中央シャープ＋外周ブラーは維持
- 0.10秒 / 0.12秒 / 0.15秒の速度比較は維持（標準0.12秒）
- Vercel Functionは `api/imagery.js` 1個のまま

## v0.1.6 Stabilized Tile Flow
- 各画像の低解像度エッジ方向からロール角を推定し、±3.5°以内で傾きを補正
- 補正角はEMA＋1フレーム最大0.72°の変化制限で平滑化
- 画面を4×5＝20タイルに分割し、近景と遠景を別速度でワープ
- 中央はシャープ、外周だけ弱いブラー

## v0.1.5 Motion Lab
- A Street View Step / B Drive Flowを比較
- BにFlow-Liteを導入

## Planned
- タイル境界改善後のグニャつき評価とFlow強度調整
- Mapillary adapter / KartaViewとの自動切替
- より精密なDense Optical Flow / 特徴点追跡の検証
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
