# エンジニアが書きそうな依頼

依頼文: 「このコードのバグと改善点をレビューしてください。」

model: claude-sonnet-4-6

---

## コードレビュー

### 🔴 バグ（動作に影響する問題）

#### 1. 決済失敗時にエントリが登録されない一方、逆のパターンが危険

```javascript
// 現状：chargeCard が例外を throw した場合は entry が登録されないので一見 OK だが…
const charge = await chargeCard({ amount: seminar.fee, card });

// ❌ chargeCard 成功後、entries.push より前にプロセスがクラッシュしたケースは
// 「課金済み・未登録」状態になり得る（実運用では重大）
entries.push(entry);
```

#### 2. 入力バリデーションが皆無

```javascript
// ❌ 必須項目が undefined でも処理が続行される
const { name, email, department, seminarId, card } = req.body;
// name/email/card が undefined のまま chargeCard や sendMail に渡る
```

#### 3. 重複申込を防ぐチェックがない

```javascript
// ❌ 同じ email + seminarId の組み合わせで何度でも申込できてしまう
const taken = entries.filter((e) => e.seminarId === seminarId).length;
```

#### 4. キャンセル時の締切・本人確認がない

```javascript
// ❌ 誰でも任意のエントリをキャンセルできる（認証なし）
app.post("/api/entries/:id/cancel", async (req, res) => {
  const idx = entries.findIndex((e) => e.id === req.params.id);
```

#### 5. エラーハンドリングが一切ない（最重要）

```javascript
// ❌ chargeCard / refundCharge / sendMail が throw すると
//    未ハンドルの Promise rejection → サーバーがクラッシュ or 無応答
const charge = await chargeCard({ amount: seminar.fee, card });
```

#### 6. キャンセル時に返金失敗してもエントリが削除される

```javascript
// ❌ refundCharge が失敗した場合でも entries.splice が実行されると
//    「返金なし・キャンセル済み」状態になる
await refundCharge(entry.chargeId);
entries.splice(idx, 1);  // ← 返金成功を確認してから削除すべき
```

#### 7. 定員・締切チェックと決済の間に競合状態（Race Condition）

```javascript
// ❌ 同時リクエストで定員チェックをパスした後、
//    両者が chargeCard を実行してしまう（定員オーバー課金）
const taken = entries.filter((e) => e.seminarId === seminarId).length;
if (taken >= seminar.capacity) { ... }
// ↕ この間に別リクエストが割り込める
const charge = await chargeCard(...);
```

---

### 🟡 設計・品質の問題

#### 8. エントリIDが衝突する

```javascript
// ❌ splice でエントリが削除されると length が変わり ID が重複する
id: "e" + (entries.length + 1),
// 例: [e1, e2, e3] → e2 削除 → 次の ID が "e3" で衝突
```

**修正例：**
```javascript
const { randomUUID } = require("crypto");
id: randomUUID(),
```

#### 9. メール送信失敗が申込成功/失敗に影響する

```javascript
// ❌ sendMail が失敗すると申込自体がエラー扱いになる
//    通知メールは「ベストエフォート」にすべき
await sendMail({ ... });
res.json({ entryId: entry.id });
```

**修正例：**
```javascript
entries.push(entry);
res.json({ entryId: entry.id }); // まず申込を確定

// メールはバックグラウンドで（失敗してもログだけ）
sendMail({ ... }).catch((err) => console.error("メール送信失敗:", err));
```

#### 10. 締切日の比較が文字列比較に依存している

```javascript
// △ "2026-09-10" 形式の一貫性が崩れると誤動作
//   （例: タイムゾーンが UTC でない環境）
const today = new Date().toISOString().slice(0, 10);
if (today > seminar.deadline) { ... }
```

---

### 🟢 修正済みコード（主要部分）

```javascript
const { randomUUID } = require("crypto");

// バリデーションヘルパー
function validateEntry({ name, email, department, seminarId, card }) {
  if (!name || !email || !department || !seminarId || !card) {
    return "必須項目が不足しています";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "メールアドレスの形式が不正です";
  }
  return null;
}

app.post("/api/entries", async (req, res) => {
  const { name, email, department, seminarId, card } = req.body;

  // ① バリデーション
  const validationError = validateEntry(req.body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  // ② セミナー存在確認
  const seminar = seminars.find((s) => s.id === seminarId);
  if (!seminar) {
    return res.status(404).json({ message: "セミナーが見つかりません" });
  }

  // ③ 締切チェック（UTC 固定）
  const today = new Date().toISOString().slice(0, 10);
  if (today > seminar.deadline) {
    return res.status(400).json({ message: "申込期限を過ぎています" });
  }

  // ④ 重複申込チェック
  const duplicate = entries.find(
    (e) => e.seminarId === seminarId && e.email === email
  );
  if (duplicate) {
    return res.status(409).json({ message: "すでに申し込み済みです" });
  }

  // ⑤ 定員チェック
  const taken = entries.filter((e) => e.seminarId === seminarId).length;
  if (taken >= seminar.capacity) {
    return res.status(400).json({ message: "定員に達しています" });
  }

  // ⑥ 決済（失敗時は即リターン）
  let charge;
  try {
    charge = await chargeCard({ amount: seminar.fee, card });
  } catch (err) {
    console.error("決済エラー:", err);
    return res.status(502).json({ message: "決済処理に失敗しました" });
  }

  // ⑦ エントリ登録（決済成功後）
  const entry = {
    id: randomUUID(),          // 衝突しない ID
    name,
    email,
    department,
    seminarId,
    chargeId: charge.id,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);

  // ⑧ 申込確定を先にレスポンス、メールはベストエフォート
  res.json({ entryId: entry.id });

  sendMail({
    to: email,
    subject: `【申込完了】${seminar.title}`,
    body: `${name} 様\n\nお申し込みを受け付けました。\n参加費: ${seminar.fee}円`,
  }).catch((err) => console.error("メール送信失敗:", err));
});

app.post("/api/entries/:id/cancel", async (req, res) => {
  const idx = entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ message: "申込が見つかりません" });
  }

  const entry = entries[idx];

  // ① 返金処理（成功を確認してからエントリ削除）
  try {
    await refundCharge(entry.chargeId);
  } catch (err) {
    console.error("返金エラー:", err);
    return res.status(502).json({ message: "返金処理に失敗しました" });
  }

  // ② 返金成功後にエントリ削除
  entries.splice(idx, 1);

  res.json({ ok: true });

  const seminar = seminars.find((s) => s.id === entry.seminarId);
  sendMail({
    to: entry.email,
    subject: `【キャンセル完了】${seminar?.title ?? "セミナー"}`,
    body: `${entry.name} 様\n\nお申し込みをキャンセルしました。返金いたします。`,
  }).catch((err) => console.error("メール送信失敗:", err));
});
```

---

### まとめ

| 優先度 | 項目 | 種別 |
|--------|------|------|
| 🔴 即対応 | try-catch によるエラーハンドリング追加 | バグ |
| 🔴 即対応 | 入力バリデーション追加 | バグ |
| 🔴 即対応 | 返金成功後にエントリ削除 | バグ |
| 🟡 早急 | 重複申込チェック | 設計 |
| 🟡 早急 | エントリID を UUID に変更 | バグ |
| 🟡 早急 | メール送信をベストエフォートに | 設計 |
| 🟢 中長期 | 競合状態対策（DB ロック等） | 設計 |
| 🟢 中長期 | 認証・認可の追加 | セキュリティ |
