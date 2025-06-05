# i18n-audit

**🛠️ A CLI tool for auditing, converting, and managing i18n translation files with CSV.**
Supports converting between translation JSON/JS files and CSV, detecting unused or variable-based keys, and generating actionable reports.

---

## 💡 Why This Tool Exists

Managing i18n translations can be painful — especially when collaborating with non-technical translators or using external tools like Google Sheets.

This tool was created to:

- **Flatten i18n JSON/JS files into CSV** for easy editing in external tools
- **Revert edited CSV files back into i18n format**
- **Detect undefined or unused keys** that may be cluttering your codebase
- **Highlight dynamic keys** or patterns that require manual inspection

It's designed for both **developer sanity** and **translator friendliness**.

---

## ⚠️ Warning

This tool **may not detect all unused or undefined translations** in your codebase.

- It assumes you're using standard translation functions like `$t('key')` or `t('key')` and for interpolation `t('key.'+variableName)` or ``t(`key.${variableName}`)``.
- If your project uses custom wrappers, renamed translation functions, or dynamic key generation, some keys **may be missed**.
- Use the `localization-needs-attention.csv` output to manually review potentially dynamic or ambiguous keys.

Always verify results manually when in doubt.

---

## ✨ Features

- ✅ Convert translation `.json` or `.js` files to CSV
- ✅ Revert `.csv` back to translation `.json`
- ✅ Detect **unused**, **undefined**, or **variable-based** keys
- ✅ Generates an **"attention" report** for manual inspection
- ✅ Optional inclusion of source references (file\:line\:col)

---

## 📦 Installation

Run via `npx` (no install required):

```bash
npx i18n-audit -i your-translation-file.json
```

---

## 🚀 Usage

### Convert translation file to CSV

Always run in root of project (or spesific cases where you want to start search for)

```bash
npx i18n-audit -i translation.json
```

- Outputs:

  - `localization-all.csv`: All flattened key-value pairs
  - `localization-needs-attention.csv`: Keys needing manual attention (e.g. dynamic keys, undefined or unused)

### Convert CSV back to i18n JSON

```bash
npx i18n-audit -i localization-all.csv
```

- Outputs:

  - `localization-from-csv.json`: Reconstructed translation file from CSV

---

## ⚠️ File Output Notice

This tool **will always overwrite** the following files in the current directory:

- `localization-all.csv`
- `localization-needs-attention.csv`
- `localization-from-csv.json`

---

## 🧩 Options

| Argument         | Accepts                 | Description                                                          | Required | Default       |
| ---------------- | ----------------------- | -------------------------------------------------------------------- | -------- | ------------- |
| `-i`             | File path               | Input file (`.json`, `.js`, or `.csv`)                               | ✅       | —             |
| `--print`        | `"all"` / `"attention"` | Print only the specified CSV to stdout                               | ❌       | `"attention"` |
| `--write`        | —                       | Write output(s) to disk (instead of only printing)                   | ❌       | `false`       |
| `--no-attention` | —                       | Skip generating `attention.csv`                                      | ❌       | `false`       |
| `--with-source`  | —                       | Add source location (path\:line\:column) for each key (if available) | ❌       | `false`       |

---

## 📌 Examples

### 1. Audit a translation file

```bash
npx i18n-audit -i en.json --write
```

### 2. Convert CSV back to translation JSON

```bash
npx i18n-audit -i localization-all.csv --write
```

### 3. Just print attention report to stdout

```bash
npx i18n-audit -i en.json
```

---

## 📄 License

MIT
