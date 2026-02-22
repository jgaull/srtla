#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const IPS_FILE = 'ips.txt';
const SRTLA_SEND = './srtla_send';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 15000;
const BACKOFF_MULTIPLIER = 2;
const STABLE_THRESHOLD_MS = 30000;

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(`Error: config.json not found.`);
    console.error('Copy config.json.template to config.json and fill in your values.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config = JSON.parse(raw);

  const required = ['srtOutputDomain', 'srtOutputPort', 'srtInputPort'];
  for (const key of required) {
    if (config[key] === undefined) {
      console.error(`Error: Missing required config field "${key}".`);
      process.exit(1);
    }
  }

  return config;
}

let sleepDisabled = false;
let sudoPassword = null;

function disableSleep() {
  try {
    execSync('sudo -S pmset -a disablesleep 1', {
      input: sudoPassword + '\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    sleepDisabled = true;
    console.log('Mac sleep disabled.');
  } catch (err) {
    console.error(`Warning: Failed to disable sleep: ${err.message}`);
  }
}

function enableSleep() {
  if (!sleepDisabled) return;
  try {
    execSync('sudo -S pmset -a disablesleep 0', {
      input: sudoPassword + '\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    sleepDisabled = false;
    console.log('Mac sleep re-enabled.');
  } catch (err) {
    console.error(`Warning: Failed to re-enable sleep: ${err.message}`);
  }
}

function startProcess(config) {
  const args = [
    String(config.srtInputPort),
    config.srtOutputDomain,
    String(config.srtOutputPort),
    IPS_FILE,
  ];

  console.log(`Starting: ${SRTLA_SEND} ${args.join(' ')}`);

  const child = spawn(SRTLA_SEND, args, {
    stdio: 'inherit',
    cwd: __dirname,
  });

  return child;
}

async function main() {
  const config = loadConfig();

  const binaryPath = path.join(__dirname, 'srtla_send');
  if (!fs.existsSync(binaryPath)) {
    console.error(`Error: ${SRTLA_SEND} not found. Build it first with "make".`);
    process.exit(1);
  }

  const ipsPath = path.join(__dirname, IPS_FILE);
  if (!fs.existsSync(ipsPath)) {
    console.error(`Error: ${IPS_FILE} not found. Run "npm run get-ips" first.`);
    process.exit(1);
  }

  if (config.sudoPassword) {
    sudoPassword = config.sudoPassword;
    disableSleep();
  } else {
    console.log('Warning: sudoPassword not set in config.json. Mac sleep prevention disabled.');
  }

  let activeChild = null;

  function cleanup() {
    if (activeChild) {
      activeChild.kill();
      activeChild = null;
    }
    enableSleep();
    process.exit();
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  console.log(`OBS URL: srt://127.0.0.1:${config.srtInputPort}?mode=caller&streamid=[YOUR_SECRET_HERE]`);
  console.log('');

  let backoff = INITIAL_BACKOFF_MS;

  const launch = () => {
    const startTime = Date.now();
    const child = startProcess(config);
    activeChild = child;

    child.on('error', (err) => {
      console.error(`Failed to start process: ${err.message}`);
    });

    child.on('close', (code, signal) => {
      activeChild = null;
      const runtime = Date.now() - startTime;
      const reason = signal ? `signal ${signal}` : `exit code ${code}`;

      if (code === 0) {
        console.log('srtla_send exited cleanly.');
        return;
      }

      if (runtime >= STABLE_THRESHOLD_MS) {
        backoff = INITIAL_BACKOFF_MS;
      }

      console.error(`srtla_send terminated (${reason}) after ${Math.round(runtime / 1000)}s.`);
      console.log(`Restarting in ${backoff / 1000}s...`);

      setTimeout(() => {
        launch();
      }, backoff);

      backoff = Math.min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    });
  };

  launch();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
