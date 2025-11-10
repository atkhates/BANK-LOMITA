// guildConfig.js — per-guild settings persisted to guildConfigs.json
const fs = require("fs");
const PATH = "./guildConfigs.json";

function ensure() { if (!fs.existsSync(PATH)) fs.writeFileSync(PATH, "{}"); }
function readAll() { ensure(); return JSON.parse(fs.readFileSync(PATH, "utf8") || "{}"); }
function writeAll(obj) { fs.writeFileSync(PATH, JSON.stringify(obj, null, 2)); }

// Defaults come from config.json if present
function baseDefaults() {
  try {
    const c = require("./config.json");
    return {
      CURRENCY_SYMBOL: c.CURRENCY_SYMBOL || "$",
      MIN_DEPOSIT: c.MIN_DEPOSIT ?? 0,
      ranks: c.ranks || ["Bronze","Silver","Gold"],
      fees: c.fees || { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },
      // the below are empty until /setup
      REGISTER_CHANNEL_ID: c.REGISTER_CHANNEL_ID || "",
      ADMIN_CHANNEL_ID: c.ADMIN_CHANNEL_ID || "",
      ADMIN_LOG_CHANNEL_ID: c.ADMIN_LOG_CHANNEL_ID || "",
      ADMIN_ROLE_ID: c.ADMIN_ROLE_ID || "",
      REGLIST_CHANNEL_ID: "",
      TRANSACTION_LOG_CHANNEL_ID: "",
    };
  } catch {
    return {
      CURRENCY_SYMBOL: "$",
      MIN_DEPOSIT: 0,
      ranks: ["Bronze","Silver","Gold"],
      fees: { DEPOSIT_FEE: 0, TRANSFER_FEE: 0, WITHDRAW_FEE: 0 },
      REGISTER_CHANNEL_ID: "",
      ADMIN_CHANNEL_ID: "",
      ADMIN_LOG_CHANNEL_ID: "",
      ADMIN_ROLE_ID: "",
      REGLIST_CHANNEL_ID: "",
      TRANSACTION_LOG_CHANNEL_ID: "",
    };
  }
}

function get(guildId) {
  const all = readAll();
  const d = baseDefaults();
  return { ...d, ...(all[guildId] || {}) };
}
function set(guildId, patch) {
  const all = readAll();
  all[guildId] = { ...(all[guildId] || {}), ...patch };
  writeAll(all);
  return get(guildId);
}
function patch(guildId, patchObj) {
  return set(guildId, patchObj);
}

module.exports = { get, set, patch };
