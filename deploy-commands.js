const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");
require("dotenv").config();

const TOKEN   = process.env.TOKEN;
const APP_ID  = process.env.APP_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !APP_ID || !GUILD_ID) {
  console.error("❌ Missing TOKEN / APP_ID / GUILD_ID in .env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(TOKEN);
const commandsDir = path.join(__dirname, "commands");
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"));
const body = [];

for (const f of files) {
  const mod = require(path.join(commandsDir, f));
  if (mod?.data) body.push(mod.data.toJSON());
}

(async () => {
  await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body });
  console.log(`✅ Deployed ${body.length} commands to guild ${GUILD_ID}`);
})();
