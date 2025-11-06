// deploy-commands.js
// Deploy slash commands to Discord (guild by default, or globally with --global)

const fs = require("fs");
const path = require("path");
const { REST, Routes } = require("discord.js");
require("dotenv").config();

const TOKEN   = process.env.TOKEN;
const APP_ID  = process.env.APP_ID;   // aka clientId / application id
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !APP_ID) {
  console.error("❌ Missing TOKEN or APP_ID in .env");
  process.exit(1);
}

// ---- CLI flags -------------------------------------------------------------
// node deploy-commands.js            -> deploy to GUILD_ID
// node deploy-commands.js --global   -> deploy globally
// node deploy-commands.js --purge    -> purge for selected scope (no upload)
const argv = process.argv.slice(2);
const useGlobal = argv.includes("--global");
const doPurge   = argv.includes("--purge");

if (!useGlobal && !GUILD_ID) {
  console.error("❌ Missing GUILD_ID in .env (required for guild deployment)");
  process.exit(1);
}

const scopeLabel = useGlobal ? "GLOBAL" : `GUILD ${GUILD_ID}`;
const rest = new REST({ version: "10" }).setToken(TOKEN);

// ---- Load commands from ./commands ----------------------------------------
const commandsDir = path.join(__dirname, "commands");
const files = fs.readdirSync(commandsDir).filter(f => f.endsWith(".js"));

const commands = [];
for (const file of files) {
  const cmdPath = path.join(commandsDir, file);
  const mod = require(cmdPath);

  if (!mod?.data) {
    console.warn(`⚠️  Skipping ${file}: missing "data" export (SlashCommandBuilder)`);
    continue;
  }

  try {
    commands.push(mod.data.toJSON());
  } catch (e) {
    console.warn(`⚠️  Failed to load ${file}:`, e.message);
  }
}

(async () => {
  try {
    if (doPurge) {
      // Purge only (no upload)
      if (useGlobal) {
        await rest.put(Routes.applicationCommands(APP_ID), { body: [] });
      } else {
        await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: [] });
      }
      console.log(`🗑️  Purged ${scopeLabel} commands.`);
      process.exit(0);
    }

    console.log(`🚀 Deploying ${commands.length} commands to ${scopeLabel}...`);

    if (useGlobal) {
      await rest.put(Routes.applicationCommands(APP_ID), { body: commands });
    } else {
      await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
    }

    console.log(`✅ Deployed ${commands.length} command(s) to ${scopeLabel}.`);
    if (useGlobal) {
      console.log("ℹ️  Global updates can take up to ~1 hour to appear in the client.");
    }
  } catch (error) {
    console.error("❌ Deployment error:", error);
    process.exit(1);
  }
})();
