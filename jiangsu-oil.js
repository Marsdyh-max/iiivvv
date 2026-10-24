// 江苏油价监控（Surge 脚本）v3
// 数据源：汽油价格网江苏页（手机站优先，多个地址依次兜底）
// 两种模式（由模块里的 argument 决定）：
//   notify —— 定时任务用：与上次记录比对，价格有变动才发通知；首次运行只存档、不打扰
//   panel  —— 面板用：显示当前油价、较上次记录的涨跌、下次调价日（站点标注过期则不显示）
const MODE = (($argument || "notify") + "").trim();
const URLS = [
  "http://m.qiyoujiage.com/jiangsu.shtml",
  "http://www.qiyoujiage.com/jiangsu.shtml",
  "https://www.qiyoujiage.com/jiangsu.shtml"
];
const KEY = "jiangsu_oil_prices_v1";

const ITEMS = [
  { key: "92", name: "92#汽油", re: /江苏92[#号]汽油[^0-9]*([0-9]+\.[0-9]{1,2})/ },
  { key: "95", name: "95#汽油", re: /江苏95[#号]汽油[^0-9]*([0-9]+\.[0-9]{1,2})/ },
  { key: "98", name: "98#汽油", re: /江苏98[#号]汽油[^0-9]*([0-9]+\.[0-9]{1,2})/ },
  { key: "d0", name: "0#柴油",  re: /江苏0[#号]柴油[^0-9]*([0-9]+\.[0-9]{1,2})/ }
];

fetchFrom(0);

function fetchFrom(idx) {
  if (idx >= URLS.length) return fail("网络请求失败（v3 已试 3 个地址）");
  $httpClient.get(
    {
      url: URLS[idx],
      timeout: 15,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "http://www.qiyoujiage.com/"
      }
    },
    (err, resp, data) => {
      if (err || !data || (resp && resp.status >= 400)) {
        console.log("江苏油价监控：第 " + (idx + 1) + " 个地址失败 " + URLS[idx] + " err=" + err + " status=" + (resp && resp.status));
        return fetchFrom(idx + 1);
      }
      const prices = {};
      for (const it of ITEMS) {
        const m = data.match(it.re);
        if (m) prices[it.key] = parseFloat(m[1]);
      }
      if (Object.keys(prices).length < 2) return fail("解析失败：数据源页面结构可能已变化");
      handle(prices, parseNext(data));
    }
  );
}

function parseNext(html) {
  const m = html.match(/下次油价\s*(\d{1,2})月(\d{1,2})日24时\s*调整/);
  if (!m) return "";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const t = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  if (t < today) return ""; // 站点标注滞后、日期已过时不展示，避免误导
  return m[1] + "月" + m[2] + "日24时";
}

function fmt(prices) {
  return ITEMS.filter((i) => prices[i.key] !== undefined)
    .map((i) => i.name + " " + prices[i.key].toFixed(2))
    .join("｜");
}

function diffs(old, prices) {
  return ITEMS.filter(
    (i) => prices[i.key] !== undefined && old[i.key] !== undefined && prices[i.key] !== old[i.key]
  ).map((i) => {
    const d = prices[i.key] - old[i.key];
    return {
      name: i.name,
      from: old[i.key],
      to: prices[i.key],
      delta: d,
      text:
        i.name + "：" + old[i.key].toFixed(2) + " → " + prices[i.key].toFixed(2) +
        "（" + (d > 0 ? "涨" : "跌") + " " + Math.abs(d).toFixed(2) + "）"
    };
  });
}

function handle(prices, next) {
  let old = null;
  try {
    const raw = $persistentStore.read(KEY);
    old = raw ? JSON.parse(raw) : null;
  } catch (e) {}

  if (MODE === "panel") {
    let content = fmt(prices) + " 元/升";
    if (old) {
      const ds = diffs(old, prices);
      if (ds.length) content += "\n较上次记录：" + ds.map((d) => d.name + " " + (d.delta > 0 ? "↑" : "↓") + Math.abs(d.delta).toFixed(2)).join("，");
    }
    if (next) content += "\n下次调价：" + next;
    $done({ title: "江苏油价（元/升）", content: content, icon: "fuelpump.fill", "icon-color": "#F6A21E" });
    return;
  }

  // notify 模式：更新存档；首次运行只存档不通知
  $persistentStore.write(JSON.stringify(prices), KEY);
  if (!old) return $done();
  const ds = diffs(old, prices);
  if (ds.length) {
    let body = ds.map((d) => d.text).join("\n") + "\n现价：" + fmt(prices) + " 元/升";
    if (next) body += "\n下次调价：" + next;
    $notification.post("江苏油价变动", "", body);
  }
  $done();
}

function fail(msg) {
  console.log("江苏油价监控：" + msg);
  if (MODE === "panel") {
    $done({ title: "江苏油价", content: msg, icon: "exclamationmark.triangle", "icon-color": "#FF3B30" });
  } else {
    $done();
  }
}
