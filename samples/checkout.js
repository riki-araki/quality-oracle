// samples/checkout.js
// ※ これは quality-oracle の動作確認用に「わざとバグを仕込んだ」サンプル。
//    実際のバグ例: 決済の二重送信ガード無し / エラー握りつぶし / 入力検証の不整合 など。
//    本物のコードではない。エンジンが「人間にしか答えられない確認質問」を出せるかを試す素材。

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

// 会員登録: ここではメール形式を検証している。
async function registerUser(form) {
  if (!isValidEmail(form.email)) {
    showError("メールアドレスの形式が正しくありません");
    return;
  }
  await fetch("/api/users", {
    method: "POST",
    body: JSON.stringify({ email: form.email, name: form.name }),
  });
  location.href = "/welcome";
}

// 注文確定: 「注文確定」ボタン押下で呼ばれる。
async function submitOrder(cart) {
  // (1) 二重送信ガードが無い: ボタン連打で複数回実行されうる。
  // (2) email を検証せずそのまま送信（registerUser とは不整合）。
  // (3) total はクライアントの値をそのまま信用している。
  const payload = {
    email: cart.email,
    items: cart.items,
    total: cart.total,
  };

  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const order = await res.json();

    // 決済API（冪等キー無し → リトライ/連打で二重課金の恐れ）。
    await fetch("/api/payments/charge", {
      method: "POST",
      body: JSON.stringify({ orderId: order.id, amount: cart.total }),
    });
  } catch (e) {
    // (4) エラーを握りつぶす（ログも再表示もしない）。
  }

  // (5) 成功・失敗にかかわらず完了画面へ遷移する。
  location.href = "/thanks";
}
