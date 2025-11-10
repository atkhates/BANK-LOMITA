// commands/reglist.js — post a grouped list of registrations
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("reglist")
    .setDescription("عرض قائمة المسجلين (مجمّعة بالحالة)"),

  async execute(interaction) {
    const users = JSON.parse(fs.readFileSync("./database/users.json", "utf8") || "{}");

    const groups = { pending: [], approved: [], rejected: [], blacklisted: [] };
    for (const id of Object.keys(users)) {
      const u = users[id];
      const st = (u.status || "pending").toLowerCase();
      (groups[st] || groups.pending).push({ id, name: u.name || id });
    }

    const mk = (arr, title) => {
      if (!arr.length) return `**${title}:** —`;
      const lines = arr.slice(0, 25).map(x => `• ${x.name} (<@${x.id}>)`);
      return `**${title}:**\n${lines.join("\n")}${arr.length > 25 ? `\n… (+${arr.length-25})` : ""}`;
    };

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("قائمة المسجلين")
      .setDescription(
        [ mk(groups.pending, "قيد المراجعة"),
          mk(groups.approved, "مقبول"),
          mk(groups.rejected, "مرفوض"),
          mk(groups.blacklisted, "قائمة سوداء")
        ].join("\n\n")
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
