const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");
require("dotenv").config();

const TOKEN   = process.env.TOKEN;
const APP_ID  = process.env.APP_ID;
const GUILD_ID = process.env.GUILD_ID;

const isGlobal = process.argv.includes("--global");
const isPurge = process.argv.includes("--purge");

if (!TOKEN || !APP_ID) {
  console.error("❌ Missing TOKEN / APP_ID in .env");
  process.exit(1);
}

if (!isGlobal && !GUILD_ID) {
  console.error("❌ Missing GUILD_ID in .env (required for guild-specific deployment)");
  console.error("💡 Use --global flag to deploy commands globally instead");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(TOKEN);
const commandsDir = path.join(__dirname, "commands");
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"));
let body = [];

if (!isPurge) {
  for (const f of files) {
    const mod = require(path.join(commandsDir, f));
    if (mod?.data) body.push(mod.data.toJSON());
  }
}

(async () => {
  if (isPurge) {
    if (isGlobal) {
      await rest.put(Routes.applicationCommands(APP_ID), { body: [] });
      console.log("🗑️ Purged all global commands");
    } else {
      await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: [] });
      console.log(`🗑️ Purged all commands from guild ${GUILD_ID}`);
    }
  } else {
    if (isGlobal) {
      await rest.put(Routes.applicationCommands(APP_ID), { body });
      console.log(`✅ Deployed ${body.length} commands globally`);
      console.log("⚠️ Note: Global commands can take up to 1 hour to appear in all servers");
    } else {
      await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body });
      console.log(`✅ Deployed ${body.length} commands to guild ${GUILD_ID}`);
    }
  }
})();
