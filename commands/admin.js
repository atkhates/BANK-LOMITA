// commands/admin.js
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("لوحة تحكم المشرف لإدارة حسابات المستخدمين")
    .addUserOption(opt =>
      opt.setName("target")
        .setDescription("اختر مستخدمًا لإدارته")
        .setRequired(false)
    ),

  async execute(interaction, ctx) {
    // ctx.cfg may be a function OR an object depending on index.js
    const conf = typeof ctx?.cfg === "function"
      ? ctx.cfg()
      : (ctx?.cfg || require("../config.json"));

    const loadUsers = ctx.users; // your loader
    const target = interaction.options.getUser("target") || interaction.user;
    const U = loadUsers();
    const record = U[target.id];

    const data = record || {
      name: target.username,
      country: "—",
      age: "—",
      birth: "—",
      income: 0,
      rank: conf.ranks?.[0] || "Bronze",
      balance: 0,
      status: "no-record",
      kind: "—",
      faction: "—",
    };

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle("مراجعة المستخدم")
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .setDescription(`${target} — \n${target.tag}`)
      .addFields(
        { name: "الاسم", value: String(data.name), inline: true },
        { name: "البلد", value: String(data.country), inline: true },
        { name: "العمر", value: String(data.age), inline: true },
        { name: "تاريخ الميلاد", value: String(data.birth), inline: true },
        { name: "الدخل", value: String(data.income), inline: true },
        { name: "الرتبة", value: String(data.rank), inline: true },
        { name: "الرصيد", value: String(data.balance), inline: true },
        { name: "الحالة", value: String(data.status), inline: true },
        { name: "النوع", value: String(data.kind), inline: true },
        { name: "فصيل", value: String(data.faction), inline: true },
        { name: "ID", value: target.id, inline: false },
      );

    const rows = [];
    if (record && record.status === "pending") {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`approve_${target.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${target.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger),
        )
      );
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`addBalance_${target.id}`).setLabel("إضافة رصيد").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`promote_${target.id}`).setLabel("ترقية").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`fees`).setLabel("تعديل الرسوم").setStyle(ButtonStyle.Secondary),
      )
    );
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${record?.frozen ? "unfreeze" : "freeze"}_${target.id}`)
          .setLabel(record?.frozen ? "إلغاء تجميد" : "تجميد")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`blacklist_${target.id}`).setLabel("قائمة سوداء").setStyle(ButtonStyle.Danger),
      )
    );

    await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
  },
};
