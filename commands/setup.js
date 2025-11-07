// commands/setup.js — يحفظ قنوات ورول الإدارة + قناة المعاملات لهذا السيرفر

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("تهيئة قنوات ورول البوت في هذا السيرفر")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName("register_channel").setDescription("قناة التسجيل").setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("review_channel").setDescription("قناة مراجعة الطلبات").setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("log_channel").setDescription("قناة السجلات (اختياري)").setRequired(false)
    )
    .addChannelOption(o =>
      o.setName("tx_channel").setDescription("قناة المعاملات المالية (اختياري)").setRequired(false) // NEW
    )
    .addRoleOption(o =>
      o.setName("admin_role").setDescription("رول الإدارة").setRequired(false)
    ),

  async execute(interaction) {
    const gid = interaction.guildId;
    const register = interaction.options.getChannel("register_channel", true);
    const review   = interaction.options.getChannel("review_channel", true);
    const logs     = interaction.options.getChannel("log_channel") || null;
    const tx       = interaction.options.getChannel("tx_channel") || null;       // NEW
    const admin    = interaction.options.getRole("admin_role") || null;

    GC.set(gid, {
      REGISTER_CHANNEL_ID: register.id,
      ADMIN_CHANNEL_ID: review.id,
      ADMIN_LOG_CHANNEL_ID: logs?.id || "",
      TX_CHANNEL_ID: tx?.id || "",                                              // NEW
      ADMIN_ROLE_ID: admin?.id || "",
    });

    await interaction.reply({
      content:
        `✅ تم الحفظ:\n• التسجيل: <#${register.id}>\n• المراجعة: <#${review.id}>` +
        (logs ? `\n• السجلات: <#${logs.id}>` : "") +
        (tx ? `\n• المعاملات: <#${tx.id}>` : "") +                              // NEW
        (admin ? `\n• رول الإدارة: <@&${admin.id}>` : ""),
      ephemeral: true,
    });
  },
};
