// 江苏油价监控（Surge 脚本）v5
// 数据源：汽油价格网江苏页（手机站优先，多个地址依次兜底）
// 请求写死 policy: DIRECT 直连，避免被分流规则送到境外节点后遭数据源拦截
// 两种模式（由模块里的 argument 决定）：
//   notify —— 定时任务用：与上次记录比对，价格有变动才发通知；首次运行只存档、不打扰
//   panel  —— 面板用：整齐展示当前油价、较上次记录的涨跌、下次调价日与倒计时
const MODE = (($argument || "notify") + "").trim();
const URLS = [
  "http://m.qiyoujiage.com/jiangsu.shtml",
  "http://www.qiyoujiage.com/jiangsu.shtml",
  "https://www.qiyoujiage.com/jiangsu.shtml"
];
const KEY = "jiangsu_oil_prices_v1";
// 2026 年剩余调价窗口（国家发改委 10 个工作日一调；来源：公开调价时间表，2026 年共 25 轮）
// 用完后自动回退到数据源站点的标注（仅当标注日期未过期时才采用）
const WINDOWS = ["2026-10-29", "2026-11-12", "2026-11-26", "2026-12-10", "2026-12-24"];

const ITEMS = [
  { key: "92", name: "92#汽油", short: "92#", re: /江苏92[#号]汽油[^0-9]*([0-9]+\.[0-9]{1,2})/ },
  { key: "95", name: "95#汽油", short: "95#", re: /江苏95[#号]汽油[^0-9]*([0-9]+\.[0-9]{1,2})/ },
  { key: "98", name: "98#汽油", short: "98#", re: /江苏98[#号]汽油[^0-9]*([0-9]+\.[0-9]{1,2})/ },
  { key: "d0", name: "0#柴油",  short: "0#",  re: /江苏0[#号]柴油[^0-9]*([0-9]+\.[0-9]{1,2})/ }
];

fetchFrom(0);

function fetchFrom(idx) {
  if (idx >= URLS.length) return fail("网络请求失败（v5 直连已试 3 个地址）");
  $httpClient.get(
    {
      url: URLS[idx],
      policy: "DIRECT",
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
      handle(prices, siteNextLabel(data));
    }
  );
}

// 数据源站点的“下次调价”标注（该站更新滞后，仅当日期还没过时才采用）
function siteNextLabel(html) {
  const m = html.match(/下次油价\s*(\d{1,2})月(\d{1,2})日24时\s*调整/);
  if (!m) return null;
  const now = new Date();
  const t = new Date(now.getFullYear(), parseInt(m[1], 10) - 1, parseInt(m[2], 10));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (t < today) return null;
  return { month: parseInt(m[1], 10), day: parseInt(m[2], 10), date: t };
}

function nextWindow(siteLabel) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const s of WINDOWS) {
    const p = s.split("-");
    const t = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    if (t >= today) {
      return { month: t.getMonth() + 1, day: t.getDate(), days: Math.round((t - today) / 86400000) };
    }
  }
  if (siteLabel) {
    return { month: siteLabel.month, day: siteLabel.day, days: Math.round((siteLabel.date - today) / 86400000) };
  }
  return null;
}

function fmt(prices) {
  return ITEMS.filter((i) => prices[i.key] !== undefined)
    .map((i) => i.short + " " + prices[i.key].toFixed(2))
    .join("｜");
}

function diffs(old, prices) {
  return ITEMS.filter(
    (i) => prices[i.key] !== undefined && old[i.key] !== undefined && prices[i.key] !== old[i.key]
  ).map((i) => {
    const d = prices[i.key] - old[i.key];
    return {
      name: i.name,
      short: i.short,
      from: old[i.key],
      to: prices[i.key],
      delta: d,
      text:
        i.name + "：" + old[i.key].toFixed(2) + " → " + prices[i.key].toFixed(2) +
        "（" + (d > 0 ? "涨" : "跌") + " " + Math.abs(d).toFixed(2) + "）"
    };
  });
}

function handle(prices, siteLabel) {
  let old = null;
  try {
    const raw = $persistentStore.read(KEY);
    old = raw ? JSON.parse(raw) : null;
  } catch (e) {}

  const nw = nextWindow(siteLabel);
  const nextLine = nw
    ? "下次调价：" + nw.month + "月" + nw.day + "日 24时" + (nw.days > 0 ? "（还有 " + nw.days + " 天）" : "（今晚）")
    : "";

  if (MODE === "panel") {
    const lines = ITEMS.filter((i) => prices[i.key] !== undefined).map(
      (i) => i.name + "：" + prices[i.key].toFixed(2)
    );
    if (old) {
      const ds = diffs(old, prices);
      if (ds.length)
        lines.push("较上次：" + ds.map((d) => d.short + " " + (d.delta > 0 ? "↑" : "↓") + Math.abs(d.delta).toFixed(2)).join("，"));
    }
    lines.push("──────────");
    if (nextLine) lines.push(nextLine);
    $done({ title: "⛽ 江苏油价（元/升）", content: lines.join("\n"), icon: "fuelpump.fill", "icon-color": "#F6A21E" });
    return;
  }

  // notify 模式：更新存档；首次运行只存档不通知
  $persistentStore.write(JSON.stringify(prices), KEY);
  if (!old) return $done();
  const ds = diffs(old, prices);
  if (ds.length) {
    const bodyLines = ds.map((d) => d.text);
    bodyLines.push("──────────");
    bodyLines.push("现价：" + fmt(prices) + " 元/升");
    if (nextLine) bodyLines.push(nextLine);
    $notification.post("江苏油价变动", "", bodyLines.join("\n"));
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
