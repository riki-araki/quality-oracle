# 0021. AI使用状況トラッキング（トークン/回数/概算コストの管理画面）

- 日付: 2026-07-01
- ステータス: 採用

## 背景 / 何を決めるか
- 核（観測と問い）はすべて LLM 呼び出しに支えられており、運用が進むほど「何にどれだけAIを使ったか」が見えないと、
  コスト・利用状況の管理ができない。ホスト化（decisions/0002）を視野に入れると、利用量の可視化は前提になる。
- 「AIの使用状況も管理画面で確認できるように」というユーザー要望に応える最小実装を固定する。

## 決定
1. **記録は一点集約**：全 LLM 呼び出しは `pipeline.ts` の `callModel` を必ず通る。ここで `msg.usage`
   （`input_tokens` / `output_tokens`）を拾い、`onUsage` コールバックで呼び出し側へ渡す。
   `observe` / `interrogate` / `generateNormal` / `generateTest` / `analyzeKnowledge` / `generateRequest`
   の各関数は `onUsage?` を素通しするだけ（エンジンは記録先を知らない＝UI/CLI非依存を維持）。
2. **台帳に貯める**：`ledger.ai_usage` テーブル（id/kind/model/input_tokens/output_tokens/user_id/project_key/issue_id/created_at）。
   マイグレーションは他と同様に冪等（`CREATE TABLE IF NOT EXISTS` ＋ `created_at` インデックス）。既存データは非破壊。
3. **文脈も一緒に残す**：どの種別（kind）・誰（userId）・どのプロジェクト/課題で使ったかを記録する。
   `kind` は `observe|interrogate|normal|testgen|knowledge|request`。記録は Server Action / observe ヘルパ側で
   `saveUsages`（`app/lib/observe.ts`）を通して書く（LLM 呼び出し後、同じトランザクションの流れで）。
4. **管理画面 `/ai`（管理者のみ）**：総回数/入力/出力/概算コストのサマリ、種別別・モデル別・ユーザー別・プロジェクト別の
   集計（コスト降順・棒付き）、直近40件の一覧。サイドバー下部に admin だけリンクを出す。
5. **コストは「概算」と明記**：モデル名から単価を引く簡易マップ（Sonnet $3/$15・Haiku $1/$5・Opus $15/$75 per 1M、
   入力/出力）。一致しないモデルは Sonnet 相当で概算。正確な請求は Anthropic コンソール参照、と画面に注記する。
   単価は変わりうるので**記憶に頼らず docs.claude.com を確認**する前提（CLAUDE.md 技術メモに整合）。

## スコープ規律との整合
- ガードレール非抵触：テストの自動実行でも外部連携でもない。**読み取り専用の可視化**であり、データはローカルに留まる（§5.1）。
- 追加は最小（1テーブル＋1画面＋記録の配線）。抽象化・課金基盤・アラート等は需要が見えてから（後回し）。

## 捨てた選択肢
- **各呼び出し箇所で個別計測**：記録漏れが起きやすい。→ `callModel` 一点集約に。
- **正確な課金額の実装**（キャッシュ/バッチ/割引の反映）：過剰。まず「概算 + 実請求はコンソール」で十分。
- **一般ユーザーにも公開**：横断集計は管理情報。まず admin 限定（decisions/0018 のロールに整合）。
