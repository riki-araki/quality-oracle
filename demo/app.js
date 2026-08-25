// seminar-signup
// 社内セミナー申込フォーム。spec.md の仕様に沿って実装。

const express = require("express");
const { chargeCard, refundCharge, sendMail } = require("./external");

const app = express();
app.use(express.json());

// ── データ（今回はメモリ上に持つ） ──────────────────────────────────────────
const seminars = [
  { id: "s1", title: "AI活用入門", fee: 3000, capacity: 30, deadline: "2026-09-10" },
  { id: "s2", title: "設計レビューの進め方", fee: 5000, capacity: 12, deadline: "2026-09-18" },
  { id: "s3", title: "テスト自動化ハンズオン", fee: 8000, capacity: 8, deadline: "2026-09-25" },
];

const entries = [];

// ── 一覧 ────────────────────────────────────────────────────────────────────
app.get("/api/seminars", (req, res) => {
  const list = seminars.map((s) => {
    const taken = entries.filter((e) => e.seminarId === s.id).length;
    return {
      id: s.id,
      title: s.title,
      fee: s.fee,
      deadline: s.deadline,
      remaining: s.capacity - taken,
    };
  });
  res.json(list);
});

// ── 申込 ────────────────────────────────────────────────────────────────────
app.post("/api/entries", async (req, res) => {
  const { name, email, department, seminarId, card } = req.body;

  const seminar = seminars.find((s) => s.id === seminarId);
  if (!seminar) {
    return res.status(404).json({ message: "セミナーが見つかりません" });
  }

  // 締切チェック
  const today = new Date().toISOString().slice(0, 10);
  if (today > seminar.deadline) {
    return res.status(400).json({ message: "申込期限を過ぎています" });
  }

  // 定員チェック
  const taken = entries.filter((e) => e.seminarId === seminarId).length;
  if (taken >= seminar.capacity) {
    return res.status(400).json({ message: "定員に達しています" });
  }

  // 決済
  const charge = await chargeCard({ amount: seminar.fee, card });

  const entry = {
    id: "e" + (entries.length + 1),
    name,
    email,
    department,
    seminarId,
    chargeId: charge.id,
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);

  // 完了メール
  await sendMail({
    to: email,
    subject: `【申込完了】${seminar.title}`,
    body: `${name} 様\n\nお申し込みを受け付けました。\n参加費: ${seminar.fee}円`,
  });

  res.json({ entryId: entry.id });
});

// ── キャンセル ──────────────────────────────────────────────────────────────
app.post("/api/entries/:id/cancel", async (req, res) => {
  const idx = entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ message: "申込が見つかりません" });
  }

  const entry = entries[idx];
  await refundCharge(entry.chargeId);
  entries.splice(idx, 1);

  const seminar = seminars.find((s) => s.id === entry.seminarId);
  await sendMail({
    to: entry.email,
    subject: `【キャンセル完了】${seminar.title}`,
    body: `${entry.name} 様\n\nお申し込みをキャンセルしました。返金いたします。`,
  });

  res.json({ ok: true });
});

app.listen(3000);
