# A. 普通のAIレビュー（コードを渡す）

model: claude-sonnet-4-6

---

## コードレビュー

全体的な構造は読みやすいですが、**本番運用では致命的になりうる問題**が複数あります。カテゴリ別に説明します。

---

## 🔴 重大な問題

### 1. 決済後のエラーで課金だけ発生するリスク

```javascript
// 決済
const charge = await chargeCard({ amount: seminar.fee, card });

const entry = { ... };
entries.push(entry);

// 完了メール
await sendMail({ ... }); // ← ここで例外が起きると…
```

`chargeCard` 成功後に `sendMail` が失敗すると、**お金は引き落とされたのに申込は登録されない**、もしくは**メールが届かない**状態になります。

```javascript
// 修正例: try-catch で決済を保護する
let charge;
try {
  charge = await chargeCard({ amount: seminar.fee, card });
} catch (err) {
  return res.status(502).json({ message: "決済に失敗しました" });
}

try {
  entries.push(entry);
  await sendMail({ ... });
} catch (err) {
  // メール失敗は返金して申込も取り消す
  await refundCharge(charge.id).catch(() => {});
  entries.pop();
  return res.status(500).json({ message: "申込処理に失敗しました" });
}
```

### 2. 二重申込・定員オーバーの競合（Race Condition）

```javascript
// 定員チェック ← ここで「残り1席」と判定
const taken = entries.filter((e) => e.seminarId === seminarId).length;
if (taken >= seminar.capacity) { ... }

// 決済（時間がかかる）← この間に別リクエストも同じチェックを通過する
const charge = await chargeCard(...);

entries.push(entry); // ← 両方がここに到達して定員オーバー
```

```javascript
// 修正例: チェックと登録をアトミックに扱う（予約スロット方式）
const taken = entries.filter((e) => e.seminarId === seminarId).length;
if (taken >= seminar.capacity) {
  return res.status(400).json({ message: "定員に達しています" });
}

// 仮予約で席を押さえてから決済する
const placeholder = { id: tempId, seminarId, status: "pending", ... };
entries.push(placeholder);

try {
  const charge = await chargeCard(...);
  placeholder.status = "confirmed";
  placeholder.chargeId = charge.id;
} catch (err) {
  // 失敗したら仮予約を削除
  entries.splice(entries.indexOf(placeholder), 1);
  return res.status(502).json({ message: "決済に失敗しました" });
}
```

### 3. キャンセルでも競合・二重返金のリスク

```javascript
const entry = entries[idx];
await refundCharge(entry.chargeId); // ← 返金中に同じIDへの別リクエストが来ると？
entries.splice(idx, 1);             // ← 返金が2回走る可能性がある
```

```javascript
// 修正例: 処理中フラグで二重実行を防ぐ
if (entry.status === "cancelling") {
  return res.status(409).json({ message: "キャンセル処理中です" });
}
entry.status = "cancelling";

try {
  await refundCharge(entry.chargeId);
  entries.splice(idx, 1);
} catch (err) {
  entry.status = "confirmed"; // ロールバック
  return res.status(502).json({ message: "返金に失敗しました" });
}
```

---

## 🟠 中程度の問題

### 4. 入力バリデーションが一切ない

```javascript
const { name, email, department, seminarId, card } = req.body;
// name が undefined でも処理が進んでしまう
```

```javascript
// 修正例
if (!name || typeof name !== "string" || name.trim() === "") {
  return res.status(400).json({ message: "名前は必須です" });
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  return res.status(400).json({ message: "メールアドレスが不正です" });
}
if (!card) {
  return res.status(400).json({ message: "カード情報は必須です" });
}
// zod や joi などのライブラリ利用も検討してください
```

### 5. エントリIDの採番が壊れる

```javascript
id: "e" + (entries.length + 1),
```

キャンセルで `entries` から削除されると、次の申込が**既存のIDと衝突**します。

```javascript
// 修正例
const { randomUUID } = require("crypto");
id: randomUUID(),
```

### 6. キャンセル締切チェックがない

セミナー当日や開催後でもキャンセル・返金できてしまいます。

```javascript
// 修正例
const today = new Date().toISOString().slice(0, 10);
const cancelDeadline = seminar.deadline; // または別途 cancelDeadline を定義
if (today > cancelDeadline) {
  return res.status(400).json({ message: "キャンセル期限を過ぎています" });
}
```

---

## 🟡 軽微な問題・改善提案

### 7. 同一人物の二重申込を防いでいない

```javascript
// 修正例
const alreadyEntered = entries.some(
  (e) => e.seminarId === seminarId && e.email === email
);
if (alreadyEntered) {
  return res.status(409).json({ message: "すでに申し込み済みです" });
}
```

### 8. エラーハンドリングが非対称

申込では `chargeCard` の失敗を catch していない一方、キャンセルでも `refundCharge` の失敗を catch していません。外部サービス呼び出しはすべて try-catch で囲むことを統一ルールにしてください。

### 9. メモリストレージの明示

コメントに「メモリ上に持つ」とあるものの、**サーバー再起動でデータが全消滅**します。プロトタイプ用途であれば許容範囲ですが、本番移行時に DB 層が必要になることをコメントや README に明記しておくと親切です。

---

## まとめ

| 優先度 | 問題 | 対応 |
|--------|------|------|
| 🔴 即対応 | 決済後エラーで課金だけ残る | try-catch + 自動返金 |
| 🔴 即対応 | 定員チェックの競合 | 仮予約スロット方式 |
| 🔴 即対応 | キャンセルの二重返金 | 処理中フラグ |
| 🟠 早期対応 | 入力バリデーション皆無 | zod 等で検証 |
| 🟠 早期対応 | IDの重複衝突 | UUID 採用 |
| 🟠 早期対応 | キャンセル期限チェックなし | deadline 判定を追加 |
| 🟡 余裕があれば | 二重申込チェックなし | email + seminarId で重複確認 |

最も危険なのは**「お金は動いたのにシステムの状態が不整合になる」**パターンです。外部サービスを跨ぐ処理は、常に「途中で失敗したらどうなるか」を念頭に設計してください。
