const fs = require("fs");
require("dotenv").config();
const { REST, Routes } = require("discord.js");

const commands = [];
const files = fs.readdirSync("./commands").filter(f => f.endsWith(".js"));
for (const f of files) {
  const c = require(`./commands/${f}`);
  commands.push(c.data.toJSON());
}

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands })
  .then(() => console.log("✅ Slash commands deployed"))
  .catch(console.error);
