# Streetview Journey

Current version: **v0.1.4 Smooth Motion**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.4 Smooth Motion
- 0.5秒/枚の再生テンポを維持
- クロスフェードを160msから80msへ短縮
- 切替直前〜直後だけ約1.35pxの微ブラーを適用
- 各フレーム表示中に小さな前進ズームを継続
- GPS進行方向・撮影方位・360°のobject-position差・フレーム間距離から、次画像を前画像へ軽量位置合わせ
- 次画像は横位置と縮尺を前画像へ寄せた状態から表示し、135msで本来の位置へ解放
- Vercel Functionは既存の `api/imagery.js` 1個のまま。画像解析用Functionや画像プロキシは追加しない
- Service Workerと静的アセットをv0.1.4へ更新

## v0.1.3
- 0.5秒/枚の再生テンポを維持
- KartaViewの連続写真を間引かず最大72枚取得し、隣接フレームのつながりを優先
- GPS座標から進行方位を計算し、360°/SPHERE画像では進行方向を画面中央へ自動固定
- クロスフェードを160msへ短縮

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
- 必要なら画像特徴点ベースのより精密な位置合わせ
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
