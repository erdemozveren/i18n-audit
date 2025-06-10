# i18n-audit

**🛠️ A CLI tool for auditing, converting, and managing i18n translation files using CSV.**
Supports converting between JSON/JS translation files and CSV, detecting unused or variable-based keys, and generating actionable reports.

> It depends on [ripgrep](https://github.com/BurntSushi/ripgrep) to find translation key occurrences in your project. It is only required for generating reports—if you don't use this feature, you don't need to install it

## 💡 Why This Tool Exists

Managing i18n translations can be painful — especially when collaborating with non-technical translators or using external tools like Google Sheets.

## ✨ Features

- ✅ Convert translation `.json` or `.js` files to **CSV** or **HTML** (supports both CommonJS and ES module formats)
- ✅ Revert `.csv` back to translation `.json`
- ✅ Detect **unused**, **undefined**, or **variable-based** keys
- ✅ Generate an **audit report** for manual inspection (**HTML** output format recommended)
- ✅ Show source references for easy location (file:line:col)
- ✅ Translate via local or remote [LibreTranslate](https://github.com/LibreTranslate/LibreTranslate) instance — easy to run locally using Docker

It's designed for both **developer sanity** and **translator friendliness**.

---

## ⚠️ Warning

This tool **may not detect all unused and undefined keys** in your codebase.

- It assumes you're using standard translation functions like `$t('key')` or `t('key')` and for interpolation `t('key.'+variableName)` or ``t(`key.${variableName}`)``.
- If your project uses custom wrappers, renamed translation functions, or dynamic key generation, some keys **may be missed**.
- Use the audit report to manually review potentially dynamic or ambiguous keys.

Always verify results manually when in doubt.

---

## 📦 Installation

Run via `npx` (or install globally with `-g` if you prefer):

```bash
npx i18n-audit -i your-translation-file.json
```

---

## 🚀 Usage Examples

### 1. Audit a translation file

```bash
npx i18n-audit -i en.json -o report.html --audit --to html
```

### 2. Convert between JS/JSON/CSV

```bash
npx i18n-audit -i en.json -o en.csv
npx i18n-audit -i tr.js -o tr.csv
npx i18n-audit -i en.csv -o en.json
```

### 3. Just print audit report to stdout

```bash
npx i18n-audit -i en.json --audit
```

### 4. Translate using local LibreTranslate server

```bash
npx i18n-audit -i en.json -o tr.json --format json --translate tr-en
```

---

## 🧩 Options

```bash
npx i18n-audit -h
Usage: i18n-audit [options]

Convert i18n JSON <-> CSV, detect unused and undefined translations, and translate between languages.

Options:
  -V, --version              output the version number
  -i, --input <file>         Input file (.json, .js, or .csv)
  -o, --output <file>        Output file path (defaults to stdout)
  --to <format>              Convert to "csv" or "json" (based on input) (default: "csv")
  -t, --translate <from-to>  Translate using source-target languages (e.g., en-tr)
  --audit                    Audit for undefined and unused keys in translation files
  --src <dir>                Source code directory to scan for used keys (default: ".")
  --api-url <url>            Optional translation API endpoint (LibreTranslate) (default: "http://localhost:5000")
  --api-key <key>            Optional API key for the translation service
  --chunk-size <n>           Number of entries per API request batch (default: 10)
  --chunk-delay <ms>         Delay between each chunk in milliseconds (default: 500)
  -h, --help                 display help for command
```

---

## 📄 License

MIT
