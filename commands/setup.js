// commands/setup.js — تهيئة القنوات والرول لكل سيرفر
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { get: gcGet, set: gcSet } = require("../guildConfig"); // ← فك التصدير (لا مزيد من GC.set undefined)

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("تهيئة قنوات ورول البوت في هذا السيرفر")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName("register_channel")
        .setDescription("قناة التسجيل")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("review_channel")
        .setDescription("قناة مراجعة الطلبات")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("log_channel")
        .setDescription("قناة السجلات (اختياري)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName("reglist_channel")
        .setDescription("قناة قائمة المسجلين (اختياري)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("admin_role")
        .setDescription("رول الإدارة (اختياري)")
        .setRequired(false)
    ),

  async execute(interaction) {
    try {
      // ACK سريع لتفادي مهلة 3 ثواني
      await interaction.deferReply({ ephemeral: true });

      const gid     = interaction.guildId;
      const register= interaction.options.getChannel("register_channel", true);
      const review  = interaction.options.getChannel("review_channel", true);
      const logs    = interaction.options.getChannel("log_channel") || null;
      const reglist = interaction.options.getChannel("reglist_channel") || null;
      const admin   = interaction.options.getRole("admin_role") || null;

      const patch = {
        REGISTER_CHANNEL_ID: register.id,
        ADMIN_CHANNEL_ID: review.id,
      };
      if (logs)   patch.ADMIN_LOG_CHANNEL_ID = logs.id;
      if (reglist)patch.REGLIST_CHANNEL_ID    = reglist.id;
      if (admin)  patch.ADMIN_ROLE_ID         = admin.id;

      const saved = gcSet(gid, patch); // ← هنا الاستدعاء الصحيح

      await interaction.editReply({
        content:
          `✅ تم الحفظ للسيرفر \`${interaction.guild.name}\`:\n` +
          `• التسجيل: <#${saved.REGISTER_CHANNEL_ID}>\n` +
          `• المراجعة: <#${saved.ADMIN_CHANNEL_ID}>\n` +
          (saved.ADMIN_LOG_CHANNEL_ID ? `• السجلات: <#${saved.ADMIN_LOG_CHANNEL_ID}>\n` : "") +
          (saved.REGLIST_CHANNEL_ID    ? `• قائمة المسجلين: <#${saved.REGLIST_CHANNEL_ID}>\n` : "") +
          (saved.ADMIN_ROLE_ID         ? `• رول الإدارة: <@&${saved.ADMIN_ROLE_ID}>\n` : ""),
      });
    } catch (e) {
      console.error("setup error:", e);
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: "❌ حدث خطأ أثناء التهيئة.", ephemeral: true });
      } else if (!interaction.replied) {
        await interaction.reply({ content: "❌ حدث خطأ أثناء التهيئة.", ephemeral: true });
      }
    }
  },
};
