// commands/admin.js — لوحة الإدارة (قناة محددة + صلاحيات + حذف الرسائل السابقة)
const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const fs = require("fs");
const { ADMIN_CHAT_CHANNEL_ID } = require("../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("لوحة تحكم المشرف لإدارة حسابات المستخدمين")
    .addUserOption((option) =>
      option.setName("user").setDescription("المستخدم المطلوب مراجعته").setRequired(true)
    ),

  async execute(interaction, { cfg }) {
    // ✅ السماح فقط في قناة الإدارة
    if (interaction.channelId !== ADMIN_CHAT_CHANNEL_ID) {
      return interaction.reply({
        content: `يمكن استخدام هذا الأمر فقط في قناة الإدارة <#${ADMIN_CHAT_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    const C = cfg();
    if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json", "{}");
    const users = JSON.parse(fs.readFileSync("./database/users.json", "utf8"));

    const user = interaction.options.getUser("user");
    const data = users[user.id];
    if (!data) {
      return interaction.reply({ content: "لا يوجد سجل للمستخدم.", ephemeral: true });
    }

    // ✅ حذف أي رسالة بوت سابقة من نفس المستخدم (لمنع تكرار الرسائل)
    try {
      const messages = await interaction.channel.messages.fetch({ limit: 20 });
      const old = messages.find(
        (m) => m.author.id === interaction.client.user.id && m.interaction?.user.id === interaction.user.id
      );
      if (old) await old.delete().catch(() => {});
    } catch (err) {
      console.warn("لم أستطع حذف الرسالة القديمة:", err.message);
    }

    // إنشاء Embed
    const embed = new EmbedBuilder()
      .setColor(0x2c3e50)
      .setTitle(`مراجعة المستخدم: ${user.id}`)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: "الاسم", value: String(data.name || "-"), inline: true },
        { name: "العمر", value: String(data.age || "-"), inline: true },
        { name: "تاريخ الميلاد", value: String(data.birth || "-"), inline: true },
        { name: "الرصيد", value: `${data.balance || 0} ${C.CURRENCY_SYMBOL}`, inline: true },
        { name: "الدخل", value: `${data.income || 0} ${C.CURRENCY_SYMBOL}`, inline: true },
        { name: "الرتبة", value: String(data.rank || "بدون"), inline: true },
        { name: "الحالة", value: String(data.status || "-"), inline: true },
        { name: "الحساب مجمد؟", value: data.frozen ? "نعم" : "لا", inline: true }
      );

    // ✅ إخفاء قبول / رفض إن لم تكن الحالة pending
    const row1Buttons = [];
    if ((data.status || "pending") === "pending") {
      row1Buttons.push(
        new ButtonBuilder()
          .setCustomId(`approve_${user.id}`)
          .setLabel("قبول")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`reject_${user.id}`)
          .setLabel("رفض")
          .setStyle(ButtonStyle.Danger)
      );
    }

    row1Buttons.push(
      new ButtonBuilder()
        .setCustomId(`blacklist_${user.id}`)
        .setLabel("قائمة سوداء")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`promote_${user.id}`)
        .setLabel("ترقية رتبة")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`addBalance_${user.id}`)
        .setLabel("إضافة رصيد")
        .setStyle(ButtonStyle.Success)
    );

    const row1 = new ActionRowBuilder().addComponents(row1Buttons);

    const row2Buttons = [];
    if (data.frozen) {
      row2Buttons.push(
        new ButtonBuilder()
          .setCustomId(`unfreeze_${user.id}`)
          .setLabel("إلغاء تجميد")
          .setStyle(ButtonStyle.Secondary)
      );
    } else {
      row2Buttons.push(
        new ButtonBuilder()
          .setCustomId(`freeze_${user.id}`)
          .setLabel("تجميد")
          .setStyle(ButtonStyle.Secondary)
      );
    }

    row2Buttons.push(
      new ButtonBuilder()
        .setCustomId(`fees`)
        .setLabel("تعديل الرسوم")
        .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(row2Buttons);

    await interaction.reply({
      embeds: [embed],
      components: [row1, row2],
      ephemeral: true,
    });
  },
};
