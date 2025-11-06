// guildConfig.js — per-guild settings with sane defaults from config.json
const fs = require("fs");
const PATH = "./guildConfigs.json";

function ensureFile() {
  if (!fs.existsSync(PATH)) fs.writeFileSync(PATH, "{}");
}
function readAll() {
  ensureFile();
  return JSON.parse(fs.readFileSync(PATH, "utf8"));
}
function writeAll(obj) {
  fs.writeFileSync(PATH, JSON.stringify(obj, null, 2));
}
function defaults() {
  // read global defaults from config.json if present
  try {
    const c = require("./config.json");
    return {
      CURRENCY_SYMBOL: c.CURRENCY_SYMBOL || "$",
      MIN_DEPOSIT: c.MIN_DEPOSIT || 50000,
      ranks: c.ranks || ["Bronze", "Silver", "Gold"],
      fees: c.fees || { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },
    };
  } catch {
    return { CURRENCY_SYMBOL: "$", MIN_DEPOSIT: 50000, ranks: ["Bronze", "Silver", "Gold"], fees: { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 } };
  }
}

module.exports = {
  get(guildId) {
    const all = readAll();
    const d = defaults();
    return { ...d, ...(all[guildId] || {}) };
  },
  set(guildId, patch) {
    const all = readAll();
    all[guildId] = { ...(all[guildId] || {}), ...patch };
    writeAll(all);
  },
};
