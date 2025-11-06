// commands/admin.js — لوحة معلومات فقط (بدون موافقة/رفض)

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("لوحة إدارة الحسابات")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((opt) => opt.setName("المستخدم").setDescription("مستخدم للمراجعة").setRequired(false)),

  async execute(interaction, { users, gconf }) {
    const g = gconf(interaction.guildId);

    if (g.ADMIN_CHANNEL_ID && interaction.channelId !== g.ADMIN_CHANNEL_ID) {
      return interaction.reply({
        content: `يمكن استخدام هذا الأمر فقط في قناة الإدارة <#${g.ADMIN_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    const target = interaction.options.getUser("المستخدم") || interaction.user;
    const U = users();
    const data = U[target.id];
    if (!data) return interaction.reply({ content: "لا يوجد سجل لهذا المستخدم.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("مراجعة المستخدم")
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .setDescription(`${target} — ${target.tag}`)
      .addFields(
        { name: "الاسم", value: String(data.name || "—"), inline: true },
        { name: "البلد", value: String(data.country || "—"), inline: true },
        { name: "العمر", value: String(data.age ?? "—"), inline: true },
        { name: "تاريخ الميلاد", value: String(data.birth || "—"), inline: true },
        { name: "الدخل", value: String(data.income ?? "0"), inline: true },
        { name: "الرتبة", value: String(data.rank || "—"), inline: true },
        { name: "الرصيد", value: String(data.balance ?? "0"), inline: true },
        { name: "الحالة", value: String(data.status || "—"), inline: true },
        { name: "فصيل؟", value: String(data.kind || "مدني"), inline: true },
        { name: "الفصيل", value: String(data.faction || "—"), inline: true }
      )
      .setFooter({ text: `ID: ${target.id}` });

    // NOTE: intentionally NO approve/reject buttons here.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`promote_${target.id}`).setLabel("ترقية").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`addBalance_${target.id}`).setLabel("إضافة رصيد").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`fees`).setLabel("تعديل الرسوم").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${data.frozen ? "unfreeze" : "freeze"}_${target.id}`)
        .setLabel(data.frozen ? "إلغاء تجميد" : "تجميد")
        .setStyle(data.frozen ? ButtonStyle.Secondary : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`blacklist_${target.id}`).setLabel("قائمة سوداء").setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
