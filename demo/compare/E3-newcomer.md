# 新人が書きそうな依頼

依頼文: 「このコードで問題になりそうなところを教えてください。」

model: claude-sonnet-4-6

---

## コードレビュー：問題点の指摘

### 🔴 重大な問題

#### 1. 二重申込が防止されていない

```javascript
// 同一ユーザーが同じセミナーに何度でも申し込める
const taken = entries.filter((e) => e.seminarId === seminarId).length;
```

**修正例：**
```javascript
const duplicate = entries.find(
  (e) => e.seminarId === seminarId && e.email === email
);
if (duplicate) {
  return res.status(400).json({ message: "すでに申し込み済みです" });
}
```

---

#### 2. 競合状態（Race Condition）による定員オーバー

```javascript
// ❌ チェックと登録の間に await があるため、
//    同時リクエストが来ると定員を超えて登録される
const taken = entries.filter(...).length;  // ← ここで 29人と確認
if (taken >= seminar.capacity) { ... }

const charge = await chargeCard(...);  // ← ここで他リクエストが割り込む

entries.push(entry);  // ← 31人目が登録されてしまう
```

**修正例：**
```javascript
// 決済前に仮予約フラグを立てるか、
// ロック機構（またはDB側のトランザクション）を使う
const reservation = { seminarId, pending: true };
entries.push(reservation); // 先に枠を確保

try {
  const charge = await chargeCard(...);
  Object.assign(reservation, { confirmed: true, chargeId: charge.id, ... });
} catch (e) {
  entries.splice(entries.indexOf(reservation), 1); // 失敗時に取り消す
  throw e;
}
```

---

#### 3. 決済後のエラーで返金されない

```javascript
const charge = await chargeCard({ amount: seminar.fee, card });
entries.push(entry);

// ❌ sendMail が失敗すると、決済済みなのに申込未完了になる
//    返金処理も走らない
await sendMail(...);
```

**修正例：**
```javascript
try {
  await sendMail(...);
} catch (mailError) {
  // メール失敗時は返金してロールバック
  await refundCharge(charge.id);
  entries.splice(entries.indexOf(entry), 1);
  return res.status(500).json({ message: "申込処理に失敗しました" });
}
```

---

#### 4. キャンセル時に返金失敗するとデータが消える

```javascript
await refundCharge(entry.chargeId);  // ❌ ここで例外が投げられると…
entries.splice(idx, 1);              // ← 実行されないが、エラー処理次第では不整合も起きうる
```

返金失敗時の `catch` がないため、**返金できていないのにキャンセル扱いになるリスク**がある。

---

### 🟡 中程度の問題

#### 5. 入力バリデーションが皆無

```javascript
const { name, email, department, seminarId, card } = req.body;
// ❌ すべて undefined でも処理が進む
```

**確認すべき項目：**
| フィールド | チェック例 |
|---|---|
| `name` | 必須、文字列 |
| `email` | 必須、メール形式 |
| `seminarId` | 必須 |
| `card` | 必須、card番号形式など |

---

#### 6. エントリIDが衝突する

```javascript
// ❌ splice で削除するとインデックスがずれ、IDが重複する
id: "e" + (entries.length + 1),
```

**例：** 3件登録 → 1件削除 → 新規登録で `e3` が重複

```javascript
// 修正例
let entryCounter = 0;
id: "e" + (++entryCounter),
```

---

#### 7. キャンセル時に締切・認可チェックがない

キャンセル期限や「本人のみキャンセル可能」という制約が存在しない。

---

### 🟢 軽微な問題

#### 8. エラーハンドリングが不統一

```javascript
// chargeCard が失敗した場合、unhandled rejection になる可能性
const charge = await chargeCard({ amount: seminar.fee, card });
```

グローバルエラーハンドラーがなく、500エラーが適切に返らない。

```javascript
// 追加推奨
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "サーバーエラーが発生しました" });
});
```

---

### まとめ

| 優先度 | 問題 |
|---|---|
| 🔴 緊急 | 定員オーバー（競合状態） |
| 🔴 緊急 | 決済後エラーで返金されない |
| 🔴 高 | 二重申込の未防止 |
| 🟡 中 | 入力バリデーション欠如 |
| 🟡 中 | エントリID重複 |
| 🟢 低 | グローバルエラーハンドラー不在 |
