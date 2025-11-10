// commands/setup.js — يحفظ قنوات ورول البوت في هذا السيرفر (كلها متوافقة)
// يجعل reglist_channel اختيارياً لتفادي الخطأ، ويقرأ فقط ما أُرسل فعلاً.

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const GC = require("../guildConfig"); // نفس الـ helper الذي يحفظ الـ guildConfigs.json

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
    // ACK سريع لتجنب مهلة 3 ثواني
    await interaction.deferReply({ ephemeral: true });

    const gid = interaction.guildId;

    const register = interaction.options.getChannel("register_channel", true);
    const review   = interaction.options.getChannel("review_channel", true);
    const logs     = interaction.options.getChannel("log_channel") || null;
    const reglist  = interaction.options.getChannel("reglist_channel") || null;
    const admin    = interaction.options.getRole("admin_role") || null;

    // احفظ فقط القيم المرسلة
    const patch = {
      REGISTER_CHANNEL_ID: register.id,
      ADMIN_CHANNEL_ID: review.id,
    };
    if (logs)   patch.ADMIN_LOG_CHANNEL_ID = logs.id;
    if (reglist)patch.REGLIST_CHANNEL_ID    = reglist.id;
    if (admin)  patch.ADMIN_ROLE_ID         = admin.id;

    GC.set(gid, patch);

    await interaction.editReply({
      content:
        `✅ تم الحفظ:\n` +
        `• التسجيل: <#${register.id}>\n` +
        `• المراجعة: <#${review.id}>\n` +
        (logs   ? `• السجلات: <#${logs.id}>\n` : "") +
        (reglist? `• قائمة المسجلين: <#${reglist.id}>\n` : "") +
        (admin  ? `• رول الإدارة: <@&${admin.id}>\n` : ""),
    });
  },
};
