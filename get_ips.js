#!/usr/bin/env node

const os = require('os');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const prompts = require('prompts');

const OUTPUT_FILE = path.join(__dirname, 'ips.txt');
const TEST_HOST = '8.8.8.8';
const TEST_PORT = 53;
const TIMEOUT_MS = 3000;

function getHardwarePortMap() {
  try {
    const output = execSync('networksetup -listallhardwareports', { encoding: 'utf8' });
    const map = {};
    for (const block of output.split(/\n\n+/)) {
      const portMatch = block.match(/^Hardware Port: (.+)$/m);
      const deviceMatch = block.match(/^Device: (.+)$/m);
      if (portMatch && deviceMatch) {
        map[deviceMatch[1].trim()] = portMatch[1].trim();
      }
    }
    return map;
  } catch {
    return {};
  }
}

function computeSubnet(ip, netmask) {
  const ipParts = ip.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  return ipParts.map((octet, i) => octet & maskParts[i]).join('.');
}

function checkConnectivity(localIp) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    const done = (connected) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(connected);
      }
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));

    socket.connect({ host: TEST_HOST, port: TEST_PORT, localAddress: localIp });
  });
}

async function main() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [ifaceName, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (
        addr.family === 'IPv4' &&
        !addr.internal &&
        !addr.address.startsWith('169.254.')
      ) {
        candidates.push({ iface: ifaceName, ip: addr.address, netmask: addr.netmask });
      }
    }
  }

  if (candidates.length === 0) {
    console.log('No candidate interfaces found.');
    return;
  }

  const hwPorts = getHardwarePortMap();

  console.log(`Checking ${candidates.length} candidate interface(s) for internet connectivity...`);

  const results = [];
  for (const candidate of candidates) {
    const type = hwPorts[candidate.iface] || '';
    const typeStr = type ? ` [${type}]` : '';
    const label = `  ${candidate.iface}${typeStr} (${candidate.ip})`;
    process.stdout.write(label.padEnd(48));
    const connected = await checkConnectivity(candidate.ip);
    console.log(connected ? 'connected' : 'no internet');
    results.push({ ...candidate, type, connected });
  }

  const connected = results.filter(r => r.connected);

  console.log('');

  if (connected.length === 0) {
    console.log('No interfaces with internet connectivity found. ips.txt was not updated.');
    return;
  }

  // Group connected interfaces by subnet
  const subnetGroups = new Map();
  for (const r of connected) {
    const subnet = computeSubnet(r.ip, r.netmask);
    const key = `${subnet}/${r.netmask}`;
    if (!subnetGroups.has(key)) {
      subnetGroups.set(key, []);
    }
    subnetGroups.get(key).push(r);
  }

  // Resolve conflicts where multiple interfaces share a subnet
  const selectedIps = [];
  for (const [subnet, group] of subnetGroups) {
    if (group.length === 1) {
      selectedIps.push(group[0]);
      continue;
    }

    console.log(`Multiple connections found on subnet ${subnet}:`);
    for (const r of group) {
      const typeStr = r.type ? ` [${r.type}]` : '';
      console.log(`  ${r.iface}${typeStr} — ${r.ip}`);
    }
    console.log('srtla only supports one connection per subnet.\n');

    const { chosen } = await prompts({
      type: 'select',
      name: 'chosen',
      message: 'Which connection do you want to use?',
      choices: group.map(r => ({
        title: `${r.type || r.iface} — ${r.ip}`,
        description: r.type ? r.iface : undefined,
        value: r,
      })),
    });

    if (!chosen) {
      console.log('Selection cancelled. ips.txt was not updated.');
      return;
    }

    selectedIps.push(chosen);
  }

  const ips = selectedIps.map(r => r.ip);
  fs.writeFileSync(OUTPUT_FILE, ips.join('\n') + '\n', 'utf8');

  console.log(`Wrote ${ips.length} IP(s) to ips.txt:`);
  for (const r of selectedIps) {
    const typeStr = r.type ? ` [${r.type}]` : '';
    console.log(`  ${r.ip}${typeStr}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
