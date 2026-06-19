<div align="center">

# json-query

**Query JSON files with readable path syntax — no jq manual required.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?labelColor=0B0A09)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-informational?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/json-query '.path' file.json
```

## Usage

```bash
# Extract a field
npx github:NickCirv/json-query '.users[0].name' data.json

# Pipe from stdin
cat api.json | npx github:NickCirv/json-query '.data[].email'

# Filter with a condition, then pluck a field
npx github:NickCirv/json-query '.users[? .age > 18] | .name' data.json

# Recursive search for all `id` values
npx github:NickCirv/json-query '..id' nested.json
```

| Flag | Description |
|------|-------------|
| `--pretty` | Pretty-print output (default for objects) |
| `-r`, `--raw` | Raw string output — no surrounding quotes |
| `-c`, `--compact` | Compact single-line JSON output |
| `--null-on-miss` | Output `null` instead of error on missing path |
| `-h`, `--help` | Show full help with examples |

## What it does

`json-query` is a zero-dependency CLI that walks JSON using a readable path syntax. It supports dot-notation (``.key``), array indexing (``[0]`` / ``[-1]``), full iteration (``[]``), filter expressions (``[? .field == "value"]``), recursive descent (``..key``), pipes (``| .field``), and functions like ``.length``, ``.sort``, ``.unique``, ``.flatten``, ``.reverse``, and ``.sort_by(.field)``. Works from a file argument or stdin, making it easy to slot into shell pipelines.

---
<sub>Zero dependencies · Node 18+ · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
