// commands/register.js — يفتح نموذج التسجيل (إصدار يستخدم cfg() بدل gconf)

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("إرسال طلب تسجيل بنكي"),

  async execute(interaction, ctx) {
    // ctx.cfg قد تكون دالة أو object — نوحّدها إلى كائن إعدادات
    const C =
      typeof ctx?.cfg === "function"
        ? ctx.cfg()
        : (ctx?.cfg || require("../config.json"));

    // حصر الأمر في قناة التسجيل إذا كانت محددة
    if (C.REGISTER_CHANNEL_ID && interaction.channelId !== C.REGISTER_CHANNEL_ID) {
      return interaction.reply({
        content: `يمكن استخدام هذا الأمر فقط في قناة التسجيل <#${C.REGISTER_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId("registerModal")
      .setTitle("تسجيل بنكي");

    const name = new TextInputBuilder()
      .setCustomId("name")
      .setLabel("الاسم الكامل")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const country = new TextInputBuilder()
      .setCustomId("country")
      .setLabel("الدولة")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const age = new TextInputBuilder()
      .setCustomId("age")
      .setLabel("العمر (16–65)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const birth = new TextInputBuilder()
      .setCustomId("birth")
      .setLabel("تاريخ الميلاد (YYYY-MM-DD)")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const income = new TextInputBuilder()
      .setCustomId("income")
      .setLabel(`الدخل الشهري (≥ ${C.MIN_DEPOSIT || 0} ${C.CURRENCY_SYMBOL || ""})`)
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(country),
      new ActionRowBuilder().addComponents(age),
      new ActionRowBuilder().addComponents(birth),
      new ActionRowBuilder().addComponents(income)
    );

    await interaction.showModal(modal);
  },
};
