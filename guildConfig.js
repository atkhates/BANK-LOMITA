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
  try {
    const c = require("./config.json");
    return {
      CURRENCY_SYMBOL: c.CURRENCY_SYMBOL || "$",
      MIN_DEPOSIT: c.MIN_DEPOSIT ?? 0,
      ranks: c.ranks || ["Bronze", "Silver", "Gold"],
      fees: c.fees || { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },

      // IDs (empty by default; set via /setup)
      REGISTER_CHANNEL_ID: c.REGISTER_CHANNEL_ID || "",
      ADMIN_CHANNEL_ID: c.ADMIN_CHANNEL_ID || "",
      REG_LIST_CHANNEL_ID: "",               // <— NEW
      ADMIN_LOG_CHANNEL_ID: c.ADMIN_LOG_CHANNEL_ID || "",
      ADMIN_ROLE_ID: c.ADMIN_ROLE_ID || "",
    };
  } catch {
    return {
      CURRENCY_SYMBOL: "$",
      MIN_DEPOSIT: 0,
      ranks: ["Bronze", "Silver", "Gold"],
      fees: { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },

      REGISTER_CHANNEL_ID: "",
      ADMIN_CHANNEL_ID: "",
      REG_LIST_CHANNEL_ID: "",               // <— NEW
      ADMIN_LOG_CHANNEL_ID: "",
      ADMIN_ROLE_ID: "",
    };
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
