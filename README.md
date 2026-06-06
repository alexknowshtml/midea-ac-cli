# midea-ac

Command-line tool for controlling Midea air conditioners via your local network. No cloud required after initial setup.

Works with any Midea-manufactured AC unit, including units sold under brand names like Toshiba, Carrier, Friedrich, Senville, Comfee, and Klimaire.

## Prerequisites

Python 3 and [msmart-ng](https://github.com/mill1000/midea-msmart):

```bash
pip install msmart-ng
```

Your machine must be on the same WiFi network as your AC.

## Install

```bash
npm install -g github:alexknowshtml/midea-ac-cli
```

## Setup

Run once to discover your device and save credentials locally:

```bash
midea-ac setup
```

This broadcasts on your LAN, finds the AC, authenticates with Midea's cloud to get a local token, and saves everything to `~/.midea-ac.json`. After setup, all commands work fully offline.

> **Note:** Setup requires a one-time internet connection to provision the local token. After that, no internet access is needed.

## Commands

```
midea-ac status              Current state (power, temp, mode, fan, eco, filter)
midea-ac on                  Turn on
midea-ac off                 Turn off
midea-ac cool <temp>         Cool mode at °F (62–86)
midea-ac heat <temp>         Heat mode at °F (62–86)
midea-ac fan <speed>         Fan speed: auto | low | medium | high | silent
midea-ac eco on|off          Toggle eco mode
midea-ac filter-reset        Steps to physically reset the filter alert
```

## Examples

```bash
midea-ac status
# Power:        ON
# Mode:         Cool
# Target temp:  72°F
# Indoor temp:  74°F
# Outdoor temp: 89°F
# Fan:          Auto
# Eco:          On

midea-ac cool 70
# Cool mode set to 70°F.

midea-ac off
# AC turned off.
```

## Agent / Scripting Mode

When output is piped, all commands return JSON:

```bash
midea-ac status | jq '.result.indoor_temperature_f'
# 74
```

JSON envelope format:

```json
{
  "ok": true,
  "command": "midea-ac status",
  "result": {
    "power": true,
    "mode": "Cool",
    "target_temperature_f": 72,
    "indoor_temperature_f": 74,
    "outdoor_temperature_f": 89,
    "fan_speed": "Auto",
    "eco": true,
    "filter_alert": false
  },
  "next_actions": [...]
}
```

## Config File

Credentials are stored at `~/.midea-ac.json`:

```json
{
  "ip": "192.168.1.x",
  "port": 6444,
  "id": 123456789,
  "token": "...",
  "key": "..."
}
```

To add a device manually or swap devices, edit this file directly.

## How It Works

Midea ACs communicate over TCP on your local network using the M-Smart protocol. This CLI wraps [msmart-ng](https://github.com/mill1000/midea-msmart), which implements that protocol in Python.

V3 devices (most units from ~2020 onward) require a token/key pair that is provisioned once via Midea's cloud. After that, all communication is local — no internet required.

## Troubleshooting

**"No devices found"** — Make sure your AC is powered on, connected to WiFi, and your machine is on the same network.

**"msmart-ng not found"** — Run `pip install msmart-ng` and try again.

**"Can't get available token"** — Your Midea account may be on an older cloud endpoint. Re-register the device using the [NetHome Plus](https://apps.apple.com/us/app/nethome-plus/id1008456411) app and run setup again.

## License

MIT
