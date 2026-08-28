# Streetview Journey

Current version: **v0.1.0**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.0
- KartaView APIからsequence写真を取得して完全自動再生
- 2レイヤーによるズーム / Pan / クロスフェード遷移
- 撮影heading差をPan量へ反映
- 低解像度サムネイル優先・最大72フレーム・先読み1枚で通信量を抑制
- Service Workerで最大80枚の画像を再利用
- Screen Wake Lock対応
- PWA manifest対応
- Vercel Functionは `api/imagery.js` の1個のみ
- 公式KartaView sample sequence #6187609をデモとして利用可能

## Planned
- v0.2: Mapillary adapter / KartaViewとの自動切替
- 目的地ルーティング、観光地検索、標高・進捗表示
- 360°画像向けThree.jsレンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
