// commands/register.js — يفتح فقط مودال التسجيل
const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const fs = require("fs");
const { REGISTER_CHANNEL_ID } = require("../config.json");

function loadUsers() {
  if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json", "{}");
  return JSON.parse(fs.readFileSync("./database/users.json", "utf8"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("register")
    .setDescription("فتح حساب بنكي (نموذج التسجيل)"),

  async execute(interaction) {
    // قناة التسجيل فقط
    if (interaction.channelId !== REGISTER_CHANNEL_ID) {
      return interaction.reply({
        content: `يمكن استخدام هذا الأمر فقط في قناة التسجيل <#${REGISTER_CHANNEL_ID}>.`,
        ephemeral: true,
      });
    }

    // منع التكرار (يسمح بإعادة التقديم فقط إذا كانت الحالة السابقة rejected)
    const users = loadUsers();
    const rec = users[interaction.user.id];
    if (rec && rec.status !== "rejected") {
      let reason = "لديك طلب حاليًا.";
      if (rec.status === "pending") reason = "طلبك قيد المراجعة بالفعل.";
      else if (rec.status === "approved") reason = "لديك حساب مفعل بالفعل.";
      else if (rec.status === "blacklisted") reason = "تم إدراجك في القائمة السوداء. تواصل مع الإدارة.";
      return interaction.reply({ content: `لا يمكن إرسال طلب جديد: **${reason}**`, ephemeral: true });
    }

    // افتح المودال
    const modal = new ModalBuilder().setCustomId("registerModal").setTitle("تسجيل بنكي");

    const name = new TextInputBuilder()
      .setCustomId("name").setLabel("الاسم الكامل").setStyle(TextInputStyle.Short)
      .setPlaceholder("مثال: أحمد محمد").setRequired(true);

    const country = new TextInputBuilder()
      .setCustomId("country").setLabel("الدولة").setStyle(TextInputStyle.Short)
      .setPlaceholder("مثال: المغرب").setRequired(true);

    const age = new TextInputBuilder()
      .setCustomId("age").setLabel("العمر (16–65)").setStyle(TextInputStyle.Short)
      .setPlaceholder("مثال: 22").setRequired(true);

    const birth = new TextInputBuilder()
      .setCustomId("birth").setLabel("تاريخ الميلاد (YYYY-MM-DD)").setStyle(TextInputStyle.Short)
      .setPlaceholder("2003-05-17").setRequired(true);

    const income = new TextInputBuilder()
      .setCustomId("income").setLabel("الدخل الشهري (≥ 50000)").setStyle(TextInputStyle.Short)
      .setPlaceholder("50000").setRequired(true);

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
