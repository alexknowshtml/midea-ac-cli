#!/usr/bin/env node
import { Command } from "commander";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_PATH = join(homedir(), ".midea-ac.json");

interface DeviceConfig {
  name?: string;
  ip: string;
  port: number;
  id: number;
  token: string;
  key: string;
}

const isAgent = !process.stdout.isTTY;

function loadConfig(): DeviceConfig {
  if (!existsSync(CONFIG_PATH)) {
    respondError(
      "midea-ac",
      `No config found at ${CONFIG_PATH}`,
      "Run 'midea-ac setup' to discover and configure your device"
    );
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    respondError("midea-ac", `Config file at ${CONFIG_PATH} is invalid JSON`, "Delete it and run 'midea-ac setup' again");
    process.exit(1);
  }
}

function runLocal(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", timeout: 15000 });
}

function getMsmartPath(): string {
  const candidates = [
    "msmart-ng",
    `${homedir()}/Library/Python/3.9/bin/msmart-ng`,
    `${homedir()}/Library/Python/3.11/bin/msmart-ng`,
    `${homedir()}/Library/Python/3.12/bin/msmart-ng`,
    "/usr/local/bin/msmart-ng",
    "/usr/bin/msmart-ng",
  ];
  for (const p of candidates) {
    try {
      execSync(`${p} --version 2>/dev/null`, { encoding: "utf8" });
      return p;
    } catch {
      // not found, try next
    }
  }
  respondError(
    "midea-ac",
    "msmart-ng not found",
    "Install it with: pip install msmart-ng"
  );
  process.exit(1);
}

function parseQueryOutput(raw: string): Record<string, unknown> | null {
  const get = (key: string) => {
    const m = raw.match(new RegExp(`'${key}':\\s*([^,}\\n]+)`));
    return m ? m[1].trim() : null;
  };
  const power = get("power");
  if (!power) return null;
  return {
    power,
    target_temperature: get("target_temperature"),
    indoor_temperature: get("indoor_temperature"),
    outdoor_temperature: get("outdoor_temperature"),
    mode: get("mode"),
    fan_speed: get("fan_speed"),
    eco: get("eco"),
    filter_alert: get("filter_alert"),
  };
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function formatMode(mode: string): string {
  const m = mode.match(/OperationalMode\.(\w+)/);
  if (m) {
    const map: Record<string, string> = { AUTO: "Auto", COOL: "Cool", DRY: "Dry", HEAT: "Heat", FAN_ONLY: "Fan" };
    return map[m[1]] ?? m[1];
  }
  return mode;
}

function formatFan(fan: string): string {
  const m = fan.match(/FanSpeed\.(\w+)/);
  if (m) {
    const map: Record<string, string> = { SILENT: "Silent", LOW: "Low", MEDIUM: "Medium", HIGH: "High", AUTO: "Auto", MAX: "Max" };
    return map[m[1]] ?? m[1];
  }
  return fan;
}

function respond(command: string, result: unknown, next_actions: { command: string; description: string }[] = []) {
  if (isAgent) {
    console.log(JSON.stringify({ ok: true, command, result, next_actions }));
  }
  return result;
}

function respondError(command: string, message: string, fix: string) {
  if (isAgent) {
    console.log(
      JSON.stringify({
        ok: false,
        command,
        error: { message, code: "COMMAND_FAILED" },
        fix,
        next_actions: [{ command: "midea-ac status", description: "Check current device state" }],
      })
    );
  } else {
    console.error(`Error: ${message}`);
    console.error(`Fix:   ${fix}`);
  }
  process.exit(1);
}

const program = new Command();

program
  .name("midea-ac")
  .description("Control your Midea air conditioner via local network")
  .version("1.0.0");

program.action(() => {
  const tree = {
    description: "Control your Midea air conditioner via local network",
    commands: [
      { command: "midea-ac setup", description: "Discover device and save config" },
      { command: "midea-ac status", description: "Get current state" },
      { command: "midea-ac on", description: "Turn on" },
      { command: "midea-ac off", description: "Turn off" },
      { command: "midea-ac cool <tempF>", description: "Cool mode at °F (62–86)" },
      { command: "midea-ac heat <tempF>", description: "Heat mode at °F (62–86)" },
      { command: "midea-ac fan <speed>", description: "Fan speed: auto|low|medium|high|silent" },
      { command: "midea-ac eco <on|off>", description: "Toggle eco mode" },
      { command: "midea-ac filter-reset", description: "Steps to physically reset filter alert" },
    ],
  };
  if (isAgent) {
    console.log(JSON.stringify({ ok: true, command: "midea-ac", result: tree, next_actions: [{ command: "midea-ac setup", description: "Configure device" }] }));
  } else {
    console.log("midea-ac — Midea Air Conditioner Control\n");
    tree.commands.forEach((c) => console.log(`  ${c.command.padEnd(32)} ${c.description}`));
    console.log("\nFirst time? Run: midea-ac setup");
  }
});

program
  .command("setup")
  .description("Discover device on local network and save config")
  .action(() => {
    const msmart = getMsmartPath();
    console.log("Discovering Midea devices on your local network...\n");
    let raw: string;
    try {
      raw = runLocal(`${msmart} discover 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac setup", String(e), "Make sure you're on the same WiFi network as your AC");
      return;
    }

    // Parse first device from discover output
    const ipMatch = raw.match(/'ip':\s*'([^']+)'/);
    const portMatch = raw.match(/'port':\s*(\d+)/);
    const idMatch = raw.match(/'id':\s*(\d+)/);
    const keyMatch = raw.match(/'key':\s*'([^']+)'/);
    const tokenMatch = raw.match(/'token':\s*'([^']+)'/);

    if (!ipMatch || !idMatch || !keyMatch || !tokenMatch) {
      respondError(
        "midea-ac setup",
        "No devices found on the local network",
        "Make sure your AC is powered on, on WiFi, and your machine is on the same network"
      );
      return;
    }

    const config: DeviceConfig = {
      ip: ipMatch[1],
      port: parseInt(portMatch?.[1] ?? "6444"),
      id: parseInt(idMatch[1]),
      token: tokenMatch[1],
      key: keyMatch[1],
    };

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`Device found and config saved to ${CONFIG_PATH}\n`);
    console.log(`  IP:   ${config.ip}`);
    console.log(`  ID:   ${config.id}`);
    console.log(`\nRun 'midea-ac status' to verify.`);
  });

program
  .command("status")
  .description("Get current AC state")
  .action(() => {
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;

    let raw: string;
    try {
      raw = runLocal(`${msmart} query ${flags} ${config.ip} 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac status", String(e), `Check that your machine can reach the AC at ${config.ip}`);
      return;
    }

    const data = parseQueryOutput(raw);
    if (!data) {
      respondError("midea-ac status", "Failed to parse device response", "Try running msmart-ng directly with --debug flag");
      return;
    }

    const indoor = parseFloat(String(data.indoor_temperature));
    const target = parseFloat(String(data.target_temperature));
    const outdoor = parseFloat(String(data.outdoor_temperature));

    const normalized = {
      power: String(data.power) === "True",
      mode: formatMode(String(data.mode)),
      target_temperature_f: cToF(target),
      indoor_temperature_f: cToF(indoor),
      outdoor_temperature_f: cToF(outdoor),
      fan_speed: formatFan(String(data.fan_speed)),
      eco: String(data.eco) === "True",
      filter_alert: String(data.filter_alert) === "True",
    };

    const result = respond("midea-ac status", normalized, [
      { command: "midea-ac cool 72", description: "Set to cool at 72°F" },
      { command: "midea-ac off", description: "Turn off" },
    ]);

    if (result && !isAgent) {
      console.log(`Power:        ${normalized.power ? "ON" : "OFF"}`);
      console.log(`Mode:         ${normalized.mode}`);
      console.log(`Target temp:  ${normalized.target_temperature_f}°F`);
      console.log(`Indoor temp:  ${normalized.indoor_temperature_f}°F`);
      console.log(`Outdoor temp: ${normalized.outdoor_temperature_f}°F`);
      console.log(`Fan:          ${normalized.fan_speed}`);
      console.log(`Eco:          ${normalized.eco ? "On" : "Off"}`);
      if (normalized.filter_alert) console.log("⚠️  Filter alert: clean the filter");
    }
  });

program
  .command("on")
  .description("Turn the AC on")
  .action(() => {
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;
    try {
      runLocal(`${msmart} control ${flags} ${config.ip} power=on 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac on", String(e), "Check connectivity to your AC");
      return;
    }
    respond("midea-ac on", { power: true }, [{ command: "midea-ac status", description: "Verify current state" }]);
    if (!isAgent) console.log("AC turned on.");
  });

program
  .command("off")
  .description("Turn the AC off")
  .action(() => {
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;
    try {
      runLocal(`${msmart} control ${flags} ${config.ip} power=off 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac off", String(e), "Check connectivity to your AC");
      return;
    }
    respond("midea-ac off", { power: false }, [{ command: "midea-ac status", description: "Verify current state" }]);
    if (!isAgent) console.log("AC turned off.");
  });

program
  .command("cool <temp>")
  .description("Cool mode at specified temperature (°F)")
  .action((tempF: string) => {
    const f = parseInt(tempF);
    if (isNaN(f) || f < 62 || f > 86) {
      respondError("midea-ac cool", "Temperature must be between 62–86°F", "Example: midea-ac cool 72");
      return;
    }
    const cRounded = Math.round(((f - 32) * 5) / 9 * 2) / 2;
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;
    try {
      runLocal(`${msmart} control ${flags} ${config.ip} power=on mode=2 target_temperature=${cRounded} 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac cool", String(e), "Check connectivity to your AC");
      return;
    }
    respond("midea-ac cool", { mode: "cool", target_f: f, target_c: cRounded }, [{ command: "midea-ac status", description: "Verify state" }]);
    if (!isAgent) console.log(`Cool mode set to ${f}°F.`);
  });

program
  .command("heat <temp>")
  .description("Heat mode at specified temperature (°F)")
  .action((tempF: string) => {
    const f = parseInt(tempF);
    if (isNaN(f) || f < 62 || f > 86) {
      respondError("midea-ac heat", "Temperature must be between 62–86°F", "Example: midea-ac heat 70");
      return;
    }
    const cRounded = Math.round(((f - 32) * 5) / 9 * 2) / 2;
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;
    try {
      runLocal(`${msmart} control ${flags} ${config.ip} power=on mode=4 target_temperature=${cRounded} 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac heat", String(e), "Check connectivity to your AC");
      return;
    }
    respond("midea-ac heat", { mode: "heat", target_f: f, target_c: cRounded }, [{ command: "midea-ac status", description: "Verify state" }]);
    if (!isAgent) console.log(`Heat mode set to ${f}°F.`);
  });

program
  .command("fan <speed>")
  .description("Set fan speed: auto | low | medium | high | silent")
  .action((speed: string) => {
    const speedMap: Record<string, number> = { silent: 20, low: 40, medium: 60, high: 80, auto: 102 };
    const val = speedMap[speed.toLowerCase()];
    if (!val) {
      respondError("midea-ac fan", `Unknown speed '${speed}'`, "Valid options: auto, low, medium, high, silent");
      return;
    }
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;
    try {
      runLocal(`${msmart} control ${flags} ${config.ip} fan_speed=${val} 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac fan", String(e), "Check connectivity to your AC");
      return;
    }
    respond("midea-ac fan", { fan_speed: speed }, [{ command: "midea-ac status", description: "Verify state" }]);
    if (!isAgent) console.log(`Fan speed set to ${speed}.`);
  });

program
  .command("eco <state>")
  .description("Toggle eco mode: on | off")
  .action((state: string) => {
    const on = state.toLowerCase() === "on";
    const off = state.toLowerCase() === "off";
    if (!on && !off) {
      respondError("midea-ac eco", `Unknown state '${state}'`, "Use: midea-ac eco on  OR  midea-ac eco off");
      return;
    }
    const config = loadConfig();
    const msmart = getMsmartPath();
    const flags = `--id ${config.id} --token '${config.token}' --key '${config.key}'`;
    try {
      runLocal(`${msmart} control ${flags} ${config.ip} eco=${on ? "true" : "false"} 2>&1`);
    } catch (e: unknown) {
      respondError("midea-ac eco", String(e), "Check connectivity to your AC");
      return;
    }
    respond("midea-ac eco", { eco: on }, [{ command: "midea-ac status", description: "Verify state" }]);
    if (!isAgent) console.log(`Eco mode ${on ? "on" : "off"}.`);
  });

program
  .command("filter-reset")
  .description("Instructions to physically reset the filter alert")
  .action(() => {
    const steps = [
      "1. Clean or replace the filter on the indoor unit",
      "2. Press and hold the FILTER button on the remote for 3 seconds",
      "   (Some remotes label it CLEAN or have a filter icon)",
      "3. If no button on remote, check for a small reset pinhole on the unit",
      "4. Run 'midea-ac status' to confirm filter_alert is cleared",
    ];
    const result = {
      note: "Filter alert cannot be reset programmatically — must be done physically",
      steps,
    };
    respond("midea-ac filter-reset", result, [{ command: "midea-ac status", description: "Check if filter_alert cleared" }]);
    if (!isAgent) {
      console.log("Filter alert must be reset physically:\n");
      steps.forEach((s) => console.log(s));
    }
  });

program.parse();
