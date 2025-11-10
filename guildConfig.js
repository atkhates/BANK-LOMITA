// guildConfig.js — per-guild settings with sane defaults + set/patch

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
      MIN_DEPOSIT: c.MIN_DEPOSIT || 50000,
      ranks: c.ranks || ["Bronze", "Silver", "Gold"],
      fees: c.fees || { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },
      // Optional keys some commands expect:
      REGISTER_CHANNEL_ID: c.REGISTER_CHANNEL_ID || "",
      ADMIN_CHANNEL_ID: c.ADMIN_CHANNEL_ID || "",
      ADMIN_LOG_CHANNEL_ID: c.ADMIN_LOG_CHANNEL_ID || "",
      ADMIN_ROLE_ID: c.ADMIN_ROLE_ID || "",
      REGLIST_CHANNEL_ID: c.REGLIST_CHANNEL_ID || "",
      WITHDRAW_CHANNEL_ID: c.WITHDRAW_CHANNEL_ID || "",
    };
  } catch {
    return {
      CURRENCY_SYMBOL: "$",
      MIN_DEPOSIT: 50000,
      ranks: ["Bronze", "Silver", "Gold"],
      fees: { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },
      REGISTER_CHANNEL_ID: "",
      ADMIN_CHANNEL_ID: "",
      ADMIN_LOG_CHANNEL_ID: "",
      ADMIN_ROLE_ID: "",
      REGLIST_CHANNEL_ID: "",
      WITHDRAW_CHANNEL_ID: "",
    };
  }
}

function get(guildId) {
  const all = readAll();
  const d = defaults();
  return { ...d, ...(all[guildId] || {}) };
}
function set(guildId, patch) {
  const all = readAll();
  all[guildId] = { ...(all[guildId] || {}), ...patch };
  writeAll(all);
  return all[guildId];
}
function patch(guildId, patchObj) {
  // alias so older code that calls GC.patch keeps working
  return set(guildId, patchObj);
}

module.exports = { get, set, patch };
