// guildConfig.js — per-guild settings plus tracking RegList message
const fs = require("fs");
const PATH = "./guildConfigs.json";

function ensure() {
  if (!fs.existsSync(PATH)) fs.writeFileSync(PATH, "{}");
}
function readAll() { ensure(); return JSON.parse(fs.readFileSync(PATH, "utf8")); }
function writeAll(o){ fs.writeFileSync(PATH, JSON.stringify(o, null, 2)); }

function defaults() {
  const c = require("./config.json");
  return {
    CURRENCY_SYMBOL: c.CURRENCY_SYMBOL,
    MIN_DEPOSIT: c.MIN_DEPOSIT,
    ranks: c.ranks,
    fees: c.fees,
    DAILY_WITHDRAW_LIMIT: c.DAILY_WITHDRAW_LIMIT
  };
}

module.exports = {
  get(gid) {
    const all = readAll();
    return { ...defaults(), ...(all[gid] || {}) };
  },
  patch(gid, patch) {
    const all = readAll();
    all[gid] = { ...(all[gid] || {}), ...patch };
    writeAll(all);
    return all[gid];
  }
};
