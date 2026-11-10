import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIp, formatIp, parseCidr, prefixForHosts, prefixFromMask, subnetInfo, rangeToCidrs,
  vlsm, equalSplit, ciscoConfig, mikrotikConfig, csv, isPrivate, toBinary,
} from "../src/ip.js";

test("parse and format", () => {
  assert.equal(formatIp(parseIp("192.168.1.255")), "192.168.1.255");
  assert.equal(parseIp("255.255.255.255"), 4294967295);
  for (const bad of ["1.2.3", "256.1.1.1", "1.2.3.x", "01.2.3.4.5", ""]) assert.throws(() => parseIp(bad));
});

test("cidr parsing in both notations", () => {
  assert.deepEqual(parseCidr("10.0.1.77/22"), { ip: parseIp("10.0.1.77"), prefix: 22, network: parseIp("10.0.0.0") });
  assert.equal(parseCidr("172.16.5.4 255.255.255.0").prefix, 24);
  assert.equal(prefixFromMask("255.255.255.252"), 30);
  assert.throws(() => prefixFromMask("255.0.255.0"));
  assert.throws(() => parseCidr("10.0.0.0/33"));
});

test("hosts to prefix", () => {
  assert.equal(prefixForHosts(2), 30);
  assert.equal(prefixForHosts(2, { allow31: true }), 31);
  assert.equal(prefixForHosts(62), 26);
  assert.equal(prefixForHosts(63), 25);
  assert.equal(prefixForHosts(254), 24);
  assert.equal(prefixForHosts(1), 32);
});

test("subnet info", () => {
  const s = subnetInfo(parseIp("192.168.10.77"), 26);
  assert.equal(formatIp(s.network), "192.168.10.64");
  assert.equal(formatIp(s.broadcast), "192.168.10.127");
  assert.equal(formatIp(s.first), "192.168.10.65");
  assert.equal(formatIp(s.last), "192.168.10.126");
  assert.equal(formatIp(s.wildcard), "0.0.0.63");
  assert.equal(s.usable, 62);
  const p2p = subnetInfo(parseIp("10.0.0.0"), 31);
  assert.equal(formatIp(p2p.first), "10.0.0.0");
  assert.equal(p2p.usable, 2);
});

test("range to cidrs", () => {
  const blocks = rangeToCidrs(parseIp("10.0.0.192"), parseIp("10.0.3.255")).map((b) => `${formatIp(b.network)}/${b.prefix}`);
  assert.deepEqual(blocks, ["10.0.0.192/26", "10.0.1.0/24", "10.0.2.0/23"]);
});

test("vlsm classic textbook example", () => {
  const r = vlsm("192.168.1.0/24", [
    { name: "Sales", hosts: 50 }, { name: "HR", hosts: 10 }, { name: "IT", hosts: 100 }, { name: "WAN", hosts: 2 },
  ]);
  assert.deepEqual(r.allocations.map((a) => `${a.name} ${a.cidr}`), [
    "IT 192.168.1.0/25", "Sales 192.168.1.128/26", "HR 192.168.1.192/28", "WAN 192.168.1.208/30",
  ]);
  assert.equal(r.used, 128 + 64 + 16 + 4);
  assert.deepEqual(r.free.map((b) => `${formatIp(b.network)}/${b.prefix}`), ["192.168.1.212/30", "192.168.1.216/29", "192.168.1.224/27"]);
  assert.equal(r.allocations[0].waste, 26);
});

test("vlsm errors", () => {
  assert.throws(() => vlsm("10.0.0.0/24", [{ name: "Big", hosts: 300 }]), /at least a \/23/);
  assert.throws(() => vlsm("10.0.0.0/24", [{ name: "", hosts: 3 }]), /name is required/);
  assert.throws(() => vlsm("10.0.0.0/24", [{ name: "x", hosts: "abc" }]), /hosts must be/);
});

test("equal split", () => {
  const r = equalSplit("10.0.0.0/22", 24);
  assert.equal(r.count, 4);
  assert.equal(r.subnets[3].cidr, "10.0.3.0/24");
  assert.throws(() => equalSplit("10.0.0.0/22", 20));
});

test("config generators", () => {
  const { allocations } = vlsm("10.10.0.0/23", [{ name: "Office LAN", hosts: 200 }, { name: "Guests", hosts: 60 }]);
  const cisco = ciscoConfig(allocations, { dns: "1.1.1.1" });
  assert.match(cisco, /interface Vlan10\n description Office LAN\n ip address 10\.10\.0\.1 255\.255\.255\.0/);
  assert.match(cisco, /ip dhcp pool Guests\n network 10\.10\.1\.0 255\.255\.255\.192\n default-router 10\.10\.1\.1\n dns-server 1\.1\.1\.1/);
  const mt = mikrotikConfig(allocations, { parent: "bridge1" });
  assert.match(mt, /add name=vlan10-Office-LAN vlan-id=10 interface=bridge1/);
  assert.match(mt, /add name=pool-Guests ranges=10\.10\.1\.2-10\.10\.1\.62/);
  assert.match(mt, /add address=10\.10\.1\.0\/26 gateway=10\.10\.1\.1 dns-server=8\.8\.8\.8/);
  const lines = csv(allocations).split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "Office LAN,200,10.10.0.0,24,255.255.255.0,10.10.0.1,10.10.0.254,10.10.0.255,254,54");
});

test("misc helpers", () => {
  assert.ok(isPrivate(parseIp("172.20.1.1")));
  assert.ok(isPrivate(parseIp("100.64.0.1")));
  assert.ok(!isPrivate(parseIp("8.8.8.8")));
  assert.equal(toBinary(parseIp("255.255.255.192")), "11111111.11111111.11111111.11000000");
});
