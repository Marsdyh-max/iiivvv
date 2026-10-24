/*
* 江苏油价面板 · 版式参照用户原「常州油价」面板（汽车之家数据源）
*
* 价格数据源：汽车之家常州油价页（江苏为全省统一限价，常州价即江苏价）
* https://www.autohome.com.cn/oil/320400.html
* 显示：92/95/98/0号柴油 当前价 + 上次涨跌、加满一箱花费、
* 上次调价日期、上一窗口是否搁浅、下次调价窗口日期、下次预期价格、
* 近几次调价走势、更新时间。
* 图标颜色：上次调价涨→红，跌→绿，持平→橙。
*
* 可选参数：argument=url=<其他城市的汽车之家油价页> 可换城市
*
*
* 1. WINDOWS：调价窗口日期（每个窗口当天 24 时生效）。
* 规则是每 10 个工作日一次；2027 年元旦前后要按放假安排重新核对。
* 2. FORECAST：下一窗口的机构预测涨跌（元/升）。预测每天都在变，
* 脚本拿不到实时预测，需要手动改；日期对不上下一窗口时，面板会自动隐藏。
*/

const DEFAULT_URL = "https://www.autohome.com.cn/oil/320400.html"; // 常州（江苏统一价）
const CACHE_KEY = "jiangsu_oil_autohome_cache_v1";
const TANK_L = 50; // 油箱容量（升）
const HISTORY_N = 8; // 走势图取最近几次调价

// 已确定的调价窗口（当天 24 时）
const WINDOWS = [
"2026-09-24",
"2026-10-15",
"2026-10-29",
"2026-11-12",
"2026-11-26",
"2026-12-10",
"2026-12-24",
];

// 下一窗口的机构预测（元/升）。window 必须等于下一窗口日期才会显示。
// 2026-10-23（本轮计价周期第 6 个工作日）机构测算：汽油上调约 290 元/吨，
// 折 92号 +0.23、95号 +0.25 元/升（来源：今日油价测算，多家媒体转载）。
const FORECAST = {
window: "2026-10-29",
d92: 0.23,
d95: 0.25,
note: "机构测算（第6个工作日），以发改委公告为准",
};

function getUrl() {
const arg = typeof $argument!== "undefined"? $argument: "";
const m = String(arg || "").match(/url=(\S+)/);
return m? m[1]: DEFAULT_URL;
}

function get(url) {
return new Promise((resolve, reject) => {
$httpClient.get(
{
url,
policy: "DIRECT",
timeout: 20,
headers: {
"User-Agent":
"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
},
},
(err, resp, body) => {
if (err ||!resp || resp.status!== 200) reject(err || "HTTP " + (resp && resp.status));
else resolve(body);
}
);
});
}

function toText(html) {
return html
.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
.replace(/<[^>]+>/g, " ")
.replace(/&nbsp;/g, " ")
.replace(/\s+/g, " ");
}

const num = (s) => parseFloat(s);
const pad = (x) => String(x).padStart(2, "0");

function parse(html) {
const t = toText(html);
const d = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
const pick = (label) => {
const m = t.match(new RegExp(label + "为\\s*(\\d+(?:\\.\\d+)?)\\s*元"));
return m? num(m[1]): null;
};
const cur = {
p92: pick("92号汽油"),
p95: pick("95号汽油"),
p98: pick("98号汽油"),
p0: pick("0号柴油"),
};
if (cur.p92 == null || cur.p95 == null) throw "解析失败：没取到 92/95 号价格";

// 走势表：每行 "MM-DD 92 95 98 0号"，最新的在最前（日期是价格开始执行的日子）
const rows = [];
const re = /(\d{2}-\d{2})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g;
let m;
while ((m = re.exec(t)) && rows.length < HISTORY_N + 1) {
rows.push({ date: m[1], p92: num(m[2]), p95: num(m[3]), p98: num(m[4]), p0: num(m[5])});
}
return { cur, rows, pageDate: d? { y: +d[1], m: +d[2], d: +d[3]}: null};
}

const diff = (a, b) => Math.round((a - b) * 100) / 100;

function arrow(v) {
if (v === null || v === undefined) return "";
if (v > 0) return "🔺" + v.toFixed(2);
if (v < 0) return "🔻" + Math.abs(v).toFixed(2);
return "➖持平";
}

function spark(values) {
const bars = "▁▂▃▄▅▆▇█";
const min = Math.min(...values);
const max = Math.max(...values);
return values
.map((v) => bars[max === min? 3: Math.round(((v - min) / (max - min)) * 7)])
.join("");
}

// ---- 日期工具（都按 UTC 零点比较，避免时区干扰）----
const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const DAY = 86400000;
const WK = ["日", "一", "二", "三", "四", "五", "六"];

function parseYMD(s) {
const [y, m, d] = s.split("-").map(Number);
return { y, m, d, t: utc(y, m, d)};
}

function render(data, note) {
const { cur, rows} = data;
const now = new Date();
const today = utc(now.getFullYear(), now.getMonth() + 1, now.getDate());
const nowYear = now.getFullYear();

const last = rows[0];
const prev = rows[1];
const d92 = prev && last? diff(last.p92, prev.p92): null;
const d95 = prev && last? diff(last.p95, prev.p95): null;
const d98 = prev && last && cur.p98!= null? diff(last.p98, prev.p98): null;
const d0 = prev && last && cur.p0!= null? diff(last.p0, prev.p0): null;

const L = [];
L.push(`⛽ 92号汽油　${cur.p92.toFixed(2)} 元　${arrow(d92)}`);
L.push(`⛽ 95号汽油　${cur.p95.toFixed(2)} 元　${arrow(d95)}`);
if (cur.p98!= null) L.push(`⛽ 98号汽油　${cur.p98.toFixed(2)} 元　${arrow(d98)}`);
if (cur.p0!= null) L.push(`🛢 0号柴油　 ${cur.p0.toFixed(2)} 元　${arrow(d0)}`);
L.push("┈┈┈┈┈┈┈┈┈┈┈┈");
L.push(`🧮 加满${TANK_L}L　92号 ${Math.round(cur.p92 * TANK_L)} 元 · 95号 ${Math.round(cur.p95 * TANK_L)} 元`);

// 下次窗口：第一个 >= 今天的窗口（当天 24 时才生效）
const nextWin = WINDOWS.map(parseYMD).find((w) => w.t >= today);
if (nextWin) {
const left = Math.round((nextWin.t - today) / DAY);
const wd = WK[new Date(nextWin.t).getUTCDay()];
L.push(
`🗓 下次窗口　${pad(nextWin.m)}-${pad(nextWin.d)}（周${wd}）24时（${left === 0? "今晚": left + " 天后"}）`
);
const key = `${nextWin.y}-${pad(nextWin.m)}-${pad(nextWin.d)}`;
if (FORECAST && FORECAST.window === key) {
L.push(`🔮 预期92号　≈ ${(cur.p92 + FORECAST.d92).toFixed(2)} 元　${arrow(FORECAST.d92)}`);
L.push(`🔮 预期95号　≈ ${(cur.p95 + FORECAST.d95).toFixed(2)} 元　${arrow(FORECAST.d95)}`);
}
} else {
L.push("🗓 下次窗口　请更新脚本里的 WINDOWS");
}

L.push(`🕒 更新于 ${pad(now.getHours())}:${pad(now.getMinutes())}`);
if (note) L.push(note);

const color = d92 > 0? "#FF3B30": d92 < 0? "#34C759": "#FF9500";
$done({
title: "江苏油价 · 汽车之家",
content: L.join("\n"),
icon: "fuelpump.fill",
"icon-color": color,
});
}

(async () => {
try {
const data = parse(await get(getUrl()));
$persistentStore.write(JSON.stringify(data), CACHE_KEY);
render(data);
} catch (e) {
const c = $persistentStore.read(CACHE_KEY);
if (c) {
try {
return render(JSON.parse(c), `⚠️ 显示缓存数据，更新失败：${e}`);
} catch (_) {}
}
$done({
title: "江苏油价 · 汽车之家",
content: "❌ 获取失败：" + e,
icon: "fuelpump.fill",
"icon-color": "#8E8E93",
});
}
})();
