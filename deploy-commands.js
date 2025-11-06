// deploy-commands.js — deploy to specific guilds (instant)
const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");
require("dotenv").config();

const CLIENT_ID = process.env.CLIENT_ID;         // your bot app id
const GUILD_IDS = (process.env.GUILD_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
// Example in Replit Secrets: GUILD_IDS=123456789012345678,987654321098765432

const commands = [];
const cmdFiles = fs.readdirSync(path.join(__dirname, "commands")).filter(f => f.endsWith(".js"));
for (const file of cmdFiles) {
  const cmd = require(path.join(__dirname, "commands", file));
  if (cmd?.data) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    if (!CLIENT_ID || !GUILD_IDS.length) {
      console.error("Set CLIENT_ID and GUILD_IDS in env.");
      process.exit(1);
    }
    for (const gid of GUILD_IDS) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), { body: commands });
      console.log(`Deployed ${commands.length} command(s) to guild ${gid}`);
    }
  } catch (e) {
    console.error(e);
  }
})();
