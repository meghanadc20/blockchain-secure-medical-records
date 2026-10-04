'use strict';
/**
 * Reads/updates single keys in the project-root .env WITHOUT printing values.
 * Other lines (and comments) are preserved.
 */
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.resolve(__dirname, '../../../.env');

function readEnvValue(key) {
  if (!fs.existsSync(ENV_PATH)) return undefined;
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.*)\\s*$`);
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) {
      const v = m[1].trim().replace(/^["']|["']$/g, '');
      return v && !/<[^>]+>/.test(v) ? v : undefined;
    }
  }
  return undefined;
}

function setEnvValue(key, value) {
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n').replace(/\n*$/, '\n'));
  process.env[key] = value;
}

module.exports = { readEnvValue, setEnvValue, ENV_PATH };
