# quality-oracle

> AIがコードを書く時代に、「何が正しいか」を知る人間を中心に据えた品質担保ツール。

## これは何か

AIによる実装が一般化し、システムの知見がない人が開発に参入するようになった結果、
**「コードを書く」ことよりも「書かれたものが正しいかを判断する」ことがボトルネック**になっている。

既存のテスト自動化ツール（Autify, MagicPod, mabl, Playwright 等）は
「テストの実行・回帰・自己修復」を解いたが、
**「誰が正解を定義し、誰が結果を判断するか」は人間のボトルネックのまま**残している。

本プロジェクトの核心は、その残された問題＝**オラクル問題**を解くこと。
具体的には、AIに「テストの採点基準」を丸投げするのをやめ、
**AIには観測と問いだけをさせ、人間は正解の承認だけをする**仕組みをつくる。

## なぜ作るのか（出発点）

- 開発者本人が、テスト・品質が弱いチーム／組織に属している。
- 同様に品質を軽視するベンチャーは少なくないと見ている。
- ただしこれは本質的に**組織・文化の問題**であり、ツール単体では解けない。
  狙うのは「機能の提供」ではなく「行動を変えること」。
- 売る相手は「品質を軽視している多数」ではなく、
  **「軽視されている現状に困っている少数」（CTO・テックリード・過去に障害で痛い目を見た人）**。

詳細な戦略判断とその根拠は [`docs/design.md`](docs/design.md) を参照。

## 現在地

オラクル引き出しの「核」を中心に、**手動テストのワークフロー一式**が動くローカルWebアプリ（Next.js + Tailwind）＋ CLI。

**ワークフロー：プロジェクト → 課題 → テスト項目 → 結果**
1. **プロジェクト**（GitHubリポジトリ連携可）に **課題**（PR/ファイル/範囲）を立てる。課題は概要＋**AI分析ナレッジ**を持ち、観測に前提知識として注入される。
2. 課題のソースから**2系統**で候補を出す（種別 track・decisions/0016）：**オラクル**（観測Pass1→尋問Pass2。主体×強度×デグレで確認質問）＋**正常系**（観測→現状を固定する回帰項目）。**手動追加**・**JSONインポート**も可。
3. 候補を **採用 / 修正して採用 / 捨てる** でキュレーション → **テスト項目**化（承認済みの意図＝生きた仕様 ＋ 回帰/既知バグのテスト）。種別バッジで由来が分かる。
4. 項目ごとに **結果（合格/不合格/未実施）を記録**。検証手段は**タブ**で「**リクエスト**（HTTPコンソール・AI下書き）」「**画面化**（スクショ）」。証跡（画像/送受信テキスト）を保存。担当者を割り当て、一覧から**一括操作**（担当割当/合否記録）も可。
5. **ダッシュボード**で横断可視化、**Excel出力**（証跡込み・1課題=1シート）で共有。
6. **テスト前検出（オラクルの価値・§6.10③）**：プロジェクト画面で **✗訂正率（テスト前バグ検出率）** とリスク領域別/課題別、**見つかった問題の中身**（観測 vs 人の訂正）を可視化。

- **CLI**: `run`（ファイル/標準入力/`--pr`/`--gh`/`--lens`/`--intensity`）・`list`・`decide`・`gen-tests`・`report`。
- **核は実コードで検証済み**（§6.10①②：鏡化ほぼゼロ・観点網羅・矛盾検出・実バグ検出）。✗訂正率（③）はUIで可視化済み。
- 判断の経緯はすべて `decisions/`（0001–0024）。詳細は「使い方」「ダッシュボード」。
- **実PRで①②③を通しで検証する手順**は `docs/verify-real-pr.md`。
- **マルチユーザー化を段階導入中**（decisions/0018）：Phase1（ログイン/全ルート保護/記名）＋Phase2（データ分離・メンバー管理・権限）実装済み。
  権限＝admin(全)/owner(管理)/member(作業)/viewer(閲覧)、参加は招待制・担当者(0019)・最終ログイン表示。Phase3（ホスティング＋Postgres）は未着手（`trustHost` は設定済み）。
- **UIデザインは Vercel/Geist 方向**（decisions/0020）：ライト/ダーク切替・テーマトークン・統一ラインアイコン・⌘Kコマンドパレット・トースト/スケルトン。

スコープは引き続き意図的に絞る（テスト**実行**・外部連携の書き戻し・ホスティング・証跡S3 は未着手 = design.md §8 / decisions）。

## リポジトリ構成

```
.
├── README.md                      … このファイル
├── CLAUDE.md                      … 前提とガードレール（毎セッション読む）
├── package.json / tsconfig.json / next.config.mjs … Node + TypeScript + Next 定義
├── .env.example                   … APIキー/AUTH_SECRET の雛形（.env はコミットしない）
├── auth.ts / auth.config.ts / proxy.ts … 認証（Auth.js v5・decisions/0018。proxy.ts=Next16のルート保護）
├── app/                           … Next.js ダッシュボード（Tailwind・ダーク・ローカル）
│   ├── page.tsx                   … 管理: 課題の採用済みテスト項目＋最新結果テーブル
│   ├── project/page.tsx           … プロジェクト・ダッシュボード（横断＋課題を立てる）
│   ├── ai/page.tsx                 … AI使用状況（管理者のみ・回数/トークン/概算コスト。decisions/0021）
│   ├── project/new/page.tsx       … プロジェクト作成（名前/説明・複数リポ束ね可）
│   ├── issue/new/page.tsx         … 課題作成（プロジェクト選択/タイトル/概要/ソース）
│   ├── add/page.tsx               … 項目作成: 観測→候補→採用/修正して採用/捨てる
│   ├── login/page.tsx / signup/page.tsx … ログイン/新規登録（最初の登録者が admin。decisions/0018）
│   ├── api/auth/[...nextauth]/route.ts … Auth.js ルートハンドラ
│   ├── auth-actions.ts            … ログイン/サインアップ/ログアウトの Server Action
│   ├── item/[id]/page.tsx         … 項目詳細（観測/質問/テスト＋採用解除＋証跡）
│   ├── api/evidence/[id]/route.ts … 証跡（画像/テキスト）の配信（権限チェック）
│   ├── api/export/{issue,project}/[id]/route.ts … Excel(.xlsx) ダウンロード
│   ├── api/search/route.ts        … ⌘K コマンドパレット用の横断ナビ索引
│   ├── actions.ts                 … 承認/採用/結果/証跡/HTTP/課題/プロジェクト/担当/一括操作 等の Server Action
│   ├── loading.tsx                … 遷移中のスケルトン（認証画面は no-op で上書き）
│   ├── icon.svg                   … ファビコン（ロゴマーク）
│   ├── globals.css                … Tailwind v4 ＋ テーマトークン（:root/.dark）＋共通クラス（decisions/0020）
│   └── lib/                       … 共通基盤と部品（decisions/0020）
│       ├── db / model / access(権限) / ui / evidence / observe / http / export … データ/権限/表示ロジック
│       ├── page-header / empty-state / logo / icons / avatar / result-badge / markdown … 表示プリミティブ
│       ├── toast / submit-button / command-palette / command-trigger / theme-toggle … 操作フィードバック・⌘K・切替
│       └── items-table / assignee-select / member-role-select / result-quick / paste-upload / evidence-image / json-body-field … クライアント部品
├── src/
│   ├── engine/                    … UI/CLI 非依存のコア（拡張の継ぎ目・decisions/0002）
│   │   ├── schema.ts              … Zod データ契約（Pass1/Pass2/§6.9台帳/監査）の単一真実源
│   │   ├── prompts.ts             … docs/prompts 雛形の読込・差し込み
│   │   ├── pipeline.ts            … 観測Pass1 / 尋問Pass2（別API呼び出し）
│   │   ├── ledger.ts              … §6.9 台帳リポジトリ（ローカルSQLite実装）
│   │   ├── ids.ts                 … 安定ID・内容ハッシュ
│   │   └── sources/github.ts      … GitHub 読み取り専用の入力アダプタ（--pr/--gh）
│   └── cli/oracle.ts              … engine の薄いCLIラッパ（run/list/decide/report）
├── scripts/check-schema.ts        … スキーマ↔実出力の整合チェック
├── samples/checkout.js            … わざとバグを仕込んだ動作確認用サンプル
├── docs/
│   ├── design.md                  … 設計の本体（ビジョン→戦略→競合→アーキ→エンジン）
│   └── prompts/
│       ├── pass1-observation.md   … AI観測パスのプロンプト雛形
│       ├── pass2-interrogation.md … AI尋問パスのプロンプト雛形
│       ├── pass3-testgen.md       … 承認済みの意図→テスト項目（⑤）の雛形
│       ├── lenses.md              … 観点の主体/強度/デグレのレンズ定義（差し込み元）
│       ├── knowledge-analysis.md  … AI分析ナレッジ生成の雛形
│       ├── request-gen.md         … テスト用HTTPリクエストのAI下書き雛形
│       └── normal-gen.md          … 観測インベントリ→正常系(回帰)項目の生成雛形
├── decisions/
│   ├── 0001-initial-direction.md  … 初期方針
│   ├── 0002-saas-capable-premise-and-nextjs.md … SaaS視野・スタック選定
│   ├── 0003-confirm-means-current-behavior.md  … ✓の意味を§6.2に揃える
│   ├── 0004-github-read-only-input-adapter.md  … GitHubを読み取り入力として解禁
│   ├── 0005-ui-ia-project-issue-item.md        … IA(Project→課題→項目)・SaaS UI方向
│   ├── 0006-evidence-local-storage.md          … 項目テーブル/詳細・証跡ローカル保存
│   ├── 0007-perspective-and-intensity-lenses.md … 観点の主体(業務/技術)・強度のレンズ
│   ├── 0008-test-item-curation-and-ui-observation.md … 候補→採用・UIから観測起動
│   ├── 0009-manual-test-results.md              … テスト項目ごとの実行結果（手動）記録
│   ├── 0010-explicit-issues-and-ai-knowledge.md … 課題の一級化・AI分析ナレッジ注入
│   ├── 0011-excel-export.md                     … 課題/プロジェクトのExcel出力（証跡埋込）
│   ├── 0012-explicit-projects.md                … プロジェクト一級化・課題へ明示リンク
│   ├── 0013-repo-link-regression-private.md     … リポジトリ連携・デグレ観点・private対応
│   ├── 0014-manual-http-console.md              … 手動HTTPコンソール（人が送り人が判定）
│   ├── 0015-ai-request-and-text-evidence-export.md … リクエストAI下書き・送受信のExcel反映
│   ├── 0016-normal-track-manual-import.md         … 種別(track)で正常系/手動/取込を区別・JSON取込
│   ├── 0017-item-priority.md                      … 項目の優先度(高/中/低)・サイドバー開閉
│   ├── 0018-multi-user-auth.md                    … マルチユーザー化(認証/権限/分離)・§8解禁・段階導入
│   ├── 0019-item-assignee.md                      … テスト項目の担当者(assignee)・自分の担当フィルタ
│   └── 0020-ui-design-system.md                   … UIデザイン方針(Vercel/Geist・テーマトークン・共通部品)
├── data/                          … ローカル台帳 oracle.db（.gitignore・外に出さない・証跡含む）
└── out/                           … 実行成果物 inventory.json / questions.json（.gitignore）
```

## 使い方

コード片 → 二段パイプライン（観測 Pass1 → 尋問 Pass2、**別々のAPI呼び出し**）→ 確認質問リスト(JSON)。
質問は §6.9 の「生きた仕様」台帳（ローカルSQLite）に `pending` で記録され、人間が4択で承認していく。

```bash
# 1. 依存インストール（実行は @anthropic-ai/sdk + zod、開発に tsx/typescript）
npm install

# 2. APIキー設定（.env は .gitignore 済み・コミットしない）
cp .env.example .env       # 中の ANTHROPIC_API_KEY を自分のキーに置き換える
#   マルチユーザー（Web UI）を使うなら AUTH_SECRET も設定（decisions/0018）:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  → AUTH_SECRET に貼る

# 3. 観測→尋問→台帳記録（同梱のバグ入りサンプルで試す）
npm run oracle -- run samples/checkout.js
#   = npx tsx src/cli/oracle.ts run samples/checkout.js
#   質問JSONは標準出力。--out で保存、--inventory-out で観測も保存、--no-store で台帳に入れない
#
#   入力源は GitHub も可（読み取り専用・decisions/0004）:
#   npm run oracle -- run --pr owner/repo#123          # PRの変更ファイル全文を連結して観測
#   npm run oracle -- run --gh owner/repo:path[@ref]   # 単一ファイルを観測
#   private は .env の GITHUB_TOKEN が必要（public は不要）
#
#   観点のレンズ（decisions/0007・既定 engineer/strong）:
#   --lens director|engineer    業務(画面/ビジネス) か 技術(実装) か
#   --intensity loose|medium|strong   最重要だけ〜総当たり（「細かすぎ」の調整）
#   例: npm run oracle -- run samples/checkout.js --lens director --intensity loose

# 4. 台帳をリスク順に一覧（id を確認）
npm run oracle -- list

# 5. 人間の4択を適用（§6.7）
npm run oracle -- decide <id> confirmed                      # ✓意図通り（現状を正解として固定＝回帰）
npm run oracle -- decide <id> corrected --intent "正しい意図"  # ✗違う→正解（=テスト前に見つけたバグ）
npm run oracle -- decide <id> not_applicable                 # —テスト不要
npm run oracle -- decide <id> unknown                        # ?わからない（最重要シグナル）

# 6. 承認済みの意図 → テスト項目を生成（⑤。コードでなく意図から起こす）
npm run oracle -- gen-tests --run <id>      # confirmed→回帰 / corrected→今落ちる既知バグ

# 7. §6.10 指標サマリ（✗訂正率＝テスト前バグ検出率の近似 など）
npm run oracle -- report
```

- **モデル**: 既定 `claude-sonnet-4-6`。`--model claude-opus-4-8` または env `ORACLE_MODEL` で上書き。
- 進捗ログは標準エラー、**質問JSONだけが標準出力**（パイプで繋ぎやすい）。
- プロンプトは `docs/prompts/` の雛形が**単一の真実源**。コード内に二重に持たない。
- データ契約（Pass1/Pass2/§6.9台帳）は `src/engine/schema.ts`（Zod）に一元化。LLM出力は実行時検証する。
- 同じコード・同じ質問は再観測しても過去の承認を保持する（差分だけ再確認＝§6.2⑥）。
- **✓ の意味**（decisions/0003）: ✓＝「現状の挙動が正しい」→ declaredIntent＝観測→**回帰テスト**（今通る）。
  ✗＝訂正→**既知バグのテスト**（今落ちる）。AI推測は**✗の訂正欄の初期値**としてのみ使う。
- テストは**コードでなく承認済みの意図から**生成する（§1.3 の循環参照を踏まない）。実行はしない（項目を出すまで）。
- 注: `node:sqlite` 利用のため stderr に実験的機能の通知が1行出るが**無害**（stdoutは汚れない）。
- スコープ: 「コード → 質問 → 承認台帳 → テスト項目 → ダッシュボード管理」まで。
  テスト**実行**・外部連携の**書き戻し**・認証/ホスティング・証跡S3 は**今は作らない**
  （CLAUDE.md / design.md §5.3・§8。スタックの方向は decisions/0002）。

## ダッシュボード（Next.js + Tailwind）

CLI で台帳に記録した内容を、**Project（リポジトリ）→ 課題（PR/範囲）→ 項目** の3階層で管理する
ローカルUI（decisions/0005）。台帳 `data/oracle.db` を直接読み書きする（engine をサーバー側で呼ぶ）。

```bash
npm run dev      # 開発サーバ → http://localhost:3000
# 本番ビルド: npm run build && npm run start
# （Windows で実行ポリシーに阻まれたら npm.cmd run dev、または Set-ExecutionPolicy）
```

- **ログインが必要**（decisions/0018）：初回は `/signup` で登録（最初の人が admin）。以降は全ルートが保護され、未ログインは `/login` へ。サイドバー下部に現在ユーザー＋ログアウト。結果記録には**実施者**が記名される。
- **データ分離・権限（Phase2）**：一覧/ダッシュボード/Excel/項目/証跡は**所属プロジェクトだけ**見える（admin は全件）。
  - **メンバー管理**は `/project` の「メンバー」から（owner/admin のみ）。**招待制**：先に本人に新規登録してもらい、そのメールで追加。
  - 権限：**admin**＝全アクセス／**owner**＝メンバー管理可／**member**＝試験作業可／**viewer**＝閲覧のみ（編集UIは非表示）。
  - 既存プロジェクトは最初の admin の所有に自動移行済み（非破壊）。Phase3（ホスティング＋Postgres）は未着手。
- **ライト/ダーク切替＋⌘K**：サイドバー上部で 🌙/☀ 切替（既定ダーク・localStorage・FOUC なし）。**⌘K / Ctrl+K** でプロジェクト/課題/項目を横断検索しジャンプ。色は全て `app/globals.css` のテーマトークン（decisions/0020）。
- 左サイドバー: Project（リポジトリ／ローカル）と課題（PR/ファイル）。**Project 単位で開閉**（アクティブは既定で開く）・課題数/採用数バッジ・現在ユーザーのアバター。
- 課題詳細（一覧）: 項目を**テーブル**で（結果/優先/項目/種別/**担当**/最終実施/証跡）。**フィルタ**（未実施/不合格…・自分の担当）＋**並び替え**＋**行hoverのワンクリック記録**＋**複数選択の一括操作**（担当割当/合否記録）。
- **テスト前検出（価値の可視化・§6.10③）**：`/project` 先頭に **✗訂正率（テスト前バグ検出率）**・リスク領域別/課題別・**見つかった問題の中身**（観測 vs 人の訂正）。
- **AI使用状況（`/ai`・管理者のみ・decisions/0021）**：LLM呼び出しの**回数/入力・出力トークン/概算コスト**を、種別（観測/尋問/正常系/テスト生成/ナレッジ/リクエスト/ドリフト）×モデル×ユーザー×プロジェクトで集計＋直近40件。記録は `callModel` 一点集約→`ledger.ai_usage`（読み取り専用）。単価は概算（実請求は Anthropic コンソール）。サイドバー下部に admin だけリンク。
- **意図ドリフト検出（§6.2⑥・decisions/0022）**：課題画面の「意図ドリフト」パネルで**現在のコードを再観測**し、**承認済みの意図（生きた仕様）と矛盾する新挙動**だけを検出。各件を **新挙動を正とする（意図を更新→回帰テスト再生成）/ 無視** で捌く。AIは矛盾提示まで＝正しさの判断は人（観測と承認の分離）。承認済み意図が1件以上あり、UIから再観測できるソースのときに検査可能。
- **訂正の資産化（学習ナレッジ・decisions/0023）**：`/project` の「学習ナレッジ（訂正から）」パネルで、**このプロジェクトで積んだ ✗訂正 から繰り返しの教訓を抽出**（AIが下書き→人が編集）。教訓は配下すべての観測/尋問の**前提知識に自動注入**され、「使うほど質問が賢くなる」。✗訂正は人の判断由来で高信頼＝ツールの堀（moat）。
- **質問の情報量で並べる（✓スルー抑止・decisions/0024）**：候補レビュー（`/add`）で**オラクル質問を「当たりそうな順」**（低確信・矛盾/抜け・高リスクを上に）に並べ、**鏡に近い低情報**（AIが高確信の単なる挙動・低リスク）は畳んで下げる。`/project` に**「レンズ別の当たり率」**（主体×強度が実際に ✗訂正/?不明 を生んだ割合）を表示し、効くレンズを可視化。※LLM追加呼び出しなし（既存の観測メタから計算）。
- **項目の優先度**（decisions/0017）：実施順の序列（risk の category とは別軸）。既定は risk から導出し、項目詳細で高/中/低を変更可。並びは「未決→優先度→リスク順」。
- **プロジェクトを作成**（サイドバーの「＋」/`/project/new`）：名前・説明・**GitHubリポジトリ連携**。複数リポ/PRを束ねる単位。
- リポジトリ連携すると、課題作成時に **PR番号やパスだけ**でソース指定できる（private は **gh 認証を自動利用**・PAT不要）。
- 観測時に **デグレ（既存破壊）観点を強化**（チェック・既定ON。後方互換・既存フローへの波及を重点的に問う）= decisions/0013。
- **プロジェクト → 課題を立てる**（`/issue/new`）：所属プロジェクトを選び、タイトル・概要・ソースを指定。
- 課題に **AI分析ナレッジ**（概要＋ソースから「AIで下書き」→ 編集）。**観測時に前提知識として注入**され質問の質が上がる（decisions/0010）。
- 課題詳細（管理）には**採用したテスト項目だけ**を表示。「＋ 項目を追加」で**作成画面 `/add` に分離**。
- **作成画面 `/add`**：観点（主体×強度）で観測→候補を出し、候補ごとに
  **意図どおり→採用（回帰）／違う→観点を修正して採用（既知バグ）／不採用→捨てる** を選ぶ。
  採用したものだけが課題のテスト項目になる（AIの観測/質問は「項目作成のための候補」。decisions/0008）。
- **2系統＋手動/取込（種別 track・decisions/0016）**：同じ `/add` で
  「**オラクル質問を生成**」（未知のリスク/意図）と「**正常系を生成**（観測ベース・現状を固定する回帰）」を出し分け。
  正常系は候補止まり＝「**正常系を全部採用**」ボタンで一括採用（✓スルー対策で自動採用しない）。
  さらに「**手動でテスト項目を追加**」「**JSONインポート**（実装者の取り込み用）」を用意。
  由来は**種別バッジ**（オラクル/正常系/手動/取込）で一覧・詳細・Excel(「由来」列)に表示。
  ※§6.3アンチミラーは「質問」に効かせ「項目」には効かせない（正常系＝現状固定。正しさは人の✗で表明）。
- 管理画面（課題）は **テスト項目＋最新結果**が主役：結果列（合格/不合格/未実施）とサマリ。
- **Excel出力**：課題単位（1シート）/ プロジェクト単位（課題ごとにシート）。試験項目＋**証跡画像を埋め込み**（decisions/0011）。
- **項目詳細**（`/item/[id]`）: 観測・質問・宣言した意図・生成テスト＋**実行結果（手動・pass/fail/blocked履歴）**＋**採用/解除**。
  検証手段は**タブ切替**：「リクエスト（API）＝HTTPコンソール＋送受信証跡」／「画面化（UI）＝スクリーンショット証跡」。
  - レイアウトは2カラム（左＝テスト内容/観測/結果、右＝状態/採用/優先度のスクロール追従カード）。
  - **手動テスト動線の高速化**：課題内を **← 前 / 次 →**（キーボード ← →）で連続消化、**ワンクリック合否**（p=合格/f=不合格/b=ブロック・本日付で即記録）、**最新結果を常時表示**、**担当者**の割り当て（プロジェクトメンバー・decisions/0019）。
  - 一覧（ダッシュボード）は**フィルタ**（未実施/不合格…・自分の担当）＋**並び替え**＋**行hoverでワンクリック記録**。列＝結果/優先/項目/種別/担当/最終実施/証跡。
  - 証跡は **Ctrl+V 貼り付け / ドラッグ&ドロップ** でスクショ追加。テストは **Markdownでコピー**（引き継ぎ用）。
  - 操作は**トースト通知**＋送信中は**「処理中…」で無効化**（二重送信防止）。
- **HTTPコンソール**（項目内・Postman風）：メソッド/URL/ヘッダ/ボディを送信→レスポンス確認→**人が合否を記録**（自動判定なし）。
  **「AIで下書き」**で項目の文脈からリクエストを生成（人が確認・修正して送信）= decisions/0014, 0015。
  送受信は**テキスト証跡**として保存可（API項目はスクショ不要、UI項目は画像スクショ＝棲み分け）。
  証跡カウント（📎）は画像＋テキストの合計、**Excel出力にも送受信内容が入る**。
- **✓スルー対策**（§6.7）: 承認は詳細画面に集約（開かないと判断不可）、未レビュー＋`confidence=low`を上段固定、一括✓なし。
- **証跡はローカル保存**（`data/evidence/`・PNG/JPEG/GIF/WebP・8MB）。配信は `/api/evidence/[id]`。S3 はホスト化と同時（decisions/0006）。
- Project/課題は run の `codeRef` から導出（移行ゼロ）。課題の明示作成・横断ビューは今後（design.md §8）。
- まだ作らない: マルチユーザー/認証、外部連携の書き戻し、証跡のクラウド保存（decisions/0002, 0006）。

## これからの育て方

- 設計・戦略の変更は `decisions/` に1判断1ファイルで追記していく（後から経緯を追えるように）。
- プロンプトを実コードで試したら、当たり外れと改善を `docs/prompts/` 配下に反映する。
- 中身（=承認済みの意図＝仕様）が揃ったので、その**出力としての管理UI**は実装済み（dashboard）。
- 残りは順序を守って：**核の検証（§6.10③）→ 課題の明示作成/横断ビュー → 証跡(ローカル→S3)・Backlog/PR共有**
  （コモディティ・入口層は核の検証後。design.md §8 / §3.2）。

## 未解決の論点

- **リポジトリ／IPの帰属**: 所属組織の業務・リソースと関係して作る場合、
  成果物の権利が組織に帰属する可能性がある。公開・収益化の前に雇用契約・就業規則の
  知的財産条項を確認すること（これは法的判断であり、専門家への相談を推奨）。
- **「軽視する組織」は最も難しい顧客**である点（タダでも使わない層に安くても売るのは難しい）。
  → 解は「買う人（困っている少数）と使う人を分ける」設計。
