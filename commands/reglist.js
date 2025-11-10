// commands/reglist.js — اختر قناة لعرض قائمة المسجلين تلقائياً

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("reglist")
    .setDescription("تعيين قناة عرض قائمة المسجلين")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o
        .setName("channel")
        .setDescription("القناة التي تُنشر فيها قائمة المسجلين")
        .setRequired(true)
    ),

  async execute(interaction) {
    const ch = interaction.options.getChannel("channel", true);
    GC.set(interaction.guildId, { REGLIST_CHANNEL_ID: ch.id });

    await interaction.reply({
      content: `✅ تم تعيين قناة قائمة المسجلين إلى <#${ch.id}>.`,
      ephemeral: true,
    });
  },
};
