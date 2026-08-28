# Streetview Journey

Current version: **v0.1.3**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.3
- 0.5秒/枚の再生テンポを維持
- KartaViewの連続写真を間引かず最大72枚取得し、隣接フレームのつながりを優先
- GPS座標から進行方位を計算し、360°/SPHERE画像では進行方向を画面中央へ自動固定
- 画像heading欠損時に0°として扱っていた不具合を修正
- クロスフェードを160msへ短縮し、ズレた2画像が重なる時間を削減
- デモ開始位置をsequence #6187609のindex 650付近へ移動
- 画像URL/IDの重複を除外
- Service Workerと静的アセットをv0.1.3へ更新

## v0.1.2
- 画像切替を0.5秒基準へ高速化
- 写真切替と右下フレーム番号を同期
- 最大4枚先読みで高速再生を安定化

## v0.1.0
- KartaView APIからsequence写真を取得して完全自動再生
- 低解像度サムネイル優先、Service Worker画像キャッシュ、Wake Lock、PWA対応
- Vercel Functionは `api/imagery.js` の1個のみ

## Planned
- Mapillary adapter / KartaViewとの自動切替
- 画像特徴点ベースの位置合わせ（必要な場合）
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
