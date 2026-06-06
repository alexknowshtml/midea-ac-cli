# Midea AC Skill for Claude

Drop this file into your Claude skills directory to control your Midea AC with natural language.

## Prerequisites

1. Install the CLI: `npm install -g github:alexknowshtml/midea-ac-cli`
2. Run setup once: `midea-ac setup`
3. Place this file at `~/.claude/skills/midea-ac/SKILL.md` (or equivalent for your Claude setup)

## When to Use

Invoke when the user asks to:
- Check AC status, temperature, or current mode
- Turn the AC on or off
- Change temperature or switch modes (cool/heat/fan)
- Adjust fan speed or eco mode
- Ask about filter status or how to reset the filter alert

## CLI Reference

All commands are run as `midea-ac <command>`. The CLI reads device credentials from `~/.midea-ac.json`.

| Command | Description |
|---------|-------------|
| `status` | Get current state (power, temp, mode, fan, eco, filter) |
| `on` | Turn on |
| `off` | Turn off |
| `cool <tempF>` | Cool mode at specified °F (62–86) |
| `heat <tempF>` | Heat mode at specified °F (62–86) |
| `fan <speed>` | Fan speed: auto \| low \| medium \| high \| silent |
| `eco on\|off` | Toggle eco mode |
| `filter-reset` | Physical steps to reset the filter alert |

## Instructions

1. Parse the user's intent
2. Run the appropriate `midea-ac` command via Bash
3. Parse the JSON output (piped output returns JSON automatically)
4. Report back conversationally — don't dump raw JSON

### Temperature Handling

- CLI accepts and returns °F only (62–86°F range)
- If user says "set to 22" with no unit, ask: Celsius or Fahrenheit?
- If context makes it obvious (e.g. "72 degrees" in the US), assume °F

### Status Output Fields

All temperatures are in °F — no conversion needed.

- `power`: boolean
- `mode`: string ("Cool", "Heat", "Auto", "Dry", "Fan")
- `target_temperature_f`: set point in °F
- `indoor_temperature_f`: current room temp in °F
- `outdoor_temperature_f`: outside temp in °F
- `fan_speed`: string ("Auto", "Low", "Medium", "High", "Silent")
- `eco`: boolean
- `filter_alert`: boolean — if true, remind user to run `midea-ac filter-reset`

## Example Invocations

User: "What's the temperature?"
→ Run `midea-ac status`, report `indoor_temperature_f`

User: "Turn on the AC and set it to 70"
→ Run `midea-ac cool 70`

User: "Turn it off"
→ Run `midea-ac off`

User: "Set the fan to low"
→ Run `midea-ac fan low`

User: "The filter light is on"
→ Run `midea-ac filter-reset`, relay the physical steps
