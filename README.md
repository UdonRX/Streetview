# Streetview Journey

Current version: **v0.1.8 Feathered Tile Flow**

iPhone Safari/PWA向け「全自動シーケンス再生型ストリートビュー・ビューアー」のプロトタイプ。

## v0.1.8 Feathered Tile Flow
- v0.1.7までのB「自転車・ドライブ風」、傾き補正、傾き平滑化、4×5 Tile Flowを維持
- 白く見えていた境界専用Seam Blend Canvasを撤去
- 隣接タイルを約10pxずつオーバーラップして実画像同士を直接重ねる方式へ変更
- 重複域をCosineカーブでフェザー合成し、境界の急な明暗差を抑制
- 横・縦のフェザー重みを積で合成することで、4タイルが重なる角でも合計重みが1になるよう正規化
- タイルベクトル平滑化を3パスへ強化し、隣接ベクトル差にも上限を設けて境界での折れを低減
- 中央シャープ＋外周ブラー、0.10秒 / 0.12秒 / 0.15秒の速度比較は維持
- タイル数は4×5＝20のままにしてiPhone負荷の増加を抑制
- Vercel Functionは `api/imagery.js` 1個のまま

## v0.1.7 Seamless Tile Flow
- 4pxオーバーラップと境界専用Seam Blendを試験
- 境界ブラーが白い格子として見える課題を確認

## v0.1.6 Stabilized Tile Flow
- 各画像のロール角を推定して水平化
- 4×5 Tile Flowで近景と遠景を別速度でワープ

## Planned
- v0.1.8で境界が十分消えた後に、残るグニャつきとFlow強度を評価
- 必要なら4×5から5×6へのタイル細分化を負荷計測付きで検証
- Mapillary adapter / KartaViewとの自動切替
- より精密なDense Optical Flow / 特徴点追跡の検証
- 目的地ルーティング、観光地検索、標高・進捗表示
- Three.jsによる360°専用レンダリング

> バージョンごとにファイルを増やさず、既存ファイル内のバージョン表記を更新する方針。
