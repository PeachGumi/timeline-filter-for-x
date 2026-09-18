# Timeline Filter for X

[![CI](https://github.com/PeachGumi/timeline-filter-for-x/actions/workflows/ci.yml/badge.svg)](https://github.com/PeachGumi/timeline-filter-for-x/actions/workflows/ci.yml)

X / Twitterのタイムラインで、条件に合う投稿をブラウザ内だけで非表示にするChromium系ブラウザ拡張です。BraveとGoogle Chromeで、次のフィルターを個別に切り替えられます。

- X Premium個人アカウントの有料青バッジ投稿
- Xが「AIで生成」「Made with AI」と表示する投稿
- 日本語以外と判定された投稿

金色の組織認証、灰色の政府・公的機関認証、従来型の著名人認証は、青バッジフィルターの対象外です。投稿のURLを直接開いた画面では対象投稿を残し、その下の対象返信だけを非表示にします。

XのAPI応答でフォロー中と確認できたアカウントの投稿は、有料青バッジ・AI生成・言語のすべてのフィルターから除外して表示します。フォロー情報が応答に含まれない場合は、未フォローとは推測せず通常のフィルター判定を行います。

ユーザープロフィール画面 (`x.com/ユーザー名` と、その返信・メディア・いいねタブ) は、そのアカウントの投稿を読むために開いた画面とみなし、すべてのフィルターを適用しません。プロフィールから投稿の詳細を開くと、投稿URLを直接開いたときと同じ扱いに戻り、対象投稿を残して対象返信だけを非表示にします。

Xの履歴画面 (`x.com/i/history` と、そのいいねタブ `x.com/i/history/likes`) も、自分が閲覧・いいねした投稿を確認するために開いた画面とみなし、同じくすべてのフィルターを適用しません。

> このプロジェクトは独立して保守されている非公式の派生版です。X Corp.、元プロジェクト、元作者による提供・承認・提携はありません。

## インストール

この拡張はChrome Web Storeでは配布していません。

1. [Releases](https://github.com/PeachGumi/timeline-filter-for-x/releases)から最新の`timeline-filter-for-x-vX.Y.Z.zip`をダウンロードして展開します。
2. `brave://extensions`または`chrome://extensions`を開きます。
3. 「デベロッパー モード」を有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」から、展開したフォルダを選びます。
5. ツールバーのアイコンから必要なフィルターをオンにします。

GitHubから手動で入れた拡張は自動更新されません。更新時は新しいReleaseを展開し、同じ拡張の「更新」または再読み込みを行ってください。

## 判定方法

Xの画面上では、有料青バッジと他の認証を正確に区別できません。そのため、本拡張はXページ自身が受信したX/TwitterのAPIレスポンスをページ内で一時的に読み、投稿者の認証種別とフォロー関係、投稿ID、AIラベル、言語コードだけを抽出します。

言語情報がない場合はChromiumの`chrome.i18n.detectLanguage`で端末内判定します。投稿本文を外部の言語判定サービスへ送りません。Xによる自動翻訳が表示されている場合は、翻訳元言語のラベルも判定に使います。言語不明・文字なし・曖昧な短文は誤削除を避けるため表示します。

XのDOMやAPI仕様が変わると、一時的に判定できなくなる場合があります。誤判定を見つけた場合は、投稿URLと期待した結果をIssueへ書いてください。非公開情報は投稿しないでください。

## 権限とプライバシー

| 権限 | 用途 |
| --- | --- |
| `storage` | 3つのフィルター設定を`chrome.storage.sync`へ保存 |
| `https://x.com/*` | X上で投稿を分類・非表示 |
| `https://twitter.com/*` | 旧Twitter URL上で同じ処理を行うため |

解析、広告、テレメトリー、リモートコード、外部サーバーへのデータ送信はありません。詳細は[PRIVACY.md](PRIVACY.md)を参照してください。

## 開発

Node.js 20以降とPython 3が必要です。外部npm依存はありません。

    npm test
    npm run check
    npm run package

`npm run package`は、GitHub Releaseへ添付できる決定的なZIPを`dist/`に生成します。

主なファイル:

- `inject.js`: X/TwitterのHTTPS APIレスポンスから必要最小限の分類情報を抽出
- `content.js`: DOM上の投稿へフィルターを適用
- `popup.html` / `popup.js`: 設定UIと現在のタブの非表示件数
- `test/`: Node VMを使った回帰テスト

コントリビューション方法は[CONTRIBUTING.md](CONTRIBUTING.md)、脆弱性の報告方法は[SECURITY.md](SECURITY.md)を参照してください。

## 派生元とライセンス

このリポジトリは[sardistic/Hide-Verified-Twitter-Users](https://github.com/sardistic/Hide-Verified-Twitter-Users)のコミット`d001274cc9e466c0ba229f9600a52755948035e7`を基にしています。派生元のコードはCC0 1.0 Universalで公開されています。

現在の変更内容、独立運営、アイコンの由来は[NOTICE](NOTICE)に記載しています。この派生版もリポジトリ全体を[CC0 1.0 Universal](LICENSE)として公開します。
