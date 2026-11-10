import {
  vlsm, formatIp, parseCidr, subnetInfo, equalSplit, ciscoConfig, mikrotikConfig, csv,
  isPrivate, ipClass, toBinary,
} from "./ip.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const COLORS = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7", "--c8"];
const EXAMPLE = [["Office LAN", 200], ["Wi-Fi Guests", 120], ["Servers", 30], ["CCTV", 25], ["VoIP", 50], ["Router link", 2]];

let fmt = "cisco";
let lastPlan = null;

// ---------------------------------------------------------------- toast/copy
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 1800);
}

async function copy(text, msg = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast("Copy failed: select the text manually");
  }
}

// ---------------------------------------------------------------- tabs
document.querySelectorAll("nav [data-tab]").forEach((btn) => btn.addEventListener("click", () => showTab(btn.dataset.tab)));

function showTab(tab) {
  document.querySelectorAll("nav [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("tab-vlsm").hidden = tab !== "vlsm";
  $("tab-calc").hidden = tab !== "calc";
  if (tab === "calc") calc();
}

// ---------------------------------------------------------------- VLSM rows
function addRow(name = "", hosts = "") {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td><input class="name" placeholder="e.g. Office" value="${esc(name)}" aria-label="Subnet name"></td>
    <td><input class="hosts" type="number" min="1" placeholder="hosts" value="${esc(hosts)}" aria-label="Hosts needed"></td>
    <td><button title="Remove" aria-label="Remove row">✕</button></td>`;
  tr.querySelector("button").addEventListener("click", () => { tr.remove(); plan(); });
  tr.querySelectorAll("input").forEach((i) => i.addEventListener("input", plan));
  $("rows").append(tr);
  return tr;
}

function readRows() {
  return [...$("rows").querySelectorAll("tr")]
    .map((tr) => ({ name: tr.querySelector(".name").value, hosts: tr.querySelector(".hosts").value }))
    .filter((r) => r.name.trim() || String(r.hosts).trim());
}

function setRows(rows) {
  $("rows").innerHTML = "";
  rows.forEach(([n, h]) => addRow(n, h));
  if (!rows.length) addRow();
}

// ---------------------------------------------------------------- planning
function plan() {
  const base = $("base").value;
  const rows = readRows();
  saveHash(base, rows);
  $("base").removeAttribute("aria-invalid");
  if (!rows.length) {
    $("error").hidden = true;
    $("result").hidden = true;
    return;
  }
  try {
    lastPlan = vlsm(base, rows, { allow31: $("allow31").checked });
  } catch (err) {
    if (/IPv4|prefix|mask/.test(err.message)) $("base").setAttribute("aria-invalid", "true");
    $("error").textContent = err.message;
    $("error").hidden = false;
    $("result").hidden = true;
    return;
  }
  $("error").hidden = true;
  $("result").hidden = false;
  render(lastPlan);
}

function render(p) {
  const pct = (100 * p.used / p.total).toFixed(1);
  const requested = p.allocations.reduce((s, a) => s + a.hosts, 0);
  const usable = p.allocations.reduce((s, a) => s + a.usable, 0);
  $("stats").innerHTML = [
    ["Block", p.base.cidr], ["Subnets", p.allocations.length], ["Address space used", `${pct}%`],
    ["Hosts requested / usable", `${requested} / ${usable}`], ["Free addresses", p.total - p.used],
  ].map(([k, v]) => `<div class="stat"><small>${k}</small><div>${esc(v)}</div></div>`).join("");

  const color = (i) => `var(${COLORS[i % COLORS.length]})`;
  $("space").innerHTML = p.allocations.map((a, i) =>
    `<span style="width:${100 * a.size / p.total}%;background:${color(i)}" title="${esc(a.name)} ${a.cidr}"></span>`).join("");
  $("legend").innerHTML = p.allocations.map((a, i) => `<span><i style="background:${color(i)}"></i>${esc(a.name)}</span>`).join("")
    + (p.free.length ? `<span><i style="background:var(--free);border:1px solid var(--line)"></i>free</span>` : "");

  const head = "<tr><th>Name</th><th>Hosts</th><th>Network</th><th>Mask</th><th>Usable range</th><th>Broadcast</th><th>Usable</th><th>Unused</th></tr>";
  const body = p.allocations.map((a, i) => `<tr><td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color(i)};margin-right:6px"></i>${esc(a.name)}</td>
    <td>${a.hosts}</td><td class="mono">${a.cidr}</td><td class="mono">${formatIp(a.mask)}</td>
    <td class="mono">${formatIp(a.first)} – ${formatIp(a.last)}</td><td class="mono">${a.prefix >= 31 ? "—" : formatIp(a.broadcast)}</td>
    <td>${a.usable}</td><td>${a.waste}</td></tr>`).join("");
  const free = p.free.map((b) => `<tr class="free"><td>free</td><td></td><td class="mono">${formatIp(b.network)}/${b.prefix}</td>
    <td colspan="5">${2 ** (32 - b.prefix)} addresses available</td></tr>`).join("");
  $("table").innerHTML = head + body + free;
  renderConfig();
}

function renderConfig() {
  if (!lastPlan) return;
  const opts = { vlanStart: Number($("vlan").value) || 10, dns: $("dns").value || "8.8.8.8", dhcp: $("dhcp").checked,
    parent: $("parent").value || "bridge" };
  const text = fmt === "cisco" ? ciscoConfig(lastPlan.allocations, opts)
    : fmt === "mikrotik" ? mikrotikConfig(lastPlan.allocations, opts) : csv(lastPlan.allocations);
  $("config").textContent = text;
  $("parentWrap").hidden = fmt !== "mikrotik";
}

$("fmt").addEventListener("click", (e) => {
  const b = e.target.closest("[data-fmt]");
  if (!b) return;
  fmt = b.dataset.fmt;
  $("fmt").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  renderConfig();
});
["vlan", "dns", "parent", "dhcp"].forEach((id) => $(id).addEventListener("input", renderConfig));
$("copy").addEventListener("click", () => copy($("config").textContent, "Config copied"));
$("download").addEventListener("click", () => {
  const ext = { cisco: "txt", mikrotik: "rsc", csv: "csv" }[fmt];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([$("config").textContent], { type: "text/plain" }));
  a.download = `subnet-plan-${fmt}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------------------------------------------------------------- share link (state in URL hash)
function saveHash(base, rows) {
  const s = rows.map((r) => `${encodeURIComponent(r.name.trim())}:${r.hosts}`).join(",");
  history.replaceState(null, "", `#n=${encodeURIComponent(base.trim())}&s=${s}`);
}

function loadHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (!params.get("n")) return false;
  $("base").value = params.get("n");
  const rows = (params.get("s") || "").split(",").filter(Boolean).map((pair) => {
    const i = pair.lastIndexOf(":");
    return [decodeURIComponent(pair.slice(0, i)), pair.slice(i + 1)];
  });
  setRows(rows);
  return true;
}

$("share").addEventListener("click", () => copy(location.href, "Share link copied"));
$("add").addEventListener("click", () => addRow().querySelector("input").focus());
$("example").addEventListener("click", () => { $("base").value = "10.20.0.0/22"; setRows(EXAMPLE); plan(); });
$("clear").addEventListener("click", () => { setRows([]); plan(); });
$("base").addEventListener("input", plan);
$("allow31").addEventListener("change", plan);

// ---------------------------------------------------------------- calculator
function calc() {
  let parsed;
  try {
    parsed = parseCidr($("calcInput").value);
  } catch (err) {
    $("calcError").textContent = err.message;
    $("calcError").hidden = false;
    $("calcOut").hidden = $("splitCard").hidden = true;
    return;
  }
  $("calcError").hidden = true;
  const s = subnetInfo(parsed.network, parsed.prefix);
  const rows = [
    ["Address", formatIp(parsed.ip)], ["Network", `${s.cidr}`], ["Netmask", `${formatIp(s.mask)}  (/${s.prefix})`],
    ["Wildcard (ACL / OSPF)", formatIp(s.wildcard)], ["Broadcast", s.prefix >= 31 ? "— (point-to-point)" : formatIp(s.broadcast)],
    ["Usable range", `${formatIp(s.first)} – ${formatIp(s.last)}`], ["Usable hosts", s.usable.toLocaleString()],
    ["Total addresses", s.size.toLocaleString()], ["Class", ipClass(parsed.ip)],
    ["Type", isPrivate(parsed.ip) ? "Private (RFC 1918 / CGNAT)" : "Public"],
    ["Binary mask", toBinary(s.mask)], ["Binary address", toBinary(parsed.ip)],
  ];
  $("calcTable").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td class="mono">${esc(v)}</td></tr>`).join("");
  $("calcOut").hidden = false;

  const sel = $("splitPrefix");
  const keep = Number(sel.value);
  sel.innerHTML = "";
  for (let p = s.prefix + 1; p <= Math.min(32, s.prefix + 10); p++) sel.add(new Option(`/${p}  (${2 ** (p - s.prefix)} subnets)`, p));
  $("splitCard").hidden = s.prefix >= 32;
  if (s.prefix >= 32) return;
  sel.value = keep > s.prefix && keep <= s.prefix + 10 ? keep : s.prefix + 1;
  split();
}

function split() {
  const { count, subnets } = equalSplit($("calcInput").value, Number($("splitPrefix").value), 128);
  $("splitTable").innerHTML = "<tr><th>#</th><th>Network</th><th>Usable range</th><th>Broadcast</th></tr>"
    + subnets.map((s, i) => `<tr><td>${i + 1}</td><td class="mono">${s.cidr}</td><td class="mono">${formatIp(s.first)} – ${formatIp(s.last)}</td>
      <td class="mono">${s.prefix >= 31 ? "—" : formatIp(s.broadcast)}</td></tr>`).join("")
    + (count > subnets.length ? `<tr class="free"><td colspan="4">…and ${count - subnets.length} more</td></tr>` : "");
}

$("calcInput").addEventListener("input", calc);
$("splitPrefix").addEventListener("change", split);

// ---------------------------------------------------------------- start
if (!loadHash()) setRows(EXAMPLE.slice(0, 4));
plan();
