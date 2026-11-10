# 🧮 Subnet Planner

**Plan a whole network in seconds: VLSM subnetting, an IPv4 calculator, and ready-to-paste Cisco and MikroTik configs.**

### 👉 [Live demo: anas352.github.io/subnet-planner](https://anas352.github.io/subnet-planner/)

![tests](https://github.com/anas352/subnet-planner/actions/workflows/tests.yml/badge.svg)
![no build](https://img.shields.io/badge/build-none-brightgreen)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)

It's a static site written in plain JavaScript, with no framework and no build step. Everything runs in the browser.

## ✨ Features

**VLSM planner**
- Enter a block (`10.20.0.0/22`) and the subnets you need (name + hosts)
- Allocates largest-first, so every subnet is aligned with **no gaps**
- Shows network, mask, usable range, broadcast and unused addresses for each subnet
- Draws an **address-space bar** and lists the remaining free space as clean CIDR blocks
- Explains when something doesn't fit: *"Needs 448 addresses but 10.0.0.0/25 only has 128. Use at least a /24."*
- Optional **/31 for point-to-point links** (RFC 3021)
- **Share link**: the whole plan is stored in the URL

**Config generator**
- **Cisco**: VLANs, SVIs and DHCP pools with excluded gateway addresses
- **MikroTik (RouterOS v7)**: VLAN interfaces, IP addresses, pools, DHCP servers and networks
- **CSV** for Excel or documentation
- Copy or download with one click

**Subnet calculator**
- Accepts `10.1.2.3/20` or `172.16.5.9 255.255.255.0`
- Network, broadcast, range, wildcard (for ACLs and OSPF), class, private/public, and binary view
- Split any network into equal smaller subnets

## 📸 Example
Plan `192.168.1.0/24` for Sales (50), HR (10), IT (100) and a WAN link (2):

| Subnet | Network | Usable range |
|---|---|---|
| IT | 192.168.1.0/25 | .1 – .126 |
| Sales | 192.168.1.128/26 | .129 – .190 |
| HR | 192.168.1.192/28 | .193 – .206 |
| WAN | 192.168.1.208/30 | .209 – .210 |
| *free* | 192.168.1.212/30, .216/29, .224/27 | |

## 🚀 Run locally
```bash
python -m http.server 8000      # then open http://localhost:8000
```
(ES modules need a web server, so double-clicking `index.html` won't work.)

## 🧪 Tests
```bash
npm test        # node --test, nothing to install
```
The tests cover IP parsing, masks, `/31` and `/32`, range-to-CIDR, the textbook VLSM example, error messages, and the Cisco, MikroTik and CSV output.

## 📁 Layout
```
index.html, style.css
src/ip.js     all the math + config generators (pure functions, tested)
src/app.js    UI
tests/        node:test unit tests
```

---

## 🇸🇦 بالعربي
تطبيق ويب **لتقسيم الشبكات (VLSM)**: بتكتب الشبكة والأقسام اللي بدك ياها (مثلاً: المكاتب 200 جهاز، الضيوف 120، الكاميرات 25)،
وهو بيقسّمها بأفضل طريقة، وبيعطيك **إعدادات Cisco وMikroTik جاهزة** (VLANs و IPs و DHCP)، أو ملف CSV.
وفيه كمان **حاسبة Subnet** كاملة. كلو بيشتغل بالمتصفح وما بيحتاج تثبيت.

MIT © 2026 Anas
