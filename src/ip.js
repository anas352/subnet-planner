// IPv4 math, VLSM allocation and config generation. Pure functions, no DOM.
// Addresses are unsigned 32-bit integers (use >>> 0 to keep them unsigned).

export function parseIp(str) {
  const parts = String(str).trim().split(".");
  if (parts.length !== 4) throw new Error(`"${str}" is not a valid IPv4 address`);
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) throw new Error(`"${str}" is not a valid IPv4 address`);
    n = n * 256 + Number(p);
  }
  return n >>> 0;
}

export function formatIp(n) {
  n >>>= 0;
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function maskFromPrefix(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixFromMask(mask) {
  const m = typeof mask === "string" ? parseIp(mask) : mask >>> 0;
  const prefix = 32 - Math.log2(((~m) >>> 0) + 1);
  if (!Number.isInteger(prefix) || maskFromPrefix(prefix) !== m) throw new Error("mask is not contiguous");
  return prefix;
}

/** "10.0.0.5/22" or "10.0.0.5 255.255.252.0" -> {ip, prefix, network} */
export function parseCidr(str) {
  const s = String(str).trim();
  let ipPart, prefix;
  if (s.includes("/")) {
    const [a, b] = s.split("/");
    ipPart = a;
    prefix = /^\d{1,2}$/.test(b) ? Number(b) : NaN;
  } else if (/\s+/.test(s)) {
    const [a, b] = s.split(/\s+/);
    ipPart = a;
    prefix = prefixFromMask(b);
  } else {
    ipPart = s;
    prefix = 32;
  }
  if (!(prefix >= 0 && prefix <= 32)) throw new Error("prefix must be between /0 and /32");
  const ip = parseIp(ipPart);
  return { ip, prefix, network: (ip & maskFromPrefix(prefix)) >>> 0 };
}

export function blockSize(prefix) {
  return 2 ** (32 - prefix);
}

export function usableHosts(prefix) {
  if (prefix === 32) return 1;
  if (prefix === 31) return 2; // RFC 3021 point-to-point
  return blockSize(prefix) - 2;
}

/** Smallest prefix whose usable host count fits `hosts`. /31 only when allowed (p2p links). */
export function prefixForHosts(hosts, { allow31 = false } = {}) {
  if (!(hosts >= 1)) throw new Error("hosts must be at least 1");
  if (hosts === 1) return 32;
  if (hosts === 2 && allow31) return 31;
  for (let p = 30; p >= 0; p--) if (usableHosts(p) >= hosts) return p;
  throw new Error("too many hosts for IPv4");
}

export function isPrivate(n) {
  return (n >>> 24) === 10 || (n >>> 20) === 0xac1 || (n >>> 16) === 0xc0a8 || (n >>> 22) === 0x191; // 10/8 172.16/12 192.168/16 100.64/10
}

export function ipClass(n) {
  const first = n >>> 24;
  if (first < 128) return "A";
  if (first < 192) return "B";
  if (first < 224) return "C";
  if (first < 240) return "D (multicast)";
  return "E (reserved)";
}

export function subnetInfo(network, prefix) {
  network = (network & maskFromPrefix(prefix)) >>> 0;
  const size = blockSize(prefix);
  const broadcast = (network + size - 1) >>> 0;
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const mask = maskFromPrefix(prefix);
  return {
    network, prefix, size, broadcast, first: first >>> 0, last: last >>> 0,
    mask, wildcard: (~mask) >>> 0, usable: usableHosts(prefix),
    cidr: `${formatIp(network)}/${prefix}`,
  };
}

/** Split an address range [start, end] into the fewest aligned CIDR blocks. */
export function rangeToCidrs(start, end) {
  const out = [];
  let cur = start;
  while (cur <= end) {
    let prefix = 32;
    while (prefix > 0) {
      const p = prefix - 1;
      const size = blockSize(p);
      if (cur % size !== 0 || cur + size - 1 > end) break;
      prefix = p;
    }
    out.push({ network: cur >>> 0, prefix });
    cur += blockSize(prefix);
  }
  return out;
}

/**
 * VLSM: allocate subnets for each request inside `base` ("10.0.0.0/22").
 * Largest first, so every block is naturally aligned and nothing is wasted between blocks.
 */
export function vlsm(base, requests, { allow31 = false } = {}) {
  const { network, prefix } = parseCidr(base);
  const total = blockSize(prefix);
  const items = requests.map((r, index) => {
    const hosts = Math.floor(Number(r.hosts));
    if (!r.name || !String(r.name).trim()) throw new Error(`row ${index + 1}: name is required`);
    if (!(hosts >= 1)) throw new Error(`"${r.name}": hosts must be a number ≥ 1`);
    return { name: String(r.name).trim(), hosts, index, prefix: prefixForHosts(hosts, { allow31 }) };
  });
  const sorted = [...items].sort((a, b) => a.prefix - b.prefix || a.index - b.index);
  const needed = sorted.reduce((s, it) => s + blockSize(it.prefix), 0);
  if (needed > total) {
    const smallest = Math.ceil(32 - Math.log2(needed));
    throw new Error(`Needs ${needed} addresses but ${base} only has ${total}. Use at least a /${smallest}.`);
  }
  let cursor = network;
  const allocations = sorted.map((it) => {
    const info = subnetInfo(cursor, it.prefix);
    cursor += info.size;
    return { ...info, name: it.name, hosts: it.hosts, waste: info.usable - it.hosts };
  });
  const end = network + total - 1;
  const free = cursor <= end ? rangeToCidrs(cursor, end) : [];
  return { base: subnetInfo(network, prefix), allocations, free, used: needed, total };
}

/** Split base into equal subnets of `newPrefix`. */
export function equalSplit(base, newPrefix, limit = 256) {
  const { network, prefix } = parseCidr(base);
  if (newPrefix < prefix || newPrefix > 32) throw new Error(`new prefix must be between /${prefix} and /32`);
  const count = 2 ** (newPrefix - prefix);
  const out = [];
  for (let i = 0; i < Math.min(count, limit); i++) out.push(subnetInfo(network + i * blockSize(newPrefix), newPrefix));
  return { count, subnets: out };
}

// ---- config generators -------------------------------------------------------
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "net";

export function ciscoConfig(allocations, { vlanStart = 10, dns = "8.8.8.8", dhcp = true, domain = "" } = {}) {
  const lines = ["! Generated by Subnet Planner", "!"];
  allocations.forEach((a, i) => {
    const vlan = vlanStart + i * 10;
    lines.push(`! ${a.name}: ${a.cidr} (${a.hosts} hosts requested, ${a.usable} usable)`,
      `vlan ${vlan}`, ` name ${slug(a.name)}`,
      `interface Vlan${vlan}`, ` description ${a.name}`,
      ` ip address ${formatIp(a.first)} ${formatIp(a.mask)}`, " no shutdown", "!");
  });
  if (dhcp) {
    allocations.filter((a) => a.prefix <= 30).forEach((a) => {
      lines.push(`ip dhcp excluded-address ${formatIp(a.first)}`,
        `ip dhcp pool ${slug(a.name)}`, ` network ${formatIp(a.network)} ${formatIp(a.mask)}`,
        ` default-router ${formatIp(a.first)}`, ` dns-server ${dns}`);
      if (domain) lines.push(` domain-name ${domain}`);
      lines.push("!");
    });
  }
  return lines.join("\n");
}

export function mikrotikConfig(allocations, { vlanStart = 10, dns = "8.8.8.8", dhcp = true, parent = "bridge" } = {}) {
  const lines = ["# Generated by Subnet Planner (RouterOS v7)"];
  const names = allocations.map((a, i) => ({ a, vlan: vlanStart + i * 10, iface: `vlan${vlanStart + i * 10}-${slug(a.name)}` }));
  lines.push("/interface vlan");
  names.forEach(({ a, vlan, iface }) => lines.push(`add name=${iface} vlan-id=${vlan} interface=${parent} comment="${a.name}"`));
  lines.push("/ip address");
  names.forEach(({ a, iface }) => lines.push(`add address=${formatIp(a.first)}/${a.prefix} interface=${iface} comment="${a.name}"`));
  const pools = names.filter(({ a }) => a.prefix <= 29); // a pool needs at least a few addresses
  if (dhcp && pools.length) {
    lines.push("/ip pool");
    pools.forEach(({ a }) => lines.push(`add name=pool-${slug(a.name)} ranges=${formatIp(a.first + 1)}-${formatIp(a.last)}`));
    lines.push("/ip dhcp-server");
    pools.forEach(({ a, iface }) => lines.push(`add name=dhcp-${slug(a.name)} interface=${iface} address-pool=pool-${slug(a.name)}`));
    lines.push("/ip dhcp-server network");
    pools.forEach(({ a }) => lines.push(`add address=${a.cidr} gateway=${formatIp(a.first)} dns-server=${dns} comment="${a.name}"`));
  }
  return lines.join("\n");
}

export function csv(allocations) {
  const rows = [["name", "hosts_requested", "network", "prefix", "mask", "first_host", "last_host", "broadcast", "usable", "unused"]];
  for (const a of allocations) {
    rows.push([a.name, a.hosts, formatIp(a.network), a.prefix, formatIp(a.mask), formatIp(a.first), formatIp(a.last),
      formatIp(a.broadcast), a.usable, a.waste]);
  }
  return rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
}

export function toBinary(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].map((o) => o.toString(2).padStart(8, "0")).join(".");
}
