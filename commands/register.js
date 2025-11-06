// commands/register.js — يفتح نموذج التسجيل

const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder().setName("register").setDescription("إرسال طلب تسجيل بنكي"),
  async execute(interaction, { gconf }) {
    const g = gconf(interaction.guildId);

    if (g.REGISTER_CHANNEL_ID && interaction.channelId !== g.REGISTER_CHANNEL_ID) {
      return interaction.reply({
        content: `يمكن استخدام هذا الأمر فقط في قناة التسجيل <#${g.REGISTER_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder().setCustomId("registerModal").setTitle("تسجيل بنكي");
    const name = new TextInputBuilder().setCustomId("name").setLabel("الاسم الكامل").setStyle(TextInputStyle.Short).setRequired(true);
    const country = new TextInputBuilder().setCustomId("country").setLabel("الدولة").setStyle(TextInputStyle.Short).setRequired(true);
    const age = new TextInputBuilder().setCustomId("age").setLabel("العمر (16–65)").setStyle(TextInputStyle.Short).setRequired(true);
    const birth = new TextInputBuilder()
      .setCustomId("birth").setLabel("تاريخ الميلاد (YYYY-MM-DD)").setStyle(TextInputStyle.Short).setRequired(true);
    const income = new TextInputBuilder()
      .setCustomId("income")
      .setLabel(`الدخل الشهري (≥ ${g.MIN_DEPOSIT || 0})`)
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
